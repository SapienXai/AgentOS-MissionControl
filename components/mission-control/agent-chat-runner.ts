"use client";

import {
  dispatchAgentChatStateChange,
  maxAgentChatMessages,
  readAgentChatMessages,
  type AgentChatMessage,
  writeAgentChatMessages
} from "@/components/mission-control/agent-chat-storage";
import { consumeNdjsonStream } from "@/lib/ndjson";
import type { MissionControlSnapshot, MissionResponse } from "@/lib/agentos/contracts";

type AgentChatStreamEvent =
  | {
      type: "status";
      message: string;
    }
  | {
      type: "assistant";
      text: string;
    }
  | {
      type: "done";
      ok: boolean;
      message: string;
      response?: MissionResponse;
    };

type ActiveAgentChatRun = {
  userMessageId: string;
  assistantMessageId: string;
  statusMessage: string | null;
  promise: Promise<void>;
};

export type AgentChatRunSnapshot = {
  isRunning: boolean;
  userMessageId: string | null;
  assistantMessageId: string | null;
  statusMessage: string | null;
};

export type SendAgentChatMessageOptions = {
  agentId: string;
  text: string;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onError?: (message: string) => void;
};

const activeAgentChatRuns = new Map<string, ActiveAgentChatRun>();

export function getAgentChatRunSnapshot(agentId: string): AgentChatRunSnapshot {
  const run = activeAgentChatRuns.get(agentId);

  return {
    isRunning: Boolean(run),
    userMessageId: run?.userMessageId ?? null,
    assistantMessageId: run?.assistantMessageId ?? null,
    statusMessage: run?.statusMessage ?? null
  };
}

export function sendAgentChatMessage({
  agentId,
  text,
  onRefresh,
  onSnapshotChange,
  onError
}: SendAgentChatMessageOptions) {
  const trimmedText = text.trim();

  if (!trimmedText) {
    return Promise.resolve();
  }

  const existingRun = activeAgentChatRuns.get(agentId);
  if (existingRun) {
    return existingRun.promise;
  }

  const createdAt = Date.now();
  const userMessageId = globalThis.crypto?.randomUUID?.() || `user:${createdAt}`;
  const assistantMessageId = globalThis.crypto?.randomUUID?.() || `assistant:${createdAt}`;
  const existingMessages = readAgentChatMessages(agentId);

  const userMessage: AgentChatMessage = {
    id: userMessageId,
    role: "user",
    text: trimmedText,
    createdAt,
    status: "sending"
  };

  const assistantMessage: AgentChatMessage = {
    id: assistantMessageId,
    role: "assistant",
    text: "",
    createdAt: createdAt + 1,
    status: "sending"
  };

  const run: ActiveAgentChatRun = {
    userMessageId,
    assistantMessageId,
    statusMessage: "Starting agent turn...",
    promise: Promise.resolve()
  };

  activeAgentChatRuns.set(agentId, run);
  writeAgentChatMessages(agentId, [...existingMessages, userMessage, assistantMessage].slice(-maxAgentChatMessages));
  dispatchAgentChatStateChange(agentId);

  const promptHistory = existingMessages
    .filter(
      (entry): entry is AgentChatMessage & { role: "user" | "assistant" } =>
        (entry.role === "user" || entry.role === "assistant") &&
        entry.status !== "error" &&
        entry.text.trim().length > 0
    )
    .slice(-16)
    .map((entry) => ({
      role: entry.role,
      text: entry.text
    }));
  const previousAssistantTexts = new Set(
    promptHistory
      .filter((entry) => entry.role === "assistant")
      .map((entry) => normalizeAgentChatText(entry.text))
      .filter(Boolean)
  );

  const payload = {
    message: trimmedText,
    rawMessage: trimmedText,
    history: promptHistory,
    thinking: "low" as const
  };

  run.promise = runAgentChatTurn({
    agentId,
    payload,
    userMessageId,
    assistantMessageId,
    previousAssistantTexts,
    run,
    onRefresh,
    onSnapshotChange,
    onError
  });

  return run.promise;
}

