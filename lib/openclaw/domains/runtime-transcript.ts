import { access, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { compactMissionText } from "@/lib/openclaw/presenters";
import { matchesMissionText } from "@/lib/openclaw/runtime-matching";
import type {
  MissionControlSnapshot,
  RuntimeCreatedFile,
  RuntimeOutputItem,
  RuntimeOutputRecord,
  RuntimeRecord
} from "@/lib/openclaw/types";

type RuntimeSessionEntry = {
  agentId?: string;
  key?: string;
  sessionId?: string;
  updatedAt?: number;
  ageMs?: number;
  inputTokens?: number;
  outputTokens?: number;
  cacheRead?: number;
  totalTokens?: number;
  model?: string;
};

type SessionTranscriptEntry = {
  type?: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  cwd?: string;
  customType?: string;
  data?: {
    timestamp?: number;
    runId?: string;
    sessionId?: string;
    error?: string;
  };
  message?: {
    role?: "assistant" | "toolResult" | "user";
    content?: Array<{
      type?: string;
      text?: string;
      thinking?: string;
      id?: string;
      name?: string;
      arguments?: Record<string, unknown>;
    }>;
    stopReason?: string;
    errorMessage?: string;
    toolCallId?: string;
    toolName?: string;
    isError?: boolean;
    details?: {
      status?: string;
      exitCode?: number;
      durationMs?: number;
      aggregated?: string;
      cwd?: string;
    };
    usage?: {
      input?: number;
      output?: number;
      totalTokens?: number;
      cacheRead?: number;
    };
  };
};

export type TranscriptTurn = {
  id: string;
  prompt: string;
  sessionId?: string;
  runId?: string;
  timestamp: string;
  updatedAt: string;
  items: RuntimeOutputItem[];
  status: RuntimeRecord["status"];
  finalText: string | null;
  finalTimestamp: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  tokenUsage?: RuntimeRecord["tokenUsage"];
  createdFiles: RuntimeCreatedFile[];
  warnings: string[];
  warningSummary: string | null;
  toolNames: string[];
};

const transcriptHeartbeatPrefix = "read heartbeat.md if it exists";

export async function mapSessionToRuntimes<
  TAgentConfig extends { id: string; workspace?: string },
  TAgent extends { id: string; workspace?: string }
>(
  session: RuntimeSessionEntry,
  agentConfig: TAgentConfig[],
  agentsList: TAgent[],
  mapRuntime: (session: RuntimeSessionEntry, agentConfig: TAgentConfig[], agentsList: TAgent[]) => RuntimeRecord
) {
  const runtime = mapRuntime(session, agentConfig, agentsList);

  if (!session.key?.endsWith(":main") || !session.agentId || !session.sessionId) {
    return [runtime];
  }

  const agent = agentsList.find((entry) => entry.id === session.agentId);
  const config = agentConfig.find((entry) => entry.id === session.agentId);
  const transcriptPath = await resolveRuntimeTranscriptPath(
    session.agentId,
    session.sessionId,
    agent?.workspace || config?.workspace
  );

  if (!transcriptPath) {
    return [runtime];
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const turns = extractTranscriptTurns(raw, runtime, agent?.workspace || config?.workspace).filter(
      (turn) => !isHeartbeatTurn(turn.prompt)
    );
    const observedToolNames = collectTranscriptToolNames(turns);

    if (turns.length === 0) {
      return [runtime];
    }

    return turns.slice(-6).reverse().map((turn) => createTurnRuntime(runtime, turn, observedToolNames));
  } catch {
    return [runtime];
  }
}

export async function getRuntimeOutputForResolvedRuntime(
  runtime: RuntimeRecord,
  snapshot: MissionControlSnapshot
): Promise<RuntimeOutputRecord> {
  if (snapshot.mode === "fallback") {
    return createFallbackRuntimeOutput(runtime);
  }

  if (!runtime.sessionId || !runtime.agentId) {
    return createMissingRuntimeOutput(runtime, "This runtime does not expose a session transcript yet.");
  }

  const agent = snapshot.agents.find((entry) => entry.id === runtime.agentId);
  const transcriptPath = await resolveRuntimeTranscriptPath(runtime.agentId, runtime.sessionId, agent?.workspacePath);

  if (!transcriptPath) {
    return createMissingRuntimeOutput(runtime, "No transcript file was found for this runtime session.");
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    return parseRuntimeOutput(runtime, raw, agent?.workspacePath);
  } catch (error) {
    return {
      runtimeId: runtime.id,
      sessionId: runtime.sessionId,
      taskId: runtime.taskId,
      status: "error",
      finalText: null,
      finalTimestamp: null,
      stopReason: null,
      errorMessage: error instanceof Error ? error.message : "Unable to read runtime transcript.",
      items: [],
      createdFiles: [],
      warnings: [],
      warningSummary: null
    };
  }
}

export async function resolveRuntimeTranscriptPath(
  agentId: string,
  sessionId: string,
  workspacePath?: string
) {
  const candidates = [
    path.join(os.homedir(), ".openclaw", "agents", agentId, "sessions", `${sessionId}.jsonl`),
    workspacePath ? path.join(workspacePath, ".openclaw", "agents", agentId, "sessions", `${sessionId}.jsonl`) : null
  ].filter(Boolean) as string[];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch {
      continue;
    }
  }

  const aliasedTranscriptPath = await resolveRuntimeTranscriptPathFromSessionCatalog(agentId, sessionId, workspacePath);

  if (aliasedTranscriptPath) {
    return aliasedTranscriptPath;
  }

  return null;
}

