import { createHash } from "node:crypto";

import { matchesMissionRuntime } from "@/lib/openclaw/runtime-matching";
import { compactMissionText, stripMissionRouting } from "@/lib/openclaw/presenters";
import {
  extractMissionDispatchModelId,
  extractMissionDispatchSessionId,
  extractMissionDispatchTokenUsage,
  resolveMissionDispatchBootstrapStage,
  resolveMissionDispatchCompletionDetail,
  resolveMissionDispatchIntegrityWarning,
  resolveMissionDispatchRuntimeStatus,
  resolveMissionDispatchSubtitle
} from "@/lib/openclaw/domains/mission-dispatch-model";
import type { MissionDispatchRecordLike } from "@/lib/openclaw/domains/mission-dispatch-model";
import type { RuntimeRecord } from "@/lib/openclaw/types";

export type MissionDispatchRuntimeLifecycleHelpers = {
  buildObservedRuntime: (record: MissionDispatchRecordLike) => Promise<RuntimeRecord | null>;
  persistObservation: (record: MissionDispatchRecordLike, runtime: RuntimeRecord) => Promise<void>;
  reconcileRuntimeState: (record: MissionDispatchRecordLike, runtime: RuntimeRecord) => Promise<void>;
};

export function annotateMissionDispatchMetadata(
  runtimes: RuntimeRecord[],
  records: MissionDispatchRecordLike[]
) {
  if (runtimes.length === 0 || records.length === 0) {
    return runtimes;
  }

  const annotated = [...runtimes];
  const runtimeIndexById = new Map(annotated.map((runtime, index) => [runtime.id, index]));

  for (const record of records) {
    const observedRuntimeId = record.observation.runtimeId?.trim();
    const observedRuntime =
      observedRuntimeId && runtimeIndexById.has(observedRuntimeId)
        ? annotated[runtimeIndexById.get(observedRuntimeId)!]
        : null;
    const matchedRuntime = observedRuntime ?? matchMissionDispatchToRuntime(record, annotated);

    if (!matchedRuntime) {
      continue;
    }

    const runtimeIndex = runtimeIndexById.get(matchedRuntime.id);

    if (typeof runtimeIndex !== "number") {
      continue;
    }

    annotated[runtimeIndex] = annotateRuntimeWithMissionDispatch(matchedRuntime, record);
  }

  return annotated;
}

export async function buildMissionDispatchRuntimes(
  currentRuntimes: RuntimeRecord[],
  records: MissionDispatchRecordLike[],
  helpers: MissionDispatchRuntimeLifecycleHelpers
) {
  const syntheticRuntimes: RuntimeRecord[] = [];
  const nowMs = Date.now();

  for (const record of records) {
    const matchedRuntime = matchMissionDispatchToRuntime(record, currentRuntimes);

    if (matchedRuntime) {
      await helpers.persistObservation(record, matchedRuntime);
      await helpers.reconcileRuntimeState(record, matchedRuntime);
      continue;
    }

    const observedRuntime = await helpers.buildObservedRuntime(record);

    if (observedRuntime) {
      if (!isMissionDispatchTerminalStatus(record.status)) {
        await helpers.reconcileRuntimeState(record, observedRuntime);
      }

      syntheticRuntimes.push(
        buildMissionDispatchTranscriptRuntime(
          record,
          observedRuntime.sessionId ?? extractMissionDispatchSessionId(record) ?? undefined
        )
      );
      continue;
    }

    syntheticRuntimes.push(createMissionDispatchRuntime(record, nowMs));
  }

  return syntheticRuntimes.sort(sortRuntimesByUpdatedAtDesc);
}

export function matchMissionDispatchToRuntime(
  record: MissionDispatchRecordLike,
  runtimes: RuntimeRecord[]
) {
  const submittedAt = Date.parse(record.submittedAt);
  const nowMs = Date.now();
  const effectiveStatus = resolveMissionDispatchRuntimeStatus(record, nowMs);
  const sessionId = extractMissionDispatchSessionId(record);
  const observedRuntimeId = record.observation.runtimeId?.trim() || null;

  if (shouldPreferSyntheticMissionDispatchRuntime(observedRuntimeId, runtimes, effectiveStatus)) {
    return null;
  }

  return runtimes
    .map((runtime) => ({
      runtime,
      score: scoreMissionDispatchRuntimeMatch(runtime, record, {
        submittedAt,
        sessionId,
        observedRuntimeId,
        effectiveStatus
      })
    }))
    .filter((entry): entry is { runtime: RuntimeRecord; score: number } => typeof entry.score === "number")
    .sort((left, right) => right.score - left.score || sortRuntimesByUpdatedAtDesc(left.runtime, right.runtime))[0]
    ?.runtime;
}

