import type { MissionControlSnapshot, RuntimeRecord, TaskDetailRecord, TaskFeedEvent, TaskRecord } from "@/lib/openclaw/types";
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
  extractWarningsFromRuntimeMetadata,
  normalizeTaskSessionReferences
} from "@/lib/openclaw/domains/task-records";
import {
  buildObservedMissionDispatchRuntime,
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  createMissionDispatchRuntime as createMissionDispatchRuntimeFromRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { getRuntimeOutputForResolvedRuntime as getRuntimeOutputForResolvedRuntimeFromTranscript } from "@/lib/openclaw/domains/runtime-transcript";
import {
  deriveTaskFollowUpsFromRuntimes,
  mergeTaskFollowUps,
  readTaskFollowUpsFromMetadata
} from "@/lib/openclaw/domains/task-follow-up-records";

export async function buildTaskDetailFromTaskRecord(
  task: TaskRecord,
  snapshot: MissionControlSnapshot,
  dispatchRecord: MissionDispatchRecord | null
): Promise<TaskDetailRecord> {
  const directRuns = task.runtimeIds
    .map((runtimeId) => snapshot.runtimes.find((runtime) => runtime.id === runtimeId))
    .filter((runtime): runtime is RuntimeRecord => Boolean(runtime));
  const collectedRuns = collectTaskDetailRuns(task, directRuns, snapshot.runtimes);
  const runs = (dispatchRecord ? scopeRunsToDispatch(collectedRuns, dispatchRecord) : collectedRuns)
    .sort(sortRuntimesByUpdatedAtDesc);

  return buildTaskDetailFromResolvedRuns(task, runs, snapshot, dispatchRecord);
}

export async function buildTaskDetailFromDispatchRecord(
  dispatchRecord: MissionDispatchRecord,
  snapshot: MissionControlSnapshot
): Promise<TaskDetailRecord> {
  const agentNameById = new Map(snapshot.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]));
  const dispatchRuntimes = scopeRunsToDispatch(snapshot.runtimes, dispatchRecord);
  dispatchRuntimes.sort(sortRuntimesByUpdatedAtDesc);
  const fallbackRuntime =
    dispatchRuntimes[0] ??
    (await buildObservedMissionDispatchRuntime(dispatchRecord)) ??
    createMissionDispatchRuntimeFromRuntime(dispatchRecord, Date.now());
  const runs = dispatchRuntimes.length > 0 ? dispatchRuntimes : [fallbackRuntime];
  const task = buildTaskRecord(`dispatch:${dispatchRecord.id}`, runs, agentNameById);

  return buildTaskDetailFromResolvedRuns(task, runs, snapshot, dispatchRecord);
}

function matchesExactDispatchRuntime(runtime: RuntimeRecord, dispatchRecord: MissionDispatchRecord) {
  const runtimeDispatchId = typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const runtimeObservationId = dispatchRecord.observation.runtimeId?.trim() || "";
  return runtimeDispatchId === dispatchRecord.id || runtime.runId === dispatchRecord.id || runtime.id === runtimeObservationId;
}

function scopeRunsToDispatch(runtimes: RuntimeRecord[], dispatchRecord: MissionDispatchRecord) {
  const exactDispatchRuntimes = runtimes.filter((runtime) => matchesExactDispatchRuntime(runtime, dispatchRecord));
  const selected = exactDispatchRuntimes.length > 0
    ? exactDispatchRuntimes
    : runtimes.filter((runtime) => matchesDispatchRecordRuntime(runtime, dispatchRecord));

  return selected.map((runtime) => ({
    ...runtime,
    metadata: {
      ...runtime.metadata,
      dispatchId: dispatchRecord.id,
      mission: dispatchRecord.mission,
      routedMission: dispatchRecord.routedMission,
      dispatchSubmittedAt: dispatchRecord.submittedAt,
      sessionKey:
        typeof dispatchRecord.result?.sessionKey === "string"
          ? dispatchRecord.result.sessionKey
          : runtime.metadata.sessionKey
    }
  }));
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
  const reconciledTask = reconcileTaskRecordWithRuns(
    dispatchRecord ? reconcileTaskRecordWithDispatchRecord(task, dispatchRecord) : task,
    runs,
    createdFiles,
    warnings
  );
  const enrichedTask = enrichTaskRecordWithRuntimeOutputs(reconciledTask, runs, outputs, createdFiles, warnings);
  const bootstrapFeed = await buildMissionDispatchFeedFromDomain(enrichedTask, dispatchRecord, snapshot);
  const runtimeFeed = buildTaskFeedFromDomain(enrichedTask, runs, outputByRuntimeId, snapshot);
  const rawIntegrity = await buildTaskIntegrityRecordFromMissionDispatch({
    task: enrichedTask,
    runs,
    outputs,
    createdFiles,
    dispatchRecord,
    snapshot
  });
  const operationFeed = readOperationFeed(enrichedTask.metadata.operationFeed);
  const integrity = reconcileOperationIntegrity(enrichedTask, rawIntegrity, operationFeed);

  return {
    task: enrichedTask,
    runs,
    outputs,
    liveFeed: mergeTaskFeedEventsFromDomain(bootstrapFeed, runtimeFeed, operationFeed),
    createdFiles,
    warnings,
    integrity
  };
}