export function extractTranscriptTurns(raw: string, runtime: RuntimeRecord, workspacePath?: string) {
  const lines = raw.split(/\r?\n/).filter(Boolean);
  const turns: TranscriptTurn[] = [];
  let sessionCwd = workspacePath;
  let currentTurn:
    | (Omit<TranscriptTurn, "status" | "finalText" | "finalTimestamp" | "stopReason" | "errorMessage" | "warningSummary"> & {
        errorMessage: string | null;
        pendingCreatedFiles: Map<string, RuntimeCreatedFile>;
        pendingToolNames: Set<string>;
      })
    | null = null;

  for (const line of lines) {
    try {
      const entry = JSON.parse(line) as SessionTranscriptEntry;

      if (entry.type === "session" && typeof entry.cwd === "string" && entry.cwd.trim()) {
        sessionCwd = entry.cwd.trim();
        continue;
      }

      if (entry.type === "custom" && entry.customType === "openclaw:prompt-error" && currentTurn) {
        currentTurn.runId ||= entry.data?.runId;
        currentTurn.updatedAt = entry.timestamp || currentTurn.updatedAt;
        currentTurn.errorMessage ||= entry.data?.error || null;
        continue;
      }

      if (entry.type !== "message" || !entry.message?.role) {
        continue;
      }

      const role = entry.message.role;

      if (role !== "assistant" && role !== "toolResult" && role !== "user") {
        continue;
      }

      const text = extractTranscriptText(entry.message.content);
      const errorMessage = entry.message.errorMessage ?? null;
      const warningMessage = resolveNonFatalToolWarning(role, entry.message, text, errorMessage);

      if (!text && !errorMessage) {
        if (
          !(
            (role === "assistant" && entry.message.content?.some((item) => item.type === "toolCall")) ||
            (role === "toolResult" && typeof entry.message.toolName === "string" && entry.message.toolName.trim())
          )
        ) {
          continue;
        }
      }

      const item: RuntimeOutputItem = {
        id: entry.id || `${role}-${Date.now()}`,
        role,
        timestamp: entry.timestamp || new Date().toISOString(),
        text: text || errorMessage || "",
        toolName:
          role === "toolResult"
            ? entry.message.toolName?.trim() || extractToolNameFromTranscriptText(text)
            : undefined,
        stopReason: role === "assistant" ? entry.message.stopReason ?? null : null,
        errorMessage,
        isWarning: Boolean(warningMessage),
        isError:
          Boolean(errorMessage) ||
          entry.message.isError === true ||
          entry.message.stopReason === "error" ||
          entry.message.stopReason === "aborted"
      };

      if (role === "user") {
        if (currentTurn) {
          turns.push(finalizeTranscriptTurn(currentTurn));
        }

        currentTurn = {
          id: entry.id || `turn-${turns.length}`,
          prompt: normalizeTranscriptPrompt(item.text),
          sessionId: runtime.sessionId,
          runId: undefined,
          timestamp: item.timestamp,
          updatedAt: item.timestamp,
          items: [item],
          tokenUsage: undefined,
          errorMessage: null,
          createdFiles: [],
          warnings: [],
          toolNames: [],
          pendingCreatedFiles: new Map(),
          pendingToolNames: new Set()
        };
        continue;
      }

      if (!currentTurn) {
        continue;
      }

      if (role === "assistant" && Array.isArray(entry.message.content)) {
        for (const contentItem of entry.message.content) {
          if (contentItem.type !== "toolCall") {
            continue;
          }

          if (typeof contentItem.name === "string" && contentItem.name.trim()) {
            currentTurn.pendingToolNames.add(contentItem.name.trim());
          }

          if (contentItem.name !== "write") {
            continue;
          }

          const candidatePath =
            typeof contentItem.arguments?.path === "string" ? contentItem.arguments.path.trim() : "";

          if (!candidatePath) {
            continue;
          }

          const resolved = resolveTranscriptArtifactPath(candidatePath, sessionCwd);

          if (!resolved) {
            continue;
          }

          currentTurn.pendingCreatedFiles.set(contentItem.id || `${entry.id || "toolCall"}:${candidatePath}`, {
            path: resolved.path,
            displayPath: resolved.displayPath
          });
        }
      }

      currentTurn.items.push(item);
      currentTurn.updatedAt = item.timestamp;
      currentTurn.errorMessage ||= errorMessage;

      if (warningMessage && !currentTurn.warnings.includes(warningMessage)) {
        currentTurn.warnings.push(warningMessage);
      }

      if (
        role === "toolResult" &&
        entry.message.isError !== true &&
        entry.message.toolName === "write" &&
        typeof entry.message.toolCallId === "string"
      ) {
        const createdFile = currentTurn.pendingCreatedFiles.get(entry.message.toolCallId);

        if (createdFile) {
          currentTurn.createdFiles.push(createdFile);
          currentTurn.pendingCreatedFiles.delete(entry.message.toolCallId);
        }
      }

      if (role === "toolResult") {
        const toolName =
          entry.message.toolName?.trim() || extractToolNameFromTranscriptText(item.text)?.trim() || null;

        if (toolName) {
          currentTurn.pendingToolNames.add(toolName);
        }
      }

      if (role === "assistant" && entry.message.usage) {
        const usage = entry.message.usage as {
          input?: number;
          output?: number;
          totalTokens?: number;
          cacheRead?: number;
          prompt_tokens?: number;
          completion_tokens?: number;
          total_tokens?: number;
        };
        currentTurn.tokenUsage = {
          input: usage.input ?? usage.prompt_tokens ?? 0,
          output: usage.output ?? usage.completion_tokens ?? 0,
          total:
            usage.totalTokens ??
            usage.total_tokens ??
            (usage.input ?? usage.prompt_tokens ?? 0) + (usage.output ?? usage.completion_tokens ?? 0),
          cacheRead: usage.cacheRead ?? 0
        };
      }
    } catch {
      continue;
    }
  }

  if (currentTurn) {
    turns.push(finalizeTranscriptTurn(currentTurn));
  }

  return turns;
}