export function shouldPreferSyntheticMissionDispatchRuntime(
  observedRuntimeId: string | null,
  runtimes: RuntimeRecord[],
  status: RuntimeRecord["status"]
) {
  if ((status !== "completed" && status !== "stalled" && status !== "cancelled") || !observedRuntimeId) {
    return false;
  }

  return !runtimes.some((runtime) => runtime.id === observedRuntimeId);
}

export function scoreMissionDispatchRuntimeMatch(
  runtime: RuntimeRecord,
  record: MissionDispatchRecordLike,
  options: {
    submittedAt: number;
    sessionId: string | null;
    observedRuntimeId: string | null;
    effectiveStatus: RuntimeRecord["status"];
  }
) {
  if (isSyntheticDispatchRuntime(runtime) || runtime.agentId !== record.agentId) {
    return null;
  }

  const runtimeDispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";

  if (runtimeDispatchId && runtimeDispatchId !== record.id) {
    return null;
  }

  if ((runtime.updatedAt ?? 0) < (Number.isNaN(options.submittedAt) ? 0 : options.submittedAt - 1500)) {
    return null;
  }

  if (options.observedRuntimeId && runtime.id === options.observedRuntimeId) {
    return 10_000;
  }

  if (
    options.effectiveStatus === "completed" ||
    options.effectiveStatus === "stalled" ||
    options.effectiveStatus === "cancelled"
  ) {
    return runtimeDispatchId === record.id ? 500 : null;
  }

  if (options.sessionId && runtime.sessionId !== options.sessionId) {
    return null;
  }

  const missionMatches = matchesMissionRuntime(runtime, record.mission, {
    agentId: record.agentId,
    submittedAt: options.submittedAt
  });

  if (runtime.source === "turn" && !missionMatches) {
    return null;
  }

  let score = 0;
  score += runtime.source === "turn" ? 400 : runtime.source === "session" ? 40 : 20;
  score += missionMatches ? 240 : 0;
  score += options.sessionId && runtime.sessionId === options.sessionId ? 120 : 0;
  score += runtimeDispatchId === record.id ? 80 : 0;

  return score;
}

export function isSyntheticDispatchRuntime(runtime: RuntimeRecord) {
  return runtime.id.startsWith("runtime:dispatch:");
}

export function annotateRuntimeWithMissionDispatch(runtime: RuntimeRecord, record: MissionDispatchRecordLike): RuntimeRecord {
  const currentDispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const runtimeMission = resolveRuntimeMissionText(runtime);
  const nextStatus =
    isMissionDispatchTerminalStatus(record.status)
      ? record.status
      : runtime.status;

  if (
    currentDispatchId === record.id &&
    runtimeMission &&
    typeof runtime.metadata.dispatchStatus === "string" &&
    runtime.metadata.dispatchStatus === record.status &&
    runtime.status === nextStatus
  ) {
    return runtime;
  }

  return {
    ...runtime,
    status: nextStatus,
    metadata: {
      ...runtime.metadata,
      dispatchId: record.id,
      dispatchStatus: record.status,
      dispatchSubmittedAt: record.submittedAt,
      dispatchRunnerStartedAt: record.runner.startedAt,
      dispatchHeartbeatAt: record.runner.lastHeartbeatAt,
      dispatchObservedAt: record.observation.observedAt,
      mission: runtimeMission ? runtime.metadata.mission : record.mission,
      routedMission: record.routedMission
    }
  };
}

