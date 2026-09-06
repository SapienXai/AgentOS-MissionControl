"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, Check, ChevronRight, Inbox, Loader2, ShieldAlert, X } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import type { AttentionAction, AttentionItem, HumanControlInbox as HumanControlInboxPayload } from "@/lib/agentos/contracts";
import {
  HUMAN_CONTROL_INBOX_REFRESH_DEBOUNCE_MS,
  preserveQuestionAnswers,
  shouldScheduleHumanControlRefresh
} from "@/components/operations/human-control-inbox.utils";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

export function HumanControlInbox({ surfaceTheme, attentionRefreshGeneration, mode = "card", missionId = null }: { surfaceTheme: SurfaceTheme; attentionRefreshGeneration: number; mode?: "card" | "page"; missionId?: string | null }) {
  const [open, setOpen] = useState(false);
  const [payload, setPayload] = useState<HumanControlInboxPayload | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [answers, setAnswers] = useState<Record<string, string[]>>({});
  const refreshGenerationRef = useRef(attentionRefreshGeneration);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const deferredRefreshRef = useRef(false);
  const openRef = useRef(open);
  const loadingRef = useRef(loading);
  const pendingIdRef = useRef(pendingId);
  const loadInboxRef = useRef<() => Promise<void>>(async () => {});

  const visible = mode === "page" || open;
  openRef.current = visible;
  loadingRef.current = loading;
  pendingIdRef.current = pendingId;

  useEffect(() => {
    if (!visible || payload || loading || error) return;
    void loadInboxRef.current();
  }, [error, loading, mode, missionId, payload, visible]);

  async function loadInbox() {
    setLoading(true);
    setError(null);
    try {
      const query = missionId ? `?missionId=${encodeURIComponent(missionId)}` : "";
      const response = await fetch(`/api/human-control${query}`, { cache: "no-store" });
      const nextPayload = (await response.json()) as HumanControlInboxPayload & { error?: string };
      if (!response.ok || nextPayload.error) throw new Error(nextPayload.error || "Human Control is unavailable.");
      setPayload(nextPayload);
      setAnswers((current) => preserveQuestionAnswers(nextPayload.items, current));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "Human Control is unavailable.");
    } finally {
      setLoading(false);
    }
  }

  loadInboxRef.current = loadInbox;

  const scheduleInboxRefresh = useCallback(() => {
    if (refreshTimerRef.current) return;
    refreshTimerRef.current = setTimeout(() => {
      refreshTimerRef.current = null;
      if (!openRef.current) return;
      if (!shouldScheduleHumanControlRefresh({
        open: openRef.current,
        loading: loadingRef.current,
        pendingAction: Boolean(pendingIdRef.current)
      })) {
        deferredRefreshRef.current = true;
        return;
      }
      void loadInboxRef.current();
    }, HUMAN_CONTROL_INBOX_REFRESH_DEBOUNCE_MS);
  }, []);

  useEffect(() => {
    if (refreshGenerationRef.current === attentionRefreshGeneration) return;
    refreshGenerationRef.current = attentionRefreshGeneration;
    if (!visible) return;
    if (pendingId || loading) {
      deferredRefreshRef.current = true;
      return;
    }
    scheduleInboxRefresh();
  }, [attentionRefreshGeneration, loading, mode, pendingId, scheduleInboxRefresh, visible]);

  useEffect(() => {
    if (!visible || pendingId || loading || !deferredRefreshRef.current) return;
    deferredRefreshRef.current = false;
    scheduleInboxRefresh();
  }, [loading, pendingId, scheduleInboxRefresh, visible]);

  useEffect(() => () => {
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
  }, []);

  async function runAction(item: AttentionItem, action: AttentionAction["id"], actionPayload?: { answers: { answers: Record<string, string[]> } }) {
    setPendingId(item.id);
    setError(null);
    try {
      const response = await fetch("/api/human-control/action", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action, itemId: item.id, ...actionPayload })
      });
      const result = (await response.json()) as { error?: string };
      if (!response.ok || result.error) throw new Error(result.error || "The action could not be completed.");
      setPayload(null);
      setAnswers({});
      deferredRefreshRef.current = false;
      await loadInbox();
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : "The action could not be completed.");
    } finally {
      setPendingId(null);
    }
  }

  const summary = payload?.summary;
  const inboxContent = (
    <div className={cn("flex min-h-0 flex-col gap-3", mode === "page" ? "" : "max-h-[min(88dvh,760px)] overflow-hidden")}>
      {payload?.issues?.length ? <div className="rounded-lg border border-[hsl(var(--status-warning)/0.30)] bg-[hsl(var(--status-warning)/0.08)] p-3 text-xs leading-5 text-[hsl(var(--status-warning-foreground))]" role="status"><div className="flex items-start gap-2"><AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden="true" /><div><p className="font-semibold">Some OpenClaw attention state could not be verified.</p><ul className="mt-1 list-disc space-y-0.5 pl-4">{payload.issues.map((issue) => <li key={issue}>{issue}</li>)}</ul></div></div></div> : null}
      {loading ? (
        <div className="flex items-center justify-center gap-2 py-12 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />Loading current attention…</div>
      ) : error ? (
        <div className="rounded-lg border border-[hsl(var(--status-danger)/0.30)] bg-[hsl(var(--status-danger)/0.08)] p-3 text-sm text-[hsl(var(--status-danger-foreground))]" role="alert">{error}<Button variant="secondary" size="sm" className="mt-3 h-8 rounded-lg text-xs" onClick={() => { setPayload(null); void loadInbox(); }}>Try again</Button></div>
      ) : payload?.items.length ? (
        <div className={cn("space-y-2", mode === "page" ? "" : "min-h-0 overflow-y-auto pr-1")}>{payload.items.map((item) => <AttentionRow key={item.id} item={item} pending={pendingId === item.id} answers={answers} onAnswerChange={(questionId, values) => setAnswers((current) => ({ ...current, [questionId]: values }))} onAction={(action, actionPayload) => void runAction(item, action, actionPayload)} />)}</div>
      ) : (
        <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border p-10 text-center"><Check className="h-7 w-7 text-[hsl(var(--status-success-foreground))]" aria-hidden="true" /><p className="mt-3 text-sm font-semibold text-foreground">Nothing needs your attention</p><p className="mt-1 max-w-sm text-xs leading-5 text-muted-foreground">{payload?.issues?.length ? "No verified pending items are currently available." : "OpenClaw has no current approvals, questions, suggestions, or actionable blockers."}</p></div>
      )}
    </div>
  );

  if (mode === "page") {
    return <section className="flex min-w-0 flex-col gap-3"><div className="flex items-start gap-2.5"><div className="mt-0.5 rounded-lg border border-[hsl(var(--status-warning)/0.25)] bg-[hsl(var(--status-warning)/0.10)] p-2 text-[hsl(var(--status-warning-foreground))]"><Inbox className="h-4 w-4" aria-hidden="true" /></div><div><h1 className="font-display text-[1.48rem] font-semibold leading-tight text-foreground">Human Control</h1><p className="mt-1.5 text-xs leading-5 text-muted-foreground">Every unresolved approval, question, blocker, and recovery decision in one operator queue.</p></div></div>{summary ? <InboxSummary summary={summary} /> : null}{inboxContent}</section>;
  }

  return <section className={cn("cockpit-panel rounded-xl border p-3", surfaceTheme === "dark" ? "border-border/80" : "border-border")}><div className="flex items-start justify-between gap-3"><div className="flex min-w-0 items-start gap-2.5"><div className="mt-0.5 rounded-lg border border-[hsl(var(--status-warning)/0.25)] bg-[hsl(var(--status-warning)/0.10)] p-2 text-[hsl(var(--status-warning-foreground))]"><Inbox className="h-4 w-4" aria-hidden="true" /></div><div className="min-w-0"><p className="text-sm font-semibold text-foreground">Needs your attention</p><p className="mt-1 text-xs leading-5 text-muted-foreground">{summary ? `${summary.totalPending} pending item${summary.totalPending === 1 ? "" : "s"}.` : "Review approvals, questions, and active blockers."}</p></div></div><Button size="sm" variant="secondary" className="h-8 shrink-0 rounded-lg px-2.5 text-xs" onClick={() => setOpen(true)}>{summary ? "View all" : "Open queue"}<ChevronRight className="ml-1 h-3.5 w-3.5" aria-hidden="true" /></Button></div>{summary ? <InboxSummary summary={summary} /> : null}<Dialog open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) { setPayload(null); setError(null); setAnswers({}); } }}><DialogContent className="flex max-h-[min(88dvh,760px)] max-w-2xl flex-col gap-3 overflow-hidden rounded-[18px] p-4 sm:p-5"><DialogHeader className="pr-8"><DialogTitle className="text-lg">Needs your attention</DialogTitle><DialogDescription className="text-xs leading-5">Current OpenClaw items that need an operator decision or action.</DialogDescription></DialogHeader>{inboxContent}</DialogContent></Dialog></section>;
}