export function filterTranscriptTurnsForRuntime(runtime: RuntimeRecord, turns: TranscriptTurn[]) {
  const dispatchSubmittedAt =
    typeof runtime.metadata.dispatchSubmittedAt === "string"
      ? Date.parse(runtime.metadata.dispatchSubmittedAt)
      : Number.NaN;

  if (Number.isNaN(dispatchSubmittedAt)) {
    return turns;
  }

  return turns.filter((turn) => {
    const updatedAt = Date.parse(turn.updatedAt || turn.timestamp);
    return !Number.isNaN(updatedAt) && updatedAt >= dispatchSubmittedAt - 1500;
  });
}

export function collectTranscriptToolNames(turns: TranscriptTurn[]) {
  return uniqueStrings(turns.flatMap((turn) => turn.toolNames));
}

function createFallbackRuntimeOutput(runtime: RuntimeRecord): RuntimeOutputRecord {
  const timestamp = new Date().toISOString();

  return {
    runtimeId: runtime.id,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    status: "available",
    finalText: "Fallback mode is active. Connect a real OpenClaw gateway to inspect live runtime output.",
    finalTimestamp: timestamp,
    stopReason: "fallback",
    errorMessage: null,
    items: [
      {
        id: `${runtime.id}:fallback`,
        role: "assistant",
        timestamp,
        text: "Fallback mode is active. Connect a real OpenClaw gateway to inspect live runtime output.",
        stopReason: "fallback",
        isError: false
      }
    ],
    createdFiles: [],
    warnings: [],
    warningSummary: null
  };
}