export function buildMissionDispatchTranscriptRuntime(
  record: MissionDispatchRecordLike,
  sessionId?: string
): RuntimeRecord {
  const updatedAt = Date.parse(record.observation.observedAt ?? record.updatedAt ?? record.submittedAt);
  const nowMs = Date.now();
  const runtimeStatus = resolveMissionDispatchRuntimeStatus(record, nowMs);
  const resolvedSessionId = sessionId ?? extractMissionDispatchSessionId(record) ?? hashValue(record.id);
  const integrityWarning = resolveMissionDispatchIntegrityWarning(record);

  return {
    id: record.observation.runtimeId || `runtime:${resolvedSessionId}:${hashValue(record.id)}`,
    source: "turn",
    key: `dispatch:${record.id}`,
    title: compactMissionText(record.mission, 38) || "Recovered mission runtime",
    subtitle: integrityWarning
      ? summarizeText(integrityWarning, 90)
      : record.status === "completed" || record.status === "cancelled"
        ? summarizeText(resolveMissionDispatchCompletionDetail(record), 90)
        : record.status === "stalled"
          ? "Recovered the stalled runtime from the saved transcript."
          : "Recovering runtime state from the saved transcript.",
    status: runtimeStatus,
    updatedAt: Number.isNaN(updatedAt) ? null : updatedAt,
    ageMs: Number.isNaN(updatedAt) ? null : Math.max(nowMs - updatedAt, 0),
    agentId: record.agentId,
    workspaceId: record.workspaceId ?? undefined,
    modelId: extractMissionDispatchModelId(record) ?? undefined,
    sessionId: resolvedSessionId,
    tokenUsage: extractMissionDispatchTokenUsage(record),
    metadata: {
      mission: record.mission,
      dispatchId: record.id,
      routedMission: record.routedMission,
      outputDir: record.outputDir,
      outputDirRelative: record.outputDirRelative,
      notesDirRelative: record.notesDirRelative,
      error: record.error,
      sessionId: resolvedSessionId,
      pendingCreation: runtimeStatus === "queued" || runtimeStatus === "running",
      bootstrapStage: resolveMissionDispatchBootstrapStage(record, runtimeStatus),
      dispatchStatus: record.status,
      dispatchSubmittedAt: record.submittedAt,
      dispatchRunnerStartedAt: record.runner.startedAt,
      dispatchHeartbeatAt: record.runner.lastHeartbeatAt,
      dispatchObservedAt: record.observation.observedAt,
      recoveredFromObservation: true,
      ...(integrityWarning ? { warnings: [integrityWarning], warningSummary: integrityWarning } : {})
    }
  };
}

export function createMissionDispatchRuntime(
  record: MissionDispatchRecordLike,
  nowMs: number
): RuntimeRecord {
  const updatedAt = Date.parse(record.updatedAt);
  const runtimeStatus = resolveMissionDispatchRuntimeStatus(record, nowMs);
  const bootstrapStage = resolveMissionDispatchBootstrapStage(record, runtimeStatus);
  const subtitle = resolveMissionDispatchSubtitle(record, runtimeStatus);
  const sessionId = extractMissionDispatchSessionId(record);
  const modelId = extractMissionDispatchModelId(record);
  const tokenUsage = extractMissionDispatchTokenUsage(record);
  const integrityWarning = resolveMissionDispatchIntegrityWarning(record);

  return {
    id: `runtime:dispatch:${record.id}`,
    source: "turn",
    key: `dispatch:${record.id}`,
    title: compactMissionText(record.mission, 38) || "Queued mission",
    subtitle: integrityWarning ? summarizeText(integrityWarning, 90) : subtitle,
    status: runtimeStatus,
    updatedAt: Number.isNaN(updatedAt) ? Date.parse(record.submittedAt) || null : updatedAt,
    ageMs: Number.isNaN(updatedAt) ? null : Math.max(nowMs - updatedAt, 0),
    agentId: record.agentId,
    workspaceId: record.workspaceId ?? undefined,
    modelId: modelId ?? undefined,
    sessionId: sessionId ?? undefined,
    runId: record.result?.runId,
    tokenUsage,
    metadata: {
      dispatchId: record.id,
      mission: record.mission,
      routedMission: record.routedMission,
      outputDir: record.outputDir,
      outputDirRelative: record.outputDirRelative,
      notesDirRelative: record.notesDirRelative,
      error: record.error,
      sessionId,
      pendingCreation: runtimeStatus === "queued" || runtimeStatus === "running",
      bootstrapStage,
      dispatchStatus: record.status,
      dispatchSubmittedAt: record.submittedAt,
      dispatchRunnerStartedAt: record.runner.startedAt,
      dispatchHeartbeatAt: record.runner.lastHeartbeatAt,
      dispatchObservedAt: record.observation.observedAt,
      ...(integrityWarning ? { warnings: [integrityWarning], warningSummary: integrityWarning } : {})
    }
  };
}

function resolveRuntimeMissionText(runtime: RuntimeRecord) {
  const mission =
    typeof runtime.metadata.mission === "string"
      ? runtime.metadata.mission
      : typeof runtime.metadata.turnPrompt === "string"
        ? runtime.metadata.turnPrompt
        : null;

  if (!mission) {
    return null;
  }

  const normalized = stripMissionRouting(mission);
  return normalized.length > 0 ? normalized : null;
}

function isMissionDispatchTerminalStatus(status: string) {
  return status === "completed" || status === "stalled" || status === "cancelled";
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

function hashValue(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}
