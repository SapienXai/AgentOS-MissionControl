import "server-only";

import {
  OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS,
  type OpenClawGatewayCompatibilityOperationDefinition
} from "@/lib/openclaw/client/gateway-compatibility";
import type {
  OpenClawServerMethodContractChange,
  OpenClawServerMethodContractDiffReport,
  OpenClawServerMethodContractDiffStatus
} from "@/lib/openclaw/types";

const OPENCLAW_REPOSITORY = "openclaw/openclaw";
const CORE_DESCRIPTOR_PATH = "src/gateway/methods/core-descriptors.ts";
const SERVER_METHODS_PREFIX = "src/gateway/server-methods/";
const PROTOCOL_PATH_PREFIXES = [
  "packages/gateway-protocol/",
  "src/gateway/protocol/"
] as const;
const REQUEST_TIMEOUT_MS = 4_000;
const MAX_SOURCE_BYTES = 2_000_000;
const MAX_DESCRIPTOR_ROWS = 2_000;
const MAX_COMPARE_PAGES = 10;
const COMPARE_PAGE_SIZE = 100;
const CACHE_TTL_MS = 10 * 60 * 1_000;
const VERSION_PATTERN = /^\d{4}\.\d{1,2}\.\d{1,2}(?:-[A-Za-z0-9][A-Za-z0-9.-]*)?$/;
const OPENCLAW_SCOPE_PATTERN = /^(?:dynamic|node|operator\.[a-z][a-z0-9._-]*)$/;
const OPENCLAW_SINCE_PATTERN = /^(?:<=)?\d{4}\.\d{1,2}(?:\.\d{1,2})?$/;

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type OpenClawCoreMethodSpec = {
  name: string;
  family: string | null;
  scope: string;
  since: string | null;
  advertise: boolean;
  startup: boolean;
  controlPlaneWrite: boolean;
  compatibilityRestored: boolean;
  description: string | null;
};

type GitHubCompareFile = {
  filename?: unknown;
  previous_filename?: unknown;
};

type GitHubComparePayload = {
  files?: unknown;
  status?: unknown;
  total_commits?: unknown;
};

type ContractDiffOptions = {
  fetchImpl?: FetchLike;
  now?: () => Date;
  bypassCache?: boolean;
};

const reportCache = new Map<string, {
  expiresAt: number;
  value: Promise<OpenClawServerMethodContractDiffReport>;
}>();

export async function getOpenClawServerMethodContractDiff(
  input: { currentVersion: string; targetVersion: string },
  options: ContractDiffOptions = {}
): Promise<OpenClawServerMethodContractDiffReport> {
  const currentVersion = normalizeVersion(input.currentVersion);
  const targetVersion = normalizeVersion(input.targetVersion);
  const now = options.now ?? (() => new Date());

  if (!currentVersion || !targetVersion) {
    return unavailableReport({
      currentVersion: currentVersion ?? input.currentVersion,
      targetVersion: targetVersion ?? input.targetVersion,
      generatedAt: now(),
      error: "Current and target OpenClaw versions must be valid release versions."
    });
  }

  if (currentVersion === targetVersion) {
    return {
      generatedAt: now().toISOString(),
      source: "github-static",
      currentVersion,
      targetVersion,
      status: "safe",
      currentMethodCount: null,
      targetMethodCount: null,
      currentRegisteredMethodCount: null,
      targetRegisteredMethodCount: null,
      changedServerMethodFiles: [],
      changedProtocolFiles: [],
      changes: [],
      blockerCount: 0,
      warningCount: 0,
      unknownCount: 0,
      renamedCount: 0,
      replacedCount: 0,
      summary: "The target is already installed; no server-method contract change is expected.",
      error: null
    };
  }

  const cacheKey = `${currentVersion}->${targetVersion}`;
  const cached = reportCache.get(cacheKey);
  if (!options.bypassCache && cached && cached.expiresAt > Date.now()) {
    return cached.value;
  }

  const value = buildContractDiff({
    currentVersion,
    targetVersion,
    fetchImpl: options.fetchImpl ?? fetch,
    now
  });
  if (!options.bypassCache) {
    reportCache.set(cacheKey, {
      expiresAt: Date.now() + CACHE_TTL_MS,
      value
    });
  }

  return value;
}

