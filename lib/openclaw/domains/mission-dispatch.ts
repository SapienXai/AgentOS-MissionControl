import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { matchesMissionText } from "@/lib/openclaw/runtime-matching";
import {
  collectTranscriptToolNames as collectTranscriptToolNamesFromTranscript,
  extractTranscriptTurns as extractTranscriptTurnsFromTranscript,
  filterTranscriptTurnsForRuntime as filterTranscriptTurnsForRuntimeFromTranscript,
  resolveRuntimeTranscriptPath as resolveRuntimeTranscriptPathFromTranscript
} from "@/lib/openclaw/domains/runtime-transcript";
import type { TranscriptTurn } from "@/lib/openclaw/domains/runtime-transcript";
import type {
  MissionControlSnapshot,
  RuntimeCreatedFile,
  RuntimeRecord,
  RuntimeOutputRecord,
  TaskIntegrityRecord,
  TaskRecord
} from "@/lib/openclaw/types";

type MissionDispatchRecord = {
  id: string;
  agentId: string;
  mission: string;
  routedMission: string;
  submittedAt: string;
  updatedAt: string;
  status: string;
  sessionId?: string | null;
  workspacePath?: string | null;
  outputDir?: string | null;
  outputDirRelative?: string | null;
  error?: string | null;
  result?: unknown;
  observation: {
    runtimeId?: string | null;
    observedAt?: string | null;
  };
  meta?: unknown;
};

const EMAIL_PATTERN = /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi;

export function extractMissionDispatchSessionId(record: MissionDispatchRecord) {
  return (
    (record.sessionId?.trim() || null) ??
    extractMissionDispatchString(extractMissionDispatchAgentMeta(record), "sessionId") ??
    extractSessionIdFromRuntimeId(record.observation.runtimeId)
  );
}

