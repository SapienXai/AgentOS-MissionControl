import type { MissionControlSnapshot, RuntimeRecord, TaskDetailRecord, TaskRecord } from "@/lib/openclaw/types";
import type { MissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  buildTaskIntegrityRecord as buildTaskIntegrityRecordFromMissionDispatch
} from "@/lib/openclaw/domains/mission-dispatch";
import {
  extractMissionDispatchSessionId,
  reconcileTaskRecordWithDispatchRecord
} from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  buildMissionDispatchFeed as buildMissionDispatchFeedFromDomain,
  buildTaskFeed as buildTaskFeedFromDomain,
  mergeTaskFeedEvents as mergeTaskFeedEventsFromDomain
} from "@/lib/openclaw/domains/task-feed";
import {
  buildTaskRecord,
  dedupeCreatedFiles,
  extractCreatedFilesFromRuntimeMetadata,
  extractWarningsFromRuntimeMetadata
} from "@/lib/openclaw/domains/task-records";
import {
  buildObservedMissionDispatchRuntime,
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  createMissionDispatchRuntime as createMissionDispatchRuntimeFromRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { getRuntimeOutputForResolvedRuntime as getRuntimeOutputForResolvedRuntimeFromTranscript } from "@/lib/openclaw/domains/runtime-transcript";

export async function buildTaskDetailFromTaskRecord(
  task: TaskRecord,
  snapshot: MissionControlSnapshot,
  dispatchRecord: MissionDispatchRecord | null
): Promise<TaskDetailRecord> {
  const runs = task.runtimeIds
    .map((runtimeId) => snapshot.runtimes.find((runtime) => runtime.id === runtimeId))
    .filter((runtime): runtime is RuntimeRecord => Boolean(runtime))
    .sort(sortRuntimesByUpdatedAtDesc);

  return buildTaskDetailFromResolvedRuns(task, runs, snapshot, dispatchRecord);
}

export async function buildTaskDetailFromDispatchRecord(
  dispatchRecord: MissionDispatchRecord,
  snapshot: MissionControlSnapshot
): Promise<TaskDetailRecord> {
  const agentNameById = new Map(snapshot.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]));
  const dispatchRuntimes = snapshot.runtimes
    .filter((runtime) => matchesDispatchRecordRuntime(runtime, dispatchRecord))
    .sort(sortRuntimesByUpdatedAtDesc);
  const fallbackRuntime =
    dispatchRuntimes[0] ??
    (await buildObservedMissionDispatchRuntime(dispatchRecord)) ??
    createMissionDispatchRuntimeFromRuntime(dispatchRecord, Date.now());
  const runs = dispatchRuntimes.length > 0 ? dispatchRuntimes : [fallbackRuntime];
  const task = buildTaskRecord(`dispatch:${dispatchRecord.id}`, runs, agentNameById);

  return buildTaskDetailFromResolvedRuns(task, runs, snapshot, dispatchRecord);
}

async function buildTaskDetailFromResolvedRuns(
  task: TaskRecord,
  runs: RuntimeRecord[],
  snapshot: MissionControlSnapshot,
  dispatchRecord: MissionDispatchRecord | null
): Promise<TaskDetailRecord> {
  const outputs = await Promise.all(
    runs.map((runtime) => getRuntimeOutputForResolvedRuntimeFromTranscript(runtime, snapshot))
  );
  const outputByRuntimeId = new Map(outputs.map((output) => [output.runtimeId, output]));
  const createdFiles = dedupeCreatedFiles(
    outputs.flatMap((output) => output.createdFiles).concat(
      runs.flatMap((runtime) => extractCreatedFilesFromRuntimeMetadata(runtime))
    )
  );
  const warnings = uniqueStrings(
    outputs.flatMap((output) => output.warnings).concat(
      runs.flatMap((runtime) => extractWarningsFromRuntimeMetadata(runtime))
    )
  );
  const reconciledTask = dispatchRecord ? reconcileTaskRecordWithDispatchRecord(task, dispatchRecord) : task;
  const bootstrapFeed = await buildMissionDispatchFeedFromDomain(reconciledTask, dispatchRecord, snapshot);
  const runtimeFeed = buildTaskFeedFromDomain(reconciledTask, runs, outputByRuntimeId, snapshot);
  const integrity = await buildTaskIntegrityRecordFromMissionDispatch({
    task: reconciledTask,
    runs,
    outputs,
    createdFiles,
    dispatchRecord,
    snapshot
  });

  return {
    task: reconciledTask,
    runs,
    outputs,
    liveFeed: mergeTaskFeedEventsFromDomain(bootstrapFeed, runtimeFeed),
    createdFiles,
    warnings,
    integrity
  };
}

function matchesDispatchRecordRuntime(runtime: RuntimeRecord, dispatchRecord: MissionDispatchRecord) {
  const runtimeDispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";

  if (runtimeDispatchId === dispatchRecord.id) {
    return true;
  }

  const dispatchSessionId = extractMissionDispatchSessionId(dispatchRecord);
  return Boolean(
    dispatchSessionId &&
      runtime.sessionId === dispatchSessionId &&
      runtime.agentId === dispatchRecord.agentId &&
      !isDirectChatRuntime(runtime)
  );
}

function isDirectChatRuntime(runtime: RuntimeRecord) {
  return typeof runtime.metadata.kind === "string" && runtime.metadata.kind === "direct";
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sortRuntimesByUpdatedAtDesc(left: RuntimeRecord, right: RuntimeRecord) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}
