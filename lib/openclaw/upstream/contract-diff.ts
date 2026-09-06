import {
  compareOpenClawCoreMethodSpecs,
  getOpenClawServerMethodContractDiff,
  type OpenClawCoreMethodSpec
} from "@/lib/openclaw/application/update-contract-diff-service";
import type { OpenClawServerMethodContractDiffReport } from "@/lib/openclaw/types";
import type { OpenClawReleaseContractDiff } from "@/lib/openclaw/upstream/types";

export type OpenClawContractDiffSupplement = {
  eventsAdded?: string[];
  eventsRemoved?: string[];
  requestSchemasChanged?: string[];
  responseSchemasChanged?: string[];
  requiredFieldsAdded?: string[];
  requiredFieldsRemoved?: string[];
  enumValuesAdded?: string[];
  enumValuesRemoved?: string[];
  configKeysAdded?: string[];
  configKeysRemoved?: string[];
  configDefaultsChanged?: string[];
  securitySensitiveChanges?: string[];
};

export async function getOpenClawReleaseContractDiff(input: {
  fromVersion: string;
  targetVersion: string;
  supplement?: OpenClawContractDiffSupplement;
  fetchImpl?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>;
  bypassCache?: boolean;
}) {
  const report = await getOpenClawServerMethodContractDiff(
    { currentVersion: input.fromVersion, targetVersion: input.targetVersion },
    {
      fetchImpl: input.fetchImpl,
      bypassCache: input.bypassCache
    }
  );
  return {
    ...adaptOpenClawServerMethodContractDiff(report, input.supplement),
    source: "fixture" as const
  };
}

export function adaptOpenClawServerMethodContractDiff(
  report: OpenClawServerMethodContractDiffReport,
  supplement: OpenClawContractDiffSupplement = {}
): OpenClawReleaseContractDiff {
  const methodsAdded = unique(report.changes.filter((change) => change.kind === "added").map((change) => change.method));
  const methodsRemoved = unique(report.changes.filter((change) => change.kind === "removed" || change.kind === "replaced").map((change) => change.method));
  const scopesChanged = unique(report.changes
    .filter((change) => change.kind === "scope-changed")
    .map((change) => `${change.method}: ${change.currentScope ?? "unknown"} -> ${change.targetScope ?? "unknown"}`));
  const changedFiles = unique(report.changedFiles ?? [
    ...report.changedServerMethodFiles,
    ...report.changedProtocolFiles
  ]);
  const supplementalDomainEvidence = [
    ...(supplement.eventsAdded ?? []),
    ...(supplement.eventsRemoved ?? []),
    ...(supplement.requestSchemasChanged ?? []),
    ...(supplement.responseSchemasChanged ?? []),
    ...(supplement.requiredFieldsAdded ?? []),
    ...(supplement.requiredFieldsRemoved ?? []),
    ...(supplement.configDefaultsChanged ?? []),
    ...(supplement.securitySensitiveChanges ?? [])
  ];
  const inferredDomains = unique([
    ...inferDomains({
      methods: [...methodsAdded, ...methodsRemoved, ...scopesChanged, ...supplementalDomainEvidence],
      files: changedFiles
    }),
    ...(supplement.securitySensitiveChanges?.length ? ["security"] : []),
    ...(supplement.configDefaultsChanged?.length || supplement.configKeysAdded?.length || supplement.configKeysRemoved?.length ? ["config"] : []),
    ...((supplement.eventsAdded ?? []).some((event) => /update|restart|lifecycle/i.test(event)) ? ["updates"] : []),
    ...((supplement.eventsAdded ?? []).some((event) => /session|transcript/i.test(event)) ? ["sessions"] : [])
  ]);
  const securitySensitiveChanges = unique([
    ...inferSecuritySensitiveChanges({ methods: [...methodsAdded, ...methodsRemoved, ...scopesChanged], files: changedFiles }),
    ...(supplement.securitySensitiveChanges ?? [])
  ]);
  const eventsAdded = unique(supplement.eventsAdded ?? []);
  const eventsRemoved = unique(supplement.eventsRemoved ?? []);
  const requestSchemasChanged = unique(supplement.requestSchemasChanged ?? inferSchemaFiles(changedFiles, "request"));
  const responseSchemasChanged = unique(supplement.responseSchemasChanged ?? inferSchemaFiles(changedFiles, "response"));
  const protocolChanged = report.changedProtocolFiles.length > 0 || eventsAdded.length > 0 || eventsRemoved.length > 0;
  const updateContractChanged = inferredDomains.includes("updates") || changedFiles.some((file) => /update|doctor|rollback|recovery/i.test(file));
  const sessionContractChanged = inferredDomains.includes("sessions") || changedFiles.some((file) => /session|transcript|conversation/i.test(file));
  const evidenceGaps = report.source === "unavailable"
    ? [report.error || "Core Gateway method contract evidence is unavailable."]
    : report.changes.some((change) => change.method === "__comparison_truncated__")
      ? ["The upstream file comparison was bounded and did not include every changed file."]
      : [];
  const status = report.status === "blocker"
    ? "blocker"
    : report.status === "unknown" || evidenceGaps.length > 0
      ? "unknown"
      : report.status === "warning" || methodsAdded.length > 0 || methodsRemoved.length > 0 || scopesChanged.length > 0 || securitySensitiveChanges.length > 0 || Object.values(supplement).some((value) => Array.isArray(value) && value.length > 0)
        ? "warning"
        : "safe";

  return {
    status,
    source: report.source === "unavailable" ? "unavailable" : "agentos-server-method-diff",
    fromVersion: report.currentVersion,
    targetVersion: report.targetVersion,
    changedFiles,
    methodsAdded,
    methodsRemoved,
    eventsAdded,
    eventsRemoved,
    scopesChanged,
    requestSchemasChanged,
    responseSchemasChanged,
    requiredFieldsAdded: unique(supplement.requiredFieldsAdded ?? []),
    requiredFieldsRemoved: unique(supplement.requiredFieldsRemoved ?? []),
    enumValuesAdded: unique(supplement.enumValuesAdded ?? []),
    enumValuesRemoved: unique(supplement.enumValuesRemoved ?? []),
    configKeysAdded: unique(supplement.configKeysAdded ?? []),
    configKeysRemoved: unique(supplement.configKeysRemoved ?? []),
    configDefaultsChanged: unique(supplement.configDefaultsChanged ?? []),
    protocolChanged,
    updateContractChanged,
    sessionContractChanged,
    securitySensitiveChanges,
    domainsChanged: inferredDomains,
    evidenceGaps,
    summary: report.summary
  };
}

