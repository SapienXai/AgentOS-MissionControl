import { access, readFile } from "node:fs/promises";
import path from "node:path";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { compactMissionText } from "@/lib/openclaw/presenters";
import { matchesMissionText } from "@/lib/openclaw/runtime-matching";
import { getOpenClawStateRootPath } from "@/lib/openclaw/state/paths";
import type {
  MissionControlSnapshot,
  RuntimeCreatedFile,
  RuntimeOutputItem,
  RuntimeOutputRecord,
  RuntimeRecord
} from "@/lib/openclaw/types";
import { redactSecretText } from "@/lib/security/redaction";

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

type TranscriptContentItem = {
  type?: string;
  text?: string;
  content?: unknown;
  thinking?: string;
  id?: string;
  name?: string;
  arguments?: Record<string, unknown>;
};

type TranscriptMessageContent = string | TranscriptContentItem[] | undefined;

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
    content?: TranscriptMessageContent;
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
    timestamp?: number | string;
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

  if (!shouldInspectSessionTranscript(session) || !session.agentId || !session.sessionId) {
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
    const allTurns = extractTranscriptTurns(raw, runtime, agent?.workspace || config?.workspace).filter(
      (turn) => !isHeartbeatTurn(turn.prompt)
    );
    const turns = session.key?.includes(":explicit:")
      ? allTurns.filter(isAgentToAgentTranscriptTurn)
      : allTurns;
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
    return createMissingRuntimeOutput(
      runtime,
      resolveMissingRuntimeOutputMessage(runtime, "This runtime does not expose a session transcript yet.")
    );
  }

  const agent = snapshot.agents.find((entry) => entry.id === runtime.agentId);
  const transcriptPath = await resolveRuntimeTranscriptPath(runtime.agentId, runtime.sessionId, agent?.workspacePath);

  if (!transcriptPath) {
    const sessionKey = resolveSessionHistoryKey(runtime);

    if (sessionKey) {
      try {
        const payload = await getOpenClawAdapter().getSessionHistory(
          { sessionKey, limit: 200 },
          { timeoutMs: 8_000 }
        );
        const output = parseRuntimeOutputFromSessionHistory(runtime, payload, agent?.workspacePath);

        if (output.items.length > 0) {
          return output;
        }
      } catch {
        // A missing native history capability must not replace the honest
        // missing-output state with an invented result.
      }
    }

    return createMissingRuntimeOutput(
      runtime,
      resolveMissingRuntimeOutputMessage(runtime, "No transcript file or native session history was found for this runtime session.")
    );
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

/**
 * OpenClaw 2026.9.x persists session transcripts in its native store and
 * exposes them through chat.history. Keep the same output parser used for
 * legacy JSONL transcripts by normalizing that authoritative Gateway payload
 * in memory. This is read-only: OpenClaw remains the owner of transcript
 * persistence and completion truth.
 */
export function parseRuntimeOutputFromSessionHistory(
  runtime: RuntimeRecord,
  payload: unknown,
  workspacePath?: string
): RuntimeOutputRecord {
  const messages = readSessionHistoryMessages(payload);

  if (messages.length === 0) {
    return createMissingRuntimeOutput(
      runtime,
      resolveMissingRuntimeOutputMessage(runtime, "OpenClaw returned no session history for this runtime.")
    );
  }

  const normalizedTranscript = messages
    .map((message, index) => {
      const record = isRecord(message.message) ? message.message : message;
      const role = normalizeSessionHistoryRole(record.role);

      if (!role) {
        return null;
      }

      const timestamp = readSessionHistoryTimestamp(message) ?? readSessionHistoryTimestamp(record);
      return JSON.stringify({
        type: "message",
        id: readSessionHistoryString(message.id) ?? readSessionHistoryString(record.id) ?? `history:${index}`,
        ...(timestamp ? { timestamp } : {}),
        message: {
          ...record,
          role
        }
      });
    })
    .filter((entry): entry is string => Boolean(entry));

  if (normalizedTranscript.length === 0) {
    return createMissingRuntimeOutput(
      runtime,
      resolveMissingRuntimeOutputMessage(runtime, "OpenClaw returned no readable messages for this runtime.")
    );
  }

  return parseRuntimeOutput(runtime, normalizedTranscript.join("\n"), workspacePath);
}

export async function resolveRuntimeTranscriptPath(
  agentId: string,
  sessionId: string,
  workspacePath?: string
) {
  const stateRoot = getOpenClawStateRootPath();
  const candidates = [
    path.join(stateRoot, "agents", agentId, "sessions", `${sessionId}.jsonl`),
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

function readSessionHistoryMessages(payload: unknown) {
  if (!isRecord(payload)) {
    return [] as Array<Record<string, unknown>>;
  }

  return [
    ...readSessionHistoryRecordArray(payload.messages),
    ...readSessionHistoryRecordArray(payload.turns),
    ...readSessionHistoryRecordArray(payload.items)
  ];
}

function readSessionHistoryRecordArray(value: unknown) {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function normalizeSessionHistoryRole(value: unknown) {
  if (value === "user" || value === "assistant" || value === "toolResult") {
    return value;
  }

  if (value === "tool") {
    return "toolResult" as const;
  }

  return null;
}

function readSessionHistoryString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readSessionHistoryTimestamp(value: unknown) {
  if (!isRecord(value)) {
    return null;
  }

  const timestamp = value.timestamp ?? value.createdAt ?? value.updatedAt ?? value.ts;

  if (typeof timestamp === "string" && timestamp.trim()) {
    return timestamp.trim();
  }

  return typeof timestamp === "number" && Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function resolveSessionHistoryKey(runtime: RuntimeRecord) {
  const metadataKeyCandidates = [
    runtime.metadata.sessionKey,
    runtime.metadata.openClawSessionKey,
    runtime.metadata.gatewaySessionKey
  ];
  const metadataKey = metadataKeyCandidates.find((value): value is string => typeof value === "string" && value.trim().length > 0);

  if (metadataKey) {
    return metadataKey.trim();
  }

  return runtime.key.startsWith("agent:") ? runtime.key : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
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
      const toolCall = role === "assistant" ? extractTranscriptToolCall(entry.message.content) : null;
      const itemRole: RuntimeOutputItem["role"] =
        role === "assistant" && toolCall && !text
          ? "toolCall"
          : role;
      const itemText =
        text ||
        errorMessage ||
        (toolCall ? `Called ${toolCall.name}` : "");

      if (!itemText) {
        if (
          !(
            (role === "assistant" && hasTranscriptToolCall(entry.message.content)) ||
            (role === "toolResult" && typeof entry.message.toolName === "string" && entry.message.toolName.trim())
          )
        ) {
          continue;
        }
      }

      const item: RuntimeOutputItem = {
        id: entry.id || `${role}-${Date.now()}`,
        role: itemRole,
        timestamp: readMessageTimestamp(entry) || new Date().toISOString(),
        text: itemText,
        toolName:
          itemRole === "toolCall"
            ? toolCall?.name
            : role === "toolResult"
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

          for (const file of extractToolCallCreatedFiles(contentItem, sessionCwd)) {
            currentTurn.pendingCreatedFiles.set(
              contentItem.id || `${entry.id || "toolCall"}:${file.path}`,
              file
            );
          }
        }
      }

      currentTurn.items.push(item);
      currentTurn.updatedAt = item.timestamp;
      currentTurn.errorMessage ||= errorMessage;

      if (role === "toolResult" && entry.message.isError === true) {
        currentTurn.errorMessage ||= summarizeText(errorMessage || item.text || `${entry.message.toolName || "Tool"} failed.`, 200);
      }

      if (warningMessage && !currentTurn.warnings.includes(warningMessage)) {
        currentTurn.warnings.push(warningMessage);
      }

      if (
        role === "toolResult" &&
        entry.message.isError !== true &&
        (entry.message.toolName === "write" || entry.message.toolName === "apply_patch") &&
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
        currentTurn.tokenUsage = selectBetterTokenUsage(currentTurn.tokenUsage, {
          input: usage.input ?? usage.prompt_tokens ?? 0,
          output: usage.output ?? usage.completion_tokens ?? 0,
          total:
            usage.totalTokens ??
            usage.total_tokens ??
            (usage.input ?? usage.prompt_tokens ?? 0) + (usage.output ?? usage.completion_tokens ?? 0),
          cacheRead: usage.cacheRead ?? 0
        });
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
    errorMessage: resolveMissingRuntimeOutputMessage(runtime, "No transcript entries were found for this runtime."),
    items: [],
    createdFiles: [],
    warnings: [],
    warningSummary: null
  };
}

function resolveMissingRuntimeOutputMessage(runtime: RuntimeRecord, fallback: string) {
  const dispatchStatus =
    typeof runtime.metadata.dispatchStatus === "string" ? runtime.metadata.dispatchStatus : null;
  const dispatchId = typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId : null;
  const runtimeError = typeof runtime.metadata.error === "string" && runtime.metadata.error.trim()
    ? redactSecretText(runtime.metadata.error.trim())
    : null;

  if (runtimeError) {
    return runtimeError;
  }

  if (!dispatchStatus && !dispatchId) {
    return fallback;
  }

  if (dispatchStatus === "stalled" || runtime.status === "stalled") {
    return "Mission dispatch stalled before AgentOS captured transcript output. Check Gateway diagnostics, model readiness, and the dispatch runner details.";
  }

  if (dispatchStatus === "completed" || runtime.status === "completed") {
    return "Mission completed, but AgentOS did not recover a transcript or final output yet. Refresh the snapshot and inspect the OpenClaw session diagnostics if this remains empty.";
  }

  return "Mission dispatch is active, but no transcript output has been captured yet. Wait for the first OpenClaw session update or inspect Gateway diagnostics if it stays empty.";
}

function resolveRuntimeMissionTurn(runtime: RuntimeRecord, turns: TranscriptTurn[]) {
  const mission =
    typeof runtime.metadata.turnPrompt === "string" && runtime.metadata.turnPrompt.trim().length > 0
      ? runtime.metadata.turnPrompt
      : typeof runtime.metadata.prompt === "string" && runtime.metadata.prompt.trim().length > 0
        ? runtime.metadata.prompt
        : typeof runtime.metadata.mission === "string" && runtime.metadata.mission.trim().length > 0
          ? runtime.metadata.mission
          : typeof runtime.metadata.routedMission === "string" && runtime.metadata.routedMission.trim().length > 0
            ? runtime.metadata.routedMission
            : null;

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
    warningSummary: turn.warningSummary,
    tokenUsage: turn.tokenUsage
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

function selectBetterTokenUsage(
  current: RuntimeRecord["tokenUsage"] | undefined,
  next: NonNullable<RuntimeRecord["tokenUsage"]>
) {
  if (!current) {
    return next;
  }

  return next.total > current.total ? next : current;
}

function createTurnRuntime(
  runtime: RuntimeRecord,
  turn: TranscriptTurn,
  toolNames: string[] = turn.toolNames
): RuntimeRecord {
  const updatedAt = Date.parse(turn.updatedAt);
  const interSessionMessage = parseInterSessionPrompt(turn.prompt);
  const usedAgentToAgentTool = toolNames.includes("sessions_send");
  const title = interSessionMessage
    ? `Message from ${prettifyAgentName(interSessionMessage.sourceAgentId ?? undefined)}`
    : usedAgentToAgentTool
      ? "Agent-to-agent message"
      : formatTurnTitle(turn.prompt, runtime.agentId);
  const subtitle =
    turn.errorMessage
      ? summarizeText(turn.errorMessage, 90)
      : turn.warningSummary
      ? summarizeText(`Completed with fallback: ${turn.warningSummary}`, 90)
      : turn.finalText
        ? summarizeText(turn.finalText, 90)
        : interSessionMessage
          ? "Inter-agent message received; waiting for reply."
          : usedAgentToAgentTool
            ? "Agent-to-agent message sent; waiting for result."
        : turn.status === "stalled"
          ? "Waiting for output"
          : "Main session run";
  const resultPreview =
    turn.errorMessage ||
    turn.finalText ||
    interSessionMessage?.messagePreview ||
    (usedAgentToAgentTool ? "Agent-to-agent message sent; waiting for result." : null);

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
      stage: interSessionMessage || usedAgentToAgentTool ? "agent-message.turn" : "main.turn",
      historical: turn.status !== "running",
      createdFiles: turn.createdFiles,
      warnings: turn.warnings,
      warningSummary: turn.warningSummary,
      ...(resultPreview ? { resultPreview } : {}),
      ...(turn.finalText ? { handoffResult: turn.finalText } : {}),
      ...(interSessionMessage
        ? {
            interSessionMessage: true,
            notifyOperator: true,
            operatorVisible: true,
            sourceAgentId: interSessionMessage.sourceAgentId,
            sourceSessionKey: interSessionMessage.sourceSessionKey,
            sourceTool: interSessionMessage.sourceTool,
            sourceChannel: interSessionMessage.sourceChannel
          }
        : {}),
      ...(usedAgentToAgentTool
        ? {
            agentToAgentMessage: true,
            notifyOperator: true,
            operatorVisible: true
          }
        : {})
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
  const expectedSessionKey = `agent:${agentId}:explicit:${sessionId}`;
  const stateRoot = getOpenClawStateRootPath();
  const catalogCandidates = [
    path.join(stateRoot, "agents", agentId, "sessions", "sessions.json"),
    workspacePath ? path.join(workspacePath, ".openclaw", "agents", agentId, "sessions", "sessions.json") : null
  ].filter(Boolean) as string[];

  for (const catalogPath of catalogCandidates) {
    try {
      const raw = await readFile(catalogPath, "utf8");
      const parsed = JSON.parse(raw) as Record<string, { sessionId?: string; sessionFile?: string }>;

      for (const [sessionKey, entry] of Object.entries(parsed)) {
        if (
          !entry ||
          (entry.sessionId !== sessionId && sessionKey !== expectedSessionKey) ||
          typeof entry.sessionFile !== "string"
        ) {
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

function shouldInspectSessionTranscript(session: RuntimeSessionEntry) {
  return Boolean(
    session.key?.endsWith(":main") ||
    session.key?.includes(":explicit:")
  );
}

function isAgentToAgentTranscriptTurn(turn: TranscriptTurn) {
  return Boolean(parseInterSessionPrompt(turn.prompt) || turn.toolNames.includes("sessions_send"));
}

function parseInterSessionPrompt(prompt: string) {
  const sourceSessionKey = prompt.match(/\bsourceSession=([^\s]+)/)?.[1]?.trim() ?? null;
  const sourceTool = prompt.match(/\bsourceTool=([^\s]+)/)?.[1]?.trim() ?? null;

  if (!sourceSessionKey && sourceTool !== "sessions_send") {
    return null;
  }

  const sourceAgentId = sourceSessionKey?.match(/^agent:([^:]+)/)?.[1] ?? null;
  const sourceChannel = prompt.match(/\bsourceChannel=([^\s]+)/)?.[1]?.trim() ?? null;
  const messagePreview = prompt
    .replace(/^sourceSession=[^\s]+(?:\s+[A-Za-z]+=[^\s]+)*\s*/i, "")
    .replace(/^This content was routed by OpenClaw\s*/i, "")
    .trim();

  return {
    sourceAgentId,
    sourceSessionKey,
    sourceTool,
    sourceChannel,
    messagePreview: messagePreview ? summarizeText(messagePreview, 180) : null
  };
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

function readMessageTimestamp(entry: SessionTranscriptEntry) {
  const value = entry.message?.timestamp;

  if (typeof value === "number" && Number.isFinite(value)) {
    return new Date(value).toISOString();
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return new Date(parsed).toISOString();
    }
  }

  return entry.timestamp || null;
}

function hasTranscriptToolCall(content: TranscriptMessageContent) {
  return Array.isArray(content) && content.some((item) => item.type === "toolCall");
}

function extractTranscriptToolCall(content: TranscriptMessageContent) {
  if (!Array.isArray(content)) {
    return null;
  }

  const item = content.find((entry) => entry.type === "toolCall" && typeof entry.name === "string");

  if (!item || typeof item.name !== "string" || !item.name.trim()) {
    return null;
  }

  return {
    id: typeof item.id === "string" ? item.id : null,
    name: item.name.trim(),
    arguments: item.arguments
  };
}

function extractTranscriptText(content: TranscriptMessageContent = []) {
  if (typeof content === "string") {
    return content.trim();
  }

  if (!Array.isArray(content)) {
    return "";
  }

  return content
    .flatMap((item) => {
      if ((item.type === "text" || item.type === "output_text") && item.text) {
        return [item.text];
      }

      if (item.type === "toolResult") {
        const text = readToolResultText(item.content) || item.text;
        return text ? [text] : [];
      }

      return [];
    })
    .join("\n\n")
    .trim();
}

function readToolResultText(value: unknown): string | null {
  if (typeof value === "string") {
    return value.trim() || null;
  }

  if (!Array.isArray(value)) {
    return null;
  }

  const text = value
    .flatMap((entry) => {
      if (typeof entry === "string") {
        return [entry];
      }

      if (!entry || typeof entry !== "object") {
        return [];
      }

      if ("text" in entry && typeof entry.text === "string") {
        return [entry.text];
      }

      if ("content" in entry && typeof entry.content === "string") {
        return [entry.content];
      }

      return [];
    })
    .join("\n\n")
    .trim();

  return text || null;
}

function extractToolCallCreatedFiles(contentItem: TranscriptContentItem, sessionCwd?: string) {
  if (contentItem.type === "write") {
    const candidatePath =
      typeof contentItem.arguments?.path === "string" ? contentItem.arguments.path.trim() : "";
    const resolved = candidatePath ? resolveTranscriptArtifactPath(candidatePath, sessionCwd) : null;
    return resolved ? [resolved] : [];
  }

  if (contentItem.name === "write") {
    const candidatePath =
      typeof contentItem.arguments?.path === "string" ? contentItem.arguments.path.trim() : "";
    const resolved = candidatePath ? resolveTranscriptArtifactPath(candidatePath, sessionCwd) : null;
    return resolved ? [resolved] : [];
  }

  if (contentItem.name !== "apply_patch" || !Array.isArray(contentItem.arguments?.changes)) {
    return [];
  }

  return contentItem.arguments.changes.flatMap((entry: unknown): RuntimeCreatedFile[] => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const candidatePath = "path" in entry && typeof entry.path === "string" ? entry.path.trim() : "";
    const resolved = candidatePath ? resolveTranscriptArtifactPath(candidatePath, sessionCwd) : null;
    return resolved ? [resolved] : [];
  });
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