export function resolveMissionDispatchSummary(record: MissionDispatchRecord) {
  const summary = extractMissionDispatchString(getMissionDispatchResult(record), "summary");

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

export function resolveMissionDispatchResultText(record: MissionDispatchRecord) {
  const text = extractMissionCommandPayloadTexts(record.result).find((payload) => payload.text.trim().length > 0)
    ?.text.trim() ?? null;
  return isPlaceholderMissionResponseText(text) ? null : text;
}

export function isPlaceholderMissionResponseText(value: string | null) {
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

export function resolveMissionDispatchIntegrityWarning(record: MissionDispatchRecord) {
  const resultText = resolveMissionDispatchResultText(record);

  if (record.status !== "completed" || !isPlaceholderMissionReply(resultText)) {
    return null;
  }

  if (!record.observation.observedAt) {
    return "Dispatch finished, but the only saved result was READY and no mission transcript was linked.";
  }

  return "Dispatch finished, but the saved reply still looks like a placeholder READY response.";
}

export async function buildTaskIntegrityRecord(input: {
  task: TaskRecord;
  runs: RuntimeRecord[];
  outputs: RuntimeOutputRecord[];
  createdFiles: RuntimeCreatedFile[];
  dispatchRecord: MissionDispatchRecord | null;
  snapshot: MissionControlSnapshot;
}): Promise<TaskIntegrityRecord> {
  const { task, dispatchRecord, createdFiles, snapshot } = input;
  const outputDirInspection = await inspectMissionDispatchOutputDir(dispatchRecord?.outputDir ?? null);
  const transcriptTurns = dispatchRecord
    ? await readMissionDispatchTranscriptTurns(dispatchRecord, snapshot)
    : ([] as TranscriptTurn[]);
  const missionText = task.mission || dispatchRecord?.mission || null;
  const matchingTranscriptTurns =
    missionText && transcriptTurns.length > 0
      ? transcriptTurns.filter((turn) => matchesMissionText(turn.prompt, missionText))
      : transcriptTurns;
  const latestMatchingTurn =
    [...matchingTranscriptTurns].sort(
      (left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt)
    )[0] ?? null;
  const runtimeFinalText = latestMatchingTurn?.finalText?.trim() || null;
  const dispatchResultText = dispatchRecord ? resolveMissionDispatchResultText(dispatchRecord) : null;
  const finalResponseText = runtimeFinalText || dispatchResultText || null;
  const finalResponseSource = runtimeFinalText ? "runtime" : dispatchResultText ? "dispatch" : "none";
  const sessionMismatch = Boolean(dispatchRecord && transcriptTurns.length > 0 && matchingTranscriptTurns.length === 0);
  const toolNames = collectTranscriptToolNamesFromTranscript(matchingTranscriptTurns);
  const emails = extractEmailsFromValues([
    finalResponseText,
    dispatchResultText,
    ...matchingTranscriptTurns.flatMap((turn) => turn.items.map((item) => item.text))
  ]);
  const issues: TaskIntegrityRecord["issues"] = [];
  const placeholderResponse = isPlaceholderMissionResponseText(finalResponseText);
  const expectsFileArtifact = missionRequestsFileArtifact(missionText);
  const expectsEmailAddress = missionRequestsEmailAddress(missionText);
  const expectsExternalLookup = missionNeedsExternalLookup(missionText);

  if (dispatchRecord?.outputDir && !outputDirInspection.exists) {
    issues.push({
      id: "missing-output-dir",
      severity: "warning",
      title: "Output folder is missing",
      detail: `The dispatch points at ${dispatchRecord.outputDirRelative || dispatchRecord.outputDir}, but that folder is not accessible now.`
    });
  }

  if (
    task.status === "completed" &&
    expectsFileArtifact &&
    dispatchRecord?.outputDir &&
    outputDirInspection.exists &&
    outputDirInspection.fileCount === 0 &&
    createdFiles.length === 0
  ) {
    issues.push({
      id: "empty-output-dir",
      severity: "error",
      title: "Deliverables folder is empty",
      detail: "The task asked for a file deliverable, but the assigned deliverables folder does not contain any files."
    });
  }

  if (task.status === "completed" && transcriptTurns.length === 0) {
    issues.push({
      id: "missing-transcript",
      severity: "warning",
      title: "No runtime transcript was captured",
      detail: "AgentOS could not verify what the agent actually did because no transcript was recovered for this dispatch."
    });
  }

  if (task.status === "cancelled") {
    issues.push({
      id: "task-cancelled",
      severity: "warning",
      title: "Task was cancelled by the operator",
      detail:
        dispatchRecord?.error ||
        "The mission dispatch was stopped before completion, so the captured evidence is intentionally incomplete."
    });
  }

  if (sessionMismatch && dispatchRecord?.agentId) {
    issues.push({
      id: "session-mismatch",
      severity: "error",
      title: "Recovered session does not match the mission",
      detail: "The linked transcript session exists, but none of its user turns match this task mission. The dispatch likely reused or attached the wrong session."
    });
  }

  if (task.status === "completed" && !finalResponseText) {
    issues.push({
      id: "missing-final-response",
      severity: "warning",
      title: "No final answer was captured",
      detail: "The task completed without a final assistant response in either the runtime transcript or the dispatch payload."
    });
  } else if (task.status === "stalled" && finalResponseText) {
    issues.push({
      id: "partial-final-response",
      severity: "warning",
      title: "Final response came from an incomplete runtime",
      detail:
        "The assistant produced output, but the runtime stalled before the task completed. Treat this as the last captured response, not a verified completion."
    });
  } else if (task.status === "completed" && placeholderResponse && finalResponseText) {
    issues.push({
      id: "placeholder-final-response",
      severity:
        outputDirInspection.fileCount === 0 && createdFiles.length === 0 && matchingTranscriptTurns.length === 0
          ? "error"
          : "warning",
      title: "Completion response looks like a placeholder",
      detail: `The captured final response was "${finalResponseText}", which is not enough evidence that the requested work actually finished.`
    });
  }

  if (task.status === "completed" && expectsExternalLookup && matchingTranscriptTurns.length > 0 && toolNames.length === 0) {
    issues.push({
      id: "missing-tool-evidence",
      severity: "warning",
      title: "No tool usage was recovered",
      detail: "This mission looks like it needed external lookup or browsing, but the matching transcript turn does not show any recovered tool calls."
    });
  }

  if (task.status === "completed" && expectsEmailAddress && emails.length === 0) {
    issues.push({
      id: "missing-email",
      severity: "warning",
      title: "Requested email address was not captured",
      detail: "The task appears to ask for an email address, but none was detected in the final response or the matching transcript."
    });
  }

  return {
    status: issues.some((issue) => issue.severity === "error")
      ? "error"
      : issues.length > 0
        ? "warning"
        : "verified",
    outputDir: dispatchRecord?.outputDir ?? null,
    outputDirRelative: dispatchRecord?.outputDirRelative ?? null,
    outputDirExists: outputDirInspection.exists,
    outputFileCount: outputDirInspection.fileCount,
    transcriptTurnCount: transcriptTurns.length,
    matchingTranscriptTurnCount: matchingTranscriptTurns.length,
    finalResponseText,
    finalResponseSource,
    dispatchSessionId: dispatchRecord ? extractMissionDispatchSessionId(dispatchRecord) : null,
    sessionMismatch,
    toolNames,
    emails,
    issues
  };
}

async function readMissionDispatchTranscriptTurns(record: MissionDispatchRecord, snapshot: MissionControlSnapshot) {
  const sessionId = extractMissionDispatchSessionId(record);

  if (!sessionId) {
    return [] as TranscriptTurn[];
  }

  const agent = snapshot.agents.find((entry) => entry.id === record.agentId);
  const transcriptPath = await resolveRuntimeTranscriptPathFromTranscript(
    record.agentId,
    sessionId,
    record.workspacePath ?? agent?.workspacePath
  );

  if (!transcriptPath) {
    return [] as TranscriptTurn[];
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const transcriptRuntime = {
      id: `runtime:dispatch:${record.id}`,
      sessionId,
      agentId: record.agentId,
      taskId: record.id,
      metadata: {
        dispatchSubmittedAt: record.submittedAt
      }
    } as unknown as RuntimeRecord;

    return filterTranscriptTurnsForRuntimeFromTranscript(
      transcriptRuntime,
      extractTranscriptTurnsFromTranscript(raw, transcriptRuntime, record.workspacePath ?? agent?.workspacePath)
    );
  } catch {
    return [] as TranscriptTurn[];
  }
}

async function inspectMissionDispatchOutputDir(outputDir: string | null) {
  if (!outputDir) {
    return {
      exists: false,
      fileCount: 0
    };
  }

  try {
    const outputStat = await stat(outputDir);

    if (!outputStat.isDirectory()) {
      return {
        exists: true,
        fileCount: 1
      };
    }

    return {
      exists: true,
      fileCount: await countFilesInDirectory(outputDir)
    };
  } catch {
    return {
      exists: false,
      fileCount: 0
    };
  }
}

async function countFilesInDirectory(directoryPath: string): Promise<number> {
  const entries = await readdir(directoryPath, { withFileTypes: true });
  let count = 0;

  for (const entry of entries) {
    const entryPath = path.join(directoryPath, entry.name);

    if (entry.isDirectory()) {
      count += await countFilesInDirectory(entryPath);
      continue;
    }

    if (entry.isFile()) {
      count += 1;
    }
  }

  return count;
}

function extractEmailsFromValues(values: Array<string | null | undefined>) {
  const emails = new Set<string>();

  for (const value of values) {
    if (!value) {
      continue;
    }

    for (const match of value.match(EMAIL_PATTERN) ?? []) {
      emails.add(match.toLowerCase());
    }
  }

  return [...emails];
}

function missionRequestsFileArtifact(value: string | null) {
  if (!value) {
    return false;
  }

  return (
    /\.(txt|md|json|csv|html|pdf|docx?)\b/i.test(value) ||
    /\b(file|files|artifact|artifacts|report|document|save|export|attachment)\b/i.test(value) ||
    /\b(dosya|dosyasi|kaydet|kaydi|cikti)\b/i.test(value)
  );
}

function missionRequestsEmailAddress(value: string | null) {
  if (!value) {
    return false;
  }

  return /\b(email|e-mail|mail|mail address|mail adres|eposta|e-posta)\b/i.test(value);
}

function missionNeedsExternalLookup(value: string | null) {
  if (!value) {
    return false;
  }

  return (
    /https?:\/\//i.test(value) ||
    /\b[a-z0-9-]+\.(com|net|org|io|ai|co|tr|app|dev|me|info|biz|edu|gov)\b/i.test(value) ||
    /\b(site|website|web|browser|browse|fetch|sitesine|siteye|siteyi)\b/i.test(value)
  );
}

function extractMissionDispatchAgentMeta(record: MissionDispatchRecord) {
  const meta = getMissionDispatchResult(record)?.meta;

  if (!meta || typeof meta !== "object") {
    const topLevelMeta = record.meta;
    return topLevelMeta && typeof topLevelMeta === "object" ? extractMissionDispatchAgentMetaFromRecord(topLevelMeta) : null;
  }

  return extractMissionDispatchAgentMetaFromRecord(meta);
}

function extractMissionDispatchAgentMetaFromRecord(record: unknown) {
  if (!record || typeof record !== "object") {
    return null;
  }

  const agentMeta = (record as Record<string, unknown>).agentMeta;
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

function getMissionDispatchResult(record: MissionDispatchRecord) {
  if (!record.result || typeof record.result !== "object") {
    return null;
  }

  return record.result as Record<string, unknown>;
}

function extractMissionCommandPayloadTexts(value: unknown) {
  if (!value || typeof value !== "object") {
    return [] as Array<{
      text: string;
      mediaUrl: string | null;
    }>;
  }

  const payload = value as {
    result?: {
      payloads?: unknown;
    };
    payloads?: unknown;
  };
  const candidates = Array.isArray(payload.result?.payloads)
    ? payload.result.payloads
    : Array.isArray(payload.payloads)
      ? payload.payloads
      : [];

  return candidates.filter(
    (entry): entry is { text: string; mediaUrl: string | null } =>
      Boolean(entry) && typeof (entry as { text?: unknown }).text === "string"
  );
}
