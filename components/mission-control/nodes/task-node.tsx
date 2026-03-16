"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Copy, CornerDownLeft, EyeOff, FolderOpenDot, Lock, LockOpen, MoreHorizontal, Rows3, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { TaskNodeData } from "@/components/mission-control/canvas-types";
import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { badgeVariantForRuntimeStatus, formatTokens, toneForRuntimeStatus } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type TaskFlowNode = Node<TaskNodeData, "task">;

export function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  const tone = toneForRuntimeStatus(data.task.status);
  const bootstrapStage =
    typeof data.task.metadata.bootstrapStage === "string" ? data.task.metadata.bootstrapStage : null;
  const dispatchSubmittedAt =
    typeof data.task.metadata.dispatchSubmittedAt === "string"
      ? data.task.metadata.dispatchSubmittedAt
      : null;
  const isPendingCreation = Boolean(data.pendingCreation);
  const isJustCreated = Boolean(data.justCreated);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const badgeVariant = isPendingCreation ? "warning" : badgeVariantForRuntimeStatus(data.task.status);
  const badgeLabel = resolveTaskBadgeLabel(bootstrapStage, data.task.status, isPendingCreation);
  const footerLabel = resolveTaskFooterLabel(bootstrapStage, data.task.liveRunCount);
  const bootstrapElapsedLabel = isPendingCreation ? formatElapsedFromIso(dispatchSubmittedAt) : null;

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
          ? { opacity: 0, scale: 0.92, y: -10 }
          : isJustCreated
            ? { opacity: 0, scale: 0.96, y: 10 }
            : { opacity: 0, x: 10 }
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
        "relative w-[272px] overflow-hidden rounded-[20px] border border-white/[0.1] bg-[linear-gradient(180deg,rgba(15,24,40,0.96),rgba(8,13,24,0.96))] p-3.5 shadow-[0_18px_36px_rgba(0,0,0,0.28)] backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-72",
        selected && "border-cyan-300/[0.45] shadow-[0_20px_46px_rgba(34,211,238,0.16)]",
        isPendingCreation && "border-cyan-300/30 shadow-[0_24px_54px_rgba(34,211,238,0.2)]",
        isJustCreated && "border-cyan-200/40 shadow-[0_24px_56px_rgba(125,211,252,0.18)]",
        data.task.status === "completed" &&
          !isPendingCreation &&
          !isJustCreated &&
          "border-white/[0.06] bg-[linear-gradient(180deg,rgba(13,18,30,0.9),rgba(8,12,22,0.9))]"
      )}
    >
      {isPendingCreation ? (
        <motion.div
          className="pointer-events-none absolute inset-[-16px] rounded-[24px] border border-cyan-200/16"
          animate={{ opacity: [0.18, 0.42, 0.18], scale: [0.985, 1.02, 0.985] }}
          transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
      ) : null}

      <Handle
        type="target"
        id="target-left"
        position={Position.Left}
        className="!h-2.5 !w-2.5 !border-0 !bg-white/35"
      />

      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.22em] text-slate-500">
            <StatusDot
              tone={
                isPendingCreation
                  ? "bg-cyan-300"
                  : data.task.status === "stalled"
                    ? "bg-amber-200"
                    : data.task.status === "completed"
                      ? "bg-emerald-300"
                      : data.task.status === "running"
                        ? "bg-cyan-300"
                      : "bg-amber-200"
              }
            />
            {isPendingCreation ? "Task bootstrap" : "Task"}
          </div>
          <p className="mt-1.5 line-clamp-2 font-display text-[1rem] leading-5 text-white">{data.task.title}</p>
          <p className="mt-1 truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {data.task.primaryAgentName || "OpenClaw"}
          </p>
        </div>

        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="Task actions"
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
              className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-[148px] rounded-[14px] border border-white/[0.1] bg-slate-950/96 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <TaskMenuButton
                icon={CornerDownLeft}
                label="Use prompt"
                onClick={() => {
                  data.onReply?.(data.task);
                  setMenuOpen(false);
                }}
              />
              <TaskMenuButton
                icon={Copy}
                label="Copy mission"
                onClick={() => {
                  data.onCopyPrompt?.(data.task);
                  setMenuOpen(false);
                }}
              />
              <TaskMenuButton
                icon={EyeOff}
                label="Hide"
                onClick={() => {
                  data.onHide?.(data.task);
                  setMenuOpen(false);
                }}
              />
              <TaskMenuButton
                icon={data.locked ? LockOpen : Lock}
                label={data.locked ? "Unlock" : "Lock"}
                onClick={() => {
                  data.onToggleLock?.(data.task);
                  setMenuOpen(false);
                }}
              />
            </div>
          ) : null}
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Badge variant={badgeVariant}>{badgeLabel}</Badge>
        {isJustCreated ? (
          <Badge variant="default" className="gap-1 border-cyan-100/20 bg-cyan-100/12 text-cyan-50">
            <Sparkles className="h-3 w-3" />
            new
          </Badge>
        ) : null}
        <span className={cn("text-[9px] uppercase tracking-[0.18em]", tone)}>
          {formatTokens(data.task.tokenUsage?.total)} tokens
        </span>
      </div>

      <div className="mt-3 rounded-[16px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
        <p className="line-clamp-2 text-[12.5px] leading-5 text-slate-100">{data.task.subtitle}</p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <TaskSectionStat icon={Rows3} label="Feed" value={String(data.task.updateCount)} />
        <TaskSectionStat icon={FolderOpenDot} label="Runs" value={String(data.task.runtimeCount)} />
        <TaskSectionStat icon={Sparkles} label="Files" value={String(data.task.artifactCount)} />
      </div>

      <div className="mt-3 border-t border-white/[0.08] pt-2.5">
        <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500">
          {isPendingCreation
            ? [footerLabel, bootstrapElapsedLabel ? `${bootstrapElapsedLabel} elapsed` : null]
                .filter(Boolean)
                .join(" · ")
            : footerLabel}
        </p>
      </div>
    </motion.div>
  );
}

