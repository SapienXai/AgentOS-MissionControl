import { execFile, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { resolveOpenClawBin } from "@/lib/openclaw/cli";
import { matchesMissionText } from "@/lib/openclaw/runtime-matching";
import {
  buildMissionDispatchTranscriptRuntime as buildMissionDispatchTranscriptRuntimeFromRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import {
  createMissionDispatchResultFromRuntimeOutput,
  extractMissionDispatchSessionId,
  extractMissionDispatchTokenUsage,
  isMissionCommandPayload,
  normalizeMissionDispatchStatus,
  normalizeMissionThinking,
  resolveMissionDispatchResultText
} from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  extractTranscriptTurns as extractTranscriptTurnsFromTranscript,
  filterTranscriptTurnsForRuntime as filterTranscriptTurnsForRuntimeFromTranscript,
  parseRuntimeOutput as parseRuntimeOutputFromTranscript,
  parseRuntimeOutputFromSessionHistory,
  resolveRuntimeTranscriptPath as resolveRuntimeTranscriptPathFromTranscript
} from "@/lib/openclaw/domains/runtime-transcript";
import type { MissionDispatchRecordLike } from "@/lib/openclaw/domains/mission-dispatch-model";
import type {
  RuntimeOutputRecord,
  RuntimeRecord,
  TaskRecord,
  MissionDispatchStatus,
  MissionSubmission
} from "@/lib/openclaw/types";

type MissionDispatchCommandPayloadLike = {
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
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

export type MissionDispatchPayload = {
  clientRequestId: string | null;
  agentId: string;
  mission: string;
  routedMission: string;
  thinking: NonNullable<MissionSubmission["thinking"]>;
  requestedModelId: string | null;
  workspaceId: string | null;
  workspacePath: string | null;
  executionMode?: NonNullable<MissionSubmission["executionMode"]>;
  outputDir: string | null;
  outputDirRelative: string | null;
  notesDirRelative: string | null;
};

type MissionDispatchObservation = {
  runtimeId: string | null;
  observedAt: string | null;
};

type RuntimeTokenUsage = NonNullable<RuntimeRecord["tokenUsage"]>;

export type MissionDispatchRecord = Omit<MissionDispatchRecordLike, "status" | "result"> & {
  status: MissionDispatchStatus;
  result: MissionDispatchCommandPayloadLike | null;
  observation: MissionDispatchObservation;
};

const missionDispatchRunnerPath = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "scripts",
  "openclaw-mission-dispatch-runner.mjs"
);
const missionDispatchRetentionMs = 3 * 24 * 60 * 60 * 1000;
const missionDispatchAgentTimeoutSeconds = 45;

const execFileAsync = promisify(execFile);

export function createMissionDispatchRecord(payload: MissionDispatchPayload): MissionDispatchRecord {
  const now = new Date().toISOString();
  const dispatchId = `dispatch-${randomUUID()}`;

  return {
    id: dispatchId,
    clientRequestId: payload.clientRequestId,
    status: "queued",
    agentId: payload.agentId,
    // OpenClaw owns session identity. A dispatch record starts without a
    // session id and is enriched only after the native Gateway returns one.
    sessionId: null,
    mission: payload.mission,
    routedMission: payload.routedMission,
    thinking: payload.thinking,
    requestedModelId: payload.requestedModelId,
    workspaceId: payload.workspaceId,
    workspacePath: payload.workspacePath,
    executionMode: payload.executionMode,
    submittedAt: now,
    updatedAt: now,
    outputDir: payload.outputDir,
    outputDirRelative: payload.outputDirRelative,
    notesDirRelative: payload.notesDirRelative,
    runner: {
      pid: null,
      childPid: null,
      startedAt: null,
      finishedAt: null,
      lastHeartbeatAt: null,
      logPath: missionDispatchRunnerLogPath(dispatchId)
    },
    observation: {
      runtimeId: null,
      observedAt: null
    },
    result: null,
    error: null,
    browserBinding: null
  };
}

export async function writeMissionDispatchRecord(record: MissionDispatchRecordLike) {
  const filePath = missionDispatchRecordPath(record.id);
  const tempPath = `${filePath}.${process.pid}.tmp`;
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

export async function launchMissionDispatchRunner(record: MissionDispatchRecord) {
  await access(missionDispatchRunnerPath, fsConstants.R_OK);
  const openClawBin = await resolveOpenClawBin();
  const child = spawn(process.execPath, [missionDispatchRunnerPath, missionDispatchRecordPath(record.id)], {
    windowsHide: true,
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OPENCLAW_BIN: openClawBin,
      OPENCLAW_AGENT_TIMEOUT_SECONDS: String(missionDispatchAgentTimeoutSeconds)
    }
  });

  child.unref();

  return {
    ...record,
    runner: {
      ...record.runner,
      pid: child.pid ?? record.runner.pid
    }
  } satisfies MissionDispatchRecord;
}

export async function findMissionDispatchRecordForTask(task: TaskRecord) {
  if (task.dispatchId) {
    const dispatchRecord = await readMissionDispatchRecordById(task.dispatchId);

    if (dispatchRecord) {
      return dispatchRecord;
    }
  }

  const records = await readMissionDispatchRecords();
  const taskRuntimeIds = new Set(task.runtimeIds);
  const taskSessionIds = new Set(task.sessionIds);

  for (const record of records) {
    if (record.agentId !== task.primaryAgentId && !task.agentIds.includes(record.agentId)) {
      continue;
    }

    if (task.mission && record.mission && matchesMissionText(record.mission, task.mission)) {
      return record;
    }

    if (record.observation.runtimeId && taskRuntimeIds.has(record.observation.runtimeId)) {
      return record;
    }

    const sessionId = extractMissionDispatchSessionId(record);
    if (sessionId && taskSessionIds.has(sessionId)) {
      return record;
    }
  }

  return null;
}

export async function stopMissionDispatchChildProcess(record: MissionDispatchRecord) {
  const childPids = new Set<number>();

  if (typeof record.runner.childPid === "number" && Number.isFinite(record.runner.childPid)) {
    childPids.add(record.runner.childPid);
  }

  if (childPids.size === 0 && typeof record.runner.pid === "number" && Number.isFinite(record.runner.pid)) {
    try {
      const { stdout } = await execFileAsync("pgrep", ["-P", String(record.runner.pid)]);
      for (const line of stdout.split(/\r?\n/)) {
        const pid = Number.parseInt(line.trim(), 10);
        if (Number.isFinite(pid) && pid > 0) {
          childPids.add(pid);
        }
      }
    } catch {
      // The runner heartbeat still terminates the child once the record is cancelled.
    }
  }

  for (const pid of childPids) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      // The process may already be gone.
    }
  }

  return childPids.values().next().value ?? null;
}

