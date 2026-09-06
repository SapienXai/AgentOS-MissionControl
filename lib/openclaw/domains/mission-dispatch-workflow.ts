import {
  composeMissionWithOutputRouting,
  prepareMissionOutputPlan
} from "@/lib/openclaw/domains/mission-routing";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import { renderWorkspaceSurfaceCoordinationMarkdownForAgent } from "@/lib/openclaw/surface-coordination";
import {
  createMissionDispatchRecord,
  findMissionDispatchRecordForTask,
  isMissionDispatchTerminalStatus,
  launchMissionDispatchRunner,
  normalizeMissionAbortReason,
  readMissionDispatchRecords,
  readMissionDispatchRecordById,
  stopMissionDispatchChildProcess,
  writeMissionDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import type { MissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  extractMissionCommandPayloads,
  resolveMissionDispatchCompletionDetail
} from "@/lib/openclaw/domains/mission-dispatch-model";
import type { MissionDispatchRecordLike } from "@/lib/openclaw/domains/mission-dispatch-model";
import { resolveMissionDispatchReadinessError } from "@/lib/openclaw/readiness";
import type {
  MissionAbortResponse,
  MissionControlSnapshot,
  MissionDispatchStatus,
  MissionResponse,
  MissionSubmission
} from "@/lib/openclaw/types";
import {
  finalizeBrowserTaskBinding,
  prepareBrowserTaskBinding
} from "@/lib/agentos/application/browser-task-binding-service";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";
import { buildAgentSessionKey } from "@/lib/openclaw/client/native-ws-gateway-mappers";
import {
  capabilityState,
  resolveIsolatedWorktreeEligibility,
  type NativeWorkExecutionMode
} from "@/lib/openclaw/domains/native-work-model";

export type MissionDispatchWorkflowDependencies = {
  getMissionControlSnapshot: (options?: { force?: boolean; includeHidden?: boolean }) => Promise<MissionControlSnapshot>;
  resolveAgentForMission: (snapshot: MissionControlSnapshot, workspaceId?: string) => string | null;
  invalidateMissionControlCaches: () => void;
};

let missionSubmissionQueue: Promise<void> = Promise.resolve();

export async function submitMissionDispatch(
  input: MissionSubmission,
  deps: MissionDispatchWorkflowDependencies,
  gatewayOptions: OpenClawCommandOptions = {}
): Promise<MissionResponse> {
  const run = missionSubmissionQueue.then(() => submitMissionDispatchOnce(input, deps, gatewayOptions));
  missionSubmissionQueue = run.then(() => undefined, () => undefined);
  return run;
}

async function submitMissionDispatchOnce(
  input: MissionSubmission,
  deps: MissionDispatchWorkflowDependencies,
  gatewayOptions: OpenClawCommandOptions
): Promise<MissionResponse> {
  const mission = input.mission.trim();
  const executionMode: NativeWorkExecutionMode = input.executionMode ?? "standard";

  if (!mission) {
    throw new Error("Mission text is required.");
  }

  const snapshot = await deps.getMissionControlSnapshot({ includeHidden: true });
  const requestId = input.requestId?.trim() || null;
  if (requestId) {
    const existing = (await readMissionDispatchRecords()).find((record) => record.clientRequestId === requestId) ?? null;
    if (existing) {
      const visibleSnapshot = await deps.getMissionControlSnapshot({ includeHidden: false });
      const visible = Boolean(
        visibleSnapshot.agents.some((agent) => agent.id === existing.agentId) ||
        (existing.workspaceId && visibleSnapshot.workspaces.some((workspace) => workspace.id === existing.workspaceId))
      );
      if (!visible || (input.workspaceId && input.workspaceId !== existing.workspaceId) || (input.agentId && input.agentId !== existing.agentId) || existing.mission !== mission) {
        throw new Error("This mission request identity is already in use.");
      }
      return missionResponseFromDispatchRecord(existing);
    }
  }
  const agentId = input.agentId || deps.resolveAgentForMission(snapshot, input.workspaceId);

  if (!agentId) {
    throw new Error(
      "No OpenClaw agent is available for mission dispatch. Finish OpenClaw setup, create a workspace, then create or select an agent."
    );
  }

  const missionAgent = snapshot.agents.find((entry) => entry.id === agentId);
  const sessionKey = buildAgentSessionKey(agentId);
  const missionWorkspace =
    snapshot.workspaces.find((entry) => entry.id === (input.workspaceId || missionAgent?.workspaceId)) ??
    (missionAgent
      ? {
          id: missionAgent.workspaceId,
          path: missionAgent.workspacePath
        }
      : null);
  if (
    input.browserAccount &&
    (
      !missionAgent ||
      !missionWorkspace ||
      missionAgent.workspaceId !== missionWorkspace.id
    )
  ) {
    throw new Error(
      "The selected agent must belong to the browser account workspace."
    );
  }
  const workspaceAgents = missionWorkspace
    ? snapshot.agents.filter((entry) => entry.workspaceId === missionWorkspace.id)
    : [];
  const setupAgentId =
    workspaceAgents.find((entry) => entry.policy.preset === "setup" && entry.id !== missionAgent?.id)?.id ?? null;
  const outputPlan = missionWorkspace
    ? await prepareMissionOutputPlan(missionWorkspace.path, mission)
    : null;
  const thinking = input.thinking ?? "medium";
  const workspaceSurfacePrompt = renderWorkspaceSurfaceCoordinationMarkdownForAgent(agentId, snapshot);
  const routedMission = outputPlan
    ? composeMissionWithOutputRouting(
        mission,
        outputPlan,
        missionAgent?.policy,
        setupAgentId,
        workspaceSurfacePrompt,
        missionAgent ? { id: missionAgent.id, name: missionAgent.name } : null
      )
    : mission;
  const readinessError = resolveMissionDispatchReadinessError(
    snapshot,
    missionAgent?.modelId === "unassigned" ? null : missionAgent?.modelId
  );

  let dispatchRecord = createMissionDispatchRecord({
    clientRequestId: requestId,
    agentId,
    mission,
    routedMission,
    thinking,
    requestedModelId: missionAgent?.modelId && missionAgent.modelId !== "unassigned" ? missionAgent.modelId : null,
    workspaceId: missionWorkspace?.id ?? null,
    workspacePath: missionWorkspace?.path ?? null,
    outputDir: outputPlan?.absoluteOutputDir ?? null,
    outputDirRelative: outputPlan?.relativeOutputDir ?? null,
    notesDirRelative: outputPlan?.notesDirRelative ?? null,
    executionMode
  });

  await writeMissionDispatchRecord(dispatchRecord);

  if (readinessError) {
    dispatchRecord = {
      ...dispatchRecord,
      status: "stalled",
      updatedAt: new Date().toISOString(),
      error: readinessError
    };
    await writeMissionDispatchRecord(dispatchRecord);
    deps.invalidateMissionControlCaches();

    return {
      dispatchId: dispatchRecord.id,
      runId: null,
      agentId,
      status: dispatchRecord.status,
      summary: readinessError,
      payloads: [],
      meta: {
        executionMode,
        outputDir: outputPlan?.absoluteOutputDir,
        outputDirRelative: outputPlan?.relativeOutputDir,
        notesDirRelative: outputPlan?.notesDirRelative
      }
    };
  }

  try {
    const capabilityMatrix = await getOpenClawCapabilityMatrix().catch(() => null);

    if (input.browserAccount && capabilityMatrix?.nativeMissionDispatch !== "supported") {
      throw new Error(
        "Secure browser account tasks require native OpenClaw Gateway mission dispatch. CLI fallback is disabled for task-bound browser profiles."
      );
    }

    if (executionMode === "isolated-worktree") {
      if (input.browserAccount) {
        throw new Error("Isolated worktree execution is unavailable for secure browser account missions.");
      }
      const adapter = getOpenClawAdapter();
      if (!adapter.inspectWorktreeBranches || !adapter.createSession) {
        throw new Error("OpenClaw native worktree session methods are unavailable; standard execution was not selected automatically.");
      }
      const repository = await adapter.inspectWorktreeBranches(
        { repoRoot: missionWorkspace?.path ?? "", includeRepositoryStatus: true },
        { ...gatewayOptions, timeoutMs: 15_000 }
      );
      const eligibility = resolveIsolatedWorktreeEligibility({
        requestedMode: executionMode,
        workspacePath: missionWorkspace?.path ?? null,
        worktreesCapability: capabilityState(capabilityMatrix, "worktrees"),
        repositoryStatus: repository.repositoryStatus ?? null
      });
      if (!eligibility.eligible) {
        throw new Error(`${eligibility.reason} Standard execution was not selected automatically.`);
      }
      const created = await adapter.createSession(
        {
          agentId,
          task: routedMission,
          cwd: missionWorkspace!.path,
          worktree: true,
          idempotencyKey: dispatchRecord.id,
          label: mission.slice(0, 60)
        },
        { ...gatewayOptions, timeoutMs: 60_000 }
      );
      const now = new Date().toISOString();
      const createdStatus: MissionDispatchStatus = created.status === "completed"
        ? "completed"
        : created.status === "error" ? "stalled" : "running";
      dispatchRecord = {
        ...dispatchRecord,
        sessionId: created.sessionId ?? dispatchRecord.sessionId,
        status: createdStatus,
        updatedAt: now,
        runner: {
          ...dispatchRecord.runner,
          startedAt: now,
          finishedAt: createdStatus === "completed" ? now : null,
          lastHeartbeatAt: now
        },
        observation: {
          runtimeId: created.runId ? `runtime:gateway:${created.runId}` : dispatchRecord.observation.runtimeId,
          observedAt: now
        },
        result: {
          runId: created.runId,
          sessionKey: created.key ?? created.sessionKey,
          sessionId: created.sessionId,
          status: createdStatus,
          summary: createdStatus === "running" ? "Isolated worktree session accepted by OpenClaw." : "Isolated worktree session completed.",
          payloads: [],
          meta: { executionMode, worktree: created.worktree ?? null }
        },
        error: createdStatus === "stalled" ? "OpenClaw could not start the isolated worktree session." : null
      };
      await writeMissionDispatchRecord(dispatchRecord);
    }

    if (input.browserAccount) {
      const binding = await prepareBrowserTaskBinding({
        request: input.browserAccount,
        workspaceId: missionWorkspace?.id ?? input.workspaceId ?? "",
        agentId,
        dispatchId: dispatchRecord.id,
        openClawSessionKey: sessionKey,
        openClawSessionId: null
      });
      dispatchRecord = {
        ...dispatchRecord,
        browserBinding: {
          accountId: binding.accountId,
          profileName: binding.profileName,
          status: "active",
          expiresAt: binding.expiresAt,
          releasedAt: null
        },
        updatedAt: new Date().toISOString()
      };
      await writeMissionDispatchRecord(dispatchRecord);
    }

    if (executionMode === "standard" && capabilityMatrix?.nativeMissionDispatch !== "unsupported") {
      const payload = await getOpenClawAdapter().runAgentTurn(
        {
          agentId,
          sessionKey,
          message: routedMission,
          thinking,
          timeoutSeconds: 45,
          workspace: missionWorkspace?.path ?? null,
          dispatchId: dispatchRecord.id
        },
        { ...gatewayOptions, timeoutMs: 60_000 }
      );
      const now = new Date().toISOString();
      // OpenClaw documents agent.wait as a bounded observation call: a wait timeout
      // does not stop the underlying agent run. gateway_draining is therefore not
      // a terminal mission failure; later Gateway/session evidence owns completion.
      const nextStatus = isGatewayWaitOnlyTimeout(payload)
        ? "running"
        : resolveGatewayMissionDispatchStatus(payload.status);
      dispatchRecord = {
        ...dispatchRecord,
        sessionId: payload.sessionId ?? dispatchRecord.sessionId,
        status: nextStatus,
        updatedAt: now,
        runner: {
          ...dispatchRecord.runner,
          startedAt: now,
          finishedAt: nextStatus === "completed" || nextStatus === "stalled" ? now : null,
          lastHeartbeatAt: now
        },
        observation: {
          runtimeId: payload.runId ? `runtime:gateway:${payload.runId}` : dispatchRecord.observation.runtimeId,
          observedAt: now
        },
        result: payload,
        error: nextStatus === "stalled" ? resolveGatewayMissionDispatchError(payload) : null
      };
      await writeMissionDispatchRecord(dispatchRecord);
      if (isMissionDispatchTerminalStatus(dispatchRecord.status) && dispatchRecord.browserBinding) {
        dispatchRecord = await finalizeDispatchBrowserBinding(dispatchRecord);
      }
    } else if (executionMode === "standard") {
      dispatchRecord = await launchMissionDispatchRunner(dispatchRecord);
    }
  } catch (error) {
    if (dispatchRecord.browserBinding?.status === "active") {
      dispatchRecord = await finalizeDispatchBrowserBinding(dispatchRecord).catch(() => ({
        ...dispatchRecord,
        browserBinding: {
          ...dispatchRecord.browserBinding!,
          status: "recovery_required" as const,
          releasedAt: new Date().toISOString()
        }
      }));
    }
    dispatchRecord = {
      ...dispatchRecord,
      status: "stalled",
      updatedAt: new Date().toISOString(),
      error: stringifyCommandFailure(error) || "Mission dispatch runner could not be started."
    };
    await writeMissionDispatchRecord(dispatchRecord);
    deps.invalidateMissionControlCaches();
    throw new Error(dispatchRecord.error ?? "Mission dispatch runner could not be started.");
  }

  deps.invalidateMissionControlCaches();

  const payloads = extractMissionCommandPayloads(dispatchRecord.result);
  const summary =
    dispatchRecord.status === "completed" || dispatchRecord.status === "stalled" || dispatchRecord.status === "cancelled"
      ? resolveMissionDispatchCompletionDetail(dispatchRecord)
      : dispatchRecord.result?.summary || "Mission accepted and queued for OpenClaw execution.";

  return {
    dispatchId: dispatchRecord.id,
    runId: dispatchRecord.result?.runId ?? null,
    agentId,
    status: dispatchRecord.status,
    summary,
    payloads,
    meta: {
      executionMode,
      sessionKey: dispatchRecord.result?.sessionKey ?? null,
      outputDir: outputPlan?.absoluteOutputDir,
      outputDirRelative: outputPlan?.relativeOutputDir,
      notesDirRelative: outputPlan?.notesDirRelative
    }
  };
}

function missionResponseFromDispatchRecord(dispatchRecord: MissionDispatchRecord): MissionResponse {
  const payloads = extractMissionCommandPayloads(dispatchRecord.result);
  const summary = dispatchRecord.status === "completed" || dispatchRecord.status === "stalled" || dispatchRecord.status === "cancelled"
    ? resolveMissionDispatchCompletionDetail(dispatchRecord)
    : dispatchRecord.result?.summary || "Mission accepted and queued for OpenClaw execution.";
  return {
    dispatchId: dispatchRecord.id,
    runId: dispatchRecord.result?.runId ?? null,
    agentId: dispatchRecord.agentId,
    status: dispatchRecord.status,
    summary,
    payloads,
    meta: {
      executionMode: dispatchRecord.executionMode,
      sessionKey: dispatchRecord.result?.sessionKey ?? null,
      outputDir: dispatchRecord.outputDir,
      outputDirRelative: dispatchRecord.outputDirRelative,
      notesDirRelative: dispatchRecord.notesDirRelative,
      idempotentReplay: true
    }
  };
}

export async function abortMissionDispatchTask(
  taskId: string,
  reason: string | null | undefined,
  dispatchId: string | null | undefined,
  deps: MissionDispatchWorkflowDependencies,
  gatewayOptions: OpenClawCommandOptions = {}
): Promise<MissionAbortResponse> {
  const snapshot = await deps.getMissionControlSnapshot({ includeHidden: true });
  const task = snapshot.tasks.find((entry) => entry.id === taskId);
  const dispatchRecord = task
    ? await findMissionDispatchRecordForTask(task)
    : dispatchId
      ? await readMissionDispatchRecordById(dispatchId)
      : null;

  if (!task && !dispatchRecord) {
    throw new Error("Task was not found in the current OpenClaw snapshot.");
  }

  if (!dispatchRecord) {
    return abortNativeGatewayTask(task, taskId, reason, deps, gatewayOptions);
  }

  if (isMissionDispatchTerminalStatus(dispatchRecord.status)) {
    const terminalRecord =
      dispatchRecord.browserBinding?.status === "active"
        ? await finalizeDispatchBrowserBinding(dispatchRecord)
        : dispatchRecord;
    return {
      taskId,
      dispatchId: terminalRecord.id,
      status: terminalRecord.status,
      summary: resolveMissionDispatchCompletionDetail(terminalRecord),
      reason: terminalRecord.error,
      runnerPid: terminalRecord.runner.pid,
      childPid: terminalRecord.runner.childPid,
      abortedAt: terminalRecord.runner.finishedAt ?? terminalRecord.updatedAt
    };
  }

  const abortedAt = new Date().toISOString();
  const abortReason = normalizeMissionAbortReason(reason);
  const nextRecord = {
    ...dispatchRecord,
    status: "cancelled" as const,
    updatedAt: abortedAt,
    error: abortReason,
    runner: {
      ...dispatchRecord.runner,
      finishedAt: abortedAt,
      lastHeartbeatAt: abortedAt
    }
  };

  await writeMissionDispatchRecord(nextRecord);
  deps.invalidateMissionControlCaches();

  let killedChildPid: number | null = null;
  const runId = dispatchRecord.result?.runId ?? null;
  const adapter = getOpenClawAdapter();

  for (const gatewayTaskId of resolveGatewayTaskCancelIds(task, dispatchRecord)) {
    await adapter.cancelTask({
      taskId: gatewayTaskId,
      reason: abortReason
    }, { ...gatewayOptions, timeoutMs: 15_000 }).catch(() => null);
  }

  const sessionKey = readDispatchSessionKey(dispatchRecord);
  if (runId || dispatchRecord.sessionId || sessionKey) {
    await adapter.abortAgentTurn({
      runId,
      sessionId: dispatchRecord.sessionId,
      sessionKey,
      agentId: dispatchRecord.agentId,
      reason: abortReason
    }, { ...gatewayOptions, timeoutMs: 15_000 }).catch(() => null);
  }

  killedChildPid = await stopMissionDispatchChildProcess(nextRecord);
  if (nextRecord.browserBinding?.status === "active") {
    await finalizeDispatchBrowserBinding(nextRecord);
  }

  return {
    taskId,
    dispatchId: nextRecord.id,
    status: nextRecord.status,
    summary: abortReason,
    reason: abortReason,
    runnerPid: nextRecord.runner.pid,
    childPid: killedChildPid ?? nextRecord.runner.childPid,
    abortedAt
  };
}

function readDispatchSessionKey(record: MissionDispatchRecordLike) {
  const result = record.result;
  if (!result || typeof result !== "object") {
    return null;
  }

  const value = (result as Record<string, unknown>).sessionKey;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

async function finalizeDispatchBrowserBinding<T extends MissionDispatchRecordLike>(record: T): Promise<T> {
  if (!record.browserBinding || record.browserBinding.status !== "active") return record;
  const result = await finalizeBrowserTaskBinding(record.id);
  const now = new Date().toISOString();
  const nextRecord = {
    ...record,
    updatedAt: now,
    browserBinding: {
      ...record.browserBinding,
      status: result.cleanupFailed ? "recovery_required" as const : "released" as const,
      releasedAt: now
    }
  };
  await writeMissionDispatchRecord(nextRecord);
  return nextRecord as T;
}

function resolveGatewayTaskCancelIds(
  task: MissionControlSnapshot["tasks"][number] | undefined,
  dispatchRecord: { id: string; result?: Record<string, unknown> | null } | null
) {
  const candidates = [
    readGatewayTaskId(dispatchRecord?.result),
    readGatewayTaskId(dispatchRecord?.result?.task),
    readGatewayTaskId(task?.metadata),
    task?.metadata.gatewayObjectKind === "task" ? task.metadata.taskId : null,
    task?.metadata.gatewayObjectKind === "task" ? task?.key : null
  ];
  const unique = new Set<string>();

  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() && candidate !== dispatchRecord?.id) {
      unique.add(candidate.trim());
    }
  }

  return [...unique];
}

