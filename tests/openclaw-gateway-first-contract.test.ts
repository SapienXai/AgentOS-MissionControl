import assert from "node:assert/strict";
import { rm } from "node:fs/promises";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  clearOpenClawCapabilityMatrixCacheForTesting,
  getCachedOpenClawCapabilityMatrix,
  getOpenClawCapabilityMatrix,
  setOpenClawCapabilityMatrixNativeCallerForTesting
} from "@/lib/openclaw/application/capability-matrix-service";
import {
  getOpenClawEventBridgeStatus,
  getOpenClawEventBridgeStreamStatus,
  normalizeOpenClawGatewayEventToRuntime,
  resetOpenClawEventBridgeForTesting,
  startOpenClawEventBridge
} from "@/lib/openclaw/application/event-bridge-service";
import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  OPENCLAW_GATEWAY_BASELINE_VERSION,
  OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS,
  OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS
} from "@/lib/openclaw/client/gateway-compatibility";
import {
  abortMissionDispatchTask,
  submitMissionDispatch
} from "@/lib/openclaw/domains/mission-dispatch-workflow";
import { controlRunningTaskSession } from "@/lib/openclaw/application/task-control-service";
import type { MissionControlSnapshot, TaskDetailRecord } from "@/lib/openclaw/types";

const createdMissionDispatchIds = new Set<string>();

afterEach(async () => {
  resetOpenClawEventBridgeForTesting();
  clearOpenClawCapabilityMatrixCacheForTesting();
  setOpenClawAdapterForTesting(null);

  const dispatchIds = [...createdMissionDispatchIds];
  createdMissionDispatchIds.clear();

  await Promise.all(
    dispatchIds.flatMap((dispatchId) => [
      rm(path.join(process.cwd(), ".mission-control", "dispatches", `${dispatchId}.json`), { force: true }),
      rm(path.join(process.cwd(), ".mission-control", "dispatches", `${dispatchId}.log.jsonl`), { force: true })
    ])
  );
});

function trackMissionDispatch(dispatchId: string | null | undefined) {
  if (dispatchId) {
    createdMissionDispatchIds.add(dispatchId);
  }
}

test("capability matrix detects advertised Gateway-first methods", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async (method) => {
    assert.equal(method, "rpc.discover");
    return {
      protocolVersion: 4,
      auth: { mode: "device", role: "operator", scopes: ["operator.read", "operator.write"] },
      methods: [
        "chat.send",
        "chat.abort",
        "sessions.subscribe",
        "models.authOrder.set",
        "config.schema",
        "config.schema.lookup",
        "config.patch",
        "logs.tail",
        "agents.create",
        "agents.update",
        "agents.delete",
        "channels.status",
        "skills.status",
        "exec.approval.list",
        "exec.approval.resolve",
        "cron.list",
        "cron.status",
        "update.status"
      ],
      events: ["session.message", "session.tool"]
    };
  });

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.openClawVersion, "9.9.9");
  assert.equal(matrix.gatewayProtocolVersion, "4");
  assert.equal(matrix.authMode, "device");
  assert.equal(matrix.authRole, "operator");
  assert.deepEqual(matrix.authScopes, ["operator.read", "operator.write"]);
  assert.deepEqual(matrix.requestedProtocolRange, { min: 4, max: 4 });
  assert.equal(matrix.configSchemaLookup, "supported");
  assert.equal(matrix.nativeMissionDispatch, "supported");
  assert.equal(matrix.nativeAgentLifecycle, "supported");
  assert.equal(matrix.configPatch, "supported");
  assert.equal(matrix.eventBridge, "supported");
  assert.equal(matrix.channels, "supported");
  assert.equal(matrix.approvals, "supported");
  assert.equal(matrix.logsTail, "supported");
  assert.equal(matrix.cronRead, "supported");
  assert.equal(matrix.operations?.agentCreate.mode, "gateway-native");
  assert.equal(matrix.operations?.agentCreate.label, "Agent creation");
  assert.equal(matrix.operations?.modelAuthOrder.mode, "gateway-native");
  assert.equal(matrix.operations?.missionStream.mode, "gateway-native");
  assert.equal(matrix.unsupportedGatewayMethods.includes("models.list"), false);
  assert.equal(matrix.operations?.modelAuthOrder.compatibility, "preferred");
  assert.equal(matrix.compatibility?.protocol.status, "compatible");
  assert.equal(matrix.compatibility?.methodContract.status, "advertised");
  assert.equal(matrix.compatibility?.methodContract.source, "rpc.discover");
  assert.equal(matrix.compatibility?.methodContract.refreshIntervalMs, 60_000);
  assert.ok(matrix.compatibility?.methodContract.missingMethods.includes("models.list"));
  assert.equal(matrix.compatibility?.methodContract.baselineVersion, OPENCLAW_GATEWAY_BASELINE_VERSION);
  assert.equal(matrix.compatibility?.methodContract.missingOperations.includes("runtimeSnapshot"), false);
  assert.equal(matrix.compatibility?.methodContract.missingOperations.includes("agentIdentity"), false);
});

