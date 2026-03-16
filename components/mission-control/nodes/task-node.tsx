"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import { Copy, CornerDownLeft, EyeOff, FolderOpenDot, Lock, LockOpen, MoreHorizontal, Rows3, Sparkles, ChevronDown, ChevronUp } from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { TaskNodeData } from "@/components/mission-control/canvas-types";
import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTaskFeed } from "@/hooks/use-task-feed";
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
  
  const optimisticEvents = Array.isArray(data.task.metadata.optimisticEvents) 
    ? data.task.metadata.optimisticEvents 
    : [];
  const latestOptimisticEvent = optimisticEvents.length > 0 
    ? (optimisticEvents[optimisticEvents.length - 1] as any) 
    : null;
  const bootstrapElapsedLabel = isPendingCreation ? formatElapsedFromIso(dispatchSubmittedAt) : null;
  const [expanded, setExpanded] = useState(false);
  const { feed, loading } = useTaskFeed(data.task.id, expanded);

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

      <div
        className={cn(
          "mt-3 border-t border-white/[0.08] pt-2.5 transition-colors cursor-pointer group",
          expanded && "pb-1"
        )}
        onClick={(e) => {
          e.stopPropagation();
          setExpanded((prev) => !prev);
        }}
      >
        <div className="flex items-center justify-between">
          <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500 group-hover:text-slate-400 transition-colors">
            {feed.length > 0
              ? feed[feed.length - 1].title
              : latestOptimisticEvent?.title
              ? latestOptimisticEvent.title
              : isPendingCreation
                  ? [footerLabel, bootstrapElapsedLabel ? `${bootstrapElapsedLabel} elapsed` : null]
                      .filter(Boolean)
                      .join(" · ")
                  : footerLabel}
          </p>
          {expanded ? (
            <ChevronUp className="h-3 w-3 text-slate-500" />
          ) : (
            <ChevronDown className="h-3 w-3 text-slate-500 opacity-0 group-hover:opacity-100 transition-opacity" />
          )}
        </div>

        {expanded && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden nowheel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pt-3">
              <ScrollArea className="h-[180px] w-full pr-3">
                {loading && feed.length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-slate-500">
                    Connecting to feed...
                  </div>
                ) : feed.length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-slate-500">No events yet.</div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {feed.map((event) => (
                      <div key={event.id} className="group/item relative pl-3">
                        <div
                          className={cn(
                            "absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full",
                            resolveFeedEventColor(event.kind, event.isError)
                          )}
                        />
                        <div className="flex items-baseline justify-between gap-2">
                          <span className="text-[10px] font-medium text-slate-300">
                            {event.title}
                          </span>
                          <span className="shrink-0 text-[9px] text-slate-600">
                            {formatTimeOnly(event.timestamp)}
                          </span>
                        </div>
                        <p className="mt-0.5 text-[10px] leading-relaxed text-slate-400 group-hover/item:text-slate-300">
                          {event.detail}
                        </p>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
          </motion.div>
        )}
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
      <div className="mt-1 font-mono text-[11px] text-slate-300">{value}</div>
    </div>
  );
}

function resolveFeedEventColor(kind: string, isError?: boolean) {
  if (isError) return "bg-red-400";
  switch (kind) {
    case "status":
      return "bg-slate-400";
    case "assistant":
      return "bg-cyan-400";
    case "tool":
      return "bg-indigo-400";
    case "artifact":
      return "bg-emerald-400";
    case "warning":
      return "bg-amber-400";
    case "user":
      return "bg-pink-400";
    default:
      return "bg-slate-500";
  }
}

function formatTimeOnly(iso: string) {
  try {
    const date = new Date(iso);
    return date.toLocaleTimeString("en-US", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false
    });
  } catch {
    return "";
  }
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
