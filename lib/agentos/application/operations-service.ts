import "server-only";

import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { resolveAccountAccessDecision } from "@/lib/agentos/application/account-access-policy-service";
import type { OperationAction, OperationAuditEntry, OperationJob, OperationJobInput, OperationResult, OperationRun, OperationsSnapshot, SystemOwnedMonitorKind } from "@/lib/agentos/operations/types";
import { extractAgentChatMessagesFromSessionHistory } from "@/lib/openclaw/agent-chat-response";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawCapabilityMatrix } from "@/lib/openclaw/application/capability-matrix-service";
import { automationExecutionIdentityFromCron } from "@/lib/openclaw/domains/execution-identity";
import { missionControlRootPath } from "@/lib/openclaw/state/paths";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";

type Registry = {
  version: 2;
  jobs: Record<string, {
    workspaceId: string;
    safety: NonNullable<OperationJob["safety"]>;
    automationId?: string | null;
    declarationKey?: string | null;
    sessionTarget?: string | null;
    idempotencyKey?: string | null;
  }>;
  audit: OperationAuditEntry[];
  results: Record<string, OperationResult[]>;
};
const registryPath = path.join(missionControlRootPath, "operations", "registry.json");
let registryMutationTail: Promise<void> = Promise.resolve();
const operationOutputCache = new Map<string, { value: Pick<OperationJob, "latestOutput" | "recentResults" | "sessionKey" | "sessionId">; expiresAt: number }>();
const operationOutputCacheTtlMs = 5 * 60_000;

export type OperationRequestContext = {
  actor?: {
    actorId: string;
    kind: string;
    authenticationMethod: string;
  };
};

function withRegistryMutation<T>(operation: () => Promise<T>) {
  const result = registryMutationTail.then(operation, operation);
  registryMutationTail = result.then(() => undefined, () => undefined);
  return result;
}

export async function getOperationsSnapshot(): Promise<OperationsSnapshot> {
  const [registry, matrix] = await Promise.all([readRegistry(), getOpenClawCapabilityMatrix().catch(() => null)]);
  const cronRead = matrix?.cronRead ?? "unknown";
  const cronWrite = matrix?.operations?.cronWrite?.mode === "gateway-native";
  const runHistory = matrix?.operations?.cronRunHistory?.mode === "gateway-native";
  if (cronRead === "unsupported") {
    return unavailableSnapshot(registry.audit, "OpenClaw Gateway did not advertise cron.read. Operations stays read-only until the capability is available.");
  }
  try {
    const adapter = getOpenClawAdapter();
    const [status, payload] = await Promise.all([adapter.getCronStatus(), adapter.listCronJobs({ includeDisabled: true })]);
    const rawJobs = Array.isArray(payload.jobs) ? payload.jobs : [];
    const jobs = rawJobs.map((value) => normalizeOpenClawOperationJob(value, registry.jobs, cronWrite, runHistory));
    const runs = runHistory
      ? dedupeOperationRuns((await Promise.all(jobs.map(async (job) => normalizeOpenClawOperationRuns(await listCronRuns(adapter, { id: job.id, limit: 50 }), job.id)))).flat())
      : [];
    const reconciledJobs = jobs.map((job) => reconcileJobWithRuns(job, runs.filter((run) => run.jobId === job.id)));
    const hydratedJobs = await Promise.all(
      reconciledJobs.map((job) => hydrateCompletedOperationOutput(job, adapter, registry.results[job.id] ?? [], runs.filter((run) => run.jobId === job.id)))
    );
    await withRegistryMutation(async () => {
      const current = await readRegistry();
      if (mergeProjectedResults(current.results, hydratedJobs)) await writeRegistry(current);
    });
    return {
      generatedAt: new Date().toISOString(), source: "openclaw.cron",
      scheduler: { enabled: typeof status.enabled === "boolean" ? status.enabled : null, nextWakeAt: iso(status.nextWakeAtMs), state: "available" },
      jobs: hydratedJobs, runs, audit: registry.audit,
      notices: [
        ...(cronRead === "unknown" ? [{ severity: "warning" as const, title: "Cron capability unverified", detail: "Showing the live OpenClaw cron projection while Gateway capability discovery is unavailable." }] : []),
        ...(runHistory ? [] : [{ severity: "warning" as const, title: "Run history unavailable", detail: "The connected Gateway does not advertise native cron.runs." }])
      ]
    };
  } catch (error) {
    return unavailableSnapshot(registry.audit, error instanceof Error ? error.message : "Unable to read OpenClaw cron state.");
  }
}

