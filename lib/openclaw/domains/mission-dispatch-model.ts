import path from "node:path";

import type { MissionDispatchStatus, MissionSubmission, RuntimeCreatedFile, RuntimeOutputRecord, RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

type MissionCommandPayloadLike = {
  runId?: string;
  status?: string;
  summary?: string;
  payloads?: Array<{
    text: string;
    mediaUrl: string | null;
  }>;
  meta?: Record<string, unknown>;
  result?: {
    payloads?: Array<{
      text: string;
      mediaUrl: string | null;
    }>;
    meta?: Record<string, unknown>;
  };
};

export type MissionDispatchRecordLike = {
  id: string;
  status: MissionDispatchStatus | string;
  agentId: string;
  sessionId: string | null;
  mission: string;
  routedMission: string;
  thinking: NonNullable<MissionSubmission["thinking"]>;
  workspaceId: string | null;
  workspacePath: string | null;
  submittedAt: string;
  updatedAt: string;
  outputDir: string | null;
  outputDirRelative: string | null;
  notesDirRelative: string | null;
  runner: {
    pid: number | null;
    childPid: number | null;
    startedAt: string | null;
    finishedAt: string | null;
    lastHeartbeatAt: string | null;
    logPath: string | null;
  };
  observation: {
    runtimeId: string | null;
    observedAt: string | null;
  };
  result: MissionCommandPayloadLike | null;
  error: string | null;
};

const missionDispatchHeartbeatStallMs = 90_000;
const missionDispatchQueuedStallMs = 30_000;

export function extractMissionDispatchSessionId(record: MissionDispatchRecordLike) {
  return (
    (record.sessionId?.trim() || null) ??
    extractMissionDispatchString(extractMissionDispatchAgentMeta(record), "sessionId") ??
    extractSessionIdFromRuntimeId(record.observation.runtimeId)
  );
}

export function extractMissionDispatchModelId(record: MissionDispatchRecordLike) {
  return extractMissionDispatchString(extractMissionDispatchAgentMeta(record), "model");
}

export function extractMissionDispatchTokenUsage(record: MissionDispatchRecordLike): RuntimeRecord["tokenUsage"] | undefined {
  const agentMeta = extractMissionDispatchAgentMeta(record);
  const usage = agentMeta?.usage;

  if (!usage || typeof usage !== "object") {
    return undefined;
  }

  const usageRecord = usage as Record<string, unknown>;
  const total =
    extractMissionDispatchNumber(usageRecord, "total") ??
    extractMissionDispatchNumber(usageRecord, "totalTokens") ??
    extractMissionDispatchNumber(usageRecord, "total_tokens");

  if (total === null) {
    return undefined;
  }

  return {
    input:
      extractMissionDispatchNumber(usageRecord, "input") ??
      extractMissionDispatchNumber(usageRecord, "prompt_tokens") ??
      0,
    output:
      extractMissionDispatchNumber(usageRecord, "output") ??
      extractMissionDispatchNumber(usageRecord, "completion_tokens") ??
      0,
    total,
    cacheRead: extractMissionDispatchNumber(usageRecord, "cacheRead") ?? 0
  };
}

export function resolveMissionDispatchSummary(record: MissionDispatchRecordLike) {
  const summary = record.result?.summary?.trim();

  if (!summary) {
    return null;
  }

  const normalized = summary.toLowerCase();
  return normalized === "completed" ||
    normalized === "ok" ||
    normalized === "success" ||
    isPlaceholderMissionResponseText(summary)
    ? null
    : summary;
}

export function resolveMissionDispatchResultText(record: MissionDispatchRecordLike) {
  const text = extractMissionCommandPayloads(record.result)
    .find((payload) => payload.text.trim().length > 0)
    ?.text.trim() ?? null;
  return isPlaceholderMissionResponseText(text) ? null : text;
}

export function resolveMissionDispatchIntegrityWarning(record: MissionDispatchRecordLike) {
  const resultText = resolveMissionDispatchResultText(record);

  if (record.status !== "completed" || !isPlaceholderMissionReply(resultText)) {
    return null;
  }

  if (!record.observation.observedAt) {
    return "Dispatch finished, but the only saved result was READY and no mission transcript was linked.";
  }

  return "Dispatch finished, but the saved reply still looks like a placeholder READY response.";
}

export function resolveMissionDispatchCompletionDetail(record: MissionDispatchRecordLike) {
  const integrityWarning = resolveMissionDispatchIntegrityWarning(record);

  if (integrityWarning) {
    return integrityWarning;
  }

  if (record.status === "cancelled") {
    return summarizeText(record.error || "Mission aborted by operator.", 90);
  }

  const completedSummary = resolveMissionDispatchSummary(record) || resolveMissionDispatchResultText(record);

  if (completedSummary) {
    return completedSummary;
  }

  if (record.observation.observedAt) {
    return "Dispatch runner finished. Waiting for the final runtime transcript to sync.";
  }

  if (record.outputDirRelative) {
    return `Dispatch runner finished · ${record.outputDirRelative}`;
  }

  return "Dispatch runner finished.";
}

export function resolveMissionDispatchRuntimeStatus(
  record: MissionDispatchRecordLike,
  nowMs: number
): RuntimeRecord["status"] {
  if (record.status === "completed") {
    return "completed";
  }

  if (record.status === "cancelled") {
    return "cancelled";
  }

  if (record.status === "stalled") {
    return "stalled";
  }

  if (record.status === "running") {
    const heartbeatAt = Date.parse(record.runner.lastHeartbeatAt || record.updatedAt);
    return !Number.isNaN(heartbeatAt) && nowMs - heartbeatAt > missionDispatchHeartbeatStallMs
      ? "stalled"
      : "running";
  }

  const queuedAt = Date.parse(record.submittedAt);
  return !Number.isNaN(queuedAt) && nowMs - queuedAt > missionDispatchQueuedStallMs ? "stalled" : "queued";
}

export function resolveMissionDispatchBootstrapStage(
  record: MissionDispatchRecordLike,
  status: RuntimeRecord["status"]
) {
  if (status === "completed") {
    return "completed";
  }

  if (status === "cancelled") {
    return "cancelled";
  }

  if (status === "stalled") {
    return "stalled";
  }

  if (record.observation.runtimeId || record.observation.observedAt) {
    return "runtime-observed";
  }

  if (record.runner.lastHeartbeatAt) {
    return "waiting-for-runtime";
  }

  if (record.runner.startedAt || record.runner.pid) {
    return "waiting-for-heartbeat";
  }

  return "accepted";
}

export function resolveMissionDispatchSubtitle(
  record: MissionDispatchRecordLike,
  status: RuntimeRecord["status"]
) {
  if (status === "completed") {
    return summarizeText(resolveMissionDispatchCompletionDetail(record), 90);
  }

  if (status === "cancelled") {
    return summarizeText(resolveMissionDispatchCompletionDetail(record), 90);
  }

  if (status === "stalled") {
    if (record.error) {
      return summarizeText(record.error, 90);
    }

    if (!record.runner.lastHeartbeatAt) {
      return "Dispatch stalled before the first runner heartbeat.";
    }

    return "Dispatch stalled while waiting for the first OpenClaw runtime.";
  }

  const bootstrapStage = resolveMissionDispatchBootstrapStage(record, status);

  if (bootstrapStage === "runtime-observed") {
    return "First runtime observed. Promoting the task to live updates.";
  }

  if (bootstrapStage === "waiting-for-runtime") {
    return "Heartbeat received. Waiting for the first OpenClaw runtime.";
  }

  if (bootstrapStage === "waiting-for-heartbeat") {
    return "Dispatch runner started. Waiting for the first heartbeat.";
  }

  return "Mission accepted. Starting the OpenClaw dispatch runner.";
}

export function reconcileTaskRecordWithDispatchRecord(task: TaskRecord, record: MissionDispatchRecordLike): TaskRecord {
  const status = resolveMissionDispatchRuntimeStatus(record, Date.now());
  const bootstrapStage = resolveMissionDispatchBootstrapStage(record, status);
  const updatedAt = Date.parse(record.updatedAt);
  const subtitle =
    status === "completed" || status === "cancelled"
      ? summarizeText(resolveMissionDispatchCompletionDetail(record), 90)
      : resolveMissionDispatchSubtitle(record, status);

  return {
    ...task,
    dispatchId: record.id,
    status,
    subtitle,
    updatedAt: Number.isNaN(updatedAt) ? task.updatedAt : updatedAt,
    ageMs: Number.isNaN(updatedAt) ? task.ageMs : Math.max(Date.now() - updatedAt, 0),
    liveRunCount: status === "running" || status === "queued" ? Math.max(task.liveRunCount, 1) : 0,
    warningCount:
      status === "stalled" || status === "cancelled"
        ? Math.max(task.warningCount, 1)
        : task.warningCount,
    metadata: {
      ...task.metadata,
      bootstrapStage,
      dispatchStatus: record.status,
      dispatchSubmittedAt: record.submittedAt,
      dispatchRunnerStartedAt: record.runner.startedAt,
      dispatchHeartbeatAt: record.runner.lastHeartbeatAt,
      dispatchObservedAt: record.observation.observedAt,
      outputDir: record.outputDir,
      outputDirRelative: record.outputDirRelative
    }
  };
}

export function resolveMissionDispatchOutputFile(record: MissionDispatchRecordLike): RuntimeCreatedFile | null {
  const outputDir = normalizeOptionalValue(record.outputDir);
  const outputDirRelative = normalizeOptionalValue(record.outputDirRelative);
  const textCandidates = [
    resolveMissionDispatchSummary(record),
    resolveMissionDispatchResultText(record)
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const text of textCandidates) {
    for (const file of inferCreatedFilesFromText(text)) {
      const resolvedPath = resolveArtifactPathAgainstOutputDir(file.path, outputDir, outputDirRelative);

      if (!resolvedPath) {
        continue;
      }

      return {
        path: resolvedPath,
        displayPath: file.displayPath
      };
    }
  }

  return null;
}

export function createMissionDispatchResultFromRuntimeOutput(
  runtime: RuntimeRecord,
  output: RuntimeOutputRecord
): MissionCommandPayloadLike | null {
  if (!output.finalText && !runtime.runId) {
    return null;
  }

  return {
    runId: runtime.runId || `runtime:${runtime.id}`,
    status: output.errorMessage ? "error" : "ok",
    summary: output.errorMessage || "completed",
    ...(output.finalText
      ? {
          result: {
            payloads: [
              {
                text: output.finalText,
                mediaUrl: null
              }
            ]
          }
        }
      : {})
  };
}

export function normalizeMissionDispatchStatus(value: unknown): MissionDispatchStatus {
  return value === "running" || value === "completed" || value === "stalled" || value === "cancelled"
    ? value
    : "queued";
}

export function normalizeMissionThinking(value: unknown): NonNullable<MissionSubmission["thinking"]> {
  return value === "off" || value === "minimal" || value === "low" || value === "high" ? value : "medium";
}

export function isMissionCommandPayload(value: unknown): value is MissionCommandPayloadLike {
  const payloads = extractMissionCommandPayloads(value);
  const meta = extractMissionCommandMeta(value);

  return (
    typeof value === "object" &&
    value !== null &&
    (typeof (value as MissionCommandPayloadLike).runId === "string" ||
      typeof (value as MissionCommandPayloadLike).status === "string" ||
      typeof (value as MissionCommandPayloadLike).summary === "string" ||
      payloads.length > 0 ||
      Boolean(meta))
  );
}

export function extractMissionCommandPayloads(value: unknown) {
  if (!value || typeof value !== "object") {
    return [] as Array<{
      text: string;
      mediaUrl: string | null;
    }>;
  }

  const payload = value as MissionCommandPayloadLike;
  const candidates = Array.isArray(payload.result?.payloads)
    ? payload.result?.payloads
    : Array.isArray(payload.payloads)
      ? payload.payloads
      : [];

  return candidates.filter(
    (entry): entry is { text: string; mediaUrl: string | null } =>
      Boolean(entry) && typeof entry.text === "string"
  );
}

export function extractMissionCommandMeta(value: unknown) {
  if (!value || typeof value !== "object") {
    return null;
  }

  const payload = value as MissionCommandPayloadLike;
  const meta = payload.result?.meta ?? payload.meta;
  return meta && typeof meta === "object" ? meta : null;
}

function extractMissionDispatchAgentMeta(record: MissionDispatchRecordLike) {
  const meta = extractMissionCommandMeta(record.result);

  if (!meta || typeof meta !== "object") {
    return null;
  }

  const agentMeta = (meta as Record<string, unknown>).agentMeta;
  return agentMeta && typeof agentMeta === "object" ? (agentMeta as Record<string, unknown>) : null;
}

function extractMissionDispatchString(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "string" && value.trim().length > 0 ? value : null;
}

function extractSessionIdFromRuntimeId(runtimeId: string | null | undefined) {
  const trimmed = runtimeId?.trim();

  if (!trimmed?.startsWith("runtime:")) {
    return null;
  }

  const segments = trimmed.split(":");
  const sessionId = segments[1];

  if (!sessionId || sessionId === "dispatch") {
    return null;
  }

  return sessionId;
}

function extractMissionDispatchNumber(record: Record<string, unknown> | null, key: string) {
  const value = record?.[key];
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isPlaceholderMissionReply(value: string | null | undefined) {
  if (typeof value !== "string") {
    return false;
  }

  const normalized = value.replace(/\s+/g, " ").trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  return (
    normalized === "ready" ||
    normalized === "[[reply_to_current]] ready" ||
    normalized === "mission accepted" ||
    normalized === "mission queued"
  );
}

function isPlaceholderMissionResponseText(value: string | null) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();

  return (
    normalized === "ready" ||
    normalized === "completed" ||
    normalized === "complete" ||
    normalized === "ok" ||
    normalized === "success"
  );
}

function inferCreatedFilesFromText(value: string | null | undefined) {
  if (typeof value !== "string" || value.trim().length === 0) {
    return [];
  }

  const matches = [
    ...value.matchAll(/(?:^|[\s(])((?:\.{1,2}\/)?deliverables\/[^\s`),;]+)/g),
    ...value.matchAll(/`((?:\/|\.{1,2}\/|deliverables\/)[^`\n]+)`/g)
  ];
  const createdFiles: RuntimeCreatedFile[] = [];

  for (const match of matches) {
    const pathValue = (match[1] || "").trim();

    if (!pathValue || !looksLikeArtifactFilePath(pathValue)) {
      continue;
    }

    createdFiles.push({
      path: pathValue,
      displayPath: pathValue
    });
  }

  return dedupeCreatedFiles(createdFiles);
}

function looksLikeArtifactFilePath(pathValue: string) {
  const normalized = pathValue.trim().replace(/[`'")\],;]+$/g, "");

  if (!normalized || normalized.endsWith("/")) {
    return false;
  }

  const basename = path.posix.basename(normalized);

  return basename.includes(".");
}

function resolveArtifactPathAgainstOutputDir(
  detectedPath: string | null | undefined,
  outputDir?: string | null,
  outputDirRelative?: string | null
) {
  const normalizedDetectedPath = normalizeOptionalValue(detectedPath);
  const normalizedOutputDir = normalizeOptionalValue(outputDir);
  const normalizedOutputDirRelative = normalizeOptionalValue(outputDirRelative);

  if (!normalizedDetectedPath) {
    return null;
  }

  if (path.isAbsolute(normalizedDetectedPath)) {
    return normalizedDetectedPath;
  }

  if (!normalizedOutputDir || !normalizedOutputDirRelative) {
    return normalizedDetectedPath;
  }

  const normalizedDirLabel = normalizedOutputDirRelative.replace(/\/+$/, "");
  const normalizedFileLabel = normalizedDetectedPath.replace(/\/+$/, "");

  if (normalizedFileLabel === normalizedDirLabel) {
    return normalizedOutputDir;
  }

  const prefix = `${normalizedDirLabel}/`;

  if (!normalizedFileLabel.startsWith(prefix)) {
    return normalizedDetectedPath;
  }

  return path.join(normalizedOutputDir, normalizedFileLabel.slice(prefix.length));
}

function dedupeCreatedFiles(files: RuntimeCreatedFile[]) {
  const seen = new Set<string>();
  const deduped: RuntimeCreatedFile[] = [];

  for (const file of files) {
    if (!file.path || seen.has(file.path)) {
      continue;
    }

    seen.add(file.path);
    deduped.push(file);
  }

  return deduped;
}

function normalizeOptionalValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function summarizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}
