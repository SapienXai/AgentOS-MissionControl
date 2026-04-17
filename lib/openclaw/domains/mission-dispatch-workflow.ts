import {
  composeMissionWithOutputRouting,
  prepareMissionOutputPlan
} from "@/lib/openclaw/domains/mission-routing";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { renderWorkspaceSurfaceCoordinationMarkdownForAgent } from "@/lib/openclaw/surface-coordination";
import {
  createMissionDispatchRecord,
  findMissionDispatchRecordForTask,
  isMissionDispatchTerminalStatus,
  launchMissionDispatchRunner,
  normalizeMissionAbortReason,
  readMissionDispatchRecordById,
  stopMissionDispatchChildProcess,
  writeMissionDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import { resolveMissionDispatchCompletionDetail } from "@/lib/openclaw/domains/mission-dispatch-model";
import { resolveMissionDispatchReadinessError } from "@/lib/openclaw/readiness";
import type { MissionAbortResponse, MissionControlSnapshot, MissionResponse, MissionSubmission } from "@/lib/openclaw/types";

export type MissionDispatchWorkflowDependencies = {
  getMissionControlSnapshot: (options?: { force?: boolean; includeHidden?: boolean }) => Promise<MissionControlSnapshot>;
  resolveAgentForMission: (snapshot: MissionControlSnapshot, workspaceId?: string) => string | null;
  invalidateMissionControlCaches: () => void;
};

export async function submitMissionDispatch(
  input: MissionSubmission,
  deps: MissionDispatchWorkflowDependencies
): Promise<MissionResponse> {
  const mission = input.mission.trim();

  if (!mission) {
    throw new Error("Mission text is required.");
  }

  const snapshot = await deps.getMissionControlSnapshot({ includeHidden: true });
  const agentId = input.agentId || deps.resolveAgentForMission(snapshot, input.workspaceId);

  if (!agentId) {
    throw new Error("No OpenClaw agent is available for mission dispatch.");
  }

  const missionAgent = snapshot.agents.find((entry) => entry.id === agentId);
  const missionWorkspace =
    snapshot.workspaces.find((entry) => entry.id === (input.workspaceId || missionAgent?.workspaceId)) ??
    (missionAgent
      ? {
          id: missionAgent.workspaceId,
          path: missionAgent.workspacePath
        }
      : null);
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
    ? composeMissionWithOutputRouting(mission, outputPlan, missionAgent?.policy, setupAgentId, workspaceSurfacePrompt)
    : mission;
  const readinessError = resolveMissionDispatchReadinessError(snapshot);

  let dispatchRecord = createMissionDispatchRecord({
    agentId,
    mission,
    routedMission,
    thinking,
    workspaceId: missionWorkspace?.id ?? null,
    workspacePath: missionWorkspace?.path ?? null,
    outputDir: outputPlan?.absoluteOutputDir ?? null,
    outputDirRelative: outputPlan?.relativeOutputDir ?? null,
    notesDirRelative: outputPlan?.notesDirRelative ?? null
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
        outputDir: outputPlan?.absoluteOutputDir,
        outputDirRelative: outputPlan?.relativeOutputDir,
        notesDirRelative: outputPlan?.notesDirRelative
      }
    };
  }

  try {
    dispatchRecord = await launchMissionDispatchRunner(dispatchRecord);
  } catch (error) {
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

  return {
    dispatchId: dispatchRecord.id,
    runId: null,
    agentId,
    status: dispatchRecord.status,
    summary: "Mission accepted and queued for OpenClaw execution.",
    payloads: [],
    meta: {
      outputDir: outputPlan?.absoluteOutputDir,
      outputDirRelative: outputPlan?.relativeOutputDir,
      notesDirRelative: outputPlan?.notesDirRelative
    }
  };
}

export async function abortMissionDispatchTask(
  taskId: string,
  reason: string | null | undefined,
  dispatchId: string | null | undefined,
  deps: MissionDispatchWorkflowDependencies
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
    throw new Error("Mission dispatch record was not found for this task.");
  }

  if (isMissionDispatchTerminalStatus(dispatchRecord.status)) {
    return {
      taskId,
      dispatchId: dispatchRecord.id,
      status: dispatchRecord.status,
      summary: resolveMissionDispatchCompletionDetail(dispatchRecord),
      reason: dispatchRecord.error,
      runnerPid: dispatchRecord.runner.pid,
      childPid: dispatchRecord.runner.childPid,
      abortedAt: dispatchRecord.runner.finishedAt ?? dispatchRecord.updatedAt
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

  const killedChildPid = await stopMissionDispatchChildProcess(nextRecord);

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