test("capability matrix cache keeps stale data while refresh warms", async () => {
  const originalNow = Date.now;
  let now = 1_000_000;
  Date.now = () => now;
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    auth: { mode: "device", role: "operator", scopes: ["operator.read"] },
    methods: [...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS],
    events: []
  }));

  try {
    const matrix = await getOpenClawCapabilityMatrix({ force: true });
    now += 120_000;

    const stale = getCachedOpenClawCapabilityMatrix();

    assert.equal(stale?.detectedAt, matrix.detectedAt);
    assert.equal(stale?.gatewayProtocolVersion, "4");
  } finally {
    Date.now = originalNow;
  }
});

test("capability matrix reports fully advertised Gateway method contract without claiming live verification", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async (method) => {
    assert.equal(method, "rpc.discover");
    return {
      protocolVersion: 4,
      methods: OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS
    };
  });

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.compatibility?.methodContract.status, "advertised");
  assert.equal(matrix.compatibility?.methodContract.source, "rpc.discover");
  assert.equal(matrix.compatibility?.methodContract.expectedMethodCount, OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS.length);
  assert.equal(matrix.compatibility?.methodContract.advertisedMethodCount, OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS.length);
  assert.equal(matrix.compatibility?.methodContract.missingMethodCount, 0);
  assert.deepEqual(matrix.compatibility?.methodContract.missingMethods, []);
  assert.deepEqual(matrix.compatibility?.methodContract.missingOperations, []);
  assert.equal(matrix.compatibility?.methodContract.missingOptionalMethods?.length, OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS.length);
  assert.match(matrix.compatibility?.methodContract.reason ?? "", /conservative method metadata/i);
});

test("capability matrix treats missing optional methods as informational", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: [
      ...OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
      "future.method"
    ]
  }));

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.compatibility?.methodContract.status, "advertised");
  assert.equal(matrix.unsupportedGatewayMethods.length, 0);
  assert.equal(matrix.compatibility?.methodContract.missingOptionalMethods?.includes("tasks.list"), true);
  assert.equal(matrix.compatibility?.methodContract.missingRequiredMethods?.length, 0);
});

test("capability matrix reports Gateway compatibility aliases without degrading to CLI", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["models.auth.order.set"]
  }));

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.operations?.modelAuthOrder.mode, "gateway-native");
  assert.equal(matrix.operations?.modelAuthOrder.compatibility, "alias");
  assert.equal(matrix.operations?.modelAuthOrder.preferredMethod, "models.authOrder.set");
  assert.equal(matrix.operations?.modelAuthOrder.supportedMethod, "models.auth.order.set");
  assert.deepEqual(matrix.compatibility?.aliasOperations, ["modelAuthOrder: models.auth.order.set"]);
  assert.equal(matrix.compatibility?.degradedOperations.includes("modelAuthOrder"), false);
  assert.equal(matrix.compatibility?.methodContract.status, "advertised");
  assert.equal(matrix.compatibility?.methodContract.missingOperations.includes("modelAuthOrder"), false);
});

test("capability matrix keeps omitted agent update unknown without a fake fallback", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["agents.create", "agents.delete"]
  }));

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.nativeAgentLifecycle, "unknown");
  assert.equal(matrix.operations?.agentCreate.mode, "gateway-native");
  assert.equal(matrix.operations?.agentDelete.mode, "gateway-native");
  assert.equal(matrix.operations?.agentUpdate.mode, "unknown");
  assert.equal(matrix.operations?.agentUpdate.fallbackAllowed, false);
  assert.match(matrix.operations?.agentUpdate.reason ?? "", /conservative/i);
  assert.match(matrix.operations?.agentUpdate.recovery ?? "", /authoritative Gateway response/i);
  assert.equal(matrix.compatibility?.degradedOperations.includes("agentUpdate"), false);
  assert.equal(matrix.degradedFeatures?.some((entry) => /agentUpdate:/i.test(entry)), false);
});

test("capability matrix carries explicit recovery guidance for degraded OpenClaw surfaces", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["models.list", "models.authStatus", "channels.status"]
  }));

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.operations?.modelScan.mode, "unknown");
  assert.match(matrix.operations?.modelScan.recovery ?? "", /explicit model refresh.*native models\.scan/i);
  assert.equal(matrix.operations?.taskAssign.mode, "unknown");
  assert.match(matrix.operations?.taskAssign.recovery ?? "", /unavailable until OpenClaw exposes tasks\.assign/i);
  assert.equal(matrix.operations?.channelProvisioning.mode, "unknown");
  assert.match(matrix.operations?.channelProvisioning.recovery ?? "", /marked limited/i);
  assert.equal(matrix.degradedFeatures?.some((entry) => /modelScan:/i.test(entry)), false);
});