export async function persistMissionDispatchObservation(record: MissionDispatchRecordLike, runtime: RuntimeRecord) {
  const observedAt = timestampFromUnix(runtime.updatedAt);

  if (record.observation.runtimeId === runtime.id && record.observation.observedAt === observedAt) {
    return;
  }

  const latestRecord = (await readMissionDispatchRecordById(record.id)) ?? record;

  if (latestRecord.observation.runtimeId === runtime.id && latestRecord.observation.observedAt === observedAt) {
    return;
  }

  await writeMissionDispatchRecord({
    ...latestRecord,
    updatedAt: maxIsoTimestamp(latestRecord.updatedAt, observedAt),
    runner: latestRecord.status === "running"
      ? {
          ...latestRecord.runner,
          lastHeartbeatAt: maxIsoTimestamp(latestRecord.runner.lastHeartbeatAt, observedAt)
        }
      : latestRecord.runner,
    observation: {
      runtimeId: runtime.id,
      observedAt
    }
  });
}

export async function reconcileMissionDispatchRuntimeState(record: MissionDispatchRecordLike, runtime: RuntimeRecord) {
  if (isMissionDispatchTerminalStatus(record.status)) {
    return reconcileTerminalMissionDispatchRecordFromRuntime(record, runtime);
  }

  if (isTerminalRuntimeStatus(runtime.status) && missionDispatchRuntimeMatchesRecord(record, runtime)) {
    const latestRecord = (await readMissionDispatchRecordById(record.id)) ?? record;

    if (isMissionDispatchTerminalStatus(latestRecord.status)) {
      return;
    }

    const finishedAt = timestampFromUnix(runtime.updatedAt);
    const nextStatus = normalizeRuntimeTerminalStatus(runtime.status);

    const nextRecord = {
      ...latestRecord,
      status: nextStatus,
      updatedAt: maxIsoTimestamp(latestRecord.updatedAt, finishedAt),
      runner: {
        ...latestRecord.runner,
        finishedAt,
        lastHeartbeatAt: finishedAt
      },
      observation: {
        runtimeId: runtime.id,
        observedAt: finishedAt
      },
      result:
        nextStatus === "completed"
          ? latestRecord.result ?? createMissionDispatchResultFromTerminalRuntime(runtime)
          : latestRecord.result,
      error:
        nextStatus === "stalled"
          ? latestRecord.error || runtime.subtitle || "OpenClaw runtime ended before the dispatch runner finalized."
          : null
    } satisfies MissionDispatchRecordLike;

    await writeMissionDispatchRecord(nextRecord);
    return nextRecord;
  }

  if (!runtime.agentId || !runtime.sessionId) {
    return;
  }

  const output = await readRuntimeOutputForMissionDispatchRecord(record, runtime);

  if (!output) {
    return;
  }

  const finalizedFromTranscript = Boolean(output.finalTimestamp && output.stopReason && output.stopReason !== "toolUse");
  const stalledFromTranscript =
    Boolean(output.errorMessage) || output.stopReason === "error" || output.stopReason === "aborted";

  if (!finalizedFromTranscript && !stalledFromTranscript) {
    return;
  }

  const latestRecord = (await readMissionDispatchRecordById(record.id)) ?? record;

  if (isMissionDispatchTerminalStatus(latestRecord.status)) {
    return;
  }

  const finishedAt = output.finalTimestamp ?? timestampFromUnix(runtime.updatedAt);
  const nextStatus = stalledFromTranscript ? "stalled" : "completed";

  const nextRecord = {
    ...latestRecord,
    status: nextStatus,
    updatedAt: maxIsoTimestamp(latestRecord.updatedAt, finishedAt),
    runner: {
      ...latestRecord.runner,
      finishedAt,
      lastHeartbeatAt: finishedAt
    },
    result:
      nextStatus === "completed"
        ? latestRecord.result ?? createMissionDispatchResultFromRuntimeOutput(runtime, output)
        : latestRecord.result,
    error:
      nextStatus === "stalled"
        ? output.errorMessage || latestRecord.error || "OpenClaw runtime ended before the dispatch runner finalized."
        : null
  } satisfies MissionDispatchRecordLike;

  await writeMissionDispatchRecord(nextRecord);
  return nextRecord;
}

