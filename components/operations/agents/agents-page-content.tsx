"use client";

import { useMemo, useState, type CSSProperties, type Dispatch, type SetStateAction } from "react";
import Link from "next/link";
import { Activity, ArrowLeft, Bot, CircleCheck, Clock3, Chrome, Filter, Folder, Globe2, Import, MessageSquare, Play, Plus, Plug, ShieldCheck, SlidersHorizontal, Sparkles, Terminal } from "lucide-react";

import { AddModelsDialog } from "@/components/mission-control/add-models/add-models-dialog";
import { AccountIcon } from "@/components/mission-control/account-icon";
import { AgentCapabilityEditorDialog } from "@/components/mission-control/agent-capability-editor-dialog";
import { AgentChatDrawer } from "@/components/mission-control/agent-chat-drawer";
import { AgentModelPickerDialog } from "@/components/mission-control/agent-model-picker-dialog";
import { resolveAgentStatusDotTone } from "@/components/mission-control/node-visual-tones";
import { WorkerProfileDialog } from "@/components/operations/agents/worker-profile-dialog";
import { resolveAgentProfileVisual } from "@/components/mission-control/agent-profile-visuals";
import { CreateAgentDialog } from "@/components/mission-control/create-agent-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import { useAccountsData } from "@/components/operations/accounts/use-accounts-data";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { AccountAccessRuleView } from "@/lib/agentos/account-access-policy-types";
import type { AccountLoginTargetView } from "@/lib/agentos/account-login-target-types";
import { cn } from "@/lib/utils";
import type { LucideIcon } from "lucide-react";
import {
  buildAgentViews,
  formatBigNumber,
  statusToneForAgentFilter,
  summarizeTokens,
  type AgentFilter,
  type AgentView
} from "@/components/operations/operations-data";
import { EmptyState, EntityIcon, FilterChip, InspectorPanelFrame, KeyValue, MoreButton, OperationsPageLayout, PageHeader, SearchToolbar, SectionCard, StatCard, StatGrid, StatusBadge, ToolbarButton, ViewToggle, type StatusTone } from "@/components/operations/operations-ui";
import { agentFilterLabel, formatAgentDisplayNameFromRecord, formatAgentSortLabel, MissionDispatchDialog, readClientError, sortAgentViews, toTitleCase } from "@/components/operations/operations-shared";

