"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Copy, CornerDownLeft, EyeOff, MoreHorizontal, TimerReset } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { RuntimeNodeData } from "@/components/mission-control/canvas-types";
import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { formatTokens, shortId, toneForRuntimeStatus } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type RuntimeFlowNode = Node<RuntimeNodeData, "runtime">;
const materializationTiles = Array.from({ length: 24 }, (_, index) => index);

export function RuntimeNode({ data, selected }: NodeProps<RuntimeFlowNode>) {
  const tone = toneForRuntimeStatus(data.runtime.status);
  const runtimeLabel =
    data.runtime.source === "turn"
      ? shortId(data.runtime.runId, 10)
      : shortId(data.runtime.taskId || data.runtime.sessionId);
  const isPendingCreation = Boolean(data.pendingCreation);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const badgeVariant =
    isPendingCreation
      ? "warning"
      : data.runtime.status === "completed"
      ? "success"
      : data.runtime.status === "error"
        ? "danger"
        : data.runtime.status === "active"
          ? "default"
          : "warning";

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
      layout
      initial={isPendingCreation ? { opacity: 0, scale: 0.94, x: 12 } : { opacity: 0, x: 8 }}
      animate={isPendingCreation ? { opacity: 1, scale: 1, x: 0 } : { opacity: 1, x: 0 }}
      className={cn(
        "relative w-[212px] overflow-hidden rounded-[16px] border border-white/[0.1] bg-[linear-gradient(180deg,rgba(15,24,40,0.94),rgba(8,13,24,0.94))] px-3 py-2.5 shadow-[0_16px_28px_rgba(0,0,0,0.26)] backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-72",
        selected && "border-cyan-300/[0.45] shadow-[0_18px_42px_rgba(34,211,238,0.16)]",
        isPendingCreation && "border-cyan-300/20 bg-[linear-gradient(180deg,rgba(16,30,52,0.96),rgba(8,16,30,0.96))] shadow-[0_20px_48px_rgba(34,211,238,0.14)]"
      )}
    >
      {isPendingCreation ? (
        <>
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(56,189,248,0.18),transparent_45%),linear-gradient(180deg,rgba(15,23,42,0.14),rgba(15,23,42,0))]" />
          <div className="pointer-events-none absolute inset-0 grid grid-cols-6 gap-1 px-2.5 py-2">
            {materializationTiles.map((tile) => (
              <motion.span
                key={tile}
                className="rounded-[4px] bg-cyan-300/18"
                initial={{ opacity: 0, scale: 0.65 }}
                animate={{ opacity: [0.12, 0.7, 0.2], scale: [0.75, 1, 0.84] }}
                transition={{
                  duration: 1.1,
                  repeat: Number.POSITIVE_INFINITY,
                  repeatType: "mirror",
                  delay: tile * 0.035
                }}
              />
            ))}
          </div>
          <motion.div
            className="pointer-events-none absolute inset-y-0 left-[-20%] w-[34%] bg-[linear-gradient(90deg,transparent,rgba(125,211,252,0.26),transparent)] blur-lg"
            animate={{ x: ["0%", "320%"] }}
            transition={{ duration: 1.6, repeat: Number.POSITIVE_INFINITY, ease: "linear" }}
          />
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
                  : data.runtime.status === "completed"
                    ? "bg-emerald-300"
                    : data.runtime.status === "active"
                      ? "bg-cyan-300"
                      : "bg-amber-200"
              }
            />
            {isPendingCreation ? "Run spawning" : data.runtime.source === "turn" ? "Run" : "Task / Run"}
          </div>
          <p className="mt-1.5 truncate font-display text-[0.95rem] text-white">{data.runtime.title}</p>
          <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">{runtimeLabel}</p>
        </div>

        {isPendingCreation ? (
          <div className="rounded-full border border-white/[0.08] bg-white/[0.05] p-1.5 text-slate-300">
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
        <span className={cn("text-[9px] uppercase tracking-[0.18em]", tone)}>{formatTokens(data.runtime.tokenUsage?.total)} tokens</span>
      </div>

      <div className="relative mt-2.5 border-t border-white/[0.08] pt-2.5">
        <p className="text-[12px] leading-4 text-slate-100">{data.runtime.subtitle}</p>
        <p className="mt-1.5 text-[9px] uppercase tracking-[0.2em] text-slate-500">
          {isPendingCreation
            ? "Syncing with gateway"
            : data.runtime.ageMs
              ? `${Math.round(data.runtime.ageMs / 60000)}m active`
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