async function backfillCompletedMissionDispatchResultFromRuntime(
  record: MissionDispatchRecordLike,
  runtime: RuntimeRecord
): Promise<MissionDispatchRecordLike | null> {
  if (record.status !== "completed") {
    return null;
  }

  const output = await readRuntimeOutputForMissionDispatchRecord(record, runtime);

  if (!output) {
    return null;
  }

  const result = createMissionDispatchResultFromRuntimeOutput(runtime, output);

  if (!result || (!output.finalText?.trim() && !output.tokenUsage)) {
    return null;
  }

  const latestRecord = (await readMissionDispatchRecordById(record.id)) ?? record;

  if (latestRecord.status !== "completed") {
    return null;
  }

  if (resolveMissionDispatchResultText(latestRecord) && hasMeaningfulMissionDispatchTokenUsage(latestRecord)) {
    return null;
  }

  const finishedAt = output.finalTimestamp ?? timestampFromUnix(runtime.updatedAt) ?? latestRecord.updatedAt;

  const nextResult = latestRecord.result
    ? mergeMissionDispatchResult(latestRecord.result, result)
    : result;

  const nextRecord = {
    ...latestRecord,
    updatedAt: maxIsoTimestamp(latestRecord.updatedAt, finishedAt),
    runner: {
      ...latestRecord.runner,
      finishedAt: latestRecord.runner.finishedAt ?? finishedAt,
      lastHeartbeatAt: maxIsoTimestamp(latestRecord.runner.lastHeartbeatAt, finishedAt)
    },
    result: nextResult
  } satisfies MissionDispatchRecordLike;

  await writeMissionDispatchRecord(nextRecord);
  return nextRecord;
}

