import { readFile } from "node:fs/promises";

import type { MissionDispatchRecordLike } from "@/lib/openclaw/domains/mission-dispatch-model";
import type { TaskFeedEventKind } from "@/lib/openclaw/types";

export type MissionDispatchRunnerLogEntry = {
  id: string;
  timestamp: string;
  stream: "status" | "stdout" | "stderr";
  text: string;
};

const missionDispatchRunnerDiagnosticJsonKeys = new Set([
  "cause",
  "code",
  "details",
  "error",
  "message",
  "reason",
  "stack",
  "stderr",
  "stdout",
  "warning"
]);

export async function readMissionDispatchRunnerLogs(
  record: Pick<MissionDispatchRecordLike, "runner">,
  limit = 18
) {
  const logPath = record.runner.logPath?.trim();

  if (!logPath) {
    return [] as MissionDispatchRunnerLogEntry[];
  }

  try {
    const raw = await readFile(logPath, "utf8");

    return raw
      .split(/\r?\n/)
      .map((line) => parseMissionDispatchRunnerLogEntry(line))
      .filter((entry): entry is MissionDispatchRunnerLogEntry => Boolean(entry))
      .map((entry) => normalizeMissionDispatchRunnerLogEntry(entry))
      .filter((entry): entry is MissionDispatchRunnerLogEntry => Boolean(entry))
      .slice(-limit);
  } catch {
    return [] as MissionDispatchRunnerLogEntry[];
  }
}

export function presentMissionDispatchRunnerLogEntry(entry: MissionDispatchRunnerLogEntry): {
  kind: TaskFeedEventKind;
  title: string;
  detail: string;
  isError: boolean;
} | null {
  const detail = normalizeMissionDispatchRunnerLogText(entry.text);

  if (!detail) {
    return null;
  }

  if (entry.stream === "status") {
    return {
      kind: "status",
      title: "Dispatch runner",
      detail,
      isError: false
    };
  }

  if (entry.stream === "stdout") {
    return {
      kind: "status",
      title: "Runner output",
      detail,
      isError: false
    };
  }

  const isError = isMissionDispatchRunnerErrorText(detail);

  return {
    kind: isError ? "warning" : "status",
    title: isError ? "Runner warning" : "Runner note",
    detail,
    isError
  };
}

function parseMissionDispatchRunnerLogEntry(raw: string) {
  const line = raw.trim();

  if (!line) {
    return null;
  }

  try {
    const parsed = JSON.parse(line) as Partial<MissionDispatchRunnerLogEntry>;

    if (
      !parsed ||
      typeof parsed.id !== "string" ||
      typeof parsed.timestamp !== "string" ||
      typeof parsed.text !== "string" ||
      !isMissionDispatchRunnerLogStream(parsed.stream)
    ) {
      return null;
    }

    return {
      id: parsed.id,
      timestamp: parsed.timestamp,
      stream: parsed.stream,
      text: parsed.text
    } satisfies MissionDispatchRunnerLogEntry;
  } catch {
    return null;
  }
}

function isMissionDispatchRunnerLogStream(
  value: unknown
): value is MissionDispatchRunnerLogEntry["stream"] {
  return value === "status" || value === "stdout" || value === "stderr";
}

function normalizeMissionDispatchRunnerLogEntry(entry: MissionDispatchRunnerLogEntry) {
  const text = normalizeMissionDispatchRunnerLogText(entry.text);

  if (!text) {
    return null;
  }

  return {
    ...entry,
    text
  } satisfies MissionDispatchRunnerLogEntry;
}

function normalizeMissionDispatchRunnerLogText(text: string) {
  const normalized = text.trim();

  if (!normalized || shouldHideMissionDispatchRunnerLogText(normalized)) {
    return null;
  }

  const quotedPropertyMatch = normalized.match(/^"([^"]+)"\s*:\s*(.+?)(,)?$/);

  if (quotedPropertyMatch) {
    const [, key, rawValue] = quotedPropertyMatch;

    if (!missionDispatchRunnerDiagnosticJsonKeys.has(key.toLowerCase())) {
      return null;
    }

    return `${formatMissionDispatchRunnerLogKey(key)}: ${decodeMissionDispatchRunnerLogValue(rawValue)}`;
  }

  const barePropertyMatch = normalized.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/);

  if (barePropertyMatch && missionDispatchRunnerDiagnosticJsonKeys.has(barePropertyMatch[1].toLowerCase())) {
    return `${formatMissionDispatchRunnerLogKey(barePropertyMatch[1])}: ${decodeMissionDispatchRunnerLogValue(
      barePropertyMatch[2]
    )}`;
  }

  return normalized;
}

function shouldHideMissionDispatchRunnerLogText(text: string) {
  if (/^[\[\]{}(),]+$/.test(text)) {
    return true;
  }

  const quotedPropertyMatch = text.match(/^"([^"]+)"\s*:\s*(.+?)(,)?$/);

  if (quotedPropertyMatch) {
    return !missionDispatchRunnerDiagnosticJsonKeys.has(quotedPropertyMatch[1].toLowerCase());
  }

  const barePropertyMatch = text.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/);

  if (barePropertyMatch) {
    return false;
  }

  return false;
}

function formatMissionDispatchRunnerLogKey(key: string) {
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function decodeMissionDispatchRunnerLogValue(value: string) {
  const normalized = value.trim().replace(/,$/, "");

  if (!normalized) {
    return "";
  }

  try {
    const parsed = JSON.parse(normalized) as unknown;

    if (typeof parsed === "string") {
      return parsed;
    }

    if (typeof parsed === "number" || typeof parsed === "boolean") {
      return String(parsed);
    }
  } catch {}

  return normalized.replace(/^"(.*)"$/, "$1");
}

function isMissionDispatchRunnerErrorText(text: string) {
  const normalized = text.trim().toLowerCase();

  if (!normalized) {
    return false;
  }

  if (
    normalized.includes("exited successfully") ||
    normalized.includes("booted for agent") ||
    normalized.includes("launched openclaw agent process")
  ) {
    return false;
  }

  return /(aborted|denied|enoent|eacces|error|exception|failed|failure|invalid|killed|not found|panic|refused|stalled|timeout|timed out|traceback)/i.test(
    text
  );
}