function createMissingRuntimeOutput(runtime: RuntimeRecord, errorMessage: string): RuntimeOutputRecord {
  return {
    runtimeId: runtime.id,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    status: "missing",
    finalText: null,
    finalTimestamp: null,
    stopReason: null,
    errorMessage,
    items: [],
    createdFiles: [],
    warnings: [],
    warningSummary: null
  };
}

export function parseRuntimeOutput(runtime: RuntimeRecord, raw: string, workspacePath?: string): RuntimeOutputRecord {
  const turns = filterTranscriptTurnsForRuntime(runtime, extractTranscriptTurns(raw, runtime, workspacePath));

  if (runtime.source === "turn") {
    const turnId = typeof runtime.metadata.turnId === "string" ? runtime.metadata.turnId : null;
    const turn = turnId ? turns.find((entry) => entry.id === turnId) : resolveRuntimeMissionTurn(runtime, turns);

    if (turn) {
      return runtimeOutputFromTurn(runtime, turn);
    }
  }

  const latestTurn = turns.at(-1);

  if (latestTurn) {
    return runtimeOutputFromTurn(runtime, latestTurn);
  }

  return {
    runtimeId: runtime.id,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    status: "missing",
    finalText: null,
    finalTimestamp: null,
    stopReason: null,
    errorMessage: "No transcript entries were found for this runtime.",
    items: [],
    createdFiles: [],
    warnings: [],
    warningSummary: null
  };
}

function resolveRuntimeMissionTurn(runtime: RuntimeRecord, turns: TranscriptTurn[]) {
  const mission = typeof runtime.metadata.mission === "string" ? runtime.metadata.mission : null;

  if (!mission) {
    return null;
  }

  const matchingTurns = turns.filter((turn) => matchesMissionText(turn.prompt, mission));

  if (matchingTurns.length === 0) {
    return null;
  }

  const runtimeUpdatedAt = runtime.updatedAt ?? 0;

  return matchingTurns.sort((left, right) => {
    const leftUpdatedAt = Date.parse(left.updatedAt);
    const rightUpdatedAt = Date.parse(right.updatedAt);
    const leftDelta = Math.abs((Number.isNaN(leftUpdatedAt) ? 0 : leftUpdatedAt) - runtimeUpdatedAt);
    const rightDelta = Math.abs((Number.isNaN(rightUpdatedAt) ? 0 : rightUpdatedAt) - runtimeUpdatedAt);

    return leftDelta - rightDelta;
  })[0];
}