function hasMeaningfulMissionDispatchTokenUsage(record: MissionDispatchRecordLike) {
  const tokenUsage = extractMissionDispatchTokenUsage(record);
  return Boolean(tokenUsage && tokenUsage.total > 0);
}

function mergeMissionDispatchResult(
  current: NonNullable<MissionDispatchRecordLike["result"]>,
  next: NonNullable<MissionDispatchRecordLike["result"]>
): NonNullable<MissionDispatchRecordLike["result"]> {
  return {
    ...current,
    ...next,
    runId: current.runId ?? next.runId,
    sessionKey: current.sessionKey ?? next.sessionKey,
    sessionId: current.sessionId ?? next.sessionId,
    meta: {
      ...(current.meta ?? {}),
      ...(next.meta ?? {})
    },
    payloads: next.payloads ?? current.payloads,
    result: current.result || next.result
      ? {
          ...(current.result ?? {}),
          ...(next.result ?? {}),
          meta: {
            ...(current.result?.meta ?? {}),
            ...(next.result?.meta ?? {})
          },
          payloads: next.result?.payloads ?? current.result?.payloads
        }
      : undefined
  };
}

async function reconcileTerminalMissionDispatchRecordFromRuntime(
  record: MissionDispatchRecordLike,
  runtime: RuntimeRecord
): Promise<MissionDispatchRecordLike | null> {
  if (record.status === "completed") {
    return backfillCompletedMissionDispatchResultFromRuntime(record, runtime);
  }

  if (record.status !== "stalled") {
    return null;
  }

  const output = await readRuntimeOutputForMissionDispatchRecord(record, runtime);

  if (!output || !isCompletedRuntimeOutput(output)) {
    return null;
  }

  const result = createMissionDispatchResultFromRuntimeOutput(runtime, output);

  if (!result) {
    return null;
  }

  const latestRecord = (await readMissionDispatchRecordById(record.id)) ?? record;

  if (latestRecord.status === "completed") {
    return backfillCompletedMissionDispatchResultFromRuntime(latestRecord, runtime);
  }

  if (latestRecord.status !== "stalled") {
    return null;
  }

  const finishedAt = output.finalTimestamp ?? timestampFromUnix(runtime.updatedAt) ?? latestRecord.updatedAt;

  const nextRecord = {
    ...latestRecord,
    status: "completed",
    updatedAt: maxIsoTimestamp(latestRecord.updatedAt, finishedAt),
    runner: {
      ...latestRecord.runner,
      finishedAt,
      lastHeartbeatAt: maxIsoTimestamp(latestRecord.runner.lastHeartbeatAt, finishedAt)
    },
    observation: {
      runtimeId: runtime.id,
      observedAt: finishedAt
    },
    result,
    error: null
  } satisfies MissionDispatchRecordLike;

  await writeMissionDispatchRecord(nextRecord);
  return nextRecord;
}

async function readRuntimeOutputForMissionDispatchRecord(
  record: MissionDispatchRecordLike,
  runtime: RuntimeRecord
): Promise<RuntimeOutputRecord | null> {
  const sessionId = runtime.sessionId ?? extractMissionDispatchSessionId(record);

  if (!runtime.agentId || !sessionId) {
    return null;
  }

  const transcriptPath = await resolveRuntimeTranscriptPathFromTranscript(
    runtime.agentId,
    sessionId,
    record.workspacePath ?? undefined
  );

  if (!transcriptPath) {
    return readRuntimeOutputFromGatewaySessionHistory(record, runtime);
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const transcriptRuntime = {
      ...runtime,
      sessionId,
      metadata: {
        ...runtime.metadata,
        mission: typeof runtime.metadata.mission === "string" ? runtime.metadata.mission : record.mission,
        dispatchSubmittedAt:
          typeof runtime.metadata.dispatchSubmittedAt === "string"
            ? runtime.metadata.dispatchSubmittedAt
            : record.submittedAt
      }
    } satisfies RuntimeRecord;

    const output = parseRuntimeOutputFromTranscript(transcriptRuntime, raw, record.workspacePath ?? undefined);

    if (hasMeaningfulTokenUsage(output.tokenUsage)) {
      return output;
    }

    const rolloutTokenUsage = await readCodexRolloutTokenUsageForMissionDispatchRecord(record, raw);
    return rolloutTokenUsage ? { ...output, tokenUsage: rolloutTokenUsage } : output;
  } catch {
    return null;
  }
}