export function buildFixtureContractDiff(input: {
  fromVersion: string;
  targetVersion: string;
  currentSpecs: OpenClawCoreMethodSpec[];
  targetSpecs: OpenClawCoreMethodSpec[];
  supplement?: OpenClawContractDiffSupplement;
}) {
  const changes = compareOpenClawCoreMethodSpecs(input.currentSpecs, input.targetSpecs);
  const report: OpenClawServerMethodContractDiffReport = {
    generatedAt: "fixture",
    source: "github-static",
    currentVersion: input.fromVersion,
    targetVersion: input.targetVersion,
    status: changes.some((change) => change.status === "blocker") ? "blocker" : changes.length > 0 ? "warning" : "safe",
    currentMethodCount: input.currentSpecs.filter((spec) => spec.advertise).length,
    targetMethodCount: input.targetSpecs.filter((spec) => spec.advertise).length,
    currentRegisteredMethodCount: input.currentSpecs.length,
    targetRegisteredMethodCount: input.targetSpecs.length,
    changedFiles: [],
    changedServerMethodFiles: [],
    changedProtocolFiles: [],
    changes,
    blockerCount: changes.filter((change) => change.status === "blocker").length,
    warningCount: changes.filter((change) => change.status === "warning").length,
    unknownCount: changes.filter((change) => change.status === "unknown").length,
    renamedCount: changes.filter((change) => change.kind === "renamed").length,
    replacedCount: changes.filter((change) => change.kind === "replaced").length,
    summary: "Deterministic OpenClaw contract fixture.",
    error: null
  };
  return {
    ...adaptOpenClawServerMethodContractDiff(report, input.supplement),
    source: "fixture" as const
  };
}

function inferDomains(input: { methods: string[]; files: string[] }) {
  const values = [...input.methods, ...input.files].map((value) => value.toLowerCase());
  const domains: string[] = [];
  const rules: Array<[string, RegExp]> = [
    ["sessions", /session|transcript|conversation/],
    ["security", /auth|permission|scope|security|secret|approval|device|identity|exec/],
    ["updates", /update|doctor|rollback|recovery/],
    ["gateway-lifecycle", /gateway|restart|suspend|supervisor|lifecycle/],
    ["config", /config|schema|default/],
    ["models", /model|provider|oauth/],
    ["agents", /agent/],
    ["tasks", /task|cron|automation/],
    ["tools", /tool|plugin|skill/],
    ["channels", /channel|account/]
  ];
  for (const [domain, pattern] of rules) {
    if (values.some((value) => pattern.test(value))) domains.push(domain);
  }
  if (input.files.some((file) => /protocol|schema/.test(file.toLowerCase()))) domains.push("protocol");
  return unique(domains);
}

function inferSecuritySensitiveChanges(input: { methods: string[]; files: string[] }) {
  const values = [...input.methods, ...input.files];
  return unique(values
    .filter((value) => /auth|permission|scope|session|transcript|visibility|agent-to-agent|security|secret|approval|device|identity|exec|config/i.test(value))
    .map((value) => `Security-sensitive contract evidence changed: ${value}`));
}

function inferSchemaFiles(files: string[], kind: "request" | "response") {
  return files.filter((file) => new RegExp(`schema|${kind}|protocol`, "i").test(file));
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}