export function AgentsPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspaceId,
  surfaceTheme,
  refresh,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  surfaceTheme: "dark" | "light";
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
}) {
  const agents = useMemo(
    () => buildAgentViews(snapshot),
    [snapshot]
  );
  const { loginTargets, accessRules } = useAccountsData(activeWorkspaceId);
  const [search, setSearch] = useState("");
  const [filter, setFilter] = useState<AgentFilter>("all");
  const [sort, setSort] = useState<"last-active" | "name" | "status" | "workspace">("last-active");
  const [view, setView] = useState<"grid" | "list">("grid");
  const [selectedId, setSelectedId] = useState(agents[0]?.id ?? "");
  const [chatAgentId, setChatAgentId] = useState<string | null>(null);
  const [modelAgentId, setModelAgentId] = useState<string | null>(null);
  const [profileAgentId, setProfileAgentId] = useState<string | null>(null);
  const [capabilityAgentId, setCapabilityAgentId] = useState<string | null>(null);
  const [capabilityFocus, setCapabilityFocus] = useState<"skills" | "tools">("skills");
  const [dispatchAgent, setDispatchAgent] = useState<AgentView | null>(null);
  const [deletingAgentId, setDeletingAgentId] = useState<string | null>(null);
  const [isAddModelsDialogOpen, setIsAddModelsDialogOpen] = useState(false);

  const filteredAgents = agents.filter((agent) => {
    const query = search.trim().toLowerCase();
    const matchesSearch =
      !query ||
      [agent.name, agent.purpose, agent.modelLabel, agent.policyLabel, agent.workspaceName]
        .join(" ")
        .toLowerCase()
        .includes(query);
    const matchesFilter = filter === "all" || agent.status === filter;
    return matchesSearch && matchesFilter;
  }).sort((left, right) => sortAgentViews(left, right, sort));
  const selectedAgent = filteredAgents.find((agent) => agent.id === selectedId) ?? filteredAgents[0] ?? null;
  const chatAgent = chatAgentId ? rootSnapshot.agents.find((agent) => agent.id === chatAgentId) ?? null : null;
  const runningCount = agents.filter((agent) => agent.status === "running").length;
  const readyCount = agents.filter((agent) => agent.status === "ready").length;
  const idleCount = agents.filter((agent) => agent.status === "idle").length;
  const approvalCount = agents.filter((agent) => agent.status === "needs-approval").length;
  const tokenTotal = summarizeTokens(snapshot);
  const filterCounts: Record<AgentFilter, number> = {
    all: agents.length,
    ready: readyCount,
    running: runningCount,
    idle: idleCount,
    "needs-approval": approvalCount
  };
  const sortModes: Array<typeof sort> = ["last-active", "name", "status", "workspace"];

  const openCapabilityEditor = (agentId: string, focus: "skills" | "tools") => {
    setCapabilityAgentId(agentId);
    setCapabilityFocus(focus);
  };

  const deleteAgent = async (agent: AgentView) => {
    if (!agent.source) {
      toast.message("Delete is unavailable.", {
        description: "This row is not backed by an AgentOS agent record."
      });
      return;
    }

    if (!window.confirm(`Delete ${agent.name}? This removes the OpenClaw agent from AgentOS.`)) {
      return;
    }

    setDeletingAgentId(agent.id);

    try {
      const response = await fetch("/api/agents", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ agentId: agent.source.id })
      });
      const result = await response.json().catch(() => null) as { error?: string } | null;
      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Agent deletion failed.");
      }
      toast.success("Agent deleted.");
      setSelectedId("");
      await refresh();
    } catch (error) {
      toast.error("Agent deletion failed.", {
        description: readClientError(error)
      });
    } finally {
      setDeletingAgentId(null);
    }
  };

  return (
    <>
      <PikoLoader
        open={Boolean(deletingAgentId)}
        title="Deleting agent"
        description="Removing the agent and cleaning up its OpenClaw workspace binding."
      />
      <OperationsPageLayout
        main={
          <>
          <PageHeader
            surfaceTheme={surfaceTheme}
            title="Agents"
            subtitle="Manage your AI workforce. Monitor health, configure capabilities, and run agents at scale."
            actions={
              <>
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-8 rounded-lg px-3 text-xs"
                  disabled
                  title="Agent import requires a backend import contract."
                >
                  <Import className="mr-1.5 h-3.5 w-3.5" />
                  Import Agent
                </Button>
                <CreateAgentDialog
                  snapshot={rootSnapshot}
                  defaultWorkspaceId={activeWorkspaceId}
                  onRefresh={refresh}
                  onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
                  onAgentCreated={setSelectedId}
                  onAgentCreatedVisible={setSelectedId}
                  surfaceTheme={surfaceTheme}
                  trigger={
                    <Button
                      size="sm"
                      className="h-8 rounded-lg px-3 text-xs"
                    >
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Create Agent
                    </Button>
                  }
                />
              </>
            }
          />

          <StatGrid columns={5}>
            <StatCard label="Total Agents" value={String(agents.length)} detail={`${snapshot.workspaces.length} workspaces`} icon={Bot} tone="info" />
            <StatCard label="Active" value={String(runningCount)} detail={`${Math.round((runningCount / Math.max(1, agents.length)) * 100)}% of total`} icon={Activity} tone="success" />
            <StatCard label="Idle" value={String(idleCount)} detail={`${Math.round((idleCount / Math.max(1, agents.length)) * 100)}% of total`} icon={Clock3} tone="warning" />
            <StatCard label="Needs Approval" value={String(approvalCount)} detail={`${Math.round((approvalCount / Math.max(1, agents.length)) * 100)}% of total`} icon={ShieldCheck} tone="danger" />
            <StatCard label="Runtime Tokens" value={formatBigNumber(tokenTotal)} detail={tokenTotal ? "From live runtimes" : "No runtime token usage reported"} icon={Sparkles} tone="purple" />
          </StatGrid>

          <SearchToolbar
            search={search}
            onSearchChange={setSearch}
            searchPlaceholder="Search agents..."
            surfaceTheme={surfaceTheme}
            right={<ViewToggle value={view} onChange={setView} surfaceTheme={surfaceTheme} />}
          >
            <ToolbarButton surfaceTheme={surfaceTheme} icon={Filter} label={`Filter: ${agentFilterLabel(filter)}`} active={filter !== "all"} onClick={() => setFilter("all")} />
            <ToolbarButton surfaceTheme={surfaceTheme} icon={SlidersHorizontal} label={`Sort: ${formatAgentSortLabel(sort)}`} chevron onClick={() => setSort((current) => sortModes[(sortModes.indexOf(current) + 1) % sortModes.length])} />
          </SearchToolbar>

          <div className="flex flex-wrap items-center gap-2">
            {(["all", "ready", "running", "idle", "needs-approval"] as AgentFilter[]).map((id) => (
              <FilterChip
                key={id}
                label={agentFilterLabel(id)}
                count={filterCounts[id]}
                active={filter === id}
                tone={statusToneForAgentFilter(id)}
                surfaceTheme={surfaceTheme}
                onClick={() => setFilter(id)}
              />
            ))}
          </div>

          {filteredAgents.length > 0 ? (
            <div className={cn(view === "grid" ? "grid gap-2.5 lg:grid-cols-2 min-[1400px]:grid-cols-3" : "flex flex-col gap-2.5")}>
              {filteredAgents.map((agent) => (
                <AgentCard
                  key={agent.id}
                  agent={agent}
                  connectionBadges={resolveAgentConnectionBadges(agent, loginTargets, accessRules)}
                  selected={selectedAgent?.id === agent.id}
                  list={view === "list"}
                  onSelect={() => setSelectedId(agent.id)}
                  onMessage={() => setChatAgentId(agent.id)}
                  onRunTask={() => setDispatchAgent(agent)}
                  onManageProfile={() => setProfileAgentId(agent.id)}
                />
              ))}
            </div>
          ) : (
            <EmptyState title="No agents match your filters" description="Clear search or switch back to All to see every OpenClaw agent in this workspace." />
          )}

          <RecentAgentActivity snapshot={snapshot} agents={agents} />
        </>
      }
      inspector={selectedAgent ? (
        <AgentInspector
          agent={selectedAgent}
          deleting={deletingAgentId === selectedAgent.id}
          onMessage={() => setChatAgentId(selectedAgent.id)}
          onRunTask={() => setDispatchAgent(selectedAgent)}
          onChangeModel={() => setModelAgentId(selectedAgent.id)}
          onManageProfile={() => setProfileAgentId(selectedAgent.id)}
          onManagePolicy={() => openCapabilityEditor(selectedAgent.id, "skills")}
          onManageTools={() => openCapabilityEditor(selectedAgent.id, "tools")}
          onDelete={() => void deleteAgent(selectedAgent)}
        />
      ) : null}
    />
      <Dialog open={Boolean(chatAgent)} onOpenChange={(open) => setChatAgentId(open ? chatAgentId : null)}>
        <DialogContent
          className="left-0 top-0 flex h-[100dvh] max-h-none w-full max-w-none translate-x-0 translate-y-0 flex-col gap-0 rounded-none border-0 p-0 sm:left-1/2 sm:top-1/2 sm:h-[min(82dvh,760px)] sm:max-w-3xl sm:-translate-x-1/2 sm:-translate-y-1/2 sm:gap-4 sm:rounded-[18px] sm:border sm:p-4"
          closeClassName="hidden sm:block"
        >
          <DialogHeader className="shrink-0 border-b border-border/55 px-3 pb-3 pt-[calc(0.6rem+env(safe-area-inset-top))] sm:border-0 sm:p-0">
            <div className="flex min-w-0 items-center gap-3 sm:block">
              <DialogClose className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-accent hover:text-accent-foreground sm:hidden">
                <ArrowLeft className="h-4 w-4" />
                <span className="sr-only">Back to agents</span>
              </DialogClose>
              <div className="min-w-0 flex-1 sm:pr-10">
                <div className="flex min-w-0 items-center gap-1.5">
                  <DialogTitle className="truncate text-[1.05rem] sm:text-xl">
                    <span className="sm:hidden">
                      {chatAgent ? formatAgentDisplayNameFromRecord(chatAgent) : "Agent Chat"}
                    </span>
                    <span className="hidden sm:inline">
                      {chatAgent ? `Message ${formatAgentDisplayNameFromRecord(chatAgent)}` : "Agent Chat"}
                    </span>
                  </DialogTitle>
                  {chatAgent ? (
                    <span
                      aria-label={chatAgent.status}
                      title={chatAgent.status}
                      className={cn("h-2 w-2 shrink-0 rounded-full sm:hidden", resolveAgentStatusDotTone(chatAgent.status))}
                    />
                  ) : null}
                </div>
                <DialogDescription className="mt-0.5 truncate text-[11px] sm:mt-2 sm:text-sm">
                  <span className="sm:hidden">
                    {chatAgent?.currentAction?.trim() || (chatAgent ? `${chatAgent.status} · Ready to chat` : "Direct agent chat")}
                  </span>
                  <span className="hidden sm:inline">
                    Messages are sent through the existing AgentOS/OpenClaw agent chat runner.
                  </span>
                </DialogDescription>
              </div>
            </div>
          </DialogHeader>
          <div className="min-h-0 flex-1 px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:p-0">
            {chatAgent ? (
              <AgentChatDrawer
                agent={chatAgent}
                snapshot={rootSnapshot}
                surfaceTheme={surfaceTheme}
                isVisible={Boolean(chatAgent)}
                onRefresh={refresh}
                onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
              />
            ) : null}
          </div>
        </DialogContent>
      </Dialog>
      <AgentModelPickerDialog
        open={Boolean(modelAgentId)}
        agentId={modelAgentId}
        snapshot={rootSnapshot}
        onOpenChange={(open) => setModelAgentId(open ? modelAgentId : null)}
        onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
        onRefresh={refresh}
        onOpenAddModels={() => setIsAddModelsDialogOpen(true)}
        surfaceTheme={surfaceTheme}
      />
      <WorkerProfileDialog
        open={Boolean(profileAgentId)}
        agentId={profileAgentId}
        snapshot={rootSnapshot}
        onOpenChange={(open) => setProfileAgentId(open ? profileAgentId : null)}
        onRefresh={refresh}
        onSnapshotChange={setSnapshot}
        onChangeModel={(agentId) => {
          setProfileAgentId(null);
          setModelAgentId(agentId);
        }}
        onManageCapabilities={(agentId, focus) => {
          setProfileAgentId(null);
          openCapabilityEditor(agentId, focus);
        }}
        surfaceTheme={surfaceTheme}
      />
      <AddModelsDialog
        open={isAddModelsDialogOpen}
        onOpenChange={setIsAddModelsDialogOpen}
        snapshot={rootSnapshot}
        onSnapshotChange={setSnapshot}
        surfaceTheme={surfaceTheme}
      />
      <AgentCapabilityEditorDialog
        open={Boolean(capabilityAgentId)}
        agentId={capabilityAgentId}
        initialFocus={capabilityFocus}
        snapshot={rootSnapshot}
        onOpenChange={(open) => setCapabilityAgentId(open ? capabilityAgentId : null)}
        onSnapshotChange={(updater) => setSnapshot((current) => updater(current))}
        onRefresh={refresh}
        surfaceTheme={surfaceTheme}
      />
      <MissionDispatchDialog
        open={Boolean(dispatchAgent)}
        agent={dispatchAgent}
        onOpenChange={(open) => setDispatchAgent(open ? dispatchAgent : null)}
        onSubmitted={refresh}
      />
    </>
  );
}

