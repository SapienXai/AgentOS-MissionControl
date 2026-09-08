"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  ArrowLeft,
  Bot,
  ClipboardList,
  Cpu,
  FileJson,
  FolderGit2,
  FolderKanban,
  Lock,
  MessageSquareText,
  MoreHorizontal,
  Radar,
  RotateCcw,
  Pencil,
  TerminalSquare,
  X
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { AgentChatDrawer } from "@/components/mission-control/agent-chat-drawer";
import { resolveAgentStatusDotTone } from "@/components/mission-control/node-visual-tones";
import {
  resolveInspectorSummaryAction,
  resolveInspectorSurfaceTone
} from "@/components/mission-control/inspector-visuals";
import { InteractiveContent } from "@/components/mission-control/interactive-content";
import { RailTooltip } from "@/components/mission-control/rail-tooltip";
import { AgentRuntimeSummaryPanel } from "@/components/mission-control/inspector/agent-panel";
import { OverviewGatewaySummaryPanel } from "@/components/mission-control/inspector/overview-panel";
import { RuntimeEvidencePanel } from "@/components/mission-control/inspector/runtime-panel";
import { TaskSessionTruthPanel } from "@/components/mission-control/inspector/task-panel";
import {
  buildInspectorAgentRuntimeView,
  buildInspectorRuntimeEvidenceView,
  buildInspectorTaskSessionView,
  resolvePollingFallbackNotice
} from "@/components/mission-control/inspector/inspector-utils";
import {
  readTaskReviewAction,
  readTaskReviewReviewedAt,
  resolveEffectiveTaskReviewStatus,
  resolveTaskReviewBadgeLabel,
  resolveTaskReviewSummary
} from "@/components/mission-control/task-review-state";
import { resolveTaskDispatchIssueDetail } from "@/components/mission-control/task-node-status";
import {
  useInspectorRuntimeOutput,
  useInspectorTaskDetailStream
} from "@/components/mission-control/use-inspector-panel-data";
import { useModelCatalog } from "@/hooks/use-model-catalog";
import { isSelectableModel } from "@/lib/openclaw/domains/model-management";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge as UiBadge, type BadgeProps } from "@/components/ui/badge";
import {
  formatAgentFileAccessLabel,
  formatAgentInstallScopeLabel,
  formatAgentMissingToolBehaviorLabel,
  formatAgentNetworkAccessLabel,
  formatAgentPresetLabel,
  getAgentPresetMeta
} from "@/lib/openclaw/agent-presets";
import {
  badgeVariantForRuntimeStatus,
  compactPath,
  compactMissionText,
  formatContextWindow,
  formatAgentDisplayName,
  formatRelativeTime,
  formatTokens,
  resolveRelativeTimeReferenceMs,
  shortId
} from "@/lib/openclaw/presenters";
import type {
  MissionControlSnapshot,
  MissionResponse,
  RuntimeCreatedFile,
  RuntimeOutputRecord,
  TaskDetailRecord,
  TaskFeedEvent,
  WorkItemRecord,
  WorkspaceResourceState
} from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import type { AgentDetailFocus, TaskCardInspectorContext } from "@/components/mission-control/canvas-types";

type InspectorPanelProps = {
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  selectedNodeId: string | null;
  activeTaskCard?: TaskCardInspectorContext | null;
  agentDetailFocus?: AgentDetailFocus | null;
  lastMission: MissionResponse | null;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onConfigureAgentCapabilities?: (agentId: string, focus: "skills" | "tools") => void;
  onConnectModelProvider?: (provider: string) => void;
  onAbortTask?: (task: WorkItemRecord) => void;
  onReviewTask?: (task: WorkItemRecord) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  detailExpanded: boolean;
  onExpandDetail: () => void;
  onSelectScope: (scope: InspectorScopeShortcut) => void;
  activeTab: "overview" | "chat" | "output" | "files" | "raw";
  onActiveTabChange: (tab: "overview" | "chat" | "output" | "files" | "raw") => void;
  onBackFromChat?: () => void;
};

type InspectorPanelTab = InspectorPanelProps["activeTab"];
type InspectorScopeShortcut = "workspace" | "agent" | "tasks";
type AgentRuntimeRecord = MissionControlSnapshot["runtimes"][number];

const INSPECTOR_BADGE_CLASS_NAME =
  "!h-4 !px-1.5 !py-0 !text-[8px] !leading-none !tracking-[0.1em] !whitespace-nowrap";

const STEER_SUGGESTIONS = [
  "Focus on tests",
  "Prioritize UI polish",
  "Avoid changing public API",
  "Continue from the latest failure"
] as const;

type RunningTaskControlMode = "steer" | "inject";

function Badge({ className, ...props }: BadgeProps) {
  return <UiBadge {...props} className={cn(INSPECTOR_BADGE_CLASS_NAME, className)} />;
}

export function InspectorPanel(props: InspectorPanelProps) {
  return <InspectorPanelContent key={props.selectedNodeId ?? "overview"} {...props} />;
}