test("capability matrix tracks Phase 2 Gateway-native runtime surfaces", async () => {
  setOpenClawAdapterForTesting(createContractAdapter());
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: [
      "sessions.describe",
      "sessions.get",
      "sessions.list",
      "chat.history",
      "tasks.list",
      "tasks.get",
      "artifacts.list",
      "artifacts.get",
      "artifacts.download",
      "tools.catalog",
      "tools.effective"
    ],
    events: ["task", "artifact.updated"]
  }));

  const matrix = await getOpenClawCapabilityMatrix({ force: true });

  assert.equal(matrix.operations?.sessionHistory.mode, "gateway-native");
  assert.equal(matrix.operations?.taskEvents.mode, "gateway-native");
  assert.equal(matrix.operations?.artifacts.mode, "gateway-native");
  assert.equal(matrix.operations?.runtimeSnapshot.mode, "gateway-native");
  assert.equal(matrix.operations?.tools.mode, "gateway-native");
  assert.equal(matrix.eventBridge, "supported");
  assert.ok(!matrix.unsupportedGatewayMethods.includes("sessions.list"));
});

test("mission dispatch uses native chat when capability matrix supports it", async () => {
  const calls: string[] = [];
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["chat.send"]
  }));
  setOpenClawAdapterForTesting(createContractAdapter({
    async runAgentTurn(input) {
      calls.push(`run:${input.agentId}:${input.dispatchId ?? "none"}`);
      return {
        runId: "run-native-1",
        status: "running",
        summary: "Queued by Gateway"
      };
    }
  }));

  const response = await submitMissionDispatch({ mission: "Ship it", workspaceId: "workspace-1" }, {
    getMissionControlSnapshot: async () => createSnapshot(),
    resolveAgentForMission: () => "agent-1",
    invalidateMissionControlCaches: () => {}
  });
  trackMissionDispatch(response.dispatchId);

  assert.equal(response.runId, "run-native-1");
  assert.equal(response.status, "running");
  assert.deepEqual(calls, [`run:agent-1:${response.dispatchId}`]);
});

test("mission dispatch keeps running when only the Gateway observation wait expires", async () => {
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["chat.send", "agent.wait"]
  }));
  setOpenClawAdapterForTesting(createContractAdapter({
    async runAgentTurn() {
      return {
        runId: "run-timeout-1",
        status: "timeout",
        timeoutPhase: "gateway_draining"
      } as unknown as Awaited<ReturnType<OpenClawAdapter["runAgentTurn"]>>;
    }
  }));

  const response = await submitMissionDispatch({ mission: "Wait for timeout", workspaceId: "workspace-1" }, {
    getMissionControlSnapshot: async () => createSnapshot(),
    resolveAgentForMission: () => "agent-1",
    invalidateMissionControlCaches: () => {}
  });
  trackMissionDispatch(response.dispatchId);

  assert.equal(response.runId, "run-timeout-1");
  assert.equal(response.status, "running");
  assert.match(response.summary, /accepted and queued/i);
});

test("mission dispatch converges duplicate client request identities", async () => {
  let calls = 0;
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({ protocolVersion: 4, methods: ["chat.send"] }));
  setOpenClawAdapterForTesting(createContractAdapter({
    async runAgentTurn() {
      calls += 1;
      return { runId: "run-idempotent-1", status: "running", summary: "Accepted once" };
    }
  }));
  const deps = {
    getMissionControlSnapshot: async () => createSnapshot(),
    resolveAgentForMission: () => "agent-1",
    invalidateMissionControlCaches: () => {}
  };
  const first = await submitMissionDispatch({ mission: "Idempotent mission", workspaceId: "workspace-1", requestId: "same-request" }, deps);
  const replay = await submitMissionDispatch({ mission: "Idempotent mission", workspaceId: "workspace-1", requestId: "same-request" }, deps);
  trackMissionDispatch(first.dispatchId);
  assert.equal(calls, 1);
  assert.equal(replay.dispatchId, first.dispatchId);
  assert.equal(replay.meta?.idempotentReplay, true);
});

test("mission dispatch still attempts Gateway-first path when capabilities are unknown", async () => {
  const calls: string[] = [];
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: []
  }));
  setOpenClawAdapterForTesting(createContractAdapter({
    async runAgentTurn(input) {
      calls.push(`run:${input.agentId}:${input.dispatchId ?? "none"}`);
      return {
        runId: "run-unknown-1",
        status: "running",
        summary: "Queued by Gateway"
      };
    }
  }));

  const response = await submitMissionDispatch({ mission: "Try native", workspaceId: "workspace-1" }, {
    getMissionControlSnapshot: async () => createSnapshot(),
    resolveAgentForMission: () => "agent-1",
    invalidateMissionControlCaches: () => {}
  });
  trackMissionDispatch(response.dispatchId);

  assert.equal(response.runId, "run-unknown-1");
  assert.equal(response.status, "running");
  assert.deepEqual(calls, [`run:agent-1:${response.dispatchId}`]);
});

