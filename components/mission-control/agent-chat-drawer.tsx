"use client";

import { useEffect, useRef, useState } from "react";

import { LoaderCircle, SendHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import {
  markAgentChatAsSeen,
  maxAgentChatMessages,
  readAgentChatMessages,
  type AgentChatMessage,
  writeAgentChatMessages
} from "@/components/mission-control/agent-chat-storage";
import { consumeNdjsonStream } from "@/lib/ndjson";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot, MissionResponse, OpenClawAgent } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type ChatMessage = AgentChatMessage;

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

function renderAgentReplyText(result: MissionResponse) {
  const payloadText = result.payloads
    .map((entry) => entry.text?.trim())
    .filter(Boolean)
    .join("\n\n");
  return payloadText || result.summary || "No response text was returned.";
}

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
  onRefresh,
  onSnapshotChange
}: {
  agent: OpenClawAgent;
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
}) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isAssistantStreaming, setIsAssistantStreaming] = useState(false);
  const [streamStatusMessage, setStreamStatusMessage] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const activeRequestAbortRef = useRef<AbortController | null>(null);
  const activeAssistantMessageIdRef = useRef<string | null>(null);
  const latestAssistantTextRef = useRef("");
  const assistantTextReceivedRef = useRef(false);
  const agentLabel = formatAgentDisplayName(agent);

  const persistMessages = (updater: (current: ChatMessage[]) => ChatMessage[]) => {
    setMessages((current) => {
      const next = updater(current).slice(-maxAgentChatMessages);
      writeAgentChatMessages(agent.id, next);
      return next;
    });
  };

  useEffect(() => {
    activeRequestAbortRef.current?.abort();
    activeRequestAbortRef.current = null;
    activeAssistantMessageIdRef.current = null;
    latestAssistantTextRef.current = "";
    assistantTextReceivedRef.current = false;

    const storedMessages = readAgentChatMessages(agent.id).map((entry) =>
      entry.status === "sending" ? { ...entry, status: "sent" as const } : entry
    );

    setMessages(storedMessages);
    setDraft("");
    setIsSending(false);
    setIsAssistantStreaming(false);
    setStreamStatusMessage(null);
    requestAnimationFrame(() => textareaRef.current?.focus());

    return () => {
      activeRequestAbortRef.current?.abort();
      activeRequestAbortRef.current = null;
    };
  }, [agent.id]);

  useEffect(() => {
    markAgentChatAsSeen(agent.id, messages);
  }, [agent.id, messages]);

  useEffect(() => {
    if (!listRef.current) {
      return;
    }

    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages, agent.id, isSending, isAssistantStreaming, streamStatusMessage]);

  const canSend = Boolean(draft.trim()) && !isSending && !isAssistantStreaming;
  const showAgentTyping = isSending || isAssistantStreaming;
  const streamingAssistantId = activeAssistantMessageIdRef.current;

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
    if (!text || isSending || isAssistantStreaming) return;

    activeRequestAbortRef.current?.abort();

    const abortController = new AbortController();
    activeRequestAbortRef.current = abortController;
    assistantTextReceivedRef.current = false;
    latestAssistantTextRef.current = "";
    setIsSending(true);
    setIsAssistantStreaming(false);
    setStreamStatusMessage("Starting agent turn...");

    const createdAt = Date.now();
    const userMessageId = globalThis.crypto?.randomUUID?.() || `user:${createdAt}`;
    const assistantMessageId = globalThis.crypto?.randomUUID?.() || `assistant:${createdAt}`;
    activeAssistantMessageIdRef.current = assistantMessageId;

    const userMessage: ChatMessage = {
      id: userMessageId,
      role: "user",
      text,
      createdAt,
      status: "sending"
    };

    const assistantMessage: ChatMessage = {
      id: assistantMessageId,
      role: "assistant",
      text: "",
      createdAt: createdAt + 1
    };

    const nextHistory = [...messages, userMessage].slice(-maxAgentChatMessages);
    const uiHistory = [...nextHistory, assistantMessage].slice(-maxAgentChatMessages);
    setMessages(uiHistory);
    writeAgentChatMessages(agent.id, nextHistory);
    setDraft("");
    const promptHistory = messages
      .filter(
        (entry): entry is ChatMessage & { role: "user" | "assistant" } =>
          (entry.role === "user" || entry.role === "assistant") && entry.text.trim().length > 0
      )
      .slice(-16)
      .map((entry) => ({
        role: entry.role,
        text: entry.text
      }));

    const payload = {
      message: text,
      rawMessage: text,
      history: promptHistory,
      thinking: "low" as const
    };

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
        signal: abortController.signal
      });

      const contentType = response.headers.get("content-type") || "";
      if (!response.ok || !contentType.includes("application/x-ndjson")) {
        const payload = (await response.json().catch(() => null)) as { error?: string } | null;
        throw new Error(payload?.error || "OpenClaw rejected the message.");
      }

      let finalResponse: MissionResponse | null = null;

      await consumeNdjsonStream<AgentChatStreamEvent>(response, async (event) => {
        if (event.type === "status") {
          setStreamStatusMessage(event.message);
          return;
        }

        if (event.type === "assistant") {
          assistantTextReceivedRef.current = true;
          latestAssistantTextRef.current = event.text;

          setIsAssistantStreaming(true);
          setStreamStatusMessage("Agent is drafting a reply...");

          persistMessages((current) =>
            current.map((entry) => {
              if (entry.id === userMessageId) {
                return { ...entry, status: "sent" as const };
              }

              if (entry.id === assistantMessageId) {
                return { ...entry, text: event.text };
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
        const finalText = finalResponse ? renderAgentReplyText(finalResponse) : latestAssistantTextRef.current;

        if (finalResponse) {
          latestAssistantTextRef.current = finalText;
        }

        persistMessages((current) =>
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
          onSnapshotChange((current) => applyAgentRename(current, agent.id, renamedTo));
        }

        setStreamStatusMessage(null);
        setIsAssistantStreaming(false);
        setIsSending(false);
        activeAssistantMessageIdRef.current = null;
        activeRequestAbortRef.current = null;

        void onRefresh?.().catch(() => null);
      });

      if (!finalResponse) {
        throw new Error("OpenClaw completed without returning a response.");
      }
    } catch (error) {
      if (abortController.signal.aborted) {
        return;
      }

      const message = error instanceof Error ? error.message : "Unknown send error.";
      toast.error("Chat message failed.", { description: message });

      const partialText = assistantTextReceivedRef.current ? latestAssistantTextRef.current.trim() : "";

      persistMessages((current) =>
        current
          .map((entry) => {
            if (entry.id === userMessageId) {
              return { ...entry, status: "error" as const };
            }

            if (entry.id === assistantMessageId) {
              if (partialText.length > 0) {
                return { ...entry, text: partialText };
              }

              return entry;
            }

            return entry;
          })
          .filter((entry) => entry.id !== assistantMessageId || partialText.length > 0)
      );
    } finally {
      setIsSending(false);
      setIsAssistantStreaming(false);
      setStreamStatusMessage(null);
      activeAssistantMessageIdRef.current = null;
      activeRequestAbortRef.current = null;
      requestAnimationFrame(() => textareaRef.current?.focus());
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
                      Sending…
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
                  {streamStatusMessage || "typing"}
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
            {isSending ? (
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
