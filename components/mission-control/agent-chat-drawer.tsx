"use client";

import { useEffect, useRef, useState } from "react";

import { LoaderCircle, SendHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  agentChatMessageStoragePrefix,
  agentChatStateEventName,
  markAgentChatAsSeen,
  readAgentChatMessages,
  type AgentChatMessage
} from "@/components/mission-control/agent-chat-storage";
import {
  getAgentChatRunSnapshot,
  sendAgentChatMessage,
  type AgentChatRunSnapshot
} from "@/components/mission-control/agent-chat-runner";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot, OpenClawAgent } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type ChatMessage = AgentChatMessage;

function TypingDots({ surfaceTheme }: { surfaceTheme: "dark" | "light" }) {
  return (
    <span className="inline-flex items-center gap-[3px] align-middle">
      {[0, 1, 2].map((index) => (
        <motion.span
          key={index}
          animate={{ opacity: [0.35, 1, 0.35], y: [0, -1, 0] }}
          transition={{ duration: 1.1, repeat: Infinity, delay: index * 0.14, ease: "easeInOut" }}
          className={cn("h-1.5 w-1.5 rounded-full", surfaceTheme === "light" ? "bg-[#8f7263]" : "bg-cyan-300")}
        />
      ))}
    </span>
  );
}