function AgentCard({
  agent,
  connectionBadges,
  selected,
  list,
  onSelect,
  onMessage,
  onRunTask,
  onManageProfile
}: {
  agent: AgentView;
  connectionBadges: AgentConnectionBadge[];
  selected: boolean;
  list: boolean;
  onSelect: () => void;
  onMessage: () => void;
  onRunTask: () => void;
  onManageProfile: () => void;
}) {
  const Icon = agent.icon;
  const heartbeatLabel = agent.source?.heartbeat.enabled
    ? agent.source.heartbeat.every ?? "on"
    : "off";
  const roleLabel = agent.source?.workerProfile?.employment.role ?? (agent.source?.policy.preset ? toTitleCase(agent.source.policy.preset) : agent.policyLabel);
  const statusVariant = toAgentBadgeVariant(agent.statusTone);
  const onlineLabel = agent.online ? "Online" : "Offline";
  const profileVisual = resolveAgentProfileVisual(agent.id, agent.name, agent.source?.identity.theme);

  return (
    <div
      style={profileVisual.style as CSSProperties}
      role="button"
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className={cn(
        "agent-node group relative isolate overflow-hidden rounded-lg border border-border bg-card text-left shadow-card backdrop-blur-xl transition-all focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50",
        list ? "md:grid md:grid-cols-[220px_minmax(0,1fr)]" : "",
        selected && "border-primary/50 shadow-[0_0_0_1px_hsl(var(--primary)/0.12),0_22px_64px_hsl(var(--primary)/0.12)]"
      )}
    >
      <div className="pointer-events-none absolute inset-0 overflow-hidden rounded-lg">
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_18%_10%,hsl(var(--primary)/0.12),transparent_36%),radial-gradient(circle_at_84%_18%,hsl(var(--status-success)/0.07),transparent_28%)]" />
        <div className="absolute inset-y-4 left-0 w-[3px] rounded-r-full bg-[linear-gradient(180deg,hsl(var(--primary)/0.86),hsl(var(--primary)/0.12))]" />
      </div>

      <div
        className={cn("agent-profile-media relative overflow-hidden border-b border-white/[0.12] bg-[linear-gradient(180deg,rgba(14,16,20,0.98),rgba(8,10,14,0.95))]", list ? "h-full min-h-[210px] rounded-l-[12px] md:rounded-r-none" : "h-[124px] rounded-t-[12px] sm:h-[154px]")}
        style={profileVisual.style as CSSProperties}
      >
        <video
          className="pointer-events-none absolute inset-0 h-full w-full scale-[1.06] object-cover object-center brightness-[0.74] contrast-[1.12] saturate-[0.9] transition-[filter,transform] duration-300 group-hover:scale-[1.04] group-hover:brightness-[0.92] group-hover:contrast-[1.1] group-hover:saturate-[1.08]"
          autoPlay
          loop
          muted
          playsInline
          preload="metadata"
          aria-hidden="true"
        >
          <source src={profileVisual.videoSrc} type="video/webm" />
        </video>
        <div className="agent-profile-media__refraction" />
        <div className="agent-profile-media__glow" />
        <div className="agent-profile-media__grain" />
        <div className="absolute left-3 top-3 z-20 flex flex-col gap-1.5">
          <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-primary/20 bg-slate-950/70 text-primary shadow-[0_12px_28px_rgba(0,0,0,0.28)] backdrop-blur-xl">
              <Icon className="h-4 w-4" />
            </span>
            <AgentConnectionIconRow badges={connectionBadges} />
          </div>
          <Badge variant={statusVariant} className="w-fit max-w-[150px] truncate px-2 py-1 text-[9px]">
            {agent.statusLabel}
          </Badge>
        </div>
        {selected ? (
          <span className="absolute right-3 top-3 z-20 inline-flex h-7 w-7 items-center justify-center rounded-full border border-primary/30 bg-primary/15 text-primary shadow-[0_0_16px_hsl(var(--primary)/0.20)]">
            <CircleCheck className="h-3.5 w-3.5" />
          </span>
        ) : null}
        <div className="absolute inset-x-0 bottom-0 z-20 p-3.5">
          <div className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.22em] text-white/65">
            <span className={cn("h-1.5 w-1.5 rounded-full", agent.online ? "bg-emerald-400 shadow-[0_0_10px_rgba(52,211,153,0.42)]" : "bg-slate-500")} />
            Agent
          </div>
          <h3 className="mt-1 truncate font-display text-[1.08rem] leading-5 text-white">{agent.name}</h3>
          <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-amber-200/90">{roleLabel}</p>
        </div>
      </div>

      <div className="relative z-10 px-3.5 pb-3.5 pt-3.5">
        <div className="flex flex-wrap items-center gap-1.5">
          <Badge variant="muted" className="max-w-[170px] truncate px-2 py-1 text-[9px] normal-case tracking-normal">
            {agent.modelLabel}
          </Badge>
          <Badge
            variant={agent.online ? "success" : "muted"}
            className={cn(
              "px-2 py-1 text-[9px] normal-case tracking-normal",
              agent.online && "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-400/20 dark:bg-emerald-400/10 dark:text-emerald-100"
            )}
          >
            {onlineLabel}
          </Badge>
        </div>

        <div className="mt-2.5">
          <p className="line-clamp-1 text-[12px] leading-5 text-foreground/80 sm:line-clamp-2 sm:min-h-10">{agent.purpose}</p>
          <p className="mt-2 hidden truncate text-[9px] uppercase tracking-[0.18em] text-muted-foreground sm:block">
            Heartbeat {heartbeatLabel} · Last seen {agent.lastActiveLabel}
          </p>
        </div>

        <div className="mt-3 hidden grid-cols-3 gap-2 sm:grid">
          <AgentCardStat label="Tools" value={agent.toolsCount} />
          <AgentCardStat label="Sessions" value={agent.sessionsCount} />
          <AgentCardStat label="Policy" value={agent.policyLabel} />
        </div>

        <div className="mt-3 grid grid-cols-[1fr_1fr_auto] gap-2">
          <Button
            variant="secondary"
            size="sm"
            className="h-10 rounded-full border-border bg-muted/35 px-2 text-xs text-foreground hover:bg-muted/60"
            onClick={(event) => {
              event.stopPropagation();
              onMessage();
            }}
          >
            <MessageSquare className="mr-1.5 h-3.5 w-3.5" /> Message
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className={cn(
              "h-10 rounded-full border-primary/20 bg-primary/10 px-2 text-xs text-primary shadow-[0_10px_24px_rgba(245,158,11,0.18)] hover:border-primary/30 hover:bg-primary/15 hover:text-primary",
              "dark:border-amber-300/20 dark:bg-[linear-gradient(180deg,rgba(251,191,36,0.18),rgba(217,119,6,0.28))] dark:text-amber-50 dark:hover:border-amber-200/30 dark:hover:bg-amber-400/20 dark:hover:text-white"
            )}
            onClick={(event) => {
              event.stopPropagation();
              onRunTask();
            }}
          >
            <Play className="mr-1.5 h-3.5 w-3.5" /> Run Task
          </Button>
          <Button
            variant="secondary"
            size="sm"
            className="h-10 rounded-full border-border bg-muted/35 px-3 text-muted-foreground"
            title="Open this worker's profile."
            onClick={(event) => {
              event.stopPropagation();
              onManageProfile();
            }}
          >
            <SlidersHorizontal className="h-3.5 w-3.5" />
          </Button>
        </div>

        <div className="mt-3 overflow-hidden rounded-b-[18px] border-t border-border bg-muted/35 px-2.5 py-2 shadow-[inset_0_1px_0_hsl(var(--border)/0.35)]">
          <div className="flex min-w-0 items-center gap-1.5">
            <span aria-hidden="true" className="h-1.5 w-1.5 shrink-0 rounded-full bg-primary/75 shadow-[0_0_10px_hsl(var(--primary)/0.25)]" />
            <p className="truncate text-[8px] uppercase leading-none tracking-[0.22em] text-muted-foreground">Agent details</p>
            <p className="ml-auto min-w-0 truncate text-[8px] leading-none text-muted-foreground">
              {agent.toolsCount} tool{agent.toolsCount === 1 ? "" : "s"} · {agent.sessionsCount} session
              {agent.sessionsCount === 1 ? "" : "s"}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentConnectionIconRow({
  badges
}: {
  badges: AgentConnectionBadge[];
}) {
  if (badges.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {badges.map((badge) => (
        <span
          key={badge.key}
          className="inline-flex items-center gap-1 rounded-full border border-white/12 bg-slate-950/62 px-1.5 py-1 shadow-[0_10px_20px_rgba(0,0,0,0.24)] backdrop-blur-xl"
          title={badge.title}
          aria-label={badge.title}
        >
          {badge.kind === "account" ? (
            <AccountIcon
              serviceId={badge.serviceId}
              serviceName={badge.label}
              primaryDomain={badge.primaryDomain}
              className="h-5 w-5 border-white/10 bg-slate-950/60 shadow-none"
            />
          ) : (
            <EntityIcon icon={badge.icon} label={badge.label} tone={badge.tone} size="sm" />
          )}
        </span>
      ))}
    </div>
  );
}