export async function createOperation(
  input: OperationJobInput,
  gatewayOptions: OpenClawCommandOptions = {},
  requestContext: OperationRequestContext = {}
) {
  return withRegistryMutation(async () => {
    const requestId = randomUUID();
    try {
      await requireMutationCapability();
      const { getMissionControlSnapshot } = await import("@/lib/openclaw/application/mission-control-service");
      const snapshot = await getMissionControlSnapshot({ force: true });
      const agent = snapshot.agents.find((entry) => entry.id === input.agentId);
      if (!agent || agent.workspaceId !== input.workspaceId) throw new Error("Owner agent must belong to the selected workspace.");
      const safety = normalizeSafety(input.safety);
      await assertSafety(input.agentId, input.workspaceId, safety);
      const payload = await getOpenClawAdapter().call<Record<string, unknown>>(
        "cron.add",
        buildOpenClawCronAddParams(input),
        gatewayOptions
      );
      const job = record(payload.job);
      const jobId = string(job.id) ?? string(payload.id) ?? string(payload.jobId);
      if (!jobId) throw new Error("OpenClaw did not return a cron job id.");
      const declarationKey = string(input.idempotencyKey)
        ? `agentos:automation:${string(input.idempotencyKey)}`
        : null;
      const registry = await readRegistry();
      registry.jobs[jobId] = {
        workspaceId: input.workspaceId,
        safety,
        automationId: input.automationId ?? input.idempotencyKey ?? null,
        declarationKey,
        sessionTarget: input.context?.sessionTarget ?? "isolated",
        idempotencyKey: input.idempotencyKey ?? null
      };
      registry.audit.unshift(audit("create", jobId, "accepted", declarationKey ? "OpenClaw cron job converged by declaration key." : "OpenClaw cron job created.", requestId, requestContext));
      await writeRegistry(registry);
      return { ok: true, jobId, requestId, declarationKey };
    } catch (error) { await appendAudit(audit("create", null, "failed", message(error), requestId, requestContext)); throw error; }
  });
}

export async function operateOperation(
  action: Exclude<OperationAction, "create" | "update">,
  jobId: string,
  gatewayOptions: OpenClawCommandOptions = {},
  requestContext: OperationRequestContext = {}
) {
  return withRegistryMutation(async () => {
    const requestId = randomUUID();
    try {
      await requireMutationCapability();
      const registry = await readRegistry();
      const metadata = registry.jobs[jobId];
      if (metadata) await assertSafetyForManualRun(action, metadata.safety, jobId, gatewayOptions);
      if (action === "cancel") throw new Error("OpenClaw does not advertise a documented cron run-cancel operation. The job was not changed.");
      const call: [string, Record<string, unknown>] = action === "delete" ? ["cron.remove", { id: jobId }]
        : action === "run" || action === "retry" ? ["cron.run", { id: jobId, mode: "force" }]
        : ["cron.update", { id: jobId, patch: { enabled: action === "resume" } }];
      await getOpenClawAdapter().call<unknown>(call[0], call[1], gatewayOptions);
      if (action === "delete") {
        delete registry.jobs[jobId];
        delete registry.results[jobId];
      }
      registry.audit.unshift(audit(action, jobId, "accepted", `OpenClaw ${call[0]} accepted.`, requestId, requestContext));
      await writeRegistry(registry);
      return { ok: true, requestId };
    } catch (error) { await appendAudit(audit(action, jobId, "failed", message(error), requestId, requestContext)); throw error; }
  });
}

