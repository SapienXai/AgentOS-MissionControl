"use client";

import { Bot, Sparkles } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";

import { ArchitectReadoutCard } from "@/components/mission-control/workspace-wizard/architect-readout-card";
import { ScrollArea } from "@/components/ui/scroll-area";
import type { WorkspacePlan } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

export type WizardMessageRecord = {
  id: string;
  role: "assistant" | "user" | "system";
  author?: string;
  text: string;
  status?: "ready" | "pending";
};

type WizardMessageListProps = {
  surfaceTheme: SurfaceTheme;
  messages: WizardMessageRecord[];
  architectMessageId?: string | null;
  architectPlan?: WorkspacePlan | null;
  isTyping?: boolean;
  typingLabel?: string;
  emptyState?: ReactNode;
  auxiliary?: ReactNode;
  className?: string;
};

export function WizardMessageList({
  surfaceTheme,
  messages,
  architectMessageId = null,
  architectPlan = null,
  isTyping = false,
  typingLabel = "Typing…",
  emptyState,
  auxiliary,
  className
}: WizardMessageListProps) {
  const endRef = useRef<HTMLDivElement | null>(null);
  const contentRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({
      block: "end"
    });
  }, [architectMessageId, architectPlan?.updatedAt, isTyping, messages.length]);

  useEffect(() => {
    const content = contentRef.current;

    if (!content || typeof ResizeObserver === "undefined") {
      return;
    }

    let frame = 0;
    const scheduleScroll = () => {
      globalThis.cancelAnimationFrame(frame);
      frame = globalThis.requestAnimationFrame(() => {
        endRef.current?.scrollIntoView({
          block: "end"
        });
      });
    };

    const observer = new ResizeObserver(scheduleScroll);
    observer.observe(content);

    return () => {
      observer.disconnect();
      globalThis.cancelAnimationFrame(frame);
    };
  }, []);

  return (
    <ScrollArea className={cn("h-full", className)}>
      <div ref={contentRef} className="mx-auto flex min-h-full w-full max-w-3xl flex-col gap-4 px-2 py-4 md:gap-5 md:px-4">
        {emptyState}
        {auxiliary}

        {messages.map((message) => (
          <MessageBubble
            key={message.id}
            message={message}
            surfaceTheme={surfaceTheme}
            architectMessageId={architectMessageId}
            architectPlan={architectPlan}
          />
        ))}

        {isTyping ? <TypingBubble surfaceTheme={surfaceTheme} label={typingLabel} /> : null}

        <div ref={endRef} className="h-6 w-full shrink-0" />
      </div>
    </ScrollArea>
  );
}

function MessageBubble({
  message,
  surfaceTheme,
  architectMessageId,
  architectPlan
}: {
  message: WizardMessageRecord;
  surfaceTheme: SurfaceTheme;
  architectMessageId: string | null;
  architectPlan: WorkspacePlan | null;
}) {
  const isLight = surfaceTheme === "light";

  if (message.role === "assistant" && architectPlan && message.id === architectMessageId) {
    return (
      <div className="mx-auto w-full max-w-3xl">
        <ArchitectReadoutCard
          key={`${message.id}:${architectPlan.updatedAt}`}
          surfaceTheme={surfaceTheme}
          plan={architectPlan}
          variant="message"
          summaryText={message.text}
        />
      </div>
    );
  }

  if (message.role === "system") {
    return (
      <div
        className={cn(
          "mx-auto w-full max-w-2xl rounded-2xl border px-4 py-3 text-[13px] leading-6",
          isLight
            ? "border-[#e3ddd4] bg-[#f5f0e8] text-[#5b544d]"
            : "border-white/10 bg-white/[0.05] text-slate-300"
        )}
      >
        <p className={cn("text-[11px] uppercase tracking-[0.18em]", isLight ? "text-[#8b8074]" : "text-slate-500")}>
          {message.author || "Workspace Wizard"}
        </p>
        <p className="mt-1">{message.text}</p>
      </div>
    );
  }

  const isUser = message.role === "user";
  const isPending = message.status === "pending";

  return (
    <div
      className={cn(
        "flex w-full items-start gap-2.5",
        isUser ? "justify-end" : "justify-start"
      )}
    >
      {!isUser ? (
        <div
          className={cn(
            "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
            isLight
              ? "border-[#e6dfd4] bg-white text-[#5f5a53]"
              : "border-white/10 bg-white/[0.05] text-slate-300"
          )}
        >
          {message.author === "Architect" ? <Bot className="h-3.5 w-3.5" /> : <Sparkles className="h-3.5 w-3.5" />}
        </div>
      ) : null}

      <div
        className={cn(
          "max-w-[min(100%,680px)]",
          isUser
            ? isLight
              ? "rounded-2xl border border-[#ddd6cb] bg-[#1a1715] px-3 py-2 text-white"
              : "rounded-2xl border border-cyan-200/40 bg-cyan-300 px-3 py-2 text-slate-950"
            : "space-y-1 px-0 py-0",
          isPending && "opacity-75"
        )}
      >
        {!isUser && message.author ? (
          <p className={cn("text-[10px] uppercase tracking-[0.2em]", isLight ? "text-[#8f857a]" : "text-slate-500")}>
            {message.author}
          </p>
        ) : null}
        <p className={cn("whitespace-pre-wrap text-[14px] leading-7", isUser && "leading-6")}>{message.text}</p>
      </div>
    </div>
  );
}

function TypingBubble({
  surfaceTheme,
  label
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="flex w-full items-start gap-2.5">
      <div
        className={cn(
          "mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full border",
          isLight
            ? "border-[#e6dfd4] bg-white text-[#5f5a53]"
            : "border-white/10 bg-white/[0.05] text-slate-300"
        )}
      >
        <Bot className="h-3.5 w-3.5" />
      </div>

      <div className="max-w-[min(100%,680px)]">
        <p className={cn("text-[10px] uppercase tracking-[0.2em]", isLight ? "text-[#8f857a]" : "text-slate-500")}>
          Architect
        </p>
        <div className="mt-1 flex items-center gap-2.5">
          <div
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5",
              isLight ? "border-[#e6dfd5] bg-white text-[#5a534c]" : "border-white/10 bg-white/[0.05] text-slate-300"
            )}
          >
            <span className={cn("inline-flex size-1.5 animate-pulse rounded-full", isLight ? "bg-[#5a534c]" : "bg-slate-300")} />
            <span className={cn("inline-flex size-1.5 animate-pulse rounded-full [animation-delay:120ms]", isLight ? "bg-[#5a534c]" : "bg-slate-300")} />
            <span className={cn("inline-flex size-1.5 animate-pulse rounded-full [animation-delay:240ms]", isLight ? "bg-[#5a534c]" : "bg-slate-300")} />
          </div>
          <p className={cn("text-[12px] leading-5", isLight ? "text-[#6f685f]" : "text-slate-400")}>{label}</p>
        </div>
      </div>
    </div>
  );
}
