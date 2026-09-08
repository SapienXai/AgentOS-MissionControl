import type { OperationJob, OperationRun, OperationsSnapshot } from "@/lib/agentos/operations/types";
import type { OpenClawAgent, TaskRecord } from "@/lib/openclaw/types";

/** A read-only task-card projection of OpenClaw cron jobs. It never schedules work. */
export function buildOperationTaskProjections(snapshot: OperationsSnapshot, agents: OpenClawAgent[]): TaskRecord[] {
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  return snapshot.jobs.map((job) => buildOperationTaskProjection(job, agentNames, snapshot.runs));
}

/** System-owned OpenClaw monitors stay authoritative but are not operator task cards. */
export function isSystemOwnedMonitorTask(task: Pick<TaskRecord, "metadata">) {
  return task.metadata?.systemOwnedMonitor === "heartbeat" || task.metadata?.systemOwnedMonitor === "skill-collection-review";
}

/**
 * Reconciles a Gateway runtime task with its cron job projection. A cron run is
 * represented by both data sources, but operators must see one card and the
 * cron run history is authoritative for terminal success or failure.
 */
export function mergeOperationTaskProjections(
  snapshot: OperationsSnapshot,
  runtimeTasks: TaskRecord[],
  agents: OpenClawAgent[]
): TaskRecord[] {
  const jobsById = new Map(snapshot.jobs.map((job) => [job.id, job]));
  const runtimeJobIds = new Set<string>();
  const mergedRuntimeTasks = runtimeTasks.map((task) => {
    const jobId = operationJobIdForRuntimeTask(task, jobsById);
    if (!jobId) return task;
    runtimeJobIds.add(jobId);
    const job = jobsById.get(jobId)!;
    const latestRun = latestOperationRun(snapshot.runs, jobId);
    const operationRuns = snapshot.runs.filter((run) => run.jobId === jobId);
    const operationTokenUsage = aggregateOperationTokenUsage(operationRuns);
    const status = terminalTaskStatus(job, latestRun) ?? reconcileRecurringTaskStatus(job, task.status);
    const recoveredSchedule = isRecoveredRecurringSchedule(job, status);
    const detail = latestRun?.status === "error" ? latestRun.error ?? "OpenClaw cron run failed."
      : latestRun?.status === "ok" ? latestRun.output ?? "OpenClaw cron run completed."
      : null;
    return {
      ...task,
      // Keep the canvas/Inspector identity stable while OpenClaw creates and later removes per-run runtime tasks.
      id: `operation:${job.id}`,
      key: `openclaw-cron:${job.id}`,
      status,
      subtitle: detail ?? `${task.subtitle} · ${describeSchedule(job)}`,
      runtimeCount: Math.max(task.runtimeCount, operationRuns.length),
      tokenUsage: operationTokenUsage ?? task.tokenUsage,
      liveRunCount: status === "running" ? task.liveRunCount : 0,
      warningCount: recoveredSchedule
        ? (job.health.degraded ? 1 : 0)
        : Math.max(task.warningCount, job.health.degraded || status === "stalled" ? 1 : 0),
      metadata: {
        ...task.metadata,
        ...operationMetadata(job, snapshot.runs),
        operationRunId: latestRun?.id ?? null,
        operationCronRunId: latestRun?.cronRunId ?? null,
        operationIdentityProvenance: latestRun?.identityProvenance ?? "heuristic",
        operationSourceOfTruth: latestRun?.sourceOfTruth ?? "compatibility",
        operationRunStatus: latestRun?.status ?? null,
        operationLastError: latestRun?.error ?? null
      }
    };
  });
  const projections = buildOperationTaskProjections(snapshot, agents);
  return [...dedupeCanonicalOperationTasks(mergedRuntimeTasks), ...projections.filter((task) => !runtimeJobIds.has(String(task.metadata.operationJobId)))];
}

function dedupeCanonicalOperationTasks(tasks: TaskRecord[]) {
  const byId = new Map<string, TaskRecord>();
  for (const task of tasks) {
    const existing = byId.get(task.id);
    if (!existing || operationTaskPriority(task) > operationTaskPriority(existing)) byId.set(task.id, task);
  }
  return Array.from(byId.values());
}

