import {
  extractMissionControlAction,
  MISSION_CONTROL_ACTION_TAG
} from "@/lib/openclaw/chat-actions";
import type { MissionResponse } from "@/lib/openclaw/types";

export const emptyAgentChatResponseMessage =
  "OpenClaw finished the chat turn, but AgentOS could not find assistant text in the Gateway stream, session history, or transcript. This means the runtime did not expose a reply back to AgentOS, even if workspace changes were already applied. Refresh state, ask the agent for a summary, or inspect Gateway diagnostics if it repeats.";

export const completedEmptyAgentChatResponseMessage =
  "OpenClaw marked the chat turn completed, but did not expose a chat reply or failure reason to AgentOS. AgentOS checked the Gateway stream, session history, and transcript. This can happen after a provider/auth/rate-limit failure if OpenClaw completes the turn without surfacing the provider error. Workspace changes may already be applied; refresh state, check model diagnostics, or ask the agent for a summary if you need details.";

export const incompleteAgentChatConfirmationMessage =
  "OpenClaw/Codex stopped before AgentOS received the final turn-complete confirmation. This is a runtime confirmation problem, not a normal assistant reply. AgentOS cannot verify whether the final reply was saved; retry the message, refresh state, or ask the agent for a summary if the workspace changed.";

export const conflictedAgentChatSessionMessage =
  "OpenClaw is already initializing a reply for this agent session. Wait for the current reply to finish, then retry this message. If no reply appears, restart the Gateway or start a fresh chat session.";

export type AgentChatHistoryMessage = {
  id: string | null;
  role: "user" | "assistant";
  text: string;
  timestamp: string | number | null;
  messageSeq?: number | null;
  idempotencyKey?: string | null;
};

export function sanitizeAgentChatReplyText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  const withoutThinking = stripLeadingThinkingBlock(trimmed);

  return stripInternalAgentChatPromptLeak(withoutThinking);
}

export function sanitizeAgentChatVisibleText(value: unknown) {
  const extracted = extractMissionControlAction(sanitizeAgentChatReplyText(value));
  return stripTrailingMissionControlActionBlock(extracted.cleanText);
}

export function extractAssistantTextFromAgentChatStreamLine(line: string) {
  const trimmed = line.trim();

  if (!trimmed) {
    return null;
  }

  const parsed = parseRecord(trimmed);

  if (!parsed || parsed.type !== "assistant") {
    return null;
  }

  return readMessageText(parsed.text) ??
    readMessageText(parsed.message) ??
    readMessageText(parsed.content);
}

export function extractLatestAssistantTextFromSessionHistory(payload: unknown) {
  const records = collectHistoryRecords(payload);

  for (let index = records.length - 1; index >= 0; index -= 1) {
    const record = records[index];

    if (!recordLooksAssistant(record)) {
      continue;
    }

    const text = readMessageText(record);

    if (text) {
      return text;
    }
  }

  return null;
}

export function extractAgentChatMessagesFromSessionHistory(payload: unknown): AgentChatHistoryMessage[] {
  return collectHistoryRecords(payload).flatMap((record, index) => {
    const role = resolveHistoryRecordRole(record);

    if (!role) {
      return [];
    }

    const rawText = readMessageText(record);
    const text = role === "user"
      ? extractVisibleAgentChatOperatorText(rawText ?? "")
      : sanitizeAgentChatVisibleText(rawText ?? "");

    if (!text) {
      return [];
    }

    const messageSeq = readHistoryRecordMessageSeq(record);
    const idempotencyKey = readHistoryRecordIdempotencyKey(record);

    return [{
      id: readHistoryRecordId(record) ?? `history:${role}:${index}`,
      role,
      text,
      timestamp: readHistoryRecordTimestamp(record),
      ...(messageSeq !== null ? { messageSeq } : {}),
      ...(idempotencyKey !== null ? { idempotencyKey } : {})
    }];
  });
}

export function extractVisibleAgentChatOperatorText(value: string) {
  const trimmed = value.trim();
  if (!trimmed) {
    return "";
  }

  if (!isInternalAgentChatPromptLeak(trimmed) && !/You are chatting directly with the operator inside AgentOS\./i.test(trimmed)) {
    return trimmed;
  }

  const operatorMatch = [...trimmed.matchAll(/(?:^|\s)Operator:\s*([\s\S]*?)(?=\s(?:Agent|Assistant|Operator):|$)/gi)].at(-1);
  return operatorMatch?.[1]?.trim() ?? "";
}