async function readRuntimeOutputFromGatewaySessionHistory(
  record: MissionDispatchRecordLike,
  runtime: RuntimeRecord
) {
  const result = record.result && typeof record.result === "object" ? record.result as Record<string, unknown> : null;
  const sessionKey =
    (typeof result?.sessionKey === "string" && result.sessionKey.trim() ? result.sessionKey.trim() : null) ??
    (typeof runtime.metadata.sessionKey === "string" && runtime.metadata.sessionKey.trim() ? runtime.metadata.sessionKey.trim() : null) ??
    (runtime.key.startsWith("agent:") ? runtime.key : null);

  if (!sessionKey) {
    return null;
  }

  try {
    const payload = await getOpenClawAdapter().getSessionHistory(
      { sessionKey, limit: 200 },
      { timeoutMs: 8_000 }
    );
    const historyRuntime = {
      ...runtime,
      sessionId: runtime.sessionId ?? extractMissionDispatchSessionId(record) ?? undefined,
      metadata: {
        ...runtime.metadata,
        mission: typeof runtime.metadata.mission === "string" ? runtime.metadata.mission : record.mission,
        routedMission:
          typeof runtime.metadata.routedMission === "string" ? runtime.metadata.routedMission : record.routedMission,
        dispatchSubmittedAt:
          typeof runtime.metadata.dispatchSubmittedAt === "string"
            ? runtime.metadata.dispatchSubmittedAt
            : record.submittedAt,
        sessionKey
      }
    } satisfies RuntimeRecord;
    const output = parseRuntimeOutputFromSessionHistory(historyRuntime, payload, record.workspacePath ?? undefined);

    return output.items.length > 0 ? output : null;
  } catch {
    return null;
  }
}

async function readCodexRolloutTokenUsageForMissionDispatchRecord(
  record: MissionDispatchRecordLike,
  transcriptRaw: string
): Promise<RuntimeTokenUsage | null> {
  const turnId = extractCodexTurnIdFromMissionTranscript(transcriptRaw, record.mission);

  if (!turnId || !record.workspacePath || !record.agentId) {
    return null;
  }

  for (const directoryPath of resolveCodexRolloutSessionDirectories(record)) {
    const entries = await readdir(directoryPath, { withFileTypes: true }).catch(() => []);
    const rolloutFiles = entries
      .filter((entry) => entry.isFile() && entry.name.startsWith("rollout-") && entry.name.endsWith(".jsonl"))
      .map((entry) => path.join(directoryPath, entry.name));

    for (const filePath of rolloutFiles) {
      const raw = await readFile(filePath, "utf8").catch(() => null);

      if (!raw || !raw.includes(turnId)) {
        continue;
      }

      const tokenUsage = extractCodexRolloutTokenUsageForTurn(raw, turnId);

      if (hasMeaningfulTokenUsage(tokenUsage)) {
        return tokenUsage;
      }
    }
  }

  return null;
}

export function extractCodexRolloutTokenUsageForTurn(raw: string, turnId: string): RuntimeTokenUsage | null {
  const normalizedTurnId = turnId.trim();

  if (!normalizedTurnId) {
    return null;
  }

  let activeTurn = false;
  let latestUsage: RuntimeTokenUsage | null = null;

  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as unknown;

      if (!isRecord(entry) || entry.type !== "event_msg" || !isRecord(entry.payload)) {
        continue;
      }

      const payloadType = typeof entry.payload.type === "string" ? entry.payload.type : "";

      if (payloadType === "task_started" && readString(entry.payload.turn_id) === normalizedTurnId) {
        activeTurn = true;
        latestUsage = null;
        continue;
      }

      if (!activeTurn) {
        continue;
      }

      if (payloadType === "token_count") {
        const tokenUsage = normalizeCodexRolloutTokenUsage(entry.payload.info);

        if (hasMeaningfulTokenUsage(tokenUsage)) {
          latestUsage = tokenUsage;
        }
        continue;
      }

      if (payloadType === "task_complete" && readString(entry.payload.turn_id) === normalizedTurnId) {
        break;
      }
    } catch {
      continue;
    }
  }

  return latestUsage;
}