type AgentConnectionBadge = {
  key: string;
  kind: "integration" | "account";
  title: string;
  label: string;
  icon?: LucideIcon;
  tone: "success" | "info" | "warning" | "danger" | "muted" | "purple";
  serviceId?: string;
  primaryDomain?: string;
};

function resolveAgentConnectionBadges(
  agent: AgentView,
  loginTargets: AccountLoginTargetView[],
  accessRules: AccountAccessRuleView[]
) {
  const source = agent.source;
  if (!source) {
    return [];
  }

  const toolNames = new Set([...(source.tools ?? []), ...(source.observedTools ?? [])].map((tool) => tool.toLowerCase()));
  const badges: AgentConnectionBadge[] = [];

  if (toolNames.has("gateway")) {
    badges.push({
      key: "integration:gateway",
      kind: "integration",
      title: "Gateway",
      label: "Gateway",
      icon: Plug,
      tone: "info"
    });
  }

  if (toolNames.has("browser")) {
    badges.push({
      key: "integration:browser",
      kind: "integration",
      title: "Browser",
      label: "Browser",
      icon: Chrome,
      tone: "warning"
    });
  }

  if (toolNames.has("exec") || toolNames.has("process")) {
    badges.push({
      key: "integration:runtime",
      kind: "integration",
      title: "Runtime",
      label: "Runtime",
      icon: Terminal,
      tone: "muted"
    });
  }

  if (toolNames.has("read") || toolNames.has("write") || toolNames.has("fs.workspaceonly")) {
    badges.push({
      key: "integration:workspace",
      kind: "integration",
      title: "Workspace files",
      label: "Workspace",
      icon: Folder,
      tone: "success"
    });
  }

  if (toolNames.has("web_search") || toolNames.has("web_fetch")) {
    badges.push({
      key: "integration:web",
      kind: "integration",
      title: "Web",
      label: "Web",
      icon: Globe2,
      tone: "purple"
    });
  }

  for (const badge of buildAgentAccountBadges(agent, loginTargets, accessRules).slice(0, 4)) {
    badges.push({
      key: `account:${badge.id}`,
      kind: "account",
      title: `${badge.serviceName} · ${badge.browserProfileName}`,
      label: badge.serviceName,
      serviceId: badge.serviceId,
      primaryDomain: badge.primaryDomain,
      tone: "warning"
    });
  }

  return badges.slice(0, 5);
}

