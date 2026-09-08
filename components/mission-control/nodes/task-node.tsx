"use client";

import { Handle, Position, type Node, type NodeProps } from "@xyflow/react";
import {
  AlertTriangle,
  Ban,
  CheckCircle2,
  CalendarClock,
  ClipboardList,
  ChevronDown,
  Copy,
  CornerDownLeft,
  Coins,
  Cpu,
  EyeOff,
  Lock,
  LockOpen,
  History,
  MessageSquare,
  MoreHorizontal,
  Pause,
  Play,
  Plus,
  RefreshCw,
  Sparkles,
  Trash2,
  X
} from "lucide-react";
import { motion } from "motion/react";
import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";

import type { TaskCardInspectorContext, TaskNodeData } from "@/components/mission-control/canvas-types";
import { InteractiveContent } from "@/components/mission-control/interactive-content";
import {
  FRESH_NODE_BADGE_CLASSES,
  type TaskNodeToneInput,
  resolveTaskNodeBadgeVariant,
  resolveTaskNodeSurfaceTone,
  resolveTaskNodeTokenTone,
  resolveTaskNodeVisualTone
} from "@/components/mission-control/node-visual-tones";
import {
  resolveEffectiveTaskReviewStatus,
  resolveTaskReviewBadgeLabel,
  resolveTaskReviewFooterLabel
} from "@/components/mission-control/task-review-state";
import {
  hasTaskRuntimeOutputEvidence,
  isWaitingForOutputCopy,
  readTaskResultPreview,
  resolveTaskCardPrimaryAction,
  resolveTaskCardEvidencePresentation,
  resolveTaskReviewPresentation,
  resolveTaskBadgeLabel
} from "@/components/mission-control/task-node-status";
import {
  ExpandableTaskResult,
  TaskFollowUpComposer,
  formatFollowUpDetail,
  type SubmittedTaskFollowUp
} from "@/components/mission-control/task-follow-up";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useTaskFeed } from "@/hooks/use-task-feed";
import type { RuntimeActivityRecord, RuntimeOutputRecord, TaskFeedEvent } from "@/lib/agentos/contracts";
import {
  mergeTaskFollowUps,
  readTaskFollowUpsFromMetadata,
  resolveTaskFollowUpDisplayMessage
} from "@/lib/openclaw/domains/task-follow-up-records";
import { resolveTaskFollowUpAvailability } from "@/lib/openclaw/domains/task-follow-up";
import { compactMissionText } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

type TaskFlowNode = Node<TaskNodeData, "task">;
const FOLLOW_UP_STALE_MS = 90_000;

type TaskWorkspaceTab = {
  id: string;
  index: number | null;
  kind: "task" | "follow-up";
  label: string;
  title: string;
  statusLabel: string;
  hasLiveActivity: boolean;
};