export function isCompletedEmptyAgentChatResponse(payload: { meta?: Record<string, unknown> } | null | undefined) {
  return (
    payload?.meta?.emptyAgentChatResponse === true &&
    payload.meta.emptyAgentChatStatus === "completed"
  );
}

export function recoverStreamedAgentChatResponse(response: MissionResponse, assistantText: string) {
  const visibleText = assistantText.trim();

  if (!visibleText || response.meta?.emptyAgentChatResponse !== true) {
    return response;
  }

  return {
    ...response,
    status: "completed" as const,
    summary: visibleText,
    payloads: [
      {
        text: visibleText,
        mediaUrl: null
      }
    ],
    meta: {
      ...response.meta,
      emptyAgentChatResponse: false,
      emptyAgentChatStatus: "completed",
      emptyAgentChatCompletedWithoutText: false
    }
  };
}

export function resolveAgentChatRuntimeFailureMessage(rawFailure: string) {
  const normalizedFailure = rawFailure.replace(/\s+/g, " ").trim();

  if (!normalizedFailure) {
    return null;
  }

  if (
    /stopped before confirming (?:the )?turn was complete/i.test(normalizedFailure) ||
    /before confirming (?:the )?turn[- ]complete confirmation/i.test(normalizedFailure) ||
    /completed without returning a response/i.test(normalizedFailure)
  ) {
    return incompleteAgentChatConfirmationMessage;
  }

  if (/reply session initialization conflicted/i.test(normalizedFailure)) {
    return conflictedAgentChatSessionMessage;
  }

  return null;
}

export function extractAgentChatEmptyResponseDiagnosticText(payload: unknown) {
  const candidates = collectDiagnosticTextCandidates(payload)
    .map((value) => value.replace(/\s+/g, " ").trim())
    .filter(Boolean);
  const meaningfulCandidates = candidates.filter((value) => !/^(completed|running|ok|true|false)$/i.test(value));
  const diagnostic = meaningfulCandidates.find((value) =>
    /auth|token|oauth|provider|model|rate|limit|quota|credit|429|401|403|error|failed|failure|stalled|aborted|timeout|timed out|disconnect/i.test(value)
  ) ?? meaningfulCandidates[0] ?? null;

  return diagnostic ? diagnostic.slice(0, 500) : null;
}

function stripTrailingMissionControlActionBlock(value: string) {
  if (!value) {
    return "";
  }

  const lowerValue = value.toLowerCase();
  const openingTag = `<${MISSION_CONTROL_ACTION_TAG}>`;
  const closingTag = `</${MISSION_CONTROL_ACTION_TAG}>`;
  const latestOpenIndex = lowerValue.lastIndexOf(openingTag);
  const latestCloseIndex = lowerValue.lastIndexOf(closingTag);

  if (latestOpenIndex >= 0 && latestOpenIndex > latestCloseIndex) {
    return value.slice(0, latestOpenIndex).trim();
  }

  return value;
}

function stripInternalAgentChatPromptLeak(value: string) {
  if (!isInternalAgentChatPromptLeak(value)) {
    return value;
  }

  const lastOperatorIndex = Math.max(
    value.lastIndexOf("\nOperator:"),
    value.startsWith("Operator:") ? 0 : -1
  );
  const afterLatestOperator = lastOperatorIndex >= 0 ? value.slice(lastOperatorIndex) : value;
  const assistantMatch = afterLatestOperator.match(/\n(?:Agent|Assistant):\s*([\s\S]+)$/i);
  const candidate = assistantMatch?.[1]?.trim() ?? "";

  return candidate && !isInternalAgentChatPromptLeak(candidate) ? candidate : "";
}

function isInternalAgentChatPromptLeak(value: string) {
  return (
    /^You are chatting directly with the operator inside AgentOS\./i.test(value) ||
    (
      /You are chatting directly with the operator inside AgentOS\./i.test(value) &&
      /Do not create tasks or mention task cards\./i.test(value)
    ) ||
    (
      /Use the workspace root `AGENTS\.md` file as the source of truth/i.test(value) &&
      /Direct chat mode takes priority over workspace operating docs/i.test(value)
    )
  );
}

function stripLeadingThinkingBlock(value: string) {
  if (!value || !/^\[thinking\]\b/i.test(value)) {
    return value;
  }

  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length <= 2) {
    return "";
  }

  return paragraphs.slice(2).join("\n\n").trim();
}

