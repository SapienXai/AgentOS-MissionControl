export type AgentChatRole = "user" | "assistant" | "system";
export type AgentChatStatus = "sending" | "sent" | "error";

export type AgentChatMessage = {
  id: string;
  role: AgentChatRole;
  text: string;
  createdAt: number;
  status?: AgentChatStatus;
  errorMessage?: string | null;
  runId?: string | null;
};

export const agentChatMessageStoragePrefix = "mission-control-agent-chat:v1";
export const agentChatLastSeenStoragePrefix = "mission-control-agent-chat-seen:v1";
export const agentChatStateEventName = "mission-control-agent-chat-state-change";
export const maxAgentChatMessages = 60;

export type AgentChatVisibleRunSnapshot = {
  isRunning: boolean;
  userMessageId: string | null;
  assistantMessageId: string | null;
};

function getChatStorageKey(agentId: string) {
  return `${agentChatMessageStoragePrefix}:${agentId}`;
}

function getLastSeenStorageKey(agentId: string) {
  return `${agentChatLastSeenStoragePrefix}:${agentId}`;
}

function isAgentChatMessage(candidate: unknown): candidate is AgentChatMessage {
  if (typeof candidate !== "object" || candidate === null) {
    return false;
  }

  const entry = candidate as Partial<AgentChatMessage> & Record<string, unknown>;

  return (
    (entry.role === "user" || entry.role === "assistant" || entry.role === "system") &&
    typeof entry.id === "string" &&
    typeof entry.text === "string" &&
    typeof entry.createdAt === "number" &&
    (entry.errorMessage === undefined ||
      entry.errorMessage === null ||
      typeof entry.errorMessage === "string") &&
    (entry.status === undefined ||
      entry.status === "sending" ||
      entry.status === "sent" ||
      entry.status === "error")
  );
}

export function readAgentChatMessages(agentId: string): AgentChatMessage[] {
  try {
    const raw = globalThis.localStorage?.getItem(getChatStorageKey(agentId));
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(isAgentChatMessage).slice(-maxAgentChatMessages);
  } catch {
    return [];
  }
}

export function normalizeAgentChatMessagesForDisplay(
  messages: readonly AgentChatMessage[],
  runSnapshot: AgentChatVisibleRunSnapshot
) {
  const activeMessageIds = new Set(
    [runSnapshot.userMessageId, runSnapshot.assistantMessageId].filter(
      (value): value is string => typeof value === "string" && value.length > 0
    )
  );

  return messages
    .map((entry) => {
      if (entry.status !== "sending") {
        return entry;
      }

      if (runSnapshot.isRunning && activeMessageIds.has(entry.id)) {
        return entry;
      }

      return entry.role === "assistant" ? { ...entry, status: "error" as const } : { ...entry, status: "sent" as const };
    })
    .filter(
      (entry) =>
        entry.role !== "assistant" ||
        entry.text.trim().length > 0 ||
        (runSnapshot.isRunning && entry.id === runSnapshot.assistantMessageId)
    );
}

export function writeAgentChatMessages(agentId: string, messages: AgentChatMessage[]) {
  try {
    globalThis.localStorage?.setItem(
      getChatStorageKey(agentId),
      JSON.stringify(messages.slice(-maxAgentChatMessages))
    );
    dispatchAgentChatStateChange(agentId);
  } catch {
    // Ignore storage failures.
  }
}

export function readAgentChatLastSeenAt(agentId: string): number | null {
  try {
    const raw = globalThis.localStorage?.getItem(getLastSeenStorageKey(agentId));
    if (!raw) {
      return null;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

export function writeAgentChatLastSeenAt(agentId: string, lastSeenAt: number | null) {
  try {
    const key = getLastSeenStorageKey(agentId);
    const nextValue = typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt) ? String(lastSeenAt) : null;
    const currentValue = globalThis.localStorage?.getItem(key) ?? null;

    if (currentValue === nextValue) {
      return;
    }

    if (nextValue !== null) {
      globalThis.localStorage?.setItem(key, nextValue);
    } else {
      globalThis.localStorage?.removeItem(key);
    }

    dispatchAgentChatStateChange(agentId);
  } catch {
    // Ignore storage failures.
  }
}

export function resolveAgentChatLatestAssistantAt(messages: AgentChatMessage[]) {
  let latest = null as number | null;

  for (const message of messages) {
    if (message.role !== "assistant" || message.status !== "sent") {
      continue;
    }

    if (latest === null || message.createdAt > latest) {
      latest = message.createdAt;
    }
  }

  return latest;
}

export function resolveAgentChatUnreadCount(messages: AgentChatMessage[], lastSeenAt: number | null) {
  if (messages.length === 0) {
    return 0;
  }

  const seenAt = typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt) ? lastSeenAt : null;

  return messages.reduce((count, message) => {
    if (message.role !== "assistant" || message.status !== "sent") {
      return count;
    }

    if (seenAt !== null && message.createdAt <= seenAt) {
      return count;
    }

    return count + 1;
  }, 0);
}

export function markAgentChatAsSeen(agentId: string, messages?: AgentChatMessage[]) {
  const latestAssistantAt = resolveAgentChatLatestAssistantAt(messages ?? readAgentChatMessages(agentId));
  writeAgentChatLastSeenAt(agentId, latestAssistantAt);
}

export function dispatchAgentChatStateChange(agentId: string) {
  if (typeof window === "undefined") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(agentChatStateEventName, {
      detail: { agentId }
    })
  );
}
