"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { LoaderCircle, SendHorizontal } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import { MISSION_CONTROL_ACTION_TAG } from "@/lib/openclaw/chat-actions";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot, MissionResponse, OpenClawAgent } from "@/lib/openclaw/types";
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

function buildAgentChatPrompt(
  history: ChatMessage[],
  message: string,
  options: {
    agentName: string;
    agentDir?: string;
    workspacePath?: string;
  }
) {
  const turns = history
    .filter((entry) => entry.role === "user" || entry.role === "assistant")
    .slice(-8)
    .map((entry) => `${entry.role === "user" ? "Operator" : "Agent"}: ${entry.text.trim()}`)
    .join("\n");

  const trimmed = message.trim();
  const instructions = [
    "You are chatting directly with the operator inside Mission Control. Reply conversationally, be concise, and ask a clarifying question when needed. Do not create tasks or mention task cards."
  ];

  if (options.agentDir) {
    instructions.push(
      `Your agent-specific identity file is ${options.agentDir}/IDENTITY.md. If the operator renames you or asks about your identity file, use that path.`
    );
  }

  if (options.workspacePath) {
    instructions.push(
      `Do not treat ${options.workspacePath}/IDENTITY.md as your personal identity file unless the operator explicitly asks for a workspace-wide identity change.`
    );
    instructions.push(
      `Do not update ${options.workspacePath}/MEMORY.md for a self-rename unless the operator explicitly asks to store that as workspace memory.`
    );
  }

  instructions.push(
    `Mission Control applies self-renames through a structured action, not by having you edit files yourself. If the operator asks to rename you or set your display name, reply normally and append exactly one action block on its own line using this format: <${MISSION_CONTROL_ACTION_TAG}>{"type":"rename_agent","name":"New Name"}</${MISSION_CONTROL_ACTION_TAG}>.`
  );
  instructions.push(
    "Only emit that action block for an actual rename request. Do not emit it for questions about your current name, hypothetical questions about rename mechanics, or identity discussions that do not request a change."
  );

  if (options.agentDir) {
    instructions.push(
      `If the operator asks which path would be updated, explain that Mission Control applies the rename centrally and then syncs ${options.agentDir}/IDENTITY.md.`
    );
  }

  instructions.push(`Your current display name in Mission Control is ${options.agentName}.`);
  const prefix = `${instructions.join("\n")}\n`;

  return turns
    ? `${prefix}\nConversation so far:\n${turns}\n\nOperator: ${trimmed}`
    : `${prefix}\nOperator: ${trimmed}`;
}

function tokenizeReply(text: string) {
  return text.match(/\S+|\s+/g) ?? [];
}

