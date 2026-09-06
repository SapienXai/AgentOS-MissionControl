"use client";

import type { ReactNode } from "react";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";
import type { LucideIcon } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import {
  Activity,
  AlertTriangle,
  Bot,
  ChevronDown,
  ChevronRight,
  ClipboardList,
  Cpu,
  Download,
  FileText,
  Gauge,
  Home,
  Inbox,
  KeyRound,
  LifeBuoy,
  LockKeyhole,
  Loader2,
  LogOut,
  Moon,
  Pencil,
  Plug,
  Plus,
  Settings2,
  ShieldCheck,
  ShieldAlert,
  SunMedium,
  Trash2,
  UserRound,
  Users
} from "lucide-react";

import { ChannelBindingPicker } from "@/components/mission-control/channel-binding-picker";
import { InstanceProtectionDialog } from "@/components/auth/instance-protection-dialog";
import { useInstanceProtection } from "@/components/auth/instance-protection-provider";
import { ConnectChannelsDialog } from "@/components/mission-control/connect-channels-dialog";
import { AgentThemePicker } from "@/components/mission-control/agent-theme-picker";
import {
  MissionControlDialogChip,
  MissionControlDialogShell,
  missionControlDialogButtonClassName,
  missionControlDialogControlClassName,
  missionControlDialogPanelClassName
} from "@/components/mission-control/mission-control-dialog-shell";
import {
  buildPendingWorkspaceMenuEntries,
  type PendingAgentProjection,
  type PendingWorkspaceMenuEntry
} from "@/components/mission-control/pending-agent-projection";
import { RailTooltip } from "@/components/mission-control/rail-tooltip";
import { StatusDot } from "@/components/mission-control/status-dot";
import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import {
  UserProfileDialog,
  type OperatorProfileSummary
} from "@/components/mission-control/user-profile-dialog";
import { UserManagementDialog } from "@/components/mission-control/user-management-dialog";
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
import { PikoLoader } from "@/components/ui/piko-loader";
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
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import type {
  AgentPolicy,
  AgentPreset,
  DiscoveredModelCandidate,
  MissionControlSnapshot
} from "@/lib/agentos/contracts";
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

type SidebarSection = "overview" | "operations" | "system";

type SidebarItem = {
  label: string;
  href?: string;
  hash?: string;
  icon: LucideIcon;
  badge?: number;
  section: SidebarSection;
};

type MissionSidebarProps = {
  snapshot: MissionControlSnapshot;
  surfaceTheme: "dark" | "light";
  activeWorkspaceId: string | null;
  requestedAgentAction?: {
    requestId: string;
    kind: "edit" | "delete";
    agentId: string;
  } | null;
  connectionState: "connecting" | "live" | "retrying";
  collapsed: boolean;
  sidebarPinned?: boolean;
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
  onExpandCollapsed?: () => void;
  onToggleCollapsed: () => void;
  onToggleTheme: () => void;
  onSelectWorkspace: (workspaceId: string | null) => void;
  onRefresh: () => Promise<void>;
  onRunModelRefresh: () => void;
  onRunModelDiscover: () => void;
  onRunModelSetDefault: (modelId?: string) => void;
  onConnectModelProvider: (provider: string) => void;
  onOpenModelSetup: () => void;
  onOpenAddModels: () => void;
  onOpenCreateAgent?: () => void;
  onOpenWorkspaceCreate: () => void;
  onEditWorkspace: (workspaceId: string) => void;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  pendingCreatedAgents?: PendingAgentProjection[];
  pendingWorkspaceCreations?: PendingWorkspaceMenuEntry[];
  onAgentCreationPending?: (agent: PendingAgentProjection) => void;
  onAgentCreatedVisible?: (agentId: string) => void;
  onAgentActionModalOpenChange?: (open: boolean) => void;
  onAgentActionRequestDismiss?: () => void;
  settingsMode?: boolean;
};

const sidebarSections: Array<{ id: SidebarSection; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "operations", label: "Operations" },
  { id: "system", label: "System" }
];

const sidebarItems: SidebarItem[] = [
  { label: "Mission Control", href: "/", icon: Gauge, section: "overview" },
  { label: "Dashboard", href: "/dashboard", icon: Inbox, section: "overview" },
  { label: "Agents", href: "/agents", icon: Bot, section: "operations" },
  { label: "Operations", href: "/operations", icon: Activity, section: "operations" },
  { label: "Missions", href: "/missions", icon: ClipboardList, section: "operations" },
  { label: "Human Control", href: "/human-control", icon: ShieldAlert, section: "operations" },
  { label: "Files", href: "/files", icon: FileText, section: "operations" },
  { label: "Accounts", href: "/accounts", icon: KeyRound, section: "operations" },
  { label: "Models", href: "/models", icon: Cpu, section: "operations" },
  { label: "Integrations", href: "/integrations", icon: Plug, section: "operations" },
  { label: "Updates", href: "/updates", icon: Download, section: "system" },
  { label: "Settings", href: "/settings", icon: Settings2, section: "system" },
];

const collapsedSidebarItems = sidebarItems.slice(
  0,
  sidebarItems.findIndex((item) => item.label === "Accounts") + 1
);

const agentOsLogoSrc = "/assets/logo.webp";
const emptyOperatorProfile: OperatorProfileSummary = {
  fullName: "",
  username: "",
  email: "",
  avatarDataUrl: null
};

type WorkspaceMenuEntry = (
  | {
      id: string;
      name: string;
      detail: string;
      pending: false;
    }
  | PendingWorkspaceMenuEntry
) & {
  sortRank: number;
};

