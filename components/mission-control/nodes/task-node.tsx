"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Ban,
  ChevronDown,
  ChevronUp,
  Copy,
  CornerDownLeft,
  EyeOff,
  FolderOpenDot,
  Lock,
  LockOpen,
  MoreHorizontal,
  Rows3,
  Sparkles
} from "lucide-react";
import { motion } from "motion/react";
import { useEffect, useRef, useState } from "react";

import type { TaskNodeData } from "@/components/mission-control/canvas-types";
import { InteractiveContent } from "@/components/mission-control/interactive-content";
import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTaskFeed } from "@/hooks/use-task-feed";
import type { TaskFeedEvent } from "@/lib/openclaw/types";
import {
  badgeVariantForRuntimeStatus,
  compactMissionText,
  formatTokens,
  toneForRuntimeStatus
} from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type TaskFlowNode = Node<TaskNodeData, "task">;

export function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  const bootstrapStage =
    typeof data.task.metadata.bootstrapStage === "string" ? data.task.metadata.bootstrapStage : null;
  const dispatchSubmittedAt =
    typeof data.task.metadata.dispatchSubmittedAt === "string"
      ? data.task.metadata.dispatchSubmittedAt
      : null;
  const isPendingCreation = Boolean(data.pendingCreation);
  const isJustCreated = Boolean(data.justCreated);
  const isAborted = isTaskAborted(data.task);
  const isAbortable = isTaskAbortable(data.task);
  const tone = isAborted ? "text-rose-200" : toneForRuntimeStatus(data.task.status);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const badgeVariant = isPendingCreation
    ? "warning"
    : isAborted
      ? "danger"
      : badgeVariantForRuntimeStatus(data.task.status);
  const badgeLabel = resolveTaskBadgeLabel(bootstrapStage, data.task.status, isPendingCreation, isAborted);
  const footerLabel = resolveTaskFooterLabel(bootstrapStage, data.task.liveRunCount, isAborted);
  
  const optimisticEvents = Array.isArray(data.task.metadata.optimisticEvents) 
    ? data.task.metadata.optimisticEvents 
    : [];
  const latestOptimisticEvent =
    optimisticEvents.length > 0 && isTaskFeedEvent(optimisticEvents[optimisticEvents.length - 1])
      ? optimisticEvents[optimisticEvents.length - 1]
      : null;
  const bootstrapElapsedLabel = isPendingCreation ? formatElapsedFromIso(dispatchSubmittedAt) : null;
  const [expanded, setExpanded] = useState(false);
  const { feed, loading, error } = useTaskFeed(data.task.id, expanded);
  const latestFeedEvent = feed[feed.length - 1] ?? latestOptimisticEvent ?? null;
  const activityLabel = latestFeedEvent?.title || footerLabel;
  const activitySummary =
    compactMissionText(latestFeedEvent?.detail, 88) ||
    (isPendingCreation
      ? [footerLabel, bootstrapElapsedLabel ? `${bootstrapElapsedLabel} elapsed` : null].filter(Boolean).join(" · ")
      : compactMissionText(data.task.subtitle, 72) || footerLabel);
  const feedButtonCount = feed.length > 0 ? String(feed.length) : undefined;
  const feedPanelId = `task-feed-${data.task.id}`;

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
        isAborted && "border-rose-300/30 shadow-[0_24px_54px_rgba(244,63,94,0.14)]",
        data.task.status === "completed" &&
          !isAborted &&
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
                  : isAborted
                    ? "bg-rose-200"
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
          <p className="mt-1.5 line-clamp-1 font-display text-[0.98rem] leading-5 text-white">
            {compactMissionText(data.task.title || data.task.mission, 44) || data.task.title}
          </p>
          <p className="mt-1 truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
            {data.task.primaryAgentName || "OpenClaw"}
          </p>
        </div>

        <div className="nodrag nopan relative" ref={menuRef}>
          <button
            type="button"
            aria-label="Task actions"
            onClick={(event) => {
              event.stopPropagation();
              setMenuOpen((current) => !current);
            }}
            onPointerDown={(event) => event.stopPropagation()}
            className="nodrag nopan inline-flex rounded-full border border-white/[0.08] bg-white/[0.05] p-1.5 text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white"
          >
            <MoreHorizontal className="h-3 w-3" />
          </button>

          {menuOpen ? (
            <div
              className="nodrag nopan absolute right-0 top-[calc(100%+8px)] z-30 min-w-[148px] rounded-[14px] border border-white/[0.1] bg-slate-950/96 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl"
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
              {data.onAbortTask && (isAbortable || isAborted) ? (
                <TaskMenuButton
                  icon={Ban}
                  label={isAborted ? "Aborted" : "Abort task"}
                  destructive
                  disabled={!isAbortable}
                  onClick={() => {
                    if (!isAbortable) {
                      return;
                    }

                    data.onAbortTask?.(data.task);
                    setMenuOpen(false);
                  }}
                />
              ) : null}
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
        {data.task.warningCount > 0 ? (
          <Badge variant="warning">
            {data.task.warningCount} review{data.task.warningCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
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
        <p className="line-clamp-1 text-[12.5px] leading-5 text-slate-100">
          {compactMissionText(data.task.subtitle, 72) || data.task.subtitle}
        </p>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5">
        <TaskQuickAction
          icon={Rows3}
          label="Feed"
          value={feedButtonCount}
          active={expanded}
          onClick={() => {
            if (data.onInspect) {
              data.onInspect(data.task, "output");
              return;
            }

            setExpanded((current) => !current);
          }}
        />
        <TaskQuickAction
          icon={FolderOpenDot}
          label="Runs"
          value={String(data.task.runtimeCount)}
          onClick={() => data.onInspect?.(data.task, "overview")}
        />
        <TaskQuickAction
          icon={Sparkles}
          label="Files"
          value={String(data.task.artifactCount)}
          onClick={() => data.onInspect?.(data.task, "files")}
        />
      </div>

      <div className={cn("mt-3 border-t border-white/[0.08] pt-2.5", expanded && "pb-1")}>
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={feedPanelId}
          className="nodrag nopan group flex w-full items-start justify-between gap-3 rounded-[14px] border border-transparent px-1 py-1.5 text-left transition-colors hover:border-white/[0.06] hover:bg-white/[0.02]"
          onClick={(event) => {
            event.stopPropagation();
            setExpanded((current) => !current);
          }}
          onPointerDown={(event) => event.stopPropagation()}
        >
          <div className="min-w-0">
            <p className="text-[9px] uppercase tracking-[0.2em] text-slate-500 transition-colors group-hover:text-slate-400">
              Live feed
            </p>
            <p className="mt-1 truncate text-[10px] text-slate-300">{activityLabel}</p>
            <p className="mt-1 truncate text-[10px] text-slate-500">{activitySummary}</p>
          </div>
          <div className="mt-0.5 shrink-0 rounded-full border border-white/[0.08] bg-white/[0.04] p-1 text-slate-400 transition-colors group-hover:border-white/[0.12] group-hover:text-slate-200">
            {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
          </div>
        </button>

        {expanded && (
          <motion.div
            id={feedPanelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="nodrag nopan overflow-hidden nowheel"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="pt-2.5">
              <ScrollArea className="h-[164px] w-full pr-3">
                {loading && feed.length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-slate-500">
                    Connecting to feed...
                  </div>
                ) : error && feed.length === 0 ? (
                  <div className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[10px] leading-5 text-amber-100">
                    {error}
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
                        <div className="mt-0.5">
                          <InteractiveContent
                            text={event.detail}
                            className="text-[10px] leading-relaxed text-slate-400 group-hover/item:text-slate-300"
                            url={"url" in event ? event.url : null}
                            filePath={"filePath" in event ? event.filePath : null}
                            displayPath={"displayPath" in event ? event.displayPath : null}
                            compact
                          />
                        </div>
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
  isPendingCreation: boolean,
  isAborted: boolean
) {
  if (isAborted) {
    return "aborted";
  }

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

function resolveTaskFooterLabel(bootstrapStage: string | null, liveRunCount: number, isAborted: boolean) {
  if (isAborted) {
    return "dispatch aborted";
  }

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
      return "runtime observed";
    case "stalled":
      return "dispatch stalled";
    default:
      return liveRunCount > 0 ? `${liveRunCount} live run${liveRunCount === 1 ? "" : "s"}` : "no live runs right now";
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

function TaskQuickAction({
  icon: Icon,
  label,
  value,
  active = false,
  onClick
}: {
  icon: typeof Rows3;
  label: string;
  value?: string;
  active?: boolean;
  onClick?: () => void;
}) {
  return (
    <button
      type="button"
      className={cn(
        "nodrag nopan flex min-h-[38px] w-full items-center justify-between rounded-[12px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-2.5 py-1.5 text-left transition-colors hover:border-cyan-300/20 hover:bg-cyan-400/[0.06]",
        active && "border-cyan-300/30 bg-cyan-400/[0.08]"
      )}
      onClick={(event) => {
        event.stopPropagation();
        onClick?.();
      }}
      onPointerDown={(event) => event.stopPropagation()}
    >
      <div className="flex min-w-0 items-center gap-1.5 text-[9px] uppercase tracking-[0.16em] text-slate-400">
        <Icon className="h-3 w-3 shrink-0" />
        <span className="truncate">{label}</span>
      </div>
      {value ? <span className="ml-2 shrink-0 font-mono text-[10px] text-slate-200">{value}</span> : null}
    </button>
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

function isTaskFeedEvent(value: unknown): value is TaskFeedEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as TaskFeedEvent).id === "string" &&
    typeof (value as TaskFeedEvent).title === "string" &&
    typeof (value as TaskFeedEvent).detail === "string"
  );
}

function TaskMenuButton({
  icon: Icon,
  label,
  destructive = false,
  disabled = false,
  onClick
}: {
  icon: typeof MoreHorizontal;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      className={cn(
        "nodrag nopan flex w-full items-center gap-2 rounded-[10px] px-2.5 py-2 text-left text-[11px] transition-colors",
        disabled
          ? "cursor-not-allowed text-slate-500"
          : destructive
            ? "text-rose-100 hover:bg-rose-400/10 hover:text-rose-50"
            : "text-slate-200 hover:bg-white/[0.06] hover:text-white"
      )}
      onClick={onClick}
    >
      <Icon className={cn("h-3.5 w-3.5", destructive ? "text-rose-300" : "text-cyan-300")} />
      <span>{label}</span>
    </button>
  );
}

function resolveTaskDispatchStatus(task: TaskFlowNode["data"]["task"]) {
  return typeof task.metadata.dispatchStatus === "string" ? task.metadata.dispatchStatus : null;
}

function isTaskAborted(task: TaskFlowNode["data"]["task"]) {
  const dispatchStatus = resolveTaskDispatchStatus(task);
  const runtimeStatus = task.status as string;
  return dispatchStatus === "cancelled" || dispatchStatus === "aborted" || runtimeStatus === "cancelled" || runtimeStatus === "aborted";
}

function isTaskAbortable(task: TaskFlowNode["data"]["task"]) {
  if (isTaskAborted(task)) {
    return false;
  }

  const runtimeStatus = task.status as string;
  return runtimeStatus === "running" || runtimeStatus === "queued";
}
