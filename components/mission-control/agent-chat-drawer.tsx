"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LoaderCircle, SendHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { StatusDot } from "@/components/mission-control/status-dot";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import type { MissionResponse, OpenClawAgent } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type ChatRole = "user" | "assistant" | "system";
type ChatMessage = {
  id: string;
  role: ChatRole;
  text: string;
  createdAt: number;
  status?: "sending" | "sent" | "error";
  runId?: string | null;
};

const chatStoragePrefix = "mission-control-agent-chat:v1";
const maxStoredMessages = 60;

function storageKey(agentId: string) {
  return `${chatStoragePrefix}:${agentId}`;
}

function readChat(agentId: string): ChatMessage[] {
  try {
    const raw = globalThis.localStorage?.getItem(storageKey(agentId));
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((entry): entry is ChatMessage => {
        return (
          typeof entry === "object" &&
          entry !== null &&
          (entry.role === "user" || entry.role === "assistant" || entry.role === "system") &&
          typeof entry.id === "string" &&
          typeof entry.text === "string" &&
          typeof entry.createdAt === "number"
        );
      })
      .slice(-maxStoredMessages);
  } catch {
    return [];
  }
}

function writeChat(agentId: string, messages: ChatMessage[]) {
  try {
    globalThis.localStorage?.setItem(storageKey(agentId), JSON.stringify(messages.slice(-maxStoredMessages)));
  } catch {
    // Ignore storage failures.
  }
}

function renderAgentReplyText(result: MissionResponse) {
  const payloadText = result.payloads
    .map((entry) => entry.text?.trim())
    .filter(Boolean)
    .join("\n\n");
  return payloadText || result.summary || "No response text was returned.";
}

function buildAgentChatPrompt(history: ChatMessage[], message: string) {
  const turns = history
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .slice(-8)
    .map((entry) => `${entry.role === "user" ? "Operator" : "Agent"}: ${entry.text.trim()}`)
    .join("\n");

  const trimmed = message.trim();
  const prefix =
    "You are chatting directly with the operator inside Mission Control. Reply conversationally, be concise, and ask a clarifying question when needed. Do not create tasks or mention task cards.\n";

  return turns
    ? `${prefix}\nConversation so far:\n${turns}\n\nOperator: ${trimmed}`
    : `${prefix}\nOperator: ${trimmed}`;
}