export async function updateOperationSchedule(
  input: { jobId: string; trigger: OperationJobInput["trigger"] },
  gatewayOptions: OpenClawCommandOptions = {},
  requestContext: OperationRequestContext = {}
) {
  return withRegistryMutation(async () => {
    const requestId = randomUUID();
    try {
      await requireMutationCapability();
      const schedule = input.trigger.kind === "at" ? { kind: "at", at: input.trigger.at }
        : input.trigger.kind === "every" ? { kind: "every", everyMs: input.trigger.everyMs }
        : { kind: "cron", expr: input.trigger.expression, ...(input.trigger.timezone ? { tz: input.trigger.timezone } : {}) };
      await getOpenClawAdapter().call<unknown>("cron.update", { id: input.jobId, patch: { schedule } }, gatewayOptions);
      const registry = await readRegistry();
      registry.audit.unshift(audit("update", input.jobId, "accepted", "OpenClaw cron schedule updated.", requestId, requestContext));
      await writeRegistry(registry);
      return { ok: true, requestId };
    } catch (error) { await appendAudit(audit("update", input.jobId, "failed", message(error), requestId, requestContext)); throw error; }
  });
}

async function requireMutationCapability() {
  const matrix = await getOpenClawCapabilityMatrix({ force: true });
  if (matrix.operations?.cronWrite?.mode !== "gateway-native") throw new Error("OpenClaw Gateway does not advertise native cron mutations; AgentOS will not use an unverified scheduler fallback.");
}

async function assertSafety(agentId: string, workspaceId: string, safety: NonNullable<OperationJob["safety"]>) {
  if (safety.accountTargetId) {
    const decision = await resolveAccountAccessDecision({ agentId, workspaceId, targetId: safety.accountTargetId });
    if (decision.approvalRequired || safety.requiresApproval) throw new Error("This operation requires approval before it can be scheduled.");
    if (!decision.allowed) throw new Error(decision.error ?? "Selected account access is denied.");
  }
  if (safety.requiresApproval) throw new Error("This operation requires an approval integration that is not available for scheduled cron execution.");
}
async function assertSafetyForManualRun(action: string, safety: NonNullable<OperationJob["safety"]>, jobId: string, options: OpenClawCommandOptions) {
  if (action === "run" || action === "retry") {
    if (safety.requiresApproval) throw new Error("Run is pending approval and cannot be queued.");
    if (safety.concurrency === "forbid") {
      const runs = normalizeOpenClawOperationRuns(await listCronRuns(getOpenClawAdapter(), { id: jobId, limit: 10 }, options), jobId);
      if (runs.some((run) => run.status === "queued" || run.status === "running")) throw new Error("Concurrency policy forbids a second active run.");
    }
  }
}

export function buildOpenClawCronAddParams(input: OperationJobInput) {
  const schedule = input.trigger.kind === "at" ? { kind: "at", at: input.trigger.at }
    : input.trigger.kind === "every" ? { kind: "every", everyMs: input.trigger.everyMs }
    : { kind: "cron", expr: input.trigger.expression, ...(input.trigger.timezone ? { tz: input.trigger.timezone } : {}) };
  const declarationKey = input.idempotencyKey?.trim() ? `agentos:automation:${input.idempotencyKey.trim()}` : undefined;
  return { name: input.name, description: input.description ?? undefined, declarationKey, agentId: input.agentId, enabled: true, schedule,
    sessionTarget: input.context?.sessionTarget ?? "isolated", wakeMode: "now",
    payload: { kind: "agentTurn", message: input.prompt, model: input.model ?? undefined, thinking: input.thinking ?? undefined, lightContext: input.context?.lightContext ?? false },
    delivery: { mode: "none" }, deleteAfterRun: input.trigger.kind === "at" ? false : undefined };
}