function operationTaskPriority(task: TaskRecord) {
  const live = task.status === "running" || task.liveRunCount > 0 ? 1_000_000_000_000_000 : 0;
  return live + (task.updatedAt ?? 0);
}

function buildOperationTaskProjection(job: OperationJob, agentNames: Map<string, string>, runs: OperationRun[]): TaskRecord {
  const updatedAt = job.lastRunAt ? Date.parse(job.lastRunAt) : job.nextRunAt ? Date.parse(job.nextRunAt) : null;
  const operationRuns = runs.filter((run) => run.jobId === job.id);
  return {
    id: `operation:${job.id}`, key: `openclaw-cron:${job.id}`, title: job.name, mission: job.prompt,
    subtitle: describeSchedule(job), status: taskStatus(job), updatedAt: Number.isFinite(updatedAt) ? updatedAt : null, ageMs: null,
    workspaceId: job.workspaceId ?? undefined, primaryAgentId: job.agentId ?? undefined,
    primaryAgentName: job.agentId ? agentNames.get(job.agentId) ?? job.agentId : null,
    runtimeIds: [], agentIds: job.agentId ? [job.agentId] : [],
    sessionIds: uniqueStrings(operationRuns.map((run) => run.sessionId)),
    runIds: uniqueStrings(operationRuns.map((run) => run.cronRunId)), runtimeCount: operationRuns.length, updateCount: 0,
    liveRunCount: job.status === "running" ? 1 : 0, artifactCount: 0, warningCount: job.health.degraded ? 1 : 0,
    tokenUsage: aggregateOperationTokenUsage(operationRuns),
    metadata: operationMetadata(job, runs)
  };
}

function operationMetadata(job: OperationJob, runs: OperationRun[]) {
  const operationRuns = runs
    .filter((run) => run.jobId === job.id)
    .sort((left, right) => Date.parse(right.endedAt ?? right.startedAt ?? "") - Date.parse(left.endedAt ?? left.startedAt ?? ""))
    .slice(0, 24)
    .map((run) => {
      const base = { id: run.id, timestamp: run.endedAt ?? run.startedAt ?? new Date().toISOString(), status: run.status, output: run.output, error: run.error, durationMs: run.durationMs, tokens: run.tokens };
      const hasIdentityEvidence = Boolean(run.cronRunId || run.taskId || run.sessionKey || run.sessionId || run.identityProvenance || run.sourceOfTruth);
      return hasIdentityEvidence
        ? { ...base, cronRunId: run.cronRunId ?? null, taskId: run.taskId ?? null, identityProvenance: run.identityProvenance ?? "heuristic", sourceOfTruth: run.sourceOfTruth ?? "compatibility" }
        : base;
    });
  if (operationRuns.length === 0 && job.lastRunStatus === "error" && job.lastRunAt) {
    operationRuns.push({ id: `last-error:${job.id}:${job.lastRunAt}`, timestamp: job.lastRunAt, status: "error", output: null, error: null, durationMs: null, tokens: null });
  }
  const latestRun = latestOperationRun(runs, job.id);
  return { source: "openclaw-cron", operationJobId: job.id, automationId: job.automationId ?? null, cronJobId: job.cronJobId ?? job.id, cronRunId: latestRun?.cronRunId ?? null, systemOwnedMonitor: job.systemOwnedMonitor ?? null, identityProvenance: latestRun?.identityProvenance ?? (job.cronJobId ? "authoritative" : "heuristic"), sourceOfTruth: latestRun?.sourceOfTruth ?? (job.cronJobId ? "openclaw.cron.job" : "compatibility"), scheduleLabel: describeSchedule(job), scheduledAt: job.nextRunAt,
    dueLabel: job.nextRunAt ? `Next run ${new Date(job.nextRunAt).toLocaleString()}` : "No next run reported", cronExpression: job.trigger?.kind === "cron" ? job.trigger.expression : null,
    timezone: job.trigger?.kind === "cron" ? job.trigger.timezone : null, lastRunStatus: job.lastRunStatus, operationStatus: job.status,
    recurrence: job.trigger?.kind ?? null, concurrency: job.safety?.concurrency ?? null, nextRunAt: job.nextRunAt,
    triggerAt: job.trigger?.kind === "at" ? job.trigger.at : null, intervalMs: job.trigger?.kind === "every" ? job.trigger.everyMs : null,
    resultPreview: job.latestOutput ?? null, openClawSessionKey: job.sessionKey ?? null, openClawSessionId: job.sessionId ?? null,
    operationFeed: job.recentResults?.map((result) => ({ id: `operation:${job.id}:${result.timestamp}:${result.id}`, kind: "assistant", timestamp: result.timestamp, title: "Scheduled result", detail: result.text })) ?? [],
    operationRunHistory: operationRuns,
    operationRunCount: runs.filter((run) => run.jobId === job.id).length,
    operationRecoveryHistory: buildOperationRecoveryHistory(job) };
}

