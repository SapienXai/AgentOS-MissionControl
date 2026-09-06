"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ArrowLeft, Ban, Bot, ChevronRight, Clock3, ExternalLink, FileText, Play, RefreshCw, ShieldAlert } from "lucide-react";

import { EmptyState, KeyValue, PageHeader, SectionCard, StatusBadge } from "@/components/operations/operations-ui";
import { Button } from "@/components/ui/button";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { WorkforceMissionProjection, WorkforceTimelineEvent } from "@/lib/agentos/workforce/types";
import { cn } from "@/lib/utils";

export function MissionDetailPage({
  initial,
  snapshot,
  connectionState,
  attentionRefreshGeneration,
  refresh
}: {
  initial: WorkforceMissionProjection;
  snapshot: MissionControlSnapshot;
  connectionState: "connecting" | "live" | "retrying";
  attentionRefreshGeneration: number;
  refresh: () => Promise<void>;
}) {
  const [mission, setMission] = useState(initial);
  const [loading, setLoading] = useState(false);
  const [actionPending, setActionPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function loadMission() {
    setLoading(true);
    try {
      const response = await fetch(`/api/missions/${encodeURIComponent(initial.id)}`, { cache: "no-store" });
      const next = (await response.json()) as WorkforceMissionProjection & { error?: string };
      if (!response.ok || next.error) throw new Error(next.error || "Mission details are unavailable.");
      setMission(next);
      setError(null);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Mission details are unavailable.");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadMission();
    // The shared Mission Control stream is the refresh trigger. This keeps
    // mission detail event-driven without opening one poller per mission.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [attentionRefreshGeneration, connectionState, snapshot.revision]);

  async function cancelMission() {
    if (!mission.availableActions.canCancel || actionPending) return;
    if (!window.confirm("Stop this mission and its current runtime work?")) return;
    const targetId = mission.rootTaskId ?? mission.dispatchId;
    if (!targetId) return;
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(targetId)}/abort`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ dispatchId: mission.dispatchId, reason: "Stopped from Workforce mission control." })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "The mission could not be stopped.");
      await refresh();
      await loadMission();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The mission could not be stopped.");
    } finally {
      setActionPending(false);
    }
  }

  async function resumeMission() {
    if (!mission.availableActions.canResume || actionPending || !mission.rootTaskId) return;
    setActionPending(true);
    setError(null);
    try {
      const response = await fetch(`/api/tasks/${encodeURIComponent(mission.rootTaskId)}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "continue",
          message: "Continue from the last confirmed runtime state.",
          dispatchId: mission.dispatchId,
          idempotencyKey: `mission:${mission.id}:continue`
        })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "The mission could not be resumed.");
      await refresh();
      await loadMission();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The mission could not be resumed.");
    } finally {
      setActionPending(false);
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-3">
      <div className="flex items-center justify-between gap-2">
        <Link href="/missions" className="inline-flex items-center gap-1 text-xs font-semibold text-muted-foreground hover:text-foreground">
          <ArrowLeft className="h-3.5 w-3.5" aria-hidden="true" /> Workforce
        </Link>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => void loadMission()} disabled={loading} className="h-9 rounded-lg px-2.5 text-xs">
            <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", loading && "animate-spin")} aria-hidden="true" /> Refresh
          </Button>
          {mission.availableActions.canResume ? <Button variant="secondary" size="sm" onClick={() => void resumeMission()} disabled={actionPending} className="h-9 rounded-lg px-2.5 text-xs"><Play className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {actionPending ? "Resuming…" : "Resume"}</Button> : null}
          {mission.availableActions.canCancel ? <Button variant="secondary" size="sm" onClick={() => void cancelMission()} disabled={actionPending} className="h-9 rounded-lg px-2.5 text-xs text-[hsl(var(--status-danger-foreground))]"><Ban className="mr-1.5 h-3.5 w-3.5" aria-hidden="true" /> {actionPending ? "Stopping…" : "Stop"}</Button> : null}
        </div>
      </div>

      <PageHeader title={mission.title} subtitle={mission.goal}>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge label={mission.stateLabel} tone={stateTone(mission.state)} />
          <span className="text-xs text-muted-foreground">{mission.primaryAgentName}</span>
          {mission.workspaceName ? <span className="text-xs text-muted-foreground">· {mission.workspaceName}</span> : null}
          {mission.connection === "reconnecting" ? <span className="text-xs text-[hsl(var(--status-warning-foreground))]">· Runtime reconnecting</span> : null}
        </div>
      </PageHeader>

      {error ? <div className="rounded-lg border border-[hsl(var(--status-danger)/0.30)] bg-[hsl(var(--status-danger)/0.08)] p-3 text-sm text-[hsl(var(--status-danger-foreground))]" role="alert">{error}</div> : null}

      <section className={cn("rounded-xl border p-4", mission.state === "waiting-human" || mission.state === "blocked" || mission.state === "failed" ? "border-[hsl(var(--status-warning)/0.35)] bg-[hsl(var(--status-warning)/0.08)]" : "border-border bg-card/55")}>
        <div className="flex items-start gap-3">
          {mission.state === "waiting-human" || mission.state === "blocked" || mission.state === "failed" ? <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0 text-[hsl(var(--status-warning-foreground))]" aria-hidden="true" /> : <Clock3 className="mt-0.5 h-5 w-5 shrink-0 text-primary" aria-hidden="true" />}
          <div className="min-w-0">
            <p className="text-sm font-semibold text-foreground">{currentStateTitle(mission)}</p>
            <p className="mt-1 text-xs leading-5 text-muted-foreground">{currentStateDetail(mission)}</p>
            {mission.humanControlItems.length > 0 ? <Link href={`/human-control?missionId=${encodeURIComponent(mission.id)}`} className="mt-3 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline">Open Human Control <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" /></Link> : null}
          </div>
        </div>
      </section>

      <div className="grid gap-3 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="flex min-w-0 flex-col gap-3">
          <SectionCard title="Active workers" action={<span className="text-[0.65rem] text-muted-foreground">{mission.activeWorkers.length}</span>}>
            {mission.activeWorkers.length > 0 ? <div className="grid gap-2 p-2 sm:grid-cols-2">{mission.activeWorkers.map((worker) => <div key={`${worker.taskId ?? worker.id ?? "worker"}:${worker.relationship}`} className="rounded-lg border border-border bg-background/35 p-3"><div className="flex items-start gap-2.5"><Bot className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><div className="min-w-0"><div className="flex flex-wrap items-center gap-2"><p className="truncate text-sm font-semibold text-foreground">{worker.name}</p><StatusBadge label={worker.state === "waiting-worker" ? "Waiting" : worker.state} tone={stateTone(worker.state)} /></div><p className="mt-1 line-clamp-2 text-xs leading-5 text-muted-foreground">{worker.activity}</p></div></div></div>)}</div> : <div className="p-3"><EmptyState title="No active workers" description={mission.state === "completed" ? "The mission has completed its primary work." : "OpenClaw has not exposed an active worker for this mission yet."} /></div>}
          </SectionCard>

          <SectionCard title="Work tree">
            {mission.workTree.length > 0 ? <div className="divide-y divide-border">{mission.workTree.map((item) => <div key={item.id} className="flex min-w-0 items-center gap-3 px-3 py-3"><div className={cn("h-2 w-2 shrink-0 rounded-full", item.relationship === "delegated" ? "bg-[hsl(var(--agentos-operational-accent))]" : "bg-primary")} aria-hidden="true" /><div className="min-w-0 flex-1"><p className={cn("truncate text-sm font-medium text-foreground", item.relationship === "delegated" && "pl-3")}>{item.title}</p><p className="mt-1 truncate text-xs text-muted-foreground">{item.agentName}{item.relationship === "delegated" ? " · delegated" : " · primary"}</p></div><StatusBadge label={item.state === "waiting-worker" ? "Waiting" : item.state} tone={stateTone(item.state)} /></div>)}</div> : <div className="p-3"><EmptyState title="Work tree is still forming" description="OpenClaw has not returned child-work evidence for this mission yet." /></div>}
          </SectionCard>

          <SectionCard title="Timeline">
            {mission.timeline.length > 0 ? <div className="divide-y divide-border">{mission.timeline.map((event) => <TimelineRow key={event.id} event={event} />)}</div> : <div className="p-3"><EmptyState title="No timeline events yet" description="Confirmed runtime and human-control events will appear here." /></div>}
          </SectionCard>
        </div>

        <div className="flex min-w-0 flex-col gap-3">
          <SectionCard title="Result">
            <div className="p-3">{mission.result ? <p className="whitespace-pre-wrap break-words text-sm leading-6 text-foreground">{mission.result}</p> : <p className="text-xs leading-5 text-muted-foreground">{mission.state === "completed" ? "The runtime completed without a saved final text result." : "The final result will appear here when primary mission work completes."}</p>}</div>
          </SectionCard>
          <SectionCard title="Artifacts" action={<span className="text-[0.65rem] text-muted-foreground">{mission.artifacts.length}</span>}>
            {mission.artifacts.length > 0 ? <div className="divide-y divide-border">{mission.artifacts.map((artifact) => <div key={artifact.id} className="flex items-center gap-2 px-3 py-2.5"><FileText className="h-4 w-4 shrink-0 text-primary" aria-hidden="true" /><span className="min-w-0 flex-1 truncate text-xs text-foreground">{artifact.displayPath || artifact.path}</span>{artifact.path.startsWith("http") ? <a href={artifact.path} target="_blank" rel="noreferrer" aria-label={`Open ${artifact.displayPath || artifact.path}`} className="text-primary"><ExternalLink className="h-3.5 w-3.5" aria-hidden="true" /></a> : null}</div>)}</div> : <div className="p-3"><EmptyState title="No artifacts recorded" description="Only files returned by the OpenClaw runtime are shown here." /></div>}
          </SectionCard>
          <SectionCard title="Execution summary">
            <div className="px-3 py-1"><KeyValue label="Started" value={formatDate(mission.startedAt)} /><KeyValue label="Duration" value={formatDuration(mission.durationMs)} /><KeyValue label="Worker" value={mission.primaryAgentName} /><KeyValue label="Runtime state" value={mission.connection === "reconnecting" ? "Reconnecting" : mission.stateLabel} /></div>
          </SectionCard>
          <details className="rounded-lg border border-border bg-card/45 p-3">
            <summary className="cursor-pointer list-none text-xs font-semibold text-foreground">Advanced runtime provenance</summary>
            <div className="mt-3 space-y-1.5 text-[0.68rem] text-muted-foreground"><p>Mission reference: <span className="font-mono text-foreground">{mission.id}</span></p><p>Dispatch: <span className="font-mono text-foreground">{mission.runtime.dispatchId ?? "Not bound"}</span></p><p>Tasks: <span className="font-mono text-foreground">{mission.runtime.taskIds.join(", ") || "None"}</span></p><p>Sessions: <span className="font-mono text-foreground">{mission.runtime.sessionIds.join(", ") || "None"}</span></p><p>Runtimes: <span className="font-mono text-foreground">{mission.runtime.runtimeIds.join(", ") || "None"}</span></p></div>
          </details>
        </div>
      </div>
    </div>
  );
}