export function normalizeOpenClawOperationJob(value: unknown, sidecar: Registry["jobs"], mutable: boolean, history: boolean): OperationJob {
  const raw = record(value); const id = string(raw.id) ?? string(raw.jobId) ?? "unknown"; const schedule = record(raw.schedule); const state = record(raw.state); const payload = record(raw.payload); const side = sidecar[id];
  const systemOwnedMonitor = resolveSystemOwnedMonitorKind(raw.declarationKey);
  const trigger = schedule.kind === "at" && string(schedule.at) ? { kind: "at" as const, at: string(schedule.at)!, timezone: null } : schedule.kind === "every" && number(schedule.everyMs) ? { kind: "every" as const, everyMs: number(schedule.everyMs)! } : schedule.kind === "cron" && string(schedule.expr) ? { kind: "cron" as const, expression: string(schedule.expr)!, timezone: string(schedule.tz) } : null;
  const enabled = raw.enabled !== false; const rawStatus = string(raw.status) ?? string(state.lastRunStatus);
  const identity = automationExecutionIdentityFromCron({
    automationId: side?.automationId,
    cronJobId: id === "unknown" ? null : id,
    sessionKey: string(raw.sessionKey) ?? string(record(raw.owner).sessionKey),
    agentId: string(raw.agentId),
    workspaceId: side?.workspaceId,
    provenance: id === "unknown" ? "heuristic" : "authoritative",
    sourceOfTruth: id === "unknown" ? "compatibility" : "openclaw.cron.job"
  });
  return { id, systemOwnedMonitor, automationId: identity.automationId, cronJobId: identity.cronJobId, name: string(raw.name) ?? id, description: string(raw.description), enabled, status: status(rawStatus, enabled, number(state.runningAtMs), trigger), agentId: string(raw.agentId), workspaceId: side?.workspaceId ?? null, prompt: string(payload.message), model: string(payload.model), thinking: string(payload.thinking), trigger, nextRunAt: iso(raw.nextRunAtMs) ?? iso(state.nextRunAtMs), lastRunAt: iso(state.lastRunAtMs), lastRunStatus: rawStatus ?? null, sessionKey: identity.sessionKey, sessionId: string(raw.sessionId), sessionTarget: string(raw.sessionTarget), safety: side?.safety ?? null, health: { consecutiveFailures: number(state.consecutiveErrors) ?? 0, successRate: null, degraded: (number(state.consecutiveErrors) ?? 0) > 0 }, capabilities: { readable: true, mutable, runHistory: history, reason: mutable ? null : "Gateway cron mutations are not advertised." } };
}
export function normalizeOpenClawOperationRuns(value: unknown, jobId: string): OperationRun[] {
  const raw = record(value);
  const list = Array.isArray(raw.entries)
    ? raw.entries
    : Array.isArray(raw.runs)
      ? raw.runs
      : Array.isArray(value)
        ? value
        : [];

  return list.map((entry, index) => {
    const run = record(entry);
    const usage = record(run.usage);
    const startedAt = iso(run.runAtMs) ?? iso(run.startedAtMs) ?? string(run.startedAt);
    const endedAt = iso(run.endedAtMs) ?? string(run.endedAt) ?? iso(run.ts);
    const inputTokens = number(usage.input_tokens) ?? number(usage.inputTokens);
    const outputTokens = number(usage.output_tokens) ?? number(usage.outputTokens);
    const reportedTotalTokens = number(usage.total_tokens) ?? number(usage.totalTokens) ?? number(usage.tokens);
    const tokens = reportedTotalTokens ?? (inputTokens !== null || outputTokens !== null
      ? (inputTokens ?? 0) + (outputTokens ?? 0)
      : null);
    const stableTimestamp = number(run.runAtMs) ?? number(run.startedAtMs) ?? number(run.ts) ?? index;

    const cronRunId = string(run.runId);
    const sessionKey = string(run.sessionKey);
    const sessionId = string(run.sessionId);
    const identity = automationExecutionIdentityFromCron({
      cronJobId: jobId,
      cronRunId,
      taskId: string(run.taskId),
      sessionKey,
      sessionId,
      provenance: cronRunId || string(run.taskId) ? "authoritative" : sessionKey || sessionId ? "correlated" : "derived",
      sourceOfTruth: string(run.taskId) ? "openclaw.tasks" : cronRunId ? "openclaw.cron.runs" : sessionKey || sessionId ? "openclaw.cron.runs" : "compatibility"
    });
    return {
      id: cronRunId ?? string(run.id) ?? sessionId ?? `${jobId}:${stableTimestamp}`,
      jobId,
      cronRunId: identity.cronRunId,
      taskId: identity.taskId,
      sessionKey: identity.sessionKey,
      identityProvenance: identity.provenance,
      sourceOfTruth: identity.sourceOfTruth,
      completionStatus: string(run.completionStatus),
      deliveryStatus: string(run.deliveryStatus),
      status: runStatus(string(run.status)),
      startedAt,
      endedAt,
      durationMs: number(run.durationMs) ?? (startedAt && endedAt ? Date.parse(endedAt) - Date.parse(startedAt) : null),
      sessionId,
      output: string(run.output) ?? string(run.summary),
      error: string(run.error),
      tokens,
      cost: number(usage.cost) ?? number(run.cost),
      artifacts: Array.isArray(run.artifacts) ? run.artifacts.map(String) : []
    };
  });
}
function reconcileJobWithRuns(job: OperationJob, runs: OperationRun[]): OperationJob {
  const sorted = [...runs].sort((left, right) => Date.parse(right.endedAt ?? right.startedAt ?? "") - Date.parse(left.endedAt ?? left.startedAt ?? ""));
  const active = sorted.find((run) => run.status === "queued" || run.status === "running");
  const latest = sorted.find((run) => run.status === "ok" || run.status === "error" || run.status === "skipped");
  const status = active ? "running" : job.status === "running" && latest?.status === "error" ? "failed"
    : job.status === "running" && latest?.status === "ok" && job.trigger?.kind === "at" ? "completed" : job.status;
  const reconciled = { ...job, status } as OperationJob;
  return { ...reconciled, health: healthFor(reconciled, sorted) };
}
function latestOperationRun(runs: OperationRun[], jobId: string) {
  return runs
    .filter((run) => run.jobId === jobId)
    .sort((left, right) => Date.parse(right.endedAt ?? right.startedAt ?? "") - Date.parse(left.endedAt ?? left.startedAt ?? ""))[0] ?? null;
}
async function hydrateCompletedOperationOutput(
  job: OperationJob,
  adapter: ReturnType<typeof getOpenClawAdapter>,
  storedResults: OperationResult[],
  runs: OperationRun[]
): Promise<OperationJob> {
  if (!job.lastRunStatus || !job.agentId || !job.lastRunAt) return job;
  const latestRun = latestOperationRun(runs, job.id);
  const sessionKey = latestRun?.sessionKey ?? job.sessionKey ?? null;
  if (!sessionKey) return job;
  const cacheKey = `${job.id}:${latestRun?.id ?? job.lastRunAt}`;
  const cached = operationOutputCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) return { ...job, ...cached.value };
  try {
    const payload = await adapter.getSessionHistory({ sessionKey, limit: 200 }, { timeoutMs: 8_000 });
    const gatewayResults = extractAgentChatMessagesFromSessionHistory(payload)
      .filter((message) => message.role === "assistant" && message.text.trim())
      .slice(-24)
      .map((message, index): OperationResult => ({
        id: message.id ?? `${job.id}:${latestRun?.id ?? job.lastRunAt}:${index}`,
        timestamp: operationResultTimestamp(message.timestamp),
        text: message.text.trim()
      }));
    const recentResults = mergeOperationResults(storedResults, gatewayResults);
    const latestOutput = recentResults.at(-1)?.text ?? null;
    const sessionId = string(payload.sessionId) ?? string(record(payload.sessionInfo).sessionId);
    const value = { latestOutput, recentResults, sessionKey, sessionId };
    operationOutputCache.set(cacheKey, { value, expiresAt: Date.now() + operationOutputCacheTtlMs });
    return { ...job, ...value };
  } catch {
    // A missing/unsupported history capability must not turn a real completed cron job into a fake result.
    return job;
  }
}
function mergeOperationResults(...groups: OperationResult[][]) {
  const byEvidence = new Map<string, OperationResult>();
  for (const result of groups.flat()) {
    if (!result?.text?.trim() || !result.timestamp || Number.isNaN(Date.parse(result.timestamp))) continue;
    const evidenceKey = `${result.timestamp}\u0000${result.text.trim()}`;
    byEvidence.set(evidenceKey, { ...result, text: result.text.trim() });
  }
  return [...byEvidence.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-24);
}
function dedupeOperationRuns(runs: OperationRun[]) {
  const byIdentity = new Map<string, OperationRun>();
  for (const run of runs) {
    const key = run.cronRunId
      ? `cron:${run.jobId}:${run.cronRunId}`
      : run.sessionId
        ? `session:${run.jobId}:${run.sessionId}`
        : `${run.jobId}:${run.id}`;
    const current = byIdentity.get(key);
    if (!current || runQuality(run) > runQuality(current)) byIdentity.set(key, run);
  }
  return [...byIdentity.values()];
}
function runQuality(run: OperationRun) {
  return (run.identityProvenance === "authoritative" ? 4 : run.identityProvenance === "correlated" ? 3 : run.identityProvenance === "derived" ? 2 : 1) + (run.status === "unknown" ? 0 : 1);
}
function mergeProjectedResults(target: Registry["results"], jobs: OperationJob[]) {
  let changed = false;
  for (const job of jobs) {
    const next = mergeOperationResults(target[job.id] ?? [], job.recentResults ?? []);
    if (JSON.stringify(next) !== JSON.stringify(target[job.id] ?? [])) {
      target[job.id] = next;
      changed = true;
    }
  }
  return changed;
}
function operationResultTimestamp(value: string | number | null) {
  if (typeof value === "number" && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === "string" && !Number.isNaN(Date.parse(value))) return new Date(value).toISOString();
  return new Date().toISOString();
}
function healthFor(job: OperationJob, runs: OperationRun[]) { const terminal = runs.filter((run) => run.status === "ok" || run.status === "error" || run.status === "skipped"); let failures = 0; for (const run of runs) { if (run.status === "error") failures += 1; else if (run.status === "ok") break; } return { consecutiveFailures: failures, successRate: terminal.length ? terminal.filter((run) => run.status === "ok").length / terminal.length : null, degraded: failures >= 2 || job.status === "failed" }; }
function status(value: string | null, enabled: boolean, running: number | null, trigger: OperationJob["trigger"]): OperationJob["status"] { if (running) return "running"; if (!enabled && trigger?.kind === "at" && value === "ok") return "completed"; if (!enabled && trigger?.kind === "at" && value === "error") return "failed"; if (!enabled) return "paused"; if (value === "ok") return trigger?.kind === "at" ? "completed" : "scheduled"; if (value === "error") return "failed"; if (value === "skipped") return "scheduled"; return "active"; }
function runStatus(value: string | null): OperationRun["status"] { return value === "ok" || value === "error" || value === "skipped" || value === "queued" || value === "running" ? value : "unknown"; }
function resolveSystemOwnedMonitorKind(value: unknown): SystemOwnedMonitorKind | null {
  const declarationKey = string(value);
  if (declarationKey?.startsWith("heartbeat:")) return "heartbeat";
  if (declarationKey?.startsWith("skill-collection-review:")) return "skill-collection-review";
  return null;
}
function normalizeSafety(input: OperationJobInput["safety"]): NonNullable<OperationJob["safety"]> { return { accountTargetId: input?.accountTargetId?.trim() || null, requiresApproval: input?.requiresApproval === true, fileLease: input?.fileLease?.trim() || null, concurrency: input?.concurrency ?? "forbid" }; }
function unavailableSnapshot(audit: OperationAuditEntry[], detail: string): OperationsSnapshot { return { generatedAt: new Date().toISOString(), source: "unavailable", scheduler: { enabled: null, nextWakeAt: null, state: "unsupported" }, jobs: [], runs: [], audit, notices: [{ severity: "warning", title: "Operations unavailable", detail }] }; }
function audit(action: OperationAction, jobId: string | null, outcome: OperationAuditEntry["outcome"], detail: string, requestId: string, context: OperationRequestContext = {}): OperationAuditEntry {
  return {
    id: randomUUID(), at: new Date().toISOString(), action, jobId, outcome, detail, requestId,
    actorId: context.actor?.actorId ?? null,
    actorKind: context.actor?.kind ?? null,
    authenticationMethod: context.actor?.authenticationMethod ?? null,
    sourceOfTruth: "openclaw.cron"
  };
}
async function readRegistry(): Promise<Registry> {
  try {
    const value = JSON.parse(await readFile(registryPath, "utf8")) as Partial<Registry>;
    return normalizeRegistry(value);
  } catch (error) {
    if (record(error).code === "ENOENT") return { version: 2, jobs: {}, audit: [], results: {} };
    throw error;
  }
}
async function writeRegistry(registry: Registry) { await mkdir(path.dirname(registryPath), { recursive: true, mode: 0o700 }); const temp = `${registryPath}.${process.pid}.${randomUUID()}.tmp`; await writeFile(temp, `${JSON.stringify({ ...registry, audit: registry.audit.slice(0, 500) }, null, 2)}\n`, { mode: 0o600 }); await rename(temp, registryPath); }
async function appendAudit(entry: OperationAuditEntry) { const registry = await readRegistry(); registry.audit.unshift(entry); await writeRegistry(registry); }
async function listCronRuns(adapter: ReturnType<typeof getOpenClawAdapter>, input: { id: string; limit?: number }, options: OpenClawCommandOptions = {}) {
  return adapter.listCronRuns?.(input, options) ?? adapter.call<unknown>("cron.runs", input, options);
}
function normalizeRegistry(value: Partial<Registry>): Registry {
  const rawJobs = value.jobs && typeof value.jobs === "object" ? value.jobs as Record<string, unknown> : {};
  const jobs: Registry["jobs"] = {};
  for (const [jobId, raw] of Object.entries(rawJobs)) {
    const metadata = record(raw);
    const safety = record(metadata.safety);
    jobs[jobId] = {
      workspaceId: string(metadata.workspaceId) ?? "",
      safety: {
        accountTargetId: string(safety.accountTargetId),
        requiresApproval: safety.requiresApproval === true,
        fileLease: string(safety.fileLease),
        concurrency: safety.concurrency === "allow" || safety.concurrency === "replace" ? safety.concurrency : "forbid"
      },
      automationId: string(metadata.automationId),
      declarationKey: string(metadata.declarationKey),
      sessionTarget: string(metadata.sessionTarget),
      idempotencyKey: string(metadata.idempotencyKey)
    };
  }
  const results = value.results && typeof value.results === "object" ? value.results as Record<string, OperationResult[]> : {};
  return {
    version: 2,
    jobs,
    audit: Array.isArray(value.audit) ? value.audit.slice(0, 500) : [],
    results
  };
}
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function number(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function iso(value: unknown) { const ms = number(value); return ms === null ? null : new Date(ms).toISOString(); }
function message(error: unknown) { return error instanceof Error ? error.message : "Unknown operation error."; }