function getTypingDelay(token: string) {
  if (/^\s+$/.test(token)) return 14;
  if (/[.!?]$/.test(token)) return 140;
  if (/[,:;]$/.test(token)) return 80;
  return Math.min(80, 26 + token.length * 4);
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
  surfaceTheme: "dark" | "light";
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
}) {
  const [draft, setDraft] = useState("");
  const [isSending, setIsSending] = useState(false);
  const [isAgentTyping, setIsAgentTyping] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [revealingMessageId, setRevealingMessageId] = useState<string | null>(null);
  const [revealedText, setRevealedText] = useState("");
  const listRef = useRef<HTMLDivElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const revealTimerRef = useRef<ReturnType<typeof globalThis.setTimeout> | null>(null);
  const agentLabel = formatAgentDisplayName(agent);

  const clearRevealTimer = () => {
    if (revealTimerRef.current !== null) {
      globalThis.clearTimeout(revealTimerRef.current);
      revealTimerRef.current = null;
    }
  };

  const startAssistantReveal = (messageId: string, text: string) => {
    clearRevealTimer();

    const tokens = tokenizeReply(text.trim());
    if (tokens.length === 0) {
      setRevealingMessageId(null);
      setRevealedText("");
      return;
    }

    const firstToken = tokens[0];
    if (!firstToken) {
      setRevealingMessageId(null);
      setRevealedText("");
      return;
    }

    let index = 1;
    setRevealingMessageId(messageId);
    setRevealedText(firstToken);

    const step = () => {
      if (index >= tokens.length) {
        revealTimerRef.current = globalThis.setTimeout(() => {
          setRevealingMessageId(null);
          setRevealedText("");
          revealTimerRef.current = null;
        }, 220);
        return;
      }

      const nextIndex = index + 1;
      setRevealedText(tokens.slice(0, nextIndex).join(""));
      const currentToken = tokens[index] ?? "";
      const delay = getTypingDelay(currentToken);
      index = nextIndex;
      revealTimerRef.current = globalThis.setTimeout(step, delay);
    };

    revealTimerRef.current = globalThis.setTimeout(step, getTypingDelay(firstToken));
  };

  useEffect(() => {
    clearRevealTimer();
    setMessages(readChat(agent.id));
    setDraft("");
    setIsSending(false);
    setIsAgentTyping(false);
    setRevealingMessageId(null);
    setRevealedText("");
    requestAnimationFrame(() => textareaRef.current?.focus());
    return () => clearRevealTimer();
  }, [agent.id]);

  useEffect(() => {
    if (!listRef.current) return;
    listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [messages.length, agent.id, isAgentTyping, revealedText, revealingMessageId]);

  const canSend = Boolean(draft.trim()) && !isSending && !revealingMessageId;

  const renderMessageText = (entry: ChatMessage) => {
    if (entry.role === "assistant" && entry.id === revealingMessageId) {
      return revealedText;
    }
    return entry.text;
  };

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
    if (!text || isSending || revealingMessageId) return;

    setIsSending(true);
    setIsAgentTyping(true);
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
      message: buildAgentChatPrompt(nextHistory, text, {
        agentName: agentLabel,
        agentDir: agent.agentDir,
        workspacePath: agent.workspacePath
      }),
      rawMessage: text,
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

      const renamedTo = readRenamedAgent(result.meta);

      if (renamedTo && onSnapshotChange) {
        onSnapshotChange((current) => applyAgentRename(current, agent.id, renamedTo));
      }

      setMessages(finalized);
      writeChat(agent.id, finalized);
      setIsSending(false);
      setIsAgentTyping(false);
      startAssistantReveal(assistantMessage.id, assistantMessage.text);
      void onRefresh?.().catch(() => null);
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown send error.";
      toast.error("Chat message failed.", { description: message });

      const finalized: ChatMessage[] = nextHistory
        .map((entry): ChatMessage => (entry.id === userMessage.id ? { ...entry, status: "error" as const } : entry))
        .slice(-maxStoredMessages);
      setMessages(finalized);
      writeChat(agent.id, finalized);
      setIsAgentTyping(false);
    } finally {
      setIsSending(false);
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
            const isActiveAssistant = entry.role === "assistant" && entry.id === revealingMessageId;
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
                  <p className="whitespace-pre-wrap">{renderMessageText(entry)}</p>
                  {isActiveAssistant ? (
                    <motion.span
                      aria-hidden="true"
                      animate={{ opacity: [0.2, 1, 0.2] }}
                      transition={{ duration: 0.9, repeat: Infinity, ease: "easeInOut" }}
                      className="ml-0.5 inline-block h-[1em] w-[1px] translate-y-[2px] bg-current"
                    />
                  ) : null}
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

        <AnimatePresence initial={false}>
          {isAgentTyping ? (
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
                <span className={cn("text-[10px] uppercase tracking-[0.18em]", surfaceTheme === "light" ? "text-[#8b7262]" : "text-slate-400")}>
                  typing
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
            {isSending ? <LoaderCircle className="mr-[5px] h-[13px] w-[13px] animate-spin" /> : <SendHorizontal className="mr-[5px] h-[13px] w-[13px]" />}
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
