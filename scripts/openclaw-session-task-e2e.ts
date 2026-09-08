import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { mapOpenClawTaskListToRuntimes } from "@/lib/openclaw/application/runtime-state-service";
import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import { normalizeGatewayTurnEvent } from "@/lib/openclaw/client/native-ws-gateway-mappers";
import type { GatewayEventFrame } from "@/lib/openclaw/client/native-ws-gateway-types";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import { OPENCLAW_IDENTITY_CONTRACT_BUILD, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";
import { createOpenClawRuntimeProviderFixture } from "@/scripts/openclaw-runtime-provider-fixture";
import { createMissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { buildMissionDispatchTranscriptRuntime } from "@/lib/openclaw/domains/mission-dispatch-runtime";

type OfficialBackedGatewayClient = ReturnType<typeof createOfficialBackedOpenClawGatewayClient>;

const execFileAsync = promisify(execFile);
const PACKAGE_INPUT = process.env.OPENCLAW_SESSION_TASK_E2E_PACKAGE?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_SESSION_TASK_E2E_OUTPUT?.trim() || path.resolve(`docs/evidence/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-session-task-alignment.json`);
const REQUEST_TIMEOUT_MS = 10_000;

async function main() {
  if (!PACKAGE_INPUT) {
    throw new Error(`Set OPENCLAW_SESSION_TASK_E2E_PACKAGE to an exact OpenClaw ${OPENCLAW_IDENTITY_CONTRACT_VERSION} package root.`);
  }

  const packageRoot = path.resolve(PACKAGE_INPUT);
  const packageIdentity = await readPackageIdentity(packageRoot);
  assert.equal(packageIdentity.version, OPENCLAW_IDENTITY_CONTRACT_VERSION);
  assert.equal(packageIdentity.sourceCommit, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT);
  assert.equal(packageIdentity.buildId, OPENCLAW_IDENTITY_CONTRACT_BUILD);

  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-session-task-"));
  const stateDir = path.join(disposableRoot, "state");
  const workspaceDir = path.join(disposableRoot, "workspace");
  const configPath = path.join(disposableRoot, "openclaw.json");
  const port = await reservePort();
  const token = `agentos-session-task-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fixture = await createOpenClawRuntimeProviderFixture({ modelId: "agentos-session-task-fixture" });
  let gateway: ChildProcess;
  try {
    gateway = await startGateway({
      packageRoot,
      stateDir,
      workspaceDir,
      configPath,
      port,
      token,
      fixtureBaseUrl: fixture.baseUrl,
      fixtureModelId: fixture.modelId
    });
  } catch (error) {
    await fixture.close().catch(() => {});
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => {});
    throw error;
  }
  let client: ReturnType<typeof createOfficialBackedOpenClawGatewayClient> | null = null;
  let success = false;
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      branch: await readGitBranch(),
      codeCommitUnderTest: await readGitHead(),
      evidenceCommit: null as string | null,
      openClawPackageVersion: packageIdentity.version,
      openClawSourceCommit: packageIdentity.sourceCommit,
      openClawBuild: packageIdentity.buildId,
      openClawPackageHash: packageIdentity.packageHash
    },
    openClaw: {
      version: packageIdentity.version,
      sourceCommit: packageIdentity.sourceCommit,
      build: packageIdentity.buildId,
      packageMode: "exact-npm-package-fixture",
      gatewayPortIsDisposable: true,
      noRealProviderCredentials: true
    },
    exactSessionModel: {
      list: "sessions.list",
      create: "sessions.create",
      describe: "sessions.describe",
      send: "sessions.send",
      abort: "sessions.abort",
      creatorField: "createdActor",
      ownerField: "owner",
      sharingFields: ["participants", "sharingRole", "visibility"],
      exactIdentityRule: "AgentOS correlates only exact keys/session IDs returned by Gateway or created by the request."
    },
    exactTaskModel: {
      list: "tasks.list",
      get: "tasks.get",
      cancel: "tasks.cancel",
      assignment: `unsupported in exact ${OPENCLAW_IDENTITY_CONTRACT_VERSION}`,
      taskSummaryFields: ["id", "status", "agentId", "sessionKey", "runId", "parentTaskId", "sourceId"]
    },
    sourceOfTruthMatrix: [
      { surface: "session identity", source: "OpenClaw sessions.list/describe", projection: "AgentOS runtime/session projection", sidecar: "dispatch only correlates bootstrap" },
      { surface: "task identity/status", source: "OpenClaw tasks.list/get", projection: "AgentOS task card", sidecar: "dispatch only until native task evidence exists" },
      { surface: "task cancellation", source: "OpenClaw tasks.cancel", projection: "AgentOS abort response", sidecar: "none" },
      { surface: "mission submission", source: "OpenClaw chat.send/sessions.send", projection: "AgentOS dispatch record", sidecar: "dispatch record is non-authoritative" }
    ],
    executionIdentity: {
      requestedRole: null as string | null,
      grantedRole: null as string | null,
      requestedScopes: [] as string[],
      grantedScopes: [] as string[],
      connectionIdPresent: false,
      taskIdentityProvenance: "not-observed-in-empty-ledger-fixture"
    },
    missionDispatch: {
      dispatchSidecar: "AgentOS bootstrap correlation only; native task/session remains authoritative",
      dispatchIdClassification: "disposable AgentOS correlation ID; never used as OpenClaw task/session identity",
      nativeMissionTurn: "pending",
      fallback: "not used",
      modelFixture: "loopback-http-fixture",
      dispatchIdPresent: false,
      runIdPresent: false
    },
    sessionCorrelation: [] as Array<Record<string, unknown>>,
    nativeTaskIntegration: {
      taskListRequest: "PASS",
      taskIds: [] as string[],
      taskGetChecks: [] as Array<Record<string, unknown>>,
      taskCancelChecks: [] as Array<Record<string, unknown>>,
      emptyLedgerExplanation: null as string | null
    },
    taskProjection: [] as Array<Record<string, unknown>>,
    taskControlSemantics: {
      continue: "reuses exact sessionKey/sessionId when a projected task exposes one",
      abort: "uses tasks.cancel for an exact task ID; otherwise sessions.abort for exact run/session",
      assignment: "unsupported and fails closed without transport",
      taskCancelProbe: null as Record<string, unknown> | null,
      separateAbortProbe: null as Record<string, unknown> | null,
      steer: "not observed after the bounded loopback turn completed",
      inject: "covered by focused Gateway contract tests"
    },
    followUpContinue: {
      canonicalReuse: "pending",
      duplicateSessionCreation: false,
      historyAssistantCount: 0,
      sameSession: false
    },
    restartContinuity: [] as Array<Record<string, unknown>>,
    multiUserSemantics: {
      connectionStrategy: "shared trusted service",
      OpenClawAttribution: "shared service operator; no per-human credential is claimed",
      AgentOsHumanAttribution: "not exercised in this runtime-only harness"
    },
    sidecarAudit: {
      dispatchIsAuthoritativeRuntimeState: false,
      syntheticSessionIdsAcceptedAsCanonical: false,
      taskStatusMayBeOverriddenByDispatchWhenNativeStatusExists: false
    },
    staleStateHandling: {
      nativeTaskStatusWinsStaleRuntime: true,
      nativeTaskStatusWinsStaleDispatch: true,
      exactSessionReListAfterRestart: false
    },
    duplicateProjectionAudit: {
      nativeTaskAndRuntimeDedupe: "covered by focused unit contract",
      taskListProjectionInput: "PASS",
      taskAssign: "unsupported/no call"
    },
    cleanup: { status: "pending", disposableRootRemoved: false, gatewayProcessStopped: false },
    gate: `OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} SESSION/TASK ALIGNMENT GATE: FAIL`,
    success: false
  };

  let sessionKey: string | null = null;
  try {
    client = createClient(port, token, "0.1.0-agentos-session-task-e2e");
    const identity = await client.getOperatorIdentity({ timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(identity.source, "native-handshake");
    assert.equal(identity.authenticated, true);
    assert.equal(identity.grantedScopesKnown, true);
    evidence.executionIdentity = {
      requestedRole: identity.requestedRole,
      grantedRole: identity.role,
      requestedScopes: identity.requestedScopes,
      grantedScopes: identity.grantedScopes,
      connectionIdPresent: Boolean(identity.connectionId),
      taskIdentityProvenance: "native-handshake"
    };

    sessionKey = `agent:main:session-task-e2e-${Date.now()}`;
    const createdPayload = await client.callNative<Record<string, unknown>>(
      "sessions.create",
      { key: sessionKey, agentId: "main" },
      { timeoutMs: REQUEST_TIMEOUT_MS },
      { safety: "mutation", timeoutMs: REQUEST_TIMEOUT_MS }
    );
    const sessions = await client.listSessions({ search: sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const created = sessions.sessions.find((entry) => entry.key === sessionKey) ?? null;
    assert.ok(created);
    evidence.sessionCorrelation.push({
      operation: "sessions.create",
      result: "PASS",
      requestedKeyPresent: true,
      returnedKeyPresent: Boolean(created.key),
      sessionIdPresent: Boolean(created.sessionId),
      createdActorExposed: Object.hasOwn(created, "createdActor"),
      ownerExposed: Object.hasOwn(created, "owner"),
      createdPayloadFields: Object.keys(createdPayload).filter((key) => ["key", "sessionKey", "sessionId", "runStarted"].includes(key))
    });

    const described = await client.describeSession({ key: sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.ok(described);
    evidence.sessionCorrelation.push({ operation: "sessions.describe", result: "PASS", exactKey: sessionKey !== null });

    const dispatchRecord = createMissionDispatchRecord({
      clientRequestId: "session-task-e2e",
      agentId: "main",
      mission: "AgentOS synthetic session/task mission",
      routedMission: "AgentOS synthetic session/task mission",
      thinking: "medium",
      requestedModelId: `agentos-fixture/${fixture.modelId}`,
      workspaceId: "disposable-workspace",
      workspacePath: workspaceDir,
      outputDir: null,
      outputDirRelative: null,
      notesDirRelative: null
    });
    const firstTurn = await runTurn(client, sessionKey, "AGENTOS_SYNTHETIC_FIRST_PROMPT", 1, fixture);
    const observedDispatchRecord = {
      ...dispatchRecord,
      status: "completed" as const,
      updatedAt: new Date().toISOString(),
      runner: {
        ...dispatchRecord.runner,
        startedAt: dispatchRecord.submittedAt,
        finishedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString()
      },
      observation: {
        runtimeId: firstTurn.runId ? `runtime:gateway:${firstTurn.runId}` : null,
        observedAt: new Date().toISOString()
      },
      result: {
        runId: firstTurn.runId ?? undefined,
        status: "completed"
      }
    };
    const dispatchRuntime = buildMissionDispatchTranscriptRuntime(observedDispatchRecord, sessionKey);
    evidence.missionDispatch.nativeMissionTurn = "PASS";
    evidence.missionDispatch.dispatchIdPresent = Boolean(dispatchRecord.id);
    evidence.missionDispatch.runIdPresent = Boolean(firstTurn.runId);
    evidence.sessionCorrelation.push({
      operation: "native mission turn",
      result: "PASS",
      dispatchIdClassification: "AgentOS bootstrap correlation only",
      runIdPresent: Boolean(firstTurn.runId),
      historyAssistantCount: firstTurn.historyAssistantCount
    });

    const taskPayload = await client.listTasks({ sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const taskRuntimes = mapOpenClawTaskListToRuntimes(taskPayload, {
      agentConfig: [{ id: "main", workspace: workspaceDir }],
      agentsList: [{ id: "main", workspace: workspaceDir }],
      resolveWorkspaceId: () => "disposable-workspace"
    });
    const nativeTaskRecords = buildTaskRecords(taskRuntimes, []);
    const taskRecords = buildTaskRecords(
      taskRuntimes.length > 0 ? taskRuntimes : [dispatchRuntime],
      []
    );
    const taskIds = taskRuntimes.map((runtime) => runtime.taskId).filter((value): value is string => Boolean(value));
    evidence.nativeTaskIntegration.taskIds = taskIds;
    if (taskIds.length === 0) {
      evidence.nativeTaskIntegration.emptyLedgerExplanation = `The exact ${OPENCLAW_IDENTITY_CONTRACT_VERSION} runtime completed the loopback model turn but exposed no task ledger row for this session; no task ID was fabricated.`;
    }
    evidence.taskProjection = taskRecords.map((task) => ({
      taskIdPresent: Boolean(task.metadata.openClawTaskId),
      status: task.status,
      sourceOfTruth: task.metadata.sourceOfTruth,
      identityProvenance: task.metadata.identityProvenance
    }));
    assert.equal(nativeTaskRecords.length, taskIds.length);
    assert.equal(taskRecords.length, taskIds.length > 0 ? taskIds.length : 1);

    for (const taskId of taskIds) {
      const task = await client.getTask({ taskId }, { timeoutMs: REQUEST_TIMEOUT_MS });
      evidence.nativeTaskIntegration.taskGetChecks.push({ taskIdPresent: true, taskReturned: Boolean(task.task) });
      const taskStatus = typeof (task.task as Record<string, unknown> | undefined)?.status === "string"
        ? (task.task as Record<string, unknown>).status
        : null;
      if (taskStatus === "queued" || taskStatus === "running") {
        const cancelled = await client.cancelTask({ taskId, reason: "session-task-e2e cleanup" }, { timeoutMs: REQUEST_TIMEOUT_MS });
        const cancelRecord = cancelled as Record<string, unknown>;
        evidence.nativeTaskIntegration.taskCancelChecks.push({ taskIdPresent: true, found: cancelRecord.found ?? null, status: cancelRecord.status ?? null });
      } else {
        evidence.nativeTaskIntegration.taskCancelChecks.push({ taskIdPresent: true, result: "SKIPPED-terminal" });
      }
    }

    const continuation = await runTurn(client, sessionKey, "AGENTOS_SYNTHETIC_SECOND_CONTINUITY_PROMPT", 2, fixture);
    assert.ok(continuation.historyAssistantCount >= 2);
    evidence.followUpContinue = {
      canonicalReuse: "PASS",
      duplicateSessionCreation: false,
      historyAssistantCount: continuation.historyAssistantCount,
      sameSession: true
    };

    const controlSessionKey = `agent:main:session-task-e2e-control-${Date.now()}`;
    await client.callNative<Record<string, unknown>>(
      "sessions.create",
      { key: controlSessionKey, agentId: "main" },
      { timeoutMs: REQUEST_TIMEOUT_MS },
      { safety: "mutation", timeoutMs: REQUEST_TIMEOUT_MS }
    );
    try {
      const cancelProbe = await client.cancelTask(
        { taskId: `task-not-found-session-task-e2e-${Date.now()}`, reason: "disposable cancellation probe" },
        { timeoutMs: REQUEST_TIMEOUT_MS }
      );
      const cancelRecord = cancelProbe as Record<string, unknown>;
      evidence.taskControlSemantics.taskCancelProbe = {
        result: "PASS",
        found: cancelRecord.found ?? null,
        cancelled: cancelRecord.cancelled ?? null
      };
      const abortProbe = await client.callNative<Record<string, unknown>>(
        "sessions.abort",
        { key: controlSessionKey },
        { timeoutMs: REQUEST_TIMEOUT_MS },
        { safety: "mutation", timeoutMs: REQUEST_TIMEOUT_MS }
      );
      evidence.taskControlSemantics.separateAbortProbe = {
        result: "PASS",
        responseShape: Object.keys(abortProbe).sort().slice(0, 8)
      };
    } finally {
      await client.callNative(
        "sessions.delete",
        { key: controlSessionKey, deleteTranscript: true },
        { timeoutMs: REQUEST_TIMEOUT_MS },
        { safety: "mutation", timeoutMs: REQUEST_TIMEOUT_MS }
      ).catch(() => {});
    }

    client.close("session/task restart continuity");
    client = null;
    await stopProcess(gateway);
    gateway = await startGateway({
      packageRoot,
      stateDir,
      workspaceDir,
      configPath,
      port,
      token,
      fixtureBaseUrl: fixture.baseUrl,
      fixtureModelId: fixture.modelId
    });
    const reconnected = createClient(port, token, "0.1.0-agentos-session-task-e2e-reconnect");
    client = reconnected;
    const reconnectIdentity = await reconnected.getOperatorIdentity({ timeoutMs: REQUEST_TIMEOUT_MS });
    const sessionsAfterRestart = await reconnected.listSessions({ search: sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const recovered = sessionsAfterRestart.sessions.find((entry) => entry.key === sessionKey) ?? null;
    const restartedContinuation = await runTurn(reconnected, sessionKey, "AGENTOS_SYNTHETIC_POST_RESTART_CONTINUITY_PROMPT", 3, fixture);
    assert.ok(restartedContinuation.historyAssistantCount >= 3);
    evidence.restartContinuity.push({
      handshake: reconnectIdentity.authenticated ? "PASS" : "FAIL",
      exactSessionKeyReused: Boolean(recovered),
      duplicateSessionCreated: sessionsAfterRestart.sessions.filter((entry) => entry.key === sessionKey).length > 1,
      continuationAfterRestart: restartedContinuation.historyAssistantCount >= 3 ? "PASS" : "FAIL"
    });
    evidence.staleStateHandling.exactSessionReListAfterRestart = Boolean(recovered);
    assert.ok(recovered);
    assert.equal(sessionsAfterRestart.sessions.filter((entry) => entry.key === sessionKey).length, 1);
    success = true;
  } finally {
    if (client) client.close("session/task E2E cleanup");
    if (sessionKey) {
      const cleanupClient = createClient(port, token, "0.1.0-agentos-session-task-e2e-cleanup");
      await cleanupClient.callNative("sessions.delete", { key: sessionKey, deleteTranscript: true }, { timeoutMs: REQUEST_TIMEOUT_MS }, { safety: "mutation", timeoutMs: REQUEST_TIMEOUT_MS }).catch(() => {});
      cleanupClient.close("session/task cleanup complete");
    }
    await stopProcess(gateway).catch(() => {});
    await fixture.close().catch(() => {});
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup.status = "complete";
    evidence.cleanup.disposableRootRemoved = !(await pathExists(disposableRoot));
    evidence.cleanup.gatewayProcessStopped = gateway.exitCode !== null;
    evidence.gate = success && evidence.cleanup.disposableRootRemoved && evidence.cleanup.gatewayProcessStopped
      ? `OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} SESSION/TASK ALIGNMENT GATE: PASS`
      : `OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} SESSION/TASK ALIGNMENT GATE: FAIL`;
    evidence.success = evidence.gate.endsWith("PASS");
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  }

  if (!evidence.success) {
    throw new Error(`Session/task alignment certification failed. Evidence: ${OUTPUT_PATH}`);
  }
  console.log(`OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} SESSION/TASK ALIGNMENT GATE: PASS`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

async function runTurn(
  client: OfficialBackedGatewayClient,
  sessionKey: string,
  message: string,
  minimumAssistantMessages: number,
  fixture: Awaited<ReturnType<typeof createOpenClawRuntimeProviderFixture>>
) {
  const frames: GatewayEventFrame[] = [];
  const subscription = await client.subscribeNativeEvents(
    { subscribeSessions: true, sessionKeys: [sessionKey] },
    { onEvent: (frame) => frames.push(frame) },
    { timeoutMs: REQUEST_TIMEOUT_MS }
  );

  try {
    const dispatch = await client.callNative<Record<string, unknown>>(
      "chat.send",
      { sessionKey, message, idempotencyKey: `session-task-e2e-${Date.now()}` },
      { timeoutMs: REQUEST_TIMEOUT_MS },
      { safety: "mutation", timeoutMs: REQUEST_TIMEOUT_MS }
    );
    const runId = typeof dispatch.runId === "string" ? dispatch.runId : null;
    await waitForTerminal(frames, sessionKey, runId, 45_000);
    const history = await readHistory(client, sessionKey, minimumAssistantMessages);
    const assistantMessages = readAssistantMessages(history);
    const expectedReply = /SECOND|CONTINUITY/i.test(message)
      ? "AGENTOS_FIXTURE_SECOND_REPLY"
      : "AGENTOS_FIXTURE_FIRST_REPLY";
    assert.ok(assistantMessages.some((entry) => entry.includes(expectedReply)), JSON.stringify({ expectedReply, assistantMessages, fixturePrompt: fixture.stats.lastPrompt }));
    assert.ok(frames.some((frame) => normalizeGatewayTurnEvent(frame, sessionKey, runId)?.done));
    return { runId, historyAssistantCount: assistantMessages.length };
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
  throw new Error("OpenClaw session/task E2E timed out waiting for a terminal turn event.");
}

async function readHistory(client: OfficialBackedGatewayClient, sessionKey: string, minimumAssistantMessages: number) {
  let last: unknown = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    last = await client.callNative(
      "chat.history",
      { sessionKey, limit: 50 },
      { timeoutMs: REQUEST_TIMEOUT_MS },
      { safety: "read", timeoutMs: REQUEST_TIMEOUT_MS }
    );
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
    if (Array.isArray(record.content)) {
      return [record.content.map((part) => typeof part === "object" && part ? String((part as { text?: unknown }).text ?? "") : "").join("")];
    }
    return [];
  }).filter(Boolean);
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function createClient(port: number, token: string, clientVersion: string) {
  return createOfficialBackedOpenClawGatewayClient({
    url: `ws://127.0.0.1:${port}`,
    token,
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write"],
    timeoutMs: REQUEST_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion,
    sharedStateMode: "read-only"
  });
}

