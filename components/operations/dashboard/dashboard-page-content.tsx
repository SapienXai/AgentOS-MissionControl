"use client";

import Link from "next/link";
import { useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from "react";
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  BrainCircuit,
  CheckCircle2,
  CircleCheck,
  Clock3,
  Cpu,
  Gauge,
  Inbox,
  KeyRound,
  Plug,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  ShieldCheck,
  Sparkles,
  TerminalSquare,
  Workflow,
  X
} from "lucide-react";
import type { LucideIcon } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import { RuntimeIssuesCard } from "@/components/runtime/runtime-inbox";
import { HumanControlInbox } from "@/components/operations/human-control-inbox";
import { TaskHealthCard, type TaskAuditActivity } from "@/components/operations/task-health-card";
import type { MissionControlSnapshot, WorkspaceRecord } from "@/lib/agentos/contracts";
import { compactPath, formatRelativeTime, formatTokens, resolveRelativeTimeReferenceMs } from "@/lib/openclaw/presenters";
import {
  buildAgentViews,
  buildIntegrationViews,
  buildModelViews,
  buildTaskViews,
  formatBigNumber,
  summarizeTokens,
  type AgentView,
  type TaskView
} from "@/components/operations/operations-data";
import {
  EmptyState,
  EntityIcon,
  KeyValue,
  MiniBadge,
  ProgressBar,
  SectionCard,
  StatCard,
  StatGrid,
  StatusBadge,
  type StatusTone
} from "@/components/operations/operations-ui";
import { MissionDispatchDialog } from "@/components/operations/operations-shared";
import { cn } from "@/lib/utils";

const dashboardPanelClassName = "cockpit-panel";
const insetSurfaceClassName = "cockpit-inset";

