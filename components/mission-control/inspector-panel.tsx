"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";

import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Cpu,
  Eye,
  FileJson,
  FolderGit2,
  Lock,
  MessageSquareText,
  Radar,
  Pencil,
  TerminalSquare
} from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { toast } from "sonner";
import { AgentChatDrawer } from "@/components/mission-control/agent-chat-drawer";
import { InteractiveContent } from "@/components/mission-control/interactive-content";
import { RailTooltip } from "@/components/mission-control/rail-tooltip";
import { Button } from "@/components/ui/button";
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
  TaskDetailStreamEvent,
  TaskRecord,
  WorkspaceResourceState
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";
import type { AgentDetailFocus } from "@/components/mission-control/canvas-types";

type InspectorPanelProps = {
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  selectedNodeId: string | null;
  agentDetailFocus?: AgentDetailFocus | null;
  lastMission: MissionResponse | null;
  onRefresh?: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onConfigureAgentCapabilities?: (agentId: string, focus: "skills" | "tools") => void;
  onAbortTask?: (task: TaskRecord) => void;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  activeTab: "overview" | "chat" | "output" | "files" | "raw";
  onActiveTabChange: (tab: "overview" | "chat" | "output" | "files" | "raw") => void;
};

type InspectorPanelTab = InspectorPanelProps["activeTab"];
type AgentRuntimeRecord = MissionControlSnapshot["runtimes"][number];