test("task abort cancels native Gateway tasks without requiring dispatch records", async () => {
  const calls: Array<{ taskId: string; reason?: string | null }> = [];
  const snapshot = createSnapshot();
  snapshot.tasks = [{
    id: "task-native",
    key: "gateway-task-1",
    title: "Gateway task",
    mission: "Run native task",
    subtitle: "OpenClaw Gateway task",
    status: "running",
    updatedAt: Date.now(),
    ageMs: 0,
    runtimeIds: [],
    agentIds: ["agent-1"],
    sessionIds: [],
    runIds: [],
    runtimeCount: 1,
    updateCount: 1,
    liveRunCount: 1,
    artifactCount: 0,
    warningCount: 0,
    metadata: {
      gatewayObjectKind: "task",
      taskId: "gateway-task-1"
    }
  }];
  setOpenClawAdapterForTesting(createContractAdapter({
    async cancelTask(input) {
      calls.push(input);
      return { ok: true };
    }
  }));

  const response = await abortMissionDispatchTask("task-native", "stop it", null, {
    getMissionControlSnapshot: async () => snapshot,
    resolveAgentForMission: () => "agent-1",
    invalidateMissionControlCaches: () => {}
  });

  assert.equal(response.dispatchId, null);
  assert.equal(response.status, "cancelled");
  assert.deepEqual(calls, [{ taskId: "gateway-task-1", reason: "stop it" }]);
});

test("running task steering resolves a native Gateway session key", async () => {
  const calls: Array<{
    key?: string | null;
    sessionId?: string | null;
    agentId?: string | null;
    message: string;
    idempotencyKey?: string | null;
  }> = [];
  const taskDetail = createRunningTaskDetail();

  const response = await controlRunningTaskSession(
    "task-1",
    { action: "steer", message: "Focus on tests" },
    {
      adapter: {
        async steerSession(input) {
          calls.push(input);
          return { ok: true };
        },
        async injectChat() {
          throw new Error("unexpected inject");
        }
      },
      getTaskDetail: async () => taskDetail,
      invalidateMissionControlSnapshotCache: () => {}
    }
  );

  assert.equal(response.ok, true);
  assert.equal(response.target.sessionKey, "agent:agent-1:explicit:session-1");
  assert.deepEqual(response.transport, {
    requestedMethod: "chat.send",
    actualMethod: "chat.send",
    fallback: "none",
    reason: null
  });
  assert.equal(calls.length, 1);
  assert.deepEqual(calls[0], {
    key: "agent:agent-1:explicit:session-1",
    sessionId: null,
    message: "Focus on tests",
    agentId: "agent-1",
    idempotencyKey: calls[0]?.idempotencyKey
  });
  assert.match(calls[0]?.idempotencyKey ?? "", /^task-1:control:/);
});

test("running task steering fails honestly when modern chat control is unavailable", async () => {
  const calls: Array<{ sessionKey?: string | null; sessionId?: string | null; agentId?: string | null; message: string }> = [];
  const taskDetail = createRunningTaskDetail();

  await assert.rejects(() => controlRunningTaskSession(
    "task-1",
    { action: "steer", message: "Focus on tests" },
    {
      adapter: {
        async steerSession() {
          throw new Error('OpenClaw Gateway does not advertise method "chat.send".');
        },
        async injectChat(input) {
          calls.push(input);
          return { ok: true };
        }
      },
      getTaskDetail: async () => taskDetail,
      invalidateMissionControlSnapshotCache: () => {}
    }
  ), /does not advertise method "chat\.send"/);
  assert.deepEqual(calls, []);
});

test("running task context injection uses chat.inject semantics", async () => {
  const calls: Array<{ sessionKey?: string | null; sessionId?: string | null; message: string }> = [];
  const taskDetail = createRunningTaskDetail();

  await controlRunningTaskSession(
    "task-1",
    { action: "inject", message: "Use this reference" },
    {
      adapter: {
        async steerSession() {
          throw new Error("unexpected steer");
        },
        async injectChat(input) {
          calls.push(input);
          return { ok: true };
        }
      },
      getTaskDetail: async () => taskDetail,
      invalidateMissionControlSnapshotCache: () => {}
    }
  );

  assert.deepEqual(calls, [{
    sessionKey: "agent:agent-1:explicit:session-1",
    sessionId: null,
    agentId: "agent-1",
    message: "Use this reference"
  }]);
});