async function abortNativeGatewayTask(
  task: MissionControlSnapshot["tasks"][number] | undefined,
  taskId: string,
  reason: string | null | undefined,
  deps: MissionDispatchWorkflowDependencies,
  gatewayOptions: OpenClawCommandOptions
): Promise<MissionAbortResponse> {
  if (!task) {
    throw new Error("Task was not found in the current OpenClaw snapshot.");
  }

  if (task.status === "completed" || task.status === "stalled" || task.status === "cancelled") {
    return {
      taskId,
      dispatchId: null,
      status: task.status,
      summary: task.subtitle || "Task is already terminal.",
      reason: null,
      runnerPid: null,
      childPid: null,
      abortedAt: new Date().toISOString()
    };
  }

  const abortReason = normalizeMissionAbortReason(reason);
  const gatewayTaskIds = resolveGatewayTaskCancelIds(task, null);

  if (gatewayTaskIds.length === 0) {
    throw new Error("Mission dispatch record was not found and the task does not expose a Gateway task id.");
  }

  for (const gatewayTaskId of gatewayTaskIds) {
    await getOpenClawAdapter().cancelTask({
      taskId: gatewayTaskId,
      reason: abortReason
    }, { ...gatewayOptions, timeoutMs: 15_000 });
  }

  deps.invalidateMissionControlCaches();

  return {
    taskId,
    dispatchId: null,
    status: "cancelled",
    summary: abortReason,
    reason: abortReason,
    runnerPid: null,
    childPid: null,
    abortedAt: new Date().toISOString()
  };
}

