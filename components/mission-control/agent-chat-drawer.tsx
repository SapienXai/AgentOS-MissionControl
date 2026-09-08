"use client";

import { useEffect, useRef, useState } from "react";

import { ArrowDown, Bot, KeyRound, LoaderCircle, SendHorizontal } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  agentChatMessageStoragePrefix,
  agentChatStateEventName,
  markAgentChatAsSeen,
  markAgentInboxAsSeen,
  mergeAgentChatMessagesForRehydration,
  normalizeAgentChatMessagesForDisplay,
  readAgentChatMessages,
  writeAgentChatMessages,
  type AgentChatMessage
} from "@/components/mission-control/agent-chat-storage";
import {
  getAgentChatRunSnapshot,
  sendAgentChatMessage,
  type AgentChatRunSnapshot
} from "@/components/mission-control/agent-chat-runner";
import {
  resolveAgentChatAuthAction,
  resolveAgentChatGatewayRepairAction,
  type AgentChatGatewayRepairAction
} from "@/lib/openclaw/chat-auth-actions";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot, AgentRecord } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type ChatMessage = AgentChatMessage;

function formatChatTime(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return "now";
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function formatChatDate(timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return "Today";
  }

  const date = new Date(timestamp);
  const today = new Date();
  const yesterday = new Date(today);
  yesterday.setDate(today.getDate() - 1);

  if (isSameCalendarDay(date, today)) {
    return "Today";
  }

  if (isSameCalendarDay(date, yesterday)) {
    return "Yesterday";
  }

  return new Intl.DateTimeFormat(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
    year: date.getFullYear() === today.getFullYear() ? undefined : "numeric"
  }).format(date);
}

function isSameCalendarDay(left: Date, right: Date) {
  return (
    left.getFullYear() === right.getFullYear() &&
    left.getMonth() === right.getMonth() &&
    left.getDate() === right.getDate()
  );
}

function shouldShowChatDateSeparator(previousTimestamp: number | undefined, timestamp: number) {
  if (!Number.isFinite(timestamp)) {
    return previousTimestamp === undefined;
  }

  if (typeof previousTimestamp !== "number" || !Number.isFinite(previousTimestamp)) {
    return true;
  }

  return !isSameCalendarDay(new Date(previousTimestamp), new Date(timestamp));
}