export function parseOpenClawCoreMethodSpecs(source: string): OpenClawCoreMethodSpec[] {
  if (source.length > MAX_SOURCE_BYTES) {
    throw new Error("OpenClaw contract source exceeded the safe response size limit.");
  }

  const declaration = /\b(?:export\s+)?const\s+CORE_GATEWAY_METHOD_SPECS\b/.exec(source);
  if (!declaration) {
    throw new Error("OpenClaw core Gateway method descriptor table was not found.");
  }

  const equalsIndex = source.indexOf("=", declaration.index);
  if (equalsIndex < 0) {
    throw new Error("OpenClaw core Gateway method descriptor table has no readable array.");
  }
  const openIndex = findNextNonCommentCharacter(source, equalsIndex + 1, "[");
  if (openIndex < 0) {
    throw new Error("OpenClaw core Gateway method descriptor table has no readable array.");
  }

  const closeIndex = findMatchingDelimiter(source, openIndex, "[", "]");
  const table = source.slice(openIndex + 1, closeIndex);
  const rows = splitTopLevel(stripJavaScriptComments(table));
  if (rows.length === 0) {
    throw new Error("OpenClaw core Gateway method descriptor table contained no rows.");
  }
  if (rows.length > MAX_DESCRIPTOR_ROWS) {
    throw new Error("OpenClaw core Gateway method descriptor table exceeded the safe row limit.");
  }

  const specs = rows.map((row, index) => parseCoreMethodRow(row, index + 1));
  const seen = new Set<string>();
  for (const spec of specs) {
    if (seen.has(spec.name)) {
      throw new Error(`OpenClaw core Gateway method descriptor table contains duplicate method ${spec.name}.`);
    }
    seen.add(spec.name);
  }

  return specs;
}

function parseCoreMethodRow(row: string, rowNumber: number): OpenClawCoreMethodSpec {
  const trimmed = row.trim();
  if (trimmed.startsWith("{")) {
    return parseLegacyCoreMethodRow(trimmed, rowNumber);
  }
  if (trimmed.startsWith("[")) {
    return parseTupleCoreMethodRow(trimmed, rowNumber);
  }

  throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an unsupported shape.`);
}

function parseLegacyCoreMethodRow(row: string, rowNumber: number): OpenClawCoreMethodSpec {
  const fields = parseObjectFields(row, rowNumber);
  assertAllowedFields(fields, ["name", "scope", "advertise", "startup", "controlPlaneWrite"], rowNumber);

  const name = parseMethodName(fields.get("name"), rowNumber);
  const scope = parseScope(fields.get("scope"), rowNumber);
  return {
    name,
    family: null,
    scope,
    since: null,
    advertise: parseBooleanField(fields, "advertise", true, rowNumber),
    startup: parseBooleanField(fields, "startup", false, rowNumber),
    controlPlaneWrite: parseBooleanField(fields, "controlPlaneWrite", false, rowNumber),
    compatibilityRestored: false,
    description: null
  };
}

function parseTupleCoreMethodRow(row: string, rowNumber: number): OpenClawCoreMethodSpec {
  if (!row.endsWith("]")) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid tuple.`);
  }

  const values = splitTopLevel(row.slice(1, -1));
  if (values.length !== 4 && values.length !== 5) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid tuple length.`);
  }

  const name = parseMethodName(values[0], rowNumber);
  const familyValue = values[1]?.trim();
  const family = familyValue === "null" ? null : parseStringLiteral(familyValue, "family", rowNumber);
  const scope = parseScope(values[2], rowNumber);
  const since = parseSince(values[3], rowNumber);
  const policy = values[4] ? parsePolicyObject(values[4], rowNumber) : new Map<string, string>();

  assertAllowedFields(policy, ["advertise", "startup", "controlPlaneWrite", "compatibilityRestored", "description"], rowNumber);
  return {
    name,
    family,
    scope,
    since,
    advertise: parseBooleanField(policy, "advertise", true, rowNumber),
    startup: parseBooleanField(policy, "startup", false, rowNumber),
    controlPlaneWrite: parseBooleanField(policy, "controlPlaneWrite", false, rowNumber),
    compatibilityRestored: parseBooleanField(policy, "compatibilityRestored", false, rowNumber),
    description: policy.has("description")
      ? parseStringLiteral(policy.get("description"), "description", rowNumber)
      : null
  };
}

function parsePolicyObject(value: string, rowNumber: number) {
  const trimmed = value.trim();
  if (trimmed === "CONTROL_PLANE_WRITE") {
    return new Map([["controlPlaneWrite", "true"]]);
  }
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid policy object.`);
  }
  return parseObjectFields(trimmed, rowNumber);
}