function TimelineRow({ event }: { event: WorkforceTimelineEvent }) {
  return <div className="flex gap-3 px-3 py-3"><span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", event.kind === "failed" || event.kind === "blocked" ? "bg-[hsl(var(--status-danger))]" : event.kind === "approval" ? "bg-[hsl(var(--status-warning))]" : event.kind === "completed" ? "bg-[hsl(var(--status-success))]" : "bg-primary")} aria-hidden="true" /><div className="min-w-0 flex-1"><div className="flex flex-wrap items-baseline justify-between gap-2"><p className="text-xs font-semibold text-foreground">{event.title}</p><time dateTime={event.at} className="text-[0.65rem] text-muted-foreground">{formatDate(event.at)}</time></div>{event.detail ? <p className="mt-1 line-clamp-3 break-words text-xs leading-5 text-muted-foreground">{event.detail}</p> : null}{event.workerLabel ? <p className="mt-1 text-[0.65rem] text-muted-foreground">{event.workerLabel}</p> : null}</div></div>;
}

function currentStateTitle(mission: WorkforceMissionProjection) {
  if (mission.state === "waiting-human") return "Waiting for your decision";
  if (mission.state === "waiting-worker") return "Waiting for a delegated worker";
  if (mission.state === "reconnecting") return "OpenClaw is reconnecting";
  if (mission.state === "failed") return "Mission needs recovery";
  if (mission.state === "blocked") return "Mission is blocked";
  if (mission.state === "completed") return "Mission completed";
  if (mission.state === "queued") return "Mission queued";
  if (mission.state === "starting") return "Mission is starting";
  return `${mission.primaryAgentName} is working`;
}