function reconcileOperationIntegrity(
  task: TaskRecord,
  integrity: TaskDetailRecord["integrity"],
  operationFeed: TaskFeedEvent[]
): TaskDetailRecord["integrity"] {
  const operationJobId = typeof task.metadata.operationJobId === "string"
    ? task.metadata.operationJobId.trim()
    : "";
  if (!operationJobId) return integrity;

  const resultPreview = typeof task.metadata.resultPreview === "string"
    ? task.metadata.resultPreview.trim()
    : "";
  const latestResult = [...operationFeed]
    .filter((event) => event.kind === "assistant" && event.detail.trim())
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))[0];
  const finalResponseText = latestResult?.detail.trim() || resultPreview || null;
  if (!finalResponseText) return integrity;

  const issues = integrity.issues.filter(
    (issue) => issue.id !== "missing-final-response" && issue.id !== "missing-transcript"
  );
  if (task.status === "stalled" && !issues.some((issue) => issue.id === "partial-final-response")) {
    issues.unshift({
      id: "partial-final-response",
      severity: "warning",
      title: "Scheduled run stopped before completion",
      detail: "OpenClaw captured an intermediate assistant response, but the run stopped before a final result was confirmed. Review the partial output, then retry or acknowledge this run."
    });
  }
  return {
    ...integrity,
    status: issues.some((issue) => issue.severity === "error")
      ? "error"
      : issues.length > 0
        ? "warning"
        : "verified",
    transcriptTurnCount: Math.max(integrity.transcriptTurnCount, operationFeed.length),
    matchingTranscriptTurnCount: Math.max(integrity.matchingTranscriptTurnCount, operationFeed.length),
    finalResponseText,
    // OpenClaw chat.history is Gateway evidence associated with the cron dispatch.
    finalResponseSource: "dispatch",
    issues
  };
}

function readOperationFeed(value: unknown): TaskFeedEvent[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is TaskFeedEvent => {
    if (!entry || typeof entry !== "object") return false;
    const candidate = entry as Partial<TaskFeedEvent>;
    return Boolean(
      typeof candidate.id === "string" &&
      typeof candidate.kind === "string" &&
      typeof candidate.timestamp === "string" &&
      typeof candidate.title === "string" &&
      typeof candidate.detail === "string"
    );
  });
}

function enrichTaskRecordWithRuntimeOutputs(
  task: TaskRecord,
  runs: RuntimeRecord[],
  outputs: Awaited<ReturnType<typeof getRuntimeOutputForResolvedRuntimeFromTranscript>>[],
  createdFiles: ReturnType<typeof dedupeCreatedFiles>,
  warnings: string[]
): TaskRecord {
  const finalOutput = resolveLatestRuntimeFinalOutput(outputs);
  const finalText = finalOutput?.finalText?.trim() || null;
  const resultPreview =
    finalText ||
    (typeof task.metadata.resultPreview === "string" ? task.metadata.resultPreview.trim() : "") ||
    task.subtitle;
  const turnCount = outputs.filter((output) => output.items.length > 0).length;
  const recoveredCompletion = task.status === "stalled" && finalOutput ? isCompletedRuntimeOutput(finalOutput) : false;
  const followUps = mergeTaskFollowUps(
    readTaskFollowUpsFromMetadata(task.metadata),
    deriveTaskFollowUpsFromRuntimes(task, runs, outputs)
  );

  return {
    ...task,
    status: recoveredCompletion ? "completed" : task.status,
    subtitle: finalText ? summarizeText(finalText, 160) : task.subtitle,
    artifactCount: createdFiles.length,
    warningCount: warnings.length,
    metadata: {
      ...task.metadata,
      resultPreview,
      turnCount: turnCount || task.metadata.turnCount,
      finalResponseText: finalText,
      finalResponseRuntimeId: finalOutput?.runtimeId ?? null,
      followUps
    }
  };
}