test("task continuation runs a new turn on the existing dispatch session", async () => {
  const calls: Array<{
    agentId: string;
    sessionId?: string;
    message: string;
    dispatchId?: string | null;
    idempotencyKey?: string | null;
    workspace?: string | null;
  }> = [];
  const taskDetail = createRunningTaskDetail();
  taskDetail.task.status = "stalled";
  taskDetail.task.liveRunCount = 0;
  taskDetail.task.dispatchId = "dispatch-1";
  taskDetail.runs[0]!.status = "stalled";

  const response = await controlRunningTaskSession(
    "task-1",
    { action: "continue", message: "Continue from here", dispatchId: "dispatch-1" },
    {
      adapter: {
        async steerSession() {
          throw new Error("unexpected steer");
        },
        async injectChat() {
          throw new Error("unexpected inject");
        },
        async runAgentTurn(input) {
          calls.push(input);
          return { runId: "run-2", status: "running" };
        }
      },
      getTaskDetail: async () => taskDetail,
      getMissionControlSnapshot: async () => createSnapshot(),
      invalidateMissionControlSnapshotCache: () => {}
    }
  );

  assert.equal(response.ok, true);
  assert.equal(response.action, "continue");
  assert.equal(response.target.sessionKey, "agent:agent-1:explicit:session-1");
  assert.equal(calls.length, 1);
  const call = calls[0]!;
  assert.deepEqual(
    {
      agentId: call.agentId,
      sessionId: call.sessionId,
      message: call.message,
      dispatchId: call.dispatchId,
      workspace: call.workspace
    },
    {
      agentId: "agent-1",
      sessionId: "session-1",
      message: "Continue from here",
      dispatchId: "dispatch-1",
      workspace: "/tmp/agentos-contract-workspace"
    }
  );
  assert.match(call.idempotencyKey ?? "", /^dispatch-1:continue:/);
});

test("task continuation preserves a stable caller idempotency key", async () => {
  const calls: Array<{ idempotencyKey?: string | null; sessionId?: string }> = [];
  const taskDetail = createRunningTaskDetail();
  taskDetail.task.status = "completed";
  taskDetail.task.liveRunCount = 0;
  taskDetail.task.dispatchId = "dispatch-1";
  taskDetail.runs[0]!.status = "completed";

  await controlRunningTaskSession(
    "task-1",
    {
      action: "continue",
      message: "Continue from here",
      dispatchId: "dispatch-1",
      idempotencyKey: "dispatch-1:continue:stable-follow-up"
    },
    {
      adapter: {
        async steerSession() {
          throw new Error("unexpected steer");
        },
        async injectChat() {
          throw new Error("unexpected inject");
        },
        async runAgentTurn(input) {
          calls.push(input);
          return { runId: "run-2", status: "running" };
        }
      },
      getTaskDetail: async () => taskDetail,
      getMissionControlSnapshot: async () => createSnapshot(),
      invalidateMissionControlSnapshotCache: () => {}
    }
  );

  assert.equal(calls[0]?.sessionId, "session-1");
  assert.equal(calls[0]?.idempotencyKey, "dispatch-1:continue:stable-follow-up");
});

test("task continuation returns a warning for medium-confidence session context", async () => {
  const taskDetail = createRunningTaskDetail();
  taskDetail.task.status = "completed";
  taskDetail.task.liveRunCount = 0;
  taskDetail.task.dispatchId = "dispatch-1";
  taskDetail.task.metadata = {
    dispatchId: "dispatch-1",
    provenance: "runtime-derived"
  };
  taskDetail.runs[0]!.status = "completed";

  const response = await controlRunningTaskSession(
    "task-1",
    { action: "continue", message: "Continue from here", dispatchId: "dispatch-1" },
    {
      adapter: {
        async steerSession() {
          throw new Error("unexpected steer");
        },
        async injectChat() {
          throw new Error("unexpected inject");
        },
        async runAgentTurn() {
          return { runId: "run-2", status: "running" };
        }
      },
      getTaskDetail: async () => taskDetail,
      getMissionControlSnapshot: async () => createSnapshot(),
      invalidateMissionControlSnapshotCache: () => {}
    }
  );

  assert.equal(response.target.confidence, "medium");
  assert.match(response.warning ?? "", /runtime-derived OpenClaw session metadata/);
});

test("task continuation rejects none-confidence session context", async () => {
  let called = false;
  const taskDetail = createRunningTaskDetail();
  taskDetail.task.status = "completed";
  taskDetail.task.liveRunCount = 0;
  taskDetail.task.dispatchId = "dispatch-1";
  taskDetail.task.metadata = {
    dispatchId: "dispatch-1",
    continuationConfidence: "none",
    continuationSessionId: "session-1",
    primaryAgentId: "agent-1"
  };
  taskDetail.runs[0]!.status = "completed";

  await assert.rejects(
    () => controlRunningTaskSession(
      "task-1",
      { action: "continue", message: "Continue from here", dispatchId: "dispatch-1" },
      {
        adapter: {
          async steerSession() {
            throw new Error("unexpected steer");
          },
          async injectChat() {
            throw new Error("unexpected inject");
          },
          async runAgentTurn() {
            called = true;
            return { runId: "run-2", status: "running" };
          }
        },
        getTaskDetail: async () => taskDetail,
        getMissionControlSnapshot: async () => createSnapshot(),
        invalidateMissionControlSnapshotCache: () => {}
      }
    ),
    /continuation is disabled/
  );
  assert.equal(called, false);
});