function buildAgentAccountBadges(
  agent: AgentView,
  loginTargets: AccountLoginTargetView[],
  accessRules: AccountAccessRuleView[]
) {
  const targetsById = new Map(loginTargets.map((target) => [target.id, target]));
  const summaries = new Map<
    string,
    {
      id: string;
      serviceId: string;
      serviceName: string;
      primaryDomain: string;
      browserProfileName: string;
    }
  >();

  for (const rule of accessRules) {
    if (rule.agentId !== agent.id || rule.permission !== "use_browser_profile") {
      continue;
    }

    const target = targetsById.get(rule.targetId);
    if (!target) {
      continue;
    }

    const key = `${target.serviceId}:${target.primaryDomain}:${target.browserProfileName}`;
    if (!summaries.has(key)) {
      summaries.set(key, {
        id: target.id,
        serviceId: target.serviceId,
        serviceName: target.serviceName,
        primaryDomain: target.primaryDomain,
        browserProfileName: target.browserProfileName
      });
    }
  }

  return Array.from(summaries.values()).sort((left, right) => left.serviceName.localeCompare(right.serviceName));
}

function AgentCardStat({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-[14px] border border-border bg-muted/45 px-2.5 py-2 text-center shadow-[inset_0_1px_0_hsl(var(--border)/0.35)] dark:bg-muted/35">
      <p className="truncate text-[8px] uppercase tracking-[0.2em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-[13px] font-semibold leading-none text-foreground dark:text-slate-100">{value}</p>
    </div>
  );
}

