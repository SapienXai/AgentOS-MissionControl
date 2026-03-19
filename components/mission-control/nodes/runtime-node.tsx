"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Copy, CornerDownLeft, EyeOff, MoreHorizontal, Sparkles, TimerReset } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { RuntimeNodeData } from "@/components/mission-control/canvas-types";
import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { badgeVariantForRuntimeStatus, formatTokens, shortId, toneForRuntimeStatus } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type RuntimeFlowNode = Node<RuntimeNodeData, "runtime">;

export function RuntimeNode({ data, selected }: NodeProps<RuntimeFlowNode>) {
  const tone = toneForRuntimeStatus(data.runtime.status);
  const runtimeLabel =
    data.runtime.source === "turn"
      ? shortId(data.runtime.runId || data.runtime.id, 10)
      : shortId(data.runtime.taskId || data.runtime.sessionId);
  const isPendingCreation = Boolean(data.pendingCreation);
  const isJustCreated = Boolean(data.justCreated);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const badgeVariant = isPendingCreation ? "warning" : badgeVariantForRuntimeStatus(data.runtime.status);

  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as globalThis.Node)) {
        setMenuOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [menuOpen]);

  return (
    <motion.div
      initial={
        isPendingCreation
          ? { opacity: 0, scale: 0.9, y: -10 }
          : isJustCreated
            ? { opacity: 0, scale: 0.95, y: 10 }
            : { opacity: 0, x: 8 }
      }
      animate={
        isPendingCreation
          ? { opacity: 1, scale: 1, y: 0 }
          : isJustCreated
            ? { opacity: 1, scale: [1, 1.015, 1], y: 0 }
            : { opacity: 1, x: 0 }
      }
      transition={
        isJustCreated
          ? {
              duration: 0.7,
              times: [0, 0.45, 1]
            }
          : undefined
      }
      className={cn(
        "relative w-[212px] overflow-hidden rounded-[16px] border border-white/[0.1] bg-[linear-gradient(180deg,rgba(15,24,40,0.94),rgba(8,13,24,0.94))] px-3 py-2.5 shadow-[0_16px_28px_rgba(0,0,0,0.26)] backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-72",
        selected && "border-cyan-300/[0.45] shadow-[0_18px_42px_rgba(34,211,238,0.16)]",
        isPendingCreation && "border-cyan-300/30 bg-[linear-gradient(180deg,rgba(17,31,52,0.98),rgba(8,16,30,0.98))] shadow-[0_24px_54px_rgba(34,211,238,0.22)]",
        isJustCreated &&
          "border-cyan-200/40 bg-[linear-gradient(180deg,rgba(20,28,43,0.98),rgba(10,15,28,0.98))] shadow-[0_22px_52px_rgba(125,211,252,0.18)]",
        data.runtime.status === "cancelled" &&
          "border-rose-300/30 bg-[linear-gradient(180deg,rgba(43,14,19,0.96),rgba(19,8,12,0.96))] shadow-[0_22px_52px_rgba(244,63,94,0.14)]",
        data.runtime.status === "completed" &&
          !isPendingCreation &&
          !isJustCreated &&
          "border-white/[0.06] bg-[linear-gradient(180deg,rgba(13,18,30,0.88),rgba(8,12,22,0.88))] opacity-[0.86]"
      )}
    >
      {isPendingCreation ? (
        <>
          <motion.div
            className="pointer-events-none absolute inset-[-18px] rounded-[24px] border border-cyan-200/18"
            animate={{ opacity: [0.18, 0.42, 0.18], scale: [0.98, 1.03, 0.98] }}
            transition={{ duration: 1.7, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(125,211,252,0.22),transparent_44%),linear-gradient(180deg,rgba(15,23,42,0.18),rgba(15,23,42,0))]" />
          <motion.div
            className="pointer-events-none absolute left-[-28%] top-0 h-px w-[44%] bg-[linear-gradient(90deg,transparent,rgba(186,230,253,0.85),transparent)] blur-[1px]"
            animate={{ x: ["0%", "320%"] }}
            transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
          />
        </>
      ) : null}

      {isJustCreated ? (
        <>
          <motion.div
            className="pointer-events-none absolute inset-[-14px] rounded-[22px] border border-cyan-100/16"
            animate={{ opacity: [0.1, 0.34, 0.1], scale: [0.985, 1.02, 0.985] }}
            transition={{ duration: 2.2, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
          />
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top,rgba(186,230,253,0.18),transparent_36%)]" />
        </>
      ) : null}

      <Handle
        type="target"
        id="target-left"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-0 !bg-white/35"
      />

      <div className="relative flex items-start justify-between gap-2.5">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.22em] text-slate-500">
            <StatusDot
              tone={
                isPendingCreation
                  ? "bg-cyan-300"
                  : data.runtime.status === "cancelled"
                    ? "bg-rose-300"
                  : data.runtime.status === "stalled"
                    ? "bg-amber-200"
                  : data.runtime.status === "completed"
                    ? "bg-emerald-300"
                    : data.runtime.status === "running"
                      ? "bg-cyan-300"
                      : "bg-amber-200"
              }
            />
            {isPendingCreation ? "Creating task" : data.runtime.source === "turn" ? "Run" : "Task / Run"}
          </div>
          <p className="mt-1.5 truncate font-display text-[0.95rem] text-white">{data.runtime.title}</p>
          <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">{runtimeLabel}</p>
        </div>

        {isPendingCreation ? (
          <div className="rounded-full border border-cyan-200/16 bg-cyan-100/8 p-1.5 text-cyan-100">
            <TimerReset className="h-3 w-3" />
          </div>
        ) : (
          <div className="relative" ref={menuRef}>
            <button
              type="button"
              aria-label="Run actions"
              onClick={(event) => {
                event.stopPropagation();
                setMenuOpen((current) => !current);
              }}
              onPointerDown={(event) => event.stopPropagation()}
              className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.05] p-1.5 text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white"
            >
              <MoreHorizontal className="h-3 w-3" />
            </button>

            {menuOpen ? (
              <div
                className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-[136px] rounded-[14px] border border-white/[0.1] bg-slate-950/96 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl"
                onClick={(event) => event.stopPropagation()}
                onPointerDown={(event) => event.stopPropagation()}
              >
                <RuntimeMenuButton
                  icon={CornerDownLeft}
                  label="Reply"
                  onClick={() => {
                    data.onReply?.(data.runtime);
                    setMenuOpen(false);
                  }}
                />
                <RuntimeMenuButton
                  icon={Copy}
                  label="Copy prompt"
                  onClick={() => {
                    data.onCopyPrompt?.(data.runtime);
                    setMenuOpen(false);
                  }}
                />
                <RuntimeMenuButton
                  icon={EyeOff}
                  label="Hide"
                  onClick={() => {
                    data.onHide?.(data.runtime.id);
                    setMenuOpen(false);
                  }}
                />
              </div>
            ) : null}
          </div>
        )}
      </div>

      <div className="relative mt-2.5 flex flex-wrap items-center gap-1.5">
        <Badge variant={badgeVariant}>{isPendingCreation ? "materializing" : data.runtime.status}</Badge>
        {isJustCreated ? (
          <Badge variant="default" className="gap-1 border-cyan-100/20 bg-cyan-100/12 text-cyan-50">
            <Sparkles className="h-3 w-3" />
            new
          </Badge>
        ) : null}
        <span className={cn("text-[9px] uppercase tracking-[0.18em]", tone)}>{formatTokens(data.runtime.tokenUsage?.total)} tokens</span>
      </div>

      <div className="relative mt-2.5 border-t border-white/[0.08] pt-2.5">
        <p className="text-[12px] leading-4 text-slate-100">{data.runtime.subtitle}</p>
        <p className="mt-1.5 text-[9px] uppercase tracking-[0.2em] text-slate-500">
          {isPendingCreation
            ? "Launching on the canvas"
            : isJustCreated
              ? "Just created"
            : data.runtime.ageMs
              ? `${Math.round(data.runtime.ageMs / 60000)}m ${data.runtime.status}`
              : "live"}
        </p>
      </div>
    </motion.div>
  );
}

function RuntimeMenuButton({
  icon: Icon,
  label,
  onClick
}: {
  icon: typeof MoreHorizontal;
  label: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      className="flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[11px] text-slate-200 transition-colors hover:bg-white/[0.06] hover:text-white"
      onClick={onClick}
    >
      <Icon className="h-3.5 w-3.5 text-cyan-300" />
      <span>{label}</span>
    </button>
  );
}