function parseObjectFields(value: string, rowNumber: number) {
  if (!value.endsWith("}")) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid object.`);
  }

  const fields = new Map<string, string>();
  for (const field of splitTopLevel(value.slice(1, -1))) {
    const separator = field.indexOf(":");
    if (separator <= 0) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid field.`);
    }
    const key = field.slice(0, separator).trim();
    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(key) || fields.has(key)) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid or duplicate field.`);
    }
    fields.set(key, field.slice(separator + 1).trim());
  }
  return fields;
}

function assertAllowedFields(fields: Map<string, string>, allowed: string[], rowNumber: number) {
  const allowedSet = new Set(allowed);
  for (const key of fields.keys()) {
    if (!allowedSet.has(key)) {
      throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains unsupported field ${key}.`);
    }
  }
}

function parseMethodName(value: string | undefined, rowNumber: number) {
  const name = parseStringLiteral(value, "name", rowNumber).trim();
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name)) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains an invalid method name.`);
  }
  return name;
}

function parseScope(value: string | undefined, rowNumber: number) {
  const scope = parseStringLiteral(value, "scope", rowNumber).trim();
  if (!OPENCLAW_SCOPE_PATTERN.test(scope)) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains an invalid scope.`);
  }
  return scope;
}

function parseSince(value: string | undefined, rowNumber: number) {
  const since = parseStringLiteral(value, "since", rowNumber).trim();
  if (!OPENCLAW_SINCE_PATTERN.test(since)) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} contains an invalid since tag.`);
  }
  return since;
}

function parseStringLiteral(value: string | undefined, field: string, rowNumber: number) {
  const literal = value?.trim() ?? "";
  const quote = literal[0];
  if ((quote !== '"' && quote !== "'") || literal.at(-1) !== quote) {
    throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid ${field} string.`);
  }
  return literal.slice(1, -1);
}

function parseBooleanField(fields: Map<string, string>, field: string, defaultValue: boolean, rowNumber: number) {
  const value = fields.get(field);
  if (value === undefined) {
    return defaultValue;
  }
  if (value === "true") {
    return true;
  }
  if (value === "false") {
    return false;
  }
  throw new Error(`OpenClaw core Gateway method descriptor row ${rowNumber} has an invalid ${field} flag.`);
}

function findNextNonCommentCharacter(source: string, start: number, expected: string) {
  const clean = stripJavaScriptComments(source);
  for (let index = Math.max(0, start); index < clean.length; index += 1) {
    if (/\s/.test(clean[index] ?? "")) {
      continue;
    }
    return clean[index] === expected ? index : -1;
  }
  return -1;
}

function findMatchingDelimiter(source: string, openIndex: number, open: string, close: string) {
  const clean = stripJavaScriptComments(source);
  let depth = 0;
  let quote: string | null = null;
  let escaped = false;

  for (let index = openIndex; index < clean.length; index += 1) {
    const character = clean[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === open) {
      depth += 1;
    } else if (character === close) {
      depth -= 1;
      if (depth === 0) {
        return index;
      }
    }
  }

  throw new Error("OpenClaw core Gateway method descriptor table has an unclosed array.");
}