function uniqueStrings(values: Array<string | null | undefined>) {
  return [...new Set(values.filter((value): value is string => Boolean(value && value.trim())))];
}

function aggregateOperationTokenUsage(runs: OperationRun[]): TaskRecord["tokenUsage"] {
  const reported = runs
    .map((run) => run.tokens)
    .filter((tokens): tokens is number => typeof tokens === "number" && Number.isFinite(tokens));
  if (reported.length === 0) return undefined;
  return { input: 0, output: 0, total: reported.reduce((total, tokens) => total + tokens, 0) };
}

function buildOperationRecoveryHistory(job: OperationJob) {
  if (job.trigger?.kind !== "every" || !job.recentResults || job.recentResults.length < 2) return [];
  const intervalMs = job.trigger.everyMs;
  const results = [...job.recentResults]
    .filter((result) => Number.isFinite(Date.parse(result.timestamp)))
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp));
  const events: Array<{ id: string; timestamp: string; status: "missed" | "recovered"; detail: string; missedCount: number }> = [];

  for (let index = 1; index < results.length; index += 1) {
    const previous = results[index - 1];
    const current = results[index];
    if (!previous || !current) continue;
    const previousAt = Date.parse(previous.timestamp);
    const currentAt = Date.parse(current.timestamp);
    const gapMs = currentAt - previousAt;
    if (gapMs < intervalMs * 1.75) continue;
    const missedCount = Math.max(1, Math.round(gapMs / intervalMs) - 1);
    const firstExpectedAt = new Date(previousAt + intervalMs).toISOString();
    events.push({
      id: `missed:${job.id}:${firstExpectedAt}`,
      timestamp: firstExpectedAt,
      status: "missed",
      missedCount,
      detail: `Possible missed schedule: AgentOS observed no Gateway result for ${missedCount} expected run${missedCount === 1 ? "" : "s"}. The device, network, Gateway, or provider may have been unavailable; OpenClaw did not provide a definitive missed-run record.`
    });
    events.push({
      id: `recovered:${job.id}:${current.timestamp}`,
      timestamp: current.timestamp,
      status: "recovered",
      missedCount,
      detail: `Schedule recovered automatically when the next Gateway result arrived. ${job.nextRunAt ? `The next run is ${new Date(job.nextRunAt).toLocaleString()}.` : "No next run is currently reported."}`
    });
  }

  return events.slice(-12);
}