function runtimeOutputFromTurn(runtime: RuntimeRecord, turn: TranscriptTurn): RuntimeOutputRecord {
  return {
    runtimeId: runtime.id,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    status: turn.items.length > 0 ? "available" : "missing",
    finalText: turn.finalText,
    finalTimestamp: turn.finalTimestamp,
    stopReason: turn.stopReason,
    errorMessage: turn.errorMessage,
    items: turn.items.slice(-12),
    createdFiles: turn.createdFiles,
    warnings: turn.warnings,
    warningSummary: turn.warningSummary
  };
}

function finalizeTranscriptTurn(
  turn: Omit<TranscriptTurn, "status" | "finalText" | "finalTimestamp" | "stopReason" | "warningSummary"> & {
    errorMessage: string | null;
    pendingCreatedFiles: Map<string, RuntimeCreatedFile>;
    pendingToolNames: Set<string>;
  }
): TranscriptTurn {
  const { pendingCreatedFiles, pendingToolNames, ...rest } = turn;
  void pendingCreatedFiles;
  void pendingToolNames;
  const finalAssistant = [...turn.items]
    .reverse()
    .find((item) => item.role === "assistant" && (item.text.trim().length > 0 || item.errorMessage));
  const lastItem = turn.items.at(-1);
  const stopReason = finalAssistant?.stopReason ?? null;
  const hasError =
    Boolean(turn.errorMessage) ||
    finalAssistant?.isError === true ||
    stopReason === "error" ||
    stopReason === "aborted";
  const warnings = uniqueStrings(turn.warnings);
  const status =
    hasError
      ? "stalled"
      : lastItem?.role === "assistant" && lastItem.stopReason && lastItem.stopReason !== "toolUse"
        ? "completed"
        : "running";

  return {
    ...rest,
    status,
    finalText: finalAssistant?.text ?? null,
    finalTimestamp: finalAssistant?.timestamp ?? null,
    stopReason,
    errorMessage: turn.errorMessage || finalAssistant?.errorMessage || null,
    createdFiles: dedupeCreatedFiles(turn.createdFiles),
    warnings,
    warningSummary: warnings[0] ?? null,
    toolNames: uniqueStrings([...turn.pendingToolNames])
  };
}

function createTurnRuntime(
  runtime: RuntimeRecord,
  turn: TranscriptTurn,
  toolNames: string[] = turn.toolNames
): RuntimeRecord {
  const updatedAt = Date.parse(turn.updatedAt);
  const title = formatTurnTitle(turn.prompt, runtime.agentId);
  const subtitle =
    turn.warningSummary
      ? summarizeText(`Completed with fallback: ${turn.warningSummary}`, 90)
      : turn.finalText
        ? summarizeText(turn.finalText, 90)
        : turn.status === "stalled"
          ? "Run stalled"
          : "Main session run";

  return {
    id: `runtime:${runtime.sessionId}:${turn.id}`,
    source: "turn",
    key: `${runtime.key}:turn:${turn.id}`,
    title,
    subtitle,
    status: turn.status,
    updatedAt: Number.isNaN(updatedAt) ? runtime.updatedAt : updatedAt,
    ageMs: Number.isNaN(updatedAt) ? runtime.ageMs : Math.max(Date.now() - updatedAt, 0),
    agentId: runtime.agentId,
    workspaceId: runtime.workspaceId,
    modelId: runtime.modelId,
    sessionId: runtime.sessionId,
    taskId: runtime.taskId,
    runId: turn.runId || turn.id,
    toolNames,
    tokenUsage: turn.tokenUsage,
    metadata: {
      ...runtime.metadata,
      turnId: turn.id,
      turnPrompt: turn.prompt,
      stage: "main.turn",
      historical: turn.status !== "running",
      createdFiles: turn.createdFiles,
      warnings: turn.warnings,
      warningSummary: turn.warningSummary
    }
  };
}