function InspectorPanelContent({
  snapshot,
  surfaceTheme,
  selectedNodeId,
  activeTaskCard,
  agentDetailFocus,
  lastMission,
  onRefresh,
  onSnapshotChange,
  onConfigureAgentCapabilities,
  onConnectModelProvider,
  onAbortTask,
  onReviewTask,
  collapsed,
  onToggleCollapsed,
  detailExpanded,
  onExpandDetail,
  onSelectScope,
  activeTab,
  onActiveTabChange,
  onBackFromChat
}: InspectorPanelProps) {
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const selectedWorkspace = snapshot.workspaces.find((workspace) => workspace.id === selectedNodeId);
  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedNodeId);
  const selectedTask = snapshot.tasks.find((task) => task.id === selectedNodeId);
  const selectedTaskCard =
    selectedTask && activeTaskCard?.taskId === selectedTask.id ? activeTaskCard : null;
  const selectedRuntime = snapshot.runtimes.find((runtime) => runtime.id === selectedNodeId);
  const selectedModel = snapshot.models.find((model) => model.id === selectedNodeId);
  const isOptimisticTask = Boolean(selectedTask?.metadata.optimistic);
  const selectedEntity =
    selectedWorkspace || selectedAgent || selectedTask || selectedRuntime || selectedModel || null;
  const activeScope: InspectorScopeShortcut =
    selectedWorkspace || selectedModel
      ? "workspace"
      : selectedAgent
        ? "agent"
        : selectedTask || selectedRuntime
          ? "tasks"
          : "workspace";
  const selectedRuntimeId = selectedRuntime?.id ?? null;
  const selectedTaskId = selectedTask?.id ?? null;
  const selectedTaskDispatchId =
    selectedTask && typeof selectedTask.dispatchId === "string" ? selectedTask.dispatchId : null;
  const { runtimeOutput, runtimeOutputError } = useInspectorRuntimeOutput(selectedRuntimeId);
  const optimisticTaskDetail = useMemo(
    () => (isOptimisticTask && selectedTask ? createOptimisticTaskDetail(selectedTask) : null),
    [isOptimisticTask, selectedTask]
  );
  const canStreamTaskDetail = Boolean(selectedTaskId) && (!isOptimisticTask || Boolean(selectedTaskDispatchId));
  const { taskDetail, taskDetailError, taskDetailNotice } = useInspectorTaskDetailStream({
    selectedTaskId,
    canStreamTaskDetail,
    selectedTaskDispatchId
  });
  const resolvedRuntimeOutput =
    runtimeOutput && runtimeOutput.runtimeId === selectedRuntimeId ? runtimeOutput : null;
  const resolvedRuntimeOutputError =
    runtimeOutputError?.runtimeId === selectedRuntimeId ? runtimeOutputError.message : null;
  const resolvedTaskDetail =
    taskDetail &&
    (taskDetail.task.id === selectedTaskId ||
      (selectedTaskDispatchId &&
        typeof taskDetail.task.dispatchId === "string" &&
        taskDetail.task.dispatchId === selectedTaskDispatchId))
      ? taskDetail
      : null;
  const resolvedTaskDetailError =
    taskDetailError?.taskId === selectedTaskId ? taskDetailError.message : null;
  const resolvedTaskDetailNotice =
    taskDetailNotice?.taskId === selectedTaskId ? taskDetailNotice.message : null;
  const baseTaskDetail = resolvedTaskDetail ?? optimisticTaskDetail;
  const effectiveTaskDetail = filterTaskDetailForCard(baseTaskDetail, selectedTaskCard);
  const taskDetailLoading =
    canStreamTaskDetail && !resolvedTaskDetail && !resolvedTaskDetailError;
  const runtimeOutputLoading =
    Boolean(selectedRuntimeId) && !resolvedRuntimeOutput && !resolvedRuntimeOutputError;
  const showChatTab = Boolean(selectedAgent);
  const showOutputTab = Boolean(selectedRuntime || selectedTask);
  const showFilesTab = Boolean(selectedRuntime || selectedTask);
  const visibleActiveTab =
    activeTab === "chat" && !showChatTab
      ? "overview"
      : activeTab === "output" && !showOutputTab
        ? "overview"
        : activeTab === "files" && !showFilesTab
          ? "overview"
          : activeTab === "raw" && !detailExpanded
            ? "overview"
            : activeTab;
  const isChatView = visibleActiveTab === "chat" && Boolean(selectedAgent);
  const outputTabLabel = selectedTask ? "Activity" : "Output";
  const selectedLabel =
    selectedWorkspace?.name ||
    (selectedAgent ? formatAgentDisplayName(selectedAgent) : null) ||
    (selectedTaskCard
      ? compactMissionText(selectedTaskCard.message || `Follow-up ${selectedTaskCard.cardNumber - 1}`, 48) || "Follow-up"
      : selectedTask ? compactMissionText(selectedTask.title || selectedTask.mission || "Task", 48) || "Task" : null) ||
    (selectedRuntime ? compactMissionText(selectedRuntime.title || "Run", 48) || "Run" : null) ||
    selectedModel?.name ||
    "Gateway overview";
  const selectedDetail = selectedWorkspace
    ? "workspace"
    : selectedAgent
      ? "agent"
      : selectedTask
        ? selectedTaskCard
          ? `follow-up ${selectedTaskCard.cardNumber}`
          : "task"
      : selectedRuntime
        ? "run"
        : selectedModel
          ? "model"
          : "selection";
  const detailTabs = useMemo(
    () =>
      [
        { id: "overview", label: "Summary", enabled: true },
        { id: "chat", label: "Chat", enabled: showChatTab },
        { id: "output", label: selectedTask ? "Activity" : outputTabLabel, enabled: showOutputTab },
        { id: "files", label: "Files", enabled: showFilesTab },
        { id: "raw", label: "Debug", enabled: detailExpanded && activeTab === "raw" }
      ] satisfies Array<{ id: InspectorPanelTab; label: string; enabled: boolean }>,
    [activeTab, detailExpanded, outputTabLabel, selectedTask, showChatTab, showFilesTab, showOutputTab]
  );
  const visibleDetailTabs = useMemo(() => detailTabs.filter((item) => item.enabled), [detailTabs]);
  const scopeItems = [
    { id: "workspace", label: "Workspace", icon: FolderKanban },
    { id: "agent", label: "Agent", icon: Bot },
    { id: "tasks", label: "Tasks", icon: ClipboardList }
  ] satisfies Array<{ id: InspectorScopeShortcut; label: string; icon: LucideIcon }>;
  const handleScopeClick = (scope: InspectorScopeShortcut) => {
    if (!collapsed && activeScope === scope) {
      onToggleCollapsed();
      return;
    }

    onSelectScope(scope);
  };
  const isLight = surfaceTheme === "light";
  const surfaceTone = resolveInspectorSurfaceTone(surfaceTheme);

  return (
    <div
      style={isLight ? { backdropFilter: "none", WebkitBackdropFilter: "none" } : undefined}
      className={cn(
        "mission-inspector panel-surface flex h-full flex-row-reverse overflow-hidden rounded-none border-0 lg:rounded-l-[22px] lg:border lg:border-r-0",
        isLight ? "backdrop-blur-none" : "backdrop-blur-2xl",
        surfaceTone.shell,
        isLight && "mission-inspector-light"
      )}
    >
      {collapsed ? (
        <div
          className={cn(
            "hidden h-full shrink-0 flex-col items-center px-1.5 py-3 lg:flex",
            surfaceTone.rail,
            "w-full lg:rounded-l-[22px]"
          )}
        >
          <div className="flex flex-1 flex-col items-center gap-1.5">
            {scopeItems.map((item) => (
              <InspectorRailButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeScope === item.id}
                surfaceTheme={surfaceTheme}
                tooltipSide="left"
                onClick={() => handleScopeClick(item.id)}
              />
            ))}
          </div>

          <div className="mt-2.5 flex flex-col items-center gap-1">
            <Badge
              variant="muted"
              className="h-5 min-w-[34px] rounded-full px-1.5 py-0 text-[8px] leading-none tracking-[0.14em]"
            >
              {selectedEntity ? "live" : "idle"}
            </Badge>
            <p className="max-w-[44px] truncate text-center text-[8px] uppercase tracking-[0.14em] text-slate-500">
              {selectedDetail}
            </p>
          </div>
        </div>
      ) : null}

      {!collapsed ? (
        <div className={cn("min-w-0 flex-1", surfaceTone.content)}>
          <div
            className={cn(
              "mission-scroll inspector-scroll flex h-full min-h-0 flex-col overscroll-contain",
              isChatView ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            <div
              className={cn(
                "shrink-0 px-3",
                isChatView
                  ? "pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))] lg:pb-1 lg:pt-2"
                  : "pb-2 pt-3"
              )}
            >
              <div className="flex items-start justify-between gap-3">
                {isChatView ? (
                  <button
                    type="button"
                    aria-label="Back from agent chat"
                    onClick={onBackFromChat ?? (() => onActiveTabChange("overview"))}
                    className={cn(
                      "flex h-9 w-9 shrink-0 items-center justify-center rounded-full transition-colors lg:hidden",
                      surfaceTone.subtleButton
                    )}
                  >
                    <ArrowLeft className="h-4 w-4" />
                  </button>
                ) : null}
                <div className="min-w-0 flex-1">
                  {!isChatView ? (
                    <p className={cn("text-[9px] font-semibold uppercase tracking-[0.24em]", surfaceTone.eyebrow)}>{selectedDetail}</p>
                  ) : null}
                  <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", !isChatView && "mt-1")}>
                    <h2 className={cn("min-w-0 max-w-full truncate font-display text-[1.08rem] leading-[1.15]", surfaceTone.title)}>
                      {selectedLabel}
                    </h2>
                    {isChatView ? (
                      <span
                        aria-label={selectedAgent?.status ?? "unknown"}
                        title={selectedAgent?.status ?? "unknown"}
                        className={cn(
                          "h-2 w-2 shrink-0 rounded-full",
                          selectedAgent ? resolveAgentStatusDotTone(selectedAgent.status) : "bg-slate-500"
                        )}
                      />
                    ) : (
                      <Badge
                        variant="muted"
                        className={cn("h-5 shrink-0 rounded-full px-2 py-0 text-[8px] leading-none tracking-[0.14em]", surfaceTone.fact, surfaceTone.title)}
                      >
                        {selectedDetail}
                      </Badge>
                    )}
                  </div>
                  {!isChatView ? (
                    <p className={cn("mt-1 line-clamp-1 text-[11px] leading-4", surfaceTone.mutedText)}>
                      {selectedTask
                      ? `${selectedTask.runtimeCount} runs · ${selectedTask.liveRunCount} live · ${formatRelativeTime(selectedTask.updatedAt, relativeTimeReferenceMs)}`
                      : selectedRuntime
                        ? `Run ${shortId(selectedRuntime.runId || selectedRuntime.id, 10)} · ${selectedRuntime.status} · ${formatRelativeTime(selectedRuntime.updatedAt, relativeTimeReferenceMs)}`
                        : selectedAgent
                          ? `${selectedAgent.activeRuntimeIds.length} active runs`
                        : selectedWorkspace
                            ? `${selectedWorkspace.agentIds.length} agents attached`
                            : selectedModel
                              ? `${selectedModel.provider} model`
                              : "Live gateway context"}
                    </p>
                  ) : null}
                  {isChatView && selectedAgent ? (
                    <p className={cn("mt-1 truncate text-[11px] leading-4 lg:hidden", surfaceTone.mutedText)}>
                      {selectedAgent.currentAction?.trim() || `${selectedAgent.status} · Ready to chat`}
                    </p>
                  ) : null}
                </div>

                <div className="flex shrink-0 items-center gap-1">
                  <div
                    aria-label="Inspector scope"
                    className="hidden items-center gap-1 lg:flex"
                  >
                    {scopeItems.map((item) => (
                      <InspectorRailButton
                        key={item.id}
                        icon={item.icon}
                        label={item.label}
                        active={activeScope === item.id}
                        surfaceTheme={surfaceTheme}
                        tooltipSide="bottom"
                        size="header"
                        onClick={() => handleScopeClick(item.id)}
                      />
                    ))}
                  </div>
                  {!isChatView ? (
                    <button
                    type="button"
                    aria-label="Open debug data"
                    onClick={() => {
                      if (!detailExpanded) onExpandDetail();
                      onActiveTabChange("raw");
                    }}
                    className={cn("flex h-8 w-8 items-center justify-center rounded-[9px] border transition-colors", surfaceTone.subtleButton)}
                  >
                    <MoreHorizontal className="h-3.5 w-3.5" />
                    </button>
                  ) : null}
                  <button
                    type="button"
                    aria-label="Close inspector"
                    onClick={onToggleCollapsed}
                    className={cn(
                      "h-8 w-8 items-center justify-center rounded-[9px] border transition-colors",
                      isChatView ? "hidden lg:flex" : "flex",
                      surfaceTone.subtleButton
                    )}
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>

              <div
                aria-label="Inspector scope"
                className={cn(
                  "mt-3 grid-cols-3 gap-1 rounded-[10px] border p-1 lg:hidden",
                  isChatView ? "hidden" : "grid",
                  surfaceTone.tabTrack
                )}
              >
                {scopeItems.map((item) => {
                  const Icon = item.icon;
                  const active = activeScope === item.id;

                  return (
                    <button
                      key={item.id}
                      type="button"
                      aria-label={`Show ${item.label} inspector`}
                      aria-pressed={active}
                      className={cn(
                        "inline-flex min-w-0 items-center justify-center gap-1.5 rounded-[7px] border border-transparent px-2 py-2 text-[10px] font-medium transition-colors",
                        active ? surfaceTone.tabActive : surfaceTone.tabIdle
                      )}
                      onClick={() => onSelectScope(item.id)}
                    >
                      <Icon className="h-3.5 w-3.5 shrink-0" />
                      <span className="truncate">{item.label}</span>
                    </button>
                  );
                })}
              </div>

              <div
                className={cn(
                  "overflow-hidden rounded-[10px] border p-1",
                  isChatView ? "mt-2 hidden lg:grid" : "mt-3 grid",
                  surfaceTone.tabTrack
                )}
                style={{ gridTemplateColumns: `repeat(${visibleDetailTabs.length}, minmax(0, 1fr))` }}
              >
                {visibleDetailTabs.map((item) => (
                  <InspectorTabButton
                    key={item.id}
                    label={item.label}
                    active={visibleActiveTab === item.id}
                    surfaceTone={surfaceTone}
                    onClick={() => onActiveTabChange(item.id)}
                  />
                ))}
              </div>
            </div>

            <div
              className={cn(
                "flex-1 px-4 pb-4 pt-0",
                isChatView && "min-h-0 overflow-hidden pb-[max(0.75rem,env(safe-area-inset-bottom))] lg:pb-4"
              )}
            >
              <AnimatePresence mode="wait">
                <motion.div
                  key={selectedNodeId || "overview"}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={cn("space-y-3", isChatView && "flex h-full min-h-0 flex-col space-y-0")}
                >
                  {visibleActiveTab === "overview" ? (
                    <>
                      <InspectorSummary
                        snapshot={snapshot}
                        surfaceTheme={surfaceTheme}
                        selectedWorkspace={selectedWorkspace}
                        selectedAgent={selectedAgent}
                        selectedTask={selectedTask}
                        selectedRuntime={selectedRuntime}
                        selectedModel={selectedModel}
                        taskDetail={effectiveTaskDetail}
                        runtimeOutput={resolvedRuntimeOutput}
                        runtimeOutputLoading={runtimeOutputLoading}
                        onOpenActivity={() => onActiveTabChange("output")}
                        onOpenChat={() => onActiveTabChange("chat")}
                        onOpenDetail={onExpandDetail}
                        onReviewTask={onReviewTask}
                        onAbortTask={onAbortTask}
                        onControlComplete={onRefresh}
                      />
                      {detailExpanded ? (
                        <>
                          {selectedWorkspace ? <WorkspaceContent snapshot={snapshot} workspaceId={selectedWorkspace.id} /> : null}
                          {selectedAgent ? (
                            <AgentContent
                              snapshot={snapshot}
                              agentId={selectedAgent.id}
                              focusSection={agentDetailFocus}
                              onConfigureAgentCapabilities={onConfigureAgentCapabilities}
                            />
                          ) : null}
                          {selectedTask ? (
                            <TaskContent
                              snapshot={snapshot}
                              task={selectedTask}
                              taskId={selectedTask.id}
                              taskDetail={effectiveTaskDetail}
                              taskDetailLoading={taskDetailLoading}
                              taskDetailError={resolvedTaskDetailError}
                              taskDetailNotice={resolvedTaskDetailNotice}
                            />
                          ) : null}
                          {selectedRuntime ? (
                            <RuntimeContent
                              snapshot={snapshot}
                              runtimeId={selectedRuntime.id}
                              runtimeOutput={resolvedRuntimeOutput}
                              runtimeOutputLoading={runtimeOutputLoading}
                              runtimeOutputError={resolvedRuntimeOutputError}
                              onSnapshotChange={onSnapshotChange}
                              onRefresh={onRefresh}
                            />
                          ) : null}
                          {selectedModel ? <ModelContent snapshot={snapshot} modelId={selectedModel.id} /> : null}
                          {!selectedEntity ? <GatewayOverview snapshot={snapshot} lastMission={lastMission} /> : null}
                        </>
                      ) : null}
                    </>
                  ) : null}

                  {selectedAgent ? (
                    <div
                      className={cn(
                        "min-h-0 flex-1",
                        isChatView ? "block" : "hidden"
                      )}
                      aria-hidden={!isChatView}
                    >
                      <AgentChatDrawer
                        agent={selectedAgent}
                        snapshot={snapshot}
                        surfaceTheme={surfaceTheme}
                        isVisible={isChatView}
                        onRefresh={onRefresh}
                        onSnapshotChange={onSnapshotChange}
                        onConnectModelProvider={onConnectModelProvider}
                      />
                    </div>
                  ) : null}

                  {visibleActiveTab === "output" && selectedTask ? (
                    <TaskFeedContent
                      task={selectedTask}
                      basePath={resolveTaskWorkspacePath(snapshot, selectedTask, effectiveTaskDetail?.runs)}
                      taskDetail={effectiveTaskDetail}
                      taskDetailLoading={taskDetailLoading}
                      taskDetailError={resolvedTaskDetailError}
                      taskDetailNotice={resolvedTaskDetailNotice}
                      onAbortTask={onAbortTask}
                      onControlComplete={onRefresh}
                    />
                  ) : null}

                  {visibleActiveTab === "output" && selectedRuntime ? (
                    <RuntimeOutputContent
                      runtime={selectedRuntime}
                      basePath={snapshot.workspaces.find((entry) => entry.id === selectedRuntime.workspaceId)?.path}
                      runtimeOutput={resolvedRuntimeOutput}
                      runtimeOutputLoading={runtimeOutputLoading}
                      runtimeOutputError={resolvedRuntimeOutputError}
                    />
                  ) : null}

                  {visibleActiveTab === "files" && selectedTask ? (
                    <TaskFilesContent
                      snapshot={snapshot}
                      task={selectedTask}
                      taskDetail={effectiveTaskDetail}
                    />
                  ) : null}

                  {visibleActiveTab === "files" && selectedRuntime ? (
                    <RuntimeFilesContent runtime={selectedRuntime} runtimeOutput={resolvedRuntimeOutput} />
                  ) : null}

                  {visibleActiveTab === "raw" ? (
                    <pre className="overflow-x-auto rounded-[16px] border border-sky-100/[0.08] bg-slate-950/[0.62] p-3 text-[11px] leading-5 text-slate-300 shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]">
                      {JSON.stringify(
                        selectedTask && effectiveTaskDetail
                          ? effectiveTaskDetail
                          : selectedRuntime && resolvedRuntimeOutput
                            ? { runtime: selectedRuntime, output: resolvedRuntimeOutput }
                            : selectedEntity || snapshot,
                        null,
                        2
                      )}
                    </pre>
                  ) : null}
                </motion.div>
              </AnimatePresence>
            </div>

            {isChatView ? null : (
              <div className="shrink-0 px-4 pb-4 pt-0">
                <div className="rounded-[16px] border border-sky-100/[0.08] bg-[linear-gradient(180deg,rgba(8,20,34,0.78),rgba(5,13,24,0.78))] p-3 shadow-[0_12px_34px_rgba(0,0,0,0.22),inset_0_1px_0_rgba(255,255,255,0.04)]">
                  <div className="flex items-center gap-2.5">
                    <div className="flex h-9 w-9 items-center justify-center rounded-[11px] border border-sky-100/[0.1] bg-white/[0.045] text-sky-200/75">
                      <Radar className="h-3.5 w-3.5" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-display text-[13px] text-white">
                        {selectedTask
                          ? `${selectedTask.runtimeCount} runs`
                          : selectedRuntime
                            ? `Run ${shortId(selectedRuntime.runId || selectedRuntime.id, 10)}`
                            : selectedAgent
                              ? `${selectedAgent.activeRuntimeIds.length} active runs`
                              : selectedWorkspace
                                ? `${selectedWorkspace.agentIds.length} agents`
                                : selectedModel
                                  ? selectedModel.provider
                                  : "Gateway overview"}
                      </p>
                      <p className="mt-0.5 text-[11px] text-slate-400">
                        {selectedDetail} ·{" "}
                        {selectedTask
                          ? `${effectiveTaskDetail?.liveFeed.length ?? 0} live feed events`
                          : selectedRuntime
                            ? `${resolvedRuntimeOutput?.items.length ?? 0} transcript entries`
                            : selectedAgent
                              ? `${selectedAgent.activeRuntimeIds.length} tracked runs`
                              : selectedWorkspace
                                ? `${selectedWorkspace.agentIds.length} attached`
                                : `${snapshot.presence.length} live beacons`}
                      </p>
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function InspectorSummary({
  snapshot,
  surfaceTheme,
  selectedWorkspace,
  selectedAgent,
  selectedTask,
  selectedRuntime,
  selectedModel,
  taskDetail,
  runtimeOutput,
  runtimeOutputLoading,
  onOpenActivity,
  onOpenChat,
  onOpenDetail,
  onReviewTask,
  onAbortTask,
  onControlComplete
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  selectedWorkspace: MissionControlSnapshot["workspaces"][number] | undefined;
  selectedAgent: MissionControlSnapshot["agents"][number] | undefined;
  selectedTask: MissionControlSnapshot["tasks"][number] | undefined;
  selectedRuntime: MissionControlSnapshot["runtimes"][number] | undefined;
  selectedModel: MissionControlSnapshot["models"][number] | undefined;
  taskDetail: TaskDetailRecord | null;
  runtimeOutput: RuntimeOutputRecord | null;
  runtimeOutputLoading: boolean;
  onOpenActivity: () => void;
  onOpenChat: () => void;
  onOpenDetail: () => void;
  onReviewTask?: (task: WorkItemRecord) => void;
  onAbortTask?: (task: WorkItemRecord) => void;
  onControlComplete?: () => Promise<void> | void;
}) {
  const tone = resolveInspectorSurfaceTone(surfaceTheme);
  const referenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const entity = selectedTask
    ? "task"
    : selectedAgent
      ? "agent"
      : selectedRuntime
        ? "runtime"
        : selectedWorkspace
          ? "workspace"
          : selectedModel
            ? "model"
            : "overview";
  const taskIntegrity = taskDetail?.integrity;
  const operationRunCount = selectedTask ? readOperationRunCount(taskDetail?.task ?? selectedTask) : 0;
  const operationJobId = selectedTask && typeof selectedTask.metadata.operationJobId === "string"
    ? selectedTask.metadata.operationJobId
    : null;
  const operationLastError = selectedTask && typeof selectedTask.metadata.operationLastError === "string"
    ? selectedTask.metadata.operationLastError
    : null;
  const taskNeedsReview = Boolean(
    selectedTask &&
      (selectedTask.warningCount > 0 ||
        selectedTask.status === "stalled" ||
        taskIntegrity?.status === "warning" ||
        taskIntegrity?.status === "error")
  );
  const action = resolveInspectorSummaryAction({
    entity,
    status: selectedTask?.status,
    needsReview: taskNeedsReview
  });
  const taskAgent = selectedTask
    ? snapshot.agents.find((agent) => agent.id === selectedTask.primaryAgentId || selectedTask.agentIds.includes(agent.id))
    : null;
  const taskWorkspace = selectedTask
    ? snapshot.workspaces.find((workspace) => workspace.id === selectedTask.workspaceId || workspace.agentIds.includes(taskAgent?.id ?? ""))
    : null;
  const workspaceTaskCount = selectedWorkspace
    ? snapshot.tasks.filter((task) => task.workspaceId === selectedWorkspace.id).length
    : 0;
  const summary = selectedTask
    ? readTaskResultPreview(taskDetail?.task ?? selectedTask) || selectedTask.subtitle || "Waiting for the first OpenClaw update."
    : selectedAgent
      ? selectedAgent.currentAction || "No active work reported."
      : selectedRuntime
        ? runtimeOutputLoading
          ? "Loading the latest runtime evidence…"
          : runtimeOutput?.finalText || runtimeOutput?.errorMessage || selectedRuntime.subtitle || "No assistant output captured yet."
        : selectedWorkspace
          ? `${selectedWorkspace.agentIds.length} agents · ${selectedWorkspace.activeRuntimeIds.length} active runs`
          : selectedModel
            ? `${selectedModel.provider} · ${selectedModel.available === false ? "unavailable" : "available"}`
            : "Gateway context is ready for inspection.";
  const facts = selectedTask
    ? [
        { label: "Agent", value: taskAgent ? formatAgentDisplayName(taskAgent) : "Unassigned" },
        { label: "Updated", value: formatRelativeTime(selectedTask.updatedAt, referenceMs) },
        { label: "Runs", value: String(Math.max(selectedTask.runtimeCount, operationRunCount)) },
        { label: "Files", value: String(selectedTask.artifactCount) }
      ]
    : selectedAgent
      ? [
          { label: "Status", value: selectedAgent.status },
          { label: "Active", value: String(selectedAgent.activeRuntimeIds.length) },
          { label: "Sessions", value: String(selectedAgent.sessionCount) },
          { label: "Model", value: compactMissionText(selectedAgent.modelId, 18) || "None" }
        ]
      : selectedRuntime
        ? [
            { label: "Status", value: selectedRuntime.status },
            { label: "Agent", value: selectedRuntime.agentId || "Unknown" },
            { label: "Session", value: shortId(selectedRuntime.sessionId, 10) },
            { label: "Files", value: String(runtimeOutput?.createdFiles.length ?? 0) }
          ]
        : selectedWorkspace
          ? [
              { label: "Health", value: selectedWorkspace.health },
              { label: "Agents", value: String(selectedWorkspace.agentIds.length) },
              { label: "Tasks", value: String(workspaceTaskCount) },
              { label: "Active", value: String(selectedWorkspace.activeRuntimeIds.length) }
            ]
          : selectedModel
            ? [
                { label: "Provider", value: selectedModel.provider },
                { label: "Context", value: formatContextWindow(selectedModel.contextWindow) },
                { label: "Agents", value: String(selectedModel.usageCount) },
                { label: "State", value: selectedModel.available === false ? "Unavailable" : "Available" }
              ]
            : [
                { label: "Health", value: snapshot.diagnostics.health },
                { label: "Agents", value: String(snapshot.agents.length) },
                { label: "Tasks", value: String(snapshot.tasks.length) },
                { label: "Live", value: String(snapshot.runtimes.filter((runtime) => runtime.status === "running").length) }
              ];

  return (
    <section className={cn("rounded-[14px] border p-3", tone.section)}>
      <div className="flex items-center justify-between gap-2">
        <p className={cn("text-[9px] font-semibold uppercase tracking-[0.2em]", tone.eyebrow)}>Decision summary</p>
        {selectedTask ? <Badge variant={badgeVariantForRuntimeStatus(selectedTask.status)}>{selectedTask.status}</Badge> : null}
      </div>
      <p className={cn("mt-2 line-clamp-3 text-[12px] leading-5", tone.title)}>{summary}</p>
      <div className="mt-3 grid grid-cols-2 gap-1.5">
        {facts.map((fact) => (
          <div key={fact.label} className={cn("min-w-0 rounded-[10px] border px-2.5 py-2", tone.fact)}>
            <p className={cn("text-[8px] font-semibold uppercase tracking-[0.16em]", tone.mutedText)}>{fact.label}</p>
            <p className={cn("mt-1 truncate text-[11px] font-medium", tone.title)} title={fact.value}>{fact.value}</p>
          </div>
        ))}
      </div>

      <div className="mt-3">
        {action === "steer-task" && selectedTask ? (
          <RunningTaskControlBar compact task={selectedTask} onAbortTask={onAbortTask} onControlComplete={onControlComplete} />
        ) : action === "review-result" && selectedTask ? (
          operationJobId ? (
            <InspectorPrimaryAction label="Open recovery" tone={tone} onClick={onOpenActivity} />
          ) : onReviewTask ? (
            <InspectorPrimaryAction label="Review result" tone={tone} onClick={() => onReviewTask(selectedTask)} />
          ) : (
            <InspectorPrimaryAction label="View result" tone={tone} onClick={onOpenActivity} />
          )
        ) : action === "view-result" || action === "view-activity" ? (
          <InspectorPrimaryAction label={action === "view-result" ? "View result" : "Open activity"} tone={tone} onClick={onOpenActivity} />
        ) : action === "open-chat" ? (
          <InspectorPrimaryAction label="Open chat" tone={tone} onClick={onOpenChat} />
        ) : (
          <InspectorPrimaryAction label="Open details" tone={tone} onClick={onOpenDetail} />
        )}
      </div>

      {taskNeedsReview ? (
        <p className="mt-3 rounded-[10px] border border-amber-400/20 bg-amber-400/10 px-2.5 py-2 text-[11px] leading-4 text-amber-100">
          {operationJobId
            ? operationLastError || "The latest scheduled run needs attention. Open recovery to retry it or manage the schedule."
            : "This task has captured evidence that needs operator review."}
        </p>
      ) : null}
      {taskWorkspace ? <p className={cn("mt-2 truncate text-[10px]", tone.mutedText)}>{taskWorkspace.name}</p> : null}
    </section>
  );
}

function InspectorPrimaryAction({
  label,
  tone,
  onClick
}: {
  label: string;
  tone: ReturnType<typeof resolveInspectorSurfaceTone>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn("inline-flex h-9 w-full items-center justify-center rounded-[10px] px-3 text-[11px] font-semibold transition-colors", tone.primaryButton)}
    >
      {label}
    </button>
  );
}

function filterTaskDetailForCard(
  taskDetail: TaskDetailRecord | null,
  activeTaskCard: TaskCardInspectorContext | null
): TaskDetailRecord | null {
  if (!taskDetail || !activeTaskCard || activeTaskCard.followUpIndex === null) {
    return taskDetail;
  }

  const runs = resolveTaskCardRuntimes(activeTaskCard, taskDetail.runs);
  const runtime = resolveRepresentativeTaskCardRuntime(runs);
  const outputs = taskDetail.outputs.filter((output) => runs.some((entry) => entry.id === output.runtimeId));
  const output = resolveBestTaskCardOutput(outputs);
  const realLiveFeed = filterTaskCardFeed(activeTaskCard, runs, taskDetail.liveFeed);
  const liveFeed = realLiveFeed.length > 0 ? realLiveFeed : [createTaskCardOptimisticFeed(activeTaskCard)];
  const createdFiles =
    outputs.length > 0
      ? dedupeCreatedFiles(outputs.flatMap((entry) => entry.createdFiles))
      : dedupeCreatedFiles(runs.flatMap((entry) => extractCreatedFilesFromRuntime(entry)));
  const warnings =
    outputs.length > 0
      ? uniqueStrings(outputs.flatMap((entry) => entry.warnings))
      : uniqueStrings(runs.flatMap((entry) => extractWarningsFromRuntime(entry)));
  const status = normalizeTaskCardStatus(runtime?.status ?? activeTaskCard.status, output, activeTaskCard);
  const finalText = output?.finalText?.trim() || activeTaskCard.summary?.trim() || null;
  const toolNames = uniqueStrings([
    ...runs.flatMap((entry) => entry.toolNames ?? []),
    ...outputs.flatMap((entry) => entry.items.map((item) => item.toolName).filter((value): value is string => Boolean(value)))
  ]);

  return {
    ...taskDetail,
    task: {
      ...taskDetail.task,
      title: activeTaskCard.message || `Follow-up ${activeTaskCard.cardNumber - 1}`,
      mission: activeTaskCard.message ?? taskDetail.task.mission,
      subtitle:
        finalText ||
        (runtime && hasMeaningfulTaskCardRuntimeSubtitle(runtime) ? runtime.subtitle : null) ||
        (status === "running" || status === "queued" ? "Follow-up is running in the existing OpenClaw session." : taskDetail.task.subtitle),
      status,
      updatedAt: runtime?.updatedAt ?? taskDetail.task.updatedAt,
      primaryRuntimeId: runtime?.id ?? taskDetail.task.primaryRuntimeId,
      runtimeIds: runs.map((entry) => entry.id),
      sessionIds: uniqueStrings([
        activeTaskCard.sessionId ?? "",
        ...runs.map((entry) => entry.sessionId ?? "")
      ]),
      runIds: uniqueStrings([
        activeTaskCard.runId ?? "",
        ...runs.map((entry) => entry.runId ?? "")
      ]),
      runtimeCount: Math.max(runs.length, activeTaskCard.runId ? 1 : 0),
      updateCount: liveFeed.length,
      liveRunCount: status === "running" || status === "queued" ? 1 : 0,
      artifactCount: createdFiles.length,
      warningCount: warnings.length,
      tokenUsage: aggregateTaskCardRuntimeTokenUsage(runs),
      metadata: {
        ...taskDetail.task.metadata,
        resultPreview: finalText ?? (runtime && hasMeaningfulTaskCardRuntimeSubtitle(runtime) ? runtime.subtitle : null) ?? "Waiting for follow-up output.",
        finalResponseText: finalText,
        finalResponseRuntimeId: runtime?.id ?? null,
        turnCount: Math.max(new Set(runs.map((entry) => entry.runId ?? entry.id)).size, activeTaskCard.runId ? 1 : 0),
        sessionCount: uniqueStrings([activeTaskCard.sessionId ?? "", ...runs.map((entry) => entry.sessionId ?? "")]).length,
        followUpCardNumber: activeTaskCard.cardNumber,
        followUpMessage: activeTaskCard.message ?? null
      }
    },
    runs,
    outputs,
    liveFeed,
    createdFiles,
    warnings,
    integrity: {
      ...taskDetail.integrity,
      finalResponseText: finalText,
      finalResponseSource: finalText ? "runtime" : "none",
      outputFileCount: createdFiles.length,
      transcriptTurnCount: outputs.reduce((sum, entry) => sum + entry.items.length, 0) || runs.length,
      matchingTranscriptTurnCount: outputs.reduce((sum, entry) => sum + entry.items.length, 0),
      toolNames,
      issues: finalText ? [] : taskDetail.integrity.issues,
      status: finalText ? "verified" : taskDetail.integrity.status
    }
  };
}

function resolveTaskCardRuntimes(
  activeTaskCard: TaskCardInspectorContext,
  runs: TaskDetailRecord["runs"]
) {
  const runId = activeTaskCard.runId?.trim();

  if (runId) {
    const matches = runs.filter((runtime) => runtime.runId === runId || runtime.id === runId || readRuntimeMetadataString(runtime.metadata, "runId") === runId);

    if (matches.length > 0) {
      return matches.sort((left, right) => runtimeTimestampMs(right.updatedAt) - runtimeTimestampMs(left.updatedAt));
    }
  }

  const createdAtMs = activeTaskCard.createdAt ? Date.parse(activeTaskCard.createdAt) : Number.NaN;
  const sessionId = activeTaskCard.sessionId?.trim();
  return runs
    .filter((runtime) => {
      const runtimeUpdatedAt = runtimeTimestampMs(runtime.updatedAt);
      const afterFollowUp = Number.isNaN(createdAtMs) || runtimeUpdatedAt === 0 || runtimeUpdatedAt >= createdAtMs - 5000;
      const sameSession = !sessionId || runtime.sessionId === sessionId || runtime.key.includes(sessionId);
      return afterFollowUp && sameSession;
    })
    .sort((left, right) => runtimeTimestampMs(right.updatedAt) - runtimeTimestampMs(left.updatedAt));
}

function resolveRepresentativeTaskCardRuntime(runs: TaskDetailRecord["runs"]) {
  return (
    runs.find((runtime) => hasMeaningfulTaskCardRuntimeSubtitle(runtime)) ??
    runs.find((runtime) => runtime.status === "completed") ??
    runs[0] ??
    null
  );
}

function resolveBestTaskCardOutput(outputs: RuntimeOutputRecord[]) {
  return (
    outputs.find((output) => output.finalText?.trim()) ??
    outputs.find((output) => output.errorMessage?.trim()) ??
    outputs[0] ??
    null
  );
}

function filterTaskCardFeed(
  activeTaskCard: TaskCardInspectorContext,
  runs: TaskDetailRecord["runs"],
  liveFeed: TaskFeedEvent[]
) {
  if (runs.length > 0) {
    const runtimeIds = new Set(runs.map((runtime) => runtime.id));
    return liveFeed.filter((event) => Boolean(event.runtimeId && runtimeIds.has(event.runtimeId)));
  }

  const createdAtMs = activeTaskCard.createdAt ? Date.parse(activeTaskCard.createdAt) : Number.NaN;
  if (Number.isNaN(createdAtMs)) {
    return [];
  }

  return liveFeed.filter((event) => {
    const eventMs = Date.parse(event.timestamp);
    return !Number.isNaN(eventMs) && eventMs >= createdAtMs - 5000;
  });
}

function createTaskCardOptimisticFeed(activeTaskCard: TaskCardInspectorContext): TaskFeedEvent {
  return {
    id: `follow-up-${activeTaskCard.cardNumber}-accepted`,
    kind: "user",
    timestamp: activeTaskCard.createdAt ?? new Date().toISOString(),
    title: "Follow-up accepted",
    detail: activeTaskCard.message || "OpenClaw accepted the follow-up for the existing session.",
    runtimeId: activeTaskCard.runId ?? undefined
  };
}

function normalizeTaskCardStatus(
  value: string | null | undefined,
  output: RuntimeOutputRecord | null,
  activeTaskCard: TaskCardInspectorContext
): TaskDetailRecord["task"]["status"] {
  switch (value) {
    case "queued":
    case "running":
    case "idle":
    case "completed":
    case "stalled":
    case "cancelled":
      return value;
    default:
      return output?.finalText || activeTaskCard.summary ? "completed" : "running";
  }
}

function runtimeTimestampMs(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return 0;
  }

  return value > 1_000_000_000_000 ? value : value * 1000;
}

function readRuntimeMetadataString(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function hasMeaningfulTaskCardRuntimeSubtitle(runtime: TaskDetailRecord["runs"][number]) {
  const value = runtime.subtitle.trim().toLowerCase();
  return Boolean(value && !["chat", "agent", "sessions.changed", "session.message", "openclaw runtime event", "gateway runtime event"].includes(value));
}

function aggregateTaskCardRuntimeTokenUsage(runs: TaskDetailRecord["runs"]) {
  const usages = runs
    .map((runtime) => runtime.tokenUsage)
    .filter((usage): usage is NonNullable<TaskDetailRecord["runs"][number]["tokenUsage"]> => Boolean(usage));

  if (usages.length === 0) {
    return undefined;
  }

  return usages.reduce(
    (total, usage) => ({
      input: total.input + (usage?.input ?? 0),
      output: total.output + (usage?.output ?? 0),
      total: total.total + (usage?.total ?? 0),
      cacheRead: (total.cacheRead ?? 0) + (usage?.cacheRead ?? 0)
    }),
    { input: 0, output: 0, total: 0, cacheRead: 0 }
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function GatewayOverview({
  snapshot,
  lastMission
}: {
  snapshot: MissionControlSnapshot;
  lastMission: MissionResponse | null;
}) {
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const runtimePreflightValue =
    snapshot.diagnostics.runtime.stateWritable && snapshot.diagnostics.runtime.sessionStoreWritable
      ? snapshot.diagnostics.runtime.smokeTest.status === "passed"
        ? "verified"
        : "pending smoke test"
      : "attention";

  return (
    <>
      <OverviewGatewaySummaryPanel snapshot={snapshot} />

      <InfoCard icon={Radar} title="Gateway health" value={snapshot.diagnostics.health}>
        <p>{snapshot.diagnostics.gatewayUrl}</p>
        <p>{snapshot.diagnostics.dashboardUrl}</p>
      </InfoCard>

      <InfoCard icon={FolderGit2} title="Runtime preflight" value={runtimePreflightValue}>
        <p className="font-mono text-xs text-slate-400">{snapshot.diagnostics.runtime.stateRoot}</p>
        <p>
          {snapshot.diagnostics.runtime.sessionStores.length > 0
            ? `${snapshot.diagnostics.runtime.sessionStores.filter((entry) => entry.writable).length}/${snapshot.diagnostics.runtime.sessionStores.length} session stores writable`
            : "No agent session stores have been probed yet."}
        </p>
        {snapshot.diagnostics.runtime.smokeTest.checkedAt ? (
          <p>
            Smoke test {snapshot.diagnostics.runtime.smokeTest.status} ·{" "}
            {snapshot.diagnostics.runtime.smokeTest.agentId || "unknown agent"} ·{" "}
            {formatRelativeTime(Date.parse(snapshot.diagnostics.runtime.smokeTest.checkedAt), relativeTimeReferenceMs)}
          </p>
        ) : (
          <p>No runtime smoke test has been recorded yet.</p>
        )}
        {snapshot.diagnostics.runtime.issues[0] ? (
          <div className="rounded-[14px] border border-amber-400/15 bg-amber-400/8 px-3 py-2 text-[13px] text-amber-50">
            {snapshot.diagnostics.runtime.issues[0]}
          </div>
        ) : null}
      </InfoCard>

      <InfoCard icon={TerminalSquare} title="Presence beacons" value={String(snapshot.presence.length)}>
        {snapshot.presence.length === 0 ? <p>No live presence payloads.</p> : null}
        {snapshot.presence.map((entry) => (
          <div
            key={entry.ts}
            className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
          >
            <div className="text-[13px] text-white">{entry.host}</div>
            <div className="mt-1 text-xs text-slate-400">
              {entry.ip} · {entry.platform} · {entry.version}
            </div>
          </div>
        ))}
      </InfoCard>

      {lastMission ? (
        <InfoCard icon={Cpu} title="Last mission" value={lastMission.status}>
          <p className="text-sm text-white">{lastMission.summary}</p>
          <p className="font-mono text-xs text-slate-500">
            {lastMission.runId ? `Run ${lastMission.runId}` : `Dispatch ${lastMission.dispatchId ?? "pending"}`}
          </p>
          {typeof lastMission.meta?.outputDirRelative === "string" ? (
            <p className="font-mono text-xs text-slate-400">{lastMission.meta.outputDirRelative}</p>
          ) : null}
          {lastMission.payloads[0]?.text ? (
            <div className="rounded-[14px] border border-cyan-400/15 bg-cyan-400/8 px-3 py-2 text-[13px] text-cyan-50">
              {lastMission.payloads[0].text}
            </div>
          ) : null}
        </InfoCard>
      ) : null}
    </>
  );
}

function WorkspaceContent({
  snapshot,
  workspaceId
}: {
  snapshot: MissionControlSnapshot;
  workspaceId: string;
}) {
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);
  const agents = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);
  const models = workspace
    ? workspace.modelIds.map((modelId) => snapshot.models.find((model) => model.id === modelId)?.name || modelId)
    : [];
  const workspaceRuntimes = snapshot.runtimes
    .filter((runtime) => runtime.workspaceId === workspaceId || workspace?.activeRuntimeIds.includes(runtime.id))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));

  if (!workspace) {
    return null;
  }

  const liveRuntimes = workspaceRuntimes.filter((runtime) =>
    runtime.status === "running" || runtime.status === "queued" || runtime.status === "idle"
  );
  const latestRuntime = workspaceRuntimes[0] ?? null;
  const createdFiles = dedupeCreatedFiles(workspaceRuntimes.flatMap(extractCreatedFilesFromRuntime)).slice(0, 8);
  const bootstrapState =
    workspace.bootstrap.coreFiles.every((item) => item.present) &&
    workspace.bootstrap.projectShell.every((item) => item.present)
      ? "ready"
      : workspace.bootstrap.coreFiles.some((item) => item.present) ||
          workspace.bootstrap.projectShell.some((item) => item.present)
        ? "partial"
        : "thin";
  const observedTools = Array.from(new Set(agents.flatMap((agent) => agent.observedTools ?? [])));
  const workspaceOnlyMode =
    agents.length === 0
      ? "no agents"
      : workspace.capabilities.workspaceOnlyAgentCount === agents.length
        ? "workspace-only"
        : workspace.capabilities.workspaceOnlyAgentCount === 0
          ? "open"
          : "mixed";

  return (
    <>
      <InfoCard icon={FolderGit2} title="Overview" value={workspace.health}>
        <p className="font-mono text-xs text-slate-400">{compactPath(workspace.path)}</p>
        <InspectorMetricGrid
          items={[
            { label: "Agents", value: String(agents.length) },
            { label: "Models", value: String(workspace.modelIds.length) },
            { label: "Runs", value: String(workspaceRuntimes.length) },
            { label: "Sessions", value: String(workspace.totalSessions) }
          ]}
        />
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Models</p>
          <InspectorTagGroup
            emptyLabel="No models attached"
            items={models}
            emptyVariant="muted"
            itemVariant="muted"
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Team</p>
          <div className="flex flex-wrap gap-2">
            {agents.map((agent) => (
              <Badge key={agent.id} variant={agent.isDefault ? "default" : "muted"}>
                {formatAgentDisplayName(agent)}
              </Badge>
            ))}
          </div>
        </div>
      </InfoCard>

      <InfoCard icon={Cpu} title="Bootstrap" value={bootstrapState}>
        <div className="flex flex-wrap gap-2">
          <Badge variant={workspace.bootstrap.template ? "default" : "muted"}>
            {workspace.bootstrap.template || "template unknown"}
          </Badge>
          <Badge variant={workspace.bootstrap.sourceMode ? "muted" : "warning"}>
            {workspace.bootstrap.sourceMode || "source unknown"}
          </Badge>
          {workspace.bootstrap.agentTemplate ? <Badge variant="muted">{workspace.bootstrap.agentTemplate}</Badge> : null}
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Core files</p>
          <InspectorPresenceGroup items={workspace.bootstrap.coreFiles} missingVariant="warning" />
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Optional scaffold</p>
          <InspectorPresenceGroup items={[...workspace.bootstrap.optionalFiles, ...workspace.bootstrap.folders]} />
        </div>
        {workspace.bootstrap.contextFiles?.length ? (
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Context docs</p>
            <InspectorPresenceGroup items={workspace.bootstrap.contextFiles} />
          </div>
        ) : null}
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Project shell</p>
          <InspectorPresenceGroup items={workspace.bootstrap.projectShell} />
        </div>
      </InfoCard>

      <InfoCard icon={Cpu} title="Capabilities" value={workspaceOnlyMode}>
        <p>
          {workspace.capabilities.workspaceOnlyAgentCount}/{agents.length} agents are configured with
          {" "}
          <span className="font-mono text-xs text-slate-300">fs.workspaceOnly</span>
          .
        </p>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Skills</p>
          <InspectorTagGroup
            emptyLabel="No explicit skills"
            items={workspace.capabilities.skills}
            emptyVariant="muted"
            itemVariant="muted"
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Local workspace skills</p>
          <InspectorTagGroup
            emptyLabel="No local SKILL.md scaffolds"
            items={workspace.bootstrap.localSkillIds}
            emptyVariant="muted"
            itemVariant="success"
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Declared tools</p>
          <InspectorTagGroup
            emptyLabel="No explicit tools configured"
            items={workspace.capabilities.tools}
            emptyVariant="muted"
            itemVariant="warning"
          />
        </div>
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Observed tools</p>
          <InspectorTagGroup
            emptyLabel="No runtime tool calls recovered yet"
            items={observedTools}
            emptyVariant="muted"
            itemVariant="default"
          />
        </div>
      </InfoCard>

      <InfoCard icon={TerminalSquare} title="Activity" value={`${liveRuntimes.length} live`}>
        <p>{workspaceRuntimes.length} tracked runs across {workspace.totalSessions} recorded sessions.</p>
        <p>
          {latestRuntime
            ? `Latest update ${formatRelativeTime(latestRuntime.updatedAt, relativeTimeReferenceMs)}`
            : "No runtime activity has been recorded yet."}
        </p>
        {workspaceRuntimes.length > 0 ? (
          <div className="space-y-2 pt-1">
            {workspaceRuntimes.slice(0, 3).map((runtime) => (
              <div
                key={runtime.id}
                className="flex items-center justify-between rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-white">{runtime.title}</p>
                  <p className="truncate text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    {runtime.subtitle} · {shortId(runtime.runId || runtime.id, 10)}
                  </p>
                </div>
                <Badge variant={badgeVariantForRuntimeStatus(runtime.status)}>
                  {runtime.status}
                </Badge>
              </div>
            ))}
          </div>
        ) : null}
        <div>
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Agent posture</p>
          <div className="space-y-2">
            {agents.map((agent) => (
              <div
                key={agent.id}
                className="flex items-center justify-between rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
              >
                <div className="min-w-0">
                  <p className="truncate text-[13px] text-white">{formatAgentDisplayName(agent)}</p>
                  <p className="truncate text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    {agent.currentAction}
                  </p>
                </div>
                <Badge variant={agent.status === "engaged" ? "default" : agent.status === "offline" ? "danger" : "muted"}>
                  {agent.status}
                </Badge>
              </div>
            ))}
          </div>
        </div>
      </InfoCard>

      <InfoCard icon={FileJson} title="Created files" value={String(createdFiles.length)}>
        <InspectorCreatedFileList
          files={createdFiles}
          basePath={workspace.path}
          emptyLabel="No file artifacts have been detected in recent workspace runs."
        />
      </InfoCard>
    </>
  );
}

function AgentContent({
  snapshot,
  agentId,
  focusSection,
  onConfigureAgentCapabilities
}: {
  snapshot: MissionControlSnapshot;
  agentId: string;
  focusSection?: AgentDetailFocus | null;
  onConfigureAgentCapabilities?: InspectorPanelProps["onConfigureAgentCapabilities"];
}) {
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const agent = snapshot.agents.find((entry) => entry.id === agentId);
  const workspace = snapshot.workspaces.find((entry) => entry.id === agent?.workspaceId);
  const model = snapshot.models.find((entry) => entry.id === agent?.modelId);
  const skillsSectionRef = useRef<HTMLDivElement | null>(null);
  const toolsSectionRef = useRef<HTMLDivElement | null>(null);
  const sessionsSectionRef = useRef<HTMLDivElement | null>(null);
  const observedTools = agent?.observedTools ?? [];
  const declaredSkills = agent?.skills ?? [];
  const declaredTools = (agent?.tools ?? []).filter((tool) => tool !== "fs.workspaceOnly");
  const lockedTools = agent?.tools.includes("fs.workspaceOnly") ? ["fs.workspaceOnly"] : [];
  const policyMeta = agent ? getAgentPresetMeta(agent.policy.preset) : null;
  const effectiveSkills = declaredSkills.length > 0 ? declaredSkills : policyMeta?.skillIds ?? [];
  const effectiveTools = declaredTools.length > 0 ? declaredTools : policyMeta?.tools ?? [];
  const policyRows = agent
    ? [
        {
          label: "Preset",
          value: formatAgentPresetLabel(agent.policy.preset)
        },
        {
          label: "Missing tools",
          value: formatAgentMissingToolBehaviorLabel(agent.policy.missingToolBehavior)
        },
        {
          label: "Install scope",
          value: formatAgentInstallScopeLabel(agent.policy.installScope)
        },
        {
          label: "File access",
          value: formatAgentFileAccessLabel(agent.policy.fileAccess)
        },
        {
          label: "Network",
          value: formatAgentNetworkAccessLabel(agent.policy.networkAccess)
        }
      ]
    : [];
  const activeRuntimes = snapshot.runtimes
    .filter((runtime) => agent?.activeRuntimeIds.includes(runtime.id))
    .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const runtimeView = buildInspectorAgentRuntimeView({ snapshot, agentId });
  const [expandedActivityId, setExpandedActivityId] = useState<string | null>(null);
  const createdFiles = dedupeCreatedFiles(activeRuntimes.flatMap(extractCreatedFilesFromRuntime)).slice(0, 8);

  useEffect(() => {
    if (!focusSection) {
      return;
    }

    const target =
      focusSection === "skills"
        ? skillsSectionRef.current
        : focusSection === "tools"
          ? toolsSectionRef.current
          : sessionsSectionRef.current;

    target?.scrollIntoView({
      behavior: "smooth",
      block: "start"
    });
  }, [focusSection]);

  if (!agent) {
    return null;
  }

  return (
    <>
      <InfoCard icon={Cpu} title="Agent identity" value={agent.id}>
        <p>{formatAgentDisplayName(agent)}</p>
        <p>{agent.identity.emoji ? `${agent.identity.emoji} · ${agent.identity.theme ?? "theme unset"}` : "No identity emoji"}</p>
        <div className="flex flex-wrap gap-2">
          {agent.isDefault ? <Badge variant="default">default agent</Badge> : null}
          <Badge variant={getAgentPresetMeta(agent.policy.preset).badgeVariant}>
            {formatAgentPresetLabel(agent.policy.preset)}
          </Badge>
          {agent.identity.source ? <Badge variant="muted">{agent.identity.source}</Badge> : null}
        </div>
      </InfoCard>

      <InfoCard icon={FolderGit2} title="Workspace" value={workspace?.name || "n/a"}>
        <p className="font-mono text-xs text-slate-400">{compactPath(agent.workspacePath)}</p>
        <p>{agent.sessionCount} recorded sessions</p>
      </InfoCard>

      <InfoCard icon={Cpu} title="Model assignment" value={model?.name || agent.modelId}>
        <p>{model ? `${model.provider} · ${formatContextWindow(model.contextWindow)} ctx` : "Model metadata unavailable"}</p>
        <p>{model?.available === false ? "Currently unavailable" : model?.local ? "Local model route" : "Remote model route"}</p>
      </InfoCard>

      <InfoCard
        icon={Cpu}
        title="Agent summary"
        value={formatAgentPresetLabel(agent.policy.preset)}
        actions={
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              onConfigureAgentCapabilities?.(agent.id, focusSection === "tools" ? "tools" : "skills");
            }}
            className="h-7 rounded-full px-2.5 text-[11px]"
          >
            <Pencil className="mr-1 h-3 w-3" />
            Edit
          </Button>
        }
      >
        <div className="space-y-4">
          <div className="w-full">
            <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Purpose</p>
            <div className="w-full rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
              <p className="text-[13px] leading-5 text-slate-200">
              {agent.profile.purpose || "No explicit purpose was found in the workspace bootstrap files."}
              </p>
            </div>
          </div>

          <div
            ref={skillsSectionRef}
            className={cn(
              "scroll-mt-4 rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 transition-all",
              focusSection === "skills" &&
                "border-sky-100/[0.18] bg-sky-200/[0.035] shadow-[0_0_0_1px_rgba(125,211,252,0.05)]"
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Skills</p>
              <Badge variant="muted">{effectiveSkills.length} active</Badge>
            </div>
            <InspectorTagGroup
              emptyLabel="No skills available"
              items={effectiveSkills}
              emptyVariant="muted"
              itemVariant="muted"
            />
          </div>

          <div
            ref={toolsSectionRef}
            className={cn(
              "scroll-mt-4 rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5 transition-all",
              focusSection === "tools" &&
                "border-sky-100/[0.18] bg-sky-200/[0.035] shadow-[0_0_0_1px_rgba(125,211,252,0.05)]"
            )}
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Tools</p>
              <div className="flex flex-wrap items-center gap-1.5">
                {lockedTools.length > 0 ? (
                  <Badge variant="success">
                    <Lock className="mr-1 h-3 w-3" />
                    policy locked
                  </Badge>
                ) : null}
                <Badge variant="muted">{effectiveTools.length} active</Badge>
              </div>
            </div>
            <div className="space-y-3">
              <InspectorTagGroup
                emptyLabel="No tools available"
                items={effectiveTools}
                emptyVariant="muted"
                itemVariant="warning"
              />

              {lockedTools.length > 0 ? (
                <div>
                  <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Policy locked</p>
                  <div className="flex flex-wrap gap-2">
                    {lockedTools.map((tool) => (
                      <Badge key={tool} variant="success">
                        <Lock className="mr-1 h-3 w-3" />
                        {tool}
                      </Badge>
                    ))}
                  </div>
                  <p className="mt-1 text-[11px] leading-5 text-slate-500">
                    This capability is derived from the agent policy and cannot be removed here.
                  </p>
                </div>
              ) : null}

              {observedTools.length > 0 ? (
                <div>
                  <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Observed</p>
                  <InspectorTagGroup
                    emptyLabel="No runtime tool calls recovered yet"
                    items={observedTools}
                    emptyVariant="muted"
                    itemVariant="default"
                  />
                </div>
              ) : null}
            </div>
          </div>

          <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-3">
            <p className="text-[12px] leading-5 text-slate-400">
              {policyMeta?.description ?? "No policy description available."}
            </p>
            <div className="mt-3 grid gap-1.5 text-[13px] text-slate-300">
              {policyRows.map((row) => (
                <p key={row.label}>
                  {row.label}: <span className="text-white">{row.value}</span>
                </p>
              ))}
              {agent.profile.outputPreference ? (
                <p>
                  Output preference: <span className="text-white">{agent.profile.outputPreference}</span>
                </p>
              ) : null}
            </div>
          </div>
        </div>
      </InfoCard>

      <InfoCard icon={Radar} title="Runtime posture" value={agent.status}>
        <p>{agent.currentAction}</p>
        <p>Last active {formatRelativeTime(agent.lastActiveAt, relativeTimeReferenceMs)}</p>
        <p>{agent.heartbeat.enabled ? `Heartbeat ${agent.heartbeat.every}` : "Heartbeat disabled"}</p>
        <InspectorMetricGrid
          items={[
            { label: "Active runtimes", value: String(runtimeView.activeRuntimeIds.length) },
            { label: "Sessions", value: String(runtimeView.activeSessionIds.length) },
            { label: "Runs", value: String(runtimeView.activeRunIds.length) },
            { label: "Recorded", value: String(runtimeView.recordedSessionCount) }
          ]}
        />
        <div className="flex flex-wrap gap-2">
          <Badge variant={agent.heartbeat.enabled ? "success" : "muted"}>
            {agent.heartbeat.enabled ? "heartbeat on" : "heartbeat off"}
          </Badge>
          {typeof agent.heartbeat.everyMs === "number" ? (
            <Badge variant="muted">{Math.round(agent.heartbeat.everyMs / 1000)}s interval</Badge>
          ) : null}
        </div>
      </InfoCard>

      <AgentRuntimeSummaryPanel view={runtimeView} />

      <div ref={sessionsSectionRef} className="scroll-mt-4">
        <InfoCard
          icon={TerminalSquare}
          title="Activity history"
          value={String(activeRuntimes.length)}
          className={cn(
            focusSection === "sessions" &&
              "border-sky-100/[0.18] bg-[linear-gradient(180deg,rgba(12,25,37,0.9),rgba(8,13,24,0.86))] shadow-[0_0_0_1px_rgba(125,211,252,0.05)]"
          )}
        >
          <p>{agent.sessionCount} recorded sessions overall.</p>
          <p>
            {activeRuntimes.length > 0
              ? `${activeRuntimes.length} history item${activeRuntimes.length === 1 ? "" : "s"} recovered from the latest agent activity.`
              : "No linked runtime records were recovered for this agent in the current snapshot."}
          </p>
          {agent.sessionCount > activeRuntimes.length ? (
            <p className="text-[12px] text-slate-500">
              {agent.sessionCount - activeRuntimes.length} session
              {agent.sessionCount - activeRuntimes.length === 1 ? "" : "s"} do not have recovered runtime data yet.
            </p>
          ) : null}
          {activeRuntimes.length > 0 ? (
            <div className="space-y-2.5 pt-1">
              {activeRuntimes.map((runtime) => {
                const isExpanded = expandedActivityId === runtime.id;
                const sourceLabel = resolveAgentActivitySourceLabel(runtime.source);
                const activityTypeLabel = resolveAgentActivityTypeLabel(runtime);
                const sessionLabel = runtime.sessionId
                  ? `session ${shortId(runtime.sessionId, 10)}`
                  : runtime.runId
                    ? `run ${shortId(runtime.runId, 10)}`
                    : "session n/a";
                const tokenLabel = formatActivityTokenLabel(runtime.tokenUsage?.total);
                const timestampLabel = formatActivityTimestamp(runtime.updatedAt);

                return (
                  <div
                    key={runtime.id}
                    className={cn(
                      "overflow-hidden rounded-[14px] border bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] transition-all",
                      isExpanded ? "border-sky-100/[0.16] shadow-[0_0_0_1px_rgba(125,211,252,0.05)]" : "border-white/[0.08]"
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={isExpanded}
                      className="nodrag nopan flex w-full flex-col gap-2 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.03]"
                      onClick={() => {
                        setExpandedActivityId((current) => (current === runtime.id ? null : runtime.id));
                      }}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <Badge variant={badgeVariantForRuntimeStatus(runtime.status)}>{runtime.status}</Badge>
                        <Badge variant={runtime.tokenUsage?.total ? "default" : "muted"}>{tokenLabel}</Badge>
                      </div>

                      <div className="min-w-0 space-y-1">
                        <p className="line-clamp-2 text-[13px] leading-5 text-white">{runtime.title}</p>
                        <p className="line-clamp-2 text-[12px] leading-5 text-slate-300">{runtime.subtitle}</p>
                      </div>

                      <div className="flex items-end justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-[9px] uppercase tracking-[0.18em] text-slate-500">
                            {activityTypeLabel} · {sessionLabel}
                          </p>
                        </div>
                        <p className="shrink-0 text-right text-[9px] uppercase tracking-[0.18em] text-slate-500">
                          {timestampLabel}
                        </p>
                      </div>
                    </button>

                    <AnimatePresence initial={false}>
                      {isExpanded ? (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: "auto", opacity: 1 }}
                          exit={{ height: 0, opacity: 0 }}
                          transition={{ duration: 0.18 }}
                          className="overflow-hidden border-t border-white/[0.08]"
                        >
                          <div className="space-y-3 px-3 py-3">
                            <InspectorMetricGrid
                              items={[
                                { label: "Source", value: sourceLabel },
                                { label: "Status", value: runtime.status },
                                { label: "Updated", value: formatRelativeTime(runtime.updatedAt, relativeTimeReferenceMs) },
                                { label: "Key", value: shortId(runtime.key, 12) }
                              ]}
                            />

                            <div className="flex flex-wrap gap-1.5">
                              {runtime.sessionId ? <Badge variant="muted">session {shortId(runtime.sessionId, 12)}</Badge> : null}
                              {runtime.runId ? <Badge variant="muted">run {shortId(runtime.runId, 12)}</Badge> : null}
                              {runtime.taskId ? <Badge variant="muted">task {shortId(runtime.taskId, 12)}</Badge> : null}
                              {runtime.modelId ? <Badge variant="muted">model {shortId(runtime.modelId, 12)}</Badge> : null}
                            </div>

                            <div>
                              <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Preview</p>
                              <div className="rounded-[12px] border border-white/[0.08] bg-white/[0.03] px-3 py-2">
                                <p className="text-[12px] leading-5 text-slate-200">{runtime.subtitle}</p>
                              </div>
                            </div>

                            {runtime.toolNames?.length ? (
                              <div>
                                <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Tools</p>
                                <InspectorTagGroup
                                  emptyLabel="No tool names recorded"
                                  items={runtime.toolNames}
                                  emptyVariant="muted"
                                  itemVariant="warning"
                                />
                              </div>
                            ) : null}
                          </div>
                        </motion.div>
                      ) : null}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          ) : null}
        </InfoCard>
      </div>

      <InfoCard icon={FileJson} title="Created files" value={String(createdFiles.length)}>
        <InspectorCreatedFileList
          files={createdFiles}
          basePath={agent.workspacePath}
          emptyLabel="No file artifacts have been detected for this agent yet."
        />
      </InfoCard>

      <InfoCard icon={Cpu} title="Capabilities" value={`${agent.skills.length} skills`}>
        <InspectorTagGroup
          emptyLabel="No explicit skills"
          items={agent.skills}
          emptyVariant="muted"
          itemVariant="muted"
        />
        <div className="pt-1">
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Declared tools</p>
          <InspectorTagGroup
            emptyLabel="No explicit tools configured"
            items={agent.tools}
            emptyVariant="muted"
            itemVariant="warning"
          />
        </div>
        <div className="pt-1">
          <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Observed tools</p>
          <InspectorTagGroup
            emptyLabel="No runtime tool calls recovered yet"
            items={observedTools}
            emptyVariant="muted"
            itemVariant="default"
          />
        </div>
      </InfoCard>
    </>
  );
}

function resolveAgentActivitySourceLabel(source: AgentRuntimeRecord["source"]) {
  switch (source) {
    case "session":
      return "Direct chat";
    case "turn":
      return "Conversation";
    case "cron":
      return "Scheduled";
    default:
      return "Unknown source";
  }
}

function resolveAgentActivityTypeLabel(runtime: AgentRuntimeRecord) {
  if (runtime.taskId) {
    return "Task";
  }

  switch (runtime.source) {
    case "session":
      return "Chat";
    case "turn":
      return "Run";
    case "cron":
      return "Scheduled";
    default:
      return "Activity";
  }
}

function formatActivityTokenLabel(total: number | null | undefined) {
  if (typeof total !== "number" || Number.isNaN(total)) {
    return "0 Tokens";
  }

  if (total >= 1000) {
    return `${Math.round(total / 1000)}K Tokens`;
  }

  return `${total} Tokens`;
}

function formatActivityTimestamp(timestamp: number | null | undefined) {
  if (typeof timestamp !== "number" || Number.isNaN(timestamp)) {
    return "No time";
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(timestamp));
}

function TaskContent({
  snapshot,
  task,
  taskId,
  taskDetail,
  taskDetailLoading,
  taskDetailError,
  taskDetailNotice
}: {
  snapshot: MissionControlSnapshot;
  task: MissionControlSnapshot["tasks"][number];
  taskId: string;
  taskDetail: TaskDetailRecord | null;
  taskDetailLoading: boolean;
  taskDetailError: string | null;
  taskDetailNotice: string | null;
}) {
  const snapshotTask = snapshot.tasks.find((entry) => entry.id === taskId) ?? task;
  const selectedTask = taskDetail?.task
    ? mergeLocalTaskReviewMetadata(taskDetail.task, snapshotTask)
    : snapshotTask;
  const isAborted = isTaskAborted(selectedTask);
  const runs =
    taskDetail?.runs ??
    snapshot.runtimes
      .filter((runtime) => task?.runtimeIds.includes(runtime.id))
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const workspacePath = resolveTaskWorkspacePath(snapshot, selectedTask, runs);
  const workspace = resolveTaskWorkspace(snapshot, selectedTask, runs);
  const primaryAgent = snapshot.agents.find((entry) => entry.id === selectedTask?.primaryAgentId);
  const createdFiles =
    dedupeCreatedFiles(taskDetail?.createdFiles ?? runs.flatMap((runtime) => extractCreatedFilesFromRuntime(runtime)));
  const warnings = taskDetail?.warnings ?? [];

  if (!task) {
    return null;
  }

  const integrity = taskDetail?.integrity ?? createOptimisticTaskIntegrity(task);
  const originalPrompt = readTaskPromptText(selectedTask);
  const routedPrompt = readTaskRoutedPrompt(selectedTask);
  const routedPromptChanged = taskPromptsDiffer(originalPrompt, routedPrompt);
  const latestOutput = readTaskResultPreview(selectedTask);
  const sessionCount = readTaskSummaryCount(selectedTask.metadata.sessionCount, selectedTask.sessionIds.length);
  const turnCount = readTaskSummaryCount(selectedTask.metadata.turnCount, runs.length);
  const operationRunCount = readOperationRunCount(selectedTask);
  const runnerLogs = readTaskRunnerLogEvents(taskDetail?.liveFeed ?? []);
  const runnerLogFile = readTaskRunnerLogFile(runnerLogs);
  const sessionView = buildInspectorTaskSessionView({ snapshot, task: selectedTask, taskDetail });
  const pollingFallback = resolvePollingFallbackNotice(snapshot.diagnostics.eventBridge);

  return (
    <>
      <InfoCard icon={FolderGit2} title="Mission" value={isAborted ? "aborted" : selectedTask.status}>
        <TaskTextPanel label="Original prompt" text={originalPrompt} basePath={workspacePath} />
        <TaskTextPanel
          label="Sent to OpenClaw"
          text={routedPromptChanged ? routedPrompt : "Same as original prompt."}
          basePath={workspacePath}
          subtle={!routedPromptChanged}
        />
        <TaskTextPanel
          label="Latest task output"
          text={latestOutput || "Waiting for the first OpenClaw update."}
          basePath={workspacePath}
          subtle={!latestOutput}
        />
        <InspectorMetricGrid
          items={[
            { label: "Sessions", value: String(sessionCount) },
            { label: "Turns", value: String(turnCount) },
            { label: "Runs", value: String(Math.max(selectedTask.runtimeCount, operationRunCount)) },
            { label: "Files", value: String(selectedTask.artifactCount) },
            { label: "Live", value: String(selectedTask.liveRunCount) },
            { label: "Tools", value: String(integrity.toolNames.length) }
          ]}
        />
        <div className="flex flex-wrap gap-2">
          {workspace ? <Badge variant="muted">{workspace.name}</Badge> : null}
          {primaryAgent ? <Badge variant="default">{formatAgentDisplayName(primaryAgent)}</Badge> : null}
          {selectedTask.dispatchId ? <Badge variant="muted">dispatch {shortId(selectedTask.dispatchId, 8)}</Badge> : null}
          {isAborted ? <Badge variant="danger">aborted</Badge> : null}
        </div>
        {taskDetailLoading && !taskDetail ? <p>Connecting live task feed…</p> : null}
        {taskDetailError ? (
          <p className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
            {taskDetailError}
          </p>
        ) : null}
        {taskDetailNotice ? (
          <p className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
            {taskDetailNotice}
          </p>
        ) : null}
      </InfoCard>

      <TaskSessionTruthPanel view={sessionView} pollingFallback={pollingFallback} />

      <TaskIntegrityCard
        task={selectedTask}
        integrity={integrity}
        basePath={workspacePath}
        latestEvidenceAt={findLatestOutputEvidenceEvent(taskDetail?.liveFeed ?? [])?.timestamp ?? null}
      />

      <InfoCard icon={TerminalSquare} title="Runner logs" value={String(runnerLogs.length)}>
        {runnerLogFile ? (
          <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
            <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Log file</p>
            <div className="mt-2">
              <InteractiveContent
                text={runnerLogFile.displayPath}
                className="text-[12.5px] leading-5 text-slate-100"
                filePath={runnerLogFile.path}
                displayPath={runnerLogFile.displayPath}
                basePath={workspacePath}
              />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">
              Only meaningful runner diagnostics are shown here. OpenClaw bootstrap debug noise is hidden.
            </p>
          </div>
        ) : null}
        {runnerLogs.length === 0 ? (
          <p>No meaningful dispatch runner diagnostics have been captured for this task yet.</p>
        ) : (
          <div className="max-h-[300px] space-y-2 overflow-y-auto pr-1">
            {runnerLogs.map((event) => (
              <div
                key={event.id}
                className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2.5"
              >
                <div className="flex items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-2">
                    <Badge variant={taskFeedBadgeVariant(event.kind, event.isError)}>{event.title}</Badge>
                  </div>
                  <span className="shrink-0 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    {formatRelativeTime(new Date(event.timestamp).getTime())}
                  </span>
                </div>
                <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-slate-100">
                  {event.detail}
                </pre>
              </div>
            ))}
          </div>
        )}
      </InfoCard>

      <InfoCard icon={TerminalSquare} title="Runs" value={String(Math.max(runs.length, operationRunCount))}>
        {runs.length === 0 && operationRunCount === 0 ? <p>No OpenClaw runs have been grouped into this task yet.</p> : null}
        {operationRunCount > 0 ? <OperationRunHistory task={selectedTask} compact /> : null}
        <div className="space-y-2">
          {runs.map((runtime) => (
            <div
              key={runtime.id}
              className="flex items-center justify-between rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
            >
              <div className="min-w-0">
                <p className="truncate text-[13px] text-white">{runtime.title}</p>
                <p className="truncate text-[10px] uppercase tracking-[0.18em] text-slate-500">
                  {runtime.subtitle}
                </p>
              </div>
              <Badge variant={badgeVariantForRuntimeStatus(runtime.status)}>{runtime.status}</Badge>
            </div>
          ))}
        </div>
      </InfoCard>

      <InfoCard icon={FileJson} title="Artifacts" value={String(createdFiles.length)}>
        <InspectorCreatedFileList
          files={createdFiles}
          basePath={workspacePath}
          emptyLabel="This task has not produced a detectable file artifact yet."
        />
      </InfoCard>

      {warnings.length > 0 ? (
        <InfoCard icon={Radar} title="Warnings" value={String(warnings.length)}>
          <InspectorBulletList items={warnings} emptyLabel="No warnings detected." />
        </InfoCard>
      ) : null}
    </>
  );
}

function TaskIntegrityCard({
  task,
  integrity,
  basePath,
  latestEvidenceAt
}: {
  task: MissionControlSnapshot["tasks"][number];
  integrity: TaskDetailRecord["integrity"];
  basePath?: string | null;
  latestEvidenceAt?: string | null;
}) {
  const isAborted = isTaskAborted(task);
  const isOptimisticPending = Boolean(task.metadata.optimistic) && !isAborted && task.status !== "stalled";
  const missingFinalResponseIssue = integrity.issues.find((issue) => issue.id === "missing-final-response");
  const partialFinalResponseIssue = integrity.issues.find((issue) => issue.id === "partial-final-response");
  const dispatchIssueDetail = resolveTaskDispatchIssueDetail(task, integrity);
  const hasPartialRuntimeEvidence = Boolean(
    integrity.finalResponseText ||
      integrity.outputFileCount > 0 ||
      integrity.transcriptTurnCount > 0 ||
      integrity.matchingTranscriptTurnCount > 0 ||
      integrity.toolNames.length > 0
  );
  const reviewStatus = resolveEffectiveTaskReviewStatus(task, {
    hasLiveActivity: task.status === "running" || task.status === "queued" || task.liveRunCount > 0,
    latestEvidenceAt
  });
  const reviewAction = readTaskReviewAction(task);
  const reviewedAt = readTaskReviewReviewedAt(task);
  const summary =
    reviewStatus
      ? resolveTaskReviewSummary(reviewStatus)
      : isAborted
      ? "This task was aborted by an operator. Captured evidence may be incomplete."
      : dispatchIssueDetail
        ? dispatchIssueDetail
      : isOptimisticPending
        ? "OpenClaw accepted this task. Session, tool, and file evidence will appear here as soon as the first runtime reports in."
        : missingFinalResponseIssue
          ? missingFinalResponseIssue.detail
        : partialFinalResponseIssue
          ? partialFinalResponseIssue.detail
        : integrity.status === "verified"
          ? "AgentOS found a matching transcript and the captured result looks internally consistent."
          : integrity.sessionMismatch
            ? "The linked transcript belongs to a different mission or stale session, so this completion cannot be trusted yet."
            : integrity.issues.some((issue) => issue.id === "empty-output-dir")
              ? "The task is marked completed, but the expected deliverables are missing from the output folder."
              : integrity.status === "error"
                ? "The captured evidence does not line up with the requested mission."
                : "AgentOS recovered partial evidence, but this result still needs operator review.";

  return (
    <InfoCard
      icon={Radar}
      title="Result integrity"
      value={
        reviewStatus
          ? resolveTaskReviewBadgeLabel(reviewStatus)
          : isAborted
          ? "aborted"
          : partialFinalResponseIssue
            ? "needs review"
            : task.status === "stalled" && !integrity.finalResponseText
              ? hasPartialRuntimeEvidence
                ? "needs review"
                : "waiting output"
              : isOptimisticPending
                ? "pending"
                : integrity.status
      }
    >
      <p>{summary}</p>
      {reviewStatus ? (
        <div className="rounded-[14px] border border-emerald-400/16 bg-emerald-400/[0.06] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-emerald-100/80">Operator review</p>
          <p className="mt-2 text-[12px] leading-5 text-emerald-50">
            {reviewAction || resolveTaskReviewBadgeLabel(reviewStatus)}
            {reviewedAt ? ` · ${formatRelativeTime(Date.parse(reviewedAt))}` : ""}
          </p>
        </div>
      ) : null}
      <InspectorMetricGrid
        items={[
          { label: "Output files", value: String(integrity.outputFileCount) },
          { label: "Transcript turns", value: String(integrity.transcriptTurnCount) },
          { label: "Matched turns", value: String(integrity.matchingTranscriptTurnCount) },
          { label: "Tools", value: String(integrity.toolNames.length) },
          { label: "Emails", value: String(integrity.emails.length) }
        ]}
      />

      {integrity.outputDir || integrity.outputDirRelative ? (
        <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Output folder</p>
          <div className="mt-2">
            <InteractiveContent
              text={integrity.outputDirRelative || integrity.outputDir || "Output folder"}
              className="text-[12.5px] leading-5 text-slate-100"
              filePath={integrity.outputDir}
              displayPath={integrity.outputDirRelative || integrity.outputDir}
              basePath={basePath}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            {integrity.outputDirExists
              ? `${integrity.outputFileCount} file${integrity.outputFileCount === 1 ? "" : "s"} detected in the folder.`
              : "The output folder is not currently accessible."}
          </p>
        </div>
      ) : null}

      <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
          Final response {integrity.finalResponseSource !== "none" ? `(${integrity.finalResponseSource})` : ""}
        </p>
        {partialFinalResponseIssue ? (
          <p className="mt-2 rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
            {partialFinalResponseIssue.detail}
          </p>
        ) : null}
        <div className="mt-2">
          {integrity.finalResponseText ? (
            <InteractiveContent
              text={integrity.finalResponseText}
              className="text-[12.5px] leading-5 text-slate-100"
              basePath={basePath}
            />
          ) : (
            <p className="text-[12.5px] leading-5 text-slate-400">No final response was captured.</p>
          )}
        </div>
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Recovered tools</p>
        {integrity.toolNames.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {integrity.toolNames.map((toolName) => (
              <Badge key={toolName} variant="muted">
                {toolName}
              </Badge>
            ))}
          </div>
        ) : (
          <p>No tool calls were recovered from a matching transcript turn.</p>
        )}
      </div>

      <div className="space-y-2">
        <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Detected emails</p>
        {integrity.emails.length > 0 ? (
          <div className="flex flex-wrap gap-2">
            {integrity.emails.map((email) => (
              <Badge key={email} variant="muted">
                {email}
              </Badge>
            ))}
          </div>
        ) : (
          <p>No email addresses were detected in the captured result.</p>
        )}
      </div>

      {integrity.dispatchSessionId ? (
        <p className="font-mono text-xs text-slate-400">
          session {shortId(integrity.dispatchSessionId, 12)}
          {integrity.sessionMismatch ? " · mismatch detected" : ""}
        </p>
      ) : null}

      {integrity.issues.length > 0 ? (
        <div className="rounded-[14px] border border-amber-400/16 bg-amber-400/[0.06] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-amber-100/80">Review issues</p>
          <div className="mt-2">
            <InspectorBulletList
              items={integrity.issues.map((issue) => `${issue.title}: ${issue.detail}`)}
              emptyLabel="No integrity issues detected."
            />
          </div>
        </div>
      ) : null}
    </InfoCard>
  );
}

function RunningTaskControlBar({
  task,
  onAbortTask,
  onControlComplete,
  compact = true
}: {
  task: MissionControlSnapshot["tasks"][number];
  onAbortTask?: (task: MissionControlSnapshot["tasks"][number]) => void;
  onControlComplete?: () => Promise<void> | void;
  compact?: boolean;
}) {
  const [mode, setMode] = useState<RunningTaskControlMode | null>(null);
  const [message, setMessage] = useState("");
  const [pendingMode, setPendingMode] = useState<RunningTaskControlMode | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const isRunning = isTaskControlAvailable(task);
  const canAbortTask = Boolean(onAbortTask) && isTaskAbortable(task);
  const trimmedMessage = message.trim();

  if (!isRunning) {
    return null;
  }

  const openMode = (nextMode: RunningTaskControlMode) => {
    setMode((current) => (current === nextMode ? null : nextMode));
    setMessage("");
  };

  const submitControl = async () => {
    if (!mode || !trimmedMessage || pendingMode) {
      return;
    }

    setPendingMode(mode);

    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(task.id)}/control`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: mode,
          message: trimmedMessage,
          dispatchId: task.dispatchId ?? null
        })
      });
      const payload = await response.json().catch(() => null);

      if (!response.ok) {
        throw new Error(readControlError(payload) || "Unable to update the running task.");
      }

      const transportNotice = readControlTransportNotice(payload);
      toast.success(
        transportNotice?.title ?? (mode === "steer" ? "Steer request sent." : "Context added to session."),
        transportNotice?.description ? { description: transportNotice.description } : undefined
      );
      setMode(null);
      setMessage("");
      void onControlComplete?.();
    } catch (error) {
      toast.error(mode === "steer" ? "Steer request failed." : "Context injection failed.", {
        description: error instanceof Error ? error.message : "Unknown control error."
      });
    } finally {
      setPendingMode(null);
    }
  };

  return (
    <div className={cn("rounded-[12px] border border-sky-100/[0.08] bg-[linear-gradient(180deg,rgba(8,20,34,0.72),rgba(5,13,25,0.7))] shadow-[inset_0_1px_0_rgba(255,255,255,0.04)]", compact ? "p-0" : "p-3")}>
      {compact ? (
        <div className="relative flex gap-1.5">
          <Button
            type="button"
            variant={mode === "steer" ? "default" : "secondary"}
            size="sm"
            className={cn(
              "h-9 flex-1 justify-center gap-2 rounded-[10px] border px-3 text-[11px]",
              mode === "steer"
                ? "border-sky-100/[0.18] bg-sky-200/[0.12] text-sky-50"
                : "border-sky-100/[0.08] bg-white/[0.045] text-slate-100 hover:bg-white/[0.08]"
            )}
            onClick={() => openMode("steer")}
          >
            <Pencil className="h-3.5 w-3.5" />
            Steer task
          </Button>
          <button
            type="button"
            aria-label="More task controls"
            aria-expanded={menuOpen}
            onClick={() => setMenuOpen((current) => !current)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-[10px] border border-sky-100/[0.08] bg-white/[0.045] text-slate-300 transition-colors hover:bg-white/[0.08] hover:text-white"
          >
            <MoreHorizontal className="h-3.5 w-3.5" />
          </button>
          {menuOpen ? (
            <div className="absolute right-0 top-[calc(100%+6px)] z-30 min-w-[156px] rounded-[10px] border border-white/[0.1] bg-slate-950/96 p-1 shadow-[0_14px_32px_rgba(0,0,0,0.34)]">
              <button
                type="button"
                onClick={() => {
                  openMode("inject");
                  setMenuOpen(false);
                }}
                className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[11px] text-slate-200 hover:bg-white/[0.06]"
              >
                <MessageSquareText className="h-3.5 w-3.5 text-sky-200" />
                Inject context
              </button>
              <button
                type="button"
                disabled={!canAbortTask}
                onClick={() => {
                  if (canAbortTask) onAbortTask?.(task);
                }}
                className="flex w-full items-center gap-2 rounded-[7px] px-2.5 py-2 text-left text-[11px] text-rose-200 hover:bg-rose-500/10 disabled:cursor-not-allowed disabled:opacity-45"
              >
                <AlertTriangle className="h-3.5 w-3.5" />
                Abort task
              </button>
            </div>
          ) : null}
        </div>
      ) : (
        <>
          <p className="mb-2.5 text-[10px] font-semibold uppercase tracking-[0.24em] text-sky-200/60">Quick actions</p>
          <div className="grid gap-2 sm:grid-cols-3">
        <Button
          type="button"
          variant="destructive"
          size="sm"
          disabled={!canAbortTask}
          className="h-11 justify-start gap-2 rounded-[14px] border border-rose-400/25 bg-rose-500/10 px-3 text-[12px] text-rose-100 hover:bg-rose-500/16 disabled:opacity-50"
          onClick={() => {
            if (!canAbortTask) {
              return;
            }

            onAbortTask?.(task);
          }}
        >
          <AlertTriangle className="h-3.5 w-3.5" />
          Stop
        </Button>
        <Button
          type="button"
          variant={mode === "steer" ? "default" : "secondary"}
          size="sm"
          className={cn(
            "h-11 justify-start gap-2 rounded-[14px] border px-3 text-[12px]",
            mode === "steer"
              ? "border-sky-100/[0.18] bg-sky-200/[0.12] text-sky-50 shadow-[0_0_18px_rgba(125,211,252,0.1)]"
              : "border-sky-100/[0.08] bg-white/[0.045] text-slate-100 hover:bg-white/[0.08]"
          )}
          onClick={() => openMode("steer")}
        >
          <Pencil className="h-3.5 w-3.5" />
          Steer
        </Button>
        <Button
          type="button"
          variant={mode === "inject" ? "default" : "secondary"}
          size="sm"
          className={cn(
            "h-11 justify-start gap-2 rounded-[14px] border px-3 text-[12px]",
            mode === "inject"
              ? "border-sky-100/[0.18] bg-sky-200/[0.12] text-sky-50 shadow-[0_0_18px_rgba(125,211,252,0.1)]"
              : "border-sky-100/[0.08] bg-white/[0.045] text-slate-100 hover:bg-white/[0.08]"
          )}
          onClick={() => openMode("inject")}
        >
          <MessageSquareText className="h-3.5 w-3.5" />
          Add context
        </Button>
          </div>
        </>
      )}

      {mode ? (
        <div className="mt-3 space-y-2.5">
          <Textarea
            value={message}
            disabled={Boolean(pendingMode)}
            rows={3}
            maxLength={4000}
            placeholder={
              mode === "steer"
                ? "Focus on tests"
                : "Inject this note/reference into the running session"
            }
            className="min-h-[86px] rounded-[14px] border-sky-100/[0.08] bg-slate-950/40 px-3 py-2.5 text-[12px] leading-5 text-slate-100 placeholder:text-slate-500"
            onChange={(event) => setMessage(event.target.value)}
          />
          {mode === "steer" ? (
            <div className="flex flex-wrap gap-1.5">
              {STEER_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  disabled={Boolean(pendingMode)}
                  className="rounded-full border border-sky-100/[0.08] bg-white/[0.04] px-2.5 py-1 text-[10px] text-slate-300 transition-colors hover:border-sky-100/[0.16] hover:text-slate-100 disabled:cursor-not-allowed disabled:opacity-60"
                  onClick={() => setMessage(suggestion)}
                >
                  {suggestion}
                </button>
              ))}
            </div>
          ) : null}
          <div className="flex flex-wrap justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={Boolean(pendingMode)}
              className="h-8 rounded-[10px] px-2.5 text-[11px]"
              onClick={() => {
                setMode(null);
                setMessage("");
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="default"
              size="sm"
              disabled={!trimmedMessage || Boolean(pendingMode)}
              className="h-8 rounded-[10px] px-2.5 text-[11px]"
              onClick={() => void submitControl()}
            >
              {pendingMode ? "Sending..." : mode === "steer" ? "Send steer" : "Add context"}
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}

function TaskFeedContent({
  task,
  basePath,
  taskDetail,
  taskDetailLoading,
  taskDetailError,
  taskDetailNotice,
  onAbortTask,
  onControlComplete
}: {
  task: MissionControlSnapshot["tasks"][number];
  basePath?: string | null;
  taskDetail: TaskDetailRecord | null;
  taskDetailLoading: boolean;
  taskDetailError: string | null;
  taskDetailNotice: string | null;
  onAbortTask?: (task: MissionControlSnapshot["tasks"][number]) => void;
  onControlComplete?: () => Promise<void> | void;
}) {
  if (taskDetailLoading && !taskDetail) {
    return (
      <InfoCard icon={TerminalSquare} title="Live feed" value="connecting">
        <RunningTaskControlBar
          task={task}
          onAbortTask={onAbortTask}
          onControlComplete={onControlComplete}
        />
        <p>Connecting to the task feed…</p>
      </InfoCard>
    );
  }

  if (taskDetailError && !taskDetail) {
    return (
      <InfoCard icon={TerminalSquare} title="Live feed" value="error">
        <RunningTaskControlBar
          task={task}
          onAbortTask={onAbortTask}
          onControlComplete={onControlComplete}
        />
        <p>{taskDetailError}</p>
      </InfoCard>
    );
  }

  const liveFeed = mergeTaskFeedEvents(
    taskDetail?.liveFeed ?? [],
    readTaskFeedEvents(task.metadata.operationFeed),
    readTaskFeedEvents(task.metadata.reviewEvents)
  );
  const visibleLiveFeed = liveFeed.filter((event) => !isRunnerLogTaskEvent(event));
  const integrity = taskDetail?.integrity ?? createOptimisticTaskIntegrity(task);

  return (
    <>
      {readOperationRunCount(taskDetail?.task ?? task) > 0 ? (
        <InfoCard icon={ClipboardList} title="Run history" value={String(readOperationRunCount(taskDetail?.task ?? task))}>
          <OperationRecoveryControls task={taskDetail?.task ?? task} onComplete={onControlComplete} />
          <OperationRunHistory task={taskDetail?.task ?? task} />
        </InfoCard>
      ) : null}
      <InfoCard icon={TerminalSquare} title="Live feed" value={String(visibleLiveFeed.length)}>
      <RunningTaskControlBar
        task={taskDetail?.task ?? task}
        onAbortTask={onAbortTask}
        onControlComplete={onControlComplete}
      />
      {taskDetailError ? (
        <p className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
          {taskDetailError}
        </p>
      ) : null}
      {taskDetailNotice ? (
        <p className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
          {taskDetailNotice}
        </p>
      ) : null}
      {integrity.issues.length > 0 ? (
        <p className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
          {integrity.issues[0]?.detail}
        </p>
      ) : null}
      {visibleLiveFeed.length === 0 ? <p>No streamed task events have arrived yet.</p> : null}
      <div className="space-y-2">
        {visibleLiveFeed.map((event) => (
          <div
            key={event.id}
            className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2.5"
          >
            <div className="flex items-center justify-between gap-3">
              <div className="flex min-w-0 items-center gap-2">
                <Badge variant={taskFeedBadgeVariant(event.kind, event.isError)}>{event.kind}</Badge>
                <p className="truncate text-[12px] text-white">{event.title}</p>
              </div>
              <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                {formatRelativeTime(new Date(event.timestamp).getTime())}
              </span>
            </div>
            <div className="mt-2">
              <InteractiveContent
                text={event.detail}
                className="text-[12.5px] leading-5 text-slate-100"
                url={event.url}
                filePath={event.filePath}
                displayPath={event.displayPath}
                basePath={basePath}
              />
            </div>
          </div>
        ))}
      </div>
      </InfoCard>
    </>
  );
}

type OperationRunHistoryEntry = {
  id: string;
  timestamp: string;
  status: string;
  output: string | null;
  error: string | null;
  durationMs: number | null;
};

function OperationRecoveryControls({
  task,
  onComplete
}: {
  task: MissionControlSnapshot["tasks"][number];
  onComplete?: () => Promise<void> | void;
}) {
  const [pending, setPending] = useState<"run" | "retry" | "pause" | "resume" | null>(null);
  const jobId = typeof task.metadata.operationJobId === "string" ? task.metadata.operationJobId : null;
  const paused = task.metadata.operationStatus === "paused";
  const hasFailure = task.metadata.lastRunStatus === "error" || Boolean(task.metadata.operationLastError);
  if (!jobId) return null;

  const perform = async (action: "run" | "retry" | "pause" | "resume") => {
    if (pending) return;
    setPending(action);
    try {
      const response = await fetch("/api/operations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, jobId })
      });
      const payload = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok || payload?.error) throw new Error(payload?.error || "OpenClaw rejected the recovery action.");
      toast.success(action === "run" || action === "retry" ? "Run accepted by OpenClaw." : action === "pause" ? "Schedule paused." : "Schedule resumed.");
      await onComplete?.();
    } catch (error) {
      toast.error("Recovery action failed.", { description: error instanceof Error ? error.message : "Unknown error." });
    } finally {
      setPending(null);
    }
  };

  return (
    <div className="mb-3 grid grid-cols-2 gap-2">
      <Button size="sm" disabled={Boolean(pending) || paused} onClick={() => void perform("run")}>
        {pending === "run" ? "Starting…" : "Run now"}
      </Button>
      <Button size="sm" variant="secondary" disabled={Boolean(pending)} onClick={() => void perform(paused ? "resume" : "pause")}>
        {pending === "pause" || pending === "resume" ? "Updating…" : paused ? "Resume schedule" : "Pause schedule"}
      </Button>
      {hasFailure ? (
        <Button className="col-span-2" size="sm" variant="secondary" disabled={Boolean(pending) || paused} onClick={() => void perform("retry")}>
          {pending === "retry" ? "Retrying…" : "Retry failed run"}
        </Button>
      ) : null}
      {paused ? <p className="col-span-2 text-[11px] leading-4 opacity-60">No future runs will start until this schedule is resumed.</p> : null}
    </div>
  );
}

function OperationRunHistory({
  task,
  compact = false
}: {
  task: MissionControlSnapshot["tasks"][number];
  compact?: boolean;
}) {
  const entries = readOperationRunHistory(task).slice(0, compact ? 6 : 24);
  const nextRunAt = typeof task.metadata.nextRunAt === "string" ? task.metadata.nextRunAt : null;

  return (
    <div className="space-y-2">
      {nextRunAt ? (
        <div className="flex items-center justify-between gap-3 rounded-[12px] border border-current/10 bg-current/[0.025] px-3 py-2">
          <span className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-55">Next run</span>
          <span className="text-right text-[11px] font-medium opacity-80">{new Date(nextRunAt).toLocaleString()}</span>
        </div>
      ) : null}
      {entries.map((entry) => (
        <div key={entry.id} className="rounded-[12px] border border-current/10 bg-current/[0.025] px-3 py-2.5">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <span className={cn(
                "h-2 w-2 rounded-full",
                entry.status === "error"
                  ? "bg-rose-500"
                  : entry.status === "running" || entry.status === "queued" || entry.status === "possible missed"
                    ? "bg-amber-500"
                    : "bg-emerald-500"
              )} />
              <span className="text-[10px] font-semibold uppercase tracking-[0.16em] opacity-70">{entry.status}</span>
            </div>
            <span className="text-[10px] uppercase tracking-[0.12em] opacity-50">{new Date(entry.timestamp).toLocaleString()}</span>
          </div>
          {entry.error || entry.output ? (
            <p className="mt-2 line-clamp-3 text-[12px] leading-5 opacity-75">{entry.error || entry.output}</p>
          ) : null}
        </div>
      ))}
    </div>
  );
}

function readOperationRunCount(task: MissionControlSnapshot["tasks"][number]) {
  return readOperationRunHistory(task)
    .filter((entry) => entry.status !== "possible missed" && entry.status !== "recovered")
    .length;
}

function readOperationRunHistory(task: MissionControlSnapshot["tasks"][number]): OperationRunHistoryEntry[] {
  const rawRuns = Array.isArray(task.metadata.operationRunHistory) ? task.metadata.operationRunHistory : [];
  const byId = new Map<string, OperationRunHistoryEntry>();

  for (const value of rawRuns) {
    if (!value || typeof value !== "object") continue;
    const run = value as Partial<OperationRunHistoryEntry>;
    if (typeof run.id !== "string" || typeof run.timestamp !== "string" || typeof run.status !== "string") continue;
    byId.set(run.id, {
      id: run.id,
      timestamp: run.timestamp,
      status: run.status,
      output: typeof run.output === "string" ? run.output : null,
      error: typeof run.error === "string" ? run.error : null,
      durationMs: typeof run.durationMs === "number" ? run.durationMs : null
    });
  }

  for (const event of readTaskFeedEvents(task.metadata.operationFeed)) {
    if (event.kind !== "assistant") continue;
    const eventTime = Date.parse(event.timestamp);
    const matchingRun = [...byId.values()].find((run) => {
      const runTime = Date.parse(run.timestamp);
      return Number.isFinite(eventTime) && Number.isFinite(runTime) && Math.abs(eventTime - runTime) <= 90_000;
    });
    if (matchingRun) {
      byId.set(matchingRun.id, { ...matchingRun, output: matchingRun.output || event.detail });
      continue;
    }
    const id = `result:${event.id}`;
    if (!byId.has(id)) {
      byId.set(id, { id, timestamp: event.timestamp, status: "completed", output: event.detail, error: null, durationMs: null });
    }
  }

  const recoveryEvents = Array.isArray(task.metadata.operationRecoveryHistory)
    ? task.metadata.operationRecoveryHistory
    : [];
  for (const value of recoveryEvents) {
    if (!value || typeof value !== "object") continue;
    const event = value as Record<string, unknown>;
    if (event.status !== "missed" && event.status !== "recovered") continue;
    if (typeof event.id !== "string" || typeof event.timestamp !== "string" || typeof event.detail !== "string") continue;
    byId.set(event.id, {
      id: event.id,
      timestamp: event.timestamp,
      status: event.status === "missed" ? "possible missed" : "recovered",
      output: event.detail,
      error: null,
      durationMs: null
    });
  }

  return [...byId.values()]
    .sort((left, right) => Date.parse(right.timestamp) - Date.parse(left.timestamp))
    .slice(0, 24);
}

function TaskFilesContent({
  snapshot,
  task,
  taskDetail
}: {
  snapshot: MissionControlSnapshot;
  task: MissionControlSnapshot["tasks"][number];
  taskDetail: TaskDetailRecord | null;
}) {
  const runs =
    taskDetail?.runs ??
    snapshot.runtimes
      .filter((runtime) => task.runtimeIds.includes(runtime.id))
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const createdFiles =
    dedupeCreatedFiles(taskDetail?.createdFiles ?? runs.flatMap((runtime) => extractCreatedFilesFromRuntime(runtime)));
  const integrity = taskDetail?.integrity ?? createOptimisticTaskIntegrity(task);
  const workspacePath = resolveTaskWorkspacePath(snapshot, task, runs);

  return (
    <InfoCard icon={FileJson} title="Files" value={String(createdFiles.length)}>
      <p>{runs.length} run{runs.length === 1 ? "" : "s"} contributed to this task.</p>
      {integrity.outputDir || integrity.outputDirRelative ? (
        <div className="rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5">
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Output folder</p>
          <div className="mt-2">
            <InteractiveContent
              text={integrity.outputDirRelative || integrity.outputDir || "Output folder"}
              className="text-[12.5px] leading-5 text-slate-100"
              filePath={integrity.outputDir}
              displayPath={integrity.outputDirRelative || integrity.outputDir}
              basePath={workspacePath}
            />
          </div>
          <p className="mt-2 text-[11px] text-slate-400">
            {integrity.outputDirExists
              ? `${integrity.outputFileCount} file${integrity.outputFileCount === 1 ? "" : "s"} detected in the folder.`
              : "The output folder is not currently accessible."}
          </p>
        </div>
      ) : null}
      <InspectorCreatedFileList
        files={createdFiles}
        basePath={workspacePath}
        emptyLabel="This task has not produced a detectable file artifact yet."
      />
    </InfoCard>
  );
}

function createOptimisticTaskDetail(task: MissionControlSnapshot["tasks"][number]): TaskDetailRecord {
  return {
    task,
    runs: [],
    outputs: [],
    liveFeed: readOptimisticTaskFeed(task),
    createdFiles: [],
    warnings:
      isTaskAborted(task) || (task.status === "stalled" && !isMissingTranscriptCopy(task.subtitle))
        ? [task.subtitle]
        : [],
    integrity: createOptimisticTaskIntegrity(task)
  };
}

function resolveTaskWorkspacePath(
  snapshot: MissionControlSnapshot,
  task: MissionControlSnapshot["tasks"][number],
  runs: MissionControlSnapshot["runtimes"] = []
) {
  return resolveTaskWorkspace(snapshot, task, runs)?.path ?? resolveTaskAgentWorkspacePath(snapshot, task, runs);
}

function resolveTaskWorkspace(
  snapshot: MissionControlSnapshot,
  task: MissionControlSnapshot["tasks"][number],
  runs: MissionControlSnapshot["runtimes"] = []
) {
  const workspaceIds = [
    task.workspaceId,
    ...runs.map((runtime) => runtime.workspaceId),
    task.primaryAgentId ? snapshot.agents.find((agent) => agent.id === task.primaryAgentId)?.workspaceId : undefined,
    ...runs.map((runtime) =>
      runtime.agentId ? snapshot.agents.find((agent) => agent.id === runtime.agentId)?.workspaceId : undefined
    )
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const workspaceId of workspaceIds) {
    const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

    if (workspace) {
      return workspace;
    }
  }

  return null;
}

function resolveTaskAgentWorkspacePath(
  snapshot: MissionControlSnapshot,
  task: MissionControlSnapshot["tasks"][number],
  runs: MissionControlSnapshot["runtimes"] = []
) {
  const agentIds = [
    task.primaryAgentId,
    ...runs.map((runtime) => runtime.agentId)
  ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

  for (const agentId of agentIds) {
    const workspacePath = snapshot.agents.find((agent) => agent.id === agentId)?.workspacePath;

    if (workspacePath) {
      return workspacePath;
    }
  }

  return undefined;
}

function createOptimisticTaskIntegrity(
  task: MissionControlSnapshot["tasks"][number]
): TaskDetailRecord["integrity"] {
  const isOptimisticPending = Boolean(task.metadata.optimistic) && !isTaskAborted(task) && task.status !== "stalled";
  const hasCapturedOutput = hasCapturedTaskOutput(task);
  const issues: TaskDetailRecord["integrity"]["issues"] =
    isTaskAborted(task)
      ? [
          {
            id: "task-cancelled",
            severity: "warning" as const,
            title: "Task was cancelled by the operator",
            detail: "The mission dispatch was stopped before completion, so the captured evidence is intentionally incomplete."
          }
        ]
      : task.status === "stalled"
      ? [
          {
            id: hasCapturedOutput ? "partial-final-response" : "stalled-dispatch",
            severity: "warning" as const,
            title: hasCapturedOutput ? "Final response came from an incomplete runtime" : "Waiting for output evidence",
            detail: hasCapturedOutput
              ? "The assistant produced output, but the runtime stalled before the task completed. Treat this as the last captured response, not a verified completion."
              : isMissingTranscriptCopy(task.subtitle)
                ? "AgentOS is still waiting for the first transcript entry from this runtime."
                : task.subtitle
          }
        ]
      : [];

  return {
    status:
      issues.some((issue) => issue.severity === "error")
        ? "error"
        : isOptimisticPending
          ? "warning"
          : issues.length > 0
            ? "warning"
            : "verified",
    outputDir:
      typeof task.metadata.outputDir === "string" && task.metadata.outputDir.trim().length > 0
        ? task.metadata.outputDir
        : null,
    outputDirRelative:
      typeof task.metadata.outputDirRelative === "string" && task.metadata.outputDirRelative.trim().length > 0
        ? task.metadata.outputDirRelative
        : null,
    outputDirExists: false,
    outputFileCount: 0,
    transcriptTurnCount: 0,
    matchingTranscriptTurnCount: 0,
    finalResponseText: hasCapturedOutput ? readTaskResultPreview(task) : null,
    finalResponseSource: "none",
    dispatchSessionId: null,
    sessionMismatch: false,
    toolNames: [],
    emails: [],
    issues
  };
}

function readOptimisticTaskFeed(task: MissionControlSnapshot["tasks"][number]) {
  const byId = new Map<string, TaskFeedEvent>();

  for (const event of [
    ...readTaskFeedEvents(task.metadata.optimisticEvents),
    ...readTaskFeedEvents(task.metadata.operationFeed),
    ...readTaskFeedEvents(task.metadata.reviewEvents)
  ]) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function readTaskFeedEvents(value: unknown) {
  if (!Array.isArray(value)) {
    return [] as TaskFeedEvent[];
  }

  return value.filter(isTaskFeedEvent);
}

function mergeTaskFeedEvents(...eventGroups: TaskFeedEvent[][]) {
  const byId = new Map<string, TaskFeedEvent>();

  for (const event of eventGroups.flat()) {
    byId.set(event.id, event);
  }

  return [...byId.values()].sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function mergeLocalTaskReviewMetadata(
  streamedTask: MissionControlSnapshot["tasks"][number],
  localTask: MissionControlSnapshot["tasks"][number]
) {
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

function findLatestOutputEvidenceEvent(feed: TaskFeedEvent[]) {
  return [...feed]
    .reverse()
    .find((event) => event.kind === "assistant" || event.kind === "tool" || event.kind === "artifact") ?? null;
}

function readTaskPromptText(task: MissionControlSnapshot["tasks"][number]) {
  return task.mission?.trim() || task.title.trim() || "Untitled task";
}

function readTaskRoutedPrompt(task: MissionControlSnapshot["tasks"][number]) {
  const routedPrompt =
    typeof task.metadata.routedMission === "string" ? task.metadata.routedMission.trim() : "";

  return routedPrompt || readTaskPromptText(task);
}

function readTaskResultPreview(task: MissionControlSnapshot["tasks"][number]) {
  const resultPreview =
    typeof task.metadata.resultPreview === "string" ? task.metadata.resultPreview.trim() : "";

  return resultPreview || task.subtitle.trim() || "";
}

function hasCapturedTaskOutput(task: MissionControlSnapshot["tasks"][number]) {
  const finalResponse =
    typeof task.metadata.finalResponseText === "string" ? task.metadata.finalResponseText.trim() : "";
  const resultPreview =
    typeof task.metadata.resultPreview === "string" ? task.metadata.resultPreview.trim() : "";
  const candidate = finalResponse || resultPreview;

  return Boolean(candidate && !isWaitingForOutputCopy(candidate));
}

function isWaitingForOutputCopy(value: string) {
  return (
    isMissingTranscriptCopy(value) ||
    /waiting for (the first )?(transcript|output)/i.test(value) ||
    /working silently/i.test(value)
  );
}

function readTaskSummaryCount(value: unknown, fallback: number) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function taskPromptsDiffer(left: string, right: string) {
  return normalizeTaskComparisonText(left) !== normalizeTaskComparisonText(right);
}

function normalizeTaskComparisonText(value: string) {
  return value.replace(/\s+/g, " ").trim();
}

function readTaskRunnerLogEvents(feed: TaskFeedEvent[]) {
  return feed
    .filter((event) => isRunnerLogTaskEvent(event))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
}

function readTaskRunnerLogFile(events: TaskFeedEvent[]) {
  for (const event of events) {
    if (typeof event.filePath === "string" && typeof event.displayPath === "string") {
      return {
        path: event.filePath,
        displayPath: event.displayPath
      };
    }
  }

  return null;
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

function isMissingTranscriptCopy(value: string | null | undefined) {
  return (
    typeof value === "string" &&
    (/No transcript file was found for this runtime session/i.test(value) ||
      /No transcript entries were found for this runtime/i.test(value))
  );
}

function resolveTaskDispatchStatus(task: MissionControlSnapshot["tasks"][number]) {
  return typeof task.metadata.dispatchStatus === "string" ? task.metadata.dispatchStatus : null;
}

function isTaskAborted(task: MissionControlSnapshot["tasks"][number]) {
  const dispatchStatus = resolveTaskDispatchStatus(task);
  const runtimeStatus = task.status as string;
  return dispatchStatus === "cancelled" || dispatchStatus === "aborted" || runtimeStatus === "cancelled" || runtimeStatus === "aborted";
}

function isTaskAbortable(task: MissionControlSnapshot["tasks"][number]) {
  if (isTaskAborted(task)) {
    return false;
  }

  const runtimeStatus = task.status as string;
  return runtimeStatus === "running" || runtimeStatus === "queued";
}

function isTaskControlAvailable(task: MissionControlSnapshot["tasks"][number]) {
  return isTaskAbortable(task) || task.liveRunCount > 0;
}

function readControlError(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const record = payload as Record<string, unknown>;
  return typeof record.error === "string"
    ? record.error
    : typeof record.message === "string"
      ? record.message
      : null;
}

function readControlTransportNotice(payload: unknown) {
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const result = (payload as Record<string, unknown>).result;
  if (!result || typeof result !== "object") {
    return null;
  }

  const transport = (result as Record<string, unknown>).transport;
  if (!transport || typeof transport !== "object") {
    return null;
  }

  const record = transport as Record<string, unknown>;
  const fallback = typeof record.fallback === "string" ? record.fallback : "";
  const requestedMethod = typeof record.requestedMethod === "string" ? record.requestedMethod : null;
  const actualMethod = typeof record.actualMethod === "string" ? record.actualMethod : null;
  const reason = typeof record.reason === "string" ? record.reason : null;

  if (fallback !== "gateway-compatibility" || !requestedMethod || !actualMethod) {
    return null;
  }

  return {
    title: `Sent via ${actualMethod}.`,
    description: reason
      ? `${requestedMethod} was unavailable, so AgentOS used Gateway compatibility fallback. ${reason}`
      : `${requestedMethod} was unavailable, so AgentOS used Gateway compatibility fallback.`
  };
}

function RuntimeContent({
  snapshot,
  runtimeId,
  runtimeOutput,
  runtimeOutputLoading,
  runtimeOutputError,
  onSnapshotChange,
  onRefresh
}: {
  snapshot: MissionControlSnapshot;
  runtimeId: string;
  runtimeOutput: RuntimeOutputRecord | null;
  runtimeOutputLoading: boolean;
  runtimeOutputError: string | null;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void>;
}) {
  const [resettingModel, setResettingModel] = useState(false);
  const [savingSessionModel, setSavingSessionModel] = useState(false);
  const [sessionModelDraft, setSessionModelDraft] = useState("");
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);
  const {
    models: sessionModelOptions,
    isLoading: sessionModelsLoading,
    selection: nativeSessionSelection
  } = useModelCatalog({
    enabled: runtime?.source === "session",
    snapshot,
    agentId: runtime?.agentId,
    sessionKey: runtime?.key
  });
  const agent = snapshot.agents.find((entry) => entry.id === runtime?.agentId);
  const agentModelId = agent?.modelId && agent.modelId !== "unassigned" ? agent.modelId : null;
  const hasNativeSessionSelection = nativeSessionSelection?.scope === "session";
  const hasSessionModelOverride =
    runtime?.source === "session" &&
    (hasNativeSessionSelection
      ? nativeSessionSelection.overrideSource === "user"
      : runtime.modelOverrideSource === "user" || (
          !runtime.modelOverrideSource &&
          Boolean(runtime.key) &&
          Boolean(runtime.modelId) &&
          Boolean(agentModelId) &&
          runtime.modelId !== agentModelId
        ));

  useEffect(() => {
    setSessionModelDraft(
      hasSessionModelOverride
        ? nativeSessionSelection?.configuredModelId ?? runtime?.modelId ?? ""
        : ""
    );
  }, [hasSessionModelOverride, nativeSessionSelection?.configuredModelId, runtime?.id, runtime?.modelId]);

  const createdFiles = dedupeCreatedFiles(runtimeOutput?.createdFiles ?? (runtime ? extractCreatedFilesFromRuntime(runtime) : []));
  const runtimeWarnings = runtimeOutput?.warnings ?? (runtime ? extractWarningsFromRuntime(runtime) : []);
  const runtimeWarningSummary = runtimeOutput?.warningSummary ?? runtimeWarnings[0] ?? null;
  const runtimeBasePath = runtime ? snapshot.workspaces.find((entry) => entry.id === runtime.workspaceId)?.path : undefined;
  const runtimeEvidenceView = runtime ? buildInspectorRuntimeEvidenceView({ runtime, output: runtimeOutput }) : null;

  if (!runtime) {
    return null;
  }

  const resetModelOverride = async () => {
    if (!hasSessionModelOverride || resettingModel) {
      return;
    }

    setResettingModel(true);
    try {
      const response = await fetch("/api/sessions/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          sessionKey: runtime.key,
          agentId: runtime.agentId,
          action: "inherit"
        })
      });
      const payload = (await response.json()) as { error?: string; snapshot?: MissionControlSnapshot };
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Unable to reset the session model override.");
      }
      if (payload.snapshot) {
        onSnapshotChange?.(() => payload.snapshot!);
      }
      toast.success("Session now inherits the agent model.");
      void onRefresh?.().catch(() => undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to reset the session model override.");
    } finally {
      setResettingModel(false);
    }
  };

  const saveSessionModel = async () => {
    if (!runtime || runtime.source !== "session" || !sessionModelDraft || savingSessionModel) {
      return;
    }

    setSavingSessionModel(true);
    try {
      const response = await fetch("/api/sessions/model", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "set",
          sessionKey: runtime.key,
          agentId: runtime.agentId,
          modelId: sessionModelDraft
        })
      });
      const payload = (await response.json()) as { error?: string; snapshot?: MissionControlSnapshot };
      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Unable to set the session model.");
      }
      if (payload.snapshot) {
        onSnapshotChange?.(() => payload.snapshot!);
      }
      toast.success("Session model updated.");
      void onRefresh?.().catch(() => undefined);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Unable to set the session model.");
    } finally {
      setSavingSessionModel(false);
    }
  };

  return (
    <>
      <InfoCard icon={TerminalSquare} title="Runtime key" value={runtime.status}>
        <p className="font-mono text-xs text-slate-400">{runtime.key}</p>
        <p>Session {shortId(runtime.sessionId, 12)}</p>
        {runtime.taskId ? <p>Task {shortId(runtime.taskId, 12)}</p> : null}
        {runtime.runId ? <p>Run {shortId(runtime.runId, 12)}</p> : null}
      </InfoCard>
      <InfoCard
        icon={Cpu}
        title="Model scope"
        value={hasSessionModelOverride ? "session override" : "agent inherited"}
      >
        <p>Session: {nativeSessionSelection?.effectiveModelId || runtime.modelId || agentModelId || "OpenClaw default"}</p>
        <p>Agent: {agentModelId || "OpenClaw global default"}</p>
        {runtime.source === "session" ? (
          <div className="mt-2 space-y-2">
            <label className="block text-[11px] text-slate-400" htmlFor={`session-model-${runtime.id}`}>Set session model</label>
            <select
              id={`session-model-${runtime.id}`}
              value={sessionModelDraft}
              disabled={sessionModelsLoading || savingSessionModel}
              onChange={(event) => setSessionModelDraft(event.target.value)}
              className="h-8 w-full rounded-[10px] border border-white/10 bg-slate-950/60 px-2 text-[11px] text-slate-100"
            >
              <option value="">Inherit agent model</option>
              {sessionModelOptions.filter((model) => isSelectableModel(model)).map((model) => (
                <option key={model.id} value={model.id}>{model.name}</option>
              ))}
            </select>
            {sessionModelDraft && sessionModelDraft !== runtime.modelId ? (
              <Button type="button" variant="secondary" className="h-8 rounded-[10px] px-3 text-[11px]" onClick={() => void saveSessionModel()} disabled={savingSessionModel}>
                {savingSessionModel ? "Saving…" : "Save session model"}
              </Button>
            ) : null}
          </div>
        ) : null}
        {hasSessionModelOverride ? (
          <Button
            type="button"
            variant="secondary"
            className="mt-2 h-8 rounded-[10px] px-3 text-[11px]"
            disabled={resettingModel}
            onClick={() => {
              void resetModelOverride();
            }}
          >
            <RotateCcw className={cn("mr-2 h-3.5 w-3.5", resettingModel && "animate-spin")} />
            Use agent model
          </Button>
        ) : null}
      </InfoCard>
      {runtimeEvidenceView ? <RuntimeEvidencePanel view={runtimeEvidenceView} /> : null}
      <InfoCard icon={Radar} title="Activity" value={formatRelativeTime(runtime.updatedAt, relativeTimeReferenceMs)}>
        <p>{runtime.subtitle}</p>
        <p>{formatTokens(runtime.tokenUsage?.total)} tokens</p>
      </InfoCard>
      <InfoCard
        icon={Cpu}
        title="Latest output"
        value={runtimeOutput?.stopReason || (runtimeOutputLoading ? "loading" : "no transcript")}
      >
        {runtimeOutputLoading ? <p>Loading transcript output…</p> : null}
        {runtimeOutputError ? <p>{runtimeOutputError}</p> : null}
        {!runtimeOutputLoading && !runtimeOutputError ? (
          <InteractiveContent
            text={runtimeOutput?.finalText || runtimeOutput?.errorMessage || "No assistant output has been recorded for this runtime yet."}
            className="text-[13px] leading-5 text-slate-100"
            basePath={runtimeBasePath}
          />
        ) : null}
        {runtimeWarningSummary ? (
          <p className="mt-3 rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
            Fallback used: {runtimeWarningSummary}
          </p>
        ) : null}
        {runtimeOutput?.finalTimestamp ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            Updated {formatRelativeTime(new Date(runtimeOutput.finalTimestamp).getTime())}
          </p>
        ) : null}
      </InfoCard>
      <InfoCard icon={FileJson} title="Created files" value={String(createdFiles.length)}>
        <InspectorCreatedFileList
          files={createdFiles}
          basePath={snapshot.workspaces.find((entry) => entry.id === runtime.workspaceId)?.path}
          emptyLabel="This runtime has not produced a detectable file artifact."
        />
      </InfoCard>
    </>
  );
}

function RuntimeFilesContent({
  runtime,
  runtimeOutput
}: {
  runtime: MissionControlSnapshot["runtimes"][number];
  runtimeOutput: RuntimeOutputRecord | null;
}) {
  const createdFiles = dedupeCreatedFiles(runtimeOutput?.createdFiles ?? extractCreatedFilesFromRuntime(runtime));

  return (
    <InfoCard icon={FileJson} title="Files" value={String(createdFiles.length)}>
      <p>{runtime.title}</p>
      <InspectorCreatedFileList
        files={createdFiles}
        emptyLabel="This runtime has not produced a detectable file artifact."
      />
    </InfoCard>
  );
}

function RuntimeOutputContent({
  runtime,
  basePath,
  runtimeOutput,
  runtimeOutputLoading,
  runtimeOutputError
}: {
  runtime: MissionControlSnapshot["runtimes"][number];
  basePath?: string | null;
  runtimeOutput: RuntimeOutputRecord | null;
  runtimeOutputLoading: boolean;
  runtimeOutputError: string | null;
}) {
  if (runtimeOutputLoading) {
    return (
      <InfoCard icon={TerminalSquare} title="Runtime output" value="loading">
        <p>Loading transcript output for {runtime.title}…</p>
      </InfoCard>
    );
  }

  if (runtimeOutputError) {
    return (
      <InfoCard icon={TerminalSquare} title="Runtime output" value="error">
        <p>{runtimeOutputError}</p>
      </InfoCard>
    );
  }

  if (!runtimeOutput) {
    return (
      <InfoCard icon={TerminalSquare} title="Runtime output" value="missing">
        <p>No transcript data is available for this runtime.</p>
      </InfoCard>
    );
  }

  const createdFiles = dedupeCreatedFiles(runtimeOutput.createdFiles);

  return (
    <div className="space-y-3.5">
      {runtimeOutput.warningSummary ? (
        <InfoCard icon={Radar} title="Warnings" value={String(runtimeOutput.warnings.length)}>
          <p>{runtimeOutput.warningSummary}</p>
        </InfoCard>
      ) : null}

      <InfoCard icon={FileJson} title="Created files" value={String(createdFiles.length)}>
        <InspectorCreatedFileList
          files={createdFiles}
          basePath={basePath}
          emptyLabel="This runtime transcript does not include a successful file creation."
        />
      </InfoCard>

      <InfoCard
        icon={TerminalSquare}
        title="Final response"
        value={
          runtime.status === "stalled" || runtime.status === "cancelled"
            ? runtime.status === "stalled"
              ? "stalled"
              : runtime.status
            : runtimeOutput.stopReason || runtimeOutput.status
        }
      >
        {runtime.status === "stalled" || runtime.status === "cancelled" ? (
          <p className="mb-2 rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
            {runtime.status === "stalled"
              ? "This runtime is quiet or waiting for transcript output. AgentOS will keep watching for the first assistant update."
              : "This runtime was cancelled. The text below is the last captured assistant output, not a verified completion."}
          </p>
        ) : null}
        {runtimeOutput.errorMessage && !isMissingTranscriptCopy(runtimeOutput.errorMessage) ? (
          <p className="mb-2 rounded-[12px] border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[12px] leading-5 text-rose-100">
            {runtimeOutput.errorMessage}
          </p>
        ) : null}
        <InteractiveContent
          text={
            runtimeOutput.finalText ||
            (runtimeOutput.errorMessage && !isMissingTranscriptCopy(runtimeOutput.errorMessage)
              ? runtimeOutput.errorMessage
              : "Waiting for the first assistant output from this runtime.")
          }
          className="text-[13px] leading-5 text-slate-100"
          basePath={basePath}
        />
        {runtimeOutput.finalTimestamp ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {new Date(runtimeOutput.finalTimestamp).toLocaleString()}
          </p>
        ) : null}
      </InfoCard>

      <InfoCard icon={Radar} title="Transcript trail" value={String(runtimeOutput.items.length)}>
        {runtimeOutput.items.length === 0 ? <p>Waiting for the first transcript entry.</p> : null}
        <div className="space-y-2">
          {runtimeOutput.items.map((item) => (
            <div
              key={item.id}
              className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2.5"
            >
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Badge
                    variant={
                      item.role === "assistant"
                        ? item.isError
                          ? "danger"
                          : "default"
                        : item.role === "toolResult"
                          ? "warning"
                          : "muted"
                    }
                  >
                    {item.role}
                  </Badge>
                  {item.toolName ? <Badge variant="muted">{item.toolName}</Badge> : null}
                </div>
                  <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
                    {formatRelativeTime(new Date(item.timestamp).getTime())}
                  </span>
                </div>
                <div className="mt-2">
                  <InteractiveContent text={item.text} className="text-[12.5px] leading-5 text-slate-100" basePath={basePath} />
                </div>
              </div>
            ))}
          </div>
        </InfoCard>
      </div>
  );
}

function ModelContent({
  snapshot,
  modelId
}: {
  snapshot: MissionControlSnapshot;
  modelId: string;
}) {
  const model = snapshot.models.find((entry) => entry.id === modelId);

  if (!model) {
    return null;
  }

  return (
    <>
      <InfoCard icon={Cpu} title="Model routing" value={model.provider}>
        <p>{model.name}</p>
        <p>{model.local ? "Local model" : "Remote model"}</p>
      </InfoCard>
      <InfoCard icon={Radar} title="Capacity" value={`${formatContextWindow(model.contextWindow)} ctx`}>
        <p>{model.input}</p>
        <p>{model.available === false ? "Unavailable" : "Available"}</p>
        <p>{model.usageCount} attached agents</p>
      </InfoCard>
    </>
  );
}

function InspectorRailButton({
  icon: Icon,
  label,
  active,
  surfaceTheme,
  tooltipSide,
  size = "rail",
  disabled = false,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  surfaceTheme: "dark" | "light";
  tooltipSide: "left" | "right" | "bottom";
  size?: "rail" | "header";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <RailTooltip
      label={label}
      side={tooltipSide}
      surfaceTheme={surfaceTheme}
    >
      <button
        type="button"
        aria-label={label}
        aria-pressed={active}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={onClick}
        className={cn(
          "inline-flex items-center justify-center border shadow-[inset_0_1px_0_rgba(255,255,255,0.04)] transition-all",
          size === "header" ? "h-8 w-8 rounded-[9px]" : "h-9 w-9 rounded-[11px]",
          disabled
            ? "border-white/[0.05] bg-white/[0.02] text-slate-600"
            : active
              ? "border-sky-100/[0.2] bg-sky-200/[0.1] text-sky-100 shadow-[0_0_18px_rgba(125,211,252,0.12),inset_0_1px_0_rgba(255,255,255,0.08)]"
              : "border-white/[0.09] bg-white/[0.03] text-slate-500 hover:border-sky-100/[0.14] hover:bg-white/[0.055] hover:text-slate-100"
        )}
      >
        <Icon className="h-3.5 w-3.5" />
      </button>
    </RailTooltip>
  );
}

function InspectorTabButton({
  label,
  active,
  surfaceTone,
  onClick
}: {
  label: string;
  active: boolean;
  surfaceTone: ReturnType<typeof resolveInspectorSurfaceTone>;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "relative z-10 inline-flex min-w-0 items-center justify-center rounded-[7px] border border-transparent px-2 py-1.5 text-[10px] font-medium whitespace-nowrap transition-colors",
        active ? surfaceTone.tabActive : surfaceTone.tabIdle
      )}
    >
      {label}
    </button>
  );
}

function InfoCard({
  icon: Icon,
  title,
  value,
  actions,
  children,
  className
}: {
  icon: LucideIcon;
  title: string;
  value: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section
      className={cn(
        "rounded-[16px] border border-sky-100/[0.08] bg-[linear-gradient(180deg,rgba(8,17,32,0.82),rgba(5,12,25,0.78))] p-3 shadow-[0_12px_34px_rgba(0,0,0,0.2),inset_0_1px_0_rgba(255,255,255,0.04)] transition-all",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 space-y-1">
          <div className="flex min-w-0 items-center gap-2">
            <Icon className="h-3.5 w-3.5 shrink-0 text-sky-200/65" />
            <p className="truncate text-[9px] font-semibold uppercase tracking-[0.24em] text-slate-300/75">{title}</p>
          </div>
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <Badge variant="muted" className="max-w-full truncate rounded-full bg-white/[0.055] px-2 py-0.5 text-[9px] tracking-[0.14em] text-slate-100">
              {value}
            </Badge>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
        </div>
      </div>
      <div className="mt-3 space-y-2.5 text-[12px] leading-5 text-slate-300">{children}</div>
    </section>
  );
}

function TaskTextPanel({
  label,
  text,
  basePath,
  subtle = false
}: {
  label: string;
  text: string;
  basePath?: string | null;
  subtle?: boolean;
}) {
  return (
    <div className="rounded-[14px] border border-sky-100/[0.08] bg-slate-950/[0.25] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]">
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-slate-400">{label}</p>
      <div className="mt-2">
        <InteractiveContent
          text={text}
          className={cn("text-[12.5px] leading-5", subtle ? "text-slate-400" : "text-slate-100")}
          basePath={basePath}
        />
      </div>
    </div>
  );
}

function InspectorCreatedFileList({
  files,
  basePath,
  emptyLabel
}: {
  files: RuntimeCreatedFile[] | null | undefined;
  basePath?: string | null;
  emptyLabel: string;
}) {
  const visibleFiles = dedupeCreatedFiles(files ?? []);

  if (visibleFiles.length === 0) {
    return <p className="text-[12px] text-slate-400">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {visibleFiles.map((file) => {
        const canReveal = isAbsoluteLocalPath(file.path) || Boolean(basePath);

        return (
          <button
            key={file.path}
            type="button"
            disabled={!canReveal}
            onClick={() => void revealLocalFile(file.path, basePath)}
            className={cn(
              "w-full rounded-[14px] border border-sky-100/[0.08] bg-[linear-gradient(180deg,rgba(9,18,34,0.74),rgba(7,14,27,0.66))] px-3 py-2.5 text-left shadow-[inset_0_1px_0_rgba(255,255,255,0.035)] transition-all",
              canReveal
                ? "hover:border-sky-100/[0.16] hover:bg-white/[0.055]"
                : "cursor-not-allowed opacity-60"
            )}
          >
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <p className="truncate font-mono text-[12px] text-sky-100/85">{file.displayPath}</p>
                <p className="truncate text-[11px] text-slate-400">{compactPath(file.path)}</p>
              </div>
              <Badge variant="muted">{canReveal ? "reveal" : "relative"}</Badge>
            </div>
          </button>
        );
      })}
    </div>
  );
}

function InspectorMetricGrid({
  items
}: {
  items: Array<{ label: string; value: string }>;
}) {
  return (
    <div className="grid grid-cols-2 gap-2">
      {items.map((item) => (
        <div
          key={item.label}
          className="rounded-[14px] border border-sky-100/[0.08] bg-[linear-gradient(180deg,rgba(9,18,34,0.7),rgba(6,13,26,0.68))] px-2.5 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
        >
          <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
          <p className="mt-1 truncate font-display text-[0.95rem] leading-none text-white">{item.value}</p>
        </div>
      ))}
    </div>
  );
}

function InspectorPresenceGroup({
  items,
  missingVariant = "muted"
}: {
  items: WorkspaceResourceState[];
  missingVariant?: React.ComponentProps<typeof Badge>["variant"];
}) {
  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item.id} variant={item.present ? "success" : missingVariant}>
          {item.label}
        </Badge>
      ))}
    </div>
  );
}

function InspectorTagGroup({
  items,
  emptyLabel,
  itemVariant,
  emptyVariant
}: {
  items: string[];
  emptyLabel: string;
  itemVariant: React.ComponentProps<typeof Badge>["variant"];
  emptyVariant: React.ComponentProps<typeof Badge>["variant"];
}) {
  if (items.length === 0) {
    return <Badge variant={emptyVariant}>{emptyLabel}</Badge>;
  }

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <Badge key={item} variant={itemVariant}>
          {item}
        </Badge>
      ))}
    </div>
  );
}

function InspectorBulletList({
  items,
  emptyLabel
}: {
  items: string[];
  emptyLabel: string;
}) {
  if (items.length === 0) {
    return <p className="text-[12px] text-slate-400">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {items.map((item) => (
        <div
          key={item}
          className="rounded-[16px] border border-sky-100/[0.08] bg-[linear-gradient(180deg,rgba(9,18,34,0.72),rgba(6,13,26,0.68))] px-3 py-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.035)]"
        >
          <p className="text-[12px] leading-5 text-slate-200">{item}</p>
        </div>
      ))}
    </div>
  );
}

function extractCreatedFilesFromRuntime(runtime: MissionControlSnapshot["runtimes"][number]) {
  const rawCreatedFiles = runtime.metadata.createdFiles;

  if (!Array.isArray(rawCreatedFiles)) {
    return [];
  }

  return rawCreatedFiles.flatMap((entry) => {
    if (!entry || typeof entry !== "object") {
      return [];
    }

    const pathValue = "path" in entry && typeof entry.path === "string" ? entry.path : null;
    const displayPathValue =
      "displayPath" in entry && typeof entry.displayPath === "string" ? entry.displayPath : pathValue;

    if (!pathValue || !displayPathValue) {
      return [];
    }

    return [
      {
        path: pathValue,
        displayPath: displayPathValue
      } satisfies RuntimeCreatedFile
    ];
  });
}

function extractWarningsFromRuntime(runtime: MissionControlSnapshot["runtimes"][number]) {
  const rawWarnings = runtime.metadata.warnings;

  if (!Array.isArray(rawWarnings)) {
    return [];
  }

  return rawWarnings.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0);
}

function dedupeCreatedFiles(files: unknown) {
  const seen = new Set<string>();
  const deduped: RuntimeCreatedFile[] = [];
  const entries = Array.isArray(files) ? files : [];

  for (const file of entries) {
    const pathValue = typeof file?.path === "string" ? file.path.trim() : "";
    const displayPathValue =
      typeof file?.displayPath === "string" && file.displayPath.trim().length > 0
        ? file.displayPath.trim()
        : pathValue;

    if (!pathValue || seen.has(pathValue)) {
      continue;
    }

    seen.add(pathValue);
    deduped.push({
      path: pathValue,
      displayPath: displayPathValue
    });
  }

  return deduped;
}

function taskFeedBadgeVariant(
  kind: TaskDetailRecord["liveFeed"][number]["kind"],
  isError?: boolean
): React.ComponentProps<typeof Badge>["variant"] {
  if (isError) {
    return "danger";
  }

  switch (kind) {
    case "assistant":
      return "default";
    case "tool":
    case "warning":
      return "warning";
    case "artifact":
      return "success";
    default:
      return "muted";
  }
}

function isAbsoluteLocalPath(targetPath: string | null | undefined) {
  if (typeof targetPath !== "string") {
    return false;
  }

  return targetPath.startsWith("/") || /^[A-Za-z]:[\\/]/.test(targetPath);
}

async function revealLocalFile(targetPath: string, basePath?: string | null) {
  try {
    const response = await fetch("/api/files/reveal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: targetPath, basePath: basePath ?? null })
    });
    const payload = (await response.json()) as { error?: string };

    if (!response.ok) {
      throw new Error(payload.error || "Unable to reveal file.");
    }

    toast.success("Revealed file.", {
      description: compactPath(targetPath)
    });
  } catch (error) {
    toast.error("Could not reveal file.", {
      description: error instanceof Error ? error.message : "Unknown file reveal error."
    });
  }
}