function operationJobIdForRuntimeTask(task: TaskRecord, jobsById: Map<string, OperationJob>) {
  const direct = typeof task.metadata.operationJobId === "string" ? task.metadata.operationJobId : null;
  if (direct && jobsById.has(direct)) return direct;
  const cronJobId = typeof task.metadata.cronJobId === "string" ? task.metadata.cronJobId : null;
  if (cronJobId && jobsById.has(cronJobId)) return cronJobId;
  const runIds = [
    ...task.runIds,
    typeof task.metadata.cronRunId === "string" ? task.metadata.cronRunId : "",
    typeof task.metadata.operationCronRunId === "string" ? task.metadata.operationCronRunId : "",
    typeof task.metadata.openClawRunId === "string" ? task.metadata.openClawRunId : ""
  ];
  const sessionKeys = [
    typeof task.metadata.openClawSessionKey === "string" ? task.metadata.openClawSessionKey : "",
    typeof task.metadata.continuationSessionKey === "string" ? task.metadata.continuationSessionKey : "",
    task.key
  ];
  for (const [jobId, job] of jobsById) {
    const exactRun = runIds.some((runId) =>
      snapshotRunIdMatches(runId, jobId)
    );
    if (exactRun) return jobId;
    const exactSession = sessionKeys.some((sessionKey) => sessionKey && (
      sessionKey === job.sessionKey ||
      sessionKey === `cron:${jobId}`
    ));
    if (exactSession) return jobId;
  }
  // Compatibility for pre-5B runtime records. These matches are intentionally
  // last and are not treated as authoritative identity evidence.
  return [...jobsById.keys()].find((jobId) =>
    runIds.some((runId) => runId.startsWith(`cron:${jobId}:`)) ||
    sessionKeys.some((sessionKey) => sessionKey.includes(`:cron:${jobId}`))
  ) ?? null;
}

function snapshotRunIdMatches(runId: string, jobId: string) {
  return runId === jobId || runId.startsWith(`${jobId}:`) || runId.startsWith(`cron:${jobId}:`);
}

function latestOperationRun(runs: OperationRun[], jobId: string) {
  return runs.filter((run) => run.jobId === jobId).sort((left, right) => Date.parse(right.endedAt ?? right.startedAt ?? "") - Date.parse(left.endedAt ?? left.startedAt ?? ""))[0] ?? null;
}

function terminalTaskStatus(job: OperationJob, latestRun: OperationRun | null): TaskRecord["status"] | null {
  if (latestRun?.status === "error" || job.status === "failed") return "stalled";
  if (latestRun?.status === "ok" && job.trigger?.kind === "at") return "completed";
  if (job.status === "completed") return "completed";
  return null;
}

function reconcileRecurringTaskStatus(job: OperationJob, runtimeStatus: TaskRecord["status"]): TaskRecord["status"] {
  const recurring = job.trigger?.kind === "every" || job.trigger?.kind === "cron";
  if (!recurring) return runtimeStatus;
  if (job.status === "running" || runtimeStatus === "running") return "running";
  if (job.status === "paused") return "cancelled";
  // A laptop sleep/network interruption can leave a stale terminal runtime in
  // the Gateway task snapshot. The live cron job remains authoritative: when
  // it has a next run, keep the operation scheduled and retain the interrupted
  // run only as history evidence.
  if ((job.status === "active" || job.status === "scheduled") && job.nextRunAt) return "queued";
  return runtimeStatus;
}

function isRecoveredRecurringSchedule(job: OperationJob, status: TaskRecord["status"]) {
  return status === "queued" &&
    (job.trigger?.kind === "every" || job.trigger?.kind === "cron") &&
    (job.status === "active" || job.status === "scheduled") &&
    Boolean(job.nextRunAt);
}

function taskStatus(job: OperationJob): TaskRecord["status"] {
  if (job.status === "running") return "running";
  if (job.status === "failed") return "stalled";
  if (job.status === "paused") return "cancelled";
  if (job.status === "completed") return "completed";
  return "queued";
}

export function describeSchedule(job: OperationJob) {
  if (!job.trigger) return "OpenClaw schedule unavailable";
  if (job.trigger.kind === "at") return `One time · ${new Date(job.trigger.at).toLocaleString()}`;
  if (job.trigger.kind === "every") return `Every ${formatInterval(job.trigger.everyMs)}`;
  return `${job.trigger.expression} · ${job.trigger.timezone ?? "Gateway local time"}`;
}
function formatInterval(ms: number) { return ms % 3_600_000 === 0 ? `${ms / 3_600_000}h` : ms % 60_000 === 0 ? `${ms / 60_000}m` : `${Math.round(ms / 1_000)}s`; }