function resolveTranscriptArtifactPath(targetPath: string, basePath?: string) {
  const normalizedTarget = targetPath.trim();

  if (!normalizedTarget) {
    return null;
  }

  const absolutePath = path.isAbsolute(normalizedTarget)
    ? path.normalize(normalizedTarget)
    : basePath
      ? path.resolve(basePath, normalizedTarget)
      : null;

  if (!absolutePath) {
    return null;
  }

  const displayPath =
    basePath && absolutePath.startsWith(`${path.resolve(basePath)}${path.sep}`)
      ? path.relative(path.resolve(basePath), absolutePath) || path.basename(absolutePath)
      : absolutePath;

  return {
    path: absolutePath,
    displayPath
  } satisfies RuntimeCreatedFile;
}

async function resolveRuntimeTranscriptPathFromSessionCatalog(
  agentId: string,
  sessionId: string,
  workspacePath?: string
) {
  const catalogCandidates = [
    path.join(os.homedir(), ".openclaw", "agents", agentId, "sessions", "sessions.json"),
    workspacePath ? path.join(workspacePath, ".openclaw", "agents", agentId, "sessions", "sessions.json") : null
  ].filter(Boolean) as string[];

  for (const catalogPath of catalogCandidates) {
    try {
      const raw = await readFile(catalogPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, { sessionId?: string; sessionFile?: string }>;

      for (const entry of Object.values(parsed)) {
        if (!entry || entry.sessionId !== sessionId || typeof entry.sessionFile !== "string") {
          continue;
        }

        await access(entry.sessionFile);
        return entry.sessionFile;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
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

function normalizeTranscriptPrompt(text: string) {
  return text
    .replace(/^Sender \(untrusted metadata\):[\s\S]*?```[\s\S]*?```\s*/i, "")
    .replace(/^\[[^\]]+\]\s*/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

function formatTurnTitle(prompt: string, agentId?: string) {
  const normalized = prompt.trim();

  if (!normalized) {
    return `${prettifyAgentName(agentId)} run`;
  }

  return compactMissionText(normalized, 38) || `${prettifyAgentName(agentId)} run`;
}

function summarizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function resolveNonFatalToolWarning(
  role: NonNullable<SessionTranscriptEntry["message"]>["role"],
  message: NonNullable<SessionTranscriptEntry["message"]>,
  text: string,
  errorMessage: string | null
) {
  if (role !== "toolResult" || message.isError === true || errorMessage) {
    return null;
  }

  const exitCode = message.details?.exitCode;

  if (typeof exitCode !== "number" || exitCode === 0) {
    return null;
  }

  const sourceText = message.details?.aggregated || text;
  const cleaned = sourceText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .filter((line) => !/^\(Command exited with code \d+\)$/i.test(line));
  const primaryLine =
    cleaned.find((line) => !line.startsWith("[WARNING]")) ||
    cleaned.find((line) => line.startsWith("[WARNING]")) ||
    `${message.toolName || "tool"} exited with code ${exitCode}`;
  const normalized = primaryLine.replace(/^\[WARNING\]\s*/i, "").trim();

  return summarizeText(normalized || `${message.toolName || "tool"} exited with code ${exitCode}`, 160);
}

function isHeartbeatTurn(prompt: string) {
  return prompt.toLowerCase().startsWith(transcriptHeartbeatPrefix);
}

function extractTranscriptText(
  content: Array<{
    type?: string;
    text?: string;
    thinking?: string;
  }> = []
) {
  return content
    .flatMap((item) => {
      if (item.type === "text" && item.text) {
        return [item.text];
      }

      return [];
    })
    .join("\n\n")
    .trim();
}

function extractToolNameFromTranscriptText(text: string) {
  const match = text.match(/"tool(Name)?":\s*"([^"]+)"/i);
  return match?.[2];
}

function prettifyAgentName(agentId: string | undefined) {
  if (!agentId) {
    return "OpenClaw";
  }

  return agentId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}