const INSPECTOR_BADGE_CLASS_NAME =
  "!h-4 !px-1.5 !py-0 !text-[8px] !leading-none !tracking-[0.1em] !whitespace-nowrap";

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
  agentDetailFocus,
  lastMission,
  onRefresh,
  onSnapshotChange,
  onConfigureAgentCapabilities,
  onAbortTask,
  collapsed,
  onToggleCollapsed,
  activeTab,
  onActiveTabChange
}: InspectorPanelProps) {
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const selectedWorkspace = snapshot.workspaces.find((workspace) => workspace.id === selectedNodeId);
  const selectedAgent = snapshot.agents.find((agent) => agent.id === selectedNodeId);
  const selectedTask = snapshot.tasks.find((task) => task.id === selectedNodeId);
  const selectedRuntime = snapshot.runtimes.find((runtime) => runtime.id === selectedNodeId);
  const selectedModel = snapshot.models.find((model) => model.id === selectedNodeId);
  const isOptimisticTask = Boolean(selectedTask?.metadata.optimistic);
  const selectedEntity =
    selectedWorkspace || selectedAgent || selectedTask || selectedRuntime || selectedModel || null;
  const selectedRuntimeId = selectedRuntime?.id ?? null;
  const selectedTaskId = selectedTask?.id ?? null;
  const [runtimeOutput, setRuntimeOutput] = useState<RuntimeOutputRecord | null>(null);
  const [runtimeOutputError, setRuntimeOutputError] = useState<{
    runtimeId: string;
    message: string;
  } | null>(null);
  const [taskDetail, setTaskDetail] = useState<TaskDetailRecord | null>(null);
  const [taskDetailError, setTaskDetailError] = useState<{
    taskId: string;
    message: string;
  } | null>(null);
  const optimisticTaskDetail = useMemo(
    () => (isOptimisticTask && selectedTask ? createOptimisticTaskDetail(selectedTask) : null),
    [isOptimisticTask, selectedTask]
  );
  const resolvedRuntimeOutput =
    runtimeOutput && runtimeOutput.runtimeId === selectedRuntimeId ? runtimeOutput : null;
  const resolvedRuntimeOutputError =
    runtimeOutputError?.runtimeId === selectedRuntimeId ? runtimeOutputError.message : null;
  const resolvedTaskDetail =
    taskDetail && taskDetail.task.id === selectedTaskId ? taskDetail : null;
  const resolvedTaskDetailError =
    taskDetailError?.taskId === selectedTaskId ? taskDetailError.message : null;
  const effectiveTaskDetail = optimisticTaskDetail ?? resolvedTaskDetail;
  const taskDetailLoading =
    Boolean(selectedTaskId) && !isOptimisticTask && !effectiveTaskDetail && !resolvedTaskDetailError;
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
        : activeTab;
  const isChatView = visibleActiveTab === "chat" && Boolean(selectedAgent);
  const outputTabLabel = selectedTask ? "Feed" : "Output";
  const selectedLabel =
    selectedWorkspace?.name ||
    (selectedAgent ? formatAgentDisplayName(selectedAgent) : null) ||
    (selectedTask ? compactMissionText(selectedTask.title || selectedTask.mission || "Task", 48) || "Task" : null) ||
    (selectedRuntime ? compactMissionText(selectedRuntime.title || "Run", 48) || "Run" : null) ||
    selectedModel?.name ||
    "Gateway overview";
  const selectedDetail = selectedWorkspace
    ? "workspace"
    : selectedAgent
      ? "agent"
      : selectedTask
        ? "task"
      : selectedRuntime
        ? "run"
        : selectedModel
          ? "model"
          : "selection";
  const navItems = useMemo(
    () =>
      [
        { id: "overview", label: "Overview", icon: Eye, enabled: true },
        { id: "chat", label: "Chat", icon: MessageSquareText, enabled: showChatTab },
        { id: "output", label: outputTabLabel, icon: TerminalSquare, enabled: showOutputTab },
        { id: "files", label: "Files", icon: FolderGit2, enabled: showFilesTab },
        { id: "raw", label: "Raw", icon: FileJson, enabled: true }
      ] satisfies Array<{ id: InspectorPanelTab; label: string; icon: LucideIcon; enabled: boolean }>,
    [outputTabLabel, showChatTab, showFilesTab, showOutputTab]
  );

  useEffect(() => {
    if (!selectedRuntimeId) {
      return;
    }

    const controller = new AbortController();

    fetch(`/api/runtimes/${encodeURIComponent(selectedRuntimeId)}`, { signal: controller.signal })
      .then(async (response) => {
        const payload = (await response.json()) as RuntimeOutputRecord & { error?: string };

        if (!response.ok) {
          throw new Error(payload.error || "Unable to load runtime output.");
        }

        setRuntimeOutput(payload);
        setRuntimeOutputError(null);
      })
      .catch((error) => {
        if (controller.signal.aborted) {
          return;
        }

        setRuntimeOutput(null);
        setRuntimeOutputError({
          runtimeId: selectedRuntimeId,
          message: error instanceof Error ? error.message : "Unable to load runtime output."
        });
      });

    return () => controller.abort();
  }, [selectedRuntimeId]);

  useEffect(() => {
    if (!selectedTaskId || isOptimisticTask) {
      return;
    }

    const source = new EventSource(`/api/tasks/${encodeURIComponent(selectedTaskId)}/stream`);

    const handleTask = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as TaskDetailStreamEvent;

        if (payload.type !== "task") {
          return;
        }

        setTaskDetail(payload.detail);
        setTaskDetailError(null);
      } catch (error) {
        setTaskDetailError({
          taskId: selectedTaskId,
          message: error instanceof Error ? error.message : "Unable to parse task feed."
        });
      }
    };

    const handleTaskError = (event: MessageEvent<string>) => {
      try {
        const payload = JSON.parse(event.data) as TaskDetailStreamEvent;

        if (payload.type === "error") {
          setTaskDetailError({
            taskId: selectedTaskId,
            message: payload.error
          });
        }
      } catch {
        setTaskDetailError({
          taskId: selectedTaskId,
          message: "Unable to load task detail."
        });
      }
    };

    source.addEventListener("task", handleTask as EventListener);
    source.addEventListener("task-error", handleTaskError as EventListener);
    source.onerror = () => {
      setTaskDetailError((current) =>
        current?.taskId === selectedTaskId
          ? current
          : {
              taskId: selectedTaskId,
              message: "Task feed disconnected. Reconnecting…"
            }
      );
    };

    return () => {
      source.removeEventListener("task", handleTask as EventListener);
      source.removeEventListener("task-error", handleTaskError as EventListener);
      source.close();
    };
  }, [selectedTaskId, isOptimisticTask]);

  return (
    <div className="panel-surface panel-glow flex h-full flex-row-reverse overflow-hidden rounded-none border border-r-0 border-white/[0.08] bg-[#04070e]/88 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
      <div
        className={cn(
          "flex h-full shrink-0 flex-col items-center bg-[linear-gradient(180deg,rgba(7,10,18,0.98),rgba(3,6,12,0.98))] px-1.5 py-2",
          collapsed ? "w-full" : "w-[60px] border-l border-white/[0.08]"
        )}
      >
        <RailTooltip
          label="Inspector"
          side="left"
          surfaceTheme={surfaceTheme}
          panelCollapsed={collapsed}
        >
          <button
            type="button"
            aria-label={collapsed ? "Expand inspector" : "Collapse inspector"}
            onClick={onToggleCollapsed}
            className="flex h-9 w-9 items-center justify-center rounded-[8px] border border-cyan-300/18 bg-cyan-400/[0.1] shadow-[0_8px_18px_rgba(34,211,238,0.14)] transition-all hover:border-cyan-200/24 hover:bg-cyan-400/[0.14]"
          >
            <TerminalSquare className="h-3.5 w-3.5 text-cyan-200" />
          </button>
        </RailTooltip>

        <div className="mt-3.5 flex flex-1 flex-col items-center gap-1">
          {navItems.map((item) => (
            <InspectorRailButton
              key={item.id}
              icon={item.icon}
              label={item.label}
              active={visibleActiveTab === item.id}
              surfaceTheme={surfaceTheme}
              panelCollapsed={collapsed}
              tooltipSide="left"
              disabled={!item.enabled}
              onClick={() => {
                if (!item.enabled) {
                  return;
                }

                onActiveTabChange(item.id);

                if (collapsed) {
                  onToggleCollapsed();
                }
              }}
            />
          ))}
        </div>

        <div className="mt-1.5 flex flex-col items-center gap-0.5">
          <Badge
            variant="muted"
            className="h-4 min-w-[28px] rounded-full px-1 py-0 text-[8px] leading-none tracking-[0.12em]"
          >
            {selectedEntity ? "live" : "idle"}
          </Badge>
          {collapsed ? (
            <p className="max-w-[44px] truncate text-center text-[8px] uppercase tracking-[0.14em] text-slate-500">
              {selectedDetail}
            </p>
          ) : null}
        </div>
      </div>

      {!collapsed ? (
        <div className="min-w-0 flex-1 bg-[linear-gradient(180deg,rgba(6,10,18,0.96),rgba(3,6,14,0.98))]">
          <div
            className={cn(
              "mission-scroll flex h-full min-h-0 flex-col overscroll-contain",
              isChatView ? "overflow-hidden" : "overflow-y-auto"
            )}
          >
            <div className="shrink-0 border-b border-white/[0.08] px-3 pb-2 pt-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="text-[9px] font-medium uppercase tracking-[0.24em] text-slate-500">Inspector</p>
                  <div className="mt-1 flex min-w-0 items-center gap-1.5">
                    <h2 className="min-w-0 truncate font-display text-[1.02rem] leading-5 text-white">
                      {selectedLabel}
                    </h2>
                    <Badge
                      variant="muted"
                      className="shrink-0 h-4 px-1.5 py-0 text-[8px] leading-none tracking-[0.1em]"
                    >
                      {selectedDetail}
                    </Badge>
                  </div>
                  <p className="mt-1 truncate text-[11px] leading-4 text-slate-400">
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
                </div>

                <div className="hidden h-8 w-8 shrink-0 items-center justify-center rounded-none border border-white/10 bg-white/[0.04] text-cyan-200 sm:flex">
                  <TerminalSquare className="h-3.5 w-3.5" />
                </div>
              </div>

              <div className="mt-2 flex flex-nowrap gap-1 overflow-x-auto pb-0.5">
                {navItems
                  .filter((item) => item.enabled)
                  .map((item) => (
                    <InspectorTabButton
                      key={item.id}
                      label={item.label}
                      active={visibleActiveTab === item.id}
                      onClick={() => onActiveTabChange(item.id)}
                    />
                  ))}
              </div>
            </div>

            <div className={cn("flex-1 p-3", isChatView && "min-h-0 overflow-hidden")}>
              <AnimatePresence mode="wait">
                <motion.div
                  key={`${selectedNodeId || "overview"}:${visibleActiveTab}`}
                  initial={{ opacity: 0, y: 8 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: -8 }}
                  className={cn("space-y-3.5", isChatView && "flex h-full min-h-0 flex-col space-y-0")}
                >
                  {visibleActiveTab === "overview" ? (
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
                          onAbortTask={onAbortTask}
                        />
                      ) : null}
                      {selectedRuntime ? (
                        <RuntimeContent
                          snapshot={snapshot}
                          runtimeId={selectedRuntime.id}
                          runtimeOutput={resolvedRuntimeOutput}
                          runtimeOutputLoading={runtimeOutputLoading}
                          runtimeOutputError={resolvedRuntimeOutputError}
                        />
                      ) : null}
                      {selectedModel ? <ModelContent snapshot={snapshot} modelId={selectedModel.id} /> : null}
                      {!selectedEntity ? <GatewayOverview snapshot={snapshot} lastMission={lastMission} /> : null}
                    </>
                  ) : null}

                  {isChatView && selectedAgent ? (
                    <AgentChatDrawer
                      agent={selectedAgent}
                      snapshot={snapshot}
                      surfaceTheme={surfaceTheme}
                      onRefresh={onRefresh}
                      onSnapshotChange={onSnapshotChange}
                    />
                  ) : null}

                  {visibleActiveTab === "output" && selectedTask ? (
                    <TaskFeedContent
                      task={selectedTask}
                      taskDetail={effectiveTaskDetail}
                      taskDetailLoading={taskDetailLoading}
                      taskDetailError={resolvedTaskDetailError}
                    />
                  ) : null}

                  {visibleActiveTab === "output" && selectedRuntime ? (
                    <RuntimeOutputContent
                      runtime={selectedRuntime}
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
                    <pre className="overflow-x-auto rounded-[18px] border border-white/[0.08] bg-slate-950/[0.72] p-3 text-[11px] leading-5 text-slate-300">
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
              <div className="shrink-0 border-t border-white/[0.08] p-3">
                <div className="rounded-[22px] border border-cyan-300/10 bg-[linear-gradient(180deg,rgba(7,22,31,0.95),rgba(5,13,22,0.95))] p-3.5 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-400/[0.12] text-cyan-200">
                      <Radar className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-display text-[15px] text-white">
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
                      <p className="mt-1 text-[12px] text-slate-400">
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
                "border-cyan-300/25 bg-cyan-400/[0.05] shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
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
                "border-cyan-300/25 bg-cyan-400/[0.05] shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
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
        <div className="flex flex-wrap gap-2">
          <Badge variant={agent.heartbeat.enabled ? "success" : "muted"}>
            {agent.heartbeat.enabled ? "heartbeat on" : "heartbeat off"}
          </Badge>
          {typeof agent.heartbeat.everyMs === "number" ? (
            <Badge variant="muted">{Math.round(agent.heartbeat.everyMs / 1000)}s interval</Badge>
          ) : null}
        </div>
      </InfoCard>

      <div ref={sessionsSectionRef} className="scroll-mt-4">
        <InfoCard
          icon={TerminalSquare}
          title="Activity history"
          value={String(activeRuntimes.length)}
          className={cn(
            focusSection === "sessions" &&
              "border-cyan-300/25 bg-[linear-gradient(180deg,rgba(12,25,37,0.92),rgba(8,13,24,0.88))] shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
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
                      isExpanded ? "border-cyan-300/22 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]" : "border-white/[0.08]"
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
  onAbortTask
}: {
  snapshot: MissionControlSnapshot;
  task: MissionControlSnapshot["tasks"][number];
  taskId: string;
  taskDetail: TaskDetailRecord | null;
  taskDetailLoading: boolean;
  taskDetailError: string | null;
  onAbortTask?: (task: MissionControlSnapshot["tasks"][number]) => void;
}) {
  const selectedTask = snapshot.tasks.find((entry) => entry.id === taskId) ?? task;
  const isAborted = isTaskAborted(selectedTask);
  const canAbortTask = Boolean(onAbortTask) && isTaskAbortable(selectedTask);
  const workspace = snapshot.workspaces.find((entry) => entry.id === task?.workspaceId);
  const primaryAgent = snapshot.agents.find((entry) => entry.id === task?.primaryAgentId);
  const runs =
    taskDetail?.runs ??
    snapshot.runtimes
      .filter((runtime) => task?.runtimeIds.includes(runtime.id))
      .sort((left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0));
  const createdFiles =
    taskDetail?.createdFiles ??
    dedupeCreatedFiles(runs.flatMap((runtime) => extractCreatedFilesFromRuntime(runtime)));
  const warnings = taskDetail?.warnings ?? [];

  if (!task) {
    return null;
  }

  const integrity = taskDetail?.integrity ?? createOptimisticTaskIntegrity(task);

  return (
    <>
      <InfoCard icon={FolderGit2} title="Mission" value={isAborted ? "aborted" : selectedTask.status}>
        <p className="line-clamp-1 text-sm text-white">
          {compactMissionText(selectedTask.mission || selectedTask.title, 80) || selectedTask.title}
        </p>
        <p className="line-clamp-1 text-[12.5px] leading-5 text-slate-400">
          {compactMissionText(selectedTask.subtitle, 110) || selectedTask.subtitle}
        </p>
        <InspectorMetricGrid
          items={[
            { label: "Runs", value: String(selectedTask.runtimeCount) },
            { label: "Feed", value: String(selectedTask.updateCount) },
            { label: "Files", value: String(selectedTask.artifactCount) },
            { label: "Live", value: String(selectedTask.liveRunCount) }
          ]}
        />
        {onAbortTask && (canAbortTask || isAborted) ? (
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant={isAborted ? "secondary" : "destructive"}
              size="sm"
              disabled={!canAbortTask}
              className="gap-2"
              onClick={() => {
                if (!canAbortTask) {
                  return;
                }

                onAbortTask(selectedTask);
              }}
            >
              <AlertTriangle className="h-3.5 w-3.5" />
              {isAborted ? "Aborted" : "Abort task"}
            </Button>
          </div>
        ) : null}
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
      </InfoCard>

      <TaskIntegrityCard task={selectedTask} integrity={integrity} />

      <InfoCard icon={TerminalSquare} title="Runs" value={String(runs.length)}>
        {runs.length === 0 ? <p>No OpenClaw runs have been grouped into this task yet.</p> : null}
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
  integrity
}: {
  task: MissionControlSnapshot["tasks"][number];
  integrity: TaskDetailRecord["integrity"];
}) {
  const isAborted = isTaskAborted(task);
  const partialFinalResponseIssue = integrity.issues.find((issue) => issue.id === "partial-final-response");
  const summary =
    isAborted
      ? "This task was aborted by an operator. Captured evidence may be incomplete."
      : integrity.status === "verified"
      ? "Mission Control found a matching transcript and the captured result looks internally consistent."
      : integrity.sessionMismatch
        ? "The linked transcript belongs to a different mission or stale session, so this completion cannot be trusted yet."
        : integrity.issues.some((issue) => issue.id === "empty-output-dir")
          ? "The task is marked completed, but the expected deliverables are missing from the output folder."
      : integrity.status === "error"
        ? "The captured evidence does not line up with the requested mission."
        : "Mission Control recovered partial evidence, but this result still needs operator review.";

  return (
    <InfoCard
      icon={Radar}
      title="Result integrity"
      value={isAborted ? "aborted" : task.status === "stalled" ? "stalled" : integrity.status}
    >
      <p>{summary}</p>
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

function TaskFeedContent({
  task,
  taskDetail,
  taskDetailLoading,
  taskDetailError
}: {
  task: MissionControlSnapshot["tasks"][number];
  taskDetail: TaskDetailRecord | null;
  taskDetailLoading: boolean;
  taskDetailError: string | null;
}) {
  if (taskDetailLoading && !taskDetail) {
    return (
      <InfoCard icon={TerminalSquare} title="Live feed" value="connecting">
        <p>Connecting to the task feed…</p>
      </InfoCard>
    );
  }

  if (taskDetailError && !taskDetail) {
    return (
      <InfoCard icon={TerminalSquare} title="Live feed" value="error">
        <p>{taskDetailError}</p>
      </InfoCard>
    );
  }

  const liveFeed = taskDetail?.liveFeed ?? [];
  const integrity = taskDetail?.integrity ?? createOptimisticTaskIntegrity(task);

  return (
    <InfoCard icon={TerminalSquare} title="Live feed" value={String(liveFeed.length)}>
      {taskDetailError ? (
        <p className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
          {taskDetailError}
        </p>
      ) : null}
      {integrity.issues.length > 0 ? (
        <p className="rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
          {integrity.issues[0]?.detail}
        </p>
      ) : null}
      {liveFeed.length === 0 ? <p>No streamed task events have arrived yet.</p> : null}
      <div className="space-y-2">
        {liveFeed.map((event) => (
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
              />
            </div>
          </div>
        ))}
      </div>
    </InfoCard>
  );
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
    taskDetail?.createdFiles ??
    dedupeCreatedFiles(runs.flatMap((runtime) => extractCreatedFilesFromRuntime(runtime)));
  const integrity = taskDetail?.integrity ?? createOptimisticTaskIntegrity(task);

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
    warnings: task.status === "stalled" || isTaskAborted(task) ? [task.subtitle] : [],
    integrity: createOptimisticTaskIntegrity(task)
  };
}

function createOptimisticTaskIntegrity(
  task: MissionControlSnapshot["tasks"][number]
): TaskDetailRecord["integrity"] {
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
            id: "stalled-dispatch",
            severity: "warning" as const,
            title: "Dispatch stalled before evidence was captured",
            detail: task.subtitle
          }
        ]
      : task.metadata.optimistic
        ? [
            {
              id: "pending-evidence",
              severity: "warning" as const,
              title: "Waiting for runtime evidence",
              detail: "Mission Control will attach transcript, tool, and file evidence after the first runtime is observed."
            }
          ]
        : [];

  return {
    status:
      issues.some((issue) => issue.severity === "error")
        ? "error"
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
    finalResponseText: null,
    finalResponseSource: "none",
    dispatchSessionId: null,
    sessionMismatch: false,
    toolNames: [],
    emails: [],
    issues
  };
}

function readOptimisticTaskFeed(task: MissionControlSnapshot["tasks"][number]) {
  const value = task.metadata.optimisticEvents;

  if (!Array.isArray(value)) {
    return [] as TaskFeedEvent[];
  }

  return value
    .filter(isTaskFeedEvent)
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
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

function RuntimeContent({
  snapshot,
  runtimeId,
  runtimeOutput,
  runtimeOutputLoading,
  runtimeOutputError
}: {
  snapshot: MissionControlSnapshot;
  runtimeId: string;
  runtimeOutput: RuntimeOutputRecord | null;
  runtimeOutputLoading: boolean;
  runtimeOutputError: string | null;
}) {
  const relativeTimeReferenceMs = resolveRelativeTimeReferenceMs(snapshot.generatedAt);
  const runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);
  const createdFiles = dedupeCreatedFiles(runtimeOutput?.createdFiles ?? (runtime ? extractCreatedFilesFromRuntime(runtime) : []));
  const runtimeWarnings = runtimeOutput?.warnings ?? (runtime ? extractWarningsFromRuntime(runtime) : []);
  const runtimeWarningSummary = runtimeOutput?.warningSummary ?? runtimeWarnings[0] ?? null;

  if (!runtime) {
    return null;
  }

  return (
    <>
      <InfoCard icon={TerminalSquare} title="Runtime key" value={runtime.status}>
        <p className="font-mono text-xs text-slate-400">{runtime.key}</p>
        <p>Session {shortId(runtime.sessionId, 12)}</p>
        {runtime.taskId ? <p>Task {shortId(runtime.taskId, 12)}</p> : null}
        {runtime.runId ? <p>Run {shortId(runtime.runId, 12)}</p> : null}
      </InfoCard>
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
  runtimeOutput,
  runtimeOutputLoading,
  runtimeOutputError
}: {
  runtime: MissionControlSnapshot["runtimes"][number];
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

  return (
    <div className="space-y-3.5">
      {runtimeOutput.warningSummary ? (
        <InfoCard icon={Radar} title="Warnings" value={String(runtimeOutput.warnings.length)}>
          <p>{runtimeOutput.warningSummary}</p>
        </InfoCard>
      ) : null}

      <InfoCard icon={FileJson} title="Created files" value={String(runtimeOutput.createdFiles.length)}>
        <InspectorCreatedFileList
          files={runtimeOutput.createdFiles}
          emptyLabel="This runtime transcript does not include a successful file creation."
        />
      </InfoCard>

      <InfoCard
        icon={TerminalSquare}
        title="Final response"
        value={
          runtime.status === "stalled" || runtime.status === "cancelled"
            ? runtime.status
            : runtimeOutput.stopReason || runtimeOutput.status
        }
      >
        {runtime.status === "stalled" || runtime.status === "cancelled" ? (
          <p className="mb-2 rounded-[12px] border border-amber-400/20 bg-amber-400/10 px-3 py-2 text-[12px] leading-5 text-amber-100">
            This runtime did not complete cleanly. The text below is the last captured assistant output, not a verified completion.
          </p>
        ) : null}
        {runtimeOutput.errorMessage ? (
          <p className="mb-2 rounded-[12px] border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-[12px] leading-5 text-rose-100">
            {runtimeOutput.errorMessage}
          </p>
        ) : null}
        <InteractiveContent
          text={runtimeOutput.finalText || runtimeOutput.errorMessage || "No assistant output has been recorded for this runtime yet."}
          className="text-[13px] leading-5 text-slate-100"
        />
        {runtimeOutput.finalTimestamp ? (
          <p className="text-[11px] uppercase tracking-[0.18em] text-slate-500">
            {new Date(runtimeOutput.finalTimestamp).toLocaleString()}
          </p>
        ) : null}
      </InfoCard>

      <InfoCard icon={Radar} title="Transcript trail" value={String(runtimeOutput.items.length)}>
        {runtimeOutput.items.length === 0 ? <p>No transcript entries were found.</p> : null}
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
                  <InteractiveContent text={item.text} className="text-[12.5px] leading-5 text-slate-100" />
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
  panelCollapsed,
  tooltipSide,
  disabled = false,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  surfaceTheme: "dark" | "light";
  panelCollapsed: boolean;
  tooltipSide: "left" | "right";
  disabled?: boolean;
  onClick: () => void;
}) {
  return (
    <RailTooltip
      label={label}
      side={tooltipSide}
      surfaceTheme={surfaceTheme}
      panelCollapsed={panelCollapsed}
    >
      <button
        type="button"
        aria-label={label}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onClick={onClick}
        className={cn(
          "inline-flex h-8 w-8 items-center justify-center rounded-[8px] border transition-all",
          disabled
            ? "border-white/5 bg-white/[0.02] text-slate-600"
            : active
              ? "border-cyan-300/18 bg-cyan-400 text-slate-950 shadow-[0_10px_22px_rgba(96,165,250,0.28)]"
              : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/15 hover:bg-white/[0.08] hover:text-white"
        )}
      >
        <Icon className="h-3 w-3" />
      </button>
    </RailTooltip>
  );
}

function InspectorTabButton({
  label,
  active,
  onClick
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center rounded-full border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.14em] whitespace-nowrap transition-all",
        active
          ? "border-cyan-300/20 bg-cyan-400 text-slate-950 shadow-[0_10px_24px_rgba(96,165,250,0.28)]"
          : "border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07] hover:text-white"
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
        "rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(12,19,34,0.86),rgba(8,13,24,0.82))] p-3 transition-all",
        className
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">{title}</p>
          <div className="flex min-w-0 items-center gap-2">
            <p className="min-w-0 font-display text-[1rem] text-white">{value}</p>
            {actions ? <div className="shrink-0">{actions}</div> : null}
          </div>
        </div>
        <div className="rounded-[14px] border border-white/[0.08] bg-white/5 p-2 text-slate-300">
          <Icon className="h-3.5 w-3.5" />
        </div>
      </div>
      <div className="mt-3 space-y-1.5 text-[12.5px] leading-5 text-slate-300">{children}</div>
    </section>
  );
}

function InspectorCreatedFileList({
  files,
  emptyLabel
}: {
  files: RuntimeCreatedFile[];
  emptyLabel: string;
}) {
  if (files.length === 0) {
    return <p className="text-[12px] text-slate-400">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-2">
      {files.map((file) => (
        <button
          key={file.path}
          type="button"
          onClick={() => void revealLocalFile(file.path)}
          className="w-full rounded-[14px] border border-cyan-300/12 bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2 text-left transition-all hover:border-cyan-300/28 hover:bg-cyan-400/[0.08]"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-[12px] text-cyan-100">{file.displayPath}</p>
              <p className="truncate text-[11px] text-slate-400">{compactPath(file.path)}</p>
            </div>
            <Badge variant="muted">reveal</Badge>
          </div>
        </button>
      ))}
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
          className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
        >
          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">{item.label}</p>
          <p className="mt-1 text-[13px] text-white">{item.value}</p>
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
          className="rounded-[14px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] px-3 py-2"
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

function dedupeCreatedFiles(files: RuntimeCreatedFile[]) {
  const seen = new Set<string>();
  const deduped: RuntimeCreatedFile[] = [];

  for (const file of files) {
    if (!file.path || seen.has(file.path)) {
      continue;
    }

    seen.add(file.path);
    deduped.push(file);
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

async function revealLocalFile(targetPath: string) {
  try {
    const response = await fetch("/api/files/reveal", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ path: targetPath })
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