function splitTopLevel(value: string) {
  const parts: string[] = [];
  let start = 0;
  let quote: string | null = null;
  let escaped = false;
  const depth = { "[": 0, "{": 0, "(": 0 };

  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
      continue;
    }
    if (character === "[" || character === "{" || character === "(") {
      depth[character] += 1;
    } else if (character === "]") {
      depth["["] -= 1;
    } else if (character === "}") {
      depth["{"] -= 1;
    } else if (character === ")") {
      depth["("] -= 1;
    } else if (character === "," && Object.values(depth).every((entry) => entry === 0)) {
      parts.push(value.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (quote || Object.values(depth).some((entry) => entry !== 0)) {
    throw new Error("OpenClaw core Gateway method descriptor contains an unbalanced row.");
  }
  const finalPart = value.slice(start).trim();
  if (finalPart) {
    parts.push(finalPart);
  }
  return parts;
}

function stripJavaScriptComments(source: string) {
  let result = "";
  let quote: string | null = null;
  let escaped = false;
  let lineComment = false;
  let blockComment = false;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    const next = source[index + 1];
    if (lineComment) {
      if (character === "\n") {
        lineComment = false;
        result += "\n";
      } else {
        result += " ";
      }
      continue;
    }
    if (blockComment) {
      if (character === "*" && next === "/") {
        blockComment = false;
        result += "  ";
        index += 1;
      } else {
        result += character === "\n" ? "\n" : " ";
      }
      continue;
    }
    if (quote) {
      result += character;
      if (escaped) {
        escaped = false;
      } else if (character === "\\") {
        escaped = true;
      } else if (character === quote) {
        quote = null;
      }
      continue;
    }
    if (character === "/" && next === "/") {
      lineComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (character === "/" && next === "*") {
      blockComment = true;
      result += "  ";
      index += 1;
      continue;
    }
    if (character === '"' || character === "'" || character === "`") {
      quote = character;
    }
    result += character;
  }

  return result;
}

export function resetOpenClawServerMethodContractDiffCache() {
  reportCache.clear();
}

async function buildContractDiff(input: {
  currentVersion: string;
  targetVersion: string;
  fetchImpl: FetchLike;
  now: () => Date;
}): Promise<OpenClawServerMethodContractDiffReport> {
  const [currentResult, targetResult, compareResult] = await Promise.allSettled([
    fetchText(rawSourceUrl(input.currentVersion, CORE_DESCRIPTOR_PATH), input.fetchImpl),
    fetchText(rawSourceUrl(input.targetVersion, CORE_DESCRIPTOR_PATH), input.fetchImpl),
    fetchCompareFiles(input.currentVersion, input.targetVersion, input.fetchImpl)
  ]);

  if (currentResult.status === "rejected" || targetResult.status === "rejected") {
    const reason = currentResult.status === "rejected"
      ? currentResult.reason
      : targetResult.status === "rejected"
        ? targetResult.reason
        : undefined;
    return unavailableReport({
      currentVersion: input.currentVersion,
      targetVersion: input.targetVersion,
      generatedAt: input.now(),
      error: readErrorMessage(reason, "OpenClaw server-method contract source could not be loaded.")
    });
  }

  try {
    const currentSpecs = parseOpenClawCoreMethodSpecs(currentResult.value);
    const targetSpecs = parseOpenClawCoreMethodSpecs(targetResult.value);
    const compareFiles = compareResult.status === "fulfilled"
      ? compareResult.value
      : { files: [], truncated: false };
    const changedFiles = compareFiles.files;
    const changedServerMethodFiles = changedFiles.filter((file) => file.startsWith(SERVER_METHODS_PREFIX));
    const changedProtocolFiles = changedFiles.filter((file) =>
      PROTOCOL_PATH_PREFIXES.some((prefix) => file.startsWith(prefix))
    );
    const changes = compareOpenClawCoreMethodSpecs(currentSpecs, targetSpecs);
    const evidenceWarnings: OpenClawServerMethodContractChange[] = [];

    if (compareResult.status === "rejected") {
      evidenceWarnings.push(createEvidenceWarning(
        "__implementation_evidence__",
        "Server-method implementation file evidence could not be loaded; method and scope comparison is still available."
      ));
    } else {
      if (compareFiles.truncated) {
        evidenceWarnings.push(createEvidenceUnknown(
          "__comparison_truncated__",
          "The tag comparison contains more changed files than the bounded GitHub file listing; implementation and protocol path counts are incomplete."
        ));
      }
      if (changedServerMethodFiles.length > 0) {
        evidenceWarnings.push(createEvidenceWarning(
          "__server_method_implementations__",
          `${changedServerMethodFiles.length} server-method implementation file(s) changed; postflight runtime verification remains required.`
        ));
      }
      if (changedProtocolFiles.length > 0) {
        evidenceWarnings.push(createEvidenceWarning(
          "__protocol_schemas__",
          `${changedProtocolFiles.length} Gateway protocol/schema file(s) changed; payload compatibility requires runtime shape checks.`
        ));
      }
    }

    const allChanges = [...changes, ...evidenceWarnings];
    const blockerCount = allChanges.filter((change) => change.status === "blocker").length;
    const warningCount = allChanges.filter((change) => change.status === "warning").length;
    const unknownCount = allChanges.filter((change) => change.status === "unknown").length;
    const status: OpenClawServerMethodContractDiffStatus = blockerCount > 0
      ? "blocker"
      : warningCount > 0
        ? "warning"
        : unknownCount > 0
          ? "unknown"
          : "safe";

    return {
      generatedAt: input.now().toISOString(),
      source: "github-static",
      currentVersion: input.currentVersion,
      targetVersion: input.targetVersion,
      status,
      currentMethodCount: currentSpecs.filter((spec) => spec.advertise).length,
      targetMethodCount: targetSpecs.filter((spec) => spec.advertise).length,
      currentRegisteredMethodCount: currentSpecs.length,
      targetRegisteredMethodCount: targetSpecs.length,
      changedServerMethodFiles,
      changedProtocolFiles,
      changes: allChanges,
      blockerCount,
      warningCount,
      unknownCount,
      renamedCount: allChanges.filter((change) => change.kind === "renamed").length,
      replacedCount: allChanges.filter((change) => change.kind === "replaced").length,
      summary: summarizeDiff({ status, changes: allChanges, changedServerMethodFiles, changedProtocolFiles }),
      error: compareResult.status === "rejected"
        ? readErrorMessage(compareResult.reason, "GitHub implementation comparison was unavailable.")
        : null
    };
  } catch (error) {
    return unavailableReport({
      currentVersion: input.currentVersion,
      targetVersion: input.targetVersion,
      generatedAt: input.now(),
      error: readErrorMessage(error, "OpenClaw server-method contract could not be parsed.")
    });
  }
}

export function compareOpenClawCoreMethodSpecs(
  currentSpecs: OpenClawCoreMethodSpec[],
  targetSpecs: OpenClawCoreMethodSpec[],
  operations: OpenClawGatewayCompatibilityOperationDefinition[] = OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS
) {
  const currentByName = new Map(currentSpecs.map((spec) => [spec.name, spec]));
  const targetByName = new Map(targetSpecs.map((spec) => [spec.name, spec]));
  const methodNames = new Set([...currentByName.keys(), ...targetByName.keys()]);
  const changes: OpenClawServerMethodContractChange[] = [];

  for (const method of [...methodNames].sort()) {
    const current = currentByName.get(method) ?? null;
    const target = targetByName.get(method) ?? null;
    const affectedOperations = operationsForMethod(method, operations);

    if (!current && target) {
      const dynamicAuthorization = requiresRuntimeAuthorization(target.scope);
      changes.push({
        method,
        kind: "added",
        status: dynamicAuthorization ? "unknown" : "safe",
        authorizationEvidence: dynamicAuthorization ? "runtime-required" : "static",
        currentScope: null,
        targetScope: target.scope,
        affectedOperations,
        message: dynamicAuthorization
          ? `${method} is added with ${target.scope} scope; descriptor advertisement does not prove parameter-dependent authorization, so live runtime verification is required.`
          : `${method} is added with ${target.scope} scope.`
      });
      continue;
    }

    if (current && !target) {
      const replacement = findExplicitReplacement(method, targetSpecs, operations);
      const status = lostOperationStatus(method, currentSpecs, targetSpecs, operations);
      changes.push({
        method,
        kind: replacement ? "replaced" : "removed",
        status,
        authorizationEvidence: "static",
        currentScope: current.scope,
        targetScope: null,
        affectedOperations,
        message: affectedOperations.length
          ? `${method} is removed${replacement ? ` with explicit replacement evidence for ${replacement.replacementMethod}` : ""} and affects ${affectedOperations.join(", ")}.`
          : `${method} is removed from the core Gateway contract.`
      });
      continue;
    }

    if (!current || !target) {
      continue;
    }

    if (current.scope !== target.scope) {
      const status = scopeChangeStatus(method, current.scope, target.scope);
      const dynamicAuthorization = requiresRuntimeAuthorization(target.scope);
      changes.push({
        method,
        kind: "scope-changed",
        status,
        authorizationEvidence: dynamicAuthorization ? "runtime-required" : "static",
        currentScope: current.scope,
        targetScope: target.scope,
        affectedOperations,
        message: dynamicAuthorization
          ? `${method} scope changes from ${current.scope} to ${target.scope}; authorization depends on request parameters or runtime state and requires live runtime verification.`
          : `${method} scope changes from ${current.scope} to ${target.scope}.`
      });
    }

    if (
      current.advertise !== target.advertise ||
      current.startup !== target.startup ||
      current.controlPlaneWrite !== target.controlPlaneWrite ||
      current.compatibilityRestored !== target.compatibilityRestored
    ) {
      const hidden = current.advertise && !target.advertise;
      const dynamicAuthorization = requiresRuntimeAuthorization(target.scope);
      const status = hidden
        ? lostOperationStatus(method, currentSpecs, targetSpecs, operations)
        : dynamicAuthorization
          ? "unknown"
          : "warning";
      changes.push({
        method,
        kind: "policy-changed",
        status,
        authorizationEvidence: dynamicAuthorization ? "runtime-required" : "static",
        currentScope: current.scope,
        targetScope: target.scope,
        affectedOperations,
        message: dynamicAuthorization
          ? `${method} policy changes (${formatPolicy(current)} -> ${formatPolicy(target)}); descriptor advertisement does not prove parameter-dependent authorization, so live runtime verification is required.`
          : `${method} policy changes (${formatPolicy(current)} -> ${formatPolicy(target)}).`
      });
    }
  }

  return changes;
}

function lostOperationStatus(
  method: string,
  currentSpecs: OpenClawCoreMethodSpec[],
  targetSpecs: OpenClawCoreMethodSpec[],
  operations: OpenClawGatewayCompatibilityOperationDefinition[]
) {
  const currentMethods = new Set(currentSpecs.filter((spec) => spec.advertise).map((spec) => spec.name));
  const targetMethods = new Set(targetSpecs.filter((spec) => spec.advertise).map((spec) => spec.name));
  if (!currentMethods.has(method) || targetMethods.has(method)) {
    return "warning";
  }

  const impacted = operations.filter((operation) =>
    operation.methods.includes(method) &&
    !findExplicitReplacementForOperation(method, targetMethods, operation)
  );

  return impacted.some(blocksUpdate) ? "blocker" : "warning";
}

function scopeChangeStatus(method: string, currentScope: string, targetScope: string) {
  void method;
  if (currentScope === "dynamic" || currentScope === "node" || targetScope === "dynamic" || targetScope === "node") {
    return "unknown";
  }
  return "warning";
}

function blocksUpdate(operation: OpenClawGatewayCompatibilityOperationDefinition) {
  return operation.baseline === "required";
}

function findExplicitReplacement(
  method: string,
  targetSpecs: OpenClawCoreMethodSpec[],
  operations: OpenClawGatewayCompatibilityOperationDefinition[]
) {
  const targetMethods = new Set(targetSpecs.filter((spec) => spec.advertise).map((spec) => spec.name));
  for (const operation of operations) {
    const replacement = findExplicitReplacementForOperation(method, targetMethods, operation);
    if (replacement) {
      return replacement;
    }
  }
  return null;
}

function findExplicitReplacementForOperation(
  method: string,
  targetMethods: Set<string>,
  operation: OpenClawGatewayCompatibilityOperationDefinition
) {
  const evidence = operation.replacementEvidence?.find((entry) =>
    entry.removedMethod === method &&
    entry.replacementMethods.some((replacementMethod) =>
      operation.methods.includes(replacementMethod) && targetMethods.has(replacementMethod)
    )
  );
  if (!evidence) {
    return null;
  }
  return {
    replacementMethod: evidence.replacementMethods.find((replacementMethod) =>
      operation.methods.includes(replacementMethod) && targetMethods.has(replacementMethod)
    ) ?? null,
    rationale: evidence.rationale
  };
}

function operationsForMethod(method: string, operations: OpenClawGatewayCompatibilityOperationDefinition[]) {
  return operations
    .filter((operation) => operation.methods.includes(method))
    .map((operation) => operation.label);
}

function requiresRuntimeAuthorization(scope: string) {
  return scope === "dynamic" || scope === "node";
}

function formatPolicy(spec: OpenClawCoreMethodSpec) {
  return [
    spec.advertise ? "advertised" : "hidden",
    spec.startup ? "startup" : "normal-startup",
    spec.controlPlaneWrite ? "control-plane-write" : "standard-write",
    spec.compatibilityRestored ? "compatibility-restored" : "standard-compatibility"
  ].join(", ");
}

function createEvidenceWarning(method: string, message: string): OpenClawServerMethodContractChange {
  return {
    method,
    kind: "policy-changed",
    status: "warning",
    authorizationEvidence: "static",
    currentScope: null,
    targetScope: null,
    affectedOperations: [],
    message
  };
}

function createEvidenceUnknown(method: string, message: string): OpenClawServerMethodContractChange {
  return {
    method,
    kind: "policy-changed",
    status: "unknown",
    authorizationEvidence: "static",
    currentScope: null,
    targetScope: null,
    affectedOperations: [],
    message
  };
}

function summarizeDiff(input: {
  status: OpenClawServerMethodContractDiffStatus;
  changes: OpenClawServerMethodContractChange[];
  changedServerMethodFiles: string[];
  changedProtocolFiles: string[];
}) {
  const methodChanges = input.changes.filter((change) => !change.method.startsWith("__"));
  if (input.status === "safe" && methodChanges.length === 0) {
    return "No semantic core Gateway method contract changes were detected.";
  }

  const blockers = input.changes.filter((change) => change.status === "blocker").length;
  const warnings = input.changes.filter((change) => change.status === "warning").length;
  const unknowns = input.changes.filter((change) => change.status === "unknown").length;
  return `${methodChanges.length} method contract change(s), ${blockers} blocker(s), ${warnings} warning(s), ${unknowns} unknown(s), ${input.changedServerMethodFiles.length} server-method file change(s), and ${input.changedProtocolFiles.length} protocol file change(s).`;
}

async function fetchCompareFiles(currentVersion: string, targetVersion: string, fetchImpl: FetchLike) {
  const baseUrl = `https://api.github.com/repos/${OPENCLAW_REPOSITORY}/compare/v${encodeURIComponent(currentVersion)}...v${encodeURIComponent(targetVersion)}`;
  const files: GitHubCompareFile[] = [];
  let truncated = false;

  for (let page = 1; page <= MAX_COMPARE_PAGES; page += 1) {
    const url = `${baseUrl}?per_page=${COMPARE_PAGE_SIZE}&page=${page}`;
    const payload = JSON.parse(await fetchText(url, fetchImpl, "application/vnd.github+json")) as GitHubComparePayload;
    if (payload.status === "diverged" || (typeof payload.total_commits === "number" && payload.total_commits >= 10_000)) {
      truncated = true;
    }
    const pageFiles = Array.isArray(payload.files) ? payload.files as GitHubCompareFile[] : [];
    files.push(...pageFiles);
    if (pageFiles.length < COMPARE_PAGE_SIZE) {
      break;
    }
    if (page === MAX_COMPARE_PAGES) {
      truncated = true;
    }
  }

  return {
    files: [...new Set(files
      .flatMap((file) => [file.filename, file.previous_filename])
      .filter((file): file is string => typeof file === "string" && file.length > 0))].sort(),
    truncated
  };
}

async function fetchText(url: string, fetchImpl: FetchLike, accept = "text/plain") {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: accept,
        "User-Agent": "AgentOS-OpenClaw-Contract-Diff"
      }
    });
    if (!response.ok) {
      throw new Error(`OpenClaw contract source returned HTTP ${response.status}.`);
    }

    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_SOURCE_BYTES) {
      throw new Error("OpenClaw contract source exceeded the safe response size limit.");
    }

    const text = await response.text();
    if (text.length > MAX_SOURCE_BYTES) {
      throw new Error("OpenClaw contract source exceeded the safe response size limit.");
    }
    return text;
  } finally {
    clearTimeout(timer);
  }
}