function reconcileTaskRecordWithRuns(
  task: TaskRecord,
  runs: RuntimeRecord[],
  createdFiles: ReturnType<typeof dedupeCreatedFiles>,
  warnings: string[]
): TaskRecord {
  const sortedRuns = [...runs].sort(sortRuntimesByUpdatedAtDesc);
  const latestRuntime = sortedRuns[0] ?? null;
  const runtimeIds = sortedRuns.map((runtime) => runtime.id);
  const runIds = uniqueStrings(sortedRuns.flatMap((runtime) => (runtime.runId ? [runtime.runId] : [])));
  const sessionIds = uniqueStrings(
    sortedRuns.flatMap((runtime) => normalizeTaskSessionReferences(runtime.sessionId))
  );

  return {
    ...task,
    updatedAt: latestRuntime?.updatedAt ?? task.updatedAt,
    ageMs: latestRuntime?.ageMs ?? task.ageMs,
    primaryRuntimeId: task.primaryRuntimeId && runtimeIds.includes(task.primaryRuntimeId)
      ? task.primaryRuntimeId
      : latestRuntime?.id ?? task.primaryRuntimeId,
    runtimeIds,
    runIds,
    sessionIds,
    runtimeCount: runtimeIds.length,
    updateCount: sortedRuns.filter((runtime) => runtime.source === "turn").length,
    liveRunCount: sortedRuns.filter((runtime) => runtime.status === "running" || runtime.status === "queued").length,
    artifactCount: createdFiles.length,
    warningCount: warnings.length,
    tokenUsage: aggregateTaskDetailRuntimeTokenUsage(sortedRuns) ?? task.tokenUsage,
    metadata: {
      ...task.metadata,
      turnCount: runIds.length || task.metadata.turnCount,
      sessionCount: sessionIds.length || task.metadata.sessionCount
    }
  };
}

function aggregateTaskDetailRuntimeTokenUsage(runs: RuntimeRecord[]) {
  const usages = runs
    .map((runtime) => runtime.tokenUsage)
    .filter((usage): usage is NonNullable<RuntimeRecord["tokenUsage"]> => Boolean(usage));

  if (usages.length === 0) {
    return undefined;
  }

  return usages.reduce(
    (total, usage) => ({
      input: total.input + (usage?.input ?? 0),
      output: total.output + (usage?.output ?? 0),
      total: total.total + (usage?.total ?? 0),
      cacheRead: (total.cacheRead ?? 0) + (usage?.cacheRead ?? 0)
    }),
    { input: 0, output: 0, total: 0, cacheRead: 0 }
  );
}

function resolveLatestRuntimeFinalOutput(
  outputs: Awaited<ReturnType<typeof getRuntimeOutputForResolvedRuntimeFromTranscript>>[]
) {
  const withFinalText = outputs
    .filter((output) => output.finalText?.trim())
    .sort(sortRuntimeOutputsByFinalTimestampDesc);

  if (withFinalText.length > 0) {
    return withFinalText[0] ?? null;
  }

  return outputs
    .filter((output) => output.errorMessage?.trim() && !isMissingTranscriptMessage(output.errorMessage))
    .sort(sortRuntimeOutputsByFinalTimestampDesc)[0] ?? null;
}

function sortRuntimeOutputsByFinalTimestampDesc(
  left: Awaited<ReturnType<typeof getRuntimeOutputForResolvedRuntimeFromTranscript>>,
  right: Awaited<ReturnType<typeof getRuntimeOutputForResolvedRuntimeFromTranscript>>
) {
  return timestampScore(right.finalTimestamp) - timestampScore(left.finalTimestamp);
}