function extractCodexTurnIdFromMissionTranscript(raw: string, mission: string) {
  for (const line of raw.split(/\r?\n/)) {
    if (!line.trim()) {
      continue;
    }

    try {
      const entry = JSON.parse(line) as unknown;

      if (!isRecord(entry) || entry.type !== "message" || !isRecord(entry.message)) {
        continue;
      }

      if (entry.message.role !== "user") {
        continue;
      }

      const prompt = extractTranscriptMessageText(entry.message.content);

      if (mission.trim() && prompt && !matchesMissionText(prompt, mission) && !prompt.includes(mission.trim())) {
        continue;
      }

      const turnId = extractOpenClawMirrorTurnId(entry.message);

      if (turnId) {
        return turnId;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function extractOpenClawMirrorTurnId(message: Record<string, unknown>) {
  const openClaw = isRecord(message.__openclaw) ? message.__openclaw : null;
  const mirrorIdentity = readString(openClaw?.mirrorIdentity);
  const turnId = mirrorIdentity?.split(":")[0]?.trim();

  return turnId || null;
}

function extractTranscriptMessageText(content: unknown) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((item) => {
      if (!isRecord(item)) {
        return [];
      }

      if ((item.type === "text" || item.type === "output_text") && typeof item.text === "string") {
        return [item.text];
      }

      return [];
    })
    .join("\n\n")
    .trim();
}

function resolveCodexRolloutSessionDirectories(record: MissionDispatchRecordLike) {
  if (!record.workspacePath || !record.agentId) {
    return [];
  }

  const rootPath = path.join(
    record.workspacePath,
    ".openclaw",
    "agents",
    record.agentId,
    "agent",
    "codex-home",
    "sessions"
  );
  const timestamps = [
    record.submittedAt,
    record.runner.startedAt,
    record.runner.finishedAt,
    record.updatedAt,
    record.observation.observedAt
  ];
  const directories = new Set<string>();

  for (const timestamp of timestamps) {
    const ms = typeof timestamp === "string" ? Date.parse(timestamp) : Number.NaN;

    if (Number.isNaN(ms)) {
      continue;
    }

    for (const offsetMs of [-24 * 60 * 60 * 1000, 0, 24 * 60 * 60 * 1000]) {
      const date = new Date(ms + offsetMs);
      directories.add(path.join(rootPath, ...formatCodexSessionDateParts(date, false)));
      directories.add(path.join(rootPath, ...formatCodexSessionDateParts(date, true)));
    }
  }

  return Array.from(directories);
}

function formatCodexSessionDateParts(date: Date, utc: boolean) {
  const year = utc ? date.getUTCFullYear() : date.getFullYear();
  const month = utc ? date.getUTCMonth() + 1 : date.getMonth() + 1;
  const day = utc ? date.getUTCDate() : date.getDate();

  return [String(year), pad2(month), pad2(day)];
}

function normalizeCodexRolloutTokenUsage(value: unknown): RuntimeTokenUsage | null {
  if (!isRecord(value)) {
    return null;
  }

  const usage = isRecord(value.total_token_usage)
    ? value.total_token_usage
    : isRecord(value.last_token_usage)
      ? value.last_token_usage
      : null;

  if (!usage) {
    return null;
  }

  const total = readNumber(usage.total_tokens);

  if (total === null) {
    return null;
  }

  return {
    input: readNumber(usage.input_tokens) ?? 0,
    output: readNumber(usage.output_tokens) ?? 0,
    total,
    cacheRead: readNumber(usage.cached_input_tokens) ?? 0
  };
}

function hasMeaningfulTokenUsage(tokenUsage: RuntimeRecord["tokenUsage"] | null | undefined): tokenUsage is RuntimeTokenUsage {
  return Boolean(tokenUsage && tokenUsage.total > 0);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readNumber(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function pad2(value: number) {
  return String(value).padStart(2, "0");
}

function isCompletedRuntimeOutput(output: RuntimeOutputRecord) {
  const stopReason = output.stopReason?.trim();

  return Boolean(
    output.status === "available" &&
      output.finalText?.trim() &&
      !output.errorMessage &&
      stopReason &&
      stopReason !== "toolUse" &&
      stopReason !== "error" &&
      stopReason !== "aborted"
  );
}

function missionDispatchRuntimeMatchesRecord(record: MissionDispatchRecordLike, runtime: RuntimeRecord) {
  const runtimeDispatchId =
    typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const runtimeRunId = typeof runtime.runId === "string" ? runtime.runId.trim() : "";

  return runtimeDispatchId === record.id || runtimeRunId === record.id;
}

function isTerminalRuntimeStatus(status: RuntimeRecord["status"]) {
  return status === "completed" || status === "stalled" || status === "cancelled";
}

function normalizeRuntimeTerminalStatus(status: RuntimeRecord["status"]): MissionDispatchStatus {
  if (status === "completed" || status === "cancelled") {
    return status;
  }

  return "stalled";
}

function createMissionDispatchResultFromTerminalRuntime(runtime: RuntimeRecord): MissionDispatchCommandPayloadLike {
  return {
    runId: runtime.runId || `runtime:${runtime.id}`,
    status: "completed",
    summary: runtime.subtitle || "completed",
    meta: {
      agentId: runtime.agentId,
      sessionId: runtime.sessionId,
      model: runtime.modelId,
      usage: runtime.tokenUsage
    }
  };
}

export async function buildObservedMissionDispatchRuntime(record: MissionDispatchRecordLike) {
  const sessionId = extractMissionDispatchSessionId(record);

  if (!record.agentId || !sessionId) {
    return null;
  }

  const transcriptPath = await resolveRuntimeTranscriptPathFromTranscript(
    record.agentId,
    sessionId,
    record.workspacePath ?? undefined
  );

  if (!transcriptPath) {
    return null;
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const transcriptRuntime = buildMissionDispatchTranscriptRuntimeFromRuntime(record, sessionId);
    const turns = filterTranscriptTurnsForRuntimeFromTranscript(
      transcriptRuntime,
      extractTranscriptTurnsFromTranscript(raw, transcriptRuntime, record.workspacePath ?? undefined)
    );

    if (turns.length === 0) {
      return null;
    }

    if (record.mission && !turns.some((turn) => matchesMissionText(turn.prompt, record.mission))) {
      return null;
    }

    return transcriptRuntime;
  } catch {
    return null;
  }
}

export async function readMissionDispatchRecords(): Promise<MissionDispatchRecord[]> {
  try {
    const dispatchesRoot = missionDispatchesRootPath();
    const entries = await readdir(dispatchesRoot, { withFileTypes: true });
    const nowMs = Date.now();
    const records = (await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(dispatchesRoot, entry.name);
          const record = await readMissionDispatchRecord(filePath);

          if (!record) {
            return null;
          }

          if (shouldPruneMissionDispatchRecord(record, nowMs)) {
            await rm(filePath, { force: true });
            if (record.runner.logPath) {
              await rm(record.runner.logPath, { force: true });
            }
            return null;
          }

          return record;
        })
    )) as Array<MissionDispatchRecord | null>;

    return records
      .filter((record): record is MissionDispatchRecord => Boolean(record))
      .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
  } catch {
    return [];
  }
}

export async function readMissionDispatchRecordById(dispatchId: string): Promise<MissionDispatchRecord | null> {
  return readMissionDispatchRecord(missionDispatchRecordPath(dispatchId));
}

async function readMissionDispatchRecord(filePath: string): Promise<MissionDispatchRecord | null> {
  try {
    const raw = await readFile(filePath, "utf8");
    const parsed = JSON.parse(raw) as Partial<MissionDispatchRecord>;

    if (
      !parsed ||
      typeof parsed !== "object" ||
      typeof parsed.id !== "string" ||
      typeof parsed.agentId !== "string" ||
      typeof parsed.mission !== "string" ||
      typeof parsed.routedMission !== "string" ||
      typeof parsed.submittedAt !== "string" ||
      typeof parsed.updatedAt !== "string"
    ) {
      return null;
    }

    const status = normalizeMissionDispatchStatus(parsed.status);

    return {
      id: parsed.id,
      clientRequestId: typeof parsed.clientRequestId === "string" ? parsed.clientRequestId : null,
      status,
      agentId: parsed.agentId,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      mission: parsed.mission,
      routedMission: parsed.routedMission,
      thinking: normalizeMissionThinking(parsed.thinking),
      requestedModelId: typeof parsed.requestedModelId === "string" ? parsed.requestedModelId : null,
      workspaceId: typeof parsed.workspaceId === "string" ? parsed.workspaceId : null,
      workspacePath: typeof parsed.workspacePath === "string" ? parsed.workspacePath : null,
      submittedAt: parsed.submittedAt,
      updatedAt: parsed.updatedAt,
      outputDir: typeof parsed.outputDir === "string" ? parsed.outputDir : null,
      outputDirRelative: typeof parsed.outputDirRelative === "string" ? parsed.outputDirRelative : null,
      notesDirRelative: typeof parsed.notesDirRelative === "string" ? parsed.notesDirRelative : null,
      runner: {
        pid: typeof parsed.runner?.pid === "number" ? parsed.runner.pid : null,
        childPid: typeof parsed.runner?.childPid === "number" ? parsed.runner.childPid : null,
        startedAt: typeof parsed.runner?.startedAt === "string" ? parsed.runner.startedAt : null,
        finishedAt: typeof parsed.runner?.finishedAt === "string" ? parsed.runner.finishedAt : null,
        lastHeartbeatAt: typeof parsed.runner?.lastHeartbeatAt === "string" ? parsed.runner.lastHeartbeatAt : null,
        logPath: typeof parsed.runner?.logPath === "string" ? parsed.runner.logPath : missionDispatchRunnerLogPath(parsed.id)
      },
      observation: {
        runtimeId: typeof parsed.observation?.runtimeId === "string" ? parsed.observation.runtimeId : null,
        observedAt: typeof parsed.observation?.observedAt === "string" ? parsed.observation.observedAt : null
      },
      result: isMissionCommandPayload(parsed.result) ? parsed.result : null,
      error: typeof parsed.error === "string" ? parsed.error : null
    } satisfies MissionDispatchRecord;
  } catch {
    return null;
  }
}

export function isMissionDispatchTerminalStatus(status: string) {
  return status === "completed" || status === "stalled" || status === "cancelled";
}

export function normalizeMissionAbortReason(reason?: string | null) {
  const trimmed = typeof reason === "string" ? reason.trim() : "";
  return trimmed.length > 0 ? trimmed : "Mission aborted by operator.";
}

function missionDispatchRecordPath(dispatchId: string) {
  return path.join(missionDispatchesRootPath(), `${dispatchId}.json`);
}

function missionDispatchRunnerLogPath(dispatchId: string) {
  return path.join(missionDispatchesRootPath(), `${dispatchId}.log.jsonl`);
}

function missionControlRootPath() {
  const configuredRoot = process.env.AGENTOS_MISSION_CONTROL_ROOT?.trim();
  return path.resolve(configuredRoot || path.join(process.cwd(), ".mission-control"));
}

function missionDispatchesRootPath() {
  return path.join(missionControlRootPath(), "dispatches");
}

function maxIsoTimestamp(left: string | null | undefined, right: string | null | undefined): string {
  const leftMs = left ? Date.parse(left) : Number.NaN;
  const rightMs = right ? Date.parse(right) : Number.NaN;

  if (Number.isNaN(leftMs)) {
    return right ?? new Date().toISOString();
  }

  if (Number.isNaN(rightMs)) {
    return left ?? new Date().toISOString();
  }

  return leftMs >= rightMs ? (left ?? new Date().toISOString()) : right!;
}

function shouldPruneMissionDispatchRecord(record: MissionDispatchRecord, nowMs: number) {
  const updatedAt = Date.parse(record.updatedAt);

  if (Number.isNaN(updatedAt)) {
    return false;
  }

  return nowMs - updatedAt > missionDispatchRetentionMs;
}

function timestampFromUnix(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return null;
  }

  return new Date(value).toISOString();
}