function rawSourceUrl(version: string, path: string) {
  return `https://raw.githubusercontent.com/${OPENCLAW_REPOSITORY}/v${encodeURIComponent(version)}/${path}`;
}

function normalizeVersion(value: string) {
  const normalized = value.trim().replace(/^v/i, "");
  return VERSION_PATTERN.test(normalized) ? normalized : null;
}

function unavailableReport(input: {
  currentVersion: string;
  targetVersion: string;
  generatedAt: Date;
  error: string;
}): OpenClawServerMethodContractDiffReport {
  return {
    generatedAt: input.generatedAt.toISOString(),
    source: "unavailable",
    currentVersion: input.currentVersion,
    targetVersion: input.targetVersion,
    status: "unknown",
    currentMethodCount: null,
    targetMethodCount: null,
    currentRegisteredMethodCount: null,
    targetRegisteredMethodCount: null,
    changedServerMethodFiles: [],
    changedProtocolFiles: [],
    changes: [],
    blockerCount: 0,
    warningCount: 0,
    unknownCount: 0,
    renamedCount: 0,
    replacedCount: 0,
    summary: "Static OpenClaw server-method contract evidence is unavailable.",
    error: input.error
  };
}

function readErrorMessage(error: unknown, fallback: string) {
  return error instanceof Error && error.message.trim() ? error.message.trim() : fallback;
}
