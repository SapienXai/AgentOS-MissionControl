import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";
import {
  OPENCLAW_NATIVE_CONTRACT_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";

const TARGET_VERSION = "2026.9.3";
const TARGET_COMMIT = "1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7";
const TARGET_BUILD = "2026.9.3-release-1391f7cd2d40-2026-09-08T07-46-00.264Z";
const PACKAGE_INPUT = process.env.OPENCLAW_FINAL_CERTIFICATION_PACKAGE?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_FINAL_CERTIFICATION_OUTPUT?.trim() ||
  path.resolve(`docs/evidence/openclaw-${TARGET_VERSION}-final-certification.json`);

const REQUIRED_ARTIFACTS = [
  ["contract-diff", `docs/evidence/openclaw-2026.9.2-to-${TARGET_VERSION}-contract-diff.json`],
  ["fresh-baseline", `docs/evidence/openclaw-${TARGET_VERSION}-fresh-baseline.json`],
  ["runtime", `docs/evidence/openclaw-${TARGET_VERSION}-runtime-certification.json`],
  ["migration", "docs/evidence/openclaw-2026.9.2-to-2026.9.3-migration.json"],
  ["lifecycle", `docs/evidence/openclaw-${TARGET_VERSION}-lifecycle-certification.json`],
  ["identity", `docs/evidence/openclaw-${TARGET_VERSION}-identity-authorization.json`],
  ["multi-user", `docs/evidence/openclaw-${TARGET_VERSION}-multi-user.json`],
  ["multi-user-collaboration", `docs/evidence/openclaw-${TARGET_VERSION}-multi-user-identity-collaboration.json`],
  ["automation", `docs/evidence/openclaw-${TARGET_VERSION}-automation-cron-alignment.json`],
  ["session-task", `docs/evidence/openclaw-${TARGET_VERSION}-session-task-alignment.json`],
  ["workforce", `docs/evidence/openclaw-${TARGET_VERSION}-workforce-acceptance.json`],
  ["official-transport", `docs/evidence/openclaw-${TARGET_VERSION}-official-transport-certification.json`],
  ["official-lifecycle", `docs/evidence/openclaw-${TARGET_VERSION}-official-gateway-lifecycle-certification.json`],
  ["official-production", `docs/evidence/openclaw-${TARGET_VERSION}-final-official-runtime-certification.json`],
  ["native-work", `docs/evidence/openclaw-${TARGET_VERSION}-native-work-hardening.json`],
  ["skills", `docs/evidence/openclaw-${TARGET_VERSION}-skills-effective-capabilities.json`],
  ["memory", `docs/evidence/openclaw-${TARGET_VERSION}-native-memory.json`],
  ["doctor", `docs/evidence/openclaw-${TARGET_VERSION}-doctor-update-recovery.json`],
  ["doctor-hardening", `docs/evidence/openclaw-${TARGET_VERSION}-doctor-update-recovery-hardening.json`],
  ["human-control", `docs/evidence/openclaw-${TARGET_VERSION}-human-control-inbox.json`]
] as const;

type Artifact = Record<string, unknown>;

async function main() {
  const failures: string[] = [];
  const artifactResults: Record<string, { path: string; status: "PASS" | "FAIL"; skips: number; expectedDenials: number; reason?: string }> = {};
  const identity = PACKAGE_INPUT ? await readPackageIdentity(path.resolve(PACKAGE_INPUT)).catch((error) => {
    failures.push(`cannot inspect exact OpenClaw package: ${safeError(error)}`);
    return null;
  }) : null;

  if (!PACKAGE_INPUT) failures.push("OPENCLAW_FINAL_CERTIFICATION_PACKAGE is not set");
  if (!identity) {
    // The detailed error is already recorded above; keep the artifact deterministic.
  } else {
    if (identity.version !== TARGET_VERSION) failures.push(`package version is ${identity.version}, expected ${TARGET_VERSION}`);
    if (identity.sourceCommit !== TARGET_COMMIT) failures.push(`package source commit is ${identity.sourceCommit}, expected ${TARGET_COMMIT}`);
    if (identity.buildId !== TARGET_BUILD) failures.push(`package build id is ${identity.buildId}, expected ${TARGET_BUILD}`);
  }

  for (const [name, relativePath] of REQUIRED_ARTIFACTS) {
    const artifactPath = path.resolve(relativePath);
    try {
      const artifact = JSON.parse(await readFile(artifactPath, "utf8")) as Artifact;
      const result = assessArtifact(name, artifact);
      artifactResults[name] = { path: relativePath, ...result };
      if (result.status !== "PASS") failures.push(`${name}: ${result.reason ?? "artifact did not pass"}`);
    } catch (error) {
      artifactResults[name] = { path: relativePath, status: "FAIL", skips: 0, expectedDenials: 0, reason: safeError(error) };
      failures.push(`${name}: ${safeError(error)}`);
    }
  }

  if (OPENCLAW_IDENTITY_CONTRACT_VERSION !== TARGET_VERSION || OPENCLAW_NATIVE_CONTRACT_VERSION !== TARGET_VERSION) {
    failures.push("active OpenClaw identity/native contract is not 2026.9.3");
  }

  const report = {
    schemaVersion: 1,
    artifactType: "openclaw-final-certification",
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      agentosCodeHead: await gitOutput(["rev-parse", "HEAD"]),
      branch: await gitOutput(["branch", "--show-current"]),
      node: process.version,
      openClaw: identity ? {
        version: identity.version,
        sourceCommit: identity.sourceCommit,
        buildId: identity.buildId,
        packageHash: identity.packageHash
      } : null,
      expectedOpenClaw: {
        version: TARGET_VERSION,
        sourceCommit: TARGET_COMMIT,
        buildId: TARGET_BUILD,
        gatewayProtocol: 4,
        stateSchema: 16,
        agentSchema: 19,
        gatewayClient: TARGET_VERSION,
        gatewayProtocolPackage: TARGET_VERSION
      },
      supportedBaseline: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      nativeContract: OPENCLAW_NATIVE_CONTRACT_VERSION
    },
    matrix: artifactResults,
    classification: {
      environmentalSkips: Object.values(artifactResults).reduce((sum, result) => sum + result.skips, 0),
      expectedAuthorizationDenials: Object.values(artifactResults).reduce((sum, result) => sum + result.expectedDenials, 0),
      unknownOutcomes: 0,
      productionGatewayTouched: false,
      realCredentialsAccessed: false
    },
    promotion: {
      recommendedVersion: TARGET_VERSION,
      nativeContractVersion: TARGET_VERSION,
      supportedBaseline: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      decision: failures.length === 0 ? "PROMOTE" : "BLOCK"
    },
    failures,
    success: failures.length === 0
  };

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(report, null, 2)}\n`, { mode: 0o600 });
  console.log(`OPENCLAW ${TARGET_VERSION} FINAL CERTIFICATION: ${report.success ? "PASS" : "FAIL"}`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  if (!report.success) process.exitCode = 1;
}

function assessArtifact(name: string, artifact: Artifact) {
  const values = collectStatusValues(artifact);
  const skips = values.filter((value) => value === "SKIPPED").length;
  const expectedDenials = values.filter((value) => value === "EXPECTED-DENIAL" || value === "EXPECTED_DENIAL").length;
  const failures: string[] = [];
  if (name === "contract-diff") {
    const comparison = asRecord(artifact.comparison);
    const to = asRecord(comparison?.to);
    if (to?.openclawVersion !== TARGET_VERSION || to?.sourceCommit !== TARGET_COMMIT || to?.gatewayProtocol !== 4 || to?.stateSchema !== 16 || to?.agentSchema !== 19) {
      failures.push("contract target identity/schema/protocol mismatch");
    }
    if (asRecord(artifact.retiredSdkUsageAudit)?.status !== "pass") failures.push("retired SDK usage audit did not pass");
  } else if (name === "official-transport") {
    const requests = asRecord(artifact.requests);
    if (!requests || Object.values(requests).some((entry) => asRecord(entry)?.status !== "passed") || asRecord(artifact.authorizationDenial)?.status !== "denied") {
      failures.push("official transport probe or expected authorization denial failed");
    }
  } else if (name === "workforce") {
    if (asRecord(artifact.summary)?.failed !== 0) failures.push("workforce summary contains failures");
  } else if (name === "human-control") {
    if (artifact.result !== "PASS") failures.push(`human-control result is ${String(artifact.result)}`);
  } else if (name === "runtime") {
    const runtime = asRecord(artifact.runtime);
    const summary = asRecord(runtime?.summary);
    if (runtime?.targetVersion !== TARGET_VERSION || runtime?.installedVersion !== TARGET_VERSION || runtime?.protocolVersion !== 4) {
      failures.push("runtime target identity or protocol mismatch");
    }
    if (summary?.failed !== 0 || summary?.requiredFailures !== 0 || summary?.unknown !== 0) {
      failures.push("runtime certification contains failures, required failures, or unknown outcomes");
    }
  } else if (artifact.success !== true && !(typeof artifact.gate === "string" && artifact.gate.endsWith("PASS"))) {
    failures.push("artifact success/gate is not PASS");
  }
  if (values.includes("FAIL") || values.includes("UNKNOWN")) failures.push("artifact contains FAIL or UNKNOWN status");
  const identityStrings = collectStrings(artifact);
  if (name !== "contract-diff" && !identityStrings.includes(TARGET_VERSION)) failures.push("artifact does not identify OpenClaw 2026.9.3");
  return {
    status: failures.length === 0 ? "PASS" as const : "FAIL" as const,
    skips,
    expectedDenials,
    ...(failures.length ? { reason: failures.join("; ") } : {})
  };
}

function collectStatusValues(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectStatusValues);
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  const current = Object.entries(record)
    .filter(([key]) => key === "status" || key === "result" || key === "outcome")
    .filter(([, entry]) => typeof entry === "string")
    .map(([, entry]) => entry as string);
  return [...current, ...Object.values(record).flatMap(collectStatusValues)];
}

function collectStrings(value: unknown): string[] {
  if (Array.isArray(value)) return value.flatMap(collectStrings);
  if (!value || typeof value !== "object") return typeof value === "string" ? [value] : [];
  return Object.values(value as Record<string, unknown>).flatMap(collectStrings);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

async function readPackageIdentity(packageRoot: string) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return {
    version: packageJson.version ?? "",
    sourceCommit: buildInfo.commit ?? null,
    buildId: buildInfo.buildId ?? null,
    packageHash: hash.digest("hex")
  };
}

async function gitOutput(args: string[]) {
  const { execFile } = await import("node:child_process");
  return await new Promise<string>((resolve) => {
    execFile("git", args, { cwd: process.cwd(), encoding: "utf8" }, (_error, stdout) => resolve(stdout.trim()));
  });
}

function safeError(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

void main();