function toAgentBadgeVariant(tone: StatusTone): "default" | "muted" | "success" | "warning" | "danger" {
  if (tone === "success") {
    return "success";
  }
  if (tone === "warning") {
    return "warning";
  }
  if (tone === "danger") {
    return "danger";
  }
  if (tone === "muted") {
    return "muted";
  }
  return "default";
}

function AgentInspector({
  agent,
  deleting,
  onMessage,
  onRunTask,
  onChangeModel,
  onManageProfile,
  onManagePolicy,
  onManageTools,
  onDelete
}: {
  agent: AgentView;
  deleting: boolean;
  onMessage: () => void;
  onRunTask: () => void;
  onChangeModel: () => void;
  onManageProfile: () => void;
  onManagePolicy: () => void;
  onManageTools: () => void;
  onDelete: () => void;
}) {
  return (
    <InspectorPanelFrame>
      <div className="flex items-start gap-3">
        <EntityIcon icon={agent.icon} label={agent.name} tone={agent.iconTone} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h2 className="text-base font-semibold leading-tight text-foreground">{agent.name}</h2>
            <MoreButton />
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <StatusBadge label={agent.statusLabel} tone={agent.statusTone} />
            <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
              <span className={cn("h-1.5 w-1.5 rounded-full", agent.online ? "bg-emerald-400" : "bg-slate-500")} />
              {agent.online ? "Online" : "Offline"}
            </span>
          </div>
          <p className="mt-2.5 text-xs leading-5 text-foreground/80">{agent.purpose}</p>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-3 gap-2">
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" onClick={onMessage}>Message</Button>
        <Button variant="secondary" size="sm" className="h-8 rounded-[9px] px-2 text-xs" onClick={onRunTask}>Run Task</Button>
        <Button
          size="sm"
          className="h-8 rounded-[9px] bg-amber-400 px-2 text-xs text-slate-950 hover:bg-amber-300"
          disabled
          title="Following agents requires backend support."
        >
          Follow
        </Button>
      </div>

      <div className="mt-4 rounded-[10px] border border-border bg-muted/35 px-3">
        <KeyValue label="Worker Profile" value={agent.source?.workerProfile?.employment.role ?? "Role baseline"} action={<button className="text-primary" onClick={onManageProfile}>Manage</button>} />
        <KeyValue label="Role" value={agent.source?.policy.preset ? toTitleCase(agent.source.policy.preset) : agent.policyLabel} />
        <KeyValue label="Policy Mode" value={agent.policyLabel} action={<button className="text-primary" onClick={onManagePolicy}>Manage</button>} />
        <KeyValue label="Workspace Scope" value={agent.source?.toolPolicy?.fs?.workspaceOnly ? `${agent.workspaceName} (Workspace only)` : `${agent.workspaceName} (Policy controlled)`} />
        <KeyValue label="Default Model" value={agent.modelLabel} action={<button className="text-primary" onClick={onChangeModel}>Change</button>} />
        <KeyValue label="Tools Enabled" value={`${agent.toolsCount} tools`} action={<button className="text-primary" onClick={onManageTools}>Manage</button>} />
      </div>

      <SectionCard title="Runtime Summary" className="mt-3">
        <div className="px-3 py-2 text-xs">
          <KeyValue label="Sessions" value={String(agent.sessionsCount)} />
          <KeyValue label="Active runtimes" value={String(agent.source?.activeRuntimeIds.length ?? 0)} />
          <KeyValue label="Status" value={agent.source?.status ?? agent.statusLabel} />
          <KeyValue label="Heartbeat" value={agent.source?.heartbeat.enabled ? agent.source.heartbeat.every ?? "Enabled" : "Disabled"} />
          <KeyValue label="Last active" value={agent.lastActiveLabel} />
        </div>
      </SectionCard>

      <SectionCard title="Backend Support" className="mt-3">
        <div className="space-y-2 p-3 text-xs leading-5 text-foreground/80">
          <p>Message, model changes, capability management, mission dispatch, and delete are connected to existing AgentOS/OpenClaw APIs.</p>
          <p className="text-muted-foreground">Follow/import actions are disabled because this codebase does not expose persistence or import contracts for them.</p>
        </div>
      </SectionCard>
      <Button
        variant="destructive"
        size="sm"
        className="mt-3 h-8 w-full rounded-[9px] text-xs"
        disabled={deleting || !agent.source}
        title={agent.source ? "Delete this AgentOS/OpenClaw agent." : "Delete requires a real agent record."}
        onClick={onDelete}
      >
        {deleting ? "Deleting..." : "Delete Agent"}
      </Button>
    </InspectorPanelFrame>
  );
}