test("task continuation rejects dispatch-only context without a session", async () => {
  let called = false;
  const taskDetail = createRunningTaskDetail();
  taskDetail.task.status = "completed";
  taskDetail.task.liveRunCount = 0;
  taskDetail.task.dispatchId = "dispatch-1";
  taskDetail.task.sessionIds = [];
  taskDetail.task.metadata = {
    dispatchId: "dispatch-1",
    provenance: "dispatch-derived"
  };
  taskDetail.runs[0]!.status = "completed";
  taskDetail.runs[0]!.sessionId = undefined;
  taskDetail.runs[0]!.key = "runtime-1";

  await assert.rejects(
    () => controlRunningTaskSession(
      "task-1",
      { action: "continue", message: "Continue from here", dispatchId: "dispatch-1" },
      {
        adapter: {
          async steerSession() {
            throw new Error("unexpected steer");
          },
          async injectChat() {
            throw new Error("unexpected inject");
          },
          async runAgentTurn() {
            called = true;
            return { runId: "run-2", status: "running" };
          }
        },
        getTaskDetail: async () => taskDetail,
        getMissionControlSnapshot: async () => createSnapshot(),
        invalidateMissionControlSnapshotCache: () => {}
      }
    ),
    /continuation is disabled/
  );
  assert.equal(called, false);
});

test("Gateway event bridge normalizes chat, tool, session, and approval events into runtimes", () => {
  const runtime = normalizeOpenClawGatewayEventToRuntime({
    type: "event",
    event: "approval.requested",
    payload: {
      agentId: "agent-1",
      sessionId: "session-1",
      runId: "run-1",
      approvalId: "approval-1",
      toolName: "shell",
      status: "queued",
      message: "Approval needed"
    }
  });

  assert.ok(runtime);
  assert.equal(runtime.agentId, "agent-1");
  assert.equal(runtime.sessionId, "session-1");
  assert.equal(runtime.runId, "run-1");
  assert.equal(runtime.status, "queued");
  assert.deepEqual(runtime.toolNames, ["shell"]);
  assert.equal(runtime.metadata.origin, "openclaw-gateway-event");
  assert.equal(runtime.metadata.approvalId, "approval-1");
});

test("Gateway event bridge leaves reconnect ownership to the Gateway client", async () => {
  const subscribeCalls: string[] = [];
  const activeSubscription: { close?: () => void } = {};

  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["sessions.subscribe"],
    events: ["session.message"]
  }));
  setOpenClawAdapterForTesting(createContractAdapter({
    async subscribeRuntimeEvents(_input, callbacks) {
      subscribeCalls.push("subscribe");
      let closed = false;
      activeSubscription.close = () => {
        if (closed) {
          return;
        }

        closed = true;
        callbacks.onClose?.();
      };

      return {
        close() {
          activeSubscription.close?.();
        }
      };
    }
  }));

  startOpenClawEventBridge();
  startOpenClawEventBridge();
  await waitFor(() => subscribeCalls.length === 1);

  const closeSubscription = activeSubscription.close;
  if (!closeSubscription) {
    assert.fail("Expected active Gateway event subscription.");
  }
  closeSubscription();

  assert.equal(getOpenClawEventBridgeStatus().connected, false);
  assert.equal(getOpenClawEventBridgeStatus().reconnecting, false);
  assert.equal(getOpenClawEventBridgeStatus().reconnectAttempt, 0);
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(subscribeCalls.length, 1);
  assert.equal(getOpenClawEventBridgeStatus().connected, false);
  assert.equal(getOpenClawEventBridgeStatus().reconnecting, false);
});

test("Gateway event bridge stream status exposes polling recovery without leaking subscription errors", async () => {
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["sessions.subscribe"],
    events: ["session.message", "task"]
  }));
  setOpenClawAdapterForTesting(createContractAdapter({
    async subscribeRuntimeEvents() {
      throw new Error("Gateway event stream rejected token=query-secret");
    }
  }));

  startOpenClawEventBridge();
  await waitFor(() => Boolean(getOpenClawEventBridgeStatus().lastError), 2_000);

  const status = getOpenClawEventBridgeStreamStatus();

  assert.equal(status.mode, "polling");
  assert.equal(status.connected, false);
  assert.match(status.message ?? "", /refreshing task snapshots by polling/i);
  assert.match(status.recovery ?? "", /OpenClaw Gateway event stream failed|\[redacted\]/i);
  assert.doesNotMatch(status.lastError ?? "", /query-secret/);
  assert.doesNotMatch(status.recovery ?? "", /query-secret/);
});