export function TaskNode({ data, selected }: NodeProps<TaskFlowNode>) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [operationAction, setOperationAction] = useState<"run" | "retry" | "pause" | "resume" | "delete" | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);
  const [expanded, setExpanded] = useState(false);
  const [composerExpanded, setComposerExpanded] = useState(false);
  const [localFollowUps, setLocalFollowUps] = useState<SubmittedTaskFollowUp[]>([]);
  const [activeFollowUpIndex, setActiveFollowUpIndex] = useState<number | null>(null);
  const basePersistedFollowUps = useMemo(
    () => readTaskFollowUpsFromMetadata(data.task.metadata),
    [data.task.metadata]
  );
  const baseBootstrapStage =
    typeof data.task.metadata.bootstrapStage === "string" ? data.task.metadata.bootstrapStage : null;
  const operationSchedule =
    typeof data.task.metadata.scheduleLabel === "string" ? data.task.metadata.scheduleLabel : null;
  const operationJobId =
    typeof data.task.metadata.operationJobId === "string" ? data.task.metadata.operationJobId : null;
  const operationPaused = data.task.metadata.operationStatus === "paused";
  const systemOwnedMonitor =
    data.task.metadata.systemOwnedMonitor === "heartbeat" ||
    data.task.metadata.systemOwnedMonitor === "skill-collection-review"
      ? data.task.metadata.systemOwnedMonitor
      : null;
  const shouldStreamFeed =
    expanded ||
    selected ||
    localFollowUps.length > 0 ||
    basePersistedFollowUps.length > 0 ||
    activeFollowUpIndex !== null ||
    Boolean(data.pendingCreation || isPendingTaskBootstrapStage(baseBootstrapStage)) ||
    data.task.status === "running" ||
    data.task.status === "stalled" ||
    data.task.liveRunCount > 0;

  const optimisticFeed = useMemo(
    () => readTaskFeedEvents(data.task.metadata.optimisticEvents),
    [data.task.metadata.optimisticEvents]
  );
  const operateSchedule = async (action: "run" | "retry" | "pause" | "resume" | "delete") => {
    if (!operationJobId) return;
    if (action === "delete" && !window.confirm("Delete this schedule permanently? This removes the OpenClaw job and cannot be undone.")) return;
    setOperationAction(action);
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, jobId: operationJobId }) });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "OpenClaw rejected the schedule change.");
      setMenuOpen(false);
      await data.onRefresh?.();
    } catch (error) {
      window.alert(error instanceof Error ? error.message : "Schedule action failed.");
    } finally {
      setOperationAction(null);
    }
  };
  const reviewFeed = useMemo(
    () => readTaskFeedEvents(data.task.metadata.reviewEvents),
    [data.task.metadata.reviewEvents]
  );
  const operationFeed = useMemo(
    () => readTaskFeedEvents(data.task.metadata.operationFeed),
    [data.task.metadata.operationFeed]
  );
  const operationRunHistory = useMemo(
    () => readOperationRunTimeline(data.task.metadata.operationFeed, data.task.metadata.operationRunHistory, data.task.metadata.operationRecoveryHistory),
    [data.task.metadata.operationFeed, data.task.metadata.operationRunHistory, data.task.metadata.operationRecoveryHistory]
  );
  const latestLocalEvent =
    reviewFeed.length > 0 && isTaskFeedEvent(reviewFeed[reviewFeed.length - 1])
      ? reviewFeed[reviewFeed.length - 1]
      : optimisticFeed.length > 0 && isTaskFeedEvent(optimisticFeed[optimisticFeed.length - 1])
      ? optimisticFeed[optimisticFeed.length - 1]
      : null;
  const { feed, detail, loading, error, streamNotice } = useTaskFeed(data.task.id, shouldStreamFeed, {
    dispatchId: data.task.dispatchId,
    optimisticFeed
  });
  const mergedFeed = useMemo(
    () => mergeTaskFeedEvents(feed, reviewFeed, operationFeed),
    [feed, reviewFeed, operationFeed]
  );
  const visibleFeed = useMemo(
    () => mergedFeed.filter((event) => !isRunnerLogTaskEvent(event)),
    [mergedFeed]
  );
  const displayTask = mergeLocalTaskReviewMetadata(detail?.task, data.task);
  const operationRunCount = readNonNegativeMetric(displayTask.metadata.operationRunCount);
  const taskRunCount = operationRunCount ?? displayTask.runtimeCount;
  const taskTokenCount = displayTask.tokenUsage?.total;
  const persistedFollowUps = useMemo(
    () => readTaskFollowUpsFromMetadata(displayTask.metadata),
    [displayTask.metadata]
  );
  const followUps = useMemo(
    () => mergeTaskFollowUps(localFollowUps, persistedFollowUps),
    [localFollowUps, persistedFollowUps]
  );
  const integrity = detail?.integrity ?? null;
  const reviewPresentation = resolveTaskReviewPresentation(displayTask, integrity);
  const bootstrapStage =
    typeof displayTask.metadata.bootstrapStage === "string" ? displayTask.metadata.bootstrapStage : null;
  const dispatchSubmittedAt =
    typeof displayTask.metadata.dispatchSubmittedAt === "string"
      ? displayTask.metadata.dispatchSubmittedAt
      : null;
  const observedModelId =
    typeof displayTask.metadata.modelId === "string" && displayTask.metadata.modelId.trim()
      ? displayTask.metadata.modelId.trim()
      : null;
  const requestedModelId =
    typeof displayTask.metadata.requestedModelId === "string" && displayTask.metadata.requestedModelId.trim()
      ? displayTask.metadata.requestedModelId.trim()
      : null;
  const taskModelId = observedModelId ?? requestedModelId;
  const taskRunReference = formatTaskRunReference(displayTask.dispatchId, displayTask.runIds[0]);
  const isPendingCreation = detail
    ? isPendingTaskBootstrapStage(bootstrapStage)
    : Boolean(data.pendingCreation || isPendingTaskBootstrapStage(bootstrapStage));
  const isJustCreated = Boolean(data.justCreated);
  const isAborted = isTaskAborted(displayTask);
  const isAbortable = isTaskAbortable(displayTask);
  const isLiveTask = displayTask.status === "running" || displayTask.status === "queued" || displayTask.liveRunCount > 0;
  const isRecurringOperation =
    (displayTask.metadata.recurrence === "every" || displayTask.metadata.recurrence === "cron") &&
    displayTask.metadata.operationStatus === "scheduled";
  const hasOperationResult = typeof displayTask.metadata.resultPreview === "string" && displayTask.metadata.resultPreview.trim().length > 0;
  const missingFinalResponse = !hasOperationResult && Boolean(
    integrity?.issues.some((issue) => issue.id === "missing-final-response")
  );
  const partialFinalResponse = Boolean(
    integrity?.issues.some((issue) => issue.id === "partial-final-response")
  );
  const hasRuntimeOutputEvidence = hasTaskRuntimeOutputEvidence(displayTask, visibleFeed);
  const stalledWithCapturedOutput =
    partialFinalResponse || (displayTask.status === "stalled" && hasRuntimeOutputEvidence);
  const latestEvidenceEvent = findLatestOutputEvidenceEvent(visibleFeed);
  const reviewStatus = resolveEffectiveTaskReviewStatus(displayTask, {
    nowMs: data.relativeTimeReferenceMs,
    hasLiveActivity: isLiveTask || isPendingCreation,
    latestEvidenceAt: latestEvidenceEvent?.timestamp ?? null
  });
  const visibleReviewStatus =
    reviewStatus && reviewStatus === "continued" && isLiveTask ? null : reviewStatus;
  const hasReviewResolution = Boolean(reviewStatus);
  const hasReviewableIntegrity = !hasOperationResult && (
    integrity
      ? integrity.status === "warning" ||
        integrity.status === "error" ||
        (displayTask.status === "stalled" && hasRuntimeOutputEvidence)
      : stalledWithCapturedOutput
  );
  const completedNeedsReview = Boolean(
    (displayTask.status === "completed" || stalledWithCapturedOutput) &&
      hasReviewableIntegrity &&
      !hasReviewResolution
  );
  const bootstrapElapsedLabel = isPendingCreation
    ? formatElapsedFromIso(dispatchSubmittedAt, data.relativeTimeReferenceMs)
    : null;
  const effectiveActiveFollowUpIndex =
    activeFollowUpIndex !== null && activeFollowUpIndex < followUps.length ? activeFollowUpIndex : null;
  const activeFollowUp =
    effectiveActiveFollowUpIndex !== null ? followUps[effectiveActiveFollowUpIndex] ?? null : null;
  const activeFollowUpRuntimes = activeFollowUp ? resolveFollowUpRuntimes(activeFollowUp, detail?.runs ?? []) : [];
  const activeFollowUpRuntime = resolveRepresentativeFollowUpRuntime(activeFollowUpRuntimes);
  const activeFollowUpOutputs =
    detail?.outputs.filter((output) => activeFollowUpRuntimes.some((runtime) => runtime.id === output.runtimeId)) ?? [];
  const activeFollowUpOutput = resolveBestFollowUpOutput(activeFollowUpOutputs);
  const realDisplayedFeed = activeFollowUp
    ? filterFollowUpFeed(activeFollowUp, activeFollowUpRuntimes, visibleFeed)
    : visibleFeed;
  const displayedFeed =
    activeFollowUp && realDisplayedFeed.length === 0
      ? createFollowUpOptimisticFeed(activeFollowUp)
      : realDisplayedFeed;
  const activeFollowUpStatus = activeFollowUp
    ? resolveFollowUpStatus(activeFollowUp, activeFollowUpRuntime, activeFollowUpOutput, activeFollowUpRuntimes)
    : null;
  const toneInput: TaskNodeToneInput = {
    completedNeedsReview,
    isAborted,
    isJustCreated,
    isPendingCreation,
    status: displayTask.status,
    visibleReviewStatus
  };
  const displayedToneInput: TaskNodeToneInput = activeFollowUp && activeFollowUpStatus
    ? {
        completedNeedsReview: false,
        isAborted: activeFollowUpStatus === "cancelled",
        isJustCreated: false,
        isPendingCreation: false,
        status: activeFollowUpStatus,
        visibleReviewStatus: null
      }
    : toneInput;
  const tone = resolveTaskNodeTokenTone(displayedToneInput);
  const badgeVariant = resolveTaskNodeBadgeVariant(displayedToneInput);
  const badgeLabel = activeFollowUp && activeFollowUpStatus
    ? resolveTaskBadgeLabel(null, activeFollowUpStatus, false, activeFollowUpStatus === "cancelled", Boolean(activeFollowUpOutput?.finalText || activeFollowUp?.summary))
    : visibleReviewStatus
    ? resolveTaskReviewBadgeLabel(visibleReviewStatus)
    : operationPaused
    ? "paused"
    : isRecurringOperation && !isLiveTask
    ? "scheduled"
    : missingFinalResponse
    ? "no result"
    : reviewPresentation.badgeLabel && completedNeedsReview
    ? reviewPresentation.badgeLabel
    : completedNeedsReview
      ? "needs review"
      : resolveTaskBadgeLabel(bootstrapStage, displayTask.status, isPendingCreation, isAborted, hasRuntimeOutputEvidence);
  const footerLabel = activeFollowUp
    ? resolveFollowUpFooterLabel(activeFollowUp, activeFollowUpRuntime, activeFollowUpOutput, activeFollowUpRuntimes)
    : visibleReviewStatus
    ? resolveTaskReviewFooterLabel(visibleReviewStatus)
    : operationPaused
    ? "schedule paused"
    : isRecurringOperation && !isLiveTask
    ? "scheduled · next run pending"
    : reviewPresentation.footerLabel && completedNeedsReview
    ? reviewPresentation.footerLabel
    : stalledWithCapturedOutput
    ? "partial output needs review"
    : missingFinalResponse
    ? "completed without a final answer"
    : resolveTaskFooterLabel(bootstrapStage, displayTask.liveRunCount, isAborted);
  const latestFeedEvent = displayedFeed[displayedFeed.length - 1] ?? (activeFollowUp ? null : latestLocalEvent) ?? null;
  const showsLiveActivity =
    !isAborted &&
    !completedNeedsReview &&
    (activeFollowUp
      ? activeFollowUpStatus === "running" || activeFollowUpStatus === "queued"
      : isPendingCreation ||
        displayTask.status === "running" ||
        displayTask.liveRunCount > 0 ||
      Boolean(latestFeedEvent && /working|waiting for output/i.test(latestFeedEvent.title)));
  const activityLabel = latestFeedEvent?.title || footerLabel;
  const activitySummary =
    compactMissionText(latestFeedEvent?.detail, 88) ||
    (activeFollowUp
      ? compactMissionText(resolveFollowUpResultText(activeFollowUp, activeFollowUpRuntime, activeFollowUpOutput), 72) || footerLabel
      : isPendingCreation
      ? [footerLabel, bootstrapElapsedLabel ? `${bootstrapElapsedLabel} elapsed` : null].filter(Boolean).join(" · ")
      : compactMissionText(displayTask.subtitle, 72) || footerLabel);
  const promptText = readTaskPromptText(displayTask);
  const rawResultPreview = readTaskResultPreview(displayTask);
  const resultPreview = missingFinalResponse
    ? "No final answer was captured from OpenClaw for this task."
    : stalledWithCapturedOutput && isWaitingForOutputCopy(rawResultPreview)
      ? "Partial runtime evidence captured. Review the live feed for the latest tool output."
      : rawResultPreview;
  const feedPanelId = `task-feed-${data.task.id}`;
  const visualTone = resolveTaskNodeVisualTone(displayedToneInput);
  const surfaceTheme = data.surfaceTheme ?? "dark";
  const surfaceTone = resolveTaskNodeSurfaceTone(surfaceTheme);
  const agentThemeRgb = data.agentThemeRgb ?? "14, 165, 233";
  const taskCardStyle = {
    borderColor: `rgba(${agentThemeRgb}, ${selected ? 0.62 : surfaceTheme === "light" ? 0.32 : 0.28})`,
    ...(selected
      ? {
          boxShadow:
            surfaceTheme === "light"
              ? `0 0 0 1px rgba(${agentThemeRgb}, 0.18), 0 22px 52px rgba(${agentThemeRgb}, 0.18)`
              : `0 0 0 1px rgba(${agentThemeRgb}, 0.2), 0 22px 52px rgba(${agentThemeRgb}, 0.24)`
        }
      : {})
  } as CSSProperties;
  const followUpAvailability = resolveTaskFollowUpAvailability(displayTask);
  const resolvedPrimaryAction = resolveTaskCardPrimaryAction({
    status: displayTask.status,
    completedNeedsReview
  });
  const primaryAction = resolvedPrimaryAction === "review-result" && !data.onReviewTask
    ? "view-details"
    : resolvedPrimaryAction;
  const currentCardNumber = effectiveActiveFollowUpIndex === null ? 1 : effectiveActiveFollowUpIndex + 2;
  const displayPromptText = activeFollowUp
    ? resolveTaskFollowUpDisplayMessage(activeFollowUp) ?? activeFollowUp.message
    : promptText;
  const displayResultTitle = activeFollowUp ? "Follow-up result" : reviewPresentation.evidenceLabel;
  const displayResultEvidenceLabel = activeFollowUp ? "Follow-up result" : reviewPresentation.evidenceLabel;
  const displayResultText = activeFollowUp
    ? resolveFollowUpResultText(activeFollowUp, activeFollowUpRuntime, activeFollowUpOutput)
    : resultPreview;
  const activeInspectorContext = activeFollowUp
    ? buildTaskCardInspectorContext(data.task.id, activeFollowUp, effectiveActiveFollowUpIndex ?? 0, currentCardNumber)
    : null;
  const cardSummary = compactMissionText(
    isLiveTask || isPendingCreation ? activitySummary : displayResultText || activitySummary,
    164
  ) || activitySummary;
  const cardEvidencePresentation = activeFollowUp
    ? {
        label: showsLiveActivity ? "Live activity" : "Latest result",
        prioritizeActivity: showsLiveActivity && Boolean(latestFeedEvent)
      }
    : resolveTaskCardEvidencePresentation({
        hasActivity: Boolean(latestFeedEvent),
        hasLiveActivity: showsLiveActivity,
        deliveryUnconfirmed: reviewPresentation.deliveryUnconfirmed
      });
  const activityPreview = compactMissionText(
    [activityLabel, activitySummary].filter(Boolean).join(" · "),
    164
  );
  const cardEvidenceText = cardEvidencePresentation.prioritizeActivity
    ? activityPreview || cardSummary
    : cardSummary;
  const isCompactMonitor = systemOwnedMonitor !== null && !expanded && !composerExpanded;
  const monitorTitle = systemOwnedMonitor === "heartbeat" ? "Heartbeat monitor" : "Skill Workshop review";
  const monitorSubtitle = systemOwnedMonitor === "heartbeat" ? "Native background heartbeat" : "Native background skill review";

  useEffect(() => {
    if (!expanded && !composerExpanded) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!cardRef.current?.contains(event.target as globalThis.Node)) {
        setExpanded(false);
        setComposerExpanded(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown, true);
    return () => window.removeEventListener("pointerdown", handlePointerDown, true);
  }, [expanded, composerExpanded]);

  const tabs: TaskWorkspaceTab[] = [
    {
      id: "task",
      index: null,
      kind: "task",
      label: "Task 1",
      title: compactMissionText(promptText, 36) || "Original task",
      statusLabel: displayTask.status,
      hasLiveActivity: !activeFollowUp && showsLiveActivity
    },
    ...followUps.map((followUp, index) => ({
      id: followUp.runId || followUp.id,
      index,
      kind: "follow-up" as const,
      label: "Follow-up",
      title: compactMissionText(resolveTaskFollowUpDisplayMessage(followUp) ?? followUp.message, 34) || "Follow-up",
      statusLabel: normalizeRuntimeStatus(followUp.status) ?? "running",
      hasLiveActivity: activeFollowUp?.id === followUp.id && showsLiveActivity
    }))
  ];
  const activeTabId = activeFollowUp ? activeFollowUp.runId || activeFollowUp.id : "task";
  const selectTaskTab = (nextIndex: number | null) => {
    setActiveFollowUpIndex(nextIndex);
    data.onActiveCardChange?.(
      data.task,
      nextIndex === null
        ? null
        : buildTaskCardInspectorContext(
            data.task.id,
            followUps[nextIndex]!,
            nextIndex,
            nextIndex + 2
          )
    );
  };
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
      ref={cardRef}
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
        "group relative max-w-[calc(100vw-32px)] origin-center transform-gpu overflow-visible rounded-[18px] border p-1.5 backdrop-blur-xl transition-[border-color,box-shadow,opacity,transform,width] duration-200",
        isCompactMonitor ? "w-[248px] rounded-[15px]" : "w-[400px] rounded-[18px]",
        surfaceTone.outer,
        data.emphasis ? "opacity-100" : "opacity-76",
        (composerExpanded || expanded) && "z-30 shadow-[0_22px_58px_rgba(0,0,0,0.3)]"
      )}
      style={taskCardStyle}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-[18px]">
        <div
          className="absolute inset-y-3 left-0 w-0.5 rounded-r-full"
          style={{ backgroundColor: `rgb(${agentThemeRgb})`, boxShadow: `0 0 14px rgba(${agentThemeRgb}, 0.46)` }}
        />
        <div
          className="absolute inset-x-0 top-0 h-px"
          style={{ backgroundColor: `rgba(${agentThemeRgb}, ${surfaceTheme === "light" ? 0.62 : 0.78})` }}
        />
        <div
          className="absolute -right-8 -top-8 h-24 w-24 rounded-full blur-3xl"
          style={{ backgroundColor: `rgba(${agentThemeRgb}, ${surfaceTheme === "light" ? 0.1 : 0.14})` }}
        />
      </div>

      <div className="relative z-10">
        {isPendingCreation ? (
        <motion.div
          className="pointer-events-none absolute inset-[-8px] rounded-[18px] border"
          style={{ borderColor: `rgba(${agentThemeRgb}, 0.28)` }}
          animate={{ opacity: [0.18, 0.42, 0.18], scale: [0.985, 1.02, 0.985] }}
          transition={{ duration: 1.8, repeat: Number.POSITIVE_INFINITY, ease: "easeInOut" }}
        />
        ) : null}

        <Handle
          type="target"
          id="target-left"
          position={Position.Left}
          className={cn("!h-2.5 !w-2.5 !border-0", visualTone.handle)}
        />

        <div className={cn("relative z-20 rounded-[13px] border px-3 py-2.5", isCompactMonitor && "px-2.5 py-2", surfaceTone.panel)}>
          <div className="min-w-0">
          <div className="flex items-start justify-between gap-2.5">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span
                  className={cn(
                    "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border",
                    resolveTaskIconClass(visualTone.key, surfaceTheme)
                  )}
                >
                  {systemOwnedMonitor ? <RefreshCw className="h-3.5 w-3.5" /> : <ClipboardList className="h-3.5 w-3.5" />}
                </span>
                <span
                  className={cn(
                    "inline-flex h-1.5 w-1.5 shrink-0 rounded-full",
                    visualTone.dot,
                    showsLiveActivity && "motion-safe:animate-pulse"
                  )}
                />
                <span className={cn("truncate text-[10px] font-semibold uppercase tracking-[0.16em]", surfaceTone.mutedText)}>
                  {systemOwnedMonitor ? "Monitor" : activeFollowUp ? "Follow-up" : "Task"} · <span className={cn("normal-case tracking-normal", surfaceTone.text)}>{displayTask.primaryAgentName || "OpenClaw"}</span>
                </span>
                {data.locked ? <Lock className={cn("h-3 w-3", surfaceTone.mutedText)} /> : null}
              </div>
            <p className={cn("mt-0.5 truncate text-[10px] leading-4", surfaceTone.mutedText)}>{isCompactMonitor ? monitorSubtitle : activityLabel}</p>
            </div>

            <div className="nodrag nopan relative flex shrink-0 items-center gap-1.5" ref={menuRef}>
              {data.onReviewTask && (completedNeedsReview || hasReviewResolution || badgeLabel === "needs review") ? (
                <button
                  type="button"
                  aria-label={`${hasReviewResolution ? "Open review record" : "Review task result"}: ${displayTask.title}`}
                  title={hasReviewResolution ? "Open review record" : "See what needs review and choose an action"}
                  onClick={(event) => {
                    event.stopPropagation();
                    data.onReviewTask?.(displayTask);
                  }}
                  onPointerDown={(event) => event.stopPropagation()}
                  className="nodrag nopan rounded-[8px] transition-[filter,transform] hover:brightness-95 active:scale-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <Badge variant={badgeVariant} className="max-w-[132px] cursor-pointer truncate rounded-[8px] px-2 py-1 text-[9px]">
                    {badgeLabel}
                  </Badge>
                </button>
              ) : (
                <Badge variant={badgeVariant} className="max-w-[132px] truncate rounded-[8px] px-2 py-1 text-[9px]">
                  {badgeLabel}
                </Badge>
              )}
              <button
                type="button"
                aria-label="Task actions"
                onClick={(event) => {
                  event.stopPropagation();
                  setMenuOpen((current) => !current);
                }}
                onPointerDown={(event) => event.stopPropagation()}
                className={cn("nodrag nopan inline-flex h-7 w-7 items-center justify-center rounded-[9px] border transition-colors", surfaceTone.subtleButton)}
              >
                <MoreHorizontal className="h-3.5 w-3.5" />
              </button>

              {menuOpen ? (
                <div
                  className={cn("nodrag nopan absolute right-0 top-[calc(100%+8px)] z-[70] min-w-[176px] rounded-[12px] border p-1.5 backdrop-blur-xl", surfaceTone.menu)}
                  onClick={(event) => event.stopPropagation()}
                  onPointerDown={(event) => event.stopPropagation()}
                >
                  {data.onReviewTask && (completedNeedsReview || hasReviewResolution || badgeLabel === "needs review") ? (
                    <TaskMenuButton
                      icon={hasReviewResolution ? CheckCircle2 : AlertTriangle}
                      label={hasReviewResolution ? "Review record" : "Review result"}
                      surfaceTheme={surfaceTheme}
                      onClick={() => {
                        data.onReviewTask?.(displayTask);
                        setMenuOpen(false);
                      }}
                    />
                  ) : null}
                  <TaskMenuButton
                      icon={CornerDownLeft}
                      label="Reuse as new task"
                      surfaceTheme={surfaceTheme}
                    onClick={() => {
                      data.onReply?.(data.task);
                      setMenuOpen(false);
                    }}
                  />
                  <TaskMenuButton
                      icon={Copy}
                      label="Copy & edit prompt"
                      surfaceTheme={surfaceTheme}
                    onClick={() => {
                      data.onCopyPrompt?.(data.task);
                      setMenuOpen(false);
                    }}
                  />
                  <TaskMenuButton
                      icon={EyeOff}
                      label="Hide"
                      surfaceTheme={surfaceTheme}
                    onClick={() => {
                      data.onHide?.(data.task);
                      setMenuOpen(false);
                    }}
                  />
                  {operationJobId ? <>
                    <TaskMenuButton
                      icon={Play}
                      label={operationAction === "run" ? "Starting…" : "Run now"}
                      disabled={operationAction !== null || operationPaused}
                      surfaceTheme={surfaceTheme}
                      onClick={() => void operateSchedule("run")}
                    />
                    {(displayTask.metadata.lastRunStatus === "error" || displayTask.metadata.operationLastError) ? (
                      <TaskMenuButton
                        icon={RefreshCw}
                        label={operationAction === "retry" ? "Retrying…" : "Retry failed run"}
                        disabled={operationAction !== null || operationPaused}
                        surfaceTheme={surfaceTheme}
                        onClick={() => void operateSchedule("retry")}
                      />
                    ) : null}
                    <TaskMenuButton
                      icon={operationPaused ? Play : Pause}
                      label={operationAction === (operationPaused ? "resume" : "pause") ? "Updating…" : operationPaused ? "Resume schedule" : "Pause schedule"}
                      disabled={operationAction !== null}
                      surfaceTheme={surfaceTheme}
                      onClick={() => void operateSchedule(operationPaused ? "resume" : "pause")}
                    />
                    <TaskMenuButton
                      icon={Trash2}
                      label={operationAction === "delete" ? "Deleting…" : "Delete schedule"}
                      destructive
                      disabled={operationAction !== null}
                      surfaceTheme={surfaceTheme}
                      onClick={() => void operateSchedule("delete")}
                    />
                  </> : null}
                  {data.onAbortTask && (isAbortable || isAborted) ? (
                    <TaskMenuButton
                      icon={Ban}
                      label={isAborted ? "Aborted" : "Abort task"}
                      destructive
                      disabled={!isAbortable}
                      surfaceTheme={surfaceTheme}
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
                      surfaceTheme={surfaceTheme}
                    onClick={() => {
                      data.onToggleLock?.(data.task);
                      setMenuOpen(false);
                    }}
                  />
                </div>
              ) : null}
            </div>
          </div>

          <h3 className={cn("mt-2.5 line-clamp-2 font-display text-[1rem] font-semibold leading-[1.28]", isCompactMonitor && "mt-2 text-[0.9rem] line-clamp-1", surfaceTone.text)}>
            {isCompactMonitor ? monitorTitle : displayPromptText}
          </h3>

          <div className={cn("mt-2 flex flex-wrap items-center gap-x-2.5 gap-y-1 text-[9px]", isCompactMonitor && "hidden", surfaceTone.mutedText)}>
            {dispatchSubmittedAt ? (
              <span title={new Date(dispatchSubmittedAt).toLocaleString()}>
                Started <span className={surfaceTone.text}>{formatTimelineDate(dispatchSubmittedAt)}</span>
              </span>
            ) : null}
            {taskModelId ? (
              <span className="inline-flex min-w-0 items-center gap-1" title={`${observedModelId ? "Runtime model" : "Requested model (runtime did not confirm usage)"}: ${taskModelId}`}>
                <Cpu className="h-3 w-3 shrink-0" />
                <span className="max-w-[160px] truncate text-current">
                  {observedModelId ? "Model" : "Requested"} <span className={surfaceTone.text}>{taskModelId}</span>
                </span>
              </span>
            ) : (
              <span title="OpenClaw did not expose a model for this run.">Model unavailable</span>
            )}
            {taskRunReference ? (
              <span title={displayTask.dispatchId ?? displayTask.runIds[0] ?? undefined}>
                Run <span className={cn("font-mono", surfaceTone.text)}>{taskRunReference}</span>
              </span>
            ) : null}
            <span className="inline-flex items-center gap-1" title={`${taskRunCount} OpenClaw run${taskRunCount === 1 ? "" : "s"} observed for this task`}>
              <History className="h-3 w-3 shrink-0" />
              <span className={surfaceTone.text}>{formatCompactTaskMetric(taskRunCount)}</span> run{taskRunCount === 1 ? "" : "s"}
            </span>
            <span className="inline-flex items-center gap-1" title={typeof taskTokenCount === "number" ? `${taskTokenCount.toLocaleString()} tokens reported by OpenClaw` : "OpenClaw did not report token usage for this task"}>
              <Coins className="h-3 w-3 shrink-0" />
              {typeof taskTokenCount === "number" ? <><span className={surfaceTone.text}>{formatCompactTaskMetric(taskTokenCount)}</span> tokens</> : "Tokens not reported"}
            </span>
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {displayTask.warningCount > 0 && !hasReviewResolution ? (
              <Badge variant="warning" className="rounded-[8px] px-2 py-1 text-[9px]">
                {displayTask.warningCount} review{displayTask.warningCount === 1 ? "" : "s"}
              </Badge>
            ) : null}
            {isJustCreated ? (
              <Badge variant="default" className={cn(FRESH_NODE_BADGE_CLASSES, "rounded-[8px] px-2 py-1 text-[9px]")}>
                <Sparkles className="h-3 w-3" />
                new
              </Badge>
            ) : null}
            {followUps.length > 0 ? (
              <button
                type="button"
                onClick={() => setExpanded(true)}
                className={cn("nodrag nopan rounded-[7px] border px-1.5 py-1 text-[9px] font-medium", surfaceTone.subtleButton)}
              >
                {followUps.length} follow-up{followUps.length === 1 ? "" : "s"}
              </button>
            ) : null}
            {operationSchedule ? (
              <span className={cn("inline-flex max-w-full items-center gap-1 rounded-[8px] border px-2 py-1 text-[9px]", surfaceTone.subtleButton)} title={operationSchedule}>
                <CalendarClock className="h-3 w-3 shrink-0" />
                <span className="truncate">{operationSchedule}</span>
              </span>
            ) : null}
            <span className={cn("text-[9px] uppercase tracking-[0.14em]", tone, surfaceTheme === "light" && resolveLightTaskStatusTextClass(visualTone.key))}>
              {footerLabel}
            </span>
          </div>

          <div className={cn("mt-2", isCompactMonitor && "hidden")}>
            <p className={cn("text-[9px] font-semibold uppercase tracking-[0.14em]", surfaceTheme === "light" ? "text-amber-700" : "text-amber-200/80")}>
              {cardEvidencePresentation.label}
            </p>
            <p className={cn("mt-1 line-clamp-2 text-[11px] leading-5", surfaceTheme === "light" ? "text-[#624f43]" : "text-slate-300")}>
              {cardEvidenceText}
            </p>
          </div>

          <div className={cn("mt-3 flex items-center gap-1.5", isCompactMonitor && "mt-2") }>
            {!isCompactMonitor ? <button
              type="button"
              className={cn("nodrag nopan inline-flex h-8 items-center rounded-[9px] px-2.5 text-[10px] font-semibold transition-colors", resolvePrimaryActionClass(primaryAction, surfaceTheme))}
              onClick={(event) => {
                event.stopPropagation();
                if (primaryAction === "review-result") {
                  data.onReviewTask?.(displayTask);
                  return;
                }

                data.onInspect?.(data.task, primaryAction === "view-details" ? "overview" : "output", activeInspectorContext);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {formatPrimaryActionLabel(primaryAction)}
            </button> : null}
            {!isCompactMonitor ? <button
              type="button"
              disabled={!followUpAvailability.available}
              title={followUpAvailability.reason ?? followUpAvailability.warning ?? "Continue this task in its existing OpenClaw session."}
              className={cn(
                "nodrag nopan inline-flex h-8 items-center rounded-[9px] border px-2.5 text-[10px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
                surfaceTone.subtleButton
              )}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded(true);
                setComposerExpanded(true);
                requestAnimationFrame(() => composerInputRef.current?.focus());
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {reviewPresentation.deliveryUnconfirmed && !activeFollowUp
                ? reviewPresentation.followUpLabel
                : "Follow up"}
            </button> : null}
            {!isCompactMonitor && operationSchedule && operationJobId ? (
              <OperationScheduleControl
                jobId={operationJobId}
                label={operationSchedule}
                cronExpression={typeof data.task.metadata.cronExpression === "string" ? data.task.metadata.cronExpression : null}
                timezone={typeof data.task.metadata.timezone === "string" ? data.task.metadata.timezone : null}
                scheduleKind={data.task.metadata.recurrence === "at" || data.task.metadata.recurrence === "every" || data.task.metadata.recurrence === "cron" ? data.task.metadata.recurrence : null}
                triggerAt={typeof data.task.metadata.triggerAt === "string" ? data.task.metadata.triggerAt : null}
                intervalMs={typeof data.task.metadata.intervalMs === "number" ? data.task.metadata.intervalMs : null}
                surfaceTheme={surfaceTheme}
                onSaved={() => data.onInspect?.(data.task, "overview", activeInspectorContext)}
              />
            ) : null}
            <button
              type="button"
              aria-expanded={expanded}
              aria-controls={feedPanelId}
              className={cn("nodrag nopan ml-auto inline-flex h-8 w-8 items-center justify-center rounded-[9px] border transition-colors", surfaceTone.subtleButton)}
              aria-label={
                expanded
                  ? systemOwnedMonitor
                    ? "Collapse monitor details"
                    : "Hide activity and details"
                  : systemOwnedMonitor
                    ? "Expand monitor details"
                    : "Show activity and details"
              }
              title={expanded ? "Hide activity" : systemOwnedMonitor ? "Expand monitor details" : "Show activity and details"}
              onClick={(event) => {
                event.stopPropagation();
                setExpanded((current) => !current);
              }}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {expanded ? <X className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>

          </div>
        </div>

        {expanded ? (
          <motion.div
            id={feedPanelId}
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: "auto", opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className={cn("nodrag nopan mt-1.5 overflow-hidden rounded-[13px] border px-2.5 py-2.5 nowheel", surfaceTone.panel)}
            onClick={(e) => e.stopPropagation()}
          >
            {followUps.length > 0 ? (
              <TaskWorkspaceTabs
                activeTabId={activeTabId}
                tabs={tabs}
                surfaceTheme={surfaceTheme}
                addDisabled={!followUpAvailability.available}
                addTitle={followUpAvailability.reason ?? followUpAvailability.warning ?? "Continue this task in its existing OpenClaw session."}
                onAdd={() => {
                  setComposerExpanded(true);
                  requestAnimationFrame(() => composerInputRef.current?.focus());
                }}
                onSelect={(tab) => selectTaskTab(tab.index)}
              />
            ) : null}
            <ExpandableTaskResult
              title={displayResultTitle}
              result={displayResultText}
              compact
              density="dense"
              className="mb-2"
            />
            {operationJobId ? (
              <OperationRunTimeline
                entries={operationRunHistory}
                nextRunAt={typeof data.task.metadata.nextRunAt === "string" ? data.task.metadata.nextRunAt : null}
                scheduleLabel={operationSchedule}
                surfaceTheme={surfaceTheme}
              />
            ) : null}
            <div>
              <p className={cn("mb-2 text-[9px] font-semibold uppercase tracking-[0.14em]", surfaceTone.mutedText)}>
                {reviewPresentation.deliveryUnconfirmed && !activeFollowUp ? "Captured activity feed" : "Activity feed"}
              </p>
              {streamNotice ? (
                <div className={cn("mb-2 rounded-[10px] border border-amber-400/20 bg-amber-400/10 px-2.5 py-2 text-[10px] leading-5", surfaceTheme === "light" ? "text-amber-800" : "text-amber-100")}>
                  {streamNotice}
                </div>
              ) : null}
              <ScrollArea className="h-[108px] w-full pr-3">
                {loading && displayedFeed.length === 0 ? (
                  <div className={cn("py-4 text-center text-[10px]", surfaceTone.mutedText)}>
                    Connecting to feed...
                  </div>
                ) : error && displayedFeed.length === 0 ? (
                  <div className={cn("rounded-[10px] border border-amber-400/20 bg-amber-400/10 px-2.5 py-2 text-[10px] leading-5", surfaceTheme === "light" ? "text-amber-800" : "text-amber-100")}>
                    {error}
                  </div>
                ) : displayedFeed.length === 0 ? (
                  <div className={cn("py-4 text-center text-[10px]", surfaceTone.mutedText)}>
                    {activeFollowUp ? "No follow-up events yet." : "No events yet."}
                  </div>
                ) : (
                  <div className="flex flex-col gap-2.5">
                    {displayedFeed.map((event) => (
                      <div key={event.id} className="group/item relative pl-3">
                        <div
                          className={cn(
                            "absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full",
                            resolveFeedEventColor(event.kind, event.isError)
                          )}
                        />
                        <div className="flex items-baseline justify-between gap-2">
                          <span className={cn("text-[10px] font-medium", surfaceTheme === "light" ? "text-[#514136]" : "text-slate-300")}>
                            {event.title}
                          </span>
                          <span className={cn("shrink-0 text-[9px]", surfaceTone.mutedText)}>
                            {formatTimeOnly(event.timestamp)}
                          </span>
                        </div>
                        <div className="mt-0.5">
                          <InteractiveContent
                            text={event.detail}
                            className={cn("text-[10px] leading-relaxed", surfaceTheme === "light" ? "text-[#806958] group-hover/item:text-[#514136]" : "text-slate-400 group-hover/item:text-slate-300")}
                            url={"url" in event ? event.url : null}
                            filePath={"filePath" in event ? event.filePath : null}
                            displayPath={"displayPath" in event ? event.displayPath : null}
                            basePath={data.workspacePath}
                            compact
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </ScrollArea>
            </div>
            {composerExpanded ? (
              <TaskFollowUpComposer
                task={displayTask}
                latestResult={displayResultText}
                latestResultLabel={activeFollowUp ? undefined : displayResultEvidenceLabel}
                createdFiles={detail?.createdFiles}
                outputSummary={activitySummary}
                placeholder={activeFollowUp ? undefined : reviewPresentation.followUpPlaceholder}
                compact
                density="dense"
                expanded
                textareaRef={composerInputRef}
                className="nodrag nopan mt-2"
                onSubmitted={(followUp) => {
                  const nextIndex = followUps.length;
                  setLocalFollowUps((current) => mergeTaskFollowUps(current, [followUp]));
                  setActiveFollowUpIndex(nextIndex);
                  data.onActiveCardChange?.(data.task, buildTaskCardInspectorContext(data.task.id, followUp, nextIndex, nextIndex + 2));
                }}
              />
            ) : null}
          </motion.div>
        ) : null}
      </div>
    </motion.div>
  );
}

function TaskWorkspaceTabs({
  activeTabId,
  tabs,
  onAdd,
  onSelect,
  surfaceTheme,
  addDisabled = false,
  addTitle = "Focus follow-up composer"
}: {
  activeTabId: string;
  tabs: TaskWorkspaceTab[];
  onAdd: () => void;
  onSelect: (tab: TaskWorkspaceTab) => void;
  surfaceTheme: "dark" | "light";
  addDisabled?: boolean;
  addTitle?: string;
}) {
  const activeIndex = Math.max(tabs.findIndex((tab) => tab.id === activeTabId), 0);
  const selectByOffset = (offset: number) => {
    const nextTab = tabs[(activeIndex + offset + tabs.length) % tabs.length];
    if (nextTab) {
      onSelect(nextTab);
    }
  };

  return (
    <div
      className="relative z-20 mb-1.5 flex items-end gap-1.5 pb-px"
      onClick={(event) => event.stopPropagation()}
    >
      <div
        role="tablist"
        aria-label="Task workspace tabs"
        className={cn(
          "min-w-0 items-end gap-2",
          tabs.length <= 7 ? "grid flex-1" : "flex min-w-max overflow-x-auto"
        )}
        style={tabs.length <= 7 ? { gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` } : undefined}
      >
        {tabs.map((tab) => {
          const active = tab.id === activeTabId;
          const Icon = tab.kind === "task" ? ClipboardList : MessageSquare;
          const isLight = surfaceTheme === "light";

          return (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              title={`${tab.label}: ${tab.title}`}
              className={cn(
                "group/tab relative flex h-[50px] cursor-grab items-center gap-2 rounded-t-[14px] border px-2.5 text-left outline-none transition-all duration-200 active:cursor-grabbing focus-visible:ring-2 focus-visible:ring-cyan-200/45",
                tabs.length <= 7 ? "min-w-0 w-full" : "min-w-[150px] max-w-[220px] shrink-0",
                active
                  ? isLight
                    ? "border-[#b9a18d] bg-[#f9eee6] text-[#3b2d24] shadow-[0_-8px_24px_rgba(107,75,55,0.10)]"
                    : "border-cyan-200/28 bg-cyan-300/[0.09] text-white shadow-[0_-10px_34px_rgba(45,212,191,0.13)]"
                  : isLight
                    ? "border-[#e6d7cd] bg-white/[0.58] text-[#7d6656] hover:border-[#cda98f] hover:bg-[#faf1ea]"
                    : "border-white/[0.075] bg-white/[0.025] text-slate-300 hover:border-cyan-200/16 hover:bg-white/[0.045]"
              )}
              onClick={() => onSelect(tab)}
              onKeyDown={(event) => {
                if (event.key === "ArrowRight") {
                  event.preventDefault();
                  selectByOffset(1);
                } else if (event.key === "ArrowLeft") {
                  event.preventDefault();
                  selectByOffset(-1);
                } else if (event.key === "Home") {
                  event.preventDefault();
                  if (tabs[0]) {
                    onSelect(tabs[0]);
                  }
                } else if (event.key === "End") {
                  event.preventDefault();
                  const lastTab = tabs[tabs.length - 1];
                  if (lastTab) {
                    onSelect(lastTab);
                  }
                }
              }}
            >
              <span
                className={cn(
                  "flex h-7 w-7 shrink-0 items-center justify-center rounded-[9px] border transition-colors",
                  active
                    ? isLight
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-emerald-200/24 bg-emerald-300/[0.12] text-emerald-100"
                    : isLight
                      ? "border-[#e7d8ce] bg-white/60 text-[#927968] group-hover/tab:text-[#5d493c]"
                      : "border-white/[0.08] bg-white/[0.035] text-slate-400 group-hover/tab:text-slate-200"
                )}
              >
                <Icon className="h-3.5 w-3.5" />
              </span>
              <span className="min-w-0 flex-1">
                <span className={cn("flex items-center gap-1.5 text-[10px] font-semibold", active ? (isLight ? "text-emerald-700" : "text-emerald-200") : (isLight ? "text-[#8d7463]" : "text-slate-400"))}>
                  {tab.hasLiveActivity ? (
                    <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300 shadow-[0_0_10px_rgba(34,211,238,0.75)] motion-safe:animate-pulse" />
                  ) : null}
                  <span className="truncate">{tab.label}</span>
                  <span className={cn("h-1 w-1 rounded-full", tabStatusDotClassName(tab.statusLabel))} />
                </span>
                <span className={cn("mt-0.5 block truncate text-[10px] font-semibold leading-4", isLight ? "text-[#413229]" : "text-slate-100")}>
                  {tab.title}
                </span>
              </span>
              <span
                className={cn(
                  "absolute inset-x-3 bottom-0 h-0.5 rounded-full transition-all duration-200",
                  active ? (isLight ? "bg-emerald-500 shadow-[0_0_12px_rgba(16,185,129,0.34)]" : "bg-emerald-300 shadow-[0_0_16px_rgba(52,211,153,0.75)]") : "bg-transparent"
                )}
              />
            </button>
          );
        })}
      </div>
      <button
        type="button"
        disabled={addDisabled}
        aria-label="Focus follow-up composer"
        title={addTitle}
        className={cn(
          "nodrag nopan mb-1 inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-[12px] border outline-none transition-all duration-200 focus-visible:ring-2 focus-visible:ring-cyan-200/45 disabled:cursor-not-allowed disabled:opacity-45",
          surfaceTheme === "light"
            ? "border-[#e1d1c6] bg-white/70 text-[#70594a] hover:border-[#cda98f] hover:bg-[#fbf1e9]"
            : "border-white/[0.08] bg-white/[0.045] text-slate-200 shadow-[0_8px_18px_rgba(0,0,0,0.16)] hover:border-cyan-200/22 hover:bg-cyan-300/[0.08] hover:text-cyan-100"
        )}
        onClick={onAdd}
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Plus className="h-4 w-4" />
      </button>
    </div>
  );
}

function tabStatusDotClassName(status: string) {
  switch (status) {
    case "completed":
      return "bg-emerald-300";
    case "running":
    case "queued":
      return "bg-cyan-300";
    case "stalled":
      return "bg-amber-300";
    case "cancelled":
      return "bg-rose-300";
    default:
      return "bg-slate-500";
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
      return "waiting for output";
    case "stalled":
      return "working silently";
    default:
      return liveRunCount > 0 ? `${liveRunCount} live run${liveRunCount === 1 ? "" : "s"}` : "no live runs right now";
  }
}

function readTaskPromptText(task: TaskFlowNode["data"]["task"]) {
  return task.mission?.trim() || task.title.trim() || "Untitled task";
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

function resolveFollowUpRuntimes(followUp: SubmittedTaskFollowUp, runs: RuntimeActivityRecord[]) {
  const runId = followUp.runId?.trim();

  if (runId) {
    const exactMatches = runs.filter((runtime) => runtime.runId === runId || runtime.id === runId || readMetadataString(runtime.metadata, "runId") === runId);

    if (exactMatches.length > 0) {
      return exactMatches.sort((left, right) => timestampNumberToMs(right.updatedAt) - timestampNumberToMs(left.updatedAt));
    }
  }

  const createdAtMs = Date.parse(followUp.createdAt);
  const sessionId = followUp.sessionId?.trim();
  const candidates = runs
    .filter((runtime) => {
      const runtimeUpdatedAt = timestampNumberToMs(runtime.updatedAt);
      const afterFollowUp = Number.isNaN(createdAtMs) || runtimeUpdatedAt === 0 || runtimeUpdatedAt >= createdAtMs - 5000;
      const sameSession = !sessionId || runtime.sessionId === sessionId || runtime.key.includes(sessionId);
      return afterFollowUp && sameSession;
    })
    .sort((left, right) => timestampNumberToMs(right.updatedAt) - timestampNumberToMs(left.updatedAt));

  return candidates;
}

function resolveRepresentativeFollowUpRuntime(runtimes: RuntimeActivityRecord[]) {
  return (
    runtimes.find((runtime) => hasMeaningfulRuntimeSubtitle(runtime)) ??
    runtimes.find((runtime) => runtime.status === "completed") ??
    runtimes[0] ??
    null
  );
}

function resolveBestFollowUpOutput(outputs: RuntimeOutputRecord[]) {
  return (
    outputs.find((output) => output.finalText?.trim()) ??
    outputs.find((output) => output.errorMessage?.trim()) ??
    outputs[0] ??
    null
  );
}

function filterFollowUpFeed(
  followUp: SubmittedTaskFollowUp,
  runtimes: RuntimeActivityRecord[],
  feed: TaskFeedEvent[]
) {
  if (runtimes.length > 0) {
    const runtimeIds = new Set(runtimes.map((runtime) => runtime.id));
    const runIds = new Set(runtimes.map((runtime) => runtime.runId).filter((value): value is string => Boolean(value)));
    return feed.filter((event) => {
      if (event.runtimeId && runtimeIds.has(event.runtimeId)) {
        return true;
      }

      return Boolean(event.runtimeId && runIds.has(event.runtimeId));
    });
  }

  const createdAtMs = Date.parse(followUp.createdAt);
  if (Number.isNaN(createdAtMs)) {
    return [];
  }

  return feed.filter((event) => {
    const eventTimestamp = Date.parse(event.timestamp);
    return !Number.isNaN(eventTimestamp) && eventTimestamp >= createdAtMs - 5000;
  });
}

function createFollowUpOptimisticFeed(followUp: SubmittedTaskFollowUp): TaskFeedEvent[] {
  return [
    {
      id: `${followUp.id}:submitted`,
      kind: "user",
      timestamp: followUp.createdAt,
      title: followUp.runId ? "Follow-up run started" : "Follow-up accepted",
      detail: followUp.runId
        ? `OpenClaw accepted this follow-up as run ${followUp.runId}. Waiting for live output.`
        : "OpenClaw accepted this follow-up. Waiting for the run to appear in the live feed.",
      runtimeId: followUp.runId ?? undefined
    }
  ];
}

function resolveFollowUpStatus(
  followUp: SubmittedTaskFollowUp,
  runtime: RuntimeActivityRecord | null,
  output: RuntimeOutputRecord | null | undefined,
  runtimes: RuntimeActivityRecord[] = []
) {
  const status = normalizeRuntimeStatus(followUp.status);
  if (status && status !== "running") {
    return status;
  }

  if (output?.finalText || followUp.summary) {
    return "completed";
  }

  if (runtime?.status === "completed" && hasMeaningfulRuntimeSubtitle(runtime)) {
    return "completed";
  }

  if (runtimes.some((entry) => entry.status === "cancelled")) {
    return "cancelled";
  }

  if (runtimes.some((entry) => entry.status === "stalled")) {
    return "stalled";
  }

  if (runtimes.some((entry) => entry.status === "completed")) {
    return "completed";
  }

  if (runtime?.status === "queued" || runtimes.some((entry) => entry.status === "queued")) {
    return "queued";
  }

  if (runtimes.some((entry) => entry.status === "running") && isFollowUpRuntimeGroupStale(runtimes)) {
    return "stalled";
  }

  return "running";
}

function isFollowUpRuntimeGroupStale(runtimes: RuntimeActivityRecord[]) {
  const latestUpdatedAt = Math.max(...runtimes.map((runtime) => timestampNumberToMs(runtime.updatedAt)));
  return latestUpdatedAt > 0 && Date.now() - latestUpdatedAt > FOLLOW_UP_STALE_MS;
}

function resolveFollowUpResultText(
  followUp: SubmittedTaskFollowUp,
  runtime: RuntimeActivityRecord | null,
  output: RuntimeOutputRecord | null | undefined
) {
  const finalText = output?.finalText?.trim();
  if (finalText) {
    return finalText;
  }

  const errorMessage = output?.errorMessage?.trim();
  if (errorMessage) {
    return errorMessage;
  }

  const runtimeSubtitle = runtime?.subtitle?.trim();
  if (runtime && runtimeSubtitle && hasMeaningfulRuntimeSubtitle(runtime)) {
    return runtimeSubtitle;
  }

  const message = resolveTaskFollowUpDisplayMessage(followUp) ?? followUp.message;

  if (runtime || followUp.runId) {
    return [
      "Operator follow-up:",
      message,
      "",
      "OpenClaw accepted this follow-up and AgentOS is tracking the live run.",
      "No agent answer has been captured yet."
    ].join("\n");
  }

  return formatFollowUpDetail(followUp);
}

function resolveFollowUpFooterLabel(
  followUp: SubmittedTaskFollowUp,
  runtime: RuntimeActivityRecord | null,
  output: RuntimeOutputRecord | null | undefined,
  runtimes: RuntimeActivityRecord[] = []
) {
  const status = resolveFollowUpStatus(followUp, runtime, output, runtimes);

  switch (status) {
    case "queued":
      return "follow-up queued";
    case "running":
      return "follow-up running";
    case "completed":
      return "follow-up completed";
    case "stalled":
      return "follow-up stalled";
    case "cancelled":
      return "follow-up cancelled";
    default:
      return "follow-up";
  }
}

function buildTaskCardInspectorContext(
  taskId: string,
  followUp: SubmittedTaskFollowUp,
  followUpIndex: number,
  cardNumber: number
): TaskCardInspectorContext {
  const message = resolveTaskFollowUpDisplayMessage(followUp) ?? followUp.message;
  return {
    taskId,
    cardNumber,
    followUpIndex,
    message,
    runId: followUp.runId ?? null,
    sessionId: followUp.sessionId ?? null,
    status: followUp.status ?? null,
    summary: followUp.summary ?? null,
    createdAt: followUp.createdAt
  };
}

function normalizeRuntimeStatus(value: string | null | undefined): RuntimeActivityRecord["status"] | null {
  switch (value) {
    case "queued":
    case "running":
    case "idle":
    case "completed":
    case "stalled":
    case "cancelled":
      return value;
    case "timeout":
    case "timed_out":
    case "failed":
    case "error":
      return "stalled";
    default:
      return null;
  }
}

function timestampNumberToMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value > 1_000_000_000_000 ? value : value * 1000;
}

function readMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasMeaningfulRuntimeSubtitle(runtime: RuntimeActivityRecord) {
  const value = runtime.subtitle.trim().toLowerCase();
  return Boolean(value && !["chat", "agent", "sessions.changed", "session.message", "openclaw runtime event", "gateway runtime event"].includes(value));
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

function readTaskFeedEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TaskFeedEvent[];
  }

  return value
    .filter(isTaskFeedEvent)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function mergeTaskFeedEvents(...eventGroups: TaskFeedEvent[][]) {
  const byId = new Map<string, TaskFeedEvent>();

  for (const event of eventGroups.flat()) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function mergeLocalTaskReviewMetadata(
  streamedTask: TaskFlowNode["data"]["task"] | undefined,
  localTask: TaskFlowNode["data"]["task"]
) {
  if (!streamedTask) {
    return localTask;
  }

  const reviewMetadata = Object.fromEntries(
    ["reviewStatus", "reviewAction", "reviewedAt", "reviewEvents"]
      .map((key) => [key, localTask.metadata[key]])
      .filter(([, value]) => value !== undefined)
  );

  if (Object.keys(reviewMetadata).length === 0) {
    return streamedTask;
  }

  return {
    ...streamedTask,
    metadata: {
      ...streamedTask.metadata,
      ...reviewMetadata
    }
  };
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
    typeof (value as TaskFeedEvent).kind === "string" &&
    typeof (value as TaskFeedEvent).timestamp === "string" &&
    typeof (value as TaskFeedEvent).title === "string" &&
    typeof (value as TaskFeedEvent).detail === "string"
  );
}

function isRunnerLogTaskEvent(event: TaskFeedEvent) {
  return event.id.startsWith("runner-log:");
}

function findLatestOutputEvidenceEvent(feed: TaskFeedEvent[]) {
  return [...feed]
    .reverse()
    .find((event) => event.kind === "assistant" || event.kind === "tool" || event.kind === "artifact") ?? null;
}

function resolveTaskIconClass(key: ReturnType<typeof resolveTaskNodeVisualTone>["key"], surfaceTheme: "dark" | "light") {
  if (surfaceTheme === "dark") {
    return resolveDarkTaskIconClass(key);
  }

  switch (key) {
    case "aborted":
      return "border-rose-200 bg-rose-50 text-rose-600";
    case "review":
      return "border-amber-200 bg-amber-50 text-amber-700";
    case "live":
      return "border-cyan-200 bg-cyan-50 text-cyan-700";
    case "success":
      return "border-emerald-200 bg-emerald-50 text-emerald-700";
    case "fresh":
      return "border-sky-200 bg-sky-50 text-sky-700";
    default:
      return "border-[#e2d1c5] bg-[#faf2eb] text-[#70594a]";
  }
}

function resolveDarkTaskIconClass(key: ReturnType<typeof resolveTaskNodeVisualTone>["key"]) {
  switch (key) {
    case "aborted":
      return "border-rose-300/20 bg-rose-400/[0.09] text-rose-100";
    case "review":
      return "border-amber-300/[0.22] bg-amber-400/[0.1] text-amber-100";
    case "live":
      return "border-cyan-300/20 bg-cyan-300/[0.09] text-cyan-100";
    case "success":
      return "border-emerald-300/[0.18] bg-emerald-300/[0.07] text-emerald-100";
    case "fresh":
      return "border-sky-300/20 bg-sky-300/[0.08] text-sky-100";
    default:
      return "border-white/[0.08] bg-white/[0.045] text-slate-200";
  }
}

function resolveLightTaskStatusTextClass(key: ReturnType<typeof resolveTaskNodeVisualTone>["key"]) {
  switch (key) {
    case "aborted":
      return "text-rose-700";
    case "review":
      return "text-amber-700";
    case "live":
      return "text-cyan-700";
    case "success":
      return "text-emerald-700";
    case "fresh":
      return "text-sky-700";
    default:
      return "text-[#8f7868]";
  }
}

function formatPrimaryActionLabel(action: ReturnType<typeof resolveTaskCardPrimaryAction>) {
  switch (action) {
    case "open-live-activity":
      return "Open live activity";
    case "view-result":
      return "View result";
    case "review-result":
      return "Review result";
    default:
      return "View details";
  }
}

function resolvePrimaryActionClass(action: ReturnType<typeof resolveTaskCardPrimaryAction>, surfaceTheme: "dark" | "light") {
  if (action === "review-result") {
    return surfaceTheme === "light"
      ? "bg-amber-600 text-white hover:bg-amber-700"
      : "bg-amber-300 text-amber-950 hover:bg-amber-200";
  }

  return surfaceTheme === "light"
    ? "bg-[#342820] text-white hover:bg-[#4b382d]"
    : "bg-white text-slate-950 hover:bg-slate-100";
}

type OperationRunTimelineEntry = {
  id: string;
  at: string;
  status: "completed" | "failed" | "skipped" | "missed" | "recovered";
  detail: string;
};

function OperationRunTimeline({ entries, nextRunAt, scheduleLabel, surfaceTheme }: {
  entries: OperationRunTimelineEntry[];
  nextRunAt: string | null;
  scheduleLabel: string | null;
  surfaceTheme: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";
  return (
    <div className={cn("mb-2 rounded-[11px] border px-2.5 py-2.5", isLight ? "border-[#eadbd0] bg-[#fffcf9]" : "border-white/[0.08] bg-white/[0.025]")}>
      <div className="flex items-center justify-between gap-3">
        <div><p className={cn("text-[10px] font-semibold", isLight ? "text-[#514136]" : "text-slate-200")}>Run history</p><p className={cn("mt-0.5 text-[9px]", isLight ? "text-[#9b745d]" : "text-slate-500")}>{scheduleLabel ?? "OpenClaw schedule"}</p></div>
        {nextRunAt ? <span className={cn("rounded-full border px-2 py-1 text-[9px]", isLight ? "border-primary/20 bg-primary/5 text-[#806856]" : "border-primary/20 bg-primary/10 text-primary")}>Next {formatTimelineDate(nextRunAt)}</span> : null}
      </div>
      {entries.length === 0 ? <p className={cn("mt-3 text-[10px]", isLight ? "text-[#806856]" : "text-slate-400")}>No completed run has been reported by OpenClaw yet.</p> : (
        <ScrollArea className="mt-3 h-[150px] w-full pr-3">
          <div className="space-y-2.5">
            {entries.map((entry) => <div key={entry.id} className="relative pl-3"><span className={cn("absolute left-0 top-1.5 h-1.5 w-1.5 rounded-full", entry.status === "failed" ? "bg-rose-400" : entry.status === "skipped" || entry.status === "missed" ? "bg-amber-400" : "bg-emerald-400")} /><div className="flex items-baseline justify-between gap-2"><span className={cn("text-[10px] font-medium", isLight ? "text-[#514136]" : "text-slate-200")}>{entry.status === "failed" ? "Failed" : entry.status === "skipped" ? "Skipped" : entry.status === "missed" ? "Possible missed run" : entry.status === "recovered" ? "Recovered automatically" : "Completed"}</span><span className={cn("shrink-0 text-[9px]", isLight ? "text-[#9b745d]" : "text-slate-500")}>{formatTimelineDate(entry.at)}</span></div><InteractiveContent text={entry.detail} className={cn("mt-0.5 text-[10px] leading-relaxed", isLight ? "text-[#806958]" : "text-slate-400")} compact /></div>)}
          </div>
        </ScrollArea>
      )}
    </div>
  );
}

function readOperationRunTimeline(feedValue: unknown, runHistoryValue: unknown, recoveryHistoryValue: unknown): OperationRunTimelineEntry[] {
  const entries: OperationRunTimelineEntry[] = readTaskFeedEvents(feedValue).map((event) => ({ id: event.id, at: event.timestamp, status: "completed", detail: event.detail }));
  if (Array.isArray(runHistoryValue)) {
    for (const value of runHistoryValue) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      const status = record.status;
      if (status !== "error" && status !== "skipped") continue;
      const at = typeof record.timestamp === "string" ? record.timestamp : null;
      if (!at) continue;
      entries.push({
        id: typeof record.id === "string" ? `run:${record.id}` : `run:${at}:${status}`,
        at,
        status: status === "error" ? "failed" : "skipped",
        detail: typeof record.error === "string" && record.error.trim() ? record.error : status === "error" ? "OpenClaw reported a failed run without an error detail." : "OpenClaw skipped this scheduled run."
      });
    }
  }
  if (Array.isArray(recoveryHistoryValue)) {
    for (const value of recoveryHistoryValue) {
      if (!value || typeof value !== "object") continue;
      const record = value as Record<string, unknown>;
      if (record.status !== "missed" && record.status !== "recovered") continue;
      if (typeof record.id !== "string" || typeof record.timestamp !== "string" || typeof record.detail !== "string") continue;
      entries.push({ id: record.id, at: record.timestamp, status: record.status, detail: record.detail });
    }
  }
  return Array.from(new Map(entries.map((entry) => [entry.id, entry])).values()).sort((left, right) => Date.parse(right.at) - Date.parse(left.at)).slice(0, 24);
}

function formatTimelineDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "unknown time" : date.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
}

function formatTaskRunReference(dispatchId: string | undefined, runId: string | undefined) {
  const value = dispatchId?.trim() || runId?.trim();

  if (!value) {
    return null;
  }

  return value.replace(/^dispatch-/, "").slice(0, 8);
}

function OperationScheduleControl({ jobId, label, cronExpression, timezone, scheduleKind, triggerAt, intervalMs, surfaceTheme, onSaved }: {
  jobId: string; label: string; cronExpression: string | null; timezone: string | null; scheduleKind: "at" | "every" | "cron" | null; triggerAt: string | null; intervalMs: number | null; surfaceTheme: "dark" | "light"; onSaved: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const controlRef = useRef<HTMLDivElement | null>(null);
  const [recurrence, setRecurrence] = useState<"weekdays" | "daily" | "weekly" | "custom">(inferRecurrence(cronExpression));
  const [time, setTime] = useState(inferCronTime(cronExpression));
  const [customCron, setCustomCron] = useState(cronExpression ?? "0 9 * * 1-5");
  const [zone, setZone] = useState(timezone ?? (Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC"));
  const [atValue, setAtValue] = useState(toDateTimeLocalValue(triggerAt));
  const [intervalSeconds, setIntervalSeconds] = useState(String(Math.max(1, Math.round((intervalMs ?? 60_000) / 1_000))));
  const [kind, setKind] = useState<"at" | "every" | "cron">(scheduleKind ?? "cron");
  const isLight = surfaceTheme === "light";
  const panelClass = isLight
    ? "border-[#dfcfc3] bg-[#fffcf9] text-[#46352b] shadow-[0_16px_34px_rgba(79,55,39,0.16)]"
    : "border-white/[0.1] bg-[#17111a] text-slate-100 shadow-[0_16px_34px_rgba(0,0,0,0.4)]";
  const mutedTextClass = isLight ? "text-slate-500" : "text-slate-400";
  const inputClass = isLight
    ? "border-[#e7d9cf] bg-white text-[#46352b] focus:border-primary/45"
    : "border-white/[0.1] bg-white/[0.05] text-slate-100 focus:border-primary/50 focus:bg-white/[0.08]";
  useEffect(() => {
    if (!open) return;
    const closeOnOutsidePointerDown = (event: PointerEvent) => {
      const target = event.target;
      if (!(target instanceof globalThis.Node) || !controlRef.current?.contains(target)) setOpen(false);
    };
    document.addEventListener("pointerdown", closeOnOutsidePointerDown, true);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointerDown, true);
  }, [open]);
  const save = async () => {
    let trigger: { kind: "every"; everyMs: number } | { kind: "at"; at: string } | { kind: "cron"; expression: string; timezone?: string };
    if (kind === "every") {
      const everyMs = Number(intervalSeconds) * 1_000;
      if (!Number.isFinite(everyMs) || everyMs < 1_000) return;
      trigger = { kind: "every", everyMs };
    } else if (kind === "at") {
      if (!atValue || Number.isNaN(Date.parse(atValue))) return;
      trigger = { kind: "at", at: new Date(atValue).toISOString() };
    } else {
      const expression = recurrence === "custom" ? customCron.trim() : recurringCron(recurrence, time);
      if (!expression) return;
      trigger = { kind: "cron", expression, timezone: zone.trim() || undefined };
    }
    setSaving(true);
    try {
      const response = await fetch("/api/operations", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action: "update", jobId, trigger }) });
      const result = await response.json() as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "OpenClaw rejected the schedule update.");
      setOpen(false);
      onSaved();
    } catch (error) { window.alert(error instanceof Error ? error.message : "Schedule update failed."); }
    finally { setSaving(false); }
  };
  return (
    <div ref={controlRef} className="nodrag nopan relative">
      <button type="button" title={label} onClick={(event) => { event.stopPropagation(); setOpen((current) => !current); }} onPointerDown={(event) => event.stopPropagation()} className="inline-flex h-8 max-w-[138px] items-center gap-1.5 rounded-[9px] border border-primary/35 bg-primary/10 px-2 text-[10px] font-semibold text-primary transition-colors hover:bg-primary/16">
        <CalendarClock className="h-3.5 w-3.5 shrink-0" /><span className="truncate">Schedule</span>
      </button>
      {open ? <div onClick={(event) => event.stopPropagation()} onPointerDown={(event) => event.stopPropagation()} className={cn("absolute bottom-[calc(100%+8px)] right-0 z-[80] w-[320px] rounded-[13px] border p-3", panelClass)}>
        <div className="flex items-center justify-between gap-3"><div><p className="text-[11px] font-semibold">Change schedule</p><p className={cn("mt-0.5 text-[9px]", mutedTextClass)}>{label}</p></div><CalendarClock className={cn("h-4 w-4", isLight ? "text-[#9b745d]" : "text-primary/80")} /></div>
        <div className={cn("mt-2.5 grid grid-cols-3 gap-1 rounded-[9px] border p-1", isLight ? "border-[#e7d9cf] bg-white" : "border-white/[0.08] bg-black/15")}>
          <ScheduleEditChoice label="Once" active={kind === "at"} onClick={() => setKind("at")} surfaceTheme={surfaceTheme} />
          <ScheduleEditChoice label="Interval" active={kind === "every"} onClick={() => setKind("every")} surfaceTheme={surfaceTheme} />
          <ScheduleEditChoice label="Recurring" active={kind === "cron"} onClick={() => setKind("cron")} surfaceTheme={surfaceTheme} />
        </div>
        <div className="mt-2.5">
          {kind === "every" ? <label className="block"><span className={cn("text-[9px] font-semibold uppercase tracking-[0.12em]", mutedTextClass)}>Repeat every</span><div className="mt-1.5 flex items-center gap-2"><input aria-label="Interval in seconds" type="number" min="1" value={intervalSeconds} onChange={(event) => setIntervalSeconds(event.target.value)} className={cn("h-9 w-20 rounded-[9px] border px-2 text-[11px] outline-none", inputClass)} /><span className={cn("text-[11px]", mutedTextClass)}>seconds</span></div></label> : null}
          {kind === "at" ? <label className="block"><span className={cn("text-[9px] font-semibold uppercase tracking-[0.12em]", mutedTextClass)}>Run at</span><input aria-label="One-time run date and time" type="datetime-local" value={atValue} onChange={(event) => setAtValue(event.target.value)} className={cn("mt-1.5 h-9 w-full rounded-[9px] border px-2 text-[11px] outline-none", inputClass)} /></label> : null}
          {kind === "cron" ? <><div className="grid grid-cols-4 gap-1"><ScheduleEditChoice label="Weekdays" active={recurrence === "weekdays"} onClick={() => setRecurrence("weekdays")} surfaceTheme={surfaceTheme} /><ScheduleEditChoice label="Daily" active={recurrence === "daily"} onClick={() => setRecurrence("daily")} surfaceTheme={surfaceTheme} /><ScheduleEditChoice label="Monday" active={recurrence === "weekly"} onClick={() => setRecurrence("weekly")} surfaceTheme={surfaceTheme} /><ScheduleEditChoice label="Custom" active={recurrence === "custom"} onClick={() => setRecurrence("custom")} surfaceTheme={surfaceTheme} /></div>{recurrence === "custom" ? <input aria-label="Custom cron expression" value={customCron} onChange={(event) => setCustomCron(event.target.value)} placeholder="Cron expression" className={cn("mt-2 h-8 w-full rounded-[8px] border px-2 text-[10px] outline-none", inputClass)} /> : <div className="mt-2 flex items-center gap-2"><span className={cn("text-[10px]", mutedTextClass)}>At</span><input aria-label="Recurring run time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className={cn("h-8 flex-1 rounded-[8px] border px-2 text-[10px] outline-none", inputClass)} /></div>}<input aria-label="Schedule timezone" value={zone} onChange={(event) => setZone(event.target.value)} placeholder="Timezone" className={cn("mt-2 h-8 w-full rounded-[8px] border px-2 text-[10px] outline-none", inputClass)} /></> : null}
        </div>
        <div className="mt-3 flex items-center justify-end gap-2"><button type="button" onClick={() => setOpen(false)} className={cn("h-8 rounded-[8px] px-2.5 text-[10px] font-medium transition-colors", isLight ? "text-[#806856] hover:bg-[#f8f0ea]" : "text-slate-400 hover:bg-white/[0.06]")}>Cancel</button><button type="button" disabled={saving} onClick={() => void save()} className="h-8 rounded-[8px] bg-primary px-3 text-[10px] font-semibold text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50">{saving ? "Saving…" : "Save changes"}</button></div>
      </div> : null}
    </div>
  );
}

function ScheduleEditChoice({ label, active, onClick, surfaceTheme }: { label: string; active: boolean; onClick: () => void; surfaceTheme: "dark" | "light" }) { return <button type="button" onClick={onClick} className={cn("h-7 rounded-[6px] border px-1 text-center text-[9px] font-medium transition-colors", active ? "border-primary/35 bg-primary/10 text-primary" : surfaceTheme === "light" ? "border-transparent text-[#806856] hover:bg-[#f8f0ea] hover:text-[#46352b]" : "border-transparent text-slate-400 hover:bg-white/[0.06] hover:text-slate-200")}>{label}</button>; }
function inferRecurrence(value: string | null) { if (value?.endsWith("1-5")) return "weekdays"; if (value?.endsWith(" *")) return "daily"; if (value?.endsWith(" 1")) return "weekly"; return "custom"; }
function inferCronTime(value: string | null) { const parts = value?.trim().split(/\s+/) ?? []; return parts.length >= 2 ? `${String(parts[1]).padStart(2, "0")}:${String(parts[0]).padStart(2, "0")}` : "09:00"; }
function recurringCron(recurrence: "weekdays" | "daily" | "weekly" | "custom", time: string) { const [hour = "9", minute = "0"] = time.split(":"); return recurrence === "daily" ? `${Number(minute)} ${Number(hour)} * * *` : recurrence === "weekly" ? `${Number(minute)} ${Number(hour)} * * 1` : `${Number(minute)} ${Number(hour)} * * 1-5`; }
function toDateTimeLocalValue(value: string | null) { if (!value || Number.isNaN(Date.parse(value))) return ""; const date = new Date(value); const offset = date.getTimezoneOffset() * 60_000; return new Date(date.getTime() - offset).toISOString().slice(0, 16); }

function TaskMenuButton({
  icon: Icon,
  label,
  destructive = false,
  disabled = false,
  onClick,
  surfaceTheme
}: {
  icon: typeof MoreHorizontal;
  label: string;
  destructive?: boolean;
  disabled?: boolean;
  onClick: () => void;
  surfaceTheme: "dark" | "light";
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
            ? surfaceTheme === "light"
              ? "text-rose-700 hover:bg-rose-50 hover:text-rose-800"
              : "text-rose-100 hover:bg-rose-400/10 hover:text-rose-50"
            : surfaceTheme === "light"
              ? "text-[#513f33] hover:bg-[#f8eee7] hover:text-[#2f241d]"
              : "text-slate-200 hover:bg-white/[0.06] hover:text-white"
      )}
      onClick={onClick}
    >
      <Icon className={cn("h-3.5 w-3.5", destructive ? (surfaceTheme === "light" ? "text-rose-500" : "text-rose-300") : (surfaceTheme === "light" ? "text-[#9b745d]" : "text-cyan-300"))} />
      <span>{label}</span>
    </button>
  );
}

function readNonNegativeMetric(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function formatCompactTaskMetric(value: number) {
  return new Intl.NumberFormat(undefined, {
    notation: value >= 1_000 ? "compact" : "standard",
    maximumFractionDigits: value >= 1_000 ? 1 : 0
  }).format(value);
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