function currentStateDetail(mission: WorkforceMissionProjection) {
  if (mission.humanControlItems[0]) return mission.humanControlItems[0].summary;
  if (mission.error) return mission.error;
  if (mission.state === "waiting-worker") return "The parent work is waiting for the child worker's authoritative result.";
  if (mission.state === "reconnecting") return "AgentOS temporarily lost the live Gateway connection. This is not a failure; confirmed runtime state will be restored when it reconnects.";
  if (mission.state === "completed") return mission.summary || "OpenClaw reported the primary mission work complete.";
  return mission.summary || "Current activity is limited to confirmed OpenClaw runtime evidence.";
}

function stateTone(state: WorkforceMissionProjection["state"] | "idle") {
  if (state === "completed") return "success" as const;
  if (state === "failed" || state === "blocked") return "danger" as const;
  if (state === "waiting-human") return "warning" as const;
  if (state === "waiting-worker" || state === "reconnecting" || state === "queued") return "purple" as const;
  return "info" as const;
}

function formatDate(value: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString([], { dateStyle: "medium", timeStyle: "short" });
}

function formatDuration(value: number | null) {
  if (value === null) return "Not available";
  const totalMinutes = Math.floor(value / 60_000);
  if (totalMinutes < 1) return "Less than a minute";
  if (totalMinutes < 60) return `${totalMinutes}m`;
  return `${Math.floor(totalMinutes / 60)}h ${totalMinutes % 60}m`;
}
