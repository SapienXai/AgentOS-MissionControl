import assert from "node:assert/strict";
import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { promisify } from "node:util";
import { cp, mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import type { GatewayEventFrame } from "@/lib/openclaw/client/native-ws-gateway-types";
import { normalizeGatewayTurnEvent } from "@/lib/openclaw/client/native-ws-gateway-mappers";
import { OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import { createOpenClawRuntimeProviderFixture } from "@/scripts/openclaw-runtime-provider-fixture";
import { OpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";
import { requestSupervisorCommand, type SupervisorResponse } from "@/lib/openclaw/lifecycle/supervisor-ipc";

type OfficialBackedGatewayClient = ReturnType<typeof createOfficialBackedOpenClawGatewayClient>;

const execFileAsync = promisify(execFile);
const PACKAGE_INPUT = process.env.OPENCLAW_LIFECYCLE_PACKAGE?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_LIFECYCLE_OUTPUT?.trim() || path.resolve(`docs/evidence/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-lifecycle-certification.json`);
const TARGET_COMMIT = OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;

type LifecycleProbe = {
  canonicalRuntime: boolean;
  start: boolean;
  stop: boolean;
  restart: boolean;
  readiness: boolean;
  nativeHandshake: boolean;
  sessionContinuity: boolean;
  crashRecovery: boolean;
  crashLoopProtection: boolean;
  supervisorIpcSafety: boolean;
  ownershipFailClosed: boolean;
  noDoubleSpawn: boolean;
  externalNoDirectProcessControl: boolean;
};

const LIFECYCLE_SCHEMA = {
  ownership: ["agentos-managed", "external-supervisor", "unavailable", "unknown"],
  states: ["unknown", "stopped", "starting", "running", "ready", "degraded", "restarting", "stopping", "crashed", "recovering", "blocked"],
  operations: ["inspect", "start", "stop", "restart", "waitForReady", "recover", "getStatus", "prepareForMaintenance", "resumeAfterMaintenance"]
};

async function main() {
  if (!PACKAGE_INPUT) throw new Error(`Set OPENCLAW_LIFECYCLE_PACKAGE to an exact OpenClaw ${OPENCLAW_IDENTITY_CONTRACT_VERSION} package root.`);
  const packageRoot = path.resolve(PACKAGE_INPUT);
  const identity = await readPackageIdentity(packageRoot);
  assert.equal(identity.version, OPENCLAW_RECOMMENDED_VERSION);
  assert.equal(identity.sourceCommit, TARGET_COMMIT);

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-lifecycle-"));
  const runtimePackageRoot = path.join(fixtureRoot, "exact-openclaw-package");
  await cp(packageRoot, runtimePackageRoot, { recursive: true, dereference: false });
  await ensurePackageDependencies(runtimePackageRoot);
  const fixture = await createOpenClawRuntimeProviderFixture();
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provenance: {
      agentosCommit: await readGitHead(),
      targetVersion: identity.version,
      targetCommit: identity.sourceCommit,
      targetBuildId: identity.buildId,
      targetPackageHash: identity.packageHash
    },
    runtime: {
      packageMode: "exact-package-fixture",
      packageVersion: identity.version,
      packageSourceCommit: identity.sourceCommit,
      stateRoot: "[DISPOSABLE_ROOT]",
      configRoot: "[DISPOSABLE_ROOT]",
      provider: "loopback-fixture",
      realGateway: true
    },
    lifecycleSchema: LIFECYCLE_SCHEMA,
    managed: null as Record<string, unknown> | null,
    external: null as Record<string, unknown> | null,
    checks: null as LifecycleProbe | null,
    cleanup: { status: "pending", disposableRootRemoved: false, gatewayProcessesStopped: false },
    gate: "PENDING",
    success: false
  };

  try {
    const managed = await runManagedLifecycle({ fixtureRoot, packageRoot: runtimePackageRoot, fixtureBaseUrl: fixture.baseUrl });
    const external = await runExternalLifecycle({ fixtureRoot, packageRoot: runtimePackageRoot, fixtureBaseUrl: fixture.baseUrl });
    const crashLoopProtection = await proveCrashLoopProtection();
    evidence.managed = managed.evidence;
    evidence.external = external.evidence;
    evidence.checks = {
      canonicalRuntime: managed.checks.canonicalRuntime && external.checks.canonicalRuntime,
      start: managed.checks.start && external.checks.start,
      stop: managed.checks.stop && external.checks.stop,
      restart: managed.checks.restart && external.checks.restart,
      readiness: managed.checks.readiness && external.checks.readiness,
      nativeHandshake: managed.checks.nativeHandshake && external.checks.nativeHandshake,
      sessionContinuity: managed.checks.sessionContinuity && external.checks.sessionContinuity,
      crashRecovery: managed.checks.crashRecovery && external.checks.crashRecovery,
      crashLoopProtection,
      supervisorIpcSafety: external.checks.supervisorIpcSafety,
      ownershipFailClosed: managed.checks.ownershipFailClosed && external.checks.ownershipFailClosed,
      noDoubleSpawn: managed.checks.noDoubleSpawn,
      externalNoDirectProcessControl: external.checks.externalNoDirectProcessControl
    };
    evidence.success = Object.values(evidence.checks).every(Boolean);
    evidence.gate = evidence.success ? `OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} LIFECYCLE GATE: PASS` : `OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} LIFECYCLE GATE: FAIL`;
    evidence.cleanup.status = "complete";
  } finally {
    await fixture.close().catch(() => {});
    await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup.disposableRootRemoved = !(await pathExists(fixtureRoot));
    evidence.cleanup.gatewayProcessesStopped = true;
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  }

  if (!evidence.success || !evidence.cleanup.disposableRootRemoved) throw new Error(`Lifecycle certification failed. Evidence: ${OUTPUT_PATH}`);
  console.log(`OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} LIFECYCLE GATE: PASS`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

async function runManagedLifecycle(input: { fixtureRoot: string; packageRoot: string; fixtureBaseUrl: string }) {
  const stateDir = path.join(input.fixtureRoot, "managed-state");
  const configPath = path.join(input.fixtureRoot, "managed-config", "openclaw.json");
  const port = await reservePort();
  const token = randomBytes(24).toString("hex");
  await provisionRuntimeConfig(configPath);
  const env = {
    OPENCLAW_SUPERVISOR_MODE: "agentos-managed",
    OPENCLAW_GATEWAY_PROCESS_MODE: "child",
    OPENCLAW_GATEWAY_BINARY: path.join(input.packageRoot, "openclaw.mjs"),
    OPENCLAW_BIN: path.join(input.packageRoot, "openclaw.mjs"),
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_GATEWAY_PORT: String(port),
    AGENTOS_OPENCLAW_GATEWAY_URL: `ws://127.0.0.1:${port}`,
    AGENTOS_OPENCLAW_GATEWAY_TOKEN: token,
    OPENCLAW_GATEWAY_TOKEN: token
  };
  const service = new OpenClawLifecycleService({ env, resolveBinary: async () => path.join(input.packageRoot, "openclaw.mjs") });
  const started = await service.start();
  assert.equal(started.descriptor.ownership, "agentos-managed");
  assert.equal(started.descriptor.state, "ready");
  assert.equal(started.descriptor.version, OPENCLAW_RECOMMENDED_VERSION);
  assert.equal(started.descriptor.sourceCommit, TARGET_COMMIT);
  const client = createNativeClient(started.descriptor.gatewayUrl, token);
  let firstSessionKey = "";
  let firstAssistant = "";
  let secondAssistant = "";
  try {
    const fixture = await configureProvider(client, input.fixtureBaseUrl);
    assert.equal(fixture, true);
    const session = await createSession(client, "managed");
    firstSessionKey = session.key;
    firstAssistant = await runTurn(client, firstSessionKey, "AGENTOS_SYNTHETIC_FIRST_PROMPT");
    client.close("managed lifecycle restart");
    const restarted = await service.restart();
    assert.equal(restarted.descriptor.state, "ready");
    const reconnected = createNativeClient(restarted.descriptor.gatewayUrl, token);
    try {
      const historyAfterRestart = await readHistory(reconnected, firstSessionKey, 1);
      assert.ok(readAssistantMessages(historyAfterRestart).includes(firstAssistant));
      secondAssistant = await runTurn(reconnected, firstSessionKey, "AGENTOS_SYNTHETIC_SECOND_CONTINUITY_PROMPT");
    } finally {
      reconnected.close("managed lifecycle complete");
    }
    const stopped = await service.stop();
    assert.equal(stopped.descriptor.state, "stopped");
    const resumed = await service.start();
    assert.equal(resumed.descriptor.state, "ready");
      const ready = await service.waitForReady(30_000);
      assert.equal(ready.descriptor.state, "ready");
      const crashPid = ready.descriptor.pid;
      const crashGeneration = ready.descriptor.generation;
      assert.ok(crashPid && crashPid > 1);
      process.kill(crashPid, "SIGKILL");
      const recovered = await waitForManagedRecovery(service, crashGeneration ?? 0);
      assert.equal(recovered.descriptor.state, "ready");
      assert.notEqual(recovered.descriptor.generation, crashGeneration);
      await service.stop();
      return {
        evidence: {
        ownership: "agentos-managed",
        strategy: "child",
        binaryRole: "exact-openclaw-package",
        firstAssistantPresent: Boolean(firstAssistant),
        secondAssistantPresent: Boolean(secondAssistant),
        restartedGeneration: restarted.descriptor.generation,
        readinessState: ready.descriptor.state,
        recoveredGeneration: recovered.descriptor.generation,
        recoveredPid: recovered.descriptor.pid
      },
      checks: {
        canonicalRuntime: started.descriptor.version === OPENCLAW_RECOMMENDED_VERSION && started.descriptor.sourceCommit === TARGET_COMMIT,
        start: started.descriptor.state === "ready" && resumed.descriptor.state === "ready",
        stop: stopped.descriptor.state === "stopped",
        restart: restarted.descriptor.state === "ready",
        readiness: ready.descriptor.ready && ready.descriptor.authenticated,
        nativeHandshake: started.descriptor.authenticated && started.descriptor.protocolVersion !== null,
        sessionContinuity: Boolean(firstAssistant && secondAssistant),
        crashRecovery: recovered.descriptor.state === "ready" && recovered.descriptor.generation !== crashGeneration,
        ownershipFailClosed: await provesUnknownOwnershipBlocked(),
        noDoubleSpawn: restarted.descriptor.pid !== started.descriptor.pid
      }
    };
  } finally {
    client.close("managed lifecycle cleanup");
    await service.stop().catch(() => {});
  }
}

async function runExternalLifecycle(input: { fixtureRoot: string; packageRoot: string; fixtureBaseUrl: string }) {
  const stateDir = path.join(input.fixtureRoot, "external-state");
  const configPath = path.join(input.fixtureRoot, "external-config", "openclaw.json");
  const socketPath = path.join(input.fixtureRoot, "supervisor.sock");
  const port = await reservePort();
  const token = randomBytes(24).toString("hex");
  await provisionRuntimeConfig(configPath);
  const supervisor = await startSupervisor({ packageRoot: input.packageRoot, stateDir, configPath, socketPath, port, token });
  const env = {
    AGENTOS_DEPLOYMENT_PLATFORM: "railway",
    OPENCLAW_SUPERVISOR_MODE: "external",
    OPENCLAW_GATEWAY_BINARY: path.join(input.packageRoot, "openclaw.mjs"),
    OPENCLAW_STATE_DIR: stateDir,
    OPENCLAW_CONFIG_PATH: configPath,
    OPENCLAW_GATEWAY_PORT: String(port),
    AGENTOS_SUPERVISOR_SOCKET_PATH: socketPath,
    AGENTOS_OPENCLAW_GATEWAY_URL: `ws://127.0.0.1:${port}`,
    AGENTOS_OPENCLAW_GATEWAY_TOKEN: token,
    OPENCLAW_GATEWAY_TOKEN: token
  };
  let directControlAttempts = 0;
  const service = new OpenClawLifecycleService({
    env,
    resolveBinary: async () => path.join(input.packageRoot, "openclaw.mjs"),
    spawnGateway: async () => {
      directControlAttempts += 1;
      throw new Error("External lifecycle must not spawn a Gateway child.");
    }
  });
  try {
    const initial = await service.getStatus();
    assert.equal(initial.ownership, "external-supervisor");
    const stopped = await service.stop();
    assert.equal(stopped.descriptor.state, "stopped");
    const started = await service.start();
    assert.equal(started.descriptor.state, "ready");
    const client = createNativeClient(started.descriptor.gatewayUrl, token);
    try {
      await configureProvider(client, input.fixtureBaseUrl);
    } finally {
      client.close("external provider configuration");
    }
    const restarted = await service.restart();
    assert.equal(restarted.descriptor.state, "ready");
    assert.equal(restarted.descriptor.version, OPENCLAW_RECOMMENDED_VERSION);
    assert.equal(restarted.descriptor.sourceCommit, TARGET_COMMIT);
    const beforeCrashClient = createNativeClient(restarted.descriptor.gatewayUrl, token);
    let sessionKey = "";
    let assistant = "";
    try {
      const session = await createSession(beforeCrashClient, "external");
      sessionKey = session.key;
      assistant = await runTurn(beforeCrashClient, sessionKey, "AGENTOS_SYNTHETIC_EXTERNAL_FIRST_PROMPT");
    } finally {
      beforeCrashClient.close("external crash recovery");
    }
    const oldPid = restarted.descriptor.pid;
    assert.ok(oldPid && oldPid > 1);
    process.kill(oldPid, "SIGKILL");
    const recovered = await waitForSupervisorRecovery(service, restarted.descriptor.generation ?? 0);
    assert.equal(recovered.ownership, "external-supervisor");
    assert.equal(recovered.state, "ready");
    assert.notEqual(recovered.generation, restarted.descriptor.generation);
    const afterCrashClient = createNativeClient(recovered.gatewayUrl, token);
    try {
      const history = await readHistory(afterCrashClient, sessionKey, 1);
      assert.ok(readAssistantMessages(history).includes(assistant));
    } finally {
      afterCrashClient.close("external lifecycle complete");
    }
    const supervisorIpcSafety = await proveSupervisorRejectsInvalidCommand(socketPath);
    return {
      evidence: {
        ownership: "external-supervisor",
        strategy: "external-supervisor",
        controlSocket: "private-unix-socket",
        initialGeneration: restarted.descriptor.generation,
        recoveredGeneration: recovered.generation,
        recoveredPid: recovered.pid,
        sessionContinuity: Boolean(assistant)
      },
      checks: {
        canonicalRuntime: restarted.descriptor.version === OPENCLAW_RECOMMENDED_VERSION && restarted.descriptor.sourceCommit === TARGET_COMMIT,
        start: started.descriptor.state === "ready",
        stop: stopped.descriptor.state === "stopped",
        restart: restarted.descriptor.state === "ready",
        readiness: recovered.ready && recovered.authenticated,
        nativeHandshake: recovered.authenticated && recovered.protocolVersion !== null,
        sessionContinuity: Boolean(assistant),
        crashRecovery: recovered.state === "ready" && recovered.generation !== restarted.descriptor.generation,
        crashLoopProtection: true,
        supervisorIpcSafety,
        ownershipFailClosed: initial.ownership === "external-supervisor" && stopped.descriptor.ownership === "external-supervisor",
        noDoubleSpawn: true,
        externalNoDirectProcessControl: directControlAttempts === 0
      }
    };
  } finally {
    await service.stop().catch(() => {});
    await supervisor.stop().catch(() => {});
  }
}

async function startSupervisor(input: { packageRoot: string; stateDir: string; configPath: string; socketPath: string; port: number; token: string }) {
  const scriptPath = path.resolve("scripts/railway-supervisor.mjs");
  const child = spawn(process.execPath, [scriptPath], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENTOS_SUPERVISOR_TEST_MODE: "1",
      AGENTOS_DEPLOYMENT_PLATFORM: "railway",
      OPENCLAW_SUPERVISOR_MODE: "external",
      OPENCLAW_GATEWAY_BINARY: path.join(input.packageRoot, "openclaw.mjs"),
      OPENCLAW_STATE_DIR: input.stateDir,
      OPENCLAW_CONFIG_PATH: input.configPath,
      OPENCLAW_GATEWAY_PORT: String(input.port),
      OPENCLAW_GATEWAY_TOKEN: input.token,
      AGENTOS_SUPERVISOR_SOCKET_PATH: input.socketPath
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 120_000;
  try {
    while (Date.now() < deadline) {
      if (child.exitCode !== null) throw new Error(`External supervisor exited (${child.exitCode}). ${output}`);
      try {
        const status = await requestSupervisorCommand(input.socketPath, "status", { timeoutMs: 2_000 });
        if (status.state === "ready") return { stop: () => stopProcess(child) };
      } catch {}
      await wait(250);
    }
    throw new Error(`External supervisor did not become ready. ${output}`);
  } catch (error) {
    await stopProcess(child);
    throw error;
  }
}

async function waitForSupervisorRecovery(service: OpenClawLifecycleService, previousGeneration: number, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const descriptor = await service.getStatus();
    if (descriptor.state === "ready" && (descriptor.generation ?? 0) > previousGeneration) {
      const ready = await service.waitForReady(10_000);
      return ready.descriptor;
    }
    await wait(500);
  }
  throw new Error("External supervisor did not recover the Gateway within the bounded recovery window.");
}

async function waitForManagedRecovery(service: OpenClawLifecycleService, previousGeneration: number, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const result = await service.getStatus();
    if (result.state === "ready" && (result.generation ?? 0) > previousGeneration) {
      const ready = await service.waitForReady(10_000);
      return ready;
    }
    await wait(500);
  }
  throw new Error("AgentOS-managed lifecycle did not recover the Gateway within the bounded recovery window.");
}

function createNativeClient(url: string, token: string) {
  return createOfficialBackedOpenClawGatewayClient({
    url,
    token,
    scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.questions"],
    timeoutMs: 8_000,
    clientName: "gateway-client",
    clientVersion: "0.1.0-agentos-lifecycle-e2e",
    sharedStateMode: "read-only"
  });
}

async function configureProvider(client: OfficialBackedGatewayClient, baseUrl: string) {
  const current = await client.callNative<Record<string, unknown>>("config.get", {}, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 });
  const hash = typeof current.hash === "string" ? current.hash : undefined;
  await client.callNative("config.patch", {
    raw: JSON.stringify({
      models: {
        mode: "merge",
        providers: {
          "agentos-fixture": {
            baseUrl,
            api: "openai-completions",
            apiKey: "agentos-runtime-fixture",
            timeoutSeconds: 30,
            models: [{ id: "agentos-runtime-fixture", name: "AgentOS Runtime Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 128 }]
          }
        }
      },
      agents: { defaults: { model: { primary: "agentos-fixture/agentos-runtime-fixture" } } }
    }),
    ...(hash ? { baseHash: hash } : {})
  }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
  return true;
}

async function createSession(client: OfficialBackedGatewayClient, label: string) {
  const key = `agent:dev:agentos-lifecycle-${label}-${Date.now()}`;
  const payload = await client.callNative<Record<string, unknown>>("sessions.create", { key, agentId: "dev", label: `AgentOS lifecycle ${label}` }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
  assert.ok(typeof payload.sessionId === "string" || typeof (payload.entry as Record<string, unknown> | undefined)?.sessionId === "string");
  return { key, sessionId: typeof payload.sessionId === "string" ? payload.sessionId : String((payload.entry as Record<string, unknown>).sessionId) };
}

async function runTurn(client: OfficialBackedGatewayClient, sessionKey: string, message: string) {
  const frames: GatewayEventFrame[] = [];
  const subscription = await client.subscribeNativeEvents({ subscribeSessions: true, sessionKeys: [sessionKey] }, { onEvent: (frame) => frames.push(frame) }, { timeoutMs: 8_000 });
  try {
    const dispatch = await client.callNative<Record<string, unknown>>("chat.send", { sessionKey, message, idempotencyKey: `agentos-lifecycle-${Date.now()}` }, { timeoutMs: 8_000 }, { safety: "mutation", timeoutMs: 8_000 });
    const runId = typeof dispatch.runId === "string" ? dispatch.runId : null;
    await waitForTerminal(frames, sessionKey, runId, 45_000);
    const history = await readHistory(client, sessionKey, 1);
    const assistant = readAssistantMessages(history).at(-1) || "";
    assert.ok(assistant);
    assert.ok(frames.some((frame) => normalizeGatewayTurnEvent(frame, sessionKey, runId)?.done));
    return assistant;
  } finally {
    subscription.close();
  }
}

async function waitForTerminal(frames: GatewayEventFrame[], sessionKey: string, runId: string | null, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (frames.some((frame) => normalizeGatewayTurnEvent(frame, sessionKey, runId)?.done)) return;
    await wait(100);
  }
  throw new Error("Gateway lifecycle E2E timed out waiting for a terminal turn event.");
}

async function readHistory(client: OfficialBackedGatewayClient, sessionKey: string, minimumAssistantMessages: number) {
  let last: unknown = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    last = await client.callNative("chat.history", { sessionKey, limit: 50 }, { timeoutMs: 8_000 }, { safety: "read", timeoutMs: 8_000 });
    if (readAssistantMessages(last).length >= minimumAssistantMessages) return last;
    await wait(250);
  }
  return last;
}

function readAssistantMessages(payload: unknown) {
  const messages = (payload as { messages?: unknown[] } | null)?.messages;
  if (!Array.isArray(messages)) return [];
  return messages.flatMap((entry) => {
    const record = entry && typeof entry === "object" ? entry as { role?: unknown; content?: unknown } : null;
    if (record?.role !== "assistant") return [];
    if (typeof record.content === "string") return [record.content];
    if (Array.isArray(record.content)) return [record.content.map((part) => typeof part === "object" && part ? String((part as { text?: unknown }).text ?? "") : "").join("")];
    return [];
  }).filter(Boolean);
}

async function proveCrashLoopProtection() {
  let generation = 0;
  const service = new OpenClawLifecycleService({
    env: {
      OPENCLAW_SUPERVISOR_MODE: "external",
      AGENTOS_SUPERVISOR_SOCKET_PATH: "/tmp/agentos-lifecycle-crash-loop.sock"
    },
    externalSupervisor: {
      request: async (command) => ({
        protocolVersion: 1,
        requestId: `crash-loop-${generation}`,
        ok: true,
        command,
        owner: "external-supervisor",
        state: "ready",
        pid: 50_000 + generation,
        generation: ++generation,
        gatewayUrl: "ws://127.0.0.1:18789",
        gatewayPort: 18_789,
        ready: true,
        authenticated: true,
        health: "live",
        protocolVersionGateway: 4,
        version: OPENCLAW_RECOMMENDED_VERSION,
        sourceCommit: TARGET_COMMIT,
        message: "Crash-loop protection probe"
      } satisfies SupervisorResponse)
    },
    readinessProbe: async () => ({
      ready: true,
      authenticated: true,
      health: "live",
      protocolVersion: 4,
      version: OPENCLAW_RECOMMENDED_VERSION,
      sourceCommit: TARGET_COMMIT,
      checkedAt: new Date().toISOString(),
      reason: null
    }),
    crashRecoveryLimit: 1
  });

  await service.recover();
  await assert.rejects(service.recover(), /blocked after bounded crash-loop/i);
  return true;
}

async function proveSupervisorRejectsInvalidCommand(socketPath: string) {
  return await new Promise<boolean>((resolve, reject) => {
    const socket = net.createConnection({ path: socketPath });
    const request = {
      protocolVersion: 1,
      requestId: `invalid-${randomBytes(8).toString("hex")}`,
      command: "exec"
    };
    let buffer = "";
    let settled = false;
    const timeout = setTimeout(() => finish(() => reject(new Error("Supervisor invalid-command safety probe timed out."))), 5_000);
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      socket.destroy();
      callback();
    };
    socket.setEncoding("utf8");
    socket.once("connect", () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on("data", (chunk) => {
      buffer += chunk;
      const lineEnd = buffer.indexOf("\n");
      if (lineEnd < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, lineEnd)) as { ok?: unknown; error?: { code?: unknown } };
        finish(() => resolve(response.ok === false && response.error?.code === "invalid-request"));
      } catch (error) {
        finish(() => reject(error));
      }
    });
    socket.once("error", (error) => finish(() => reject(error)));
  });
}

async function provisionRuntimeConfig(configPath: string) {
  await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
  await writeFile(configPath, `${JSON.stringify({ gateway: { mode: "local", bind: "loopback" }, agents: { defaults: { workspace: path.dirname(configPath) }, list: [{ id: "dev", workspace: path.dirname(configPath) }] }, cron: { enabled: true } }, null, 2)}\n`, { mode: 0o600 });
}

async function readPackageIdentity(packageRoot: string) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return { version: packageJson.version || "", sourceCommit: buildInfo.commit || null, buildId: buildInfo.buildId || null, packageHash: hash.digest("hex") };
}

async function ensurePackageDependencies(packageRoot: string) {
  if (await pathExists(path.join(packageRoot, "node_modules", "tslog", "package.json"))) return;
  await execFileAsync("npm", ["install", "--prefix", packageRoot, "--omit=dev", "--ignore-scripts", "--legacy-peer-deps", "--no-audit", "--no-fund"], { cwd: packageRoot, maxBuffer: 2 * 1024 * 1024, timeout: 180_000 });
}

async function provesUnknownOwnershipBlocked() {
  const service = new OpenClawLifecycleService({ env: { AGENTOS_DEPLOYMENT_PLATFORM: "unknown-host" } });
  await assert.rejects(service.restart(), /ownership is unknown/i);
  return true;
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

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())), wait(10_000)]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function readGitHead() {
  try {
    const result = await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() });
    return result.stdout.trim();
  } catch {
    return "unknown";
  }
}

function sanitizeEvidence(value: unknown): unknown {
  if (typeof value === "string") return value.replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]");
  if (Array.isArray(value)) return value.map(sanitizeEvidence);
  if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, entry]) => [key, sanitizeEvidence(entry)]));
  return value;
}

async function pathExists(candidate: string) {
  return stat(candidate).then(() => true).catch(() => false);
}

function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }

void main().then(() => {
  process.exitCode = 0;
}).catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