async function runAgentChatTurn({
  agentId,
  payload,
  userMessageId,
  assistantMessageId,
  previousAssistantTexts,
  run,
  onRefresh,
  onSnapshotChange,
  onError
}: {
  agentId: string;
  payload: {
    message: string;
    rawMessage: string;
    history: Array<{ role: "user" | "assistant"; text: string }>;
    thinking: "low";
  };
  userMessageId: string;
  assistantMessageId: string;
  previousAssistantTexts: Set<string>;
  run: ActiveAgentChatRun;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onError?: (message: string) => void;
}) {
  let latestAssistantText = "";
  let assistantTextReceived = false;

  try {
    const response = await fetch(`/api/agents/${encodeURIComponent(agentId)}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload)
    });

    const contentType = response.headers.get("content-type") || "";
    if (!response.ok || !contentType.includes("application/x-ndjson")) {
      const errorPayload = (await response.json().catch(() => null)) as { error?: string } | null;
      throw new Error(errorPayload?.error || "OpenClaw rejected the message.");
    }

    updateAgentChatMessages(agentId, (current) =>
      current.map((entry) => (entry.id === userMessageId ? { ...entry, status: "sent" as const } : entry))
    );

    let finalResponse: MissionResponse | null = null;

    await consumeNdjsonStream<AgentChatStreamEvent>(response, async (event) => {
      if (event.type === "status") {
        run.statusMessage = event.message;
        dispatchAgentChatStateChange(agentId);
        return;
      }

      if (event.type === "assistant") {
        const eventText = sanitizeAgentChatReplyText(event.text);
        const normalizedEventText = normalizeAgentChatText(eventText);
        if (!eventText) {
          run.statusMessage = "Agent is thinking...";
          dispatchAgentChatStateChange(agentId);
          return;
        }

        if (!assistantTextReceived && normalizedEventText && previousAssistantTexts.has(normalizedEventText)) {
          run.statusMessage = "Agent is drafting a reply...";
          dispatchAgentChatStateChange(agentId);
          return;
        }

        assistantTextReceived = true;
        latestAssistantText = eventText;
        run.statusMessage = "Agent is drafting a reply...";

        updateAgentChatMessages(agentId, (current) =>
          current.map((entry) => {
            if (entry.id === userMessageId) {
              return { ...entry, status: "sent" as const };
            }

            if (entry.id === assistantMessageId) {
              return { ...entry, text: eventText, status: "sending" as const };
            }

            return entry;
          })
        );

        return;
      }

      if (!event.ok) {
        throw new Error(event.message);
      }

      finalResponse = event.response ?? null;
      const finalText = finalResponse ? renderAgentReplyText(finalResponse) : latestAssistantText;

      if (finalResponse) {
        latestAssistantText = finalText;
      }

      updateAgentChatMessages(agentId, (current) =>
        current.map((entry) => {
          if (entry.id === userMessageId) {
            return { ...entry, status: "sent" as const };
          }

          if (entry.id === assistantMessageId) {
            return {
              ...entry,
              text: finalText,
              status: "sent" as const,
              runId: finalResponse?.runId ?? entry.runId
            };
          }

          return entry;
        })
      );

      const renamedTo = finalResponse ? readRenamedAgent(finalResponse.meta) : null;
      if (renamedTo && onSnapshotChange) {
        onSnapshotChange((current) => applyAgentRename(current, agentId, renamedTo));
      }

      void onRefresh?.().catch(() => null);
    });

    if (!finalResponse) {
      throw new Error("OpenClaw completed without returning a response.");
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown send error.";
    const partialText = assistantTextReceived ? latestAssistantText.trim() : "";

    updateAgentChatMessages(agentId, (current) =>
      current
        .map((entry) => {
          if (entry.id === userMessageId) {
            return { ...entry, status: "error" as const, errorMessage: message };
          }

          if (entry.id === assistantMessageId) {
            if (partialText.length > 0) {
              return { ...entry, text: partialText, status: "error" as const, errorMessage: message };
            }

            return entry;
          }

          return entry;
        })
        .filter((entry) => entry.id !== assistantMessageId || partialText.length > 0)
    );

    onError?.(message);
  } finally {
    activeAgentChatRuns.delete(agentId);
    dispatchAgentChatStateChange(agentId);
  }
}

function updateAgentChatMessages(
  agentId: string,
  updater: (current: AgentChatMessage[]) => AgentChatMessage[]
) {
  writeAgentChatMessages(agentId, updater(readAgentChatMessages(agentId)).slice(-maxAgentChatMessages));
}

function renderAgentReplyText(result: MissionResponse) {
  const payloadText = result.payloads
    .map((entry) => sanitizeAgentChatReplyText(entry.text))
    .filter(Boolean)
    .join("\n\n");
  return payloadText || sanitizeAgentChatReplyText(result.summary) || "No response text was returned.";
}

function normalizeAgentChatText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function sanitizeAgentChatReplyText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return stripLeadingThinkingBlock(trimmed);
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

function readRenamedAgent(meta: MissionResponse["meta"]) {
  const candidate = meta?.missionControlAction;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const action = candidate as Record<string, unknown>;

  if (action.type !== "rename_agent" || action.applied !== true || typeof action.name !== "string") {
    return null;
  }

  const normalized = action.name.trim();
  return normalized.length > 0 ? normalized : null;
}

function applyAgentRename(snapshot: MissionControlSnapshot, agentId: string, name: string): MissionControlSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((entry) =>
      entry.id === agentId
        ? {
            ...entry,
            name,
            identityName: name
          }
        : entry
    ),
    tasks: snapshot.tasks.map((task) =>
      task.primaryAgentId === agentId
        ? {
            ...task,
            primaryAgentName: name
          }
        : task
    )
  };
}
