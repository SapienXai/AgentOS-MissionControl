import { execFile, spawn } from "node:child_process";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { randomUUID } from "node:crypto";

import { resolveOpenClawBin } from "@/lib/openclaw/cli";
import { matchesMissionText } from "@/lib/openclaw/runtime-matching";
import {
  buildMissionDispatchTranscriptRuntime as buildMissionDispatchTranscriptRuntimeFromRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import {
  createMissionDispatchResultFromRuntimeOutput,
  extractMissionDispatchSessionId,
  isMissionCommandPayload,
  normalizeMissionDispatchStatus,
  normalizeMissionThinking
} from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  extractTranscriptTurns as extractTranscriptTurnsFromTranscript,
  filterTranscriptTurnsForRuntime as filterTranscriptTurnsForRuntimeFromTranscript,
  parseRuntimeOutput as parseRuntimeOutputFromTranscript,
  resolveRuntimeTranscriptPath as resolveRuntimeTranscriptPathFromTranscript
} from "@/lib/openclaw/domains/runtime-transcript";
import type { MissionDispatchRecordLike } from "@/lib/openclaw/domains/mission-dispatch-model";
import type { RuntimeRecord, TaskRecord, MissionDispatchStatus, MissionSubmission } from "@/lib/openclaw/types";

type MissionDispatchCommandPayloadLike = {
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

export type MissionDispatchPayload = {
  agentId: string;
  mission: string;
  routedMission: string;
  thinking: NonNullable<MissionSubmission["thinking"]>;
  workspaceId: string | null;
  workspacePath: string | null;
  outputDir: string | null;
  outputDirRelative: string | null;
  notesDirRelative: string | null;
};

type MissionDispatchObservation = {
  runtimeId: string | null;
  observedAt: string | null;
};

export type MissionDispatchRecord = Omit<MissionDispatchRecordLike, "status" | "result"> & {
  status: MissionDispatchStatus;
  result: MissionDispatchCommandPayloadLike | null;
  observation: MissionDispatchObservation;
};

const missionControlRootPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control");
const missionDispatchesRootPath = path.join(missionControlRootPath, "dispatches");
const missionDispatchRunnerPath = path.join(
  /*turbopackIgnore: true*/ process.cwd(),
  "scripts",
  "openclaw-mission-dispatch-runner.mjs"
);
const missionDispatchRetentionMs = 3 * 24 * 60 * 60 * 1000;

const execFileAsync = promisify(execFile);

export function createMissionDispatchRecord(payload: MissionDispatchPayload): MissionDispatchRecord {
  const now = new Date().toISOString();
  const dispatchId = `dispatch-${randomUUID()}`;

  return {
    id: dispatchId,
    status: "queued",
    agentId: payload.agentId,
    sessionId: randomUUID(),
    mission: payload.mission,
    routedMission: payload.routedMission,
    thinking: payload.thinking,
    workspaceId: payload.workspaceId,
    workspacePath: payload.workspacePath,
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
    error: null
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
    cwd: process.cwd(),
    detached: true,
    stdio: "ignore",
    env: {
      ...process.env,
      OPENCLAW_BIN: openClawBin
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
    observation: {
      runtimeId: runtime.id,
      observedAt
    }
  });
}

export async function reconcileMissionDispatchRuntimeState(record: MissionDispatchRecordLike, runtime: RuntimeRecord) {
  if (isMissionDispatchTerminalStatus(record.status)) {
    return;
  }

  if (!runtime.agentId || !runtime.sessionId) {
    return;
  }

  const transcriptPath = await resolveRuntimeTranscriptPathFromTranscript(
    runtime.agentId,
    runtime.sessionId,
    record.workspacePath ?? undefined
  );

  if (!transcriptPath) {
    return;
  }

  let raw = "";
  try {
    raw = await readFile(transcriptPath, "utf8");
  } catch {
    return;
  }

  const output = parseRuntimeOutputFromTranscript(runtime, raw, record.workspacePath ?? undefined);
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

  await writeMissionDispatchRecord({
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
  });
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
    const entries = await readdir(missionDispatchesRootPath, { withFileTypes: true });
    const nowMs = Date.now();
    const records = (await Promise.all(
      entries
        .filter((entry) => entry.isFile() && entry.name.endsWith(".json"))
        .map(async (entry) => {
          const filePath = path.join(missionDispatchesRootPath, entry.name);
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
      status,
      agentId: parsed.agentId,
      sessionId: typeof parsed.sessionId === "string" ? parsed.sessionId : null,
      mission: parsed.mission,
      routedMission: parsed.routedMission,
      thinking: normalizeMissionThinking(parsed.thinking),
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
  return path.join(missionDispatchesRootPath, `${dispatchId}.json`);
}

function missionDispatchRunnerLogPath(dispatchId: string) {
  return path.join(missionDispatchesRootPath, `${dispatchId}.log.jsonl`);
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
