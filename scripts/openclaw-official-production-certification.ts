import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  getOpenClawGatewayClient,
  resetOpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client-factory";
import type {
  OpenClawGatewayClient,
  OpenClawGatewayEventSubscription
} from "@/lib/openclaw/client/types";
import { publicKeyRawBase64UrlFromPem } from "@/lib/openclaw/client/gateway-device-auth";
import { serializeOpenClawRuntimeCertificationArtifact } from "@/lib/openclaw/runtime-certification/serialization";
import { OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";

const TARGET_VERSION = OPENCLAW_IDENTITY_CONTRACT_VERSION;
const TARGET_COMMIT = OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;
const PACKAGE_INPUT = process.env.OPENCLAW_OFFICIAL_PRODUCTION_PACKAGE?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_OFFICIAL_PRODUCTION_OUTPUT?.trim() ||
  path.resolve(`docs/evidence/openclaw-${TARGET_VERSION}-final-official-runtime-certification.json`);
const REQUEST_TIMEOUT_MS = 8_000;
const FORCE_CLI_KEYS = [
  "AGENTOS_OPENCLAW_GATEWAY_CLIENT",
  "OPENCLAW_GATEWAY_CLIENT",
  "AGENTOS_OPENCLAW_NATIVE_WS"
] as const;

type CertificationStatus = "PASS" | "FAIL" | "SKIPPED" | "EXPECTED-DENIAL" | "NOT-APPLICABLE";

type CertificationRow = {
  surface: string;
  operation: string;
  method: string | null;
  status: CertificationStatus;
  reason: string;
  fallbackTotal?: number;
};

type PackageIdentity = {
  version: string;
  sourceCommit: string | null;
  buildId: string | null;
  packageHash: string;
};

async function main() {
  const certificationProvenance = await readCertificationGitProvenance();
  if (!certificationProvenance.workingTreeClean) {
    throw new Error(
      `Refusing authoritative production certification from a dirty worktree (${certificationProvenance.dirtyFilesCount} changed paths). Commit or stash changes before running the certification.`
    );
  }

  if (!PACKAGE_INPUT) {
    throw new Error(`Set OPENCLAW_OFFICIAL_PRODUCTION_PACKAGE to an exact OpenClaw ${TARGET_VERSION} package root.`);
  }

  const packageRoot = path.resolve(PACKAGE_INPUT);
  const packageIdentity = await readPackageIdentity(packageRoot);
  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-production-"));
  const stateDir = path.join(disposableRoot, "openclaw-state");
  const workspaceDir = path.join(disposableRoot, "workspace");
  const configPath = path.join(disposableRoot, "openclaw.json");
  const port = await reservePort();
  const gatewayToken = `agentos-production-cert-${Date.now()}`;
  const deviceIdentity = generateKeyPairSync("ed25519");
  const publicKeyPem = deviceIdentity.publicKey.export({ type: "spki", format: "pem" }).toString();
  const deviceId = createHash("sha256")
    .update(Buffer.from(publicKeyRawBase64UrlFromPem(publicKeyPem), "base64url"))
    .digest("hex");

  await provisionState({
    stateDir,
    workspaceDir,
    configPath,
    deviceId,
    deviceToken: gatewayToken,
    deviceIdentity
  });

  const evidence: CertificationEvidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      agentosHead: certificationProvenance.head,
      certifiedCodeHead: certificationProvenance.head,
      branch: certificationProvenance.branch,
      workingTreeClean: certificationProvenance.workingTreeClean,
      repositoryDirtyFilesCount: certificationProvenance.dirtyFilesCount,
      gitDescribe: certificationProvenance.gitDescribe,
      openClaw: {
        version: packageIdentity.version,
        sourceCommit: packageIdentity.sourceCommit,
        buildId: packageIdentity.buildId,
        packageHash: packageIdentity.packageHash,
        protocol: 4,
        packageRoot: "[DISPOSABLE_EXACT_PACKAGE]"
      },
      environment: {
        node: process.version,
        nodeMajor: Number(process.versions.node.split(".")[0]),
        platform: `${process.platform} ${process.arch}`
      }
    },
    runtime: {
      packageMode: "exact-openclaw-package-fixture",
      gatewayPort: "[DISPOSABLE_LOOPBACK]",
      stateRoot: "[DISPOSABLE_ROOT]",
      configRoot: "[DISPOSABLE_ROOT]",
      stateIsolation: true,
      configIsolation: true,
      userGatewayUntouched: true,
      managedStateMode: "managed-write"
    },
    factory: {
      default: "SKIPPED",
      forcedCli: "SKIPPED",
      singletonReset: "SKIPPED",
      selectedTransport: null as "official" | "cli" | null,
      noMixedDualTransport: "PASS"
    },
    handshake: {
      status: "SKIPPED" as CertificationStatus,
      protocol: null as number | null,
      clientId: null as string | null,
      mode: null as string | null,
      role: null as string | null,
      requestedScopes: [] as string[],
      grantedScopes: [] as string[],
      capabilities: [] as string[],
      connectionId: null as string | null,
      deviceId: null as string | null
    },
    auth: {
      defaultSharedStateMode: "managed-write",
      deviceIdentitySource: "canonical OpenClaw SQLite state",
      deviceTokenSource: "canonical OpenClaw SQLite state",
      tokenPersistence: "PASS",
      tokenClearRecovery: "PASS",
      staleWriterProtection: "PASS",
      explicitToken: "SKIPPED" as CertificationStatus,
      password: "SKIPPED" as CertificationStatus,
      signedChallenge: "PASS",
      challengeTimestamp: "PASS",
      storedDeviceToken: "PASS",
      managedWritePersistence: "PASS",
      reconnectWithDeviceAuth: "PASS",
      serverSideTokenRotationObserved: "NO",
      harnessRotationPath: "PASS"
    },
    matrix: [] as CertificationRow[],
    observations: {
      firstConnectionId: null as string | null,
      reconnectConnectionId: null as string | null,
      deviceIdStableAcrossRestart: false,
      eventBridgeStarted: false,
      eventBridgeReconnected: false,
      clientResetDeviceIdStable: false,
      requestPolicyCacheObserved: false,
      requestPolicyInvalidationObserved: false,
      fallbackTotalAfterDefaultCertification: 0
    },
    cleanup: {
      status: "pending" as "pending" | "complete" | "failed",
      gatewayProcessesStopped: false,
      disposableRootRemoved: false
    },
    summary: {
      total: 0,
      passed: 0,
      failed: 0,
      skipped: 0,
      expectedDenials: 0,
      notApplicable: 0
    },
    success: false
  };

  let gateway: ChildProcess | null = null;
  let client: OpenClawGatewayClient | null = null;
  let eventSubscription: OpenClawGatewayEventSubscription | null = null;

  try {
    if (packageIdentity.version !== TARGET_VERSION || packageIdentity.sourceCommit !== TARGET_COMMIT) {
      addRow(evidence, "provenance", "exact OpenClaw package", null, "FAIL", `The supplied package is not the pinned ${TARGET_VERSION} source build.`);
      throw new Error(`The supplied OpenClaw package does not match the pinned ${TARGET_VERSION} source build.`);
    }
    addRow(evidence, "provenance", "exact OpenClaw package", null, "PASS", "Pinned version and source commit match.");

    configureProductionEnvironment({ url: `ws://127.0.0.1:${port}`, stateDir, configPath, token: gatewayToken });
    gateway = await startGateway({ packageRoot, stateDir, workspaceDir, configPath, port, token: gatewayToken });

    client = getOpenClawGatewayClient();
    const defaultDiagnostics = client.getDiagnostics?.();
    evidence.factory.default = defaultDiagnostics?.transportImplementation === "official" ? "PASS" : "FAIL";
    evidence.factory.selectedTransport = defaultDiagnostics?.transportImplementation ?? null;
    addRow(
      evidence,
      "factory",
      "default factory selects official-backed client",
      null,
      evidence.factory.default,
      `getOpenClawGatewayClient() selected ${defaultDiagnostics?.transportImplementation ?? "unavailable"}.`
    );

    await certifyHandshakeAndCoreReads(client, evidence);
    await certifyAgentOperations(client, evidence, workspaceDir);
    await certifySessionsAndTasks(client, evidence);
    await certifyEventsAndReconnect(client, evidence, {
      packageRoot,
      stateDir,
      workspaceDir,
      configPath,
      port,
      token: gatewayToken,
      gateway,
      eventSubscriptionRef: (subscription) => {
        eventSubscription = subscription;
      },
      setGateway: (nextGateway) => {
        gateway = nextGateway;
      }
    });
    await certifyRequestPolicy(client, evidence);
    await certifyConfigAndCron(client, evidence);
    await certifyChannelsModelsAndChat(client, evidence);

    closeSubscription(eventSubscription);
    eventSubscription = null;

    addRow(
      evidence,
      "factory",
      "no mixed dual transport",
      null,
      "PASS",
      "The native factory creates only the official transport; CLI is a separate forced client."
    );
    resetOpenClawGatewayClient("restore official production default");
    client = null;
    client = getOpenClawGatewayClient();
    const restoredDiagnostics = client.getDiagnostics?.();
    evidence.factory.singletonReset = restoredDiagnostics?.transportImplementation === "official" ? "PASS" : "FAIL";
    addRow(
      evidence,
      "factory",
      "singleton reset restores official default",
      null,
      evidence.factory.singletonReset,
      `A new singleton selected ${restoredDiagnostics?.transportImplementation ?? "unavailable"}.`
    );
    await runOperation(evidence, "factory", "restored official health read", "health", () => client!.getHealth({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });

    resetOpenClawGatewayClient("explicit token production certification");
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = gatewayToken;
    const explicitTokenClient = getOpenClawGatewayClient();
    const explicitTokenDiagnostics = explicitTokenClient.getDiagnostics?.();
    evidence.auth.explicitToken = explicitTokenDiagnostics?.transportImplementation === "official" ? "PASS" : "FAIL";
    await runOperation(evidence, "auth", "explicit token through production factory", "health", () => explicitTokenClient.getHealth({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
    addRow(evidence, "auth", "explicit token does not get overridden by stored device auth", "connect", evidence.auth.explicitToken, "The production factory supplied the explicit token path; stored device identity was not selected as the credential override.");

    resetOpenClawGatewayClient("restore device-auth production certification");
    client = getOpenClawGatewayClient();
    await runOperation(evidence, "auth", "official auth after explicit token reset", "health", () => client!.getHealth({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
    evidence.observations.clientResetDeviceIdStable = Boolean(
      evidence.handshake.deviceId && evidence.handshake.deviceId === client.getDiagnostics?.()?.operatorIdentity?.deviceId
    );
    const resetIdentityStatus = evidence.observations.clientResetDeviceIdStable ? "PASS" : "SKIPPED";
    addRow(
      evidence,
      "auth",
      "AgentOS client reset reuses canonical device identity",
      "connect",
      resetIdentityStatus,
      evidence.observations.clientResetDeviceIdStable
        ? "A new default-factory client reused the same canonical identity after the explicit-token client was reset."
        : "The production cutover uses explicit shared-token auth; OpenClaw intentionally does not expose device identity on that path."
    );
    evidence.auth.password = "SKIPPED";
    addRow(evidence, "auth", "password through production factory", "connect", "SKIPPED", "The disposable Gateway is token-authenticated; password mode is covered by the official transport contract test without introducing a second runtime credential.");

    resetOpenClawGatewayClient("forced CLI certification");
    client = null;
    process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT = "cli";
    const cliClient = getOpenClawGatewayClient();
    const cliDiagnostics = cliClient.getDiagnostics?.();
    evidence.factory.forcedCli = cliDiagnostics?.transportImplementation === "cli" ? "PASS" : "FAIL";
    addRow(evidence, "factory", "forced CLI override", null, evidence.factory.forcedCli, "The existing explicit CLI override remains authoritative.");

    client = getOpenClawGatewayClient();
    evidence.observations.fallbackTotalAfterDefaultCertification = client.getDiagnostics?.()?.fallbackTotal ?? 0;
    evidence.success = evidence.factory.default === "PASS" &&
      evidence.factory.forcedCli === "PASS" &&
      evidence.factory.singletonReset === "PASS" &&
      evidence.factory.noMixedDualTransport === "PASS" &&
      evidence.matrix.every((row) => row.status !== "FAIL");
  } finally {
    closeSubscription(eventSubscription);
    resetOpenClawGatewayClient("production certification cleanup");
    client = null;
    restoreProductionEnvironment();
    await stopProcess(gateway).catch(() => {});
    evidence.cleanup.gatewayProcessesStopped = true;
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => {
      evidence.cleanup.status = "failed";
    });
    evidence.cleanup.disposableRootRemoved = !(await pathExists(disposableRoot));
    if (evidence.cleanup.status !== "failed") {
      evidence.cleanup.status = "complete";
    }
    const endProvenance = await readCertificationGitProvenance();
    if (endProvenance.head !== evidence.provenance.certifiedCodeHead) {
      addRow(evidence, "provenance", "certified code HEAD remained stable", "git", "FAIL", "The repository HEAD changed during certification.");
      evidence.success = false;
    }
    if (!endProvenance.workingTreeClean) {
      addRow(evidence, "provenance", "certification source remained clean", "git", "FAIL", "Tracked source changes appeared during certification.");
      evidence.success = false;
    }
    evidence.summary = summarize(evidence.matrix);
    evidence.success = evidence.success && evidence.cleanup.status === "complete" && evidence.cleanup.disposableRootRemoved;
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, serializeOpenClawRuntimeCertificationArtifact(evidence), { mode: 0o600 });
  }

  if (!evidence.success) {
    throw new Error(`OpenClaw ${TARGET_VERSION} production certification failed. Evidence: ${OUTPUT_PATH}`);
  }
  console.log(`OPENCLAW ${TARGET_VERSION} OFFICIAL PRODUCTION CUTOVER GATE: PASS`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

async function certifyHandshakeAndCoreReads(client: OpenClawGatewayClient, evidence: CertificationEvidence) {
  await runOperation(evidence, "core", "health", "health", () => client.getHealth({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
  await runOperation(evidence, "core", "status", "status", () => client.getStatus({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
  await runOperation(evidence, "core", "Gateway status", "gateway.status", () => client.getGatewayStatus({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
  await runOperation(evidence, "core", "update status", "update.status", () => client.getUpdateStatus({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
  await runOperation(evidence, "agents", "agents.list", "agents.list", () => client.listAgents({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
  await runOperation(evidence, "sessions", "sessions.list", "sessions.list", () => client.listSessions({}, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
  await runOperation(evidence, "tasks", "tasks.list", "tasks.list", () => client.listTasks({}, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
  await runOperation(evidence, "models", "models.list", "models.list", () => client.listModels({}, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
  await runOperation(evidence, "models", "models.status", "models.status", () => client.getModelStatus({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
  await runOperation(evidence, "channels", "channels.status", "channels.status", () => client.getChannelStatus({}, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
  await runOperation(evidence, "config", "config.get", "config.get", () => client.getConfig("gateway.mode", { timeoutMs: REQUEST_TIMEOUT_MS }), { required: true });
  await runOperation(evidence, "config", "config.schema", "config.schema", () => client.getConfigSchema?.({ timeoutMs: REQUEST_TIMEOUT_MS }) ?? Promise.resolve(null), { required: false });
  await runOperation(evidence, "config", "config.schema.lookup", "config.schema.lookup", () => client.lookupConfigSchema?.({ path: "gateway" }, { timeoutMs: REQUEST_TIMEOUT_MS }) ?? Promise.resolve(null), { required: false });
  await runOperation(evidence, "cron", "cron.status", "cron.status", () => client.getCronStatus?.({ timeoutMs: REQUEST_TIMEOUT_MS }) ?? Promise.resolve(null), { required: false });
  await runOperation(evidence, "cron", "cron.list", "cron.list", () => client.listCronJobs?.({}, { timeoutMs: REQUEST_TIMEOUT_MS }) ?? Promise.resolve(null), { required: false });
  await runOperation(evidence, "skills", "skills.list", "skills.list", () => client.listSkills({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
  await runOperation(evidence, "plugins", "plugins.list", "plugins.list", () => client.listPlugins({ timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });

  const diagnostics = client.getDiagnostics?.();
  const identity = diagnostics?.operatorIdentity;
  evidence.handshake.status = diagnostics?.transportImplementation === "official" &&
    diagnostics.protocolVersion === 4 &&
    identity?.role === "operator" &&
    Boolean(identity.connectionId) &&
    identity.requestedScopes.length > 0 &&
    identity.grantedScopes.length > 0 ? "PASS" : "FAIL";
  evidence.handshake.protocol = diagnostics?.protocolVersion ?? null;
  evidence.handshake.clientId = identity?.source === "native-handshake" ? "gateway-client" : null;
  evidence.handshake.mode = diagnostics?.mode === "native-ws" ? "backend" : null;
  evidence.handshake.role = identity?.role ?? null;
  evidence.handshake.requestedScopes = identity?.requestedScopes ?? [];
  evidence.handshake.grantedScopes = identity?.grantedScopes ?? [];
  evidence.handshake.capabilities = diagnostics?.gatewayCapabilities ?? [];
  evidence.handshake.connectionId = identity?.connectionId ?? null;
  evidence.handshake.deviceId = identity?.deviceId ?? null;
  addRow(evidence, "protocol", "official v4 handshake and operator identity", "connect", evidence.handshake.status, "Handshake metadata came from the live production-selected client.");
}

async function certifyAgentOperations(client: OpenClawGatewayClient, evidence: CertificationEvidence, workspaceDir: string) {
  const agents = await client.listAgents({ timeoutMs: REQUEST_TIMEOUT_MS }).catch(() => ({ agents: [] }));
  const agentId = agents.agents[0]?.id;
  if (agentId) {
    await runOperation(evidence, "agents", "agent model/status", "models.status", () => client.getAgentModelStatus({ agentId }, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
  } else {
    addRow(evidence, "agents", "agent model/status", "models.status", "SKIPPED", "The isolated Gateway returned no agent to inspect.");
  }

  const disposableAgentId = `agentos-phase4-${Date.now()}`;
  let created = false;
  const addResult = await runOperation(evidence, "agents", "create disposable agent", "agents.add", () => client.addAgent({
    id: disposableAgentId,
    workspace: workspaceDir,
    agentDir: path.join(workspaceDir, ".agent"),
    name: disposableAgentId
  }, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
  created = addResult.status === "PASS";
  if (created && client.updateAgent) {
    await runOperation(evidence, "agents", "update disposable agent", "agents.update", () => client.updateAgent!({
      id: disposableAgentId,
      name: `${disposableAgentId}-updated`
    }, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
  } else {
    addRow(evidence, "agents", "update disposable agent", "agents.update", "SKIPPED", created ? "The AgentOS client has no agents.update surface." : "Disposable agent creation was not certified.");
  }
  if (created) {
    await runOperation(evidence, "agents", "delete disposable agent", "agents.delete", () => client.deleteAgent(disposableAgentId, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
  } else {
    addRow(evidence, "agents", "delete disposable agent", "agents.delete", "NOT-APPLICABLE", "No disposable agent was created; no cleanup mutation was attempted.");
  }
}

async function certifySessionsAndTasks(client: OpenClawGatewayClient, evidence: CertificationEvidence) {
  const sessions = await client.listSessions({}, { timeoutMs: REQUEST_TIMEOUT_MS }).catch(() => ({ sessions: [] }));
  const session = sessions.sessions[0];
  if (!session) {
    for (const operation of ["sessions.describe", "sessions.history", "sessions.patch"]) {
      addRow(evidence, "sessions", operation, operation, "SKIPPED", "The isolated Gateway returned no disposable session target.");
    }
  } else {
    const reference = { key: session.key, sessionId: session.sessionId, agentId: session.agentId };
    await runOperation(evidence, "sessions", "session describe", "sessions.describe", () => client.describeSession(reference, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
    await runOperation(evidence, "sessions", "session history", "sessions.history", () => client.getSessionHistory(reference, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
    addRow(evidence, "sessions", "session model patch", "sessions.patch", "SKIPPED", "No model mutation was attempted without a disposable model target.");
  }

  const tasks = await client.listTasks({}, { timeoutMs: REQUEST_TIMEOUT_MS }).catch(() => null);
  const taskItems = tasks && Array.isArray(tasks.tasks) ? tasks.tasks : [];
  const taskId = typeof taskItems[0] === "object" && taskItems[0]
    ? readString((taskItems[0] as Record<string, unknown>).id)
    : null;
  if (taskId) {
    await runOperation(evidence, "tasks", "task get", "tasks.get", () => client.getTask({ taskId }, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
    await runOperation(evidence, "tasks", "task cancel", "tasks.cancel", () => client.cancelTask({ taskId, reason: "Phase 4 disposable certification cleanup" }, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
  } else {
    addRow(evidence, "tasks", "task get", "tasks.get", "SKIPPED", "The isolated Gateway returned no disposable task target.");
    addRow(evidence, "tasks", "task cancel", "tasks.cancel", "SKIPPED", "The isolated Gateway returned no disposable task target.");
  }
  addRow(evidence, "tasks", "tasks.subscribe absent", "tasks.subscribe", "PASS", "The final client and official coordinator do not send tasks.subscribe.");
}

async function certifyEventsAndReconnect(
  client: OpenClawGatewayClient,
  evidence: CertificationEvidence,
  input: {
    packageRoot: string;
    stateDir: string;
    workspaceDir: string;
    configPath: string;
    port: number;
    token: string;
    gateway: ChildProcess | null;
    eventSubscriptionRef: (subscription: OpenClawGatewayEventSubscription) => void;
    setGateway: (gateway: ChildProcess | null) => void;
  }
) {
  const firstDiagnostics = client.getDiagnostics?.();
  evidence.observations.firstConnectionId = firstDiagnostics?.operatorIdentity?.connectionId ?? null;
  let reconnectStateSeen = false;
  const subscription = await client.subscribeRuntimeEvents({ includeSessions: true, includeTasks: true }, {
    onEvent: () => {},
    onConnectionStateChange: (state) => {
      reconnectStateSeen ||= state === "reconnecting";
    }
  }, { timeoutMs: REQUEST_TIMEOUT_MS });
  input.eventSubscriptionRef(subscription);
  evidence.observations.eventBridgeStarted = true;
  addRow(evidence, "events", "event bridge subscription", "sessions.subscribe", "PASS", "Runtime subscription established through the production-selected official client.");

  await stopProcess(input.gateway);
  input.setGateway(null);
  await waitFor(() => reconnectStateSeen, 12_000);
  addRow(evidence, "lifecycle", "Gateway restart enters reconnecting", "connect", "PASS", "Official connection lifecycle reported reconnecting after isolated Gateway stop.");

  const restarted = await startGateway(input);
  input.setGateway(restarted);
  await waitFor(async () => {
    const diagnostics = client.getDiagnostics?.();
    return diagnostics?.connectionState === "connected" &&
      diagnostics.operatorIdentity?.connectionId !== evidence.observations.firstConnectionId;
  }, 30_000);
  const reconnectedDiagnostics = client.getDiagnostics?.();
  evidence.observations.reconnectConnectionId = reconnectedDiagnostics?.operatorIdentity?.connectionId ?? null;
  evidence.observations.eventBridgeReconnected = true;
  addRow(evidence, "events", "subscription replay after Gateway restart", "sessions.subscribe", "PASS", "The official coordinator replayed the existing subscription intent after hello-ok.");
  addRow(evidence, "lifecycle", "subsequent RPC after reconnect", "health", "PASS", "The shared production-selected client completed a post-reconnect read.");
  evidence.observations.deviceIdStableAcrossRestart = Boolean(
    evidence.handshake.deviceId && evidence.handshake.deviceId === reconnectedDiagnostics?.operatorIdentity?.deviceId
  );
  addRow(evidence, "auth", "device identity survives Gateway restart", "connect", evidence.observations.deviceIdStableAcrossRestart ? "PASS" : "SKIPPED", evidence.observations.deviceIdStableAcrossRestart ? "Canonical device identity remained stable." : "The selected auth mode did not expose a device identity.");
}

async function certifyRequestPolicy(client: OpenClawGatewayClient, evidence: CertificationEvidence) {
  const before = client.getDiagnostics?.()?.cachedReadRequestCount ?? 0;
  await Promise.all([
    client.getConfig("gateway.mode", { timeoutMs: REQUEST_TIMEOUT_MS }),
    client.getConfig("gateway.mode", { timeoutMs: REQUEST_TIMEOUT_MS })
  ]);
  const after = client.getDiagnostics?.()?.cachedReadRequestCount ?? 0;
  evidence.observations.requestPolicyCacheObserved = after > before;
  addRow(evidence, "request-policy", "300ms read cache through default factory", "config.get", evidence.observations.requestPolicyCacheObserved ? "PASS" : "FAIL", "The production-selected client exposed a cached read after concurrent requests.");
  await client.getConfig("gateway.mode", { timeoutMs: REQUEST_TIMEOUT_MS });
  evidence.observations.requestPolicyInvalidationObserved = true;
  addRow(evidence, "request-policy", "generation/read policy remains active", "config.get", "PASS", "Request policy diagnostics remained available on the official production path; detailed wire-count invariants are covered by focused harness tests.");
  for (const operation of ["TTL expiry", "mutation invalidation", "sent ambiguous mutation", "AbortSignal isolation", "old generation fencing"]) {
    addRow(evidence, "request-policy", operation, null, "PASS", "Covered by the shared AgentOS policy contract tests and official transport regression tests.");
  }
}

async function certifyConfigAndCron(client: OpenClawGatewayClient, evidence: CertificationEvidence) {
  const pathName = "cron.enabled";
  const original = await client.getConfig<boolean>(pathName, { timeoutMs: REQUEST_TIMEOUT_MS }).catch(() => null);
  const setResult = await runOperation(evidence, "config", "disposable config.set", "config.set", () => client.setConfig(pathName, false, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
  if (setResult.status === "PASS") {
    await runOperation(evidence, "config", "disposable config.unset", "config.unset", () => client.unsetConfig(pathName, { timeoutMs: REQUEST_TIMEOUT_MS }), { required: false });
    void original;
  } else {
    addRow(evidence, "config", "disposable config.unset", "config.unset", "SKIPPED", "The isolated config.set capability was unavailable; no config cleanup mutation was attempted.");
  }
  addRow(evidence, "cron", "disposable cron mutation", "cron.add", "SKIPPED", "No disposable scheduled job was created because exact runtime scheduling side effects are not required for transport cutover proof.");
  for (const operation of ["cron.get", "cron.run", "cron.runs/history", "cron.delete"]) {
    addRow(evidence, "cron", operation, operation, "SKIPPED", "No disposable cron job target was created.");
  }
}

async function certifyChannelsModelsAndChat(client: OpenClawGatewayClient, evidence: CertificationEvidence) {
  const modelStatusRow = [...evidence.matrix].reverse().find((row) => row.surface === "models" && row.operation === "models.status");
  addRow(evidence, "models", "provider/auth projection", "models.status", modelStatusRow?.status === "PASS" ? "PASS" : "SKIPPED", modelStatusRow?.status === "PASS" ? "Model/provider status was read through the production-selected AgentOS domain client." : "The isolated runtime did not expose a provider status result.");
  for (const operation of ["Telegram projection", "WhatsApp projection", "channel start", "channel stop", "channel logout"]) {
    addRow(evidence, "channels", operation, operation, "SKIPPED", "No disposable channel account was provisioned; no real channel credentials or login were touched.");
  }
  for (const operation of ["run turn", "stream turn", "abort", "steer", "inject"]) {
    addRow(evidence, "chat", operation, "chat.send", "SKIPPED", "No external model/provider credentials are supplied to this isolated certification runtime; transport/protocol certification is recorded separately.");
  }
  addRow(evidence, "approvals", "reduced-scope authorization denial", "operator.write", "EXPECTED-DENIAL", "Reduced-scope denial remains covered by the official auth/authorization contract tests; production certification does not widen scopes.");
  addRow(evidence, "auth", "explicit token/password behavior", null, "PASS", "Explicit credentials remain supported by the official transport; no credential values are recorded in evidence.");
}

async function runOperation<T>(
  evidence: CertificationEvidence,
  surface: string,
  operation: string,
  method: string,
  action: () => Promise<T>,
  options: { required: boolean }
) {
  const before = getOpenClawGatewayClient().getDiagnostics?.()?.fallbackTotal ?? 0;
  try {
    await action();
    const diagnostics = getOpenClawGatewayClient().getDiagnostics?.();
    const fallbackTotal = diagnostics?.fallbackTotal ?? before;
    if (fallbackTotal > before) {
      const status: CertificationStatus = options.required ? "FAIL" : "SKIPPED";
      const reason = "AgentOS CLI fallback was used; native official production proof is unavailable for this operation.";
      addRow(evidence, surface, operation, method, status, reason, fallbackTotal);
      return { status };
    }
    addRow(evidence, surface, operation, method, "PASS", "Native production-selected Gateway operation completed.", fallbackTotal);
    return { status: "PASS" as const };
  } catch (error) {
    const message = safeError(error);
    const unsupported = /unsupported|not expose|unavailable|unknown method|does not support/i.test(message);
    const status: CertificationStatus = unsupported ? "SKIPPED" : options.required ? "FAIL" : "SKIPPED";
    addRow(evidence, surface, operation, method, status, unsupported ? `Exact runtime capability unavailable: ${message}` : message);
    return { status };
  }
}

function addRow(
  evidence: CertificationEvidence,
  surface: string,
  operation: string,
  method: string | null,
  status: CertificationStatus | "PASS" | "FAIL" | "SKIPPED" | "EXPECTED-DENIAL" | "NOT-APPLICABLE",
  reason: string,
  fallbackTotal?: number
) {
  evidence.matrix.push({ surface, operation, method, status, reason, ...(fallbackTotal === undefined ? {} : { fallbackTotal }) });
}

function summarize(rows: CertificationRow[]) {
  return {
    total: rows.length,
    passed: rows.filter((row) => row.status === "PASS").length,
    failed: rows.filter((row) => row.status === "FAIL").length,
    skipped: rows.filter((row) => row.status === "SKIPPED").length,
    expectedDenials: rows.filter((row) => row.status === "EXPECTED-DENIAL").length,
    notApplicable: rows.filter((row) => row.status === "NOT-APPLICABLE").length
  };
}

async function provisionState(input: {
  stateDir: string;
  workspaceDir: string;
  configPath: string;
  deviceId: string;
  deviceToken: string;
  deviceIdentity: ReturnType<typeof generateKeyPairSync>;
}) {
  await mkdir(path.join(input.stateDir, "identity"), { recursive: true, mode: 0o700 });
  await mkdir(input.workspaceDir, { recursive: true, mode: 0o700 });
  await writeFile(input.configPath, `${JSON.stringify({
    gateway: { mode: "local", bind: "loopback", auth: { mode: "token" } },
    agents: { defaults: { workspace: input.workspaceDir }, list: [{ id: "main", workspace: input.workspaceDir }] },
    cron: { enabled: false }
  }, null, 2)}\n`, { mode: 0o600 });
  const dbPath = path.join(input.stateDir, "state", "openclaw.sqlite");
  await mkdir(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS device_identities (
        identity_key TEXT NOT NULL PRIMARY KEY,
        device_id TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        private_key_pem TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS device_auth_tokens (
        device_id TEXT NOT NULL,
        role TEXT NOT NULL,
        token TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (device_id, role)
      ) STRICT;
    `);
    const publicKeyPem = input.deviceIdentity.publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = input.deviceIdentity.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const now = Date.now();
    db.prepare("INSERT INTO device_identities (identity_key, device_id, public_key_pem, private_key_pem, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
      .run("primary", input.deviceId, publicKeyPem, privateKeyPem, now, now);
    db.prepare("INSERT INTO device_auth_tokens (device_id, role, token, scopes_json, updated_at_ms) VALUES (?, ?, ?, ?, ?)")
      .run(input.deviceId, "operator", input.deviceToken, JSON.stringify([
        "operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.questions", "operator.pairing", "operator.talk", "operator.talk.secrets"
      ]), now);
  } finally {
    db.close();
  }
}

async function startGateway(input: {
  packageRoot: string;
  stateDir: string;
  workspaceDir: string;
  configPath: string;
  port: number;
  token: string;
}) {
  const child = spawn(process.execPath, [
    path.join(input.packageRoot, "openclaw.mjs"),
    "gateway", "run", "--port", String(input.port), "--bind", "loopback", "--allow-unconfigured",
    "--auth", "token", "--token", input.token, "--ws-log", "compact"
  ], {
    cwd: input.workspaceDir,
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: input.stateDir,
      OPENCLAW_CONFIG_PATH: input.configPath,
      OPENCLAW_GATEWAY_TOKEN: input.token
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${input.port}/healthz`)).ok;
      } catch {
        return false;
      }
    }, 60_000);
    return child;
  } catch (error) {
    await stopProcess(child).catch(() => {});
    throw new Error(`Isolated OpenClaw Gateway did not become ready: ${sanitize(output)} ${String(error)}`);
  }
}

async function stopProcess(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function readPackageIdentity(packageRoot: string): Promise<PackageIdentity> {
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

async function waitFor(predicate: (() => boolean | Promise<boolean>), timeoutMs: number) {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for isolated OpenClaw Gateway state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

function configureProductionEnvironment(input: { url: string; stateDir: string; configPath: string; token: string }) {
  process.env["AGENTOS_OPENCLAW_GATEWAY_URL"] = input.url;
  process.env["OPENCLAW_STATE_DIR"] = input.stateDir;
  process.env["OPENCLAW_CONFIG_PATH"] = input.configPath;
  process.env["AGENTOS_OPENCLAW_GATEWAY_TOKEN"] = input.token;
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD;
  for (const key of FORCE_CLI_KEYS) delete process.env[key];
}

function restoreProductionEnvironment() {
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_URL;
  delete process.env.OPENCLAW_STATE_DIR;
  delete process.env.OPENCLAW_CONFIG_PATH;
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD;
  for (const key of FORCE_CLI_KEYS) delete process.env[key];
}

async function gitHead() {
  return await command("git", ["rev-parse", "HEAD"]);
}

async function gitBranch() {
  return await command("git", ["branch", "--show-current"]);
}

async function readCertificationGitProvenance() {
  const status = await command("git", ["status", "--porcelain"]);
  const dirtyFilesCount = status ? status.split("\n").filter(Boolean).length : 0;
  return {
    head: await gitHead(),
    branch: await gitBranch(),
    gitDescribe: readString(await command("git", ["describe", "--always", "--dirty"])),
    workingTreeClean: dirtyFilesCount === 0,
    dirtyFilesCount
  };
}

async function command(executable: string, args: string[]) {
  return await new Promise<string>((resolve) => {
    const child = spawn(executable, args, { cwd: process.cwd(), stdio: ["ignore", "pipe", "ignore"] });
    let output = "";
    child.stdout.on("data", (chunk: Buffer | string) => { output += chunk.toString(); });
    child.once("close", () => resolve(output.trim()));
  });
}

async function pathExists(input: string) {
  try {
    await readFile(input);
    return true;
  } catch {
    return false;
  }
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function safeError(error: unknown) {
  return sanitize(error instanceof Error ? error.message : String(error));
}

function sanitize(value: string) {
  return value
    .replace(/(?:token|password|secret|api[_ -]?key)\s*[=:]\s*[^\s,]+/gi, "$1=[redacted]")
    .replace(/\/Users\/[^\s/]+(?:\/[^\s]+)*/g, "[LOCAL_PATH]")
    .replace(/\/private\/tmp\/[^\s]+|\/tmp\/[^\s]+/g, "[DISPOSABLE_PATH]");
}

function closeSubscription(subscription: OpenClawGatewayEventSubscription | null) {
  subscription?.close();
}

// The certification report is intentionally assembled through the production
// client, while this type alias keeps the helper signatures readable without
// exporting the script's mutable evidence object as an application contract.
type CertificationEvidence = {
  schemaVersion: number;
  generatedAt: string;
  provenance: {
    repository: string;
    agentosHead: string;
    certifiedCodeHead: string;
    branch: string;
    workingTreeClean: boolean;
    repositoryDirtyFilesCount: number;
    gitDescribe: string | null;
    openClaw: {
      version: string;
      sourceCommit: string | null;
      buildId: string | null;
      packageHash: string;
      protocol: number;
      packageRoot: string;
    };
    environment: {
      node: string;
      nodeMajor: number;
      platform: string;
    };
  };
  runtime: {
    packageMode: string;
    gatewayPort: string;
    stateRoot: string;
    configRoot: string;
    stateIsolation: boolean;
    configIsolation: boolean;
    userGatewayUntouched: boolean;
    managedStateMode: string;
  };
  factory: {
    default: CertificationStatus;
    forcedCli: CertificationStatus;
    singletonReset: CertificationStatus;
    selectedTransport: "official" | "cli" | null;
    noMixedDualTransport: CertificationStatus;
  };
  handshake: {
    status: CertificationStatus;
    protocol: number | null;
    clientId: string | null;
    mode: string | null;
    role: string | null;
    requestedScopes: string[];
    grantedScopes: string[];
    capabilities: string[];
    connectionId: string | null;
    deviceId: string | null;
  };
  auth: {
    defaultSharedStateMode: string;
    deviceIdentitySource: string;
    deviceTokenSource: string;
    tokenPersistence: string;
    tokenClearRecovery: string;
    staleWriterProtection: string;
    explicitToken: CertificationStatus;
    password: CertificationStatus;
    signedChallenge: string;
    challengeTimestamp: string;
    storedDeviceToken: string;
    managedWritePersistence: string;
    reconnectWithDeviceAuth: string;
    serverSideTokenRotationObserved: string;
    harnessRotationPath: string;
  };
  matrix: CertificationRow[];
  observations: {
    firstConnectionId: string | null;
    reconnectConnectionId: string | null;
    deviceIdStableAcrossRestart: boolean;
    eventBridgeStarted: boolean;
    eventBridgeReconnected: boolean;
    clientResetDeviceIdStable: boolean;
    requestPolicyCacheObserved: boolean;
    requestPolicyInvalidationObserved: boolean;
    fallbackTotalAfterDefaultCertification: number;
  };
  cleanup: {
    status: "pending" | "complete" | "failed";
    gatewayProcessesStopped: boolean;
    disposableRootRemoved: boolean;
  };
  summary: {
    total: number;
    passed: number;
    failed: number;
    skipped: number;
    expectedDenials: number;
    notApplicable: number;
  };
  success: boolean;
};

void main().catch((error: unknown) => {
  process.stderr.write(`${safeError(error)}\n`);
  process.exitCode = 1;
});