function readGatewayTaskId(value: unknown) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const record = value as Record<string, unknown>;
  const taskId =
    record.gatewayTaskId ??
    record.openClawTaskId ??
    record.taskId ??
    record.id;

  return typeof taskId === "string" && taskId.trim() ? taskId.trim() : null;
}

function resolveGatewayMissionDispatchStatus(status: string | undefined): MissionDispatchStatus {
  const normalized = status?.trim().toLowerCase();

  if (normalized === "completed" || normalized === "complete" || normalized === "succeeded" || normalized === "success") {
    return "completed";
  }

  if (normalized === "cancelled" || normalized === "canceled") {
    return "cancelled";
  }

  if (
    normalized === "stalled" ||
    normalized === "timeout" ||
    normalized === "timed_out" ||
    normalized === "failed" ||
    normalized === "error"
  ) {
    return "stalled";
  }

  return "running";
}

function isGatewayWaitOnlyTimeout(payload: { status?: string; timeoutPhase?: string }) {
  const status = payload.status?.trim().toLowerCase();
  const timeoutPhase = payload.timeoutPhase?.trim().toLowerCase();

  return (status === "timeout" || status === "timed_out") && timeoutPhase === "gateway_draining";
}

function resolveGatewayMissionDispatchError(payload: { status?: string; summary?: string }) {
  const summary = payload.summary?.trim();
  if (summary) {
    return summary;
  }

  const status = payload.status?.trim().toLowerCase();
  const timeoutPhase =
    typeof (payload as Record<string, unknown>).timeoutPhase === "string"
      ? ((payload as Record<string, unknown>).timeoutPhase as string).trim()
      : "";

  if (status === "timeout" || status === "timed_out") {
    return timeoutPhase
      ? `OpenClaw Gateway wait timed out during ${timeoutPhase}.`
      : "OpenClaw Gateway wait timed out before an agent response was captured.";
  }

  return "OpenClaw Gateway dispatch stalled before an agent response was captured.";
}