function resolveTaskBadgeLabel(
  bootstrapStage: string | null,
  status: TaskFlowNode["data"]["task"]["status"],
  isPendingCreation: boolean
) {
  if (!isPendingCreation || !bootstrapStage) {
    return status;
  }

  switch (bootstrapStage) {
    case "submitting":
      return "submitting";
    case "accepted":
      return "accepted";
    case "waiting-for-heartbeat":
      return "starting runner";
    case "waiting-for-runtime":
      return "awaiting runtime";
    case "runtime-observed":
      return "going live";
    case "stalled":
      return "stalled";
    case "completed":
      return "completed";
    default:
      return status;
  }
}

function resolveTaskFooterLabel(bootstrapStage: string | null, liveRunCount: number) {
  switch (bootstrapStage) {
    case "submitting":
      return "contacting dispatcher";
    case "accepted":
      return "dispatch accepted";
    case "waiting-for-heartbeat":
      return "waiting for first heartbeat";
    case "waiting-for-runtime":
      return "waiting for first OpenClaw runtime";
    case "runtime-observed":
      return "runtime observed · inspect feed";
    case "stalled":
      return "dispatch stalled · inspect feed";
    default:
      return `${liveRunCount} live run${liveRunCount === 1 ? "" : "s"} · inspect feed`;
  }
}

function formatElapsedFromIso(value: string | null) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  const elapsedMs = Math.max(Date.now() - timestamp, 0);
  const seconds = Math.floor(elapsedMs / 1000);

  if (seconds < 60) {
    return `${seconds}s`;
  }

  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  return remainingSeconds === 0 ? `${minutes}m` : `${minutes}m ${remainingSeconds}s`;
}

function TaskSectionStat({
  icon: Icon,
  label,
  value
}: {
  icon: typeof Rows3;
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-2.5 py-2">
      <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-500">
        <Icon className="h-3 w-3" />
        {label}
      </div>
      <p className="mt-1.5 text-[13px] text-white">{value}</p>
    </div>
  );
}

function TaskMenuButton({
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
