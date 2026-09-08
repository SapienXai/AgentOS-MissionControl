"use client";

import {
  dispatchAgentChatStateChange,
  maxAgentChatMessages,
  readAgentChatMessages,
  type AgentChatMessage,
  writeAgentChatMessages
} from "@/components/mission-control/agent-chat-storage";
import { consumeNdjsonStream } from "@/lib/ndjson";
import {
  buildDirectAgentIdentityReply,
  isDirectAgentIdentityQuestion,
  isStaleAgentChatContextRecoveryText
} from "@/lib/openclaw/agent-chat-guards";
import { sanitizeAgentChatVisibleText } from "@/lib/openclaw/agent-chat-response";
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
  statusHistory: string[];
  promise: Promise<void>;
};

export type AgentChatRunSnapshot = {
  isRunning: boolean;
  userMessageId: string | null;
  assistantMessageId: string | null;
  statusMessage: string | null;
  statusHistory: string[];
};

export type SendAgentChatMessageOptions = {
  agentId: string;
  agentName: string;
  text: string;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onError?: (message: string) => void;
};

const activeAgentChatRuns = new Map<string, ActiveAgentChatRun>();
const agentChatWaitHeartbeatMs = [15_000, 45_000, 90_000];

export function getAgentChatRunSnapshot(agentId: string): AgentChatRunSnapshot {
  const run = activeAgentChatRuns.get(agentId);

  return {
    isRunning: Boolean(run),
    userMessageId: run?.userMessageId ?? null,
    assistantMessageId: run?.assistantMessageId ?? null,
    statusMessage: run?.statusMessage ?? null,
    statusHistory: run?.statusHistory ?? []
  };
}

export function sendAgentChatMessage({
  agentId,
  agentName,
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
    status: "sending",
    submissionId: userMessageId
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
    statusHistory: ["Starting agent turn..."],
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
    idempotencyKey: userMessageId
  };

  run.promise = runAgentChatTurn({
    agentId,
    payload,
    agentName,
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
  agentName,
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
    idempotencyKey: string;
    thinking?: "off" | "minimal" | "low" | "medium" | "high";
  };
  agentName: string;
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
  const startedAt = Date.now();
  let heartbeatIndex = 0;
  const heartbeatTimer = globalThis.setInterval(() => {
    const threshold = agentChatWaitHeartbeatMs[heartbeatIndex];

    if (!threshold || Date.now() - startedAt < threshold) {
      return;
    }

    heartbeatIndex += 1;
    updateAgentChatStatus(agentId, run, resolveAgentChatWaitStatusMessage(threshold, assistantTextReceived));
  }, 1000);

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

    let finalResponse: MissionResponse | null = null;

    await consumeNdjsonStream<AgentChatStreamEvent>(response, async (event) => {
      if (event.type === "status") {
        updateAgentChatStatus(agentId, run, event.message);
        return;
      }

      if (event.type === "assistant") {
        const eventText = sanitizeAgentChatVisibleText(event.text);
        const normalizedEventText = normalizeAgentChatText(eventText);
        const isStaleIdentityRecovery =
          isDirectAgentIdentityQuestion(payload.rawMessage) && isStaleAgentChatContextRecoveryText(eventText);
        if (!eventText) {
          updateAgentChatStatus(agentId, run, "Agent is thinking...");
          return;
        }

        if (isStaleIdentityRecovery) {
          updateAgentChatStatus(agentId, run, "Agent is drafting a reply...");
          return;
        }

        if (!assistantTextReceived && normalizedEventText && previousAssistantTexts.has(normalizedEventText)) {
          updateAgentChatStatus(agentId, run, "Agent is drafting a reply...");
          return;
        }

        assistantTextReceived = true;
        latestAssistantText = eventText;
        updateAgentChatStatus(agentId, run, "Agent is drafting a reply...");

        updateAgentChatMessages(agentId, (current) =>
          current.map((entry) => {
            if (entry.id === userMessageId) {
              return entry;
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
      const finalText = recoverDirectIdentityText(
        finalResponse ? renderAgentReplyText(finalResponse) : latestAssistantText,
        agentName,
        payload.rawMessage
      );

      if (finalResponse) {
        latestAssistantText = finalText;
      }

      updateAgentChatMessages(agentId, (current) =>
        current.map((entry) => {
          if (entry.id === userMessageId) {
            const admission = readOpenClawAdmission(finalResponse?.meta);
            return {
              ...entry,
              status: "sent" as const,
              submissionId: admission?.idempotencyKey ?? entry.submissionId,
              messageSeq: admission?.messageSeq ?? entry.messageSeq
            };
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
    globalThis.clearInterval(heartbeatTimer);
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

const maxAgentChatStatusHistory = 5;

function updateAgentChatStatus(agentId: string, run: ActiveAgentChatRun, message: string) {
  const nextMessage = typeof message === "string" ? message.trim() : "";

  if (!nextMessage || nextMessage === run.statusMessage) {
    return;
  }

  run.statusMessage = nextMessage;
  run.statusHistory = [...run.statusHistory.filter((entry) => entry !== nextMessage), nextMessage].slice(
    -maxAgentChatStatusHistory
  );
  dispatchAgentChatStateChange(agentId);
}

function renderAgentReplyText(result: MissionResponse) {
  const payloadText = result.payloads
    .map((entry) => sanitizeAgentChatVisibleText(entry.text))
    .filter(Boolean)
    .join("\n\n");
  return payloadText || sanitizeAgentChatVisibleText(result.summary);
}

function recoverDirectIdentityText(text: string, agentName: string, operatorMessage: string) {
  if (!isDirectAgentIdentityQuestion(operatorMessage) || !isStaleAgentChatContextRecoveryText(text)) {
    return text;
  }

  return buildDirectAgentIdentityReply(agentName);
}

function normalizeAgentChatText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function resolveAgentChatWaitStatusMessage(thresholdMs: number, assistantTextReceived: boolean) {
  if (assistantTextReceived) {
    return "Reply text arrived; waiting for OpenClaw final confirmation...";
  }

  if (thresholdMs >= 90_000) {
    return "Still waiting for OpenClaw final confirmation. The agent may be doing work before a reply is available.";
  }

  if (thresholdMs >= 45_000) {
    return "OpenClaw is still working. AgentOS has not received reply text yet.";
  }

  return "Still waiting for OpenClaw to start the reply...";
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

function readOpenClawAdmission(meta: MissionResponse["meta"]) {
  const candidate = meta?.openClawAdmission;
  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const record = candidate as Record<string, unknown>;
  return {
    idempotencyKey: typeof record.idempotencyKey === "string" ? record.idempotencyKey : null,
    messageSeq: typeof record.messageSeq === "number" ? record.messageSeq : null
  };
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