function RecentAgentActivity({ snapshot, agents }: { snapshot: MissionControlSnapshot; agents: AgentView[] }) {
  const rows = snapshot.runtimes.slice(0, 4).map((runtime) => {
    const agent = agents.find((entry) => entry.id === runtime.agentId);
    return {
      agent: agent?.name || runtime.agentId || "OpenClaw",
      event: runtime.status === "completed" ? "Completed task" : runtime.status === "running" ? "Running task" : "Updated session",
      status: runtime.status,
      task: runtime.title || runtime.subtitle || runtime.id,
      time: runtime.updatedAt ? "recently" : "no activity"
    };
  });

  return (
    <SectionCard title="Recent Activity" action={<Button asChild variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[0.68rem]"><Link href="/missions">View missions</Link></Button>}>
      {rows.length === 0 ? (
        <EmptyState title="No runtime activity" description="No agent runtime events were reported in the current AgentOS snapshot." />
      ) : (
      <div>
        <div className="divide-y divide-border sm:hidden">
          {rows.map((row, index) => (
            <div key={`${row.agent}-${row.task}-${index}`} className="p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold text-foreground">{row.agent}</p>
                  <p className="mt-1 text-xs text-muted-foreground">{row.event}</p>
                </div>
                <StatusBadge label={row.status} tone={row.status === "completed" ? "success" : row.status === "running" ? "info" : "warning"} />
              </div>
              <p className="mt-2 line-clamp-2 text-xs leading-5 text-foreground/80">{row.task}</p>
              <p className="mt-1 text-[0.68rem] text-muted-foreground">{row.time}</p>
            </div>
          ))}
        </div>
        <div className="hidden overflow-x-auto sm:block">
        <table className="w-full min-w-[680px] text-left text-xs">
          <thead className="border-b border-border text-[0.58rem] uppercase tracking-[0.14em] text-muted-foreground">
            <tr>
              <th className="px-3 py-2.5 font-semibold">Agent</th>
              <th className="px-3 py-2.5 font-semibold">Event</th>
              <th className="px-3 py-2.5 font-semibold">Status</th>
              <th className="px-3 py-2.5 font-semibold">Task</th>
              <th className="px-3 py-2.5 font-semibold">Time</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border text-foreground/80">
            {rows.map((row, index) => (
              <tr key={`${row.agent}-${row.task}-${index}`} className="hover:bg-muted/50">
                <td className="px-3 py-2.5 text-foreground">{row.agent}</td>
                <td className="px-3 py-2.5">{row.event}</td>
                <td className="px-3 py-2.5"><StatusBadge label={row.status} tone={row.status === "completed" ? "success" : row.status === "running" ? "info" : "warning"} /></td>
                <td className="px-3 py-2.5">{row.task}</td>
                <td className="px-3 py-2.5">{row.time}</td>
              </tr>
            ))}
          </tbody>
        </table>
        </div>
      </div>
      )}
    </SectionCard>
  );
}
