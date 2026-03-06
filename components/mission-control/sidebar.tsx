"use client";

import type { ReactNode } from "react";
import { useEffect, useMemo, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  Cpu,
  FolderKanban,
  Home,
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
  DialogTitle,
  DialogTrigger
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { toast } from "@/components/ui/sonner";
import { compactPath, formatContextWindow, formatModelLabel, toneForHealth } from "@/lib/openclaw/presenters";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type AgentDraft = {
  id: string;
  workspaceId: string;
  modelId: string;
  name: string;
  emoji: string;
  theme: string;
  avatar: string;
};

type WorkspaceDraft = {
  workspaceId: string;
  name: string;
  directory: string;
  currentPath: string;
};

type SidebarSectionId = "overview" | "workspaces" | "agents" | "models";

export function MissionSidebar({
  snapshot,
  activeWorkspaceId,
  connectionState,
  collapsed,
  onToggleCollapsed,
  onSelectWorkspace,
  onRefresh
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  connectionState: "connecting" | "live" | "retrying";
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onSelectWorkspace: (workspaceId: string | null) => void;
  onRefresh: () => Promise<void>;
}) {
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
  const [isCreateAgentOpen, setIsCreateAgentOpen] = useState(false);
  const [isEditAgentOpen, setIsEditAgentOpen] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [isEditWorkspaceOpen, setIsEditWorkspaceOpen] = useState(false);
  const [isDeleteWorkspaceOpen, setIsDeleteWorkspaceOpen] = useState(false);
  const [isSavingWorkspace, setIsSavingWorkspace] = useState(false);
  const [createDraft, setCreateDraft] = useState<AgentDraft>(() => ({
    id: "",
    workspaceId: activeWorkspaceId ?? snapshot.workspaces[0]?.id ?? "",
    modelId: "",
    name: "",
    emoji: "",
    theme: "",
    avatar: ""
  }));
  const [editDraft, setEditDraft] = useState<AgentDraft | null>(null);
  const [workspaceDraft, setWorkspaceDraft] = useState<WorkspaceDraft | null>(null);
  const [workspaceDeleteTarget, setWorkspaceDeleteTarget] = useState<MissionControlSnapshot["workspaces"][number] | null>(null);
  const [workspaceDeleteConfirmText, setWorkspaceDeleteConfirmText] = useState("");
  const [activeSection, setActiveSection] = useState<SidebarSectionId>("workspaces");

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

  useEffect(() => {
    setCreateDraft((current) => {
      const availableWorkspaceIds = new Set(snapshot.workspaces.map((workspace) => workspace.id));
      const preservedWorkspaceId =
        current.workspaceId && availableWorkspaceIds.has(current.workspaceId) ? current.workspaceId : "";
      const nextWorkspaceId = (activeWorkspaceId ?? preservedWorkspaceId) || snapshot.workspaces[0]?.id || "";

      if (current.workspaceId === nextWorkspaceId) {
        return current;
      }

      return {
        ...current,
        workspaceId: nextWorkspaceId
      };
    });
  }, [activeWorkspaceId, snapshot.workspaces]);

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

  const openCreateAgent = () => {
    setCreateDraft({
      id: "",
      workspaceId: activeWorkspaceId ?? snapshot.workspaces[0]?.id ?? "",
      modelId: "",
      name: "",
      emoji: "",
      theme: "",
      avatar: ""
    });
    setIsCreateAgentOpen(true);
  };

  const openEditWorkspace = (workspace: MissionControlSnapshot["workspaces"][number]) => {
    setWorkspaceDraft({
      workspaceId: workspace.id,
      name: workspace.name,
      directory: "",
      currentPath: workspace.path
    });
    setIsEditWorkspaceOpen(true);
  };

  const openDeleteWorkspace = (workspace: MissionControlSnapshot["workspaces"][number]) => {
    setWorkspaceDeleteTarget(workspace);
    setWorkspaceDeleteConfirmText("");
    setIsDeleteWorkspaceOpen(true);
  };

  const openEditAgent = (agent: MissionControlSnapshot["agents"][number]) => {
    setEditDraft({
      id: agent.id,
      workspaceId: agent.workspaceId,
      modelId: agent.modelId === "unassigned" ? "" : agent.modelId,
      name: agent.name,
      emoji: agent.identity.emoji ?? "",
      theme: agent.identity.theme ?? "",
      avatar: agent.identity.avatar ?? ""
    });
    setIsEditAgentOpen(true);
  };

  const submitCreateAgent = async () => {
    setIsSavingAgent(true);

    try {
      const response = await fetch("/api/agents", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(createDraft)
      });

      const result = (await response.json()) as { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not create the agent.");
      }

      toast.success("Agent created in OpenClaw.", {
        description: createDraft.id
      });
      setIsCreateAgentOpen(false);
      await onRefresh();
    } catch (error) {
      toast.error("Agent creation failed.", {
        description: error instanceof Error ? error.message : "Unknown agent error."
      });
    } finally {
      setIsSavingAgent(false);
    }
  };

  const submitEditAgent = async () => {
    if (!editDraft) {
      return;
    }

    setIsSavingAgent(true);

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

      toast.success("Agent updated in OpenClaw.", {
        description: editDraft.id
      });
      setIsEditAgentOpen(false);
      await onRefresh();
    } catch (error) {
      toast.error("Agent update failed.", {
        description: error instanceof Error ? error.message : "Unknown agent error."
      });
    } finally {
      setIsSavingAgent(false);
    }
  };

  const submitEditWorkspace = async () => {
    if (!workspaceDraft) {
      return;
    }

    setIsSavingWorkspace(true);

    try {
      const response = await fetch("/api/workspaces", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId: workspaceDraft.workspaceId,
          name: workspaceDraft.name.trim() || undefined,
          directory: workspaceDraft.directory.trim() || undefined
        })
      });

      const result = (await response.json()) as {
        workspaceId?: string;
        workspacePath?: string;
        error?: string;
      };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not update the workspace.");
      }

      toast.success("Workspace updated in OpenClaw.", {
        description: result.workspacePath || workspaceDraft.currentPath
      });
      setIsEditWorkspaceOpen(false);
      await onRefresh();
      onSelectWorkspace(result.workspaceId ?? workspaceDraft.workspaceId);
    } catch (error) {
      toast.error("Workspace update failed.", {
        description: error instanceof Error ? error.message : "Unknown workspace error."
      });
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  const submitDeleteWorkspace = async () => {
    if (!workspaceDeleteTarget) {
      return;
    }

    setIsSavingWorkspace(true);

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

      toast.success("Workspace deleted from OpenClaw.", {
        description: result.workspacePath || workspaceDeleteTarget.path
      });
      setIsDeleteWorkspaceOpen(false);
      setWorkspaceDeleteTarget(null);
      setWorkspaceDeleteConfirmText("");
      onSelectWorkspace(activeWorkspaceId === workspaceDeleteTarget.id ? null : activeWorkspaceId);
      await onRefresh();
    } catch (error) {
      toast.error("Workspace deletion failed.", {
        description: error instanceof Error ? error.message : "Unknown workspace error."
      });
    } finally {
      setIsSavingWorkspace(false);
    }
  };

  return (
    <>
      <div className="panel-surface panel-glow flex h-full overflow-hidden rounded-[30px] border border-white/[0.08] bg-[#04070e]/88 shadow-[0_28px_90px_rgba(0,0,0,0.42)] backdrop-blur-2xl">
        <div
          className={cn(
            "flex h-full shrink-0 flex-col items-center bg-[linear-gradient(180deg,rgba(7,10,18,0.98),rgba(3,6,12,0.98))] px-3 py-4",
            collapsed ? "w-full" : "w-[78px] border-r border-white/[0.08]"
          )}
        >
          <button
            type="button"
            aria-label={collapsed ? "Expand mission control" : "Collapse mission control"}
            onClick={onToggleCollapsed}
            className="flex h-12 w-12 items-center justify-center rounded-[18px] border border-cyan-300/20 bg-cyan-400/[0.12] shadow-[0_10px_24px_rgba(34,211,238,0.18)] transition-all hover:border-cyan-200/30 hover:bg-cyan-400/[0.16]"
          >
            <Workflow className="h-5 w-5 text-cyan-200" />
          </button>

          <button
            type="button"
            aria-label={collapsed ? "Expand mission control" : "Collapse mission control"}
            onClick={onToggleCollapsed}
            className="mt-4 inline-flex h-11 w-11 items-center justify-center rounded-[16px] border border-white/10 bg-white/[0.04] text-slate-300 transition-all hover:border-cyan-300/18 hover:bg-white/[0.08] hover:text-white"
          >
            {collapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
          </button>

          <div className="mt-6 flex flex-1 flex-col items-center gap-2">
            {navItems.map((item) => (
              <RailNavButton
                key={item.id}
                icon={item.icon}
                label={item.label}
                active={activeSection === item.id}
                onClick={() => {
                  setActiveSection(item.id);

                  if (collapsed) {
                    onToggleCollapsed();
                  }
                }}
              />
            ))}
          </div>

          <div className="mt-4 flex flex-col items-center gap-2">
            <StatusDot tone={statusDot} pulse={snapshot.diagnostics.health === "healthy"} />
            {collapsed ? (
              <p className="text-[9px] uppercase tracking-[0.18em] text-slate-500">{snapshot.mode}</p>
            ) : null}
          </div>
        </div>

        {!collapsed ? (
          <div className="min-w-0 flex-1 bg-[linear-gradient(180deg,rgba(6,10,18,0.96),rgba(3,6,14,0.98))]">
            <div className="mission-scroll flex h-full min-h-0 flex-col overflow-y-auto overscroll-contain">
              <div className="shrink-0 border-b border-white/[0.08] px-5 pb-4 pt-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0">
                    <p className="text-[11px] uppercase tracking-[0.28em] text-slate-500">OpenClaw</p>
                    <h1 className="mt-2 font-display text-[1.38rem] text-white">Mission Control</h1>
                    <p className="mt-2 text-[12px] leading-5 text-slate-400">
                      Classic operations rail for live workspaces, agents, and model routing.
                    </p>
                  </div>

                  <div className="rounded-[18px] border border-white/10 bg-white/[0.04] p-2.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <Workflow className="h-4 w-4 text-cyan-200" />
                  </div>
                </div>

                <div className="mt-4 rounded-[22px] border border-white/[0.08] bg-[linear-gradient(180deg,rgba(13,20,34,0.98),rgba(6,10,18,0.96))] p-4">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-3">
                      <StatusDot tone={statusDot} pulse={snapshot.diagnostics.health === "healthy"} />
                      <div>
                        <p className={cn("text-[13px] font-medium capitalize", healthTone)}>
                          {snapshot.diagnostics.health}
                        </p>
                        <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">
                          {connectionState === "live" ? "stream online" : connectionState}
                        </p>
                      </div>
                    </div>
                    <Badge variant="muted">{snapshot.mode}</Badge>
                  </div>

                  <div className="mt-3 rounded-[16px] border border-white/[0.06] bg-white/[0.03] px-3 py-2.5">
                    <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Gateway</p>
                    <p className="mt-1.5 text-[13px] text-white">{gatewayAddress}</p>
                  </div>

                  {snapshot.diagnostics.issues.length > 0 ? (
                    <div className="mt-3 rounded-[16px] border border-amber-400/15 bg-amber-400/[0.08] px-3 py-2 text-xs text-amber-100">
                      {snapshot.diagnostics.issues[0]}
                    </div>
                  ) : null}
                </div>

                <div className="mt-4 flex flex-wrap gap-2">
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
                                onClick={() => openEditWorkspace(workspace)}
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
                        <Dialog open={isCreateAgentOpen} onOpenChange={setIsCreateAgentOpen}>
                          <DialogTrigger asChild>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-8 rounded-full px-3 text-[11px]"
                              onClick={openCreateAgent}
                              disabled={snapshot.workspaces.length === 0}
                            >
                              Add
                            </Button>
                          </DialogTrigger>
                          <DialogContent>
                            <DialogHeader>
                              <DialogTitle>Create a new OpenClaw agent</DialogTitle>
                              <DialogDescription>
                                This creates a real isolated agent bound to an existing workspace.
                              </DialogDescription>
                            </DialogHeader>

                            <div className="space-y-4">
                              <FormField label="Agent id" htmlFor="agent-id">
                                <Input
                                  id="agent-id"
                                  value={createDraft.id}
                                  onChange={(event) =>
                                    setCreateDraft((current) => ({
                                      ...current,
                                      id: event.target.value
                                    }))
                                  }
                                  placeholder="marketing-agent"
                                />
                              </FormField>

                              <FormField label="Display name" htmlFor="agent-name">
                                <Input
                                  id="agent-name"
                                  value={createDraft.name}
                                  onChange={(event) =>
                                    setCreateDraft((current) => ({
                                      ...current,
                                      name: event.target.value
                                    }))
                                  }
                                  placeholder="Marketing"
                                />
                              </FormField>

                              <FormField label="Workspace" htmlFor="agent-workspace">
                                <select
                                  id="agent-workspace"
                                  value={createDraft.workspaceId}
                                  onChange={(event) =>
                                    setCreateDraft((current) => ({
                                      ...current,
                                      workspaceId: event.target.value
                                    }))
                                  }
                                  className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
                                >
                                  {snapshot.workspaces.map((workspace) => (
                                    <option key={workspace.id} value={workspace.id}>
                                      {workspace.name}
                                    </option>
                                  ))}
                                </select>
                              </FormField>

                              <FormField label="Model" htmlFor="agent-model">
                                <select
                                  id="agent-model"
                                  value={createDraft.modelId}
                                  onChange={(event) =>
                                    setCreateDraft((current) => ({
                                      ...current,
                                      modelId: event.target.value
                                    }))
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
                                <FormField label="Emoji" htmlFor="agent-emoji">
                                  <Input
                                    id="agent-emoji"
                                    value={createDraft.emoji}
                                    onChange={(event) =>
                                      setCreateDraft((current) => ({
                                        ...current,
                                        emoji: event.target.value
                                      }))
                                    }
                                    placeholder="🤖"
                                  />
                                </FormField>
                                <FormField label="Theme" htmlFor="agent-theme">
                                  <Input
                                    id="agent-theme"
                                    value={createDraft.theme}
                                    onChange={(event) =>
                                      setCreateDraft((current) => ({
                                        ...current,
                                        theme: event.target.value
                                      }))
                                    }
                                    placeholder="protocol droid"
                                  />
                                </FormField>
                              </div>

                              <FormField label="Avatar URL" htmlFor="agent-avatar">
                                <Input
                                  id="agent-avatar"
                                  value={createDraft.avatar}
                                  onChange={(event) =>
                                    setCreateDraft((current) => ({
                                      ...current,
                                      avatar: event.target.value
                                    }))
                                  }
                                  placeholder="https://example.com/avatar.png"
                                />
                              </FormField>
                            </div>

                            <DialogFooter>
                              <Button variant="secondary" onClick={() => setIsCreateAgentOpen(false)}>
                                Cancel
                              </Button>
                              <Button
                                onClick={submitCreateAgent}
                                disabled={isSavingAgent || !createDraft.id.trim() || !createDraft.workspaceId}
                              >
                                {isSavingAgent ? "Creating…" : "Create agent"}
                              </Button>
                            </DialogFooter>
                          </DialogContent>
                        </Dialog>
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
                            </div>
                            <Badge variant={agent.status === "engaged" ? "default" : "muted"}>
                              {agent.status}
                            </Badge>
                          </div>

                          <div className="mt-3 flex items-center gap-2">
                            <div className="min-w-0 flex-1 rounded-full border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[10px] uppercase tracking-[0.16em] text-slate-400">
                              <span className="truncate">
                                {agent.modelId === "unassigned" ? "default model" : formatModelLabel(agent.modelId)}
                              </span>
                            </div>
                            <Button
                              variant="secondary"
                              size="sm"
                              className="h-8 shrink-0 rounded-full px-3 text-[11px]"
                              onClick={() => openEditAgent(agent)}
                            >
                              Edit
                            </Button>
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
                      title="Model deck"
                      detail="Available routing targets and current usage across agents."
                    />

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
        ) : null}
      </div>

      <Dialog open={isEditWorkspaceOpen} onOpenChange={setIsEditWorkspaceOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit OpenClaw workspace</DialogTitle>
            <DialogDescription>
              Renaming a workspace moves the real directory and updates every attached agent binding.
            </DialogDescription>
          </DialogHeader>

          {workspaceDraft ? (
            <div className="space-y-4">
              <FormField label="Workspace name" htmlFor="edit-workspace-name">
                <Input
                  id="edit-workspace-name"
                  value={workspaceDraft.name}
                  onChange={(event) =>
                    setWorkspaceDraft((current) =>
                      current
                        ? {
                            ...current,
                            name: event.target.value
                          }
                        : current
                    )
                  }
                  placeholder="Workspace name"
                />
              </FormField>

              <div className="rounded-[18px] border border-white/10 bg-white/[0.03] px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-slate-500">Current path</p>
                <p className="mt-1.5 break-all font-mono text-xs text-slate-300">{workspaceDraft.currentPath}</p>
              </div>

              <FormField label="Directory override" htmlFor="edit-workspace-directory">
                <Input
                  id="edit-workspace-directory"
                  value={workspaceDraft.directory}
                  onChange={(event) =>
                    setWorkspaceDraft((current) =>
                      current
                        ? {
                            ...current,
                            directory: event.target.value
                          }
                        : current
                    )
                  }
                  placeholder="Leave blank to rename in the same parent folder"
                />
              </FormField>
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsEditWorkspaceOpen(false)}>
              Cancel
            </Button>
            <Button onClick={submitEditWorkspace} disabled={isSavingWorkspace || !workspaceDraft?.name.trim()}>
              {isSavingWorkspace ? "Saving…" : "Save workspace"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

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

      <Dialog open={isEditAgentOpen} onOpenChange={setIsEditAgentOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit OpenClaw agent</DialogTitle>
            <DialogDescription>
              Update the selected agent identity and routing model.
            </DialogDescription>
          </DialogHeader>

          {editDraft ? (
            <div className="space-y-4">
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
                  placeholder="Agent display name"
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
                    placeholder="🤖"
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
                    placeholder="theme"
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
            </div>
          ) : null}

          <DialogFooter>
            <Button variant="secondary" onClick={() => setIsEditAgentOpen(false)}>
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
        "inline-flex h-11 w-11 items-center justify-center rounded-[16px] border transition-all",
        active
          ? "border-cyan-300/20 bg-cyan-400 text-slate-950 shadow-[0_12px_28px_rgba(96,165,250,0.35)]"
          : "border-white/10 bg-white/[0.03] text-slate-400 hover:border-white/15 hover:bg-white/[0.08] hover:text-white"
      )}
    >
      <Icon className="h-4 w-4" />
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
        "inline-flex items-center gap-2 rounded-full border px-3 py-2 text-[11px] uppercase tracking-[0.18em] transition-all",
        active
          ? "border-cyan-300/20 bg-cyan-400 text-slate-950 shadow-[0_10px_24px_rgba(96,165,250,0.28)]"
          : "border-white/[0.08] bg-white/[0.03] text-slate-300 hover:bg-white/[0.07] hover:text-white"
      )}
    >
      <span>{label}</span>
      {badge ? (
        <span
          className={cn(
            "rounded-full px-1.5 py-0.5 text-[10px] tracking-normal",
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