function collectHistoryRecords(payload: unknown) {
  if (!isRecord(payload)) {
    return [];
  }

  return [
    ...readRecordArray(payload.messages),
    ...readRecordArray(payload.turns),
    ...readRecordArray(payload.items),
    ...readRecordArray(isRecord(payload.session) ? payload.session.messages : null)
  ];
}

function readRecordArray(value: unknown) {
  return Array.isArray(value)
    ? value.filter(isRecord)
    : [];
}

function recordLooksAssistant(record: Record<string, unknown>) {
  return [
    record.role,
    record.type,
    record.kind,
    record.source,
    record.speaker,
    isRecord(record.author) ? record.author.role ?? record.author.type ?? record.author.name : null
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => /assistant|agent/i.test(value));
}

function recordLooksUser(record: Record<string, unknown>) {
  return [
    record.role,
    record.type,
    record.kind,
    record.source,
    record.speaker,
    isRecord(record.author) ? record.author.role ?? record.author.type ?? record.author.name : null
  ]
    .filter((value): value is string => typeof value === "string")
    .some((value) => /user|operator|human/i.test(value));
}

function resolveHistoryRecordRole(record: Record<string, unknown>): AgentChatHistoryMessage["role"] | null {
  if (recordLooksAssistant(record)) {
    return "assistant";
  }

  if (recordLooksUser(record)) {
    return "user";
  }

  const nestedMessage = isRecord(record.message) ? record.message : isRecord(record.content) ? record.content : null;

  if (nestedMessage) {
    if (recordLooksAssistant(nestedMessage)) {
      return "assistant";
    }

    if (recordLooksUser(nestedMessage)) {
      return "user";
    }
  }

  return null;
}

function readHistoryRecordId(record: Record<string, unknown>) {
  const metadata = isRecord(record.__openclaw) ? record.__openclaw : null;
  const value = record.id ?? record.messageId ?? record.turnId ?? metadata?.id;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readHistoryRecordMessageSeq(record: Record<string, unknown>) {
  const metadata = isRecord(record.__openclaw) ? record.__openclaw : null;
  const value = record.messageSeq ?? record.seq ?? metadata?.seq;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function readHistoryRecordIdempotencyKey(record: Record<string, unknown>) {
  const metadata = isRecord(record.__openclaw) ? record.__openclaw : null;
  const value = record.idempotencyKey ?? metadata?.idempotencyKey;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readHistoryRecordTimestamp(record: Record<string, unknown>) {
  const value = record.timestamp ?? record.createdAt ?? record.updatedAt ?? record.ts;

  if (typeof value === "string" && value.trim()) {
    return value.trim();
  }

  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  return null;
}

function readMessageText(value: unknown): string | null {
  if (typeof value === "string") {
    const trimmed = value.trim();
    return trimmed || null;
  }

  if (Array.isArray(value)) {
    const text = value
      .map(readMessageText)
      .filter((entry): entry is string => Boolean(entry))
      .join("\n\n")
      .trim();

    return text || null;
  }

  if (!isRecord(value)) {
    return null;
  }

  if (
    (value.type === "text" || value.type === "output_text") &&
    typeof value.text === "string" &&
    value.text.trim()
  ) {
    return value.text.trim();
  }

  return readMessageText(value.text) ??
    readMessageText(value.content) ??
    readMessageText(value.message) ??
    readMessageText(value.summary) ??
    readMessageText(value.finalText) ??
    readMessageText(value.output) ??
    readMessageText(value.response);
}

function parseRecord(value: string) {
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function collectDiagnosticTextCandidates(value: unknown, seen = new Set<unknown>()): string[] {
  if (typeof value === "string") {
    return value.trim() ? [value] : [];
  }

  if (!isRecord(value) || seen.has(value)) {
    return [];
  }

  seen.add(value);

  const keys = [
    "error",
    "errorMessage",
    "failure",
    "message",
    "detail",
    "reason",
    "cause",
    "diagnostic",
    "diagnostics",
    "stopReason",
    "summary",
    "status",
    "meta",
    "result"
  ];

  const keyedCandidates = keys.flatMap((key) => collectDiagnosticTextCandidates(value[key], seen));
  const nestedCandidates = Object.entries(value)
    .filter(([key]) => !keys.includes(key))
    .flatMap(([, entry]) => collectDiagnosticTextCandidates(entry, seen));

  return [...keyedCandidates, ...nestedCandidates];
}