function InboxSummary({ summary }: { summary: HumanControlInboxPayload["summary"] }) {
  const values = [
    ["Approvals", summary.approvals],
    ["Questions", summary.questions],
    ["Suggested work", summary.suggestedWork],
    ["Setup / blockers", summary.setupAndBlockers]
  ] as const;
  return <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">{values.map(([label, value]) => <div key={label} className="rounded-lg border border-border/70 bg-background/30 px-2.5 py-2"><p className="text-[0.58rem] font-semibold uppercase tracking-[0.12em] text-muted-foreground">{label}</p><p className="mt-1 text-sm font-semibold text-foreground">{value}</p></div>)}</div>;
}

function AttentionRow({
  item,
  pending,
  answers,
  onAnswerChange,
  onAction
}: {
  item: AttentionItem;
  pending: boolean;
  answers: Record<string, string[]>;
  onAnswerChange: (questionId: string, values: string[]) => void;
  onAction: (action: AttentionAction["id"], payload?: { answers: { answers: Record<string, string[]> } }) => void;
}) {
  const typeLabel = item.type === "suggested-work" ? "Suggested work" : item.type === "runtime-issue" ? "Runtime issue" : item.type === "needs-setup" ? "Needs setup" : item.type === "blocked" ? "Blocked" : item.type === "approval" ? "Approval" : "Question";
  const isQuestion = item.type === "question";
  const primaryAction = item.availableActions.find((action) => ["approve", "answer", "accept", "open-setup", "review-policy", "inspect"].includes(action.id));
  const secondaryActions = item.availableActions.filter((action) => action !== primaryAction && ["deny", "dismiss", "review"].includes(action.id));
  const canAnswer = isQuestion && item.question?.every((question) => (answers[question.questionId] ?? []).length > 0);

  return (
    <article className="rounded-xl border border-border/80 bg-card/55 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className={cn("rounded-full px-2 py-0.5 text-[0.58rem] font-semibold uppercase tracking-[0.12em]", item.severity === "critical" ? "bg-[hsl(var(--status-danger)/0.13)] text-[hsl(var(--status-danger-foreground))]" : item.severity === "high" ? "bg-[hsl(var(--status-warning)/0.13)] text-[hsl(var(--status-warning-foreground))]" : "bg-muted text-muted-foreground")}>{typeLabel}</span>
            {item.worker.label ? <span className="truncate text-[0.68rem] font-medium text-muted-foreground">{item.worker.label}</span> : null}
          </div>
          <h3 className="mt-2 text-sm font-semibold text-foreground">{item.title}</h3>
          <p className="mt-1 text-xs leading-5 text-muted-foreground">{item.summary}</p>
          {item.mission?.title ? <p className="mt-1 text-[0.68rem] text-muted-foreground">Mission: {item.mission.title}</p> : null}
          {item.createdAt ? <p className="mt-1 text-[0.65rem] text-muted-foreground/80">{formatAttentionTime(item.createdAt)}</p> : null}
        </div>
        {item.type === "runtime-issue" ? <AlertTriangle className="mt-1 h-4 w-4 shrink-0 text-[hsl(var(--status-warning-foreground))]" aria-hidden="true" /> : item.type === "approval" ? <ShieldAlert className="mt-1 h-4 w-4 shrink-0 text-[hsl(var(--status-warning-foreground))]" aria-hidden="true" /> : null}
      </div>
      {isQuestion ? <QuestionAnswer item={item} answers={answers} onAnswerChange={onAnswerChange} /> : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {primaryAction?.id === "approve" || primaryAction?.id === "answer" || primaryAction?.id === "accept" ? (
          <Button size="sm" className="h-8 rounded-lg px-3 text-xs" disabled={pending || (primaryAction.id === "answer" && !canAnswer)} onClick={() => onAction(primaryAction.id, primaryAction.id === "answer" ? { answers: { answers } } : undefined)}>
            {pending ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" aria-hidden="true" /> : null}
            {pending ? "Resolving…" : primaryAction.label}
          </Button>
        ) : primaryAction && ["open-setup", "review-policy", "inspect"].includes(primaryAction.id) ? (
          <Button asChild size="sm" variant="secondary" className="h-8 rounded-lg px-3 text-xs"><Link href={linkForAction(primaryAction.id)}>{primaryAction.label}</Link></Button>
        ) : null}
        {secondaryActions.map((action) => action.id === "review" ? <Button key={action.id} asChild size="sm" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs"><Link href={item.mission?.id ? `/missions/${encodeURIComponent(item.mission.id)}` : "/missions"}>{action.label}</Link></Button> : <Button key={action.id} size="sm" variant="ghost" className="h-8 rounded-lg px-2.5 text-xs" disabled={pending} onClick={() => onAction(action.id)}>{action.id === "deny" ? <X className="mr-1 h-3.5 w-3.5" aria-hidden="true" /> : null}{action.label}</Button>)}
      </div>
    </article>
  );
}

function QuestionAnswer({ item, answers, onAnswerChange }: { item: AttentionItem; answers: Record<string, string[]>; onAnswerChange: (questionId: string, values: string[]) => void }) {
  return <div className="mt-3 space-y-3">{item.question?.map((question) => {
    const selected = answers[question.questionId] ?? [];
    return <div key={question.questionId} className="space-y-2"><p className="text-xs font-medium text-foreground">{question.text}</p>{question.options.length > 0 ? <div className="flex flex-wrap gap-1.5">{question.options.map((option) => { const active = selected.includes(option.label); return <button key={option.label} type="button" className={cn("rounded-lg border px-2.5 py-1.5 text-xs transition-colors", active ? "border-primary bg-primary/10 text-foreground" : "border-border text-muted-foreground hover:bg-muted hover:text-foreground")} onClick={() => onAnswerChange(question.questionId, question.multiSelect ? active ? selected.filter((value) => value !== option.label) : [...selected, option.label] : [option.label])}>{option.label}</button>; })}</div> : null}{question.options.length === 0 || question.isOther ? question.isSecret ? <Input type="password" value={selected[0] ?? ""} onChange={(event) => onAnswerChange(question.questionId, [event.target.value])} placeholder="Enter a private answer…" className="text-xs" aria-label={`Private answer: ${question.text}`} /> : <Textarea value={selected[0] ?? ""} onChange={(event) => onAnswerChange(question.questionId, [event.target.value])} placeholder="Type your answer…" className="min-h-20 text-xs" aria-label={`Answer: ${question.text}`} /> : null}</div>;
  })}</div>;
}

function linkForAction(action: AttentionAction["id"]) {
  if (action === "open-setup") return "/accounts";
  if (action === "review-policy") return "/settings#gateway";
  return "/operations";
}

function formatAttentionTime(value: string) {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) return value;
  const minutes = Math.max(0, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 1) return "Just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}