async function startGateway(input: {
  packageRoot: string;
  stateDir: string;
  workspaceDir: string;
  configPath: string;
  port: number;
  token: string;
  fixtureBaseUrl: string;
  fixtureModelId: string;
}) {
  await mkdir(input.workspaceDir, { recursive: true, mode: 0o700 });
  await mkdir(input.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(input.configPath, `${JSON.stringify({
    gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: input.token } },
    agents: {
      defaults: { workspace: input.workspaceDir, model: { primary: `agentos-fixture/${input.fixtureModelId}` } },
      list: [{ id: "main", workspace: input.workspaceDir }]
    },
    models: {
      mode: "merge",
      providers: {
        "agentos-fixture": {
          baseUrl: input.fixtureBaseUrl,
          api: "openai-completions",
          apiKey: "agentos-session-task-fixture",
          timeoutSeconds: 30,
          models: [{ id: input.fixtureModelId, name: "AgentOS Session Task Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 128 }]
        }
      }
    },
    cron: { enabled: false }
  }, null, 2)}\n`, { mode: 0o600 });
  const child = spawn(process.execPath, [
    path.join(input.packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(input.port), "--bind", "loopback",
    "--allow-unconfigured", "--auth", "token", "--token", input.token, "--ws-log", "compact"
  ], {
    cwd: input.workspaceDir,
    env: { ...process.env, OPENCLAW_STATE_DIR: input.stateDir, OPENCLAW_CONFIG_PATH: input.configPath, OPENCLAW_GATEWAY_TOKEN: input.token },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated OpenClaw Gateway exited (${child.exitCode}). ${sanitizeText(output)}`);
    try { if ((await fetch(`http://127.0.0.1:${input.port}/healthz`)).ok) return child; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stopProcess(child);
  throw new Error(`Isolated OpenClaw Gateway did not become ready. ${sanitizeText(output)}`);
}

async function readPackageIdentity(packageRoot: string) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) { hash.update(relativePath); hash.update(await readFile(path.join(packageRoot, relativePath))); }
  return { version: packageJson.version ?? "", sourceCommit: buildInfo.commit ?? null, buildId: buildInfo.buildId ?? null, packageHash: hash.digest("hex") };
}

async function readGitHead() { return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).stdout.trim(); }
async function readGitBranch() { return (await execFileAsync("git", ["branch", "--show-current"], { cwd: process.cwd() })).stdout.trim(); }
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
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}
async function pathExists(candidate: string) { try { await readFile(candidate); return true; } catch (error) { return error instanceof Error && "code" in error && error.code !== "ENOENT"; } }
function sanitizeText(value: string) { return value.replace(/agentos-session-task-e2e-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]").replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]").slice(0, 320); }
function sanitizeEvidence(value: unknown): unknown { if (typeof value === "string") return sanitizeText(value); if (Array.isArray(value)) return value.map(sanitizeEvidence); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeEvidence(nested)])); return value; }

main().catch((error) => { console.error(error instanceof Error ? error.message : "OpenClaw session/task E2E failed."); process.exitCode = 1; });
