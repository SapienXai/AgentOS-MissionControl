import "server-only";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import {
  clearMissionControlRuntimeHistoryCache,
  getMissionControlSnapshot,
  invalidateMissionControlSnapshotCache
} from "@/lib/openclaw/application/mission-control-service";
import { buildTaskDetailFromDispatchRecord, buildTaskDetailFromTaskRecord } from "@/lib/openclaw/domains/task-detail";
import { extractMissionCommandPayloads } from "@/lib/openclaw/domains/mission-dispatch-model";
import { readMissionDispatchRecordById } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  getRuntimeOutputForResolvedRuntime as getRuntimeOutputForResolvedRuntimeFromTranscript
} from "@/lib/openclaw/domains/runtime-transcript";
import {
  getRuntimeSmokeTestCacheEntry,
  isRuntimeSmokeTestFresh,
  mapRuntimeSmokeTestEntry,
  persistRuntimeSmokeTest,
  readMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import { openClawStateRootPath } from "@/lib/openclaw/state/paths";
import { inspectOpenClawRuntimeState } from "@/lib/openclaw/state/runtime-state";
import type {
  MissionControlSnapshot,
  OpenClawRuntimeSmokeTest,
  RuntimeOutputRecord,
  TaskDetailRecord
} from "@/lib/openclaw/types";

const runtimeSmokeTestMessage = "AgentOS runtime smoke test. Reply with a brief READY status.";

function invalidateRuntimeSnapshotCache() {
  invalidateMissionControlSnapshotCache();
}

export function clearRuntimeHistoryCache() {
  clearMissionControlRuntimeHistoryCache();
}

function resolveRuntimeSmokeTestAgentId(
  snapshot: MissionControlSnapshot,
  preferredAgentId?: string | null
) {
  if (preferredAgentId && snapshot.agents.some((agent) => agent.id === preferredAgentId)) {
    return preferredAgentId;
  }

  return snapshot.agents.find((agent) => agent.isDefault)?.id || snapshot.agents[0]?.id || null;
}

async function assertOpenClawRuntimeStateAccess(agentId: string | null) {
  const runtimeState = await inspectOpenClawRuntimeState(openClawStateRootPath, agentId ? [agentId] : [], {
    touch: true
  });

  if (runtimeState.issues.length > 0) {
    invalidateRuntimeSnapshotCache();
    throw new Error(
      `OpenClaw runtime state is not writable. AgentOS needs write access to ${runtimeState.stateRoot} and the agent session store before missions can run.`
    );
  }
}

export async function ensureOpenClawRuntimeStateAccess(options: {
  agentId?: string | null;
} = {}) {
  await assertOpenClawRuntimeStateAccess(options.agentId ?? null);
  invalidateRuntimeSnapshotCache();
  return getMissionControlSnapshot({ force: true, includeHidden: true });
}

export async function touchOpenClawRuntimeStateAccess(options: {
  agentId?: string | null;
} = {}) {
  await assertOpenClawRuntimeStateAccess(options.agentId ?? null);
  invalidateRuntimeSnapshotCache();
}

export async function ensureOpenClawRuntimeSmokeTest(options: {
  agentId?: string | null;
  force?: boolean;
} = {}): Promise<OpenClawRuntimeSmokeTest> {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const agentId = resolveRuntimeSmokeTestAgentId(snapshot, options.agentId);

  if (!agentId) {
    return {
      status: "not-run",
      checkedAt: null,
      agentId: null,
      runId: null,
      summary: null,
      error: "AgentOS could not find an OpenClaw agent for the runtime smoke test."
    };
  }

  const settings = await readMissionControlSettings();
  const cached = getRuntimeSmokeTestCacheEntry(settings, agentId);

  if (!options.force && isRuntimeSmokeTestFresh(cached)) {
    return mapRuntimeSmokeTestEntry(agentId, cached);
  }

  await assertOpenClawRuntimeStateAccess(agentId);

  try {
    const payload = await getOpenClawAdapter().runAgentTurn(
      {
        agentId,
        message: runtimeSmokeTestMessage,
        thinking: "off",
        timeoutSeconds: 45
      },
      { timeoutMs: 50000 }
    );
    const result: OpenClawRuntimeSmokeTest = {
      status: "passed",
      checkedAt: new Date().toISOString(),
      agentId,
      runId: payload.runId ?? null,
      summary:
        payload.summary ||
        extractMissionCommandPayloads(payload)[0]?.text ||
        "AgentOS verified a real OpenClaw turn.",
      error: null
    };

    await persistRuntimeSmokeTest(result);
    invalidateRuntimeSnapshotCache();
    return result;
  } catch (error) {
    const result: OpenClawRuntimeSmokeTest = {
      status: "failed",
      checkedAt: new Date().toISOString(),
      agentId,
      runId: null,
      summary: null,
      error: stringifyCommandFailure(error) || "OpenClaw runtime smoke test failed."
    };

    await persistRuntimeSmokeTest(result);
    invalidateRuntimeSnapshotCache();
    return result;
  }
}

export async function getRuntimeOutput(runtimeId: string): Promise<RuntimeOutputRecord> {
  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);

  if (!runtime) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);
  }

  if (!runtime) {
    return {
      runtimeId,
      status: "missing",
      finalText: null,
      finalTimestamp: null,
      stopReason: null,
      errorMessage: "Runtime was not found in the current OpenClaw snapshot.",
      items: [],
      createdFiles: [],
      warnings: [],
      warningSummary: null
    };
  }

  return getRuntimeOutputForResolvedRuntimeFromTranscript(runtime, snapshot);
}

export async function getTaskDetail(
  taskId: string,
  options: {
    dispatchId?: string | null;
  } = {}
): Promise<TaskDetailRecord> {
  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let task = snapshot.tasks.find((entry) => entry.id === taskId);

  if (!task && options.dispatchId) {
    task = snapshot.tasks.find((entry) => entry.dispatchId === options.dispatchId);
  }

  if (!task) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    task = snapshot.tasks.find((entry) => entry.id === taskId);

    if (!task && options.dispatchId) {
      task = snapshot.tasks.find((entry) => entry.dispatchId === options.dispatchId);
    }
  }

  if (!task) {
    const dispatchId = typeof options.dispatchId === "string" ? options.dispatchId.trim() : "";

    if (dispatchId) {
      const dispatchRecord = await readMissionDispatchRecordById(dispatchId);

      if (dispatchRecord) {
        return buildTaskDetailFromDispatchRecord(dispatchRecord, snapshot);
      }
    }

    throw new Error("Task was not found in the current OpenClaw snapshot.");
  }

  const dispatchRecord = task.dispatchId ? await readMissionDispatchRecordById(task.dispatchId) : null;
  return buildTaskDetailFromTaskRecord(task, snapshot, dispatchRecord);
}