export function AgentChatDrawer({
  agent,
  surfaceTheme,
  isVisible,
  onRefresh,
  onSnapshotChange
}: {
  agent: OpenClawAgent;
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  isVisible: boolean;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [runSnapshot, setRunSnapshot] = useState<AgentChatRunSnapshot>(() => getAgentChatRunSnapshot(agent.id));
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const isVisibleRef = useRef(isVisible);
  const agentLabel = formatAgentDisplayName(agent);

  useEffect(() => {
    isVisibleRef.current = isVisible;
  }, [isVisible]);

  useEffect(() => {
    const syncAgentChatState = () => {
      const nextRunSnapshot = getAgentChatRunSnapshot(agent.id);

      setRunSnapshot(nextRunSnapshot);
      setMessages(readVisibleAgentChatMessages(agent.id, nextRunSnapshot.isRunning));
    };

    syncAgentChatState();
    setDraft("");

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
    if (!isVisible) {
      return;
    }

    const frame = requestAnimationFrame(() => {
      if (isVisibleRef.current) {
        textareaRef.current?.focus();
      }
    });

    return () => cancelAnimationFrame(frame);
  }, [agent.id, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    markAgentChatAsSeen(agent.id, messages);
  }, [agent.id, messages, isVisible]);

  useEffect(() => {
    if (!isVisible) {
      return;
    }

    if (!listRef.current) {
      return;
    }

    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, agent.id, runSnapshot, isVisible]);

  const canSend = Boolean(draft.trim()) && !runSnapshot.isRunning;
  const showAgentTyping = runSnapshot.isRunning;
  const streamingAssistantId = runSnapshot.assistantMessageId;

  const uiMessages = messages.length > 0
    ? messages
    : [
        {
          id: "system:empty",
          role: "system" as const,
          text: "Start a direct chat with this agent. Messages stay in this drawer and are stored locally in your browser.",
          createdAt: Date.now()
        }
      ];

  const send = async () => {
    const text = draft.trim();
    if (!text || runSnapshot.isRunning) return;

    setDraft("");

    try {
      await sendAgentChatMessage({
        agentId: agent.id,
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

  return (
    <div
      className={cn(
        "flex h-full min-h-0 flex-col overflow-hidden",
        surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-200"
      )}
    >
      <div
        ref={listRef}
        className={cn(
          "mission-scroll min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1",
          surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-200"
        )}
      >
        <div className="space-y-2.5">
          {uiMessages.map((entry) => {
            const isUser = entry.role === "user";
            const isSystem = entry.role === "system";
            const isActiveAssistant = entry.role === "assistant" && entry.id === streamingAssistantId && showAgentTyping;

            return (
              <div key={entry.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "min-w-0 max-w-[92%] rounded-[18px] border px-3 py-2 text-[13px] leading-5 shadow-[0_14px_34px_rgba(0,0,0,0.14)]",
                    isSystem
                      ? surfaceTheme === "light"
                        ? "border-[#e3d4c8] bg-[#fffaf6] text-[#6c5647]"
                        : "border-white/[0.08] bg-white/[0.03] text-slate-400"
                      : isUser
                        ? surfaceTheme === "light"
                          ? "border-[#e3d4c8] bg-[#fff3f6] text-[#4a382c]"
                          : "border-white/[0.08] bg-[linear-gradient(180deg,rgba(255,255,255,0.07),rgba(255,255,255,0.03))] text-slate-100"
                        : surfaceTheme === "light"
                          ? "border-[#e3d4c8] bg-[#fffaf6] text-[#4a382c]"
                          : "border-cyan-300/12 bg-[linear-gradient(180deg,rgba(34,211,238,0.10),rgba(59,130,246,0.06))] text-slate-100"
                  )}
                >
                  <p className="whitespace-pre-wrap break-words [overflow-wrap:anywhere]">{entry.text}</p>
                  {isActiveAssistant ? (
                    <motion.span
                      aria-hidden="true"
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                      className="ml-0.5 inline-block h-[1em] w-[1px] translate-y-[2px] bg-current"
                    />
                  ) : null}
                  {entry.status === "sending" ? (
                    <p
                      className={cn(
                        "mt-1.5 text-[10px] uppercase tracking-[0.18em]",
                        surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-500"
                      )}
                    >
                      {isUser ? "Sending…" : "Drafting…"}
                    </p>
                  ) : entry.status === "error" ? (
                    <p className="mt-1.5 text-[10px] uppercase tracking-[0.18em] text-rose-300">
                      Failed to send
                    </p>
                  ) : null}
                </div>
              </div>
            );
          })}
        </div>

        <AnimatePresence initial={false}>
          {showAgentTyping ? (
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              className="mt-2 flex justify-start"
            >
              <div
                className={cn(
                  "inline-flex items-center gap-2 rounded-[18px] border px-3 py-2 text-[12px] leading-5 shadow-[0_14px_34px_rgba(0,0,0,0.14)]",
                  surfaceTheme === "light"
                    ? "border-[#e3d4c8] bg-[#fffaf6] text-[#4a382c]"
                    : "border-cyan-300/12 bg-[linear-gradient(180deg,rgba(34,211,238,0.10),rgba(59,130,246,0.06))] text-slate-100"
                )}
              >
                <span className="font-medium">{agentLabel}</span>
                <span
                  className={cn(
                    "text-[10px] uppercase tracking-[0.18em]",
                    surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400"
                  )}
                >
                  {runSnapshot.statusMessage || "typing"}
                </span>
                <TypingDots surfaceTheme={surfaceTheme} />
              </div>
            </motion.div>
          ) : null}
        </AnimatePresence>
      </div>

      <div
        className={cn(
          "mt-2 shrink-0 rounded-[18px] border p-3",
          surfaceTheme === "light"
            ? "border-[#e3d4c8] bg-[#fffaf6]"
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
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={async (event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              await send();
            }
          }}
          placeholder={`Message to ${agentLabel}...`}
          className={cn(
            "min-h-[60px] cursor-text resize-none border-0 bg-transparent px-3.5 py-2.5 text-[13px] leading-[1.5] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
            surfaceTheme === "light"
              ? "text-[#3f2f24] placeholder:text-[#8f7664]"
              : "text-white placeholder:text-slate-500"
          )}
        />

        <div className="mt-1.5 flex items-center justify-end gap-1.5">
          <Button
            disabled={!canSend}
            className={cn(
              "h-8 rounded-full px-3 shadow-none",
              surfaceTheme === "light"
                ? "bg-[#4a382c] text-[#fffaf6] hover:bg-[#3f2f24]"
                : "bg-white text-slate-950 hover:bg-white/92"
            )}
            onClick={send}
          >
            {runSnapshot.isRunning ? (
              <LoaderCircle className="mr-[5px] h-[13px] w-[13px] animate-spin" />
            ) : (
              <SendHorizontal className="mr-[5px] h-[13px] w-[13px]" />
            )}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}

function readVisibleAgentChatMessages(agentId: string, isRunning: boolean): ChatMessage[] {
  return readAgentChatMessages(agentId)
    .map((entry) => {
      if (entry.status !== "sending" || isRunning) {
        return entry;
      }

      return entry.role === "assistant" ? { ...entry, status: "error" as const } : { ...entry, status: "sent" as const };
    })
    .filter((entry) => entry.role !== "assistant" || entry.text.trim().length > 0);
}
