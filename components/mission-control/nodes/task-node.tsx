"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  Ban,
  ClipboardList,
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
import { useEffect, useMemo, useRef, useState } from "react";

import type { TaskNodeData } from "@/components/mission-control/canvas-types";
import { InteractiveContent } from "@/components/mission-control/interactive-content";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTaskFeed } from "@/hooks/use-task-feed";
import type { TaskFeedEvent } from "@/lib/agentos/contracts";
import {
  badgeVariantForRuntimeStatus,
  compactMissionText,
  formatTokens,
  toneForRuntimeStatus
} from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type TaskFlowNode = Node<TaskNodeData, "task">;

export function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const baseBootstrapStage =
    typeof data.task.metadata.bootstrapStage === "string" ? data.task.metadata.bootstrapStage : null;
  const shouldStreamFeed =
    expanded ||
    selected ||
    Boolean(data.pendingCreation || isPendingTaskBootstrapStage(baseBootstrapStage)) ||
    data.task.status === "running" ||
    data.task.liveRunCount > 0;

  const optimisticEvents = Array.isArray(data.task.metadata.optimisticEvents)
    ? data.task.metadata.optimisticEvents
    : [];
  const optimisticFeed = useMemo(
    () => optimisticEvents.filter(isTaskFeedEvent),
    [optimisticEvents]
  );
  const latestOptimisticEvent =
    optimisticEvents.length > 0 && isTaskFeedEvent(optimisticEvents[optimisticEvents.length - 1])
      ? optimisticEvents[optimisticEvents.length - 1]
      : null;
  const { feed, detail, loading, error } = useTaskFeed(data.task.id, shouldStreamFeed, {
    dispatchId: data.task.dispatchId,
    optimisticFeed
  });
  const visibleFeed = useMemo(
    () => feed.filter((event) => !isRunnerLogTaskEvent(event)),
    [feed]
  );
  const displayTask = detail?.task ?? data.task;
  const integrity = detail?.integrity ?? null;
  const bootstrapStage =
    typeof displayTask.metadata.bootstrapStage === "string" ? displayTask.metadata.bootstrapStage : null;
  const dispatchSubmittedAt =
    typeof displayTask.metadata.dispatchSubmittedAt === "string"
      ? displayTask.metadata.dispatchSubmittedAt
      : null;
  const isPendingCreation = detail
    ? isPendingTaskBootstrapStage(bootstrapStage)
    : Boolean(data.pendingCreation || isPendingTaskBootstrapStage(bootstrapStage));
  const isJustCreated = Boolean(data.justCreated);
  const isAborted = isTaskAborted(displayTask);
  const isAbortable = isTaskAbortable(displayTask);
  const missingFinalResponse = Boolean(
    integrity?.issues.some((issue) => issue.id === "missing-final-response")
  );
  const completedNeedsReview = Boolean(
    displayTask.status === "completed" &&
      integrity &&
      (integrity.status === "warning" || integrity.status === "error")
  );
  const bootstrapElapsedLabel = isPendingCreation
    ? formatElapsedFromIso(dispatchSubmittedAt, data.relativeTimeReferenceMs)
    : null;
  const tone = isAborted
    ? "text-rose-200"
    : completedNeedsReview
      ? "text-amber-200"
      : toneForRuntimeStatus(displayTask.status);
  const badgeVariant = isPendingCreation
    ? "warning"
      : isAborted
      ? "danger"
      : completedNeedsReview
        ? "warning"
      : badgeVariantForRuntimeStatus(displayTask.status);
  const badgeLabel = missingFinalResponse
    ? "no result"
    : completedNeedsReview
      ? "needs review"
      : resolveTaskBadgeLabel(bootstrapStage, displayTask.status, isPendingCreation, isAborted);
  const footerLabel = missingFinalResponse
    ? "completed without a final answer"
    : resolveTaskFooterLabel(bootstrapStage, displayTask.liveRunCount, isAborted);
  const latestFeedEvent = visibleFeed[visibleFeed.length - 1] ?? latestOptimisticEvent ?? null;
  const activityLabel = latestFeedEvent?.title || footerLabel;
  const activitySummary =
    compactMissionText(latestFeedEvent?.detail, 88) ||
    (isPendingCreation
      ? [footerLabel, bootstrapElapsedLabel ? `${bootstrapElapsedLabel} elapsed` : null].filter(Boolean).join(" · ")
      : compactMissionText(displayTask.subtitle, 72) || footerLabel);
  const promptText = readTaskPromptText(displayTask);
  const resultPreview = missingFinalResponse
    ? "No final answer was captured from OpenClaw for this task."
    : readTaskResultPreview(displayTask);
  const sessionCount = readTaskSessionCount(displayTask);
  const turnCount = readTaskTurnCount(displayTask);
  const feedButtonCount = visibleFeed.length > 0 ? String(visibleFeed.length) : undefined;
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
        "relative w-[272px] overflow-visible rounded-[22px] border border-amber-200/10 bg-[linear-gradient(180deg,rgba(20,18,14,0.98),rgba(9,8,6,0.96))] p-3.5 shadow-[0_18px_36px_rgba(0,0,0,0.28)] backdrop-blur-xl",
        data.emphasis ? "opacity-100" : "opacity-72",
        selected && "border-cyan-300/[0.45] shadow-[0_20px_46px_rgba(34,211,238,0.16)]",
        isPendingCreation && "border-cyan-300/30 shadow-[0_24px_54px_rgba(34,211,238,0.2)]",
        isJustCreated && "border-cyan-200/40 shadow-[0_24px_56px_rgba(125,211,252,0.18)]",
        isAborted && "border-rose-300/30 shadow-[0_24px_54px_rgba(244,63,94,0.14)]",
        displayTask.status === "completed" &&
          !completedNeedsReview &&
          !isAborted &&
          !isPendingCreation &&
          !isJustCreated &&
          "border-white/[0.06] bg-[linear-gradient(180deg,rgba(13,18,30,0.9),rgba(8,12,22,0.9))]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[22px]">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_82%_0%,rgba(251,191,36,0.22),transparent_30%),radial-gradient(circle_at_12%_100%,rgba(217,119,6,0.08),transparent_26%)]" />
        <div className="absolute inset-x-0 top-0 h-[4px] bg-[linear-gradient(90deg,rgba(251,191,36,0.78),rgba(217,119,6,0.18),rgba(255,255,255,0.04))]" />
        <div className="absolute right-3 top-3 h-12 w-12 rounded-full bg-amber-300/10 blur-xl" />
      </div>

      <div className="relative z-10">
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

      <div className="relative z-20 overflow-visible rounded-[18px] border border-amber-200/12 bg-amber-400/[0.05] px-3 py-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
        <div className="flex items-center justify-between gap-3">
          <div className="text-[9px] uppercase tracking-[0.24em] text-amber-100/75">Task</div>

          <div className="nodrag nopan relative flex items-center gap-1.5" ref={menuRef}>
            <Badge variant={badgeVariant} className="max-w-[112px] truncate">
              {badgeLabel}
            </Badge>
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
                className="nodrag nopan absolute right-0 top-[calc(100%+8px)] z-[70] min-w-[148px] rounded-[14px] border border-white/[0.1] bg-slate-950/96 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl"
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

        <div className="mt-3 flex items-start gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-[14px] border border-amber-300/20 bg-amber-400/[0.1] text-amber-100 shadow-[0_0_20px_rgba(251,191,36,0.12)]">
            <ClipboardList className="h-4 w-4" />
          </div>
          <div className="min-w-0 flex-1">
            <p className="line-clamp-2 font-display text-[1rem] leading-5 text-white">
              {compactMissionText(promptText, 96) || promptText}
            </p>
            <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
              {displayTask.primaryAgentName || "OpenClaw"}
            </p>
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        {displayTask.warningCount > 0 ? (
          <Badge variant="warning">
            {displayTask.warningCount} review{displayTask.warningCount === 1 ? "" : "s"}
          </Badge>
        ) : null}
        {isJustCreated ? (
          <Badge variant="default" className="gap-1 border-cyan-100/20 bg-cyan-100/12 text-cyan-50">
            <Sparkles className="h-3 w-3" />
            new
          </Badge>
        ) : null}
        <Badge variant="muted">{sessionCount} session{sessionCount === 1 ? "" : "s"}</Badge>
        <Badge variant="muted">{turnCount} turn{turnCount === 1 ? "" : "s"}</Badge>
        <span className={cn("text-[9px] uppercase tracking-[0.18em]", tone)}>
          {formatTokens(displayTask.tokenUsage?.total)} tokens
        </span>
      </div>

      <div className="mt-3 rounded-[16px] border border-amber-300/12 bg-amber-400/[0.04] px-3 py-2.5">
        <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">Latest result</p>
        <p className="mt-1 line-clamp-3 text-[12.5px] leading-5 text-slate-100">
          {compactMissionText(resultPreview, 168) || resultPreview}
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
          label="Turns"
          value={String(turnCount)}
          onClick={() => data.onInspect?.(data.task, "overview")}
        />
        <TaskQuickAction
          icon={Sparkles}
          label="Files"
          value={String(displayTask.artifactCount)}
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
                {loading && visibleFeed.length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-slate-500">
                    Connecting to feed...
                  </div>
                ) : error && visibleFeed.length === 0 ? (
                  <div className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[10px] leading-5 text-amber-100">
                    {error}
                  </div>
                ) : visibleFeed.length === 0 ? (
                  <div className="py-4 text-center text-[10px] text-slate-500">No events yet.</div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {visibleFeed.map((event) => (
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

function isPendingTaskBootstrapStage(bootstrapStage: string | null) {
  return (
    bootstrapStage === "submitting" ||
    bootstrapStage === "accepted" ||
    bootstrapStage === "waiting-for-heartbeat" ||
    bootstrapStage === "waiting-for-runtime" ||
    bootstrapStage === "runtime-observed"
  );
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

function readTaskPromptText(task: TaskFlowNode["data"]["task"]) {
  return task.mission?.trim() || task.title.trim() || "Untitled task";
}

function readTaskResultPreview(task: TaskFlowNode["data"]["task"]) {
  const resultPreview =
    typeof task.metadata.resultPreview === "string" ? task.metadata.resultPreview.trim() : "";

  if (resultPreview) {
    return resultPreview;
  }

  return task.subtitle.trim() || "Waiting for the first OpenClaw update.";
}

function readTaskSessionCount(task: TaskFlowNode["data"]["task"]) {
  const metadataCount = task.metadata.sessionCount;
  return typeof metadataCount === "number" && Number.isFinite(metadataCount)
    ? metadataCount
    : task.sessionIds.length;
}

function readTaskTurnCount(task: TaskFlowNode["data"]["task"]) {
  const metadataCount = task.metadata.turnCount;
  return typeof metadataCount === "number" && Number.isFinite(metadataCount)
    ? metadataCount
    : task.runtimeCount;
}

function formatElapsedFromIso(value: string | null, referenceTimeMs: number) {
  if (!value) {
    return null;
  }

  const timestamp = Date.parse(value);

  if (Number.isNaN(timestamp)) {
    return null;
  }

  const elapsedMs = Math.max(referenceTimeMs - timestamp, 0);
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
        "nodrag nopan flex min-h-[38px] w-full items-center justify-between rounded-[12px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-2.5 py-1.5 text-left transition-colors hover:border-amber-300/20 hover:bg-amber-400/[0.06]",
        active && "border-amber-300/30 bg-amber-400/[0.08]"
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

function isRunnerLogTaskEvent(event: TaskFeedEvent) {
  return event.id.startsWith("runner-log:");
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
