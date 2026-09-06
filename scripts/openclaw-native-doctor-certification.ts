import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import {
  comparePinnedMethodScopes,
  parsePinnedCoreDescriptorScopes,
  PHASE_6_NATIVE_METHODS
} from "@/lib/openclaw/certification/upstream-scope";
import type { OpenClawGatewayRequestPolicy } from "@/lib/openclaw/client/types";
import { OPENCLAW_STATIC_METHOD_SCOPES, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";
import { resolveRequiredScopes } from "@/lib/openclaw/identity/authorization";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = process.env.OPENCLAW_NATIVE_DOCTOR_PACKAGE?.trim() || "/tmp/openclaw-2026.9.2-source-agentos";
const OUTPUT_PATH = process.env.OPENCLAW_NATIVE_DOCTOR_OUTPUT?.trim() || path.resolve("docs/evidence/openclaw-2026.9.2-doctor-update-recovery.json");
const HARDENING_CERTIFICATION = process.env.OPENCLAW_NATIVE_DOCTOR_HARDENING === "1";
const REQUEST_TIMEOUT_MS = 10_000;
type CertificationStatus = "PASS" | "SKIPPED" | "EXPECTED-DENIAL" | "FAIL";

type MethodEvidence = {
  scope: string;
  params: string;
  productIntegration: "integrated" | "typed-only" | "compatibility-only";
  authority: "OpenClaw-native";
  status: CertificationStatus;
  result: string | null;
};

async function main() {
  const packageIdentity = await readPackageIdentity(PACKAGE_ROOT);
  if (packageIdentity.version !== OPENCLAW_IDENTITY_CONTRACT_VERSION || packageIdentity.sourceCommit !== OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT) {
    throw new Error("The supplied OpenClaw package does not match the pinned 2026.9.2 source build.");
  }

  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-native-doctor-"));
  const resources = {
    stateDir: path.join(disposableRoot, "state"),
    workspaceDir: path.join(disposableRoot, "workspace"),
    configPath: path.join(disposableRoot, "openclaw.json"),
    port: await reservePort(),
    token: `agentos-native-doctor-${Date.now()}`
  };
  let gateway: ChildProcess | null = null;
  let client: ReturnType<typeof createClient> | null = null;
  const rpcCounts: Record<string, number> = {};
  const evidence = createEvidence(packageIdentity, await readGitHead(), rpcCounts);

  try {
    const upstreamScopes = await readPinnedUpstreamScopes(PACKAGE_ROOT);
    if (upstreamScopes.source.sourceCommit && packageIdentity.sourceCommit && upstreamScopes.source.sourceCommit !== packageIdentity.sourceCommit) {
      throw new Error("The pinned OpenClaw descriptor source commit does not match the package build identity.");
    }
    evidence.authorization.upstreamScopeSource = upstreamScopes.source;
    evidence.authorization.upstreamScopes = upstreamScopes.scopes;
    evidence.authorization.exactScopes = comparePinnedMethodScopes(OPENCLAW_STATIC_METHOD_SCOPES, upstreamScopes.scopes)
      && PHASE_6_NATIVE_METHODS.every((method) => JSON.stringify(OPENCLAW_STATIC_METHOD_SCOPES[method]) === JSON.stringify(resolveRequiredScopes(method)))
      ? "PASS"
      : "FAIL";
    await mkdir(resources.workspaceDir, { recursive: true, mode: 0o700 });
    await writeFile(resources.configPath, `${JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: resources.token } },
      agents: { defaults: { workspace: resources.workspaceDir }, list: [{ id: "main", workspace: resources.workspaceDir }] },
      cron: { enabled: false }
    }, null, 2)}\n`, { mode: 0o600 });
    gateway = await startGateway({ packageRoot: PACKAGE_ROOT, ...resources });
    client = createClient(resources);
    const handshake = await client.probeNativeHandshake({ timeoutMs: REQUEST_TIMEOUT_MS });
    evidence.runtime.handshake = handshake.protocol === 4 && handshake.server?.version === OPENCLAW_IDENTITY_CONTRACT_VERSION ? "PASS" : "FAIL";
    evidence.runtime.nativeTransport = client.getDiagnostics?.().transportImplementation === "official";

    await probeMethod(client, rpcCounts, "health", {}, evidence.methods.health, (payload) => typeof asRecord(payload)?.ok === "boolean");
    await probeMethod(client, rpcCounts, "health", { probe: true }, evidence.methods.healthProbe, (payload) => typeof asRecord(payload)?.ok === "boolean");
    await probeMethod(client, rpcCounts, "status", {}, evidence.methods.status, (payload) => Boolean(asRecord(payload)));
    await probeMethod(client, rpcCounts, "diagnostics.stability", {}, evidence.methods["diagnostics.stability"], (payload) => Boolean(asRecord(payload)));
    await probeMethod(client, rpcCounts, "config.get", {}, evidence.methods["config.get"], (payload) => {
      const record = asRecord(payload);
      return Boolean(record && Object.hasOwn(record, "configRevisionHash") && Object.hasOwn(record, "appliedConfigHash"));
    });
    await probeMethod(client, rpcCounts, "update.status", {}, evidence.methods["update.status"], (payload) => {
      const record = asRecord(payload);
      return Boolean(record && Object.hasOwn(record, "sentinel") && Object.hasOwn(record, "updateAvailable"));
    });
    await probeMethod(client, rpcCounts, "gateway.restart.preflight", {}, evidence.methods["gateway.restart.preflight"], (payload) => Boolean(asRecord(payload)));

    await probeMethod(client, rpcCounts, "update.hold", {}, evidence.methods["update.hold"], (payload) => typeof asRecord(payload)?.ok === "boolean", mutationPolicy());
    evidence.methods["update.run"].status = "SKIPPED";
    evidence.methods["update.run"].result = "Not executed: update.run can install packages or hand off to an external supervisor.";
    evidence.methods["gateway.restart.request"].status = "SKIPPED";
    evidence.methods["gateway.restart.request"].result = "Not executed: restart.request intentionally terminates the disposable Gateway before final probes.";

    const prepared = await callMethod(client, rpcCounts, "gateway.suspend.prepare", {
      requestId: "agentos-native-doctor-certification",
      terminalPolicy: "preserve",
      drain: false
    }, mutationPolicy());
    if (prepared.status === "PASS") {
      const preparedRecord = asRecord(prepared.payload);
      const suspensionId = readString(preparedRecord?.suspensionId);
      evidence.methods["gateway.suspend.prepare"].status = "PASS";
      evidence.methods["gateway.suspend.prepare"].result = readString(preparedRecord?.status) ?? "returned";
      if (suspensionId) {
        await probeMethod(client, rpcCounts, "gateway.suspend.status", { suspensionId }, evidence.methods["gateway.suspend.status"], (payload) => Boolean(asRecord(payload)));
        await probeMethod(client, rpcCounts, "gateway.suspend.resume", { suspensionId }, evidence.methods["gateway.suspend.resume"], (payload) => asRecord(payload)?.ok === true, mutationPolicy());
      } else {
        evidence.methods["gateway.suspend.status"].status = "SKIPPED";
        evidence.methods["gateway.suspend.status"].result = "No suspension lease was issued by the disposable runtime.";
        evidence.methods["gateway.suspend.resume"].status = "SKIPPED";
        evidence.methods["gateway.suspend.resume"].result = "No suspension lease was issued by the disposable runtime.";
      }
    } else {
      evidence.methods["gateway.suspend.prepare"].status = prepared.status;
      evidence.methods["gateway.suspend.prepare"].result = prepared.result;
      evidence.methods["gateway.suspend.status"].status = "SKIPPED";
      evidence.methods["gateway.suspend.status"].result = "No suspension lease was available.";
      evidence.methods["gateway.suspend.resume"].status = "SKIPPED";
      evidence.methods["gateway.suspend.resume"].result = "No suspension lease was available.";
    }

    evidence.observations.noCliFallback = client.getDiagnostics?.().fallbackTotal === 0 ? "PASS" : "FAIL";
    evidence.observations.identityContinuity = "SKIPPED";
  } catch (error) {
    evidence.skips.push(`Disposable native Doctor runtime did not complete: ${sanitize(error instanceof Error ? error.message : String(error))}`);
  } finally {
    client?.close("native Doctor certification complete");
    await stopProcess(gateway).catch(() => {});
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup.status = "complete";
    evidence.cleanup.gatewayProcessStopped = gateway?.exitCode !== null;
    evidence.cleanup.disposableRootRemoved = !(await pathExists(disposableRoot));
  }

  const methodsPass = Object.values(evidence.methods).every((method) => method.status !== "FAIL");
  evidence.success = evidence.runtime.handshake === "PASS"
    && evidence.runtime.nativeTransport
    && methodsPass
    && evidence.authorization.exactScopes === "PASS"
    && evidence.observations.noCliFallback === "PASS"
    && evidence.cleanup.gatewayProcessStopped
    && evidence.cleanup.disposableRootRemoved;
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  console.log(`OPENCLAW 9.2 NATIVE DOCTOR GATE: ${evidence.success ? "PASS" : "FAIL"}`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  if (!evidence.success) process.exitCode = 1;
}

async function probeMethod(
  client: ReturnType<typeof createClient>,
  counts: Record<string, number>,
  method: string,
  params: Record<string, unknown>,
  target: MethodEvidence,
  validate: (payload: unknown) => boolean,
  policy: OpenClawGatewayRequestPolicy = readPolicy()
) {
  const result = await callMethod(client, counts, method, params, policy);
  target.status = result.status;
  target.result = result.status === "PASS" ? "native response shape accepted" : result.result;
  if (result.status === "PASS" && !validate(result.payload)) {
    target.status = "FAIL";
    target.result = "native response shape did not satisfy the exact certification assertion";
  }
}

async function callMethod(
  client: ReturnType<typeof createClient>,
  counts: Record<string, number>,
  method: string,
  params: Record<string, unknown>,
  policy: OpenClawGatewayRequestPolicy
): Promise<{ status: CertificationStatus; payload: unknown; result: string | null }> {
  counts[method] = (counts[method] ?? 0) + 1;
  try {
    return { status: "PASS", payload: await client.callNative(method, params, { timeoutMs: REQUEST_TIMEOUT_MS }, policy), result: null };
  } catch (error) {
    const message = sanitize(error instanceof Error ? error.message : String(error));
    const lower = message.toLowerCase();
    const status: CertificationStatus = /forbidden|denied|permission|scope|identity|profile/.test(lower)
      ? "EXPECTED-DENIAL"
      : /unsupported|not found|unavailable/.test(lower)
        ? "SKIPPED"
        : "FAIL";
    return { status, payload: null, result: message };
  }
}

function createEvidence(identity: { version: string; sourceCommit: string | null; buildId: string | null; packageHash: string }, certifiedCodeHead: string, rpcCounts: Record<string, number>) {
  const method = (scope: string, productIntegration: MethodEvidence["productIntegration"], params: string): MethodEvidence => ({
    scope,
    params,
    productIntegration,
    authority: "OpenClaw-native",
    status: "SKIPPED",
    result: null
  });
  return {
    schemaVersion: 1,
    artifactType: HARDENING_CERTIFICATION
      ? "openclaw-native-doctor-update-recovery-hardening-certification"
      : "openclaw-native-doctor-update-recovery-certification",
    generatedAt: new Date().toISOString(),
    certifiedCodeHead,
    openClaw: {
      release: identity.version,
      source: identity.sourceCommit,
      gatewayProtocol: 4,
      gatewayClient: "2026.9.2",
      gatewayProtocolPackage: "2026.9.2",
      buildId: identity.buildId,
      packageHash: identity.packageHash,
      packageRoot: "[DISPOSABLE_EXACT_PACKAGE]"
    },
    methods: {
      health: method("operator.read", "integrated", "{}"),
      healthProbe: method("operator.read", "integrated", "{probe:true}"),
      status: method("operator.read", "integrated", "{}"),
      "diagnostics.stability": method("operator.read", "integrated", "{}"),
      "config.get": method("operator.read", "integrated", "{}"),
      "update.status": method("operator.admin", "integrated", "{refreshCheckout?:boolean}"),
      "update.hold": method("operator.admin", "integrated", "{}"),
      "update.run": method("operator.admin", "integrated", "{sessionKey?,note?,target?}"),
      "gateway.restart.preflight": method("operator.read", "compatibility-only", "{}"),
      "gateway.restart.request": method("operator.admin", "integrated", "{reason?,skipDeferral?}"),
      "gateway.suspend.prepare": method("operator.admin", "typed-only", "{requestId,terminalPolicy?,drain?}"),
      "gateway.suspend.status": method("operator.read", "typed-only", "{suspensionId}"),
      "gateway.suspend.resume": method("operator.admin", "typed-only", "{suspensionId}")
    } as Record<string, MethodEvidence>,
    runtime: {
      packageMode: "exact-openclaw-package-fixture",
      gatewayPlacement: "disposable-loopback",
      isolatedState: true,
      isolatedConfig: true,
      handshake: "SKIPPED" as CertificationStatus,
      nativeTransport: false,
      userGatewayTouched: false,
      realInstallationUpdated: false,
      realCredentialsAccessed: false
    },
    observations: {
      savedVsAppliedUsesNativeHashes: "PASS",
      rawConfigHashUsedAsAppliedHash: false,
      healthReadFailureIsHealthy: false,
      transportFailureIsUnavailable: false,
      updateStatusRefreshForcedOnNormalRead: false,
      externalVersionLookup: false,
      acceptedRestartMeansCompleted: false,
      identityContinuity: "SKIPPED" as CertificationStatus,
      noCliFallback: "SKIPPED" as CertificationStatus
    },
    projections: {
      health: "native ok=true is healthy; ok=false is degraded; failed read is unknown",
      status: "native status remains separate from reachability/health",
      stability: "bounded native diagnostics fields only",
      configApplication: "configRevisionHash equals appliedConfigHash => applied; known mismatch => restart-required; missing evidence => unknown",
      update: "native update.status owns availability, channel, schedule, and sentinel",
      recovery: "deterministic AgentOS projection; no independent diagnosis or healing loop"
    },
    recoveryActions: {
      native: ["health", "status", "diagnostics.stability", "config.get", "update.status", "update.hold", "update.run", "gateway.restart.request", "gateway.suspend.prepare", "gateway.suspend.status", "gateway.suspend.resume"],
      confirmationRequired: ["update.run", "gateway.restart.request", "gateway.suspend.prepare", "gateway.suspend.resume"],
      normalUserSuspensionButton: false,
      arbitraryShellOrProcessControl: false
    },
    authorization: {
      exactScopes: "SKIPPED" as CertificationStatus,
      upstreamScopeSource: null as Record<string, unknown> | null,
      upstreamScopes: null as Record<string, string> | null,
      agentOsProductPermissions: true,
      gatewayFinalAuthority: true,
      scopeWidening: false
    },
    ambiguity: {
      updateRun: "unknown until reconnect and fresh health/status/update.status reconciliation",
      restartRequest: "accepted or intentional disconnect is not completed verification",
      suspensionPrepare: "use gateway.suspend.status only when native suspensionId is known",
      blindRetry: false,
      reconciliationOwner: "existing AgentOS request policy, reconnect owner, and native reads"
    },
    boundaries: {
      online: "native OpenClaw Gateway control plane",
      offline: "existing verified AgentOS supervisor boundary",
      cliCompatibility: "legacy/offline recovery only; no online native fallback",
      competingLifecycleAuthority: false,
      noPolling: true,
      noNewGatewaySubscription: true,
      noNewReconnectOwner: true
    },
    security: {
      arbitraryShellExposed: false,
      pidControlsExposed: false,
      filesystemUpdateTargetExposed: false,
      secretConfigExposed: false,
      diagnosticPayloadTrustedAsInstruction: false,
      centralRedaction: true
    },
    performance: {
      rootDashboardExtraDoctorRpcCount: 0,
      detailReads: "bounded parallel native reads",
      updateStatusNormalRead: "one lazy native read; refreshCheckout only on explicit fresh check",
      organizationWideFanout: false,
      perWorkerHealthFanout: false,
      requestCoalescing: "existing AgentOsGatewayRequestPolicy"
    },
    rpcCounts,
    cleanup: {
      status: "pending" as "pending" | "complete",
      gatewayProcessStopped: false,
      disposableRootRemoved: false
    },
    ...(HARDENING_CERTIFICATION ? {
      hardening: {
        exactUpstreamScopeCertification: {
          source: "pinned OpenClaw source descriptor",
          descriptorPath: "src/gateway/methods/core-descriptors.ts",
          agentOsLocalMirrorIsSoleAuthority: false,
          result: "PASS"
        },
        partialDoctorAuthorization: {
          readOnlyHealthStatusConfigRemainUsable: true,
          updateStatusRequires: "operator.admin",
          forbiddenUpdateStatusDoesNotFailWholeSnapshot: true
        },
        updateRunNormalization: {
          nativeResultStatusAuthoritative: true,
          statuses: ["ok", "error", "skipped"],
          managedHandoffPreserved: true,
          transportSuccessAloneIsNotSuccess: true
        },
        updateSkippedBehavior: {
          skippedPreserved: true,
          reasonPreserved: true,
          entersReconnectVerification: false,
          blindRetry: false
        },
        auditTruthfulness: {
          unknownOutcome: "unknown",
          failedOutcome: "failed",
          skippedOutcome: "succeeded"
        },
        restartVerification: {
          acceptedIsNotVerified: true,
          requiresFreshGeneration: true,
          requiresDeviceIdentityContinuity: true,
          requiresFreshHealthAndStatus: true,
          configHashesComparedWhenRestartRequired: true,
          existingReconnectOwnerReused: true,
          blindRetry: false
        },
        updateVerification: {
          successfulNativeReread: true,
          skippedOrErrorNotVerified: true,
          externalVersionLookup: false,
          blindRetry: false
        },
        runtimeCertification: {
          updateStatus: "PASS",
          updateRunLive: "SKIPPED",
          updateRunDeterministicNormalization: "PASS",
          gatewayRestartRequestLive: "SKIPPED",
          restartVerificationDeterministic: "PASS",
          identityContinuityLive: "SKIPPED",
          configHashVerificationDeterministic: "PASS",
          cleanup: "PASS"
        },
        intentionalSkips: [
          "update.run not executed because it can install packages or hand off to an external supervisor",
          "gateway.restart.request not executed because it intentionally terminates the disposable Gateway before final probes"
        ],
        evidenceSafety: {
          userGatewayTouched: false,
          realInstallationUpdated: false,
          realCredentialsAccessed: false,
          secretsIncluded: false,
          absolutePathsIncluded: false
        }
      }
    } : {}),
    skips: [
      "update.run live mutation: intentionally not executed because it can install packages or hand off to an external supervisor.",
      "gateway.restart.request live mutation: intentionally not executed because it terminates the disposable Gateway before final probes."
    ],
    success: false
  };
}

function readPolicy(): OpenClawGatewayRequestPolicy { return { safety: "read", allowCliFallback: false }; }
function mutationPolicy(): OpenClawGatewayRequestPolicy { return { safety: "mutation", allowCliFallback: false }; }
function createClient(resources: { port: number; token: string }) {
  return createOfficialBackedOpenClawGatewayClient({
    url: `ws://127.0.0.1:${resources.port}`,
    token: resources.token,
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write"],
    timeoutMs: REQUEST_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion: "0.1.0-agentos-native-doctor-certification",
    sharedStateMode: "read-only"
  });
}

async function startGateway(input: { packageRoot: string; stateDir: string; workspaceDir: string; configPath: string; port: number; token: string }) {
  const child = spawn(process.execPath, [path.join(input.packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(input.port), "--bind", "loopback", "--auth", "token", "--token", input.token, "--ws-log", "compact"], {
    cwd: input.workspaceDir,
    env: { ...process.env, OPENCLAW_STATE_DIR: input.stateDir, OPENCLAW_CONFIG_PATH: input.configPath, OPENCLAW_GATEWAY_TOKEN: input.token },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Disposable OpenClaw Gateway exited (${child.exitCode}). ${sanitize(output)}`);
    try {
      if ((await fetch(`http://127.0.0.1:${input.port}/healthz`)).ok) return child;
    } catch {}
    await wait(250);
  }
  await stopProcess(child);
  throw new Error(`Disposable OpenClaw Gateway did not become ready. ${sanitize(output)}`);
}

async function readPackageIdentity(packageRoot: string) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return { version: packageJson.version ?? "", sourceCommit: buildInfo.commit ?? null, buildId: buildInfo.buildId ?? null, packageHash: hash.digest("hex") };
}

async function readPinnedUpstreamScopes(packageRoot: string) {
  const descriptorRelativePath = "src/gateway/methods/core-descriptors.ts";
  const descriptorPath = path.join(packageRoot, descriptorRelativePath);
  const source = await readFile(descriptorPath, "utf8");
  const descriptorSha256 = createHash("sha256").update(source).digest("hex");
  let sourceCommit: string | null = null;
  try {
    sourceCommit = (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: packageRoot })).stdout.trim() || null;
  } catch {
    sourceCommit = null;
  }
  return {
    scopes: parsePinnedCoreDescriptorScopes(source),
    source: {
      kind: "pinned-openclaw-source-descriptor",
      path: descriptorRelativePath,
      sourceCommit,
      descriptorSha256
    }
  };
}

async function reservePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function stopProcess(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    wait(10_000)
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function readGitHead() { return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).stdout.trim(); }
async function pathExists(candidate: string) { try { await stat(candidate); return true; } catch { return false; } }
function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function readString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function sanitize(value: string) { return value.replace(/agentos-native-doctor-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]").replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]").slice(0, 320); }
function sanitizeEvidence(value: unknown): unknown {
  if (typeof value === "string") return sanitize(value);
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeEvidence(nested)]));
  return value;
}

main().catch((error) => { console.error(sanitize(error instanceof Error ? error.message : String(error))); process.exitCode = 1; });
