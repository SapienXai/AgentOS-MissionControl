export type AgentChatRole = "user" | "assistant" | "system";
export type AgentChatStatus = "sending" | "sent" | "error";

export type AgentChatMessage = {
  id: string;
  role: AgentChatRole;
  text: string;
  createdAt: number;
  status?: AgentChatStatus;
  runId?: string | null;
};

export const agentChatMessageStoragePrefix = "mission-control-agent-chat:v1";
export const agentChatLastSeenStoragePrefix = "mission-control-agent-chat-seen:v1";
export const agentChatStateEventName = "mission-control-agent-chat-state-change";
export const maxAgentChatMessages = 60;

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

    if (typeof lastSeenAt === "number" && Number.isFinite(lastSeenAt)) {
      globalThis.localStorage?.setItem(key, String(lastSeenAt));
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
    if (message.role !== "assistant") {
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
    if (message.role !== "assistant") {
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