export function MissionSidebar({
  snapshot,
  surfaceTheme,
  activeWorkspaceId,
  requestedAgentAction,
  connectionState,
  collapsed,
  sidebarPinned = false,
  onExpandCollapsed,
  onToggleCollapsed,
  onToggleTheme,
  onSelectWorkspace,
  onRefresh,
  onOpenCreateAgent,
  onOpenWorkspaceCreate,
  onEditWorkspace,
  onSnapshotChange,
  pendingCreatedAgents = [],
  pendingWorkspaceCreations = [],
  onAgentCreationPending,
  onAgentCreatedVisible,
  onAgentActionModalOpenChange,
  onAgentActionRequestDismiss
}: MissionSidebarProps) {
  const pathname = usePathname();
  const [activeHash, setActiveHash] = useState("");
  const [isEditAgentOpen, setIsEditAgentOpen] = useState(false);
  const [showEditIdentityDetails, setShowEditIdentityDetails] = useState(false);
  const [isEditAgentAdvancedOpen, setIsEditAgentAdvancedOpen] = useState(false);
  const [isSavingAgent, setIsSavingAgent] = useState(false);
  const [isDeleteAgentOpen, setIsDeleteAgentOpen] = useState(false);
  const [isDeletingAgent, setIsDeletingAgent] = useState(false);
  const [editDraft, setEditDraft] = useState<AgentDraft | null>(null);
  const [editChannelIdsBaseline, setEditChannelIdsBaseline] = useState<string[]>([]);
  const [agentDeleteTarget, setAgentDeleteTarget] = useState<MissionControlSnapshot["agents"][number] | null>(null);
  const [agentDeleteConfirmText, setAgentDeleteConfirmText] = useState("");
  const [operatorProfile, setOperatorProfile] = useState<OperatorProfileSummary>(emptyOperatorProfile);
  const handledRequestedAgentActionIdRef = useRef<string | null>(null);

  useEffect(() => {
    const controller = new AbortController();

    void fetch("/api/profile", { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        const result = (await response.json()) as OperatorProfileSummary & { error?: string };
        if (!response.ok || result.error) {
          throw new Error(result.error || "Operator profile could not be loaded.");
        }
        setOperatorProfile({
          fullName: result.fullName,
          username: result.username,
          email: result.email,
          avatarDataUrl: result.avatarDataUrl,
          actorId: result.actorId,
          role: result.role,
          status: result.status
        });
      })
      .catch(() => {});

    return () => controller.abort();
  }, []);

  useEffect(() => {
    const syncHash = () => setActiveHash(window.location.hash.replace(/^#/, ""));

    syncHash();
    window.addEventListener("hashchange", syncHash);

    return () => window.removeEventListener("hashchange", syncHash);
  }, []);

  const pendingWorkspaceEntries = useMemo(
    () => {
      const liveWorkspaceIds = new Set(snapshot.workspaces.map((workspace) => workspace.id));
      const pendingAgentWorkspaces = buildPendingWorkspaceMenuEntries(pendingCreatedAgents, liveWorkspaceIds);
      const entries = [...pendingWorkspaceCreations, ...pendingAgentWorkspaces]
        .filter((workspace, index, all) => !liveWorkspaceIds.has(workspace.id) && all.findIndex((entry) => entry.id === workspace.id) === index);

      return entries.sort((left, right) => right.createdAt - left.createdAt || left.name.localeCompare(right.name));
    },
    [pendingCreatedAgents, pendingWorkspaceCreations, snapshot.workspaces]
  );
  const workspaceMenuEntries = useMemo<WorkspaceMenuEntry[]>(
    () => [
      ...snapshot.workspaces.map((workspace, index) => ({
        sortRank: resolveWorkspaceMenuSortRank(workspace, index, snapshot.workspaces.length),
        id: workspace.id,
        name: workspace.name,
        detail: `${workspace.agentIds.length} agents`,
        pending: false as const
      })),
      ...pendingWorkspaceEntries.map((workspace) => ({
        ...workspace,
        sortRank: workspace.createdAt
      }))
    ].sort((left, right) => right.sortRank - left.sortRank || left.name.localeCompare(right.name)),
    [pendingWorkspaceEntries, snapshot.workspaces]
  );
  const workspaceCount = workspaceMenuEntries.length;
  const activePendingWorkspace = activeWorkspaceId
    ? pendingWorkspaceEntries.find((workspace) => workspace.id === activeWorkspaceId) ?? null
    : null;
  const activeWorkspace =
    (activeWorkspaceId
      ? snapshot.workspaces.find((workspace) => workspace.id === activeWorkspaceId)
      : null) ??
    activePendingWorkspace ??
    snapshot.workspaces[0] ??
    null;
  const statusTone = resolveStatusTone(snapshot.diagnostics.health, connectionState);
  const statusLabel =
    connectionState === "live"
      ? "Online"
      : connectionState === "retrying"
        ? "Retrying"
        : "Connecting";
  const handleNavigate = useCallback((item: SidebarItem) => {
    setActiveHash(item.hash ?? "");
  }, []);

  const handleEditAgentOpenChange = (nextOpen: boolean) => {
    setIsEditAgentOpen(nextOpen);
    onAgentActionModalOpenChange?.(nextOpen);

    if (!nextOpen) {
      setEditDraft(null);
      setEditChannelIdsBaseline([]);
      setShowEditIdentityDetails(false);
      setIsEditAgentAdvancedOpen(false);
    }
  };

  const openEditAgent = useCallback((agent: MissionControlSnapshot["agents"][number]) => {
    const nextChannelIds = getWorkspaceChannelIdsForAgent(snapshot, agent.workspaceId, agent.id);

    setEditDraft({
      ...buildAgentDraft(agent.workspaceId, {
        id: agent.id,
        modelId: agent.modelId === "unassigned" ? "" : agent.modelId,
        name: formatAgentDisplayName(agent),
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
    onAgentActionModalOpenChange?.(true);
    setIsEditAgentOpen(true);
  }, [onAgentActionModalOpenChange, snapshot]);

  const openDeleteAgent = useCallback((agent: MissionControlSnapshot["agents"][number]) => {
    setAgentDeleteTarget(agent);
    setAgentDeleteConfirmText("");
    onAgentActionModalOpenChange?.(true);
    setIsDeleteAgentOpen(true);
  }, [onAgentActionModalOpenChange]);

  const closeDeleteAgent = () => {
    setIsDeleteAgentOpen(false);
    onAgentActionModalOpenChange?.(false);
    onAgentActionRequestDismiss?.();
    setAgentDeleteTarget(null);
    setAgentDeleteConfirmText("");
  };

  const handleDeleteAgentOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      if (!isDeletingAgent) {
        closeDeleteAgent();
      }
      return;
    }

    setIsDeleteAgentOpen(true);
    onAgentActionModalOpenChange?.(true);
  };

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

  useEffect(() => {
    if (requestedAgentAction !== null) {
      return;
    }

    setIsDeleteAgentOpen(false);
    setAgentDeleteTarget(null);
    setAgentDeleteConfirmText("");
  }, [requestedAgentAction]);

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

      onSnapshotChange?.((currentSnapshot) => applyEditedAgentDraftToSnapshot(currentSnapshot, editDraft));
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

      closeDeleteAgent();
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

  const showEditAgentHeartbeatControls = editDraft
    ? isEditAgentAdvancedOpen || editDraft.policy.preset === "monitoring"
    : false;

  return (
    <>
      <PikoLoader
        open={isDeletingAgent}
        title="Deleting agent"
        description="Removing the agent and cleaning up its OpenClaw workspace binding."
      />
      <PikoLoader
        open={isSavingAgent}
        title="Saving agent profile"
        description="Updating the profile, policy, and workspace channel bindings."
      />
      {collapsed ? (
        <CollapsedSidebar
          activeHash={activeHash}
          pathname={pathname}
          surfaceTheme={surfaceTheme}
          workspaceLabel={activeWorkspaceId === null ? "All workspaces" : activeWorkspace?.name || "No workspace"}
          workspaceDetail={activeWorkspaceId === null ? `${workspaceCount} workspaces` : activePendingWorkspace ? "Creating workspace" : "Workspace"}
          snapshot={snapshot}
          activeWorkspaceId={activeWorkspace?.id ?? null}
          onRefresh={onRefresh}
          onSnapshotChange={onSnapshotChange}
          onAgentCreationPending={onAgentCreationPending}
          onAgentCreatedVisible={onAgentCreatedVisible}
          onItemNavigate={handleNavigate}
          onExpandCollapsed={onExpandCollapsed ?? onToggleCollapsed}
          operatorProfile={operatorProfile}
        />
      ) : (
        <aside
          className={cn(
            "relative flex h-full w-full flex-col overflow-hidden border-r border-border text-card-foreground shadow-panel",
            surfaceTheme === "light" ? "bg-[#fbf7f3] lg:bg-card" : "bg-card"
          )}
        >
          <div
            aria-hidden="true"
            className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,hsl(var(--foreground)/0.035),transparent_38%),radial-gradient(circle_at_55%_0%,hsl(var(--primary)/0.10),transparent_30%)]"
          />
          <div aria-hidden="true" className="pointer-events-none absolute inset-y-0 right-0 w-px bg-border" />

          <div className="relative flex h-full min-h-0 flex-col px-4 py-5">
            <div className="shrink-0">
              <SidebarBrand
                pinned={sidebarPinned}
                surfaceTheme={surfaceTheme}
                onToggleCollapsed={onToggleCollapsed}
              />

              <WorkspaceSwitcher
                activeWorkspaceId={activeWorkspaceId}
                snapshot={snapshot}
                workspace={activeWorkspace}
                workspaceMenuEntries={workspaceMenuEntries}
                workspaceCount={workspaceCount}
                activeWorkspaceIsPending={Boolean(activePendingWorkspace)}
                hasWorkspaceCreationPending={pendingWorkspaceCreations.length > 0}
                statusLabel={statusLabel}
                statusTone={statusTone}
                onSelectWorkspace={onSelectWorkspace}
                onOpenWorkspaceCreate={onOpenWorkspaceCreate}
                onEditWorkspace={onEditWorkspace}
                onRefresh={onRefresh}
              />

              <SidebarCreateAgentAction
                snapshot={snapshot}
                activeWorkspaceId={activeWorkspace?.id ?? null}
                surfaceTheme={surfaceTheme}
                onRefresh={onRefresh}
                onSnapshotChange={onSnapshotChange}
                onAgentCreationPending={onAgentCreationPending}
                onAgentCreatedVisible={onAgentCreatedVisible}
                onOpenCreateAgent={onOpenCreateAgent}
              />
            </div>

            <nav aria-label="Primary" className="sidebar-scroll mt-6 min-h-0 flex-1 overflow-y-auto overscroll-contain pr-1">
              <div className="flex flex-col gap-5">
                {sidebarSections.map((section) => (
                  <SidebarSectionGroup
                    key={section.id}
                    activeHash={activeHash}
                    pathname={pathname}
                    section={section}
                    onNavigate={handleNavigate}
                  />
                ))}
              </div>
            </nav>

            <SidebarUserMenu
              snapshot={snapshot}
              activeWorkspaceId={activeWorkspaceId}
              surfaceTheme={surfaceTheme}
              operatorProfile={operatorProfile}
              onProfileSaved={setOperatorProfile}
              onRefresh={onRefresh}
              onToggleTheme={onToggleTheme}
            />
          </div>
        </aside>
      )}

      <Dialog open={isDeleteAgentOpen} onOpenChange={handleDeleteAgentOpenChange}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Delete OpenClaw agent</DialogTitle>
            <DialogDescription>
              This removes the selected agent from OpenClaw and detaches its workspace binding.
            </DialogDescription>
          </DialogHeader>

          {agentDeleteTarget ? (
            <div className="flex flex-col gap-4">
              <div className="rounded-[20px] border border-rose-300/55 bg-rose-50/80 px-4 py-3.5 dark:border-rose-400/20 dark:bg-rose-500/[0.08]">
                <div className="flex items-start gap-3">
                  <div className="mt-0.5 rounded-full border border-rose-300/70 bg-rose-100 p-2 text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-200">
                    <AlertTriangle className="h-4 w-4" />
                  </div>
                  <div className="flex flex-col gap-1.5 text-sm text-rose-950 dark:text-rose-50">
                    <p className="font-medium">This action cannot be undone.</p>
                    <p className="text-rose-800 dark:text-rose-100/80">
                      OpenClaw will delete this agent, remove its config entry, remove its manifest record, and clean
                      up agent-specific policy/state files. Shared workspace docs and files will remain.
                    </p>
                  </div>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-3">
                <DeleteMetric
                  label="Status"
                  value={agentDeleteTarget.status}
                  danger={isLiveAgent(agentDeleteTarget)}
                />
                <DeleteMetric
                  label="Runs"
                  value={String(snapshot.runtimes.filter((runtime) => runtime.agentId === agentDeleteTarget.id).length)}
                />
                <DeleteMetric
                  label="Workspace"
                  value={
                    snapshot.workspaces.find((workspace) => workspace.id === agentDeleteTarget.workspaceId)?.name ??
                    "Unknown"
                  }
                />
              </div>

              <div className="rounded-lg border border-border bg-muted/50 px-3.5 py-3">
                <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Agent id</p>
                <p className="mt-1.5 break-all font-mono text-xs text-foreground">{agentDeleteTarget.id}</p>
              </div>

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
              onClick={closeDeleteAgent}
              disabled={isDeletingAgent}
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
              {isDeletingAgent ? "Deleting..." : "Delete agent"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <MissionControlDialogShell
        open={isEditAgentOpen}
        onOpenChange={handleEditAgentOpenChange}
        surfaceTheme={surfaceTheme}
        variant="worker-profile"
        title="Edit agent settings"
        description="Update the existing worker's identity, preset, model, and operating policy."
        icon={Bot}
        chips={
          editDraft ? (
            <>
              <MissionControlDialogChip tone="violet" surfaceTheme={surfaceTheme}>{getAgentPresetMeta(editDraft.policy.preset).label}</MissionControlDialogChip>
              <MissionControlDialogChip tone="muted" surfaceTheme={surfaceTheme}>
                {snapshot.workspaces.find((workspace) => workspace.id === editDraft.workspaceId)?.name || editDraft.workspaceId}
              </MissionControlDialogChip>
            </>
          ) : null
        }
        bodyClassName="px-6 py-5 sm:px-8"
        footer={
          <>
            <Button
              variant="secondary"
              size="sm"
              onClick={() => handleEditAgentOpenChange(false)}
              className={missionControlDialogButtonClassName("secondary", surfaceTheme)}
            >
              Cancel
            </Button>
            <Button
              size="sm"
              onClick={submitEditAgent}
              disabled={isSavingAgent || !editDraft}
              className={missionControlDialogButtonClassName("primary", surfaceTheme)}
            >
              {isSavingAgent ? "Saving..." : "Save changes"}
            </Button>
          </>
        }
      >

          {editDraft ? (
            <div className="grid min-h-0 gap-4 lg:grid-cols-[320px_minmax(0,1fr)]">
              <aside className={missionControlDialogPanelClassName("h-fit p-3.5")}>
                <div className="flex flex-col gap-3">
                  <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Agent preset</p>
                  <div className="grid gap-2">
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

                <div className="mt-3">
                  <AgentPolicySummary policy={editDraft.policy} />
                </div>
              </aside>

              <div className="min-w-0 space-y-3">

              <FormField label="Agent id" htmlFor="edit-agent-id">
                <Input id="edit-agent-id" value={editDraft.id} disabled className={missionControlDialogControlClassName()} />
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
                  className={missionControlDialogControlClassName()}
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
                  className={missionControlDialogControlClassName()}
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
                  className={missionControlDialogControlClassName()}
                >
                  <option value="">Use OpenClaw default</option>
                  {snapshot.models.map((model) => (
                    <option key={model.id} value={model.id}>
                      {model.id}
                    </option>
                  ))}
                </select>
              </FormField>

              <div className={missionControlDialogPanelClassName("p-3.5")}>
                <FormField label="Theme" htmlFor="edit-agent-theme">
                  <AgentThemePicker
                    value={editDraft.theme}
                    surfaceTheme={surfaceTheme}
                    onChange={(theme) =>
                      setEditDraft((current) =>
                        current
                          ? {
                              ...current,
                              theme
                            }
                          : current
                      )
                    }
                  />
                </FormField>

                <button
                  type="button"
                  onClick={() => setShowEditIdentityDetails((current) => !current)}
                  className="mt-3 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.16em] text-slate-500 transition-colors hover:text-slate-300"
                >
                  <ChevronRight
                    className={cn("h-3 w-3 transition-transform duration-200", showEditIdentityDetails && "rotate-90")}
                  />
                  {showEditIdentityDetails ? "Hide" : "Show"} emoji & avatar
                </button>

                {showEditIdentityDetails ? (
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
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
                        className={missionControlDialogControlClassName()}
                      />
                    </FormField>

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
                        className={missionControlDialogControlClassName()}
                      />
                    </FormField>
                  </div>
                ) : null}
              </div>

              <ChannelBindingPicker
                snapshot={snapshot}
                workspaceId={editDraft.workspaceId}
                channelIds={editDraft.channelIds}
                agentId={editDraft.id}
                isSaving={isSavingAgent}
                surfaceTheme="dark"
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

              <div className={missionControlDialogPanelClassName("p-3.5")}>
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
                    className={missionControlDialogButtonClassName("secondary")}
                    onClick={() => setIsEditAgentAdvancedOpen((current) => !current)}
                  >
                    {isEditAgentAdvancedOpen ? "Hide" : "Show"}
                  </Button>
                </div>

                {showEditAgentHeartbeatControls ? (
                  <div className={missionControlDialogPanelClassName("mt-4 p-3.5")}>
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
                        className={missionControlDialogButtonClassName(editDraft.heartbeat.enabled ? "primary" : "secondary")}
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
                            className={missionControlDialogControlClassName()}
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
            </div>
          ) : null}
      </MissionControlDialogShell>
    </>
  );
}

function SidebarBrand({
  pinned,
  surfaceTheme,
  onToggleCollapsed
}: {
  pinned: boolean;
  surfaceTheme: "dark" | "light";
  onToggleCollapsed: () => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <Link
        href="/"
        className="group flex min-w-0 items-center gap-3 rounded-lg outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring/50"
        aria-label="AgentOS Mission Control"
      >
        <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
          <Image
            src={agentOsLogoSrc}
            alt=""
            width={36}
            height={36}
            aria-hidden="true"
            className="h-full w-full object-contain"
            priority
            unoptimized
          />
        </span>
        <span className="truncate py-0.5 font-display text-[1.15rem] font-semibold leading-[1.25] text-foreground">
          Agent<span className="text-primary">OS</span>
        </span>
      </Link>

      <RailTooltip
        label={pinned ? "Close sidebar" : "Keep sidebar open"}
        side="bottom"
        surfaceTheme={surfaceTheme}
      >
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label={pinned ? "Close sidebar" : "Keep sidebar open"}
          aria-pressed={pinned}
          className="inline-flex h-10 w-10 shrink-0 items-center justify-center text-muted-foreground outline-none transition-[color,transform] hover:scale-105 hover:text-foreground focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          <SidebarPanelToggleIcon filled={pinned} />
        </button>
      </RailTooltip>
    </div>
  );
}

function SidebarPanelToggleIcon({ filled }: { filled: boolean }) {
  return (
    <svg
      viewBox="0 0 24 24"
      className="h-6 w-6"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M6.5 4.5H9v15H6.5A2.5 2.5 0 0 1 4 17V7a2.5 2.5 0 0 1 2.5-2.5Z"
        className={cn(
          "transition-colors duration-200",
          filled ? "fill-slate-950 dark:fill-slate-100" : "fill-transparent"
        )}
      />
      <rect x="3.5" y="4.5" width="17" height="15" rx="3" stroke="currentColor" strokeWidth="1.7" />
      <path d="M9 4.75v14.5" stroke="currentColor" strokeWidth="1.7" />
    </svg>
  );
}

function SidebarCreateAgentAction({
  snapshot,
  activeWorkspaceId,
  surfaceTheme,
  collapsed = false,
  onRefresh,
  onSnapshotChange,
  onAgentCreationPending,
  onAgentCreatedVisible,
  onOpenCreateAgent
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  surfaceTheme: "dark" | "light";
  collapsed?: boolean;
  onRefresh: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onAgentCreationPending?: (agent: PendingAgentProjection) => void;
  onAgentCreatedVisible?: (agentId: string) => void;
  onOpenCreateAgent?: () => void;
}) {
  const hasWorkspace = Boolean(activeWorkspaceId ?? snapshot.workspaces[0]?.id);
  const trigger = collapsed ? (
    <button
      type="button"
      disabled={!hasWorkspace}
      aria-label="New Agent"
      title={hasWorkspace ? "New Agent" : "Create a workspace first"}
      onPointerDown={(event) => {
        if (!onOpenCreateAgent || !hasWorkspace) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onOpenCreateAgent();
      }}
      onClick={(event) => {
        if (!onOpenCreateAgent || !hasWorkspace) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onOpenCreateAgent();
      }}
      className="mt-3 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-card/75 text-muted-foreground transition-all hover:bg-accent hover:text-accent-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus className="h-4 w-4" />
    </button>
  ) : (
    <button
      type="button"
      disabled={!hasWorkspace}
      onPointerDown={(event) => {
        if (!onOpenCreateAgent || !hasWorkspace) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onOpenCreateAgent();
      }}
      onClick={(event) => {
        if (!onOpenCreateAgent || !hasWorkspace) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        onOpenCreateAgent();
      }}
      className="mt-4 inline-flex h-10 w-full items-center justify-center gap-2 rounded-md bg-primary px-3.5 text-[0.84rem] font-semibold text-primary-foreground shadow-[0_12px_26px_hsl(var(--primary)/0.18)] transition-all hover:bg-primary/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
    >
      <Plus className="h-[18px] w-[18px]" />
      <span>New Agent</span>
    </button>
  );

  if (onOpenCreateAgent) {
    return trigger;
  }

  return (
    <CreateAgentDialog
      snapshot={snapshot}
      defaultWorkspaceId={activeWorkspaceId ?? undefined}
      onRefresh={onRefresh}
      onSnapshotChange={onSnapshotChange}
      onAgentCreationPending={onAgentCreationPending}
      onAgentCreatedVisible={onAgentCreatedVisible}
      surfaceTheme={surfaceTheme}
      trigger={trigger}
    />
  );
}

function resolveWorkspaceMenuSortRank(
  workspace: Pick<MissionControlSnapshot["workspaces"][number], "createdAt">,
  index: number,
  total: number
) {
  if (typeof workspace.createdAt === "number" && Number.isFinite(workspace.createdAt)) {
    return workspace.createdAt;
  }

  return total - index;
}

function WorkspaceSwitcher({
  activeWorkspaceId,
  snapshot,
  workspace,
  workspaceMenuEntries,
  workspaceCount,
  activeWorkspaceIsPending,
  hasWorkspaceCreationPending,
  statusLabel,
  statusTone,
  onSelectWorkspace,
  onOpenWorkspaceCreate,
  onEditWorkspace,
  onRefresh
}: {
  activeWorkspaceId: string | null;
  snapshot: MissionControlSnapshot;
  workspace: Pick<MissionControlSnapshot["workspaces"][number], "id" | "name"> | PendingWorkspaceMenuEntry | null;
  workspaceMenuEntries: WorkspaceMenuEntry[];
  workspaceCount: number;
  activeWorkspaceIsPending: boolean;
  hasWorkspaceCreationPending: boolean;
  statusLabel: string;
  statusTone: string;
  onSelectWorkspace: (workspaceId: string | null) => void;
  onOpenWorkspaceCreate: () => void;
  onEditWorkspace: (workspaceId: string) => void;
  onRefresh: () => Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [workspaceActionsOpenForId, setWorkspaceActionsOpenForId] = useState<string | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<MissionControlSnapshot["workspaces"][number] | null>(null);
  const [deleteConfirmText, setDeleteConfirmText] = useState("");
  const [isDeletingWorkspace, setIsDeletingWorkspace] = useState(false);
  const [deletingWorkspaceId, setDeletingWorkspaceId] = useState<string | null>(null);
  const deleteImpact = deleteTarget ? getWorkspaceDeleteImpact(snapshot, deleteTarget) : null;
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (deletingWorkspaceId && !snapshot.workspaces.some((entry) => entry.id === deletingWorkspaceId)) {
      setDeletingWorkspaceId(null);
    }
  }, [deletingWorkspaceId, snapshot.workspaces]);

  useEffect(() => {
    if (!open) {
      setWorkspaceActionsOpenForId(null);
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
        setWorkspaceActionsOpenForId(null);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        setWorkspaceActionsOpenForId(null);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  useEffect(() => {
    if (hasWorkspaceCreationPending) {
      setOpen(true);
    }
  }, [hasWorkspaceCreationPending]);

  const requestDeleteWorkspace = (workspaceId: string) => {
    const target = snapshot.workspaces.find((entry) => entry.id === workspaceId) ?? null;

    if (!target) {
      return;
    }

    setDeleteTarget(target);
    setDeleteConfirmText("");
    setWorkspaceActionsOpenForId(null);
    setOpen(false);
  };

  const submitDeleteWorkspace = async () => {
    if (!deleteTarget || deleteConfirmText.trim() !== deleteTarget.id) {
      return;
    }

    const workspaceToDelete = deleteTarget;
    setIsDeletingWorkspace(true);
    setDeletingWorkspaceId(workspaceToDelete.id);
    setDeleteTarget(null);
    setDeleteConfirmText("");
    setOpen(true);

    try {
      const response = await fetch("/api/workspaces", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          workspaceId: workspaceToDelete.id
        })
      });
      const result = (await response.json()) as { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "OpenClaw could not delete the workspace.");
      }

      const remainingWorkspaces = snapshot.workspaces.filter((entry) => entry.id !== workspaceToDelete.id);
      const deletedWorkspaceIndex = snapshot.workspaces.findIndex((entry) => entry.id === workspaceToDelete.id);
      const nextWorkspace =
        remainingWorkspaces[
          Math.min(Math.max(deletedWorkspaceIndex, 0), Math.max(remainingWorkspaces.length - 1, 0))
        ] ?? null;

      if (activeWorkspaceId === workspaceToDelete.id) {
        onSelectWorkspace(nextWorkspace?.id ?? null);
      }

      toast.success("Workspace deleted.", {
        description: workspaceToDelete.name
      });
      void onRefresh().catch(() => {});
    } catch (error) {
      setDeletingWorkspaceId(null);
      toast.error("Workspace deletion failed.", {
        description: error instanceof Error ? error.message : "Unknown workspace error."
      });
    } finally {
      setIsDeletingWorkspace(false);
    }
  };

  return (
    <>
      <PikoLoader
        open={isDeletingWorkspace}
        title="Deleting workspace"
        description="Removing its OpenClaw workspace, agents, runtime references, and managed files."
      />
      <div className="relative mt-5" ref={menuRef}>
      <button
        type="button"
        aria-expanded={open}
        aria-haspopup="menu"
        onClick={() => setOpen((current) => !current)}
        className="group flex w-full items-center gap-3 rounded-lg border border-border bg-card/75 px-3 py-3 text-left shadow-card transition-all hover:border-primary/25 hover:bg-accent/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary">
          <Home className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.95rem] font-semibold leading-5 text-foreground">
            {activeWorkspaceId === null ? "All workspaces" : workspace?.name || "No workspace"}
          </span>
          <span className="mt-0.5 flex items-center gap-1.5 text-[0.63rem] font-semibold uppercase leading-none tracking-[0.22em] text-muted-foreground">
            <StatusDot tone={statusTone} pulse={statusTone === "bg-emerald-400"} className="h-2 w-2" />
            {activeWorkspaceId === null ? `${workspaceCount} workspaces` : activeWorkspaceIsPending ? "Creating workspace" : "Workspace"}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <ChevronDown
            className={cn(
              "h-4 w-4 text-muted-foreground transition-transform group-hover:text-foreground",
              open && "rotate-180"
            )}
          />
          <span className="text-[0.6rem] font-medium text-muted-foreground">{statusLabel}</span>
        </span>
      </button>

      <AnimatePresence initial={false}>
        {open ? (
          <motion.div
            role="menu"
            initial={{ opacity: 0, y: 8, scale: 0.985 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.985 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="absolute left-0 right-0 top-[calc(100%+8px)] z-50 overflow-hidden rounded-xl border border-border/80 bg-popover/95 p-1.5 text-popover-foreground shadow-[0_22px_54px_hsl(var(--background)/0.22),0_0_0_1px_hsl(var(--foreground)/0.03)] backdrop-blur-xl"
          >
            <WorkspaceMenuButton
              label="All workspaces"
              detail={`${workspaceCount} total`}
              selected={activeWorkspaceId === null}
              leadingAdornment={
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                  <Home className="h-3.5 w-3.5" />
                </span>
              }
              onClick={() => {
                onSelectWorkspace(null);
                setOpen(false);
                setWorkspaceActionsOpenForId(null);
              }}
            />

            <div className="workspace-menu-scroll mt-1 flex max-h-[356px] flex-col gap-1 overflow-y-auto pr-1">
              <AnimatePresence initial={false}>
              {workspaceMenuEntries.map((entry, index) => (
                <motion.div
                  key={entry.id}
                  initial={{ opacity: 0, y: 4 }}
                  animate={entry.id === deletingWorkspaceId ? { opacity: [1, 0.58, 1], x: [0, 2, 0] } : { opacity: 1, y: 0 }}
                  exit={{ opacity: 0, height: 0, y: -4 }}
                  transition={entry.id === deletingWorkspaceId ? { duration: 1.15, ease: "easeInOut", repeat: Infinity } : { delay: Math.min(index, 6) * 0.015, duration: 0.14 }}
                >
                  <WorkspaceMenuRow
                    label={entry.name}
                    detail={entry.id === deletingWorkspaceId ? "Deleting workspace" : entry.detail}
                    selected={entry.id === activeWorkspaceId}
                    pending={entry.pending}
                    deleting={entry.id === deletingWorkspaceId}
                    actionsOpen={workspaceActionsOpenForId === entry.id}
                    onClick={() => {
                      if (entry.id === deletingWorkspaceId) return;
                      onSelectWorkspace(entry.id);
                      setOpen(false);
                      setWorkspaceActionsOpenForId(null);
                    }}
                    onToggleActions={
                      entry.pending || isDeletingWorkspace || entry.id === deletingWorkspaceId
                        ? undefined
                        : () => setWorkspaceActionsOpenForId((current) => (current === entry.id ? null : entry.id))
                    }
                    onEdit={
                      entry.pending || isDeletingWorkspace || entry.id === deletingWorkspaceId
                        ? undefined
                        : () => {
                            onEditWorkspace(entry.id);
                            setOpen(false);
                            setWorkspaceActionsOpenForId(null);
                          }
                    }
                    onDelete={entry.pending || isDeletingWorkspace || entry.id === deletingWorkspaceId ? undefined : () => requestDeleteWorkspace(entry.id)}
                  />
                </motion.div>
              ))}
              </AnimatePresence>
            </div>

            <div className="mt-1.5 border-t border-border/70 pt-1.5">
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  onOpenWorkspaceCreate();
                  setOpen(false);
                  setWorkspaceActionsOpenForId(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg border border-transparent px-2.5 py-2 text-left text-primary transition-all hover:border-primary/20 hover:bg-primary/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
              >
                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-primary/20 bg-primary/10 text-primary">
                  <Plus className="h-3.5 w-3.5" />
                </span>
                <span className="min-w-0">
                  <span className="block truncate text-[0.82rem] font-medium">Create Workspace</span>
                  <span className="mt-0.5 block text-[0.67rem] text-muted-foreground">Start a new workspace</span>
                </span>
              </button>
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <Dialog
        open={Boolean(deleteTarget)}
        onOpenChange={(nextOpen) => {
          if (nextOpen || isDeletingWorkspace) {
            return;
          }

          setDeleteTarget(null);
          setDeleteConfirmText("");
        }}
      >
        <DialogContent className="max-w-[min(920px,calc(100vw-1.5rem))] p-0">
          <div className="flex max-h-[min(86vh,760px)] flex-col overflow-hidden">
            <div className="border-b border-border/60 px-5 pt-5">
              <DialogHeader className="space-y-1.5">
                <DialogTitle>Delete workspace</DialogTitle>
                <DialogDescription>
                  This removes the workspace from OpenClaw. Workspace-scoped agents, runtime references, and the
                  folder under this workspace path are cleaned up.
                </DialogDescription>
              </DialogHeader>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
              {deleteTarget ? (
                <div className="flex flex-col gap-4">
                  <div className="rounded-2xl border border-rose-300/70 bg-rose-50 px-3.5 py-3 shadow-sm dark:border-rose-400/20 dark:bg-rose-500/[0.08]">
                    <div className="flex items-start gap-3">
                      <div className="mt-0.5 rounded-full border border-rose-300/70 bg-rose-100 p-1.5 text-rose-700 dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-200">
                        <AlertTriangle className="h-3.5 w-3.5" />
                      </div>
                      <div className="flex flex-1 flex-col gap-2">
                        <p className="text-sm font-semibold text-rose-950 dark:text-rose-50">
                          This action cannot be undone.
                        </p>
                        <p className="text-sm leading-6 text-rose-900/90 dark:text-rose-100/80">
                          OpenClaw will remove {deleteTarget.name}, delete its registered agents, and clean the
                          workspace folder at this path.
                        </p>
                        <div className="flex flex-wrap gap-1.5">
                          <Badge
                            variant="muted"
                            className="bg-rose-100 px-2 py-0.5 text-[11px] text-rose-900 hover:bg-rose-100 dark:bg-rose-400/10 dark:text-rose-100"
                          >
                            {deleteImpact?.agents.length ?? 0} agents
                          </Badge>
                          <Badge
                            variant="muted"
                            className="bg-rose-100 px-2 py-0.5 text-[11px] text-rose-900 hover:bg-rose-100 dark:bg-rose-400/10 dark:text-rose-100"
                          >
                            {deleteImpact?.tasks.length ?? 0} tasks
                          </Badge>
                          <Badge
                            variant="muted"
                            className="bg-rose-100 px-2 py-0.5 text-[11px] text-rose-900 hover:bg-rose-100 dark:bg-rose-400/10 dark:text-rose-100"
                          >
                            {deleteImpact?.sessions.length ?? 0} sessions
                          </Badge>
                          <Badge
                            variant="muted"
                            className="bg-rose-100 px-2 py-0.5 text-[11px] text-rose-900 hover:bg-rose-100 dark:bg-rose-400/10 dark:text-rose-100"
                          >
                            {deleteImpact?.files.length ?? 0} files
                          </Badge>
                        </div>
                      </div>
                    </div>
                  </div>

                  <div className="grid gap-3 md:grid-cols-2">
                    <WorkspaceDeleteListCard
                      title="Agents"
                      count={deleteImpact?.agents.length ?? 0}
                      emptyLabel="No agents are registered to this workspace."
                      items={(deleteImpact?.agents ?? []).map((agent) => ({
                        label: agent.name,
                        detail: agent.id
                      }))}
                    />

                    <WorkspaceDeleteListCard
                      title="Tasks"
                      count={deleteImpact?.tasks.length ?? 0}
                      emptyLabel="No tasks are linked to this workspace."
                      items={(deleteImpact?.tasks ?? []).map((task) => ({
                        label: task.title,
                        detail: task.id
                      }))}
                    />

                    <WorkspaceDeleteListCard
                      title="Sessions"
                      count={deleteImpact?.sessions.length ?? 0}
                      emptyLabel="No sessions are currently tied to this workspace."
                      items={(deleteImpact?.sessions ?? []).map((session) => ({
                        label: session.label,
                        detail: session.detail
                      }))}
                    />

                    <WorkspaceDeleteListCard
                      title="Files"
                      count={deleteImpact?.files.length ?? 0}
                      emptyLabel="No managed files were detected in this workspace."
                      items={(deleteImpact?.files ?? []).map((file) => ({
                        label: file.label,
                        detail: file.detail
                      }))}
                    />
                  </div>

                  <div className="rounded-2xl border border-border/80 bg-card/90 px-3.5 py-3 shadow-sm">
                    <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">Workspace path</p>
                    <p className="mt-1 break-all font-mono text-[11px] text-foreground">{deleteTarget.path}</p>
                  </div>

                  <FormField label={`Type ${deleteTarget.id} to confirm`} htmlFor="delete-workspace-confirm">
                    <Input
                      id="delete-workspace-confirm"
                      value={deleteConfirmText}
                      onChange={(event) => setDeleteConfirmText(event.target.value)}
                      placeholder={deleteTarget.id}
                    />
                  </FormField>
                </div>
              ) : null}
            </div>

            <div className="border-t border-border/60 px-5 py-4">
              <DialogFooter className="sm:justify-end">
                <Button
                  variant="secondary"
                  onClick={() => {
                    setDeleteTarget(null);
                    setDeleteConfirmText("");
                  }}
                  disabled={isDeletingWorkspace}
                >
                  Cancel
                </Button>
                <Button
                  variant="destructive"
                  onClick={() => {
                    void submitDeleteWorkspace();
                  }}
                  disabled={isDeletingWorkspace || !deleteTarget || deleteConfirmText.trim() !== deleteTarget.id}
                >
                  {isDeletingWorkspace ? "Deleting..." : "Delete workspace"}
                </Button>
              </DialogFooter>
            </div>
          </div>
        </DialogContent>
      </Dialog>
      </div>
    </>
  );
}

function WorkspaceMenuButton({
  label,
  detail,
  selected,
  onClick,
  className,
  leadingAdornment,
  endAdornment,
  onEndAdornmentClick,
  disabled = false
}: {
  label: string;
  detail: string;
  selected: boolean;
  onClick: () => void;
  className?: string;
  leadingAdornment?: ReactNode;
  endAdornment?: ReactNode;
  onEndAdornmentClick?: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled={disabled}
      onClick={(event) => {
        if (onEndAdornmentClick) {
          const target = event.target as HTMLElement | null;
          if (target?.closest('[data-workspace-actions-trigger="true"]')) {
            event.preventDefault();
            event.stopPropagation();
            onEndAdornmentClick();
            return;
          }
        }

        onClick();
      }}
      className={cn(
        "flex w-full min-w-0 items-center gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50 disabled:cursor-wait disabled:opacity-80",
        selected
          ? "border-primary/25 bg-primary/10 text-primary shadow-[0_8px_20px_hsl(var(--primary)/0.08)]"
          : "border-transparent text-muted-foreground hover:border-border/80 hover:bg-accent/70 hover:text-accent-foreground",
        className
      )}
    >
      {leadingAdornment}
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[0.82rem] font-medium">{label}</span>
        <span className="mt-0.5 block text-[0.67rem] text-muted-foreground">{detail}</span>
      </span>
      {endAdornment ? (
        <span
          data-workspace-actions-trigger="true"
          className={cn(
            "ml-auto inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors",
            selected
              ? "text-primary hover:bg-primary/10"
              : "text-muted-foreground hover:bg-background/80 hover:text-accent-foreground"
          )}
        >
          {endAdornment}
        </span>
      ) : null}
    </button>
  );
}

function WorkspaceMenuRow({
  label,
  detail,
  selected,
  pending,
  deleting,
  actionsOpen,
  onClick,
  onToggleActions,
  onEdit,
  onDelete
}: {
  label: string;
  detail: string;
  selected: boolean;
  pending: boolean;
  deleting: boolean;
  actionsOpen: boolean;
  onClick: () => void;
  onToggleActions?: () => void;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  const hasActions = !deleting && Boolean(onToggleActions && onEdit && onDelete);

  return (
    <div className="relative">
      <WorkspaceMenuButton
        label={label}
        detail={detail}
        selected={selected}
        disabled={deleting}
        onClick={onClick}
        onEndAdornmentClick={deleting ? undefined : onToggleActions}
        leadingAdornment={<WorkspaceMenuAvatar label={label} pending={pending} deleting={deleting} selected={selected} />}
        endAdornment={deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin text-rose-500" /> : hasActions ? <Settings2 className="h-4 w-4" /> : null}
      />

      <AnimatePresence initial={false}>
        {actionsOpen && onEdit && onDelete ? (
          <motion.div
            initial={{ height: 0, opacity: 0, y: -4 }}
            animate={{ height: "auto", opacity: 1, y: 0 }}
            exit={{ height: 0, opacity: 0, y: -4 }}
            transition={{ duration: 0.16, ease: [0.22, 1, 0.36, 1] }}
            className="overflow-hidden"
          >
            <div
              role="menu"
              className="mx-1 mt-1 grid grid-cols-2 gap-1 rounded-lg border border-border/80 bg-background/[0.88] p-1 text-popover-foreground shadow-[0_14px_34px_hsl(var(--background)/0.20)] backdrop-blur-xl"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              <WorkspaceActionButton icon={Pencil} label="Edit workspace" onClick={onEdit} />
              <WorkspaceActionButton icon={Trash2} label="Delete workspace" destructive onClick={onDelete} />
            </div>
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}

function WorkspaceMenuAvatar({
  label,
  pending,
  deleting,
  selected
}: {
  label: string;
  pending: boolean;
  deleting: boolean;
  selected: boolean;
}) {
  const initial = label.trim().charAt(0).toUpperCase() || "W";

  return (
    <span
      aria-hidden="true"
      className={cn(
        "flex h-7 w-7 shrink-0 items-center justify-center rounded-md border text-[0.68rem] font-semibold",
        selected
          ? "border-primary/25 bg-primary/[0.12] text-primary"
          : "border-border/80 bg-background/70 text-muted-foreground",
        pending && "border-amber-300/30 bg-amber-300/10 text-amber-500 dark:text-amber-200",
        deleting && "border-rose-300/40 bg-rose-500/10 text-rose-500 dark:text-rose-200"
      )}
    >
      {pending || deleting ? <span className="h-1.5 w-1.5 rounded-full bg-current shadow-[0_0_10px_currentColor]" /> : initial}
    </span>
  );
}

function WorkspaceActionButton({
  icon: Icon,
  label,
  destructive = false,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  destructive?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        "flex min-w-0 items-center justify-center gap-1.5 rounded-md px-2 py-1.5 text-center text-[11px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        destructive
          ? "text-rose-600 hover:bg-rose-50 hover:text-rose-700 dark:text-rose-300 dark:hover:bg-rose-400/10 dark:hover:text-rose-100"
          : "text-muted-foreground hover:bg-accent hover:text-accent-foreground"
      )}
    >
      <Icon className="h-3.5 w-3.5 shrink-0" />
      <span className="truncate">{label}</span>
    </button>
  );
}

function WorkspaceDeleteListCard({
  title,
  count,
  emptyLabel,
  items
}: {
  title: string;
  count: number;
  emptyLabel: string;
  items: Array<{
    label: string;
    detail: string;
  }>;
}) {
  const previewItems = items.slice(0, 2);
  const overflowCount = Math.max(items.length - previewItems.length, 0);
  const detailText =
    previewItems.length > 0
      ? "Preview of items linked to this workspace."
      : emptyLabel;

  return (
    <section className="rounded-2xl border border-border/80 bg-card/90 px-3.5 py-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{detailText}</p>
        </div>
        <Badge variant="muted" className="shrink-0 bg-muted px-2 py-0.5 text-[11px] text-foreground hover:bg-muted">
          {count}
        </Badge>
      </div>

      <div className="mt-2.5 flex flex-col gap-1.5">
        {previewItems.length > 0 ? (
          previewItems.map((item) => (
            <div
              key={`${title}:${item.detail}:${item.label}`}
              className="rounded-xl border border-border/70 bg-background px-2.5 py-2"
            >
              <p className="text-[13px] font-medium leading-5 text-foreground">{item.label}</p>
              <p className="mt-0.5 break-all text-[10px] leading-4 text-muted-foreground">{item.detail}</p>
            </div>
          ))
        ) : (
          <div className="rounded-xl border border-dashed border-border/70 bg-muted/30 px-2.5 py-2 text-xs text-muted-foreground">
            {emptyLabel}
          </div>
        )}

        {overflowCount > 0 ? (
          <p className="text-[11px] text-muted-foreground">+{overflowCount} more</p>
        ) : null}
      </div>
    </section>
  );
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return Array.from(
    new Set(
      values
        .map((value) => value?.trim())
        .filter((value): value is string => Boolean(value))
    )
  );
}

function getWorkspaceDeleteImpact(
  snapshot: MissionControlSnapshot,
  workspace: MissionControlSnapshot["workspaces"][number]
) {
  const agents = snapshot.agents
    .filter((agent) => agent.workspaceId === workspace.id)
    .slice()
    .sort((left, right) => left.name.localeCompare(right.name));
  const tasks = snapshot.tasks
    .filter((task) => task.workspaceId === workspace.id)
    .slice()
    .sort((left, right) => {
      const leftUpdatedAt = left.updatedAt ?? 0;
      const rightUpdatedAt = right.updatedAt ?? 0;

      if (leftUpdatedAt !== rightUpdatedAt) {
        return rightUpdatedAt - leftUpdatedAt;
      }

      return left.title.localeCompare(right.title);
    });
  const runtimes = snapshot.runtimes
    .filter((runtime) => runtime.workspaceId === workspace.id)
    .slice()
    .sort((left, right) => {
      const leftUpdatedAt = left.updatedAt ?? 0;
      const rightUpdatedAt = right.updatedAt ?? 0;

      if (leftUpdatedAt !== rightUpdatedAt) {
        return rightUpdatedAt - leftUpdatedAt;
      }

      return left.title.localeCompare(right.title);
    });
  const sessions = uniqueStrings(
    runtimes.map((runtime) => runtime.sessionId?.trim() || runtime.id.trim()).filter(Boolean)
  ).map((sessionId) => {
    const runtime = runtimes.find((entry) => (entry.sessionId?.trim() || entry.id.trim()) === sessionId) ?? null;

    return {
      label: sessionId,
      detail: runtime ? runtime.title : "Workspace session"
    };
  });
  const files = collectWorkspaceDeleteFiles(workspace);

  return {
    agents,
    tasks,
    runtimes,
    sessions,
    files
  };
}

function collectWorkspaceDeleteFiles(workspace: MissionControlSnapshot["workspaces"][number]) {
  const groups: Array<{
    label: string;
    items: Array<{ id: string; label: string; present: boolean }>;
  }> = [
    {
      label: "Core files",
      items: workspace.bootstrap.coreFiles
    },
    {
      label: "Optional files",
      items: workspace.bootstrap.optionalFiles
    },
    {
      label: "Context files",
      items: workspace.bootstrap.contextFiles ?? []
    },
    {
      label: "Folders",
      items: workspace.bootstrap.folders
    },
    {
      label: "Project shell",
      items: workspace.bootstrap.projectShell
    }
  ];

  return groups
    .flatMap((group) =>
      group.items
        .filter((item) => item.present)
        .map((item) => ({
          label: `${group.label}: ${item.label}`,
          detail: item.id
        }))
    )
    .sort((left, right) => left.label.localeCompare(right.label));
}

function SidebarSectionGroup({
  activeHash,
  onNavigate,
  pathname,
  section
}: {
  activeHash: string;
  onNavigate: (item: SidebarItem) => void;
  pathname: string;
  section: { id: SidebarSection; label: string };
}) {
  return (
    <section className="flex flex-col gap-2" aria-labelledby={`sidebar-${section.id}`}>
      <h2
        id={`sidebar-${section.id}`}
        className="px-2 text-[0.64rem] font-semibold uppercase leading-none tracking-[0.22em] text-muted-foreground"
      >
        {section.label}
      </h2>
      <div className="flex flex-col gap-1">
        {sidebarItems
          .filter((item) => item.section === section.id)
          .map((item) => (
            <SidebarNavItem
              key={item.label}
              item={item}
              active={isSidebarItemActive(item, pathname, activeHash)}
              onNavigate={() => onNavigate(item)}
            />
          ))}
      </div>
    </section>
  );
}

function SidebarNavItem({
  item,
  active,
  onNavigate
}: {
  item: SidebarItem;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = item.icon;

  return (
    <Link
      href={item.href ?? "#"}
      scroll={item.href?.startsWith("/settings#") ? false : undefined}
      aria-current={active ? "page" : undefined}
      onClick={onNavigate}
      className={cn(
        "group relative flex h-10 items-center gap-3 rounded-lg border px-3 text-[0.84rem] font-medium outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50",
        active
          ? "border-primary/30 bg-primary/10 text-primary shadow-[0_0_0_1px_hsl(var(--primary)/0.05),0_12px_28px_hsl(var(--primary)/0.08)]"
          : "border-transparent text-muted-foreground hover:border-border hover:bg-accent hover:text-accent-foreground"
      )}
    >
      {active ? (
        <span className="absolute left-0 top-2 h-6 w-1 rounded-r-full bg-primary shadow-[0_0_14px_hsl(var(--primary)/0.24)]" />
      ) : null}
      <Icon className={cn("h-[1.05rem] w-[1.05rem] shrink-0", active ? "text-primary" : "text-muted-foreground group-hover:text-accent-foreground")} />
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {typeof item.badge === "number" ? (
        <Badge className="ml-auto flex h-5 min-w-5 justify-center px-1.5 py-0 text-[0.64rem] tracking-normal">
          {item.badge}
        </Badge>
      ) : null}
    </Link>
  );
}

function SidebarUserMenu({
  snapshot,
  activeWorkspaceId,
  surfaceTheme,
  operatorProfile,
  onProfileSaved,
  onRefresh,
  onToggleTheme
}: {
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  surfaceTheme: "dark" | "light";
  operatorProfile: OperatorProfileSummary;
  onProfileSaved: (profile: OperatorProfileSummary) => void;
  onRefresh: () => Promise<void>;
  onToggleTheme: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [connectOpen, setConnectOpen] = useState(false);
  const [protectionOpen, setProtectionOpen] = useState(false);
  const [userManagementOpen, setUserManagementOpen] = useState(false);
  const { status: protectionStatus, lock } = useInstanceProtection();
  const menuRef = useRef<HTMLDivElement | null>(null);
  const displayName = resolveOperatorDisplayName(operatorProfile);
  const displayDetail = resolveOperatorDisplayDetail(operatorProfile);

  useEffect(() => {
    if (!open) {
      return;
    }

    const handlePointerDown = (event: PointerEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
      }
    };

    window.addEventListener("pointerdown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);

    return () => {
      window.removeEventListener("pointerdown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  return (
    <>
      <div ref={menuRef} className="relative mt-4 shrink-0 border-t border-border pt-4">
      <AnimatePresence>
        {open ? (
          <motion.div
            initial={{ opacity: 0, y: 8, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.16, ease: "easeOut" }}
            className="absolute bottom-[calc(100%+10px)] left-0 z-30 w-full overflow-hidden rounded-2xl border border-border bg-card p-2 text-card-foreground shadow-[0_20px_50px_hsl(var(--foreground)/0.16)]"
            role="menu"
            aria-label="User menu"
          >
            <div className="flex items-center gap-3 px-2.5 py-2.5">
              <UserAvatar profile={operatorProfile} />
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-foreground">{displayName}</p>
                <p className="truncate text-xs text-muted-foreground">{displayDetail}</p>
              </div>
            </div>

            <div className="my-1.5 h-px bg-border" />
            <SidebarUserMenuAction
              icon={Plug}
              label="Connect"
              onSelect={() => {
                setOpen(false);
                setConnectOpen(true);
              }}
            />
            <SidebarUserMenuAction
              icon={UserRound}
              label="Profile"
              onSelect={() => {
                setOpen(false);
                setProfileOpen(true);
              }}
            />
            {operatorProfile.role === "owner" ? (
              <SidebarUserMenuAction
                icon={Users}
                label="Manage users"
                onSelect={() => {
                  setOpen(false);
                  setUserManagementOpen(true);
                }}
              />
            ) : null}
            <SidebarUserMenuLink href="/settings" icon={Settings2} label="Settings" onNavigate={() => setOpen(false)} />
            <SidebarThemeMenuAction surfaceTheme={surfaceTheme} onToggle={onToggleTheme} />
            <SidebarUserMenuAction
              icon={ShieldCheck}
              label="Login & Protection"
              onSelect={() => {
                setOpen(false);
                setProtectionOpen(true);
              }}
            />
            {protectionStatus?.protectionEnabled ? (
              <SidebarUserMenuAction
                icon={LockKeyhole}
                label="Lock AgentOS"
                onSelect={() => {
                  setOpen(false);
                  void lock().catch(() => toast.error("AgentOS could not be locked."));
                }}
              />
            ) : null}
            <div className="my-1.5 h-px bg-border" />
            <SidebarUserMenuDisabled icon={LifeBuoy} label="Help" reason="Help center is coming soon" />
            {protectionStatus?.protectionEnabled ? (
              <SidebarUserMenuAction
                icon={LogOut}
                label="Log out"
                onSelect={() => {
                  setOpen(false);
                  void lock().catch(() => toast.error("AgentOS could not be locked."));
                }}
              />
            ) : (
              <SidebarUserMenuDisabled icon={LogOut} label="Log out" reason="Authentication is not configured" />
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>

      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "flex w-full items-center gap-3 rounded-xl border px-2.5 py-2 text-left outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50",
          open
            ? "border-primary/25 bg-primary/10"
            : "border-transparent bg-muted/55 hover:border-border hover:bg-accent"
        )}
      >
        <UserAvatar profile={operatorProfile} />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[0.84rem] font-semibold text-foreground">{displayName}</span>
          <span className="block truncate text-xs text-muted-foreground">{displayDetail}</span>
        </span>
        <ChevronRight className={cn("h-4 w-4 shrink-0 text-muted-foreground transition-transform", open && "-rotate-90")} />
      </button>
      </div>
      <UserProfileDialog
        open={profileOpen}
        onOpenChange={setProfileOpen}
        snapshot={snapshot}
        activeWorkspaceId={activeWorkspaceId}
        onProfileSaved={onProfileSaved}
      />
      <ConnectChannelsDialog
        open={connectOpen}
        onOpenChange={setConnectOpen}
        snapshot={snapshot}
        activeWorkspaceId={activeWorkspaceId}
        onRefresh={onRefresh}
      />
      <InstanceProtectionDialog open={protectionOpen} onOpenChange={setProtectionOpen} />
      <UserManagementDialog open={userManagementOpen} onOpenChange={setUserManagementOpen} />
    </>
  );
}

function SidebarThemeMenuAction({
  surfaceTheme,
  onToggle
}: {
  surfaceTheme: "dark" | "light";
  onToggle: () => void;
}) {
  const isDark = surfaceTheme === "dark";
  const Icon = isDark ? Moon : SunMedium;

  return (
    <button
      type="button"
      role="menuitemcheckbox"
      aria-checked={isDark}
      aria-label={`Appearance: ${isDark ? "dark" : "light"} theme. Switch to ${isDark ? "light" : "dark"} theme`}
      onClick={onToggle}
      className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
      <span>Appearance</span>
      <span className="ml-auto text-xs font-medium text-muted-foreground">{isDark ? "Dark" : "Light"}</span>
      <span
        aria-hidden="true"
        className={cn(
          "relative h-5 w-9 shrink-0 rounded-full border transition-colors",
          isDark ? "border-primary/40 bg-primary/80" : "border-border bg-muted"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform",
            isDark ? "translate-x-[17px]" : "translate-x-0.5"
          )}
        />
      </span>
    </button>
  );
}

function UserAvatar({ profile }: { profile: OperatorProfileSummary }) {
  const displayName = resolveOperatorDisplayName(profile);
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase())
    .join("");

  return (
    <span className="relative flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-[linear-gradient(145deg,hsl(var(--primary)),hsl(var(--primary)/0.55))] text-xs font-semibold text-primary-foreground shadow-[inset_0_0_0_1px_hsl(var(--primary-foreground)/0.16)]">
      {profile.avatarDataUrl ? (
        <Image
          src={profile.avatarDataUrl}
          alt={`${displayName} profile photo`}
          width={36}
          height={36}
          className="h-full w-full object-cover"
          unoptimized
        />
      ) : initials && displayName !== "User" ? (
        <span aria-hidden="true">{initials}</span>
      ) : (
        <UserRound className="h-[18px] w-[18px]" aria-hidden="true" />
      )}
    </span>
  );
}

function resolveOperatorDisplayName(profile: OperatorProfileSummary) {
  return profile.fullName.trim() || profile.username.trim() || "User";
}

function resolveOperatorDisplayDetail(profile: OperatorProfileSummary) {
  return profile.email.trim() || (profile.username.trim() ? `@${profile.username.trim()}` : "Personal account");
}

function SidebarUserMenuLink({
  href,
  icon: Icon,
  label,
  onNavigate
}: {
  href: string;
  icon: LucideIcon;
  label: string;
  onNavigate: () => void;
}) {
  return (
    <Link
      href={href}
      role="menuitem"
      onClick={onNavigate}
      className="flex h-10 items-center gap-3 rounded-lg px-2.5 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
      <span>{label}</span>
    </Link>
  );
}

function SidebarUserMenuAction({
  icon: Icon,
  label,
  onSelect
}: {
  icon: LucideIcon;
  label: string;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onSelect}
      className="flex h-10 w-full items-center gap-3 rounded-lg px-2.5 text-left text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
    >
      <Icon className="h-[18px] w-[18px] shrink-0 text-muted-foreground" />
      <span>{label}</span>
    </button>
  );
}

function SidebarUserMenuDisabled({
  icon: Icon,
  label,
  reason
}: {
  icon: LucideIcon;
  label: string;
  reason: string;
}) {
  return (
    <button
      type="button"
      role="menuitem"
      disabled
      title={reason}
      className="flex h-10 w-full cursor-not-allowed items-center gap-3 rounded-lg px-2.5 text-left text-sm font-medium text-muted-foreground opacity-55"
    >
      <Icon className="h-[18px] w-[18px] shrink-0" />
      <span>{label}</span>
      <span className="ml-auto text-[0.6rem] uppercase tracking-[0.12em]">Soon</span>
    </button>
  );
}

function CollapsedSidebar({
  activeHash,
  pathname,
  surfaceTheme,
  workspaceLabel,
  workspaceDetail,
  snapshot,
  activeWorkspaceId,
  onRefresh,
  onSnapshotChange,
  onAgentCreationPending,
  onAgentCreatedVisible,
  onOpenCreateAgent,
  onItemNavigate,
  onExpandCollapsed,
  operatorProfile
}: {
  activeHash: string;
  pathname: string;
  surfaceTheme: "dark" | "light";
  workspaceLabel: string;
  workspaceDetail: string;
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  onRefresh: () => Promise<void>;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onAgentCreationPending?: (agent: PendingAgentProjection) => void;
  onAgentCreatedVisible?: (agentId: string) => void;
  onOpenCreateAgent?: () => void;
  onItemNavigate: (item: SidebarItem) => void;
  onExpandCollapsed: () => void;
  operatorProfile: OperatorProfileSummary;
}) {
  return (
    <aside className="relative flex h-full w-full flex-col items-center overflow-hidden border-r border-border bg-card px-1 py-4 text-card-foreground shadow-panel">
      <button
        type="button"
        onClick={onExpandCollapsed}
        aria-label="Expand sidebar"
        className="flex h-10 w-10 items-center justify-center transition-transform hover:scale-105 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
      >
        <Image
          src={agentOsLogoSrc}
          alt=""
          width={40}
          height={40}
          aria-hidden="true"
          className="h-full w-full object-contain"
          priority
          unoptimized
        />
      </button>

      <RailTooltip
        label={`${workspaceLabel} - ${workspaceDetail}`}
        side="right"
        surfaceTheme={surfaceTheme}
      >
        <button
          type="button"
          onClick={onExpandCollapsed}
          aria-label={`Expand workspace selector: ${workspaceLabel}`}
          className="mt-5 inline-flex h-10 w-10 items-center justify-center rounded-lg border border-primary/20 bg-primary/10 text-primary outline-none transition-all hover:border-primary/30 hover:bg-primary/15 focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <Home className="h-4 w-4" />
        </button>
      </RailTooltip>

      <RailTooltip label="New Agent" side="right" surfaceTheme={surfaceTheme}>
        <SidebarCreateAgentAction
          snapshot={snapshot}
          activeWorkspaceId={activeWorkspaceId}
          surfaceTheme={surfaceTheme}
          collapsed
          onRefresh={onRefresh}
          onSnapshotChange={onSnapshotChange}
          onAgentCreationPending={onAgentCreationPending}
          onAgentCreatedVisible={onAgentCreatedVisible}
          onOpenCreateAgent={onOpenCreateAgent}
        />
      </RailTooltip>

      <nav aria-label="Primary" className="sidebar-scroll mt-6 flex min-h-0 w-12 flex-1 flex-col items-center gap-4 overflow-y-auto overscroll-contain">
        {sidebarSections.map((section) => (
          <div key={section.id} className="flex flex-col items-center gap-1.5">
            {collapsedSidebarItems
              .filter((item) => item.section === section.id)
              .map((item) => {
                const active = isSidebarItemActive(item, pathname, activeHash);
                const Icon = item.icon;

                return (
                  <RailTooltip
                    key={item.label}
                    label={item.label}
                    side="right"
                    surfaceTheme={surfaceTheme}
                  >
                    <Link
                      href={item.href ?? "#"}
                      scroll={item.href?.startsWith("/settings#") ? false : undefined}
                      aria-label={item.label}
                      aria-current={active ? "page" : undefined}
                      onClick={() => {
                        onItemNavigate(item);
                      }}
                      className={cn(
                        "relative inline-flex h-10 w-10 items-center justify-center rounded-lg border outline-none transition-all focus-visible:ring-2 focus-visible:ring-ring/50",
                        active
                          ? "border-primary/30 bg-primary text-primary-foreground shadow-[0_14px_30px_hsl(var(--primary)/0.20)]"
                          : "border-border bg-card/75 text-muted-foreground hover:bg-accent hover:text-accent-foreground"
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {typeof item.badge === "number" ? (
                        <span className="absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-card bg-primary px-1 text-[0.58rem] font-bold leading-none text-primary-foreground shadow-card">
                          {item.badge}
                        </span>
                      ) : null}
                    </Link>
                  </RailTooltip>
                );
              })}
          </div>
        ))}
      </nav>

      <RailTooltip label={resolveOperatorDisplayName(operatorProfile)} side="right" surfaceTheme={surfaceTheme}>
        <button
          type="button"
          onClick={onExpandCollapsed}
          aria-label="Expand sidebar to user menu"
          className="mt-4 inline-flex h-12 w-12 shrink-0 items-center justify-center rounded-xl border border-transparent bg-muted/65 outline-none transition-all hover:border-border hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <UserAvatar profile={operatorProfile} />
        </button>
      </RailTooltip>
    </aside>
  );
}

function isSidebarItemActive(item: SidebarItem, pathname: string, activeHash: string) {
  if (item.label === "Mission Control") {
    return pathname === "/" && !activeHash;
  }

  if (item.label === "Dashboard") {
    return pathname === "/dashboard";
  }

  if (item.href && !item.hash && item.href !== "/" && !item.href.startsWith("/settings")) {
    return pathname === item.href || pathname.startsWith(`${item.href}/`);
  }

  if (item.href?.startsWith("/settings")) {
    if (pathname !== "/settings") {
      return false;
    }

    if (item.hash) {
      return activeHash === item.hash;
    }

    return !activeHash || activeHash === "settings";
  }

  return pathname === "/" && Boolean(item.hash) && activeHash === item.hash;
}

function resolveStatusTone(
  health: MissionControlSnapshot["diagnostics"]["health"],
  connectionState: "connecting" | "live" | "retrying"
) {
  if (connectionState === "live" && health === "healthy") {
    return "bg-emerald-400";
  }

  if (connectionState === "retrying" || health === "degraded") {
    return "bg-amber-300";
  }

  return "bg-rose-300";
}

function isLiveAgent(agent: MissionControlSnapshot["agents"][number]) {
  return agent.status === "engaged" || agent.status === "monitoring" || agent.status === "ready";
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
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={htmlFor} className="text-[10px] uppercase tracking-[0.18em] text-slate-500">
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
        "rounded-[8px] border p-3 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-violet-300/35",
        active
          ? "border-violet-300/32 bg-violet-500/14 text-violet-50"
          : "border-white/10 bg-white/[0.035] text-slate-200 hover:border-white/16 hover:bg-white/[0.055]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex flex-col gap-1">
          <p className="text-[12px] font-medium text-white">{label}</p>
          <p className="text-[11px] leading-4 text-slate-400">{description}</p>
        </div>
        <Badge variant={badgeVariant}>{active ? "selected" : "preset"}</Badge>
      </div>
    </button>
  );
}

function AgentPolicySummary({ policy }: { policy: AgentPolicy }) {
  const presetMeta = getAgentPresetMeta(policy.preset);

  return (
    <div className={missionControlDialogPanelClassName("p-3")}>
      <div className="flex items-center justify-between gap-3">
        <div>
          <p className="text-[12px] font-medium text-white">{presetMeta.label}</p>
          <p className="mt-1 text-[11px] leading-4 text-slate-400">{presetMeta.description}</p>
        </div>
        <Badge variant={presetMeta.badgeVariant}>{presetMeta.label}</Badge>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
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
        className={missionControlDialogControlClassName()}
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
        danger ? "border-amber-300/20 bg-amber-400/[0.08]" : "border-border bg-muted/40"
      )}
    >
      <p className="text-[10px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className={cn("mt-1.5 font-display text-lg", danger ? "text-amber-100" : "text-foreground")}>{value}</p>
    </div>
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

function applyEditedAgentDraftToSnapshot(snapshot: MissionControlSnapshot, draft: AgentDraft): MissionControlSnapshot {
  return {
    ...snapshot,
    agents: snapshot.agents.map((agent) => {
      if (agent.id !== draft.id) {
        return agent;
      }

      const name = draft.name.trim() || formatAgentDisplayName(agent);
      const modelId = draft.modelId.trim() || agent.modelId || "unassigned";
      const emoji = draft.emoji.trim();
      const theme = draft.theme.trim();
      const avatar = draft.avatar.trim();

      return {
        ...agent,
        name,
        identityName: name,
        modelId,
        policy: draft.policy,
        heartbeat: {
          enabled: Boolean(draft.heartbeat.enabled),
          every: draft.heartbeat.enabled ? draft.heartbeat.every || null : null,
          everyMs: agent.heartbeat.everyMs ?? null
        },
        identity: {
          ...agent.identity,
          emoji: emoji || undefined,
          theme: theme || undefined,
          avatar: avatar || undefined
        }
      };
    })
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
