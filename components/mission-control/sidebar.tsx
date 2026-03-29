"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import type { LucideIcon } from "lucide-react";
import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import { ProviderLogo } from "@/components/mission-control/provider-logo";
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronUp,
  Cpu,
  FolderKanban,
  Home,
  LoaderCircle,
  MoreHorizontal,
  RefreshCw,
  Workflow
} from "lucide-react";

import { StatusDot } from "@/components/mission-control/status-dot";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import {
  AGENT_FILE_ACCESS_OPTIONS,
  AGENT_INSTALL_SCOPE_OPTIONS,
  AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS,
  AGENT_NETWORK_ACCESS_OPTIONS,
  AGENT_PRESET_OPTIONS,
  formatAgentFileAccessLabel,
  formatAgentInstallScopeLabel,
  formatAgentMissingToolBehaviorLabel,
  formatAgentNetworkAccessLabel,
  formatAgentPresetLabel,
  getAgentPresetMeta,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import {
  AGENT_HEARTBEAT_INTERVAL_OPTIONS,
  applyPresetHeartbeat,
  defaultHeartbeatForPreset,
  resolveHeartbeatDraft,
  type AgentHeartbeatDraft
} from "@/lib/openclaw/agent-heartbeat";
import {
  getWorkspaceChannelIdsForAgent,
  syncWorkspaceAgentChannelBindings
} from "@/lib/openclaw/channel-bindings";
import { compactPath, formatContextWindow, formatModelLabel, toneForHealth } from "@/lib/openclaw/presenters";
import type { AgentPolicy, AgentPreset, DiscoveredModelCandidate, MissionControlSnapshot } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type AgentDraft = {
  id: string;
  workspaceId: string;
  modelId: string;
  name: string;
  emoji: string;
  theme: string;
  avatar: string;
  policy: AgentPolicy;
  heartbeat: AgentHeartbeatDraft;
  channelIds: string[];
};

type SidebarSectionId = "overview" | "workspaces" | "agents" | "models";

export function MissionSidebar({
  snapshot,
  activeWorkspaceId,
  requestedAgentAction,
  connectionState,
  collapsed: isPanelCollapsed,
  modelManager,
  onToggleCollapsed,
  onSelectWorkspace,
  onRefresh,
  onRunModelRefresh,
  onRunModelDiscover,
  onRunModelSetDefault,
  onConnectModelProvider,
  onOpenModelSetup,
  onOpenAddModels,
  onEditWorkspace,
  onSnapshotChange
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  requestedAgentAction?: {
    requestId: string;
    kind: "edit" | "delete";
    agentId: string;
  } | null;
  connectionState: "connecting" | "live" | "retrying";
  collapsed: boolean;
  modelManager: {
    runState: "idle" | "running" | "success" | "error";
    statusMessage: string | null;
    resultMessage: string | null;
    log: string;
    manualCommand: string | null;
    docsUrl: string | null;
    discoveredModels: DiscoveredModelCandidate[];
    systemReady: boolean;
  };
  onToggleCollapsed: () => void;
  onSelectWorkspace: (workspaceId: string | null) => void;
  onRefresh: () => Promise<void>;
  onRunModelRefresh: () => void;
  onRunModelDiscover: () => void;
  onRunModelSetDefault: (modelId?: string) => void;
  onConnectModelProvider: (provider: string) => void;
  onOpenModelSetup: () => void;
  onOpenAddModels: () => void;
  onEditWorkspace: (workspaceId: string) => void;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
}) {
  const [isRailCollapsed, setIsRailCollapsed] = useState(false);
  const healthTone = toneForHealth(snapshot.diagnostics.health);
  const statusDot =
    snapshot.diagnostics.health === "healthy"
      ? "bg-emerald-300"
      : snapshot.diagnostics.health === "degraded"
        ? "bg-amber-200"
        : "bg-rose-300";
  const gatewayAddress = snapshot.diagnostics.gatewayUrl
    .replace(/^wss?:\/\//, "")
    .replace(/\/$/, "");
  const [isEditAgentOpen, setIsEditAgentOpen] = useState(false);
  const [isEditAgentAdvancedOpen, setIsEditAgentAdvancedOpen] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [isDeleteWorkspaceOpen, setIsDeleteWorkspaceOpen] = useState(false);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [isDeleteAgentOpen, setIsDeleteAgentOpen] = useState(false);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const [editDraft, setEditDraft] = useState<AgentDraft | null>(null);
  const [editChannelIdsBaseline, setEditChannelIdsBaseline] = useState<string[]>([]);
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = useState<MissionControlSnapshot["workspaces"][number] | null>(null);
  const [workspaceDeleteConfirmText, setWorkspaceDeleteConfirmText] = useState("");
  const [agentDeleteTarget, setAgentDeleteTarget] = useState<MissionControlSnapshot["agents"][number] | null>(null);
  const [agentDeleteConfirmText, setAgentDeleteConfirmText] = useState("");
  const [activeSection, setActiveSection] = useState<SidebarSectionId>("workspaces");
  const [modelSelectionDraft, setModelSelectionDraft] = useState("");
  const handledRequestedAgentActionIdRef = useRef<string | null>(null);

  const visibleAgents = useMemo(
    () =>
      snapshot.agents
        .filter((agent) => (activeWorkspaceId ? agent.workspaceId === activeWorkspaceId : true))
        .sort((left, right) => {
          if (left.workspaceId !== right.workspaceId) {
            return left.workspaceId.localeCompare(right.workspaceId);
          }

          return left.name.localeCompare(right.name);
        }),
    [snapshot.agents, activeWorkspaceId]
  );
  const activeWorkspace =
    snapshot.workspaces.find((workspace) => workspace.id === activeWorkspaceId) ?? snapshot.workspaces[0] ?? null;
  const availableModels = useMemo(
    () => snapshot.models.filter((model) => model.available !== false && !model.missing),
    [snapshot.models]
  );
  const discoveredModels = useMemo(
    () =>
      modelManager.discoveredModels.filter(
        (model) => !snapshot.models.some((availableModel) => availableModel.id === model.modelId)
      ),
    [modelManager.discoveredModels, snapshot.models]
  );
  const selectedModelId =
    modelSelectionDraft &&
    (availableModels.some((model) => model.id === modelSelectionDraft) ||
      discoveredModels.some((model) => model.modelId === modelSelectionDraft))
      ? modelSelectionDraft
      : resolveSidebarModelSelection(snapshot);
  const showEditAgentHeartbeatControls = editDraft
    ? isEditAgentAdvancedOpen || editDraft.policy.preset === "monitoring"
    : false;
  const openPanelFromRail = () => {
    if (isRailCollapsed) {
      setIsRailCollapsed(false);
    }

    if (isPanelCollapsed) {
      onToggleCollapsed();
    }
  };
  const togglePanelFromRail = () => {
    if (isPanelCollapsed) {
      openPanelFromRail();
      return;
    }

    onToggleCollapsed();
  };
  const navItems: Array<{
    id: SidebarSectionId;
    label: string;
    icon: LucideIcon;
    badge?: string;
  }> = [
    {
      id: "overview",
      label: "Overview",
      icon: Home
    },
    {
      id: "workspaces",
      label: "Workspaces",
      icon: FolderKanban,
      badge: String(snapshot.workspaces.length)
    },
    {
      id: "agents",
      label: "Agents",
      icon: Bot,
      badge: String(visibleAgents.length)
    },
    {
      id: "models",
      label: "Models",
      icon: Cpu,
      badge: String(snapshot.models.length)
    }
  ];

  const workspaceDeleteAgents = useMemo(() => {
    if (!workspaceDeleteTarget) {
      return [];
    }

    return snapshot.agents.filter((agent) => agent.workspaceId === workspaceDeleteTarget.id);
  }, [workspaceDeleteTarget, snapshot.agents]);

  const workspaceDeleteLiveAgents = useMemo(
    () =>
      workspaceDeleteAgents.filter(
        (agent) => agent.status === "engaged" || agent.status === "monitoring" || agent.status === "ready"
      ),
    [workspaceDeleteAgents]
  );

  const workspaceDeleteRuntimes = useMemo(() => {
    if (!workspaceDeleteTarget) {
      return [];
    }

    return snapshot.runtimes.filter((runtime) => runtime.workspaceId === workspaceDeleteTarget.id);
  }, [workspaceDeleteTarget, snapshot.runtimes]);
  const agentDeleteRuntimes = useMemo(() => {
    if (!agentDeleteTarget) {
      return [];
    }

    return snapshot.runtimes.filter((runtime) => runtime.agentId === agentDeleteTarget.id);
  }, [agentDeleteTarget, snapshot.runtimes]);
  const agentDeleteWorkspace = agentDeleteTarget
    ? snapshot.workspaces.find((workspace) => workspace.id === agentDeleteTarget.workspaceId) ?? null
    : null;
  const agentDeleteIsLive = agentDeleteTarget
    ? agentDeleteTarget.status === "engaged" ||
      agentDeleteTarget.status === "monitoring" ||
      agentDeleteTarget.status === "ready"
    : false;

  const openDeleteWorkspace = (workspace: MissionControlSnapshot["workspaces"][number]) => {
    setWorkspaceDeleteTarget(workspace);
    setWorkspaceDeleteConfirmText("");
    setIsDeleteWorkspaceOpen(true);
  };

  const openDeleteAgent = useCallback((agent: MissionControlSnapshot["agents"][number]) => {
    setAgentDeleteTarget(agent);
    setAgentDeleteConfirmText("");
    setIsDeleteAgentOpen(true);
  }, []);

  const handleEditAgentOpenChange = (nextOpen: boolean) => {
    setIsEditAgentOpen(nextOpen);

    if (!nextOpen) {
      setEditDraft(null);
      setEditChannelIdsBaseline([]);
      setIsEditAgentAdvancedOpen(false);
    }
  };

  const openEditAgent = useCallback((agent: MissionControlSnapshot["agents"][number]) => {
    const nextChannelIds = getWorkspaceChannelIdsForAgent(snapshot, agent.workspaceId, agent.id);

    setEditDraft({
      ...buildAgentDraft(agent.workspaceId, {
        id: agent.id,
        modelId: agent.modelId === "unassigned" ? "" : agent.modelId,
        name: agent.name,
        emoji: agent.identity.emoji ?? "",
        theme: agent.identity.theme ?? "",
        avatar: agent.identity.avatar ?? "",
        policy: agent.policy,
        heartbeat: resolveHeartbeatDraft(agent.policy.preset, {
          enabled: agent.heartbeat.enabled,
          every: agent.heartbeat.every ?? undefined
        }),
        channelIds: nextChannelIds
      })
    });
    setEditChannelIdsBaseline(nextChannelIds);
    setIsEditAgentAdvancedOpen(false);
    setIsEditAgentOpen(true);
  }, [snapshot]);

  useEffect(() => {
    if (!requestedAgentAction || handledRequestedAgentActionIdRef.current === requestedAgentAction.requestId) {
      return;
    }

    const agent = snapshot.agents.find((entry) => entry.id === requestedAgentAction.agentId);

    if (!agent) {
      return;
    }

    handledRequestedAgentActionIdRef.current = requestedAgentAction.requestId;

    if (requestedAgentAction.kind === "edit") {
      openEditAgent(agent);
      return;
    }

    openDeleteAgent(agent);
  }, [requestedAgentAction, snapshot.agents, openDeleteAgent, openEditAgent]);

  const submitEditAgent = async () => {
    if (!editDraft) {
      return;
    }

    const targetWorkspace = snapshot.workspaces.find((workspace) => workspace.id === editDraft.workspaceId) ?? null;
    setIsSavingAgent(true);
    let succeeded = false;

    try {
      const response = await fetch("/api/agents", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(editDraft)
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not update the agent.");
      }

      if (targetWorkspace) {
        await syncWorkspaceAgentChannelBindings({
          workspaceId: editDraft.workspaceId,
          workspacePath: targetWorkspace.path,
          agentId: editDraft.id,
          currentChannelIds: editChannelIdsBaseline,
          nextChannelIds: editDraft.channelIds,
          onRegistryChange: onSnapshotChange
        });
      }

      handleEditAgentOpenChange(false);
      succeeded = true;
    } catch (error) {
      toast.error("Agent update failed.", {
        description: error instanceof Error ? error.message : "Unknown agent error."
      });
    } finally {
      setIsSavingAgent(false);
    }

    if (succeeded) {
      void onRefresh().catch(() => {});
      toast.success("Agent updated in OpenClaw.", {
        description: editDraft.id
      });
    }
  };

  const submitDeleteWorkspace = async () => {
    if (!workspaceDeleteTarget) {
      return;
    }

    setIsSavingWorkspace(true);
    let succeeded = false;
    let deletedWorkspacePath = workspaceDeleteTarget.path;

    try {
      const response = await fetch("/api/workspaces", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId: workspaceDeleteTarget.id
        })
      });

      const result = (await response.json()) as {
        workspacePath?: string;
        deletedAgentIds?: string[];
        deletedRuntimeCount?: number;
        error?: string;
      };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not delete the workspace.");
      }

      setIsDeleteWorkspaceOpen(false);
      setWorkspaceDeleteTarget(null);
      setWorkspaceDeleteConfirmText("");
      onSelectWorkspace(activeWorkspaceId === workspaceDeleteTarget.id ? null : activeWorkspaceId);
      deletedWorkspacePath = result.workspacePath || workspaceDeleteTarget.path;
      succeeded = true;
    } catch (error) {
      toast.error("Workspace deletion failed.", {
        description: error instanceof Error ? error.message : "Unknown workspace error."
      });
    } finally {
      setIsSavingWorkspace(false);
    }

    if (succeeded) {
      void onRefresh().catch(() => {});
      toast.success("Workspace deleted from OpenClaw.", {
        description: deletedWorkspacePath
      });
    }
  };

  const submitDeleteAgent = async () => {
    if (!agentDeleteTarget) {
      return;
    }

    setIsDeletingAgent(true);
    let succeeded = false;
    let deletedAgentId = agentDeleteTarget.id;

    try {
      const response = await fetch("/api/agents", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          agentId: agentDeleteTarget.id
        })
      });

      const result = (await response.json()) as {
        agentId?: string;
        deletedRuntimeCount?: number;
        error?: string;
      };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not delete the agent.");
      }

      if (editDraft?.id === agentDeleteTarget.id) {
        handleEditAgentOpenChange(false);
      }

      setIsDeleteAgentOpen(false);
      setAgentDeleteTarget(null);
      setAgentDeleteConfirmText("");
      deletedAgentId = result.agentId || agentDeleteTarget.id;
      succeeded = true;
    } catch (error) {
      toast.error("Agent deletion failed.", {
        description: error instanceof Error ? error.message : "Unknown agent error."
      });
    } finally {
      setIsDeletingAgent(false);
    }

    if (succeeded) {
      void onRefresh().catch(() => {});
      toast.success("Agent deleted from OpenClaw.", {
        description: deletedAgentId
      });
    }
  };

  return (
    <>
      <div className="relative flex h-full items-start overflow-visible">
        <div
          className={cn(
            "panel-surface panel-glow mission-ease-smooth relative flex h-full shrink-0 self-stretch flex-col items-center overflow-hidden px-1.5 py-2 transition-[max-height] duration-500",
            isPanelCollapsed ? "w-full" : "w-[60px] border-r border-white/[0.08]",
            isRailCollapsed
              ? "max-h-[164px]"
              : "max-h-full"
          )}
        >
          <button
            type="button"
            aria-label={isPanelCollapsed ? "Open mission control" : "Collapse mission control"}
            onClick={togglePanelFromRail}
            className="flex h-9 w-9 shrink-0 aspect-square items-center justify-center overflow-hidden rounded-none border border-cyan-300/20 bg-cyan-400/[0.12] shadow-[0_10px_24px_rgba(34,211,238,0.18)]"
          >
            <Image
              src="/assets/logo.webp"
              alt=""
              width={32}
              height={32}
              aria-hidden="true"
              className="pointer-events-none h-6 w-6 select-none object-contain"
              priority
            />
          </button>

          <div
            className={cn(
              "mission-ease-smooth mt-3.5 flex w-full flex-1 flex-col items-center gap-1 overflow-hidden transition-[max-height,opacity,transform] duration-500",
              isRailCollapsed
                ? "max-h-0 -translate-y-3 opacity-0 pointer-events-none"
                : "max-h-[420px] translate-y-0 opacity-100"
            )}
          >
            {navItems.map((item) => (
              <RailNavButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeSection === item.id}
                onClick={() => {
                  setActiveSection(item.id);

                  if (isPanelCollapsed) {
                    openPanelFromRail();
                    return;
                  }

                  if (activeSection === item.id) {
                    onToggleCollapsed();
                  }
                }}
              />
            ))}
          </div>

          <div className="mt-auto flex w-full flex-col items-center gap-1 pb-1">
            <div className="flex flex-col items-center gap-1">
              <StatusDot tone={statusDot} pulse={snapshot.diagnostics.health === "healthy"} />
              {isPanelCollapsed ? (
                <p className="text-[8px] uppercase tracking-[0.16em] text-slate-500">{snapshot.mode}</p>
              ) : null}
            </div>

            <button
              type="button"
              aria-label={isRailCollapsed ? "Expand rail" : "Collapse rail"}
              onClick={() => {
                if (!isPanelCollapsed) {
                  onToggleCollapsed();
                }

                setIsRailCollapsed((current) => !current);
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-none border border-white/10 bg-white/[0.04] text-slate-300 transition-all hover:border-cyan-300/18 hover:bg-white/[0.08] hover:text-white"
            >
              {isRailCollapsed ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronUp className="h-3.5 w-3.5" />}
            </button>
          </div>

        </div>

        <div
          className={cn(
            "panel-surface panel-glow mission-ease-smooth h-full min-w-0 flex-1 overflow-hidden rounded-none border border-white/[0.08] bg-[#04070e]/88 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl transition-[opacity,transform] duration-500",
            isPanelCollapsed
              ? "-translate-x-4 opacity-0 pointer-events-none"
              : "translate-x-0 opacity-100",
            !isPanelCollapsed && "border-l-0"
          )}
        >
          <div className="mission-scroll flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
            <div className="shrink-0 px-4 pb-3 pt-4">
              <div className="flex w-full items-baseline justify-center gap-2 whitespace-nowrap text-center">
                <span className="font-display text-[14px] font-semibold tracking-[0.18em] text-slate-100">
                  AgentOS
                </span>
                <span className="text-[11px] font-medium text-slate-600">|</span>
                <span className="font-display text-[10px] font-normal tracking-[0.18em] text-slate-500">
                  Mission Control
                </span>
              </div>

              <div className="mt-3 h-px w-full bg-white/[0.08]" />

                <div className="mt-3 rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(13,20,34,0.98),rgba(6,10,18,0.96))] p-3">
                  <div className="flex items-center gap-3">
                    <StatusDot tone={statusDot} pulse={snapshot.diagnostics.health === "healthy"} />
                    <div className="min-w-0">
                      <p className={cn("text-[12px] font-medium capitalize", healthTone)}>
                        {snapshot.diagnostics.health}
                      </p>
                      <p className="truncate text-[9px] uppercase tracking-[0.18em] text-slate-500">
                        {connectionState === "live" ? "online" : connectionState}
                        <span className="mx-2 text-slate-600">·</span>
                        {gatewayAddress}
                      </p>
                    </div>
                  </div>

                {snapshot.diagnostics.issues.length > 0 ? (
                  <div className="mt-2.5 rounded-[14px] border border-amber-400/15 bg-amber-400/[0.08] px-2.5 py-1.5 text-[11px] text-amber-100">
                    {snapshot.diagnostics.issues[0]}
                  </div>
                ) : null}

                {snapshot.diagnostics.health === "offline" ? (
                  <div className="mt-2.5">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={onOpenModelSetup}
                      className="h-8 w-full justify-center rounded-none border-amber-300/20 bg-amber-300/10 px-3 text-[10px] text-amber-50 transition-all duration-200 hover:-translate-y-0.5 hover:border-amber-300/30 hover:bg-amber-300/16 hover:text-amber-50"
                    >
                      <Workflow className="mr-1.5 h-3 w-3" />
                      Open setup
                    </Button>
                  </div>
                ) : null}
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {navItems.map((item) => (
                    <SectionTab
                      key={item.id}
                      label={item.label}
                      badge={item.badge}
                      active={activeSection === item.id}
                      onClick={() => setActiveSection(item.id)}
                    />
                  ))}
                </div>
              </div>

            <div className="flex-1 space-y-6 p-4">
                {activeSection === "overview" ? (
                  <>
                    <SidebarSectionHeader
                      eyebrow="Overview"
                      title="System summary"
                      detail="Current health, active focus, and runtime inventory."
                    />

                    <div className="grid gap-3 sm:grid-cols-2">
                      <OverviewTile label="Workspaces" value={String(snapshot.workspaces.length)} />
                      <OverviewTile label="Agents" value={String(snapshot.agents.length)} />
                      <OverviewTile label="Models" value={String(snapshot.models.length)} />
                      <OverviewTile label="Runs" value={String(snapshot.runtimes.length)} />
                    </div>

                    {activeWorkspace ? (
                      <div className="rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.9),rgba(6,10,18,0.88))] p-4">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <p className="truncate font-display text-[15px] text-white">{activeWorkspace.name}</p>
                            <p className="mt-1 truncate text-[10px] uppercase tracking-[0.22em] text-slate-500">
                              {activeWorkspace.slug}
                            </p>
                          </div>
                          <Badge variant="muted">{activeWorkspace.health}</Badge>
                        </div>

                        <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                          <span>{activeWorkspace.agentIds.length} agents</span>
                          <span>{activeWorkspace.modelIds.length} models</span>
                          <span>{activeWorkspace.activeRuntimeIds.length} runs</span>
                        </div>

                        <p className="mt-3 text-[12px] text-slate-400">{sidebarPathLabel(activeWorkspace.path)}</p>
                      </div>
                    ) : null}
                  </>
                ) : null}

                {activeSection === "workspaces" ? (
                  <>
                    <SidebarSectionHeader
                      eyebrow="Home"
                      title="Workspaces"
                      detail="Select, rename, or remove real OpenClaw workspaces."
                      action={
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 rounded-full px-3 text-[11px]"
                          onClick={() => onSelectWorkspace(null)}
                        >
                          All
                        </Button>
                      }
                    />

                    <div className="space-y-3">
                      {snapshot.workspaces.map((workspace) => {
                        const selected = workspace.id === activeWorkspaceId;

                        return (
                          <div
                            key={workspace.id}
                            className={cn(
                              "rounded-[20px] border p-3.5 transition-all",
                              selected
                                ? "border-cyan-300/[0.35] bg-cyan-400/[0.08] shadow-[0_14px_40px_rgba(34,211,238,0.12)]"
                                : "border-white/[0.08] bg-white/[0.03] hover:bg-white/[0.05]"
                            )}
                          >
                            <button
                              type="button"
                              onClick={() => onSelectWorkspace(selected ? null : workspace.id)}
                              className="w-full text-left"
                            >
                              <div className="flex items-start justify-between gap-3">
                                <div className="min-w-0">
                                  <p className="truncate font-display text-[15px] text-white">{workspace.name}</p>
                                  <p className="mt-1 truncate text-[10px] uppercase tracking-[0.22em] text-slate-500">
                                    {workspace.slug}
                                  </p>
                                </div>
                                <Badge variant={selected ? "default" : "muted"}>{workspace.health}</Badge>
                              </div>
                            </button>

                            <div className="mt-3 flex flex-wrap gap-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                              <span>{workspace.agentIds.length} agents</span>
                              <span>{workspace.modelIds.length} models</span>
                              <span>{workspace.activeRuntimeIds.length} runs</span>
                            </div>

                            <div className="mt-3 flex items-center gap-2">
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-8 rounded-full px-3 text-[11px]"
                                onClick={() => onEditWorkspace(workspace.id)}
                              >
                                Edit
                              </Button>
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-full px-3 text-[11px] text-rose-200 hover:bg-rose-400/10 hover:text-rose-100"
                                onClick={() => openDeleteWorkspace(workspace)}
                              >
                                Delete
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </>
                ) : null}

                {activeSection === "agents" ? (
                  <>
                    <SidebarSectionHeader
                      eyebrow="Apps"
                      title="Agents"
                      detail="Create and tune live isolated OpenClaw operators."
                      action={
                        <CreateAgentDialog
                          snapshot={snapshot}
                          defaultWorkspaceId={activeWorkspaceId ?? snapshot.workspaces[0]?.id ?? null}
                          onRefresh={onRefresh}
                          onSnapshotChange={onSnapshotChange}
                          trigger={
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-8 rounded-full px-3 text-[11px]"
                              disabled={snapshot.workspaces.length === 0}
                            >
                              Add
                            </Button>
                          }
                        />
                      }
                    />

                    <div className="space-y-3">
                      {visibleAgents.length === 0 ? (
                        <div className="rounded-[18px] border border-white/[0.08] bg-white/[0.03] px-3.5 py-3 text-[12px] text-slate-400">
                          No agents are attached to this workspace yet.
                        </div>
                      ) : null}

                      {visibleAgents.map((agent) => (
                        <div
                          key={agent.id}
                          className="rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.9),rgba(8,13,24,0.84))] p-3.5"
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium text-white">
                                {agent.identity.emoji ? `${agent.identity.emoji} ` : ""}
                                {agent.name}
                              </p>
                              <p className="mt-1 truncate text-[10px] uppercase tracking-[0.22em] text-slate-500">
                                {agent.id}
                              </p>
                              <div className="mt-2 flex flex-wrap gap-2">
                                <Badge variant={getAgentPresetMeta(agent.policy.preset).badgeVariant}>
                                  {formatAgentPresetLabel(agent.policy.preset)}
                                </Badge>
                                <Badge variant={agent.status === "engaged" ? "default" : "muted"}>
                                  {agent.status}
                                </Badge>
                              </div>
                            </div>
                            <AgentActionMenu
                              agentName={agent.name}
                              onEdit={() => openEditAgent(agent)}
                              onDelete={() => openDeleteAgent(agent)}
                            />
                          </div>

                          <div className="mt-3 flex items-center gap-2">
                            <div className="min-w-0 flex-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                              <span className="truncate">
                                {agent.modelId === "unassigned" ? "default model" : formatModelLabel(agent.modelId)}
                              </span>
                            </div>
                          </div>

                          {!activeWorkspaceId ? (
                            <p className="mt-2 truncate text-[10px] uppercase tracking-[0.18em] text-slate-500">
                              {snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ||
                                "Workspace"}
                            </p>
                          ) : null}
                        </div>
                      ))}
                    </div>
                  </>
                ) : null}

                {activeSection === "models" ? (
                  <>
                    <SidebarSectionHeader
                      eyebrow="Models"
                      title="Models & providers"
                      detail="Connect providers, choose a default route, and manage live model readiness."
                    />

                    <div className="rounded-[20px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.9),rgba(8,13,24,0.84))] p-4">
                      <div className="space-y-1.5">
                        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Default</p>
                        <p className="font-display text-[15px] text-white">
                          {snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
                            snapshot.diagnostics.modelReadiness.defaultModel ||
                            "Not set"}
                        </p>
                        <p className="text-[12px] leading-5 text-slate-400">
                          Connect providers, choose a default route, and keep live model readiness visible.
                        </p>
                      </div>

                      <div className="mt-4 grid gap-3 border-t border-white/[0.06] pt-4 sm:grid-cols-2">
                        <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Providers</p>
                          <p className="mt-1.5 text-[13px] leading-5 text-white">
                            {
                              snapshot.diagnostics.modelReadiness.authProviders.filter((provider) => provider.connected)
                                .length
                            }{" "}
                            connected
                          </p>
                        </div>
                        <div className="rounded-[16px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                          <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Routes</p>
                          <p className="mt-1.5 text-[13px] leading-5 text-white">
                            {snapshot.diagnostics.modelReadiness.availableModelCount}/
                            {snapshot.diagnostics.modelReadiness.totalModelCount} available
                          </p>
                        </div>
                      </div>

                      {!modelManager.systemReady ? (
                        <div className="mt-4 rounded-[16px] border border-amber-400/15 bg-amber-400/[0.08] px-3 py-2.5">
                          <p className="text-[13px] font-medium text-amber-50">Finish system setup first</p>
                          <p className="mt-1.5 text-[12px] leading-5 text-amber-100/80">
                            Provider auth and model verification need a live OpenClaw gateway and writable runtime
                            state.
                          </p>
                          <div className="mt-3">
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-8 rounded-full px-3 text-[11px]"
                              onClick={onOpenModelSetup}
                            >
                              Open setup
                            </Button>
                          </div>
                        </div>
                      ) : null}

                      <label className="mt-4 block space-y-1 border-t border-white/[0.06] pt-4">
                        <span className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Default model</span>
                        <select
                          value={selectedModelId}
                          onChange={(event) => setModelSelectionDraft(event.target.value)}
                          className="h-10 w-full rounded-[14px] border border-white/[0.08] bg-white/[0.04] px-3 text-[12px] text-slate-100 outline-none"
                        >
                          <option value="">Auto choose</option>
                          {availableModels.map((model) => (
                            <option key={model.id} value={model.id}>
                              {model.name} · {model.provider}
                            </option>
                          ))}
                        </select>
                      </label>

                      <div className="mt-4 grid gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          className="h-8 w-full justify-center rounded-full px-3 text-[11px]"
                          disabled={!modelManager.systemReady || modelManager.runState === "running"}
                          onClick={() => onRunModelSetDefault(selectedModelId || undefined)}
                        >
                          {modelManager.runState === "running" ? "Working..." : "Use selected model"}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="h-8 w-full justify-center rounded-full px-3 text-[11px]"
                          disabled={!modelManager.systemReady || modelManager.runState === "running"}
                          onClick={onRunModelDiscover}
                        >
                          Discover routes
                        </Button>
                      </div>
                    </div>

                    <div className="mt-3 grid grid-cols-2 gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 w-full justify-center rounded-full px-3 text-[11px]"
                        onClick={onOpenAddModels}
                      >
                        Add models
                      </Button>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-8 w-full justify-center rounded-full px-3 text-[11px]"
                        disabled={modelManager.runState === "running"}
                        onClick={onRunModelRefresh}
                      >
                        {modelManager.runState === "running" ? (
                          <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        ) : (
                          <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        Refresh
                      </Button>
                    </div>

                    <div className="space-y-3">
                      {snapshot.diagnostics.modelReadiness.authProviders.map((provider) => (
                        <ProviderCard
                          key={provider.provider}
                          provider={provider}
                          disabled={!modelManager.systemReady || modelManager.runState === "running"}
                          onConnect={() => onConnectModelProvider(provider.provider)}
                        />
                      ))}
                    </div>

                    {discoveredModels.length > 0 ? (
                      <div className="rounded-[20px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.9),rgba(8,13,24,0.84))] p-4">
                        <div className="flex items-center justify-between gap-3">
                          <div>
                            <p className="font-display text-[15px] text-white">Discovered routes</p>
                            <p className="mt-1 text-[12px] leading-5 text-slate-400">
                              Newly detected remote routes that are not configured in the current model deck yet.
                            </p>
                          </div>
                          <Badge variant="muted">{discoveredModels.length}</Badge>
                        </div>

                        <div className="mt-3 space-y-2">
                          {discoveredModels.slice(0, 6).map((model) => (
                            <div
                              key={model.modelId}
                              className="flex items-center justify-between gap-3 rounded-[14px] border border-white/[0.08] bg-white/[0.03] px-3 py-2.5"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-[13px] font-medium text-white">{model.name}</p>
                                <p className="mt-1 text-[10px] uppercase tracking-[0.18em] text-slate-500">
                                  {formatProviderLabel(model.provider)}
                                  {model.isFree ? " · free" : ""}
                                  {model.supportsTools ? " · tools" : ""}
                                </p>
                              </div>
                              <Button
                                variant="secondary"
                                size="sm"
                                className="h-8 rounded-full px-3 text-[11px]"
                                disabled={!modelManager.systemReady || modelManager.runState === "running"}
                                onClick={() => onRunModelSetDefault(model.modelId)}
                              >
                                Use
                              </Button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : null}

                    <div className="space-y-3">
                      {snapshot.models.slice(0, 8).map((model) => (
                        <div
                          key={model.id}
                          className="rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.9),rgba(8,13,24,0.84))] px-3.5 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div className="min-w-0">
                              <p className="truncate text-[13px] font-medium text-white">
                                {formatModelLabel(model.id)}
                              </p>
                              <p className="mt-1 text-[10px] uppercase tracking-[0.22em] text-slate-500">
                                {model.provider}
                              </p>
                            </div>
                            <Badge variant={model.local ? "success" : model.missing ? "danger" : "muted"}>
                              {model.local ? "local" : model.missing ? "missing" : "remote"}
                            </Badge>
                          </div>

                          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-400">
                            <span>{formatContextWindow(model.contextWindow)} ctx</span>
                            <span>{model.usageCount} agents</span>
                          </div>
                        </div>
                      ))}
                    </div>

                  </>
                ) : null}
              </div>

              <div className="shrink-0 border-t border-white/[0.08] p-4">
                <div className="rounded-[22px] border border-cyan-300/10 bg-[linear-gradient(180deg,rgba(7,22,31,0.95),rgba(5,13,22,0.95))] p-4 shadow-[0_16px_40px_rgba(0,0,0,0.22)]">
                  <div className="flex items-center gap-3">
                    <div className="flex h-11 w-11 items-center justify-center rounded-full border border-cyan-300/15 bg-cyan-400/[0.12] text-cyan-200">
                      <Workflow className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="truncate font-display text-[15px] text-white">
                        {activeWorkspace?.name || "No active workspace"}
                      </p>
                      <p className="mt-1 text-[12px] text-slate-400">
                        {activeWorkspace
                          ? `${activeWorkspace.agentIds.length} agents · ${activeWorkspace.activeRuntimeIds.length} runs`
                          : `${snapshot.agents.length} agents · ${snapshot.runtimes.length} runs`}
                      </p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
      </div>

      <Dialog open={isDeleteWorkspaceOpen} onOpenChange={setIsDeleteWorkspaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete OpenClaw workspace</DialogTitle>
            <DialogDescription>
              This permanently removes the workspace directory and all OpenClaw agents bound to it.
            </DialogDescription>
          </DialogHeader>

          {workspaceDeleteTarget ? (
            <div className="space-y-4">
              <div className="rounded-[20px] border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full border border-rose-300/20 bg-rose-400/10 p-2 text-rose-200">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="space-y-1.5 text-sm text-rose-50">
                    <p className="font-medium">This action cannot be undone.</p>
                    <p className="text-rose-100/80">
                      OpenClaw will remove the workspace folder from disk and prune the attached agents/state.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <DeleteMetric label="Agents" value={String(workspaceDeleteAgents.length)} />
                <DeleteMetric label="Runs" value={String(workspaceDeleteRuntimes.length)} />
                <DeleteMetric label="Live agents" value={String(workspaceDeleteLiveAgents.length)} danger={workspaceDeleteLiveAgents.length > 0} />
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Workspace path</p>
                <p className="mt-1.5 break-all font-mono text-xs text-slate-300">{workspaceDeleteTarget.path}</p>
              </div>

              {workspaceDeleteLiveAgents.length > 0 || workspaceDeleteRuntimes.length > 0 ? (
                <div className="rounded-[18px] border border-amber-400/15 bg-amber-400/[0.08] px-3.5 py-3 text-sm text-amber-100">
                  {workspaceDeleteLiveAgents.length > 0
                    ? `${workspaceDeleteLiveAgents.length} active or recently engaged agents are still attached to this workspace.`
                    : `${workspaceDeleteRuntimes.length} runtime records are still associated with this workspace.`}
                </div>
              ) : null}

              <FormField
                label={`Type ${workspaceDeleteTarget.slug} to confirm`}
                htmlFor="delete-workspace-confirm"
              >
                <Input
                  id="delete-workspace-confirm"
                  value={workspaceDeleteConfirmText}
                  onChange={(event) => setWorkspaceDeleteConfirmText(event.target.value)}
                  placeholder={workspaceDeleteTarget.slug}
                />
              </FormField>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setIsDeleteWorkspaceOpen(false);
                setWorkspaceDeleteTarget(null);
                setWorkspaceDeleteConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitDeleteWorkspace}
              disabled={
                isSavingWorkspace ||
                !workspaceDeleteTarget ||
                workspaceDeleteConfirmText.trim() !== workspaceDeleteTarget.slug
              }
            >
              {isSavingWorkspace ? "Deleting…" : "Delete workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isDeleteAgentOpen} onOpenChange={setIsDeleteAgentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete OpenClaw agent</DialogTitle>
            <DialogDescription>
              This removes the selected agent from OpenClaw and detaches its workspace binding.
            </DialogDescription>
          </DialogHeader>

          {agentDeleteTarget ? (
            <div className="space-y-4">
              <div className="rounded-[20px] border border-rose-400/20 bg-rose-500/[0.08] px-4 py-3.5">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full border border-rose-300/20 bg-rose-400/10 p-2 text-rose-200">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="space-y-1.5 text-sm text-rose-50">
                    <p className="font-medium">This action cannot be undone.</p>
                    <p className="text-rose-100/80">
                      OpenClaw will delete this agent, remove its config entry, remove its manifest record, and clean up agent-specific policy/state files. Shared workspace docs and files will remain.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <DeleteMetric label="Status" value={agentDeleteTarget.status} danger={agentDeleteIsLive} />
                <DeleteMetric label="Runs" value={String(agentDeleteRuntimes.length)} />
                <DeleteMetric label="Workspace" value={agentDeleteWorkspace?.name ?? "Unknown"} />
              </div>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Agent id</p>
                <p className="mt-1.5 break-all font-mono text-xs text-slate-300">{agentDeleteTarget.id}</p>
              </div>

              {agentDeleteIsLive || agentDeleteRuntimes.length > 0 ? (
                <div className="rounded-[18px] border border-amber-400/15 bg-amber-400/[0.08] px-3.5 py-3 text-sm text-amber-100">
                  {agentDeleteIsLive
                    ? "This agent is still active or recently engaged. Delete it only if you want to stop using it entirely."
                    : `${agentDeleteRuntimes.length} runtime records are still associated with this agent.`}
                </div>
              ) : null}

              <FormField
                label={`Type ${agentDeleteTarget.id} to confirm`}
                htmlFor="delete-agent-confirm"
              >
                <Input
                  id="delete-agent-confirm"
                  value={agentDeleteConfirmText}
                  onChange={(event) => setAgentDeleteConfirmText(event.target.value)}
                  placeholder={agentDeleteTarget.id}
                />
              </FormField>
            </div>
          ) : null}

          <DialogFooter>
            <Button
              variant="secondary"
              onClick={() => {
                setIsDeleteAgentOpen(false);
                setAgentDeleteTarget(null);
                setAgentDeleteConfirmText("");
              }}
            >
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={submitDeleteAgent}
              disabled={
                isDeletingAgent ||
                !agentDeleteTarget ||
                agentDeleteConfirmText.trim() !== agentDeleteTarget.id
              }
            >
              {isDeletingAgent ? "Deleting…" : "Delete agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditAgentOpen} onOpenChange={handleEditAgentOpenChange}>
        <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader>
            <DialogTitle>Edit OpenClaw agent</DialogTitle>
            <DialogDescription>
              Update the selected agent identity, preset, and operating policy.
            </DialogDescription>
          </DialogHeader>

          {editDraft ? (
            <div className="space-y-5">
              <div className="space-y-3">
                <p className="text-[11px] uppercase tracking-[0.18em] text-slate-400">Agent preset</p>
                <div className="grid gap-3 sm:grid-cols-2">
                  {AGENT_PRESET_OPTIONS.map((option) => (
                    <AgentPresetCard
                      key={option.value}
                      label={option.label}
                      description={option.description}
                      active={editDraft.policy.preset === option.value}
                      badgeVariant={getAgentPresetMeta(option.value).badgeVariant}
                      onClick={() =>
                        setEditDraft((current) => (current ? applyAgentPreset(current, option.value) : current))
                      }
                    />
                  ))}
                </div>
              </div>

              <AgentPolicySummary policy={editDraft.policy} />

              <FormField label="Agent id" htmlFor="edit-agent-id">
                <Input id="edit-agent-id" value={editDraft.id} disabled />
              </FormField>

              <FormField label="Display name" htmlFor="edit-agent-name">
                <Input
                  id="edit-agent-name"
                  value={editDraft.name}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            name: event.target.value
                          }
                        : current
                    )
                  }
                  placeholder={getAgentPresetMeta(editDraft.policy.preset).defaultName}
                />
              </FormField>

              <FormField label="Workspace" htmlFor="edit-agent-workspace">
                <Input
                  id="edit-agent-workspace"
                  value={
                    snapshot.workspaces.find((workspace) => workspace.id === editDraft.workspaceId)?.name ||
                    editDraft.workspaceId
                  }
                  disabled
                />
              </FormField>

              <FormField label="Model" htmlFor="edit-agent-model">
                <select
                  id="edit-agent-model"
                  value={editDraft.modelId}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            modelId: event.target.value
                          }
                        : current
                    )
                  }
                  className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
                >
                  <option value="">Use OpenClaw default</option>
                  {snapshot.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                </select>
              </FormField>

              <div className="grid gap-4 sm:grid-cols-2">
                <FormField label="Emoji" htmlFor="edit-agent-emoji">
                  <Input
                    id="edit-agent-emoji"
                    value={editDraft.emoji}
                    onChange={(event) =>
                      setEditDraft((current) =>
                        current
                          ? {
                              ...current,
                              emoji: event.target.value
                            }
                          : current
                      )
                    }
                    placeholder={getAgentPresetMeta(editDraft.policy.preset).defaultEmoji}
                  />
                </FormField>
                <FormField label="Theme" htmlFor="edit-agent-theme">
                  <Input
                    id="edit-agent-theme"
                    value={editDraft.theme}
                    onChange={(event) =>
                      setEditDraft((current) =>
                        current
                          ? {
                              ...current,
                              theme: event.target.value
                            }
                          : current
                      )
                    }
                    placeholder={getAgentPresetMeta(editDraft.policy.preset).defaultTheme}
                  />
                </FormField>
              </div>

              <FormField label="Avatar URL" htmlFor="edit-agent-avatar">
                <Input
                  id="edit-agent-avatar"
                  value={editDraft.avatar}
                  onChange={(event) =>
                    setEditDraft((current) =>
                      current
                        ? {
                            ...current,
                            avatar: event.target.value
                          }
                        : current
                    )
                  }
                  placeholder="https://example.com/avatar.png"
                />
              </FormField>

              <ChannelBindingPicker
                snapshot={snapshot}
                workspaceId={editDraft.workspaceId}
                channelIds={editDraft.channelIds}
                agentId={editDraft.id}
                isSaving={isSavingAgent}
                onChange={(channelIds) =>
                  setEditDraft((current) =>
                    current
                      ? {
                          ...current,
                          channelIds
                        }
                      : current
                  )
                }
              />

              <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="text-sm font-medium text-white">Advanced policy</p>
                    <p className="mt-1 text-xs leading-5 text-slate-400">
                      Override how this agent handles missing tools, installs, file scope, and network usage.
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    className="h-8 rounded-full px-3 text-[11px]"
                    onClick={() => setIsEditAgentAdvancedOpen((current) => !current)}
                  >
                    {isEditAgentAdvancedOpen ? "Hide" : "Show"}
                  </Button>
                </div>

                {showEditAgentHeartbeatControls ? (
                  <div className="mt-4 rounded-[18px] border border-white/10 bg-slate-950/40 p-4">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <p className="text-sm font-medium text-white">Heartbeat</p>
                        <p className="mt-1 text-xs leading-5 text-slate-400">
                          Use this only for periodic watch or triage agents. Leave it off for normal task execution.
                        </p>
                      </div>
                      <Button
                        type="button"
                        variant={editDraft.heartbeat.enabled ? "default" : "secondary"}
                        size="sm"
                        className="h-8 rounded-full px-3 text-[11px]"
                        onClick={() =>
                          setEditDraft((current) =>
                            current
                              ? {
                                  ...current,
                                  heartbeat: current.heartbeat.enabled
                                    ? { ...current.heartbeat, enabled: false }
                                    : {
                                        ...current.heartbeat,
                                        enabled: true,
                                        every:
                                          current.heartbeat.every ||
                                          defaultHeartbeatForPreset(current.policy.preset).every
                                      }
                                }
                              : current
                          )
                        }
                      >
                        {editDraft.heartbeat.enabled ? "On" : "Off"}
                      </Button>
                    </div>

                    {editDraft.heartbeat.enabled ? (
                      <div className="mt-3">
                        <FormField label="Interval" htmlFor="edit-agent-heartbeat-every">
                          <select
                            id="edit-agent-heartbeat-every"
                            value={editDraft.heartbeat.every}
                            onChange={(event) =>
                              setEditDraft((current) =>
                                current
                                  ? {
                                      ...current,
                                      heartbeat: {
                                        ...current.heartbeat,
                                        every: event.target.value
                                      }
                                    }
                                  : current
                              )
                            }
                            className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
                          >
                            {AGENT_HEARTBEAT_INTERVAL_OPTIONS.map((option) => (
                              <option key={option.value} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </select>
                        </FormField>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {isEditAgentAdvancedOpen ? (
                  <div className="mt-4 grid gap-4 sm:grid-cols-2">
                    <AgentPolicySelect
                      label="Missing tool behavior"
                      htmlFor="edit-agent-missing-tools"
                      value={editDraft.policy.missingToolBehavior}
                      options={AGENT_MISSING_TOOL_BEHAVIOR_OPTIONS}
                      onChange={(value) =>
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                policy: {
                                  ...current.policy,
                                  missingToolBehavior: value
                                }
                              }
                            : current
                        )
                      }
                    />
                    <AgentPolicySelect
                      label="Install scope"
                      htmlFor="edit-agent-install-scope"
                      value={editDraft.policy.installScope}
                      options={AGENT_INSTALL_SCOPE_OPTIONS}
                      onChange={(value) =>
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                policy: {
                                  ...current.policy,
                                  installScope: value
                                }
                              }
                            : current
                        )
                      }
                    />
                    <AgentPolicySelect
                      label="File access"
                      htmlFor="edit-agent-file-access"
                      value={editDraft.policy.fileAccess}
                      options={AGENT_FILE_ACCESS_OPTIONS}
                      onChange={(value) =>
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                policy: {
                                  ...current.policy,
                                  fileAccess: value
                                }
                              }
                            : current
                        )
                      }
                    />
                    <AgentPolicySelect
                      label="Network access"
                      htmlFor="edit-agent-network-access"
                      value={editDraft.policy.networkAccess}
                      options={AGENT_NETWORK_ACCESS_OPTIONS}
                      onChange={(value) =>
                        setEditDraft((current) =>
                          current
                            ? {
                                ...current,
                                policy: {
                                  ...current.policy,
                                  networkAccess: value
                                }
                              }
                            : current
                        )
                      }
                    />
                  </div>
                ) : null}
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="secondary" onClick={() => handleEditAgentOpenChange(false)}>
              Cancel
            </Button>
            <Button onClick={submitEditAgent} disabled={isSavingAgent || !editDraft}>
              {isSavingAgent ? "Saving…" : "Save changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

    </>
  );
}

function RailNavButton({
  icon: Icon,
  label,
  active,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={label}
      className={cn(
    "inline-flex h-8 w-8 items-center justify-center rounded-none border transition-all",
        active
          ? "border-cyan-300/20 bg-cyan-400 text-slate-950 shadow-[0_12px_28px_rgba(96,165,250,0.35)]"
          : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/15 hover:bg-white/[0.08] hover:text-white"
      )}
    >
      <Icon className="h-3.5 w-3.5" />
    </button>
  );
}

function SectionTab({
  label,
  badge,
  active,
  onClick
}: {
  label: string;
  badge?: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[10px] uppercase tracking-[0.16em] transition-all",
        active
          ? "border-cyan-300/20 bg-cyan-400 text-slate-950 shadow-[0_10px_24px_rgba(96,165,250,0.28)]"
          : "border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07] hover:text-white"
      )}
    >
      <span>{label}</span>
      {badge ? (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[9px] tracking-normal",
            active ? "bg-slate-950/14 text-slate-950" : "bg-white/[0.08] text-slate-400"
          )}
        >
          {badge}
        </span>
      ) : null}
    </button>
  );
}

function SidebarSectionHeader({
  eyebrow,
  title,
  detail,
  action
}: {
  eyebrow: string;
  title: string;
  detail: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex items-end justify-between gap-4">
      <div className="min-w-0">
        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{eyebrow}</p>
        <h2 className="mt-1.5 font-display text-[1.02rem] text-white">{title}</h2>
        <p className="mt-1.5 text-[12px] leading-5 text-slate-400">{detail}</p>
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

function OverviewTile({
  label,
  value
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="rounded-[18px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.88),rgba(7,12,22,0.82))] px-3.5 py-3">
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className="mt-1.5 font-display text-[1.2rem] text-white">{value}</p>
    </div>
  );
}

function ProviderCard({
  provider,
  disabled,
  onConnect
}: {
  provider: MissionControlSnapshot["diagnostics"]["modelReadiness"]["authProviders"][number];
  disabled: boolean;
  onConnect: () => void;
}) {
  const connectLabel =
    provider.provider === "openai-codex"
      ? "Connect ChatGPT"
      : provider.provider === "openrouter"
        ? "Add API key"
        : "Connect";

  return (
    <div className="rounded-[20px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(11,18,32,0.9),rgba(8,13,24,0.84))] p-4">
      <div className="flex items-start gap-3">
        <ProviderLogo className="h-8 w-8" provider={provider.provider} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <p className="truncate font-display text-[15px] text-white">{formatProviderLabel(provider.provider)}</p>
            <Badge variant={provider.connected ? "success" : provider.canLogin ? "warning" : "muted"}>
              {provider.connected ? "connected" : provider.canLogin ? "needs auth" : "local"}
            </Badge>
          </div>
          <p className="mt-1 text-[12px] leading-5 text-slate-400">
            {provider.detail || resolveProviderSidebarDetail(provider.provider)}
          </p>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {provider.canLogin ? (
          <Button
            variant={provider.connected ? "ghost" : "secondary"}
            size="sm"
            className="h-8 rounded-full px-3 text-[11px]"
            disabled={disabled}
            onClick={onConnect}
          >
            {connectLabel}
          </Button>
        ) : null}
        {provider.provider === "openai-codex" ? <Badge variant="muted">ChatGPT/Codex route</Badge> : null}
      </div>
    </div>
  );
}

function resolveSidebarModelSelection(snapshot: MissionControlSnapshot) {
  return (
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    snapshot.models.find((model) => model.available !== false && !model.missing)?.id ||
    ""
  );
}

function formatProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openrouter") {
    return "OpenRouter";
  }

  if (normalized === "openai-codex") {
    return "OpenAI Codex";
  }

  if (normalized === "openai") {
    return "OpenAI";
  }

  if (normalized === "anthropic") {
    return "Anthropic";
  }

  if (normalized === "ollama") {
    return "Ollama";
  }

  if (normalized === "xai") {
    return "xAI";
  }

  if (normalized === "gemini") {
    return "Gemini";
  }

  if (normalized === "deepseek") {
    return "DeepSeek";
  }

  if (normalized === "mistral") {
    return "Mistral";
  }

  return provider
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

function resolveProviderSidebarDetail(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openai-codex") {
    return "Use the OpenClaw OpenAI Codex route. If your ChatGPT plan includes Codex access, connect that account here.";
  }

  if (normalized === "openrouter") {
    return "Paste an API key to unlock OpenRouter-hosted routes.";
  }

  if (normalized === "gemini") {
    return "Paste a Gemini API key to unlock Gemini-hosted routes.";
  }

  if (normalized === "deepseek") {
    return "Paste a DeepSeek API key to unlock DeepSeek-hosted routes.";
  }

  if (normalized === "mistral") {
    return "Paste a Mistral API key to unlock Mistral and Codestral routes.";
  }

  if (normalized === "xai") {
    return "Paste an xAI API key to unlock Grok routes.";
  }

  if (normalized === "ollama") {
    return "Local model provider. Pull models locally to make new routes available.";
  }

  return "Connect this provider to make its remote routes available inside AgentOS.";
}

function FormField({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
        {label}
      </Label>
      {children}
    </div>
  );
}

function AgentPresetCard({
  label,
  description,
  active,
  badgeVariant,
  onClick
}: {
  label: string;
  description: string;
  active: boolean;
  badgeVariant: "default" | "muted" | "success" | "warning";
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-[20px] border p-4 text-left transition-colors",
        active ? "border-cyan-300/30 bg-cyan-400/10" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="space-y-1">
          <p className="text-sm font-medium text-white">{label}</p>
          <p className="text-xs leading-5 text-slate-400">{description}</p>
        </div>
        <Badge variant={badgeVariant}>{active ? "selected" : "preset"}</Badge>
      </div>
    </button>
  );
}

function AgentPolicySummary({ policy }: { policy: AgentPolicy }) {
  const presetMeta = getAgentPresetMeta(policy.preset);

  return (
    <div className="rounded-[20px] border border-white/10 bg-slate-950/50 p-4">
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">{presetMeta.label}</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">{presetMeta.description}</p>
        </div>
        <Badge variant={presetMeta.badgeVariant}>{presetMeta.label}</Badge>
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Badge variant="muted">{formatAgentMissingToolBehaviorLabel(policy.missingToolBehavior)}</Badge>
        <Badge variant="muted">{formatAgentInstallScopeLabel(policy.installScope)}</Badge>
        <Badge variant="muted">{formatAgentFileAccessLabel(policy.fileAccess)}</Badge>
        <Badge variant="muted">Network {formatAgentNetworkAccessLabel(policy.networkAccess)}</Badge>
      </div>
    </div>
  );
}

function AgentPolicySelect<T extends string>({
  label,
  htmlFor,
  value,
  options,
  onChange
}: {
  label: string;
  htmlFor: string;
  value: T;
  options: Array<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <FormField label={label} htmlFor={htmlFor}>
      <select
        id={htmlFor}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} - {option.description}
          </option>
        ))}
      </select>
    </FormField>
  );
}

function buildAgentDraft(workspaceId: string, seed: Partial<AgentDraft> = {}): AgentDraft {
  const policy = resolveAgentPolicy(seed.policy?.preset ?? "worker", seed.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const heartbeat = resolveHeartbeatDraft(policy.preset, seed.heartbeat);

  return {
    id: seed.id ?? "",
    workspaceId,
    modelId: seed.modelId ?? "",
    name: seed.name ?? presetMeta.defaultName,
    emoji: seed.emoji ?? presetMeta.defaultEmoji,
    theme: seed.theme ?? presetMeta.defaultTheme,
    avatar: seed.avatar ?? "",
    policy,
    heartbeat,
    channelIds: Array.from(
      new Set(
        (seed.channelIds ?? []).filter((entry): entry is string => typeof entry === "string" && Boolean(entry.trim()))
      )
    )
  };
}

function applyAgentPreset(draft: AgentDraft, preset: AgentPreset): AgentDraft {
  const previousMeta = getAgentPresetMeta(draft.policy.preset);
  const nextMeta = getAgentPresetMeta(preset);
  const nextPolicy = resolveAgentPolicy(preset);

  return {
    ...draft,
    name: !draft.name || draft.name === previousMeta.defaultName ? nextMeta.defaultName : draft.name,
    emoji: !draft.emoji || draft.emoji === previousMeta.defaultEmoji ? nextMeta.defaultEmoji : draft.emoji,
    theme: !draft.theme || draft.theme === previousMeta.defaultTheme ? nextMeta.defaultTheme : draft.theme,
    policy: nextPolicy,
    heartbeat: applyPresetHeartbeat(draft.heartbeat, draft.policy.preset, preset)
  };
}

function sidebarPathLabel(value: string) {
  const compact = compactPath(value);
  const parts = compact.split("/").filter(Boolean);
  const visibleParts = parts.filter((part) => !isUuidSegment(part));

  if (visibleParts.length <= 3) {
    return compact;
  }

  const root = visibleParts[0] === "~" ? "~/" : "/";
  return `${root}…/${visibleParts.slice(-2).join("/")}`;
}

function isUuidSegment(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

function AgentActionMenu({
  agentName,
  onEdit,
  onDelete
}: {
  agentName: string;
  onEdit: () => void;
  onDelete: () => void;
}) {
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    return () => window.removeEventListener("pointerdown", handlePointerDown);
  }, [open]);

  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        aria-label={`${agentName} actions`}
        onClick={() => setOpen((current) => !current)}
        className="inline-flex rounded-full border border-white/[0.08] bg-white/[0.05] p-1.5 text-slate-300 transition-colors hover:bg-white/[0.1] hover:text-white"
      >
        <MoreHorizontal className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div className="absolute right-0 top-[calc(100%+8px)] z-30 min-w-[136px] rounded-[14px] border border-white/[0.1] bg-slate-950/96 p-1.5 shadow-[0_20px_44px_rgba(0,0,0,0.42)] backdrop-blur-xl">
          <AgentMenuButton
            label="Edit"
            onClick={() => {
              setOpen(false);
              onEdit();
            }}
          />
          <AgentMenuButton
            label="Delete"
            danger
            onClick={() => {
              setOpen(false);
              onDelete();
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

function AgentMenuButton({
  label,
  onClick,
  danger = false
}: {
  label: string;
  onClick: () => void;
  danger?: boolean;
}) {
  return (
    <button
      type="button"
      className={cn(
        "flex w-full items-center rounded-[10px] px-2.5 py-2 text-left text-[11px] transition-colors",
        danger ? "text-rose-200 hover:bg-rose-400/10 hover:text-rose-100" : "text-slate-200 hover:bg-white/[0.06] hover:text-white"
      )}
      onClick={onClick}
    >
      <span>{label}</span>
    </button>
  );
}

function DeleteMetric({
  label,
  value,
  danger = false
}: {
  label: string;
  value: string;
  danger?: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-[18px] border px-3.5 py-3",
        danger ? "border-amber-300/20 bg-amber-400/[0.08]" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">{label}</p>
      <p className={cn("mt-1.5 font-display text-lg", danger ? "text-amber-100" : "text-white")}>{value}</p>
    </div>
  );
}