function createContractAdapter(overrides: Partial<OpenClawAdapter> = {}): OpenClawAdapter {
  return {
    async getHealth() {
      return { ok: true };
    },
    async getStatus() {
      return { version: "9.9.9" };
    },
    async getUpdateStatus() {
      return {};
    },
    async getGatewayStatus() {
      return {};
    },
    async getModelStatus() {
      return {};
    },
    async getAgentModelStatus() {
      return {};
    },
    async setModelAuthOrder() {
      return { stdout: "", stderr: "" };
    },
    async listAgents() {
      return { agents: [] };
    },
    async listSessions() {
      return { sessions: [] };
    },
    async describeSession() {
      return {};
    },
    async getSessionHistory() {
      return {};
    },
    async exportSession() {
      return {};
    },
    async listTasks() {
      return { tasks: [] };
    },
    async getTask() {
      return {};
    },
    async assignTask() {
      return {};
    },
    async cancelTask() {
      return {};
    },
    async listArtifacts() {
      return { artifacts: [] };
    },
    async getArtifact() {
      return {};
    },
    async putArtifact() {
      return {};
    },
    async deleteArtifact() {
      return {};
    },
    async getRuntimeSnapshot() {
      return {};
    },
    async getToolsCatalog() {
      return { agentId: "agent-1", profiles: [], groups: [] };
    },
    async getEffectiveTools() {
      return { agentId: "agent-1", profile: "full", groups: [] };
    },
    async invokeTool() {
      return { ok: true, toolName: "shell" };
    },
    async subscribeRuntimeEvents() {
      return {
        close() {
          return undefined;
        }
      };
    },
    async getChannelStatus() {
      return {
        ts: 0,
        channelOrder: [],
        channelLabels: {},
        channels: {},
        channelAccounts: {},
        channelDefaultAccountId: {}
      };
    },
    async getChannelLogs() {
      return { lines: [] };
    },
    async provisionChannelAccount() {
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    async removeChannelAccount() {
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    async setupGmailWebhook() {
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    },
    async listModels() {
      return { models: [] };
    },
    async listSkills() {
      return { skills: [] };
    },
    async listPlugins() {
      return { plugins: [] };
    },
    async scanModels() {
      return [];
    },
    async getConfig() {
      return null;
    },
    async getConfigSchema() {
      return null;
    },
    async lookupConfigSchema() {
      return null;
    },
    async hasConfig() {
      return false;
    },
    async setConfig() {
      return { stdout: "", stderr: "" };
    },
    async unsetConfig() {
      return { stdout: "", stderr: "" };
    },
    async addAgent() {
      return { stdout: "", stderr: "" };
    },
    async updateAgent() {
      return { stdout: "", stderr: "" };
    },
    async setAgentIdentity() {
      return { stdout: "", stderr: "" };
    },
    async deleteAgent() {
      return { stdout: "", stderr: "" };
    },
    async provisionAutomation() {
      return { stdout: "", stderr: "" };
    },
    async runAgentTurn() {
      return {};
    },
    async abortAgentTurn() {
      return {};
    },
    async steerSession() {
      return {};
    },
    async injectChat() {
      return {};
    },
    async streamAgentTurn() {
      return {};
    },
    async probeGateway() {
      return {};
    },
    async controlGateway() {
      return {};
    },
    async approveDeviceAccess() {
      return { requestId: "latest", device: { deviceId: "device-1" } };
    },
    async call<TPayload>() {
      return {} as TPayload;
    },
    async tailLogs() {
      return {};
    },
    async listExecApprovals() {
      return {};
    },
    async resolveExecApproval() {
      return {};
    },
    async getCronStatus() {
      return {};
    },
    async listCronJobs() {
      return {};
    },
    ...overrides
  };
}

function createRunningTaskDetail(): TaskDetailRecord {
  return {
    task: {
      id: "task-1",
      key: "task-1",
      title: "Task",
      mission: "Run task",
      subtitle: "running",
      status: "running",
      updatedAt: Date.now(),
      ageMs: 0,
      workspaceId: "workspace-1",
      primaryAgentId: "agent-1",
      primaryAgentName: "Agent",
      primaryRuntimeId: "runtime-1",
      runtimeIds: ["runtime-1"],
      agentIds: ["agent-1"],
      sessionIds: ["session-1"],
      runIds: ["run-1"],
      runtimeCount: 1,
      updateCount: 1,
      liveRunCount: 1,
      artifactCount: 0,
      warningCount: 0,
      metadata: {}
    },
    runs: [{
      id: "runtime-1",
      source: "turn",
      key: "runtime-1",
      title: "Runtime",
      subtitle: "running",
      status: "running",
      updatedAt: Date.now(),
      ageMs: 0,
      agentId: "agent-1",
      workspaceId: "workspace-1",
      sessionId: "session-1",
      taskId: "task-1",
      runId: "run-1",
      metadata: {}
    }],
    outputs: [],
    liveFeed: [],
    createdFiles: [],
    warnings: [],
    integrity: {
      status: "verified",
      outputDir: null,
      outputDirRelative: null,
      outputDirExists: false,
      outputFileCount: 0,
      transcriptTurnCount: 0,
      matchingTranscriptTurnCount: 0,
      finalResponseText: null,
      finalResponseSource: "none",
      dispatchSessionId: null,
      sessionMismatch: false,
      toolNames: [],
      emails: [],
      issues: []
    }
  };
}

async function waitFor(predicate: () => boolean, timeoutMs = 500) {
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    if (predicate()) {
      return;
    }

    await new Promise((resolve) => setTimeout(resolve, 5));
  }

  assert.fail("Timed out waiting for condition.");
}

function createSnapshot(): MissionControlSnapshot {
  return {
    generatedAt: new Date().toISOString(),
    mode: "live",
    diagnostics: {
      installed: true,
      loaded: true,
      rpcOk: true,
      health: "healthy",
      workspaceRoot: "/tmp",
      configuredWorkspaceRoot: null,
      dashboardUrl: "http://127.0.0.1:18789/",
      gatewayUrl: "ws://127.0.0.1:18789",
      configuredGatewayUrl: null,
      openClawBinarySelection: {
        mode: "auto",
        path: null,
        resolvedPath: null,
        label: "Auto",
        detail: "Auto"
      },
      modelReadiness: {
        ready: true,
        defaultModel: "openai/test",
        resolvedDefaultModel: "openai/test",
        defaultModelReady: true,
        recommendedModelId: null,
        preferredLoginProvider: null,
        totalModelCount: 1,
        availableModelCount: 1,
        localModelCount: 0,
        remoteModelCount: 1,
        missingModelCount: 0,
        authProviders: [],
        issues: []
      },
      configUpdatePacing: {
        settings: { mode: "respect-gateway", minimumIntervalMs: null },
        queueDurability: "persistent",
        pending: false,
        pendingCount: 0,
        pendingPaths: [],
        pendingSince: null,
        cooldownUntil: null,
        retryAfterMs: null,
        lastIssue: null,
        lastUpdatedAt: null
      },
      runtime: {
        stateRoot: "/tmp/.openclaw",
        stateWritable: true,
        sessionStoreWritable: true,
        sessionStores: [],
        smokeTest: {
          status: "passed",
          checkedAt: new Date().toISOString(),
          agentId: "agent-1",
          runId: "run-smoke",
          summary: "ok",
          error: null
        },
        issues: []
      },
      runtimeIssues: [],
      securityWarnings: [],
      issues: []
    },
    presence: [],
    channelAccounts: [],
    workspaces: [{
      id: "workspace-1",
      name: "Workspace",
      slug: "workspace",
      path: "/tmp/agentos-contract-workspace",
      kind: "workspace",
      agentIds: ["agent-1"],
      modelIds: [],
      activeRuntimeIds: [],
      totalSessions: 0,
      health: "ready",
      bootstrap: {
        template: null,
        sourceMode: null,
        agentTemplate: null,
        coreFiles: [],
        optionalFiles: [],
        folders: [],
        projectShell: [],
        localSkillIds: []
      },
      capabilities: {
        skills: [],
        tools: [],
        workspaceOnlyAgentCount: 0
      },
      channels: []
    }],
    agents: [{
      id: "agent-1",
      name: "Agent",
      workspaceId: "workspace-1",
      workspacePath: "/tmp/agentos-contract-workspace",
      modelId: "openai/test",
      isDefault: true,
      status: "ready",
      sessionCount: 0,
      lastActiveAt: null,
      currentAction: "Idle",
      activeRuntimeIds: [],
      heartbeat: {
        enabled: false,
        every: null,
        everyMs: null
      },
      identity: {},
      profile: {
        purpose: null,
        operatingInstructions: [],
        responseStyle: [],
        outputPreference: null,
        sourceFiles: []
      },
      skills: [],
      tools: [],
      policy: {
        preset: "worker",
        missingToolBehavior: "fallback",
        installScope: "workspace",
        fileAccess: "workspace-only",
        networkAccess: "restricted"
      }
    }],
    models: [],
    runtimes: [],
    tasks: [],
    agentInbox: [],
    relationships: [],
    missionPresets: [],
    channelRegistry: {
      version: 1,
      channels: []
    },
    surfaceRuntime: {
      source: "unavailable",
      checkedAt: null,
      gatewayAccess: {
        ok: true,
        blocked: false,
        role: null,
        scopes: [],
        missingScopes: [],
        requestId: null,
        issue: null,
        repairAvailable: false,
        repairAction: null
      },
      providerOrder: [],
      providerLabels: {},
      accountsByProvider: {},
      accountsByKey: {},
      issue: null
    },
    surfaceDrift: {
      checked: false,
      source: "unavailable",
      checkedAt: null,
      expectedBindingCount: 0,
      currentBindingCount: 0,
      summary: {
        ok: 0,
        missingBindings: 0,
        extraBindings: 0,
        agentMismatch: 0,
        accountMissing: 0,
        providerDisabled: 0
      },
      issues: []
    }
  };
}
