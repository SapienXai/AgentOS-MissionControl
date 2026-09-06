"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, ArrowRight, Bot, CheckCircle2, Clock3, Loader2, Plus, Search, ShieldAlert, Users } from "lucide-react";

import {
  EmptyState,
  PageHeader,
  SectionCard,
  StatCard,
  StatGrid,
  StatusBadge
} from "@/components/operations/operations-ui";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { WorkforceMissionListResponse, WorkforceMissionProjection } from "@/lib/agentos/workforce/types";
import { cn } from "@/lib/utils";

export function MissionListPage({
  initial,
  snapshot,
  activeWorkspaceId,
  connectionState,
  attentionRefreshGeneration,
  refresh
}: {
  initial: WorkforceMissionListResponse;
  snapshot: MissionControlSnapshot;
  activeWorkspaceId: string | null;
  connectionState: "connecting" | "live" | "retrying";
  attentionRefreshGeneration: number;
  refresh: () => Promise<void>;
}) {
  const [payload, setPayload] = useState(initial);
  const [search, setSearch] = useState("");
  const [newMissionOpen, setNewMissionOpen] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const params = new URLSearchParams();
    if (activeWorkspaceId) params.set("workspaceId", activeWorkspaceId);
    if (search.trim()) params.set("search", search.trim());
    const timer = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/missions${params.size ? `?${params.toString()}` : ""}`, { cache: "no-store" });
        const next = (await response.json()) as WorkforceMissionListResponse & { error?: string };
        if (!cancelled && response.ok && !next.error) setPayload(next);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }, search.trim() ? 180 : 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [activeWorkspaceId, attentionRefreshGeneration, search, snapshot.revision]);

  const sections = useMemo(() => {
    const needsYou = payload.missions.filter((mission) => ["waiting-human", "blocked", "failed"].includes(mission.state));
    const running = payload.missions.filter((mission) => ["starting", "running", "waiting-worker", "reconnecting"].includes(mission.state));
    const queued = payload.missions.filter((mission) => mission.state === "queued");
    const completed = payload.missions.filter((mission) => mission.state === "completed").slice(0, 8);
    return { needsYou, running, queued, completed };
  }, [payload.missions]);

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <PageHeader
        title="Workforce"
        subtitle="Give your workforce a goal, then see what is running, what needs you, and what finished."
        primaryAction={{ label: "New mission", icon: Plus, onClick: () => setNewMissionOpen(true), disabled: snapshot.agents.length === 0, title: snapshot.agents.length === 0 ? "Connect an eligible agent before starting a mission." : undefined }}
      />

      <div className="rounded-lg border border-border bg-card/55 px-3 py-2.5 text-xs text-muted-foreground">
        <span className={cn("mr-2 inline-block h-1.5 w-1.5 rounded-full", connectionState === "live" ? "bg-[hsl(var(--status-success))]" : "bg-[hsl(var(--status-warning))]")} />
        {connectionState === "live" ? "Live OpenClaw state" : "Reconnecting to OpenClaw; the latest confirmed state is shown."}
      </div>

      <StatGrid columns={4}>
        <StatCard label="Needs you" value={String(payload.summary.needsYou)} detail="Approvals, blockers, failures" icon={ShieldAlert} tone="warning" />
        <StatCard label="Running" value={String(payload.summary.running)} detail="Workers with active work" icon={Users} tone="info" />
        <StatCard label="Queued" value={String(payload.summary.queued)} detail="Accepted, not started" icon={Clock3} tone="purple" />
        <StatCard label="Completed" value={String(payload.summary.completed)} detail="Recent mission results" icon={CheckCircle2} tone="success" />
      </StatGrid>

      <div className="flex items-center gap-2 rounded-lg border border-border bg-card/45 px-3 py-2">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <input
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Search missions, workers, or workspaces"
          className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
          aria-label="Search missions"
        />
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" aria-label="Refreshing missions" /> : null}
      </div>

      {sections.needsYou.length > 0 ? <MissionSection title="Needs you" detail="These missions cannot safely continue without an operator." missions={sections.needsYou} tone="warning" /> : null}
      {sections.running.length > 0 ? <MissionSection title="Running" detail="Active work reconstructed from OpenClaw runtime evidence." missions={sections.running} tone="info" /> : null}
      {sections.queued.length > 0 ? <MissionSection title="Queued" detail="Accepted missions waiting for runtime start." missions={sections.queued} tone="purple" /> : null}
      {sections.completed.length > 0 ? <MissionSection title="Recently completed" detail="Final results remain available with their runtime provenance." missions={sections.completed} tone="success" /> : null}

      {payload.missions.length === 0 ? (
        <EmptyState title="No missions yet" description="Give your workforce a goal to get started." />
      ) : null}

      <NewMissionDialog
        open={newMissionOpen}
        onOpenChange={setNewMissionOpen}
        snapshot={snapshot}
        activeWorkspaceId={activeWorkspaceId}
        onSubmitted={async (missionId) => {
          await refresh();
          window.location.assign(`/missions/${encodeURIComponent(missionId)}`);
        }}
      />
    </div>
  );
}

function MissionSection({ title, detail, missions, tone }: { title: string; detail: string; missions: WorkforceMissionProjection[]; tone: "warning" | "info" | "purple" | "success" }) {
  return (
    <SectionCard title={title} action={<span className="text-[0.65rem] text-muted-foreground">{missions.length}</span>}>
      <p className="border-b border-border px-3 py-2 text-xs leading-5 text-muted-foreground">{detail}</p>
      <div className="grid gap-2 p-2 sm:grid-cols-2 xl:grid-cols-3">
        {missions.map((mission) => <MissionCard key={mission.id} mission={mission} tone={tone} />)}
      </div>
    </SectionCard>
  );
}

function MissionCard({ mission, tone }: { mission: WorkforceMissionProjection; tone: "warning" | "info" | "purple" | "success" }) {
  const activeWorkerCount = mission.activeWorkers.length;
  return (
    <article className="flex min-w-0 flex-col rounded-xl border border-border bg-background/35 p-3 transition-colors hover:bg-accent/35">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h3 className="line-clamp-2 text-sm font-semibold leading-5 text-foreground">{mission.title}</h3>
          <p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{mission.goal}</p>
        </div>
        <StatusBadge label={mission.stateLabel} tone={tone} />
      </div>
      <div className="mt-3 flex min-w-0 items-center gap-2 text-xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        <span className="truncate">{mission.primaryAgentName}</span>
        {activeWorkerCount > 1 ? <span className="shrink-0">· {activeWorkerCount} workers</span> : null}
      </div>
      {mission.humanControlItems[0] ? (
        <div className="mt-3 rounded-lg border border-[hsl(var(--status-warning)/0.30)] bg-[hsl(var(--status-warning)/0.08)] p-2.5 text-xs text-[hsl(var(--status-warning-foreground))]">
          <p className="font-semibold">{mission.humanControlItems[0].title}</p>
          <p className="mt-1 line-clamp-2 leading-5">{mission.humanControlItems[0].summary}</p>
        </div>
      ) : null}
      <div className="mt-3 flex items-center justify-between gap-2 border-t border-border pt-2.5">
        <span className="text-[0.68rem] text-muted-foreground">{formatAge(mission.updatedAt ?? mission.createdAt)}</span>
        <Link href={`/missions/${encodeURIComponent(mission.id)}`} className="group inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">
          {mission.humanControlItems.length > 0 ? "Review" : "Open"}
          <ArrowRight className="h-3.5 w-3.5 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
        </Link>
      </div>
    </article>
  );
}

function NewMissionDialog({ open, onOpenChange, snapshot, activeWorkspaceId, onSubmitted }: { open: boolean; onOpenChange: (open: boolean) => void; snapshot: MissionControlSnapshot; activeWorkspaceId: string | null; onSubmitted: (missionId: string) => Promise<void> }) {
  const [goal, setGoal] = useState("");
  const [agentId, setAgentId] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const eligibleAgents = snapshot.agents.filter((agent) => agent.status !== "offline");

  useEffect(() => {
    if (!open) return;
    setGoal("");
    setAgentId("");
    setError(null);
  }, [open]);

  async function submit() {
    const mission = goal.trim();
    if (!mission) {
      setError("Describe what you want your workforce to accomplish.");
      return;
    }
    if (eligibleAgents.length === 0) {
      setError("No eligible agent is currently available.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const response = await fetch("/api/mission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mission,
          requestId: `mission:${crypto.randomUUID()}`,
          ...(agentId ? { agentId } : {}),
          ...(activeWorkspaceId ? { workspaceId: activeWorkspaceId } : {})
        })
      });
      const result = (await response.json()) as { dispatchId?: string; error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "Mission could not be started.");
      if (!result.dispatchId) throw new Error("OpenClaw accepted the request without returning a mission reference.");
      onOpenChange(false);
      await onSubmitted(result.dispatchId);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mission could not be started.");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-xl rounded-[18px] p-4 sm:p-5">
        <DialogHeader>
          <DialogTitle>New mission</DialogTitle>
          <DialogDescription>What do you want your workforce to accomplish?</DialogDescription>
        </DialogHeader>
        <div className="space-y-4 py-1">
          <div>
            <Label htmlFor="mission-goal">Goal</Label>
            <Textarea id="mission-goal" value={goal} onChange={(event) => setGoal(event.target.value)} placeholder="Research our competitors and prepare a launch brief." className="mt-2 min-h-28 resize-y text-sm" disabled={submitting} />
          </div>
          <div>
            <Label htmlFor="mission-agent">Initial worker</Label>
            <select id="mission-agent" value={agentId} onChange={(event) => setAgentId(event.target.value)} disabled={submitting || eligibleAgents.length === 0} className="mt-2 h-11 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none focus-visible:ring-2 focus-visible:ring-ring/50">
              <option value="">Auto assign an eligible worker</option>
              {eligibleAgents.map((agent) => <option key={agent.id} value={agent.id}>{agent.name} ({agent.status})</option>)}
            </select>
            <p className="mt-1.5 text-xs leading-5 text-muted-foreground">Auto assign uses the existing deterministic AgentOS selection policy. It does not run a separate planner.</p>
          </div>
          {snapshot.diagnostics.health !== "healthy" ? <div className="flex items-start gap-2 rounded-lg border border-[hsl(var(--status-warning)/0.30)] bg-[hsl(var(--status-warning)/0.08)] p-3 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]"><AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" /><span>OpenClaw is not fully ready. Start will validate the live Gateway before creating runtime work.</span></div> : null}
          {error ? <p className="text-sm text-[hsl(var(--status-danger-foreground))]" role="alert">{error}</p> : null}
        </div>
        <DialogFooter className="gap-2 sm:justify-end">
          <Button variant="secondary" onClick={() => onOpenChange(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={() => void submit()} disabled={submitting || eligibleAgents.length === 0}>{submitting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" aria-hidden="true" /> : <Plus className="mr-1.5 h-4 w-4" aria-hidden="true" />}Start mission</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function formatAge(value: string | null) {
  if (!value) return "Awaiting runtime evidence";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Recently updated";
  const seconds = Math.max(0, Math.floor((Date.now() - timestamp) / 1000));
  if (seconds < 60) return "Just now";
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}