function AssistantThinkingActivity({
  statusMessage,
  statusHistory,
  surfaceTheme
}: {
  statusMessage: string | null;
  statusHistory: string[];
  surfaceTheme: "dark" | "light";
}) {
  const activityLines = (statusHistory.length > 0 ? statusHistory : statusMessage ? [statusMessage] : []).slice(-5);
  const recentActivityLines = activityLines.slice(-3);
  const currentActivity = recentActivityLines.at(-1) || "Waiting for OpenClaw status...";
  const previousActivity = recentActivityLines.slice(0, -1);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="false"
      className="mt-1 max-w-full py-1"
    >
      <div className="flex items-center gap-2">
        <span
          aria-hidden="true"
          className="relative flex h-3 w-3 shrink-0 items-center justify-center"
        >
          <motion.span
            animate={{ scale: [0.72, 1.15, 0.72], opacity: [0.18, 0.42, 0.18] }}
            transition={{ duration: 1.8, repeat: Infinity, ease: "easeInOut" }}
            className={cn(
              "absolute inset-0 rounded-full border",
              surfaceTheme === "light" ? "border-[#b28f78]/45" : "border-cyan-300/35"
            )}
          />
          <span
            className={cn(
              "relative h-1.5 w-1.5 rounded-full",
              surfaceTheme === "light" ? "bg-[#b28f78]" : "bg-cyan-300/80"
            )}
          />
        </span>
        <span
          className={cn(
            "min-w-0 truncate text-[12px] leading-5",
            surfaceTheme === "light" ? "text-[#6f584a]/82" : "text-slate-300/82"
          )}
        >
          {currentActivity}
        </span>
      </div>

      {previousActivity.length > 0 ? (
        <div
          className={cn(
            "ml-1.5 mt-1 border-l pl-3 text-[10px] leading-4",
            surfaceTheme === "light" ? "border-[#e3d4c8]/80 text-[#8b7262]/45" : "border-white/[0.08] text-slate-500/60"
          )}
        >
          {previousActivity.map((line, index) => (
            <div key={`${line}-${index}`} className="truncate">
              {line}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AgentChatWelcome({
  agentLabel,
  surfaceTheme,
  prompts,
  onPrompt
}: {
  agentLabel: string;
  surfaceTheme: "dark" | "light";
  prompts: Array<{ label: string; text: string }>;
  onPrompt: (text: string) => void;
}) {
  return (
    <div
      className={cn(
        "w-full max-w-[292px] rounded-[18px] border border-transparent bg-transparent px-4 py-4 text-center shadow-none lg:shadow-[0_14px_34px_rgba(0,0,0,0.08)]",
        surfaceTheme === "light"
          ? "lg:border-[#e3d4c8] lg:bg-[#fffaf6]"
          : "lg:border-white/[0.08] lg:bg-white/[0.035]"
      )}
    >
      <motion.div
        animate={{ y: [0, -2, 0], opacity: [0.72, 1, 0.72] }}
        transition={{ duration: 2.6, repeat: Infinity, ease: "easeInOut" }}
        className={cn(
          "mx-auto mb-3 flex h-9 w-9 items-center justify-center rounded-[12px] border",
          surfaceTheme === "light"
            ? "border-[#e3d4c8] bg-[#fff2e8] text-[#8c6550]"
            : "border-cyan-200/15 bg-cyan-300/10 text-cyan-100"
        )}
      >
        <Bot className="h-4 w-4" />
      </motion.div>
      <p className={cn("text-[13px] font-semibold", surfaceTheme === "light" ? "text-[#3f2f24]" : "text-slate-100")}>
        Start a conversation
      </p>
      <p className={cn("mt-1.5 text-[11px] leading-5", surfaceTheme === "light" ? "text-[#806657]" : "text-slate-400")}>
        Ask {agentLabel} for a status update, a decision, or help with the next step.
      </p>
      <div className="mt-3 flex flex-wrap justify-center gap-1.5">
        {prompts.map((prompt) => (
          <button
            key={prompt.label}
            type="button"
            onClick={() => onPrompt(prompt.text)}
            className={cn(
              "rounded-full border px-2.5 py-1 text-[10px] font-semibold transition",
              surfaceTheme === "light"
                ? "border-[#e3d4c8] bg-white text-[#705345] hover:border-[#cda98f] hover:bg-[#fff7f1]"
                : "border-white/[0.09] bg-white/[0.04] text-slate-300 hover:border-cyan-200/20 hover:text-cyan-50"
            )}
          >
            {prompt.label}
          </button>
        ))}
      </div>
    </div>
  );
}

export function AgentChatDrawer({
  agent,
  snapshot,
  surfaceTheme,
  isVisible,
  onRefresh,
  onSnapshotChange,
  onConnectModelProvider
}: {
  agent: AgentRecord;
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  isVisible: boolean;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onConnectModelProvider?: (provider: string) => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<AgentChatRunSnapshot>(() => getAgentChatRunSnapshot(agent.id));
  const [revealingAssistantId, setRevealingAssistantId] = useState<string | null>(null);
  const [revealedAssistantTextById, setRevealedAssistantTextById] = useState<Record<string, string>>({});
  const [repairingGatewayMessageId, setRepairingGatewayMessageId] = useState<string | null>(null);
  const [isNearBottom, setIsNearBottom] = useState(true);
  const [hasUnreadBelow, setHasUnreadBelow] = useState(false);
  const [timelineScrollIndicator, setTimelineScrollIndicator] = useState({ top: 0, height: 0, visible: false });
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const scrollIndicatorHideTimeoutRef = useRef<number | null>(null);
  const isVisibleRef = useRef(isVisible);
  const isNearBottomRef = useRef(true);
  const rehydratedAgentRef = useRef<string | null>(null);
  const agentLabel = formatAgentDisplayName(agent);
  const inboxItems = snapshot.agentInbox.filter((item) => item.agentId === agent.id);
  const agentWorkLabel = agent.currentAction?.trim() || "current work";
  const quickPrompts = [
    { label: "Status", text: "Summarize your current work, progress, and next step." },
    { label: "Blockers", text: "What is blocking you right now, if anything?" },
    { label: "Priorities", text: "What needs my attention or decision next?" }
  ];

  const scrollToLatest = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    list.scrollTo({ top: list.scrollHeight, behavior: "smooth" });
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    setHasUnreadBelow(false);
  };

  const handleTimelineScroll = () => {
    const list = listRef.current;
    if (!list) {
      return;
    }

    const scrollRange = list.scrollHeight - list.clientHeight;
    if (scrollRange > 0) {
      const height = Math.min(64, Math.max(28, (list.clientHeight / list.scrollHeight) * list.clientHeight));
      const top = (list.scrollTop / scrollRange) * Math.max(0, list.clientHeight - height);
      setTimelineScrollIndicator({ top, height, visible: true });

      if (scrollIndicatorHideTimeoutRef.current !== null) {
        window.clearTimeout(scrollIndicatorHideTimeoutRef.current);
      }

      scrollIndicatorHideTimeoutRef.current = window.setTimeout(() => {
        setTimelineScrollIndicator((current) => ({ ...current, visible: false }));
        scrollIndicatorHideTimeoutRef.current = null;
      }, 650);
    } else {
      setTimelineScrollIndicator({ top: 0, height: 0, visible: false });
    }

    const nextIsNearBottom = list.scrollHeight - list.scrollTop - list.clientHeight < 48;
    isNearBottomRef.current = nextIsNearBottom;
    setIsNearBottom(nextIsNearBottom);

    if (nextIsNearBottom) {
      setHasUnreadBelow(false);
    }
  };

  const applyQuickPrompt = (text: string) => {
    setDraft(text);
    requestAnimationFrame(() => textareaRef.current?.focus());
  };

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    return () => {
      if (scrollIndicatorHideTimeoutRef.current !== null) {
        window.clearTimeout(scrollIndicatorHideTimeoutRef.current);
      }
    };
  }, []);

  useEffect(() => {
    const syncAgentChatState = () => {
      const nextRunSnapshot = getAgentChatRunSnapshot(agent.id);

      setRunSnapshot(nextRunSnapshot);
      setMessages(readVisibleAgentChatMessages(agent.id, nextRunSnapshot));
    };

    syncAgentChatState();
    setDraft("");
    setRevealingAssistantId(null);
    setRevealedAssistantTextById({});
    isNearBottomRef.current = true;
    setIsNearBottom(true);
    setHasUnreadBelow(false);

    const handleChatStateChange = (event: Event) => {
      const detail = (event as CustomEvent<{ agentId?: string }>).detail;

      if (!detail || detail.agentId === agent.id) {
        syncAgentChatState();
      }
    };

    const handleStorage = (event: StorageEvent) => {
      if (!event.key || !event.key.startsWith(agentChatMessageStoragePrefix)) {
        return;
      }

      syncAgentChatState();
    };

    window.addEventListener(agentChatStateEventName, handleChatStateChange as EventListener);
    window.addEventListener("storage", handleStorage);

    return () => {
      window.removeEventListener(agentChatStateEventName, handleChatStateChange as EventListener);
      window.removeEventListener("storage", handleStorage);
    };
  }, [agent.id]);

  useEffect(() => {
    if (runSnapshot.assistantMessageId) {
      setRevealingAssistantId(runSnapshot.assistantMessageId);
    }
  }, [runSnapshot.assistantMessageId]);

  useEffect(() => {
    if (!isVisible || runSnapshot.isRunning || rehydratedAgentRef.current === agent.id) {
      return;
    }

    rehydratedAgentRef.current = agent.id;
    let cancelled = false;

    void (async () => {
      try {
        const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/chat`, {
          method: "GET",
          cache: "no-store"
        });

        if (!response.ok) {
          return;
        }

        const payload = (await response.json().catch(() => null)) as {
          messages?: AgentChatMessage[];
        } | null;

        if (cancelled || !Array.isArray(payload?.messages) || payload.messages.length === 0) {
          return;
        }

        const currentMessages = readAgentChatMessages(agent.id);
        const mergedMessages = mergeAgentChatMessagesForRehydration(currentMessages, payload.messages);

        if (agentChatMessagesEqual(currentMessages, mergedMessages)) {
          return;
        }

        writeAgentChatMessages(agent.id, mergedMessages);
      } catch {
        // Rehydration is best-effort; local chat cache remains usable when OpenClaw history is unavailable.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [agent.id, isVisible, runSnapshot.isRunning]);

  useEffect(() => {
    const assistantId = runSnapshot.assistantMessageId ?? revealingAssistantId;
    if (!assistantId) {
      return;
    }

    const assistantMessage = messages.find((entry) => entry.id === assistantId && entry.role === "assistant");
    const targetText = assistantMessage?.text ?? "";
    if (!targetText.trim()) {
      return;
    }

    const revealedText = revealedAssistantTextById[assistantId] ?? "";
    if (revealedText === targetText) {
      return;
    }

    const timer = window.setTimeout(() => {
      setRevealedAssistantTextById((current) => {
        const currentText = current[assistantId] ?? "";
        const nextText = revealNextAssistantText(targetText, currentText);

        if (nextText === currentText) {
          return current;
        }

        return {
          ...current,
          [assistantId]: nextText
        };
      });
    }, 42);

    return () => window.clearTimeout(timer);
  }, [messages, revealedAssistantTextById, revealingAssistantId, runSnapshot.assistantMessageId]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (isVisibleRef.current && window.matchMedia("(min-width: 1024px)").matches) {
        textareaRef.current?.focus();
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [agent.id, isVisible]);

  useEffect(() => {
    const textarea = textareaRef.current;
    if (!textarea) {
      return;
    }

    const minHeight = window.matchMedia("(min-width: 1024px)").matches ? 96 : 52;
    textarea.style.height = "auto";
    const nextHeight = Math.min(Math.max(textarea.scrollHeight, minHeight), 132);
    textarea.style.height = `${nextHeight}px`;
    textarea.style.overflowY = textarea.scrollHeight > 132 ? "auto" : "hidden";
  }, [draft, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    markAgentChatAsSeen(agent.id, messages);
    markAgentInboxAsSeen(agent.id, inboxItems);
  }, [agent.id, messages, inboxItems, isVisible]);

  useEffect(() => {
    if (!isVisible || !listRef.current) {
      return;
    }

    if (isNearBottomRef.current) {
      listRef.current.scrollTop = listRef.current.scrollHeight;
      return;
    }

    if (messages.length > 0 || inboxItems.length > 0) {
      setHasUnreadBelow(true);
    }
  }, [agent.id, inboxItems.length, isVisible, messages]);

  const canSend = Boolean(draft.trim()) && !runSnapshot.isRunning;
  const streamingAssistantId = runSnapshot.assistantMessageId;

  const hasConversation = messages.length > 0 || inboxItems.length > 0;

  const send = async () => {
    const text = draft.trim();
    if (!text || runSnapshot.isRunning) return;

    setDraft("");
    scrollToLatest();

    try {
      await sendAgentChatMessage({
        agentId: agent.id,
        agentName: agentLabel,
        text,
        onRefresh,
        onSnapshotChange,
        onError: (message) => {
          toast.error("Chat message failed.", { description: message });
        }
      });
    } finally {
      if (isVisibleRef.current) {
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
  };

  const repairGatewayAccessAndRetry = async (
    messageId: string,
    text: string,
    action: AgentChatGatewayRepairAction
  ) => {
    const retryText = text.trim();
    if (!retryText || repairingGatewayMessageId || runSnapshot.isRunning) {
      return;
    }

    setRepairingGatewayMessageId(messageId);

    try {
      const response = await fetch("/api/settings/gateway", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ action: action.apiAction })
      });
      const result = (await response.json().catch(() => null)) as {
        authStatus?: {
          native?: {
            ok?: boolean;
            issue?: string | null;
          };
        };
        error?: string;
      } | null;

      if (!response.ok) {
        throw new Error(result?.error || "Gateway access could not be repaired.");
      }

      if (result?.authStatus?.native && result.authStatus.native.ok === false) {
        throw new Error(result.authStatus.native.issue || "Gateway access still needs attention.");
      }

      toast.success(`${action.label} repaired.`, {
        description: "Retrying the chat message."
      });
      await onRefresh?.().catch(() => undefined);
      setRepairingGatewayMessageId(null);
      await sendAgentChatMessage({
        agentId: agent.id,
        agentName: agentLabel,
        text: retryText,
        onRefresh,
        onSnapshotChange,
        onError: (message) => {
          toast.error("Chat message failed.", { description: message });
        }
      });
    } catch (error) {
      toast.error("Gateway repair failed.", {
        description: error instanceof Error ? error.message : "Unable to repair Gateway access."
      });
    } finally {
      setRepairingGatewayMessageId(null);
      if (isVisibleRef.current) {
        requestAnimationFrame(() => textareaRef.current?.focus());
      }
    }
  };

  return (
    <div
      className={cn(
        "relative flex h-full min-h-0 flex-col overflow-hidden",
        surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-200"
      )}
    >
      <div
        ref={listRef}
        onScroll={handleTimelineScroll}
        className={cn(
          "agent-chat-scroll mission-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pt-3 lg:pr-1 lg:pt-0",
          surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-200"
        )}
      >
        <div
          className={cn(
            hasConversation
              ? "space-y-5 pb-3 lg:space-y-2.5 lg:pb-1"
              : "flex min-h-full items-center justify-center pb-3"
          )}
        >
          {!hasConversation ? (
            <AgentChatWelcome
              agentLabel={agentLabel}
              surfaceTheme={surfaceTheme}
              prompts={quickPrompts.slice(0, 2)}
              onPrompt={applyQuickPrompt}
            />
          ) : null}
          {inboxItems.map((item) => (
            <AgentInboxItemBubble
              key={item.id}
              item={item}
              surfaceTheme={surfaceTheme}
            />
          ))}
          {messages.map((entry, index) => {
            const isUser = entry.role === "user";
            const isSystem = entry.role === "system";
            const isAssistant = entry.role === "assistant";
            const isActiveAssistant =
              isAssistant && entry.id === streamingAssistantId && runSnapshot.isRunning;
            const isPendingAssistant = isActiveAssistant && !entry.text.trim();
            const revealedAssistantText = isAssistant ? revealedAssistantTextById[entry.id] : undefined;
            const visibleAssistantText = revealedAssistantText ?? entry.text;
            const isRevealingAssistant =
              isAssistant && Boolean(revealedAssistantText) && visibleAssistantText !== entry.text;
            const showAssistantActivity = isActiveAssistant || isRevealingAssistant;
            const isPendingUser = entry.role === "user" && entry.id === runSnapshot.userMessageId && runSnapshot.isRunning;
            const showInlineStatus = entry.status === "sending" && isPendingUser;
            const errorMessage = entry.errorMessage?.trim();
            const assistantDiagnosticText =
              isAssistant && !isPendingAssistant && !isActiveAssistant ? visibleAssistantText.trim() : "";
            const authActionMessage = errorMessage || assistantDiagnosticText;
            const gatewayRepairAction = errorMessage ? resolveAgentChatGatewayRepairAction(errorMessage) : null;
            const authAction =
              authActionMessage && !gatewayRepairAction ? resolveAgentChatAuthAction(authActionMessage, agent.modelId) : null;
            const showAssistantRecoveryAction =
              !isPendingAssistant && entry.status !== "error" && isAssistant && Boolean(authAction && onConnectModelProvider);
            const showDateSeparator = shouldShowChatDateSeparator(messages[index - 1]?.createdAt, entry.createdAt);

            return (
              <div key={entry.id} className="space-y-2">
                {showDateSeparator ? (
                  <div className="flex items-center gap-3 py-1" role="separator" aria-label={formatChatDate(entry.createdAt)}>
                    <span className={cn("h-px flex-1", surfaceTheme === "light" ? "bg-[#dfd4cc]/70" : "bg-white/[0.07]")} />
                    <time
                      dateTime={Number.isFinite(entry.createdAt) ? new Date(entry.createdAt).toISOString() : undefined}
                      className={cn(
                        "shrink-0 text-[9px] font-medium uppercase tracking-[0.14em]",
                        surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-500"
                      )}
                    >
                      {formatChatDate(entry.createdAt)}
                    </time>
                    <span className={cn("h-px flex-1", surfaceTheme === "light" ? "bg-[#dfd4cc]/70" : "bg-white/[0.07]")} />
                  </div>
                ) : null}
                <div className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      isPendingAssistant
                        ? surfaceTheme === "light"
                          ? "min-w-0 max-w-full bg-transparent px-0 py-0 text-[#4a382c] lg:max-w-full lg:rounded-none lg:border-0 lg:px-0 lg:py-0 lg:text-[13px] lg:leading-5 lg:shadow-none"
                          : "min-w-0 max-w-full bg-transparent px-0 py-0 text-slate-100 lg:max-w-full lg:rounded-none lg:border-0 lg:px-0 lg:py-0 lg:text-[13px] lg:leading-5 lg:shadow-none"
                        : cn(
                            "min-w-0 text-[15px] leading-6 lg:max-w-[92%] lg:rounded-[18px] lg:border lg:px-3 lg:py-2 lg:text-[13px] lg:leading-5 lg:shadow-[0_14px_34px_rgba(0,0,0,0.14)]",
                            isPendingUser && "opacity-85",
                            isSystem
                              ? surfaceTheme === "light"
                                ? "max-w-full rounded-[16px] border border-[#e3d4c8] bg-[#fffaf6] px-3 py-2 text-[#6c5647]"
                                : "max-w-full rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-slate-400"
                              : isUser
                                ? surfaceTheme === "light"
                                  ? "max-w-[82%] rounded-[22px] bg-[#eee7e2] px-4 py-2.5 text-[#35271f] lg:border-[#e3d4c8] lg:bg-[#fff3f6]"
                                  : "max-w-[82%] rounded-[22px] bg-white/[0.12] px-4 py-2.5 text-slate-50 lg:border-white/[0.08] lg:bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))]"
                                : surfaceTheme === "light"
                                  ? "max-w-full bg-transparent px-0 py-1 text-[#35271f] lg:border-[#e3d4c8] lg:bg-[#fffaf6] lg:text-[#4a382c]"
                                  : "max-w-full bg-transparent px-0 py-1 text-slate-100 lg:border-cyan-300/12 lg:bg-[linear-gradient(180deg,rgba(34,211,238,0.10),rgba(59,130,246,0.06))]"
                          )
                    )}
                  >
                    {isPendingAssistant ? (
                      <AssistantThinkingActivity
                        statusMessage={runSnapshot.statusMessage}
                        statusHistory={runSnapshot.statusHistory}
                        surfaceTheme={surfaceTheme}
                      />
                    ) : (
                      <>
                        <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
                          {isAssistant ? visibleAssistantText : entry.text}
                        </p>
                        <time
                          dateTime={Number.isFinite(entry.createdAt) ? new Date(entry.createdAt).toISOString() : undefined}
                          className={cn(
                            "mt-1 block text-[9px] leading-3 opacity-70",
                            isUser ? "text-right" : "text-left",
                            surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-500"
                          )}
                        >
                          {formatChatTime(entry.createdAt)}
                        </time>
                        {showAssistantActivity ? (
                          <motion.span
                            aria-hidden="true"
                            animate={{ opacity: [0.2, 1, 0.2] }}
                            transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                            className="ml-0.5 inline-block h-[1em] w-[1px] translate-y-[2px] bg-current"
                          />
                        ) : null}
                      </>
                    )}
                    {!isPendingAssistant && showInlineStatus ? (
                    <p
                      className={cn(
                        "mt-1.5 text-[10px] uppercase tracking-[0.18em]",
                        surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-500"
                      )}
                    >
                      {isUser ? "Sending…" : "Drafting…"}
                    </p>
                  ) : !isPendingAssistant && entry.status === "error" ? (
                    <div className="mt-1.5 space-y-1">
                      <p className="text-[10px] uppercase tracking-[0.18em] text-rose-300">
                        Failed to send
                      </p>
                      {errorMessage ? (
                        <p
                          className={cn(
                            "text-[11px] leading-4 [overflow-wrap:anywhere]",
                            surfaceTheme === "light" ? "text-rose-700" : "text-rose-200"
                          )}
                        >
                          {errorMessage}
                        </p>
                      ) : null}
                      {authAction && onConnectModelProvider ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => onConnectModelProvider(authAction.provider)}
                          className={cn(
                            "mt-1 h-8 rounded-full px-3 text-[11px]",
                            surfaceTheme === "light"
                              ? "border-rose-200 bg-white text-rose-800 hover:bg-rose-50"
                              : "border-rose-300/20 bg-rose-300/10 text-rose-100 hover:bg-rose-300/16"
                          )}
                        >
                          <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                          {authAction.cta}
                        </Button>
                      ) : null}
                      {gatewayRepairAction ? (
                        <Button
                          type="button"
                          variant="secondary"
                          size="sm"
                          onClick={() => void repairGatewayAccessAndRetry(entry.id, entry.text, gatewayRepairAction)}
                          disabled={Boolean(repairingGatewayMessageId) || runSnapshot.isRunning}
                          title={gatewayRepairAction.detail}
                          className={cn(
                            "mt-1 h-8 rounded-full px-3 text-[11px]",
                            surfaceTheme === "light"
                              ? "border-emerald-200 bg-white text-emerald-800 hover:bg-emerald-50"
                              : "border-emerald-300/20 bg-emerald-300/10 text-emerald-100 hover:bg-emerald-300/16"
                          )}
                        >
                          {repairingGatewayMessageId === entry.id ? (
                            <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                          ) : (
                            <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                          )}
                          {gatewayRepairAction.cta}
                        </Button>
                      ) : null}
                    </div>
                  ) : showAssistantRecoveryAction && authAction && onConnectModelProvider ? (
                    <div className="mt-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => onConnectModelProvider(authAction.provider)}
                        className={cn(
                          "h-8 rounded-full px-3 text-[11px]",
                          surfaceTheme === "light"
                            ? "border-rose-200 bg-white text-rose-800 hover:bg-rose-50"
                            : "border-rose-300/20 bg-rose-300/10 text-rose-100 hover:bg-rose-300/16"
                        )}
                      >
                        <KeyRound className="mr-1.5 h-3.5 w-3.5" />
                        {authAction.cta}
                      </Button>
                    </div>
                  ) : null}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {timelineScrollIndicator.height > 0 ? (
        <span
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-0 z-10 w-0.5 rounded-full transition-opacity duration-200 lg:hidden",
            timelineScrollIndicator.visible ? "opacity-100" : "opacity-0",
            surfaceTheme === "light" ? "bg-[#8b7262]/35" : "bg-slate-300/35"
          )}
          style={{ top: timelineScrollIndicator.top, height: timelineScrollIndicator.height }}
        />
      ) : null}

      {hasUnreadBelow && !isNearBottom ? (
        <button
          type="button"
          onClick={scrollToLatest}
          className={cn(
            "absolute bottom-[142px] left-1/2 z-20 inline-flex -translate-x-1/2 items-center gap-1.5 rounded-full border px-3 py-1.5 text-[10px] font-semibold shadow-lg transition",
            surfaceTheme === "light"
              ? "border-[#d8bead] bg-[#fffaf6] text-[#5c4031] hover:bg-white"
              : "border-cyan-200/20 bg-slate-900 text-cyan-50 hover:bg-slate-800"
          )}
        >
          <ArrowDown className="h-3.5 w-3.5" />
          New reply
        </button>
      ) : null}

      <div
        className={cn(
          "relative mt-2 shrink-0 overflow-hidden rounded-[26px] border shadow-none lg:rounded-[14px]",
          surfaceTheme === "light"
            ? "border-[#dfd4cc] bg-[#fffaf6]"
            : "border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))]"
        )}
        onPointerDown={(event) => {
          const target = event.target as HTMLElement | null;
          if (!target || target.closest("textarea") || target.closest("button")) return;
          textareaRef.current?.focus();
        }}
      >
        <Textarea
          ref={textareaRef}
          rows={1}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={async (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              await send();
            }
          }}
          placeholder={`Ask ${agentLabel} about ${agentWorkLabel}…`}
          className={cn(
            "min-h-[52px] max-h-[132px] w-full cursor-text resize-none border-0 bg-transparent px-4 py-[15px] pr-16 text-[15px] leading-[22px] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 lg:min-h-[96px] lg:px-3 lg:py-3 lg:pr-20 lg:text-[13px] lg:leading-[1.5]",
            surfaceTheme === "light"
              ? "text-[#3f2f24] placeholder:text-[#8f7664]"
              : "text-white placeholder:text-slate-500"
          )}
        />

        <Button
          type="button"
          aria-label={runSnapshot.isRunning ? "Agent is responding" : "Send message"}
          disabled={!canSend}
          className={cn(
            "absolute bottom-1.5 right-1.5 h-10 w-10 rounded-full p-0 shadow-none lg:bottom-3 lg:right-3 lg:h-8 lg:w-auto lg:px-3",
            surfaceTheme === "light"
              ? "bg-[#4a382c] text-[#fffaf6] hover:bg-[#3f2f24]"
              : "bg-white text-slate-950 hover:bg-white/92"
          )}
          onClick={send}
        >
          {runSnapshot.isRunning ? (
            <LoaderCircle className="h-4 w-4 animate-spin lg:mr-[5px] lg:h-[13px] lg:w-[13px]" />
          ) : (
            <SendHorizontal className="h-4 w-4 lg:mr-[5px] lg:h-[13px] lg:w-[13px]" />
          )}
          <span className="sr-only lg:not-sr-only">Send</span>
        </Button>
      </div>
    </div>
  );
}

function readVisibleAgentChatMessages(agentId: string, runSnapshot: AgentChatRunSnapshot): ChatMessage[] {
  return normalizeAgentChatMessagesForDisplay(readAgentChatMessages(agentId), runSnapshot);
}

function AgentInboxItemBubble({
  item,
  surfaceTheme
}: {
  item: MissionControlSnapshot["agentInbox"][number];
  surfaceTheme: "dark" | "light";
}) {
  const sourceLabel = item.sourceAgentName || item.sourceAgentId || "OpenClaw";
  const provenanceLabel = item.provenance === "openclaw-task" ? "OpenClaw task" : "OpenClaw runtime";
  const reference = item.taskId || item.runtimeId || item.sessionId || item.runId || null;

  return (
    <div className="flex justify-start">
      <div
        className={cn(
          "min-w-0 max-w-[92%] rounded-[18px] border px-3 py-2 text-[13px] leading-5 shadow-[0_14px_34px_rgba(0,0,0,0.14)]",
          surfaceTheme === "light"
            ? "border-emerald-200 bg-emerald-50 text-[#304238]"
            : "border-emerald-300/18 bg-[linear-gradient(180deg,rgba(16,185,129,0.12),rgba(6,95,70,0.08))] text-emerald-50"
        )}
      >
        <div className="flex flex-wrap items-center gap-1.5">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.18em]",
              surfaceTheme === "light"
                ? "border-emerald-300 bg-white/70 text-emerald-800"
                : "border-emerald-300/25 bg-emerald-300/10 text-emerald-100"
            )}
          >
            Handoff result
          </span>
          <span className={cn("text-[10px]", surfaceTheme === "light" ? "text-emerald-800/70" : "text-emerald-100/70")}>
            {sourceLabel} · {provenanceLabel}
          </span>
        </div>
        <p className="mt-1.5 text-[12px] font-medium">{item.title}</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-[12px] leading-5 [overflow-wrap:anywhere]">
          {item.summary}
        </p>
        {reference ? (
          <p className={cn("mt-1.5 font-mono text-[9px]", surfaceTheme === "light" ? "text-emerald-900/55" : "text-emerald-100/45")}>
            {reference}
          </p>
        ) : null}
      </div>
    </div>
  );
}

function agentChatMessagesEqual(left: readonly AgentChatMessage[], right: readonly AgentChatMessage[]) {
  if (left.length !== right.length) {
    return false;
  }

  return left.every((message, index) => {
    const other = right[index];

    return Boolean(
      other &&
        message.id === other.id &&
        message.role === other.role &&
        message.text === other.text &&
        message.createdAt === other.createdAt &&
        message.status === other.status &&
        message.errorMessage === other.errorMessage &&
        message.runId === other.runId
    );
  });
}

function revealNextAssistantText(targetText: string, currentText: string) {
  const safeCurrent = targetText.startsWith(currentText) ? currentText : "";
  const remainingText = targetText.slice(safeCurrent.length);
  const nextWord = remainingText.match(/^\s*\S+\s*/)?.[0];

  if (!nextWord) {
    return targetText;
  }

  return targetText.slice(0, safeCurrent.length + nextWord.length);
}