export function AgentChatDrawer({
  agent,
  surfaceTheme,
  onRefresh
}: {
  agent: OpenClawAgent;
  surfaceTheme: "dark" | "light";
  onRefresh?: () => Promise<void>;
}) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  const dotTone =
    agent.status === "engaged"
      ? "bg-cyan-300"
      : agent.status === "monitoring"
        ? "bg-emerald-300"
        : agent.status === "ready"
          ? "bg-amber-200"
          : agent.status === "offline"
            ? "bg-rose-300"
          : "bg-slate-500";

  useEffect(() => {
    setMessages(readChat(agent.id));
    setDraft("");
    requestAnimationFrame(() => textareaRef.current?.focus());
  }, [agent.id]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, agent.id]);

  const canSend = Boolean(draft.trim()) && !isSending;

  const uiMessages = useMemo(() => {
    if (messages.length > 0) return messages;
    return [
      {
        id: "system:empty",
        role: "system" as const,
        text: "Start a direct chat with this agent. Messages stay in this drawer and are stored locally in your browser.",
        createdAt: Date.now()
      }
    ];
  }, [messages]);

  const send = async () => {
    const text = draft.trim();
    if (!text || isSending) return;

    setIsSending(true);
    const createdAt = Date.now();
    const userMessage: ChatMessage = {
      id: globalThis.crypto?.randomUUID?.() || `user:${createdAt}`,
      role: "user",
      text,
      createdAt,
      status: "sending"
    };

    const nextHistory = [...messages, userMessage].slice(-maxStoredMessages);
    setMessages(nextHistory);
    setDraft("");

    const payload = {
      message: buildAgentChatPrompt(nextHistory, text),
      thinking: "low" as const
    };

    try {
      const response = await fetch(`/api/agents/${encodeURIComponent(agent.id)}/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const result = (await response.json()) as (MissionResponse & { error?: string });

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw rejected the message.");
      }

      const assistantMessage: ChatMessage = {
        id: globalThis.crypto?.randomUUID?.() || `assistant:${Date.now()}`,
        role: "assistant",
        text: renderAgentReplyText(result),
        createdAt: Date.now(),
        status: "sent",
        runId: result.runId
      };

      const finalized: ChatMessage[] = nextHistory
        .map((entry): ChatMessage => (entry.id === userMessage.id ? { ...entry, status: "sent" as const } : entry))
        .concat(assistantMessage)
        .slice(-maxStoredMessages);

      setMessages(finalized);
      writeChat(agent.id, finalized);
      if (onRefresh) {
        await onRefresh().catch(() => null);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown send error.";
      toast.error("Chat message failed.", { description: message });

      const finalized: ChatMessage[] = nextHistory
        .map((entry): ChatMessage => (entry.id === userMessage.id ? { ...entry, status: "error" as const } : entry))
        .slice(-maxStoredMessages);
      setMessages(finalized);
      writeChat(agent.id, finalized);
    } finally {
      setIsSending(false);
      requestAnimationFrame(() => textareaRef.current?.focus());
    }
  };

  return (
    <div
      className={cn(
        "flex min-h-0 flex-1 flex-col",
        surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-200"
      )}
    >
      <div
        className={cn(
          "shrink-0 border border-white/[0.08] p-3",
          surfaceTheme === "light"
            ? "rounded-[20px] border-[#e3d4c8] bg-[#fffaf6]"
            : "rounded-[20px] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))]"
        )}
      >
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <StatusDot tone={dotTone} pulse={agent.status === "engaged" || agent.status === "monitoring"} />
              <p className={cn("truncate font-display text-[15px]", surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white")}>
                {agent.name}
              </p>
            </div>
            <p className={cn("mt-1 truncate text-[11px]", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}>
              Direct agent chat · {agent.modelId}
            </p>
          </div>
          <div
            className={cn(
              "inline-flex items-center gap-2 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.18em]",
              surfaceTheme === "light"
                ? "border-[#e3d4c8] bg-[#f5ebe3] text-[#6c5647]"
                : "border-white/[0.08] bg-white/[0.04] text-slate-300"
            )}
          >
            <span className={cn("h-1.5 w-1.5 rounded-full", dotTone)} />
            {agent.status}
          </div>
        </div>
      </div>

      <div
        ref={listRef}
        className={cn(
          "mission-scroll mt-3 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1",
          surfaceTheme === "light" ? "text-[#4a382c]" : "text-slate-200"
        )}
      >
        <div className="space-y-2.5">
          {uiMessages.map((entry) => {
            const isUser = entry.role === "user";
            const isSystem = entry.role === "system";
            return (
              <div key={entry.id} className={cn("flex", isUser ? "justify-end" : "justify-start")}>
                <div
                  className={cn(
                    "max-w-[92%] rounded-[18px] border px-3 py-2 text-[13px] leading-5 shadow-[0_14px_34px_rgba(0,0,0,0.14)]",
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
                  <p className="whitespace-pre-wrap">{entry.text}</p>
                  {entry.status === "sending" ? (
                    <p className={cn("mt-1.5 text-[10px] uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-500")}>
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
      </div>

      <div
        className={cn(
          "mt-3 shrink-0 rounded-[20px] border p-3",
          surfaceTheme === "light"
            ? "border-[#e3d4c8] bg-[#fffaf6]"
            : "border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))]"
        )}
      >
        <Textarea
          ref={textareaRef}
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={async (event) => {
            if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
              event.preventDefault();
              await send();
            }
          }}
          placeholder={`Message ${agent.name}...`}
          className={cn(
            "min-h-[72px] resize-none border-0 bg-transparent px-0 py-0 text-[14px] leading-[1.6] shadow-none focus-visible:ring-0 focus-visible:ring-offset-0",
            surfaceTheme === "light"
              ? "text-[#3f2f24] placeholder:text-[#8f7664]"
              : "text-white placeholder:text-slate-500"
          )}
        />

        <div className="mt-2 flex items-center justify-end gap-2">
          <AnimatePresence initial={false}>
            {isSending ? (
              <motion.div
                initial={{ opacity: 0, y: 3 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -3 }}
                className={cn("mr-auto text-[11px]", surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-400")}
              >
                Waiting for agent…
              </motion.div>
            ) : null}
          </AnimatePresence>
          <Button
            disabled={!canSend}
            className={cn(
              "h-9 rounded-full px-3.5 shadow-none",
              surfaceTheme === "light"
                ? "bg-[#4a382c] text-[#fffaf6] hover:bg-[#3f2f24]"
                : "bg-white text-slate-950 hover:bg-white/92"
            )}
            onClick={send}
          >
            {isSending ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <SendHorizontal className="mr-1.5 h-3.5 w-3.5" />}
            Send
          </Button>
        </div>
      </div>
    </div>
  );
}