function timestampScore(value: string | null | undefined) {
  const timestamp = value ? Date.parse(value) : Number.NaN;
  return Number.isNaN(timestamp) ? 0 : timestamp;
}

function isCompletedRuntimeOutput(
  output: Awaited<ReturnType<typeof getRuntimeOutputForResolvedRuntimeFromTranscript>>
) {
  const stopReason = output.stopReason?.trim();

  return Boolean(
    output.finalText?.trim() &&
      output.status === "available" &&
      !output.errorMessage &&
      stopReason &&
      stopReason !== "toolUse" &&
      stopReason !== "error" &&
      stopReason !== "aborted"
  );
}

function isMissingTranscriptMessage(value: string | null | undefined) {
  return (
    typeof value === "string" &&
    (/No transcript file was found for this runtime session/i.test(value) ||
      /No transcript entries were found for this runtime/i.test(value))
  );
}

function matchesDispatchRecordRuntime(runtime: RuntimeRecord, dispatchRecord: MissionDispatchRecord) {
  const runtimeDispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";

  if (runtimeDispatchId === dispatchRecord.id) {
    return true;
  }

  const dispatchSessionId = extractMissionDispatchSessionId(dispatchRecord);
  if (dispatchSessionId && runtime.sessionId === dispatchSessionId && runtime.agentId === dispatchRecord.agentId) {
    return true;
  }

  return false;
}

function collectTaskDetailRuns(
  task: TaskRecord,
  directRuns: RuntimeRecord[],
  allRuntimes: RuntimeRecord[]
) {
  const byId = new Map(directRuns.map((runtime) => [runtime.id, runtime]));
  const dispatchId = task.dispatchId?.trim() || null;
  const sessionIds = new Set(task.sessionIds.flatMap((value) => normalizeTaskSessionReferences(value)));
  const runIds = new Set(task.runIds.map((value) => value.trim()).filter(Boolean));
  const agentIds = new Set(task.agentIds.map((value) => value.trim()).filter(Boolean));
  if (task.primaryAgentId) {
    agentIds.add(task.primaryAgentId);
  }

  for (const runtime of allRuntimes) {
    if (byId.has(runtime.id)) {
      continue;
    }

    if (runtimeMatchesTaskContext(runtime, { dispatchId, sessionIds, runIds, agentIds })) {
      byId.set(runtime.id, runtime);
    }
  }

  expandTaskRunsByMatchedRunId(byId, allRuntimes);

  return [...byId.values()];
}

function expandTaskRunsByMatchedRunId(byId: Map<string, RuntimeRecord>, allRuntimes: RuntimeRecord[]) {
  const matchedRunIds = new Set(
    [...byId.values()]
      .map((runtime) => runtime.runId?.trim())
      .filter((value): value is string => Boolean(value))
  );

  if (matchedRunIds.size === 0) {
    return;
  }

  for (const runtime of allRuntimes) {
    if (byId.has(runtime.id) || !runtime.runId || !matchedRunIds.has(runtime.runId)) {
      continue;
    }

    byId.set(runtime.id, runtime);
  }
}

function runtimeMatchesTaskContext(
  runtime: RuntimeRecord,
  context: {
    dispatchId: string | null;
    sessionIds: Set<string>;
    runIds: Set<string>;
    agentIds: Set<string>;
  }
) {
  const runtimeDispatchId = readRuntimeMetadataString(runtime, "dispatchId");
  if (context.dispatchId && runtimeDispatchId === context.dispatchId) {
    return true;
  }

  if (runtime.runId && context.runIds.has(runtime.runId)) {
    return true;
  }

  const sessionIds = normalizeTaskSessionReferences(runtime.sessionId);
  if (sessionIds.length === 0 || !sessionIds.some((sessionId) => context.sessionIds.has(sessionId))) {
    return false;
  }

  if (context.agentIds.size === 0) {
    return true;
  }

  return Boolean(runtime.agentId && context.agentIds.has(runtime.agentId));
}

function readRuntimeMetadataString(runtime: RuntimeRecord, key: string) {
  const value = runtime.metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function sortRuntimesByUpdatedAtDesc(left: RuntimeRecord, right: RuntimeRecord) {
  return (right.updatedAt ?? 0) - (left.updatedAt ?? 0);
}

function summarizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}