export function DashboardPageContent({
  snapshot,
  rootSnapshot,
  activeWorkspace,
  activeWorkspaceId,
  connectionState,
  attentionRefreshGeneration,
  surfaceTheme,
  refresh,
  setSnapshot
}: {
  snapshot: MissionControlSnapshot;
  rootSnapshot: MissionControlSnapshot;
  activeWorkspace: WorkspaceRecord | null;
  activeWorkspaceId: string | null;
  connectionState: "connecting" | "live" | "retrying";
  attentionRefreshGeneration: number;
  surfaceTheme: "dark" | "light";
  refresh: () => Promise<void>;
  setSnapshot: Dispatch<SetStateAction<MissionControlSnapshot>>;
}) {
  const [dispatchOpen, setDispatchOpen] = useState(false);
  const [dashboardSearch, setDashboardSearch] = useState("");
  const agents = useMemo(() => buildAgentViews(snapshot), [snapshot]);
  const tasks = useMemo(() => buildTaskViews(snapshot), [snapshot]);
  const models = useMemo(() => buildModelViews(snapshot), [snapshot]);
  const integrations = useMemo(() => buildIntegrationViews(rootSnapshot), [rootSnapshot]);
  const referenceMs = resolveRelativeTimeReferenceMs(rootSnapshot.generatedAt);
  const taskCounts = summarizeTasks(tasks);
  const runningAgents = agents.filter((agent) => agent.status === "running");
  const readyAgents = agents.filter((agent) => agent.status === "ready");
  const agentsNeedingApproval = agents.filter((agent) => agent.status === "needs-approval");
  const tokenTotal = summarizeSnapshotTokens(snapshot);
  const gatewaySummary = summarizeGateway(rootSnapshot);
  const compatibilityReport = rootSnapshot.diagnostics.compatibilityReport ?? null;
  const modelReadiness = rootSnapshot.diagnostics.modelReadiness;
  const enabledAccounts = rootSnapshot.channelAccounts.filter((account) => account.enabled);
  const connectedIntegrations = integrations.filter((integration) => integration.status === "connected");
  const activeRuntimeIssues = rootSnapshot.diagnostics.runtimeIssues.filter(
    (issue) => issue.status !== "resolved" && issue.status !== "dismissed"
  );
  const diagnosticInboxItems = buildDiagnosticInboxItems(rootSnapshot, activeRuntimeIssues);
  const attentionItems = buildAttentionItems(rootSnapshot);
  const hasGatewayPermissionIssue = attentionItems.some(isGatewayPermissionIssue);
  const currentTaskIssueCount = rootSnapshot.diagnostics.taskHealth?.currentIssue.count ?? taskCounts.attention;
  const needsAttentionCount = currentTaskIssueCount + activeRuntimeIssues.length + diagnosticInboxItems.length;
  const dashboardQuery = dashboardSearch.trim().toLowerCase();
  const filteredAgents = useMemo(
    () => filterAgents(agents, dashboardQuery),
    [agents, dashboardQuery]
  );
  const filteredRecentTasks = useMemo(
    () =>
      filterTasks(
        [...tasks].sort((left, right) => (right.source?.updatedAt ?? 0) - (left.source?.updatedAt ?? 0)),
        dashboardQuery
      ).slice(0, 6),
    [dashboardQuery, tasks]
  );
  const activeTaskByAgentId = useMemo(() => buildActiveTaskByAgentId(tasks), [tasks]);
  const visibleAgents = filteredAgents.slice(0, 6);
  const snapshotAgeLabel = formatRelativeTime(Date.parse(rootSnapshot.generatedAt), referenceMs);
  const activeWorkspaceLabel = activeWorkspace?.name ?? "All workspaces";
  const activeWorkspaceDetail = activeWorkspace?.path ? compactPath(activeWorkspace.path) : `${rootSnapshot.workspaces.length} workspaces visible`;
  const [auditActivity, setAuditActivity] = useState<TaskAuditActivity | null>(null);

  const runTaskHealthAudit = async () => {
    setAuditActivity({
      status: "running",
      lastRunAt: null,
      title: "Task audit running",
      detail: "OpenClaw CLI audit is running."
    });
    try {
      const response = await fetch("/api/tasks/health", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "audit"
        })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) {
        throw new Error(result.error || "Unable to run the task audit.");
      }

      const auditResult = result as {
        completedAt?: string;
        audit?: { state?: string; explanation?: string; warnings?: number; errors?: number; total?: number };
      };
      const completedAt = auditResult.completedAt ?? new Date().toISOString();
      const auditSummary = auditResult.audit;
      toast.success("Task audit completed.");
      setAuditActivity({
        status: "success",
        lastRunAt: completedAt,
        title:
          auditSummary?.state === "clean"
            ? "Task audit clean"
            : auditSummary?.state === "findings"
              ? "Task audit found findings"
              : "Task audit completed",
        detail:
          auditSummary?.explanation ??
          (auditSummary?.errors || auditSummary?.warnings
            ? `${auditSummary.errors ?? 0} errors, ${auditSummary.warnings ?? 0} warnings`
            : "OpenClaw task audit completed successfully.")
      });
      await refresh();
    } catch (error) {
      const detail = error instanceof Error ? error.message : "Unknown task audit error.";
      setAuditActivity({
        status: "error",
        lastRunAt: new Date().toISOString(),
        title: "Task audit failed",
        detail
      });
      toast.error("Task audit failed.", {
        description: detail
      });
    }
  };

  return (
    <>
      <div className="flex flex-col gap-3">
        <header className="border-b border-border/80 pb-4">
          <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
            <div className="min-w-0">
              <div className="hidden flex-wrap items-center gap-2 sm:flex">
                <HeaderStatusPill
                  label="OpenClaw"
                  value={resolveOpenClawStatus(rootSnapshot).label}
                  tone={resolveOpenClawStatus(rootSnapshot).tone}
                  title="OpenClaw reachability from the current snapshot"
                />
                <HeaderStatusPill
                  label="Runtime"
                  value={gatewaySummary.cliFallbackOperationCount > 0 ? `${gatewaySummary.cliFallbackOperationCount} CLI fallback` : gatewaySummary.label}
                  tone={gatewaySummary.cliFallbackOperationCount > 0 ? "warning" : gatewaySummary.tone}
                  title="Gateway transport and fallback mode"
                />
                <HeaderStatusPill
                  label="Snapshot"
                  value={`${rootSnapshot.mode === "live" ? "Live" : "Fallback"} / ${snapshotAgeLabel}`}
                  tone={rootSnapshot.mode === "live" ? "success" : "warning"}
                  title="Last snapshot update"
                />
              </div>
              <h1 className="mt-1 font-display text-[1.7rem] font-semibold leading-tight tracking-normal text-foreground sm:mt-4">
                Dashboard
              </h1>
              <p className="mt-1.5 max-w-3xl text-[0.8rem] leading-5 text-muted-foreground">
                Operational cockpit for {activeWorkspaceLabel}, backed by live OpenClaw runtime data.
              </p>
              <p className="mt-1 text-[0.68rem] leading-4 text-muted-foreground/80">{activeWorkspaceDetail}</p>
            </div>

            <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center xl:justify-end">
              <DashboardSearch
                value={dashboardSearch}
                onChange={setDashboardSearch}
                onClear={() => setDashboardSearch("")}
              />
              <div className="grid shrink-0 grid-cols-2 gap-2 sm:flex">
                <Button
                  variant="secondary"
                  size="sm"
                  className="h-11 rounded-xl px-3 text-xs sm:h-9 sm:rounded-lg"
                  onClick={() => void refresh()}
                >
                  <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                  Refresh
                </Button>
                <Button
                  size="sm"
                  className="h-11 rounded-xl px-3 text-xs sm:h-9 sm:rounded-lg"
                  onClick={() => setDispatchOpen(true)}
                >
                  <Plus className="mr-1.5 h-3.5 w-3.5" />
                  Create Task
                </Button>
              </div>
            </div>
          </div>
        </header>

        <StatGrid columns={6}>
          <StatCard label="Workspaces" value={String(rootSnapshot.workspaces.length)} detail="Visible in snapshot" icon={Workflow} tone="info" />
          <StatCard label="Agents" value={String(agents.length)} detail={`${runningAgents.length} active, ${readyAgents.length} ready`} icon={Bot} tone="success" />
          <StatCard label="Running Tasks" value={String(taskCounts.running)} detail={`${taskCounts.queued} queued`} icon={Activity} tone="info" />
          <StatCard label="Completed" value={String(taskCounts.completed)} detail="Completed task records" icon={CircleCheck} tone="success" />
          <StatCard label="Needs Attention" value={String(needsAttentionCount)} detail={formatAttentionDetail(currentTaskIssueCount, activeRuntimeIssues.length + diagnosticInboxItems.length)} icon={AlertTriangle} tone={needsAttentionCount > 0 ? "warning" : "muted"} />
          <StatCard label="Tokens" value={tokenTotal > 0 ? formatBigNumber(tokenTotal) : "None"} detail={tokenTotal > 0 ? "Reported usage" : "No usage reported"} icon={Sparkles} tone="purple" />
        </StatGrid>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-3 xl:grid-cols-5">
          <QuickAction icon={Workflow} label="Missions" href="/missions" />
          <QuickAction icon={Bot} label="Add Agent" href="/agents" />
          <QuickAction icon={KeyRound} label="Connect Account" href="/accounts" />
          <QuickAction icon={BrainCircuit} label="Manage Models" href="/models" />
          <QuickAction icon={Settings2} label="Open Settings" href="/settings" />
          <QuickAction icon={Gauge} label="Mission Control" href="/" />
        </div>

        <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-12">
          <SectionCard
            title="Mission Control"
            action={<PanelLink href="/missions" label="View missions" />}
            className={cn(dashboardPanelClassName, "xl:col-span-7")}
          >
            <div className="space-y-3 p-3">
              <div className="grid gap-2 sm:grid-cols-3">
                <MiniMetric label="Active" value={String(runningAgents.length)} detail="Currently running" tone="info" />
                <MiniMetric label="Ready" value={String(readyAgents.length)} detail="Available agents" tone="success" />
                <MiniMetric label="Needs Approval" value={String(agentsNeedingApproval.length)} detail="Agent attention" tone={agentsNeedingApproval.length > 0 ? "warning" : "muted"} />
              </div>
              {agents.length === 0 ? (
                <ActionEmptyState
                  title="No agents in this workspace"
                  description="AgentOS did not receive OpenClaw agents for the selected workspace."
                  actions={
                    <>
                      <Button asChild size="sm" className="h-8 rounded-lg px-3 text-xs">
                        <Link href="/agents">
                          <Bot className="mr-1.5 h-3.5 w-3.5" />
                          Add Agent
                        </Link>
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="h-8 rounded-lg px-3 text-xs"
                        onClick={() => setDispatchOpen(true)}
                      >
                        <Plus className="mr-1.5 h-3.5 w-3.5" />
                        Create Task
                      </Button>
                    </>
                  }
                />
              ) : visibleAgents.length === 0 ? (
                <EmptyState title="No agents match this search" description="Clear the dashboard search to restore the full agent view." />
              ) : (
                <div className="grid gap-2 md:grid-cols-2">
                  {visibleAgents.map((agent) => (
                    <AgentSummaryCard
                      key={agent.id}
                      agent={agent}
                      activeTask={activeTaskByAgentId.get(agent.id) ?? null}
                    />
                  ))}
                </div>
              )}
            </div>
          </SectionCard>

          <div className={cn("space-y-3 xl:col-span-5")}>
            <HumanControlInbox surfaceTheme={surfaceTheme} attentionRefreshGeneration={attentionRefreshGeneration} />
            <TaskHealthCard
              snapshot={rootSnapshot}
              title="Task Health"
              compact
              onRefresh={refresh}
              onRunAudit={runTaskHealthAudit}
              auditActivity={auditActivity}
            />
            <RuntimeIssuesCard
              snapshot={rootSnapshot}
              surfaceTheme={surfaceTheme}
              onSnapshotChange={setSnapshot}
              onRefresh={refresh}
            />
            {diagnosticInboxItems.length > 0 ? (
              <CompactIssueList
                items={diagnosticInboxItems}
                title="Diagnostics"
                footer={
                  diagnosticInboxItems.length > 3 ? (
                    <PanelLink href="/settings#diagnostics" label="View all issues" />
                  ) : null
                }
              />
            ) : null}
          </div>

          <SectionCard
            title="Recent Runtime Activity"
            action={<PanelLink href="/missions" label="View missions" />}
            className={cn(dashboardPanelClassName, "xl:col-span-7")}
          >
            {tasks.length === 0 ? (
              <div className="p-3">
                <ActionEmptyState
                  title="No task activity"
                  description="No OpenClaw task records are available for this workspace yet."
                  actions={
                    <Button size="sm" className="h-8 rounded-lg px-3 text-xs" onClick={() => setDispatchOpen(true)}>
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Create Task
                    </Button>
                  }
                />
              </div>
            ) : filteredRecentTasks.length === 0 ? (
              <div className="p-3">
                <EmptyState title="No tasks match this search" description="Clear the dashboard search to restore recent task activity." />
              </div>
            ) : (
              <div className="divide-y divide-border/70">
                {filteredRecentTasks.map((task) => (
                  <TaskActivityRow key={task.id} task={task} referenceMs={referenceMs} />
                ))}
              </div>
            )}
          </SectionCard>

          <SectionCard
            title="System Health"
            action={<PanelLink href="/settings#diagnostics" label="View diagnostics" />}
            className={cn(dashboardPanelClassName, "xl:col-span-5")}
          >
            <div className="space-y-3 p-3">
              <div className="grid gap-2 sm:grid-cols-2">
                <HealthSummaryRow
                  icon={Activity}
                  label="AgentOS stream"
                  value={formatConnectionState(connectionState)}
                  tone={connectionState === "live" ? "success" : "warning"}
                />
                <HealthSummaryRow
                  icon={TerminalSquare}
                  label="OpenClaw runtime"
                  value={formatHealthLabel(rootSnapshot.diagnostics.health)}
                  tone={healthTone(rootSnapshot.diagnostics.health)}
                />
              </div>
              {needsAttentionCount === 0 ? (
                <div className={cn("rounded-lg border p-4", insetSurfaceClassName)}>
                  <div className="flex items-start gap-3">
                    <EntityIcon icon={CheckCircle2} label="Healthy" tone="success" size="sm" />
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">All systems operational</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        AgentOS stream and OpenClaw runtime look healthy in the current snapshot.
                      </p>
                    </div>
                  </div>
                </div>
              ) : (
                <div className={cn("rounded-lg border p-4", insetSurfaceClassName)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-foreground">Attention required</p>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {needsAttentionCount} task or runtime signal{needsAttentionCount === 1 ? "" : "s"} need review.
                      </p>
                    </div>
                    <StatusBadge label="Review" tone="warning" />
                  </div>
                  {hasGatewayPermissionIssue ? (
                    <Button
                      asChild
                      variant="secondary"
                      size="sm"
                      className="mt-3 h-8 w-full justify-between rounded-lg border-[hsl(var(--status-warning)/0.28)] bg-[hsl(var(--status-warning)/0.10)] text-xs text-[hsl(var(--status-warning-foreground))] hover:bg-[hsl(var(--status-warning)/0.14)] hover:text-[hsl(var(--status-warning-foreground))]"
                    >
                      <Link href="/settings#gateway">
                        Manage Gateway permissions
                        <Settings2 className="h-3.5 w-3.5" />
                      </Link>
                    </Button>
                  ) : null}
                </div>
              )}
            </div>
          </SectionCard>

          <SectionCard
            title="OpenClaw Runtime"
            action={<PanelLink href="/settings#diagnostics" label="Diagnostics" />}
            className={cn(dashboardPanelClassName, "hidden sm:block xl:col-span-8")}
          >
            <div className="space-y-3 p-3">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_220px_minmax(0,1fr)]">
                <RuntimeSummaryBlock
                  icon={TerminalSquare}
                  title="Gateway"
                  status={gatewaySummary.label}
                  tone={gatewaySummary.tone}
                  rows={[
                    ["Health", formatHealthLabel(rootSnapshot.diagnostics.health)],
                    ["RPC", rootSnapshot.diagnostics.rpcOk ? "OK" : "Unavailable"],
                    ["Loaded", rootSnapshot.diagnostics.loaded ? "Yes" : "No"],
                    ["Transport", rootSnapshot.diagnostics.transport?.mode ?? "Unknown"],
                    ["Endpoint", rootSnapshot.diagnostics.gatewayUrl || "Not reported"]
                  ]}
                />
                <NativeCoverageSummary gatewaySummary={gatewaySummary} />
                <RuntimeSummaryBlock
                  icon={ShieldCheck}
                  title="Compatibility"
                  status={compatibilityReport ? formatCompatibilityStatus(compatibilityReport.status) : "Unknown"}
                  tone={compatibilityReport ? compatibilityStatusTone(compatibilityReport.status) : "muted"}
                  rows={[
                    ["Installed", compatibilityReport?.openClaw.installedVersion ?? gatewaySummary.installedVersionLabel],
                    ["Recommended", compatibilityReport?.openClaw.recommendedVersion ?? "Unknown"],
                    ["Fallback ops", String(gatewaySummary.cliFallbackOperationCount)],
                    ["Limited ops", String(gatewaySummary.degradedOperationCount)],
                    ["Unsupported", String(gatewaySummary.unsupportedGatewayMethods)],
                    ["Smoke test", rootSnapshot.diagnostics.compatibilitySmokeTest?.status ?? "Not run"]
                  ]}
                />
              </div>
              {gatewaySummary.lastFallbackReason || compatibilityReport?.recovery ? (
                <details className={cn("rounded-lg border px-3 py-2", insetSurfaceClassName)}>
                  <summary className="cursor-pointer text-xs font-semibold text-muted-foreground transition-colors hover:text-foreground">
                    View runtime details
                  </summary>
                  <div className="mt-2 space-y-2 text-xs leading-5 text-muted-foreground">
                    {gatewaySummary.lastFallbackReason ? (
                      <p>
                        <span className="font-semibold text-foreground">Last fallback:</span>{" "}
                        {gatewaySummary.lastFallbackReason}
                      </p>
                    ) : null}
                    {compatibilityReport?.recovery ? (
                      <p>
                        <span className="font-semibold text-foreground">Recovery:</span>{" "}
                        {compatibilityReport.recovery}
                      </p>
                    ) : null}
                  </div>
                </details>
              ) : null}
            </div>
          </SectionCard>

          <SectionCard
            title="System Details"
            action={<PanelLink href="/settings#diagnostics" label="Diagnostics" />}
            className={cn(dashboardPanelClassName, "sm:hidden")}
          >
            <div className="grid grid-cols-2 gap-2 p-3">
              <QuickAction icon={TerminalSquare} label="Runtime" href="/operations" />
              <QuickAction icon={BrainCircuit} label="Models" href="/models" />
              <QuickAction icon={KeyRound} label="Accounts" href="/accounts" />
              <QuickAction icon={Plug} label="Integrations" href="/integrations" />
            </div>
          </SectionCard>

          <div className="hidden gap-3 sm:grid lg:col-span-2 lg:grid-cols-2 xl:col-span-4 xl:grid-cols-1">
            <SectionCard
              title="Models"
              action={<PanelLink href="/models" label="Manage" />}
              className={dashboardPanelClassName}
            >
              <div className="space-y-3 p-3">
                <div className={cn("rounded-lg border p-3", insetSurfaceClassName)}>
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[0.58rem] font-semibold uppercase tracking-[0.16em] text-muted-foreground">Default Model</p>
                      <p className="mt-1 truncate text-sm font-semibold text-foreground">
                        {modelReadiness.resolvedDefaultModel ?? modelReadiness.defaultModel ?? "Not configured"}
                      </p>
                    </div>
                    <StatusBadge label={modelReadiness.ready ? "Ready" : "Needs Setup"} tone={modelReadiness.ready ? "success" : "warning"} />
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2">
                    <MiniMetric label="Available" value={String(modelReadiness.availableModelCount)} />
                    <MiniMetric label="Local" value={String(modelReadiness.localModelCount)} />
                    <MiniMetric label="Remote" value={String(modelReadiness.remoteModelCount)} />
                  </div>
                </div>
                {models.length > 0 ? (
                  <div className="flex flex-wrap gap-1.5">
                    {models.slice(0, 8).map((model) => (
                      <MiniBadge key={model.id}>{model.name}</MiniBadge>
                    ))}
                  </div>
                ) : (
                  <CompactEmptyState
                    title="No model records"
                    description="The snapshot does not include model records yet."
                    action={<PanelLink href="/models" label="Manage Models" />}
                  />
                )}
              </div>
            </SectionCard>

            <SectionCard
              title="Accounts & Integrations"
              action={<PanelLink href="/accounts" label="Connect" />}
              className={dashboardPanelClassName}
            >
              <div className="space-y-3 p-3">
                <div className="grid grid-cols-2 gap-2">
                  <MiniMetric label="Accounts" value={String(rootSnapshot.channelAccounts.length)} detail={`${enabledAccounts.length} enabled`} />
                  <MiniMetric label="Integrations" value={String(connectedIntegrations.length)} detail={`${integrations.length} tracked`} />
                </div>
                {rootSnapshot.channelAccounts.length === 0 ? (
                  <CompactEmptyState
                    title="No connected accounts"
                    description="OpenClaw has not reported channel accounts for this workspace."
                    action={<PanelLink href="/accounts" label="Connect Account" />}
                  />
                ) : (
                  <div className="space-y-2">
                    {rootSnapshot.channelAccounts.slice(0, 4).map((account) => (
                      <div key={account.id} className={cn("flex items-center justify-between gap-2 rounded-lg border px-2.5 py-2", insetSurfaceClassName)}>
                        <span className="min-w-0 truncate text-xs font-medium text-foreground">{account.name}</span>
                        <StatusBadge label={account.enabled ? "Enabled" : "Disabled"} tone={account.enabled ? "success" : "muted"} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </SectionCard>
          </div>
        </div>
      </div>

      <MissionDispatchDialog
        open={dispatchOpen}
        agent={null}
        defaultWorkspaceId={activeWorkspaceId}
        onOpenChange={setDispatchOpen}
        onSubmitted={refresh}
      />
    </>
  );
}

function DashboardSearch({
  value,
  onChange,
  onClear
}: {
  value: string;
  onChange: (value: string) => void;
  onClear: () => void;
}) {
  return (
    <div className="relative min-w-0 flex-1 sm:w-[min(40vw,380px)] sm:flex-none">
      <Search className="pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
      <Input
        value={value}
        onChange={(event) => onChange(event.target.value)}
        placeholder="Search agents and tasks..."
        className="h-9 rounded-lg bg-card/70 pl-9 pr-9 text-xs"
        aria-label="Search dashboard agents and tasks"
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear dashboard search"
          onClick={onClear}
          className="absolute right-2.5 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/50"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </div>
  );
}

function HeaderStatusPill({
  label,
  value,
  tone,
  title
}: {
  label: string;
  value: string;
  tone: StatusTone;
  title?: string;
}) {
  return (
    <span
      title={title}
      className={cn(
        "inline-flex min-h-8 items-center gap-2 rounded-full border bg-card/75 px-2.5 py-1 text-[0.66rem] font-semibold text-foreground shadow-sm",
        toneBorderClass(tone)
      )}
    >
      <span className={cn("h-1.5 w-1.5 rounded-full", dotClass(tone))} />
      <span className="text-muted-foreground">{label}</span>
      <span>{value}</span>
    </span>
  );
}

function QuickAction({
  icon: Icon,
  label,
  href,
  onClick
}: {
  icon: LucideIcon;
  label: string;
  href?: string;
  onClick?: () => void;
}) {
  const content = (
    <>
      <Icon className="h-3.5 w-3.5" />
      <span className="truncate">{label}</span>
    </>
  );

  if (href) {
    return (
      <Button asChild variant="secondary" size="sm" className="h-8 w-full min-w-0 justify-start rounded-lg px-2.5 text-xs">
        <Link href={href}>{content}</Link>
      </Button>
    );
  }

  return (
    <Button variant="secondary" size="sm" className="h-8 w-full min-w-0 justify-start rounded-lg px-2.5 text-xs" onClick={onClick}>
      {content}
    </Button>
  );
}

function PanelLink({ href, label }: { href: string; label: string }) {
  return (
    <Button asChild variant="ghost" size="sm" className="h-7 rounded-lg px-2 text-[0.68rem] text-primary hover:text-primary">
      <Link href={href}>
        {label}
        <ArrowRight className="ml-1.5 h-3 w-3" />
      </Link>
    </Button>
  );
}

function ActionEmptyState({
  title,
  description,
  actions
}: {
  title: string;
  description: string;
  actions?: ReactNode;
}) {
  return (
    <div className={cn("flex min-h-[188px] flex-col items-center justify-center rounded-lg border border-dashed p-6 text-center", insetSurfaceClassName)}>
      <p className="text-sm font-semibold text-foreground">{title}</p>
      <p className="mt-2 max-w-md text-xs leading-5 text-muted-foreground">{description}</p>
      {actions ? <div className="mt-4 flex flex-wrap items-center justify-center gap-2">{actions}</div> : null}
    </div>
  );
}

function CompactEmptyState({
  title,
  description,
  action
}: {
  title: string;
  description: string;
  action?: ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border border-dashed p-3", insetSurfaceClassName)}>
      <p className="text-xs font-semibold text-foreground">{title}</p>
      <p className="mt-1 text-xs leading-5 text-muted-foreground">{description}</p>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}

function MiniMetric({
  label,
  value,
  detail,
  tone = "muted"
}: {
  label: string;
  value: string;
  detail?: string;
  tone?: StatusTone;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg border p-2.5", insetSurfaceClassName, toneBorderClass(tone))}>
      <p className="text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-1 truncate text-sm font-semibold text-foreground">{value}</p>
      {detail ? <p className="mt-0.5 truncate text-[0.66rem] text-muted-foreground">{detail}</p> : null}
    </div>
  );
}

function AgentSummaryCard({
  agent,
  activeTask
}: {
  agent: AgentView;
  activeTask: TaskView | null;
}) {
  return (
    <div className={cn("min-w-0 rounded-lg border p-3", insetSurfaceClassName)}>
      <div className="flex min-w-0 items-start gap-3">
        <EntityIcon icon={agent.icon} label={agent.name} tone={agent.iconTone} size="sm" />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold text-foreground">{agent.name}</p>
              <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{agent.purpose}</p>
            </div>
            <StatusBadge label={agent.statusLabel} tone={agent.statusTone} />
          </div>
          <div className="mt-3 grid gap-2 text-xs sm:grid-cols-2">
            <AgentDetail label="Task" value={activeTask?.title ?? "No active task"} />
            <AgentDetail label="Model" value={agent.modelLabel} />
            <AgentDetail label="Workspace" value={agent.workspaceName} />
            <AgentDetail label="Activity" value={agent.lastActiveLabel} />
          </div>
        </div>
      </div>
    </div>
  );
}

function AgentDetail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-[0.56rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{label}</p>
      <p className="mt-0.5 truncate text-[0.72rem] font-medium text-foreground">{value}</p>
    </div>
  );
}

function TaskActivityRow({ task, referenceMs }: { task: TaskView; referenceMs: number }) {
  const Icon = task.status === "completed" ? CircleCheck : task.status === "running" ? Activity : task.status === "stalled" ? AlertTriangle : Clock3;
  const tokenLabel =
    typeof task.source?.tokenUsage?.total === "number"
      ? `${formatTokens(task.source.tokenUsage.total)} tokens`
      : "No tokens reported";

  return (
    <div className="flex min-w-0 items-center gap-3 px-3 py-3">
      <EntityIcon icon={Icon} label={task.statusLabel} tone={task.statusTone} size="sm" />
      <div className="min-w-0 flex-1">
        <div className="flex items-center justify-between gap-3">
          <p className="truncate text-sm font-semibold text-foreground">{task.title}</p>
          <StatusBadge label={task.statusLabel} tone={task.statusTone} />
        </div>
        <p className="mt-1 truncate text-[0.72rem] text-muted-foreground">
          {task.agentName} / {formatRelativeTime(task.source?.updatedAt ?? null, referenceMs)} / {tokenLabel}
        </p>
      </div>
    </div>
  );
}

function CompactIssueList({
  title,
  items,
  footer
}: {
  title: string;
  items: string[];
  footer?: ReactNode;
}) {
  return (
    <div className={cn("rounded-lg border p-3", insetSurfaceClassName)}>
      <div className="flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <EntityIcon icon={Inbox} label={title} tone="warning" size="sm" />
          <p className="text-xs font-semibold text-foreground">{title}</p>
        </div>
        <StatusBadge label={`${items.length} item${items.length === 1 ? "" : "s"}`} tone="warning" />
      </div>
      <div className="mt-3 space-y-2">
        {items.slice(0, 3).map((item) => (
          <details key={item} className="rounded-lg border border-[hsl(var(--status-warning)/0.22)] bg-[hsl(var(--status-warning)/0.08)] px-2.5 py-2">
            <summary className="cursor-pointer text-xs font-medium leading-5 text-[hsl(var(--status-warning-foreground))]">
              {truncateText(item, 112)}
            </summary>
            <p className="mt-2 text-xs leading-5 text-muted-foreground">{item}</p>
          </details>
        ))}
      </div>
      {footer ? <div className="mt-2">{footer}</div> : null}
    </div>
  );
}

function HealthSummaryRow({
  icon,
  label,
  value,
  tone
}: {
  icon: LucideIcon;
  label: string;
  value: string;
  tone: StatusTone;
}) {
  return (
    <div className={cn("flex min-w-0 items-center justify-between gap-3 rounded-lg border p-3", insetSurfaceClassName)}>
      <div className="flex min-w-0 items-center gap-2.5">
        <EntityIcon icon={icon} label={label} tone={tone} size="sm" />
        <div className="min-w-0">
          <p className="truncate text-xs font-semibold text-foreground">{label}</p>
          <p className="mt-0.5 truncate text-[0.7rem] text-muted-foreground">{value}</p>
        </div>
      </div>
      <StatusBadge label={value} tone={tone} />
    </div>
  );
}

function RuntimeSummaryBlock({
  icon,
  title,
  status,
  tone,
  rows
}: {
  icon: LucideIcon;
  title: string;
  status: string;
  tone: StatusTone;
  rows: Array<[string, string]>;
}) {
  return (
    <div className={cn("rounded-lg border p-3", insetSurfaceClassName)}>
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <EntityIcon icon={icon} label={title} tone={tone} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">{title}</p>
            <p className="mt-0.5 truncate text-[0.68rem] text-muted-foreground">{status}</p>
          </div>
        </div>
        <StatusBadge label={status} tone={tone} />
      </div>
      <div className="mt-3">
        {rows.map(([label, value]) => (
          <KeyValue key={label} label={label} value={<span className="break-words">{value}</span>} />
        ))}
      </div>
    </div>
  );
}

function NativeCoverageSummary({ gatewaySummary }: { gatewaySummary: ReturnType<typeof summarizeGateway> }) {
  const coveragePercent = gatewaySummary.nativeCoveragePercent;
  const dialValue = typeof coveragePercent === "number" ? coveragePercent : 0;

  return (
    <div className={cn("flex flex-col justify-between rounded-lg border p-3 text-center", insetSurfaceClassName)}>
      <div className="flex items-center justify-between gap-2 text-left">
        <div className="flex min-w-0 items-center gap-2.5">
          <EntityIcon icon={Cpu} label="Native Coverage" tone={gatewaySummary.nativeOperationCount > 0 ? "success" : "muted"} size="sm" />
          <div className="min-w-0">
            <p className="truncate text-xs font-semibold text-foreground">Native Coverage</p>
            <p className="mt-0.5 truncate text-[0.68rem] text-muted-foreground">{gatewaySummary.nativeCoverageLabel}</p>
          </div>
        </div>
      </div>
      <div className="mx-auto my-4 flex h-28 w-28 items-center justify-center rounded-full p-2 shadow-[inset_0_0_0_1px_hsl(var(--border)/0.7)]"
        style={{
          background: `conic-gradient(hsl(var(--primary)) ${dialValue}%, hsl(var(--border) / 0.58) 0)`
        }}
      >
        <div className="flex h-full w-full flex-col items-center justify-center rounded-full bg-card text-foreground shadow-[inset_0_0_18px_hsl(var(--background)/0.78)]">
          <span className="text-2xl font-semibold leading-none">
            {typeof coveragePercent === "number" ? `${coveragePercent}%` : gatewaySummary.nativeOperationCount}
          </span>
          <span className="mt-1 text-[0.62rem] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            {typeof coveragePercent === "number" ? "native" : "ops"}
          </span>
        </div>
      </div>
      <ProgressBar value={dialValue} tone={gatewaySummary.nativeOperationCount > 0 ? "success" : "muted"} />
    </div>
  );
}

function summarizeTasks(tasks: TaskView[]) {
  const running = tasks.filter((task) => task.status === "running").length;
  const queued = tasks.filter((task) => task.status === "queued").length;
  const completed = tasks.filter((task) => task.status === "completed").length;

  return {
    running,
    queued,
    completed,
    attention: new Set([
      ...tasks.filter((task) => task.status === "stalled" || task.status === "cancelled" || task.status === "approval").map((task) => task.id),
      ...tasks.filter((task) => (task.source?.warningCount ?? 0) > 0).map((task) => task.id)
    ]).size
  };
}

function summarizeSnapshotTokens(snapshot: MissionControlSnapshot) {
  const taskTokens = snapshot.tasks.reduce((sum, task) => sum + (task.tokenUsage?.total ?? 0), 0);
  return taskTokens || summarizeTokens(snapshot);
}

function summarizeGateway(snapshot: MissionControlSnapshot) {
  const diagnostics = snapshot.diagnostics;
  const operations = Object.values(diagnostics.capabilityMatrix?.operations ?? {});
  const compatibility = diagnostics.capabilityMatrix?.compatibility;
  const compatibilityReport = diagnostics.compatibilityReport;
  const fallbackDiagnostics = diagnostics.gatewayFallbackDiagnostics ?? diagnostics.capabilityMatrix?.fallbackDiagnostics ?? [];
  const fallbackReasons = diagnostics.gatewayFallbackReasons ?? diagnostics.capabilityMatrix?.fallbackReasons ?? [];
  const nativeOperationCount =
    compatibilityReport?.summary.nativeGatewayCoveragePercent != null
      ? compatibilityReport.contracts.filter((contract) => contract.nativeGatewaySupported).length
      : compatibility?.nativeOperationCount ?? operations.filter((operation) => operation.mode === "gateway-native").length;
  const degradedOperationCount =
    compatibilityReport?.summary.degradedOperationCount ??
    compatibility?.degradedOperationCount ??
    operations.filter((operation) => operation.mode === "degraded" || operation.mode === "cli-fallback" || operation.mode === "disabled").length;
  const cliFallbackOperationCount =
    compatibilityReport?.summary.cliFallbackOperationCount ??
    operations.filter((operation) => operation.mode === "cli-fallback").length;
  const label = diagnostics.rpcOk ? "Native RPC" : diagnostics.loaded ? "Gateway Degraded" : diagnostics.installed ? "Installed" : "Unavailable";

  return {
    label,
    detail: diagnostics.version ? `OpenClaw v${diagnostics.version}` : diagnostics.installed ? "Version unknown" : "OpenClaw not installed",
    installedVersionLabel: diagnostics.version ? `v${diagnostics.version}` : diagnostics.installed ? "Version unknown" : "Not installed",
    tone: diagnostics.rpcOk && diagnostics.health === "healthy" ? "success" as const : diagnostics.installed ? "warning" as const : "danger" as const,
    nativeCoverageLabel: compatibilityReport?.summary.nativeGatewayCoverageLabel ?? `${nativeOperationCount} native`,
    nativeCoveragePercent: compatibilityReport?.summary.nativeGatewayCoveragePercent ?? null,
    nativeOperationCount,
    degradedOperationCount,
    cliFallbackOperationCount,
    unsupportedGatewayMethods: diagnostics.capabilityMatrix?.unsupportedGatewayMethods.length ?? 0,
    fallbackCount: fallbackDiagnostics.length,
    fallbackReasonCount: fallbackReasons.length,
    lastFallbackReason: fallbackReasons[0] ?? fallbackDiagnostics[0]?.issue ?? null
  };
}

function formatCompatibilityStatus(status: NonNullable<MissionControlSnapshot["diagnostics"]["compatibilityReport"]>["status"]) {
  switch (status) {
    case "compatible":
      return "Compatible";
    case "degraded":
      return "Degraded";
    case "incompatible":
      return "Incompatible";
    case "unknown":
      return "Unknown";
  }
}

function compatibilityStatusTone(status: NonNullable<MissionControlSnapshot["diagnostics"]["compatibilityReport"]>["status"]): StatusTone {
  switch (status) {
    case "compatible":
      return "success";
    case "degraded":
      return "warning";
    case "incompatible":
      return "danger";
    case "unknown":
      return "muted";
  }
}

function buildAttentionItems(snapshot: MissionControlSnapshot) {
  return [
    ...snapshot.diagnostics.securityWarnings,
    ...snapshot.diagnostics.issues,
    ...snapshot.diagnostics.runtime.issues,
    ...(snapshot.diagnostics.capabilityMatrix?.diagnostics ?? []),
    snapshot.diagnostics.eventBridge?.message ?? "",
    snapshot.diagnostics.eventBridge?.recovery ?? "",
    ...(snapshot.diagnostics.gatewayFallbackReasons ?? []),
    ...(snapshot.diagnostics.capabilityMatrix?.fallbackReasons ?? [])
  ].filter((item, index, items) => item.trim() && items.indexOf(item) === index);
}

function buildDiagnosticInboxItems(
  snapshot: MissionControlSnapshot,
  activeRuntimeIssues: MissionControlSnapshot["diagnostics"]["runtimeIssues"]
) {
  const runtimeIssueText = activeRuntimeIssues
    .flatMap((issue) => [issue.title, issue.message, issue.errorMessage ?? ""])
    .join(" ")
    .toLowerCase();
  const fallbackDiagnostics = snapshot.diagnostics.gatewayFallbackDiagnostics ?? snapshot.diagnostics.capabilityMatrix?.fallbackDiagnostics ?? [];
  const unsupportedMethods = snapshot.diagnostics.capabilityMatrix?.unsupportedGatewayMethods ?? [];
  const candidates = [
    ...buildAttentionItems(snapshot),
    ...fallbackDiagnostics.map((diagnostic) => `${diagnostic.operationLabel || diagnostic.operation}: ${diagnostic.issue}`),
    ...unsupportedMethods.map((method) => `Unsupported Gateway method: ${method}`)
  ];

  return candidates
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, items) => items.indexOf(item) === index)
    .filter((item) => !runtimeIssueText.includes(item.toLowerCase()));
}

function buildActiveTaskByAgentId(tasks: TaskView[]) {
  const activeTaskByAgentId = new Map<string, TaskView>();
  const activeTasks = tasks.filter((task) => task.status === "running" || task.status === "queued" || task.status === "approval" || task.status === "stalled");

  for (const task of activeTasks) {
    const agentIds = new Set<string>();
    if (task.source?.primaryAgentId) {
      agentIds.add(task.source.primaryAgentId);
    }

    for (const agentId of task.source?.agentIds ?? []) {
      agentIds.add(agentId);
    }

    for (const agentId of agentIds) {
      if (!activeTaskByAgentId.has(agentId)) {
        activeTaskByAgentId.set(agentId, task);
      }
    }
  }

  return activeTaskByAgentId;
}

function filterAgents(agents: AgentView[], query: string) {
  if (!query) {
    return agents;
  }

  return agents.filter((agent) =>
    [agent.name, agent.purpose, agent.statusLabel, agent.modelLabel, agent.workspaceName]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function filterTasks(tasks: TaskView[], query: string) {
  if (!query) {
    return tasks;
  }

  return tasks.filter((task) =>
    [task.title, task.agentName, task.category, task.statusLabel, task.objective, task.description]
      .join(" ")
      .toLowerCase()
      .includes(query)
  );
}

function formatAttentionDetail(taskAttentionCount: number, runtimeAttentionCount: number) {
  if (taskAttentionCount === 0 && runtimeAttentionCount === 0) {
    return "No review signals";
  }

  const parts = [];

  if (taskAttentionCount > 0) {
    parts.push(`${taskAttentionCount} task${taskAttentionCount === 1 ? "" : "s"}`);
  }

  if (runtimeAttentionCount > 0) {
    parts.push(`${runtimeAttentionCount} runtime`);
  }

  return parts.join(", ");
}

function resolveOpenClawStatus(snapshot: MissionControlSnapshot): { label: string; tone: StatusTone } {
  if (snapshot.diagnostics.rpcOk && snapshot.diagnostics.health === "healthy") {
    return { label: "Online", tone: "success" };
  }

  if (snapshot.diagnostics.loaded || snapshot.diagnostics.installed) {
    return { label: "Degraded", tone: "warning" };
  }

  return { label: "Unknown", tone: "muted" };
}

function formatConnectionState(connectionState: "connecting" | "live" | "retrying") {
  if (connectionState === "live") {
    return "Live";
  }

  if (connectionState === "retrying") {
    return "Retrying";
  }

  return "Connecting";
}

function formatHealthLabel(health: MissionControlSnapshot["diagnostics"]["health"]) {
  return health.charAt(0).toUpperCase() + health.slice(1);
}

function truncateText(value: string, maxLength: number) {
  const trimmed = value.trim();

  if (trimmed.length <= maxLength) {
    return trimmed;
  }

  return `${trimmed.slice(0, maxLength - 3).trim()}...`;
}

function isGatewayPermissionIssue(item: string) {
  return /operator-scope approval|device access|pairing-pending|scope upgrade/i.test(item);
}

function healthTone(health: MissionControlSnapshot["diagnostics"]["health"]): StatusTone {
  if (health === "healthy") {
    return "success";
  }

  if (health === "degraded") {
    return "warning";
  }

  return "danger";
}

function toneBorderClass(tone: StatusTone) {
  if (tone === "success") {
    return "border-[hsl(var(--status-success)/0.28)]";
  }

  if (tone === "warning") {
    return "border-[hsl(var(--status-warning)/0.30)]";
  }

  if (tone === "danger") {
    return "border-[hsl(var(--status-danger)/0.30)]";
  }

  if (tone === "purple") {
    return "border-[hsl(var(--status-purple)/0.28)]";
  }

  if (tone === "muted") {
    return "border-border";
  }

  return "border-primary/25";
}

function dotClass(tone: StatusTone) {
  if (tone === "success") {
    return "bg-emerald-400";
  }

  if (tone === "warning") {
    return "bg-amber-300";
  }

  if (tone === "danger") {
    return "bg-rose-400";
  }

  if (tone === "purple") {
    return "bg-violet-400";
  }

  if (tone === "muted") {
    return "bg-slate-400";
  }

  return "bg-primary";
}
