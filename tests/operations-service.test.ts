import assert from "node:assert/strict";
import test from "node:test";

import {
  buildOpenClawCronAddParams,
  normalizeOpenClawOperationJob,
  normalizeOpenClawOperationRuns
} from "@/lib/agentos/application/operations-service";
import { buildOperationTaskProjections, mergeOperationTaskProjections } from "@/lib/openclaw/domains/operation-task-projection";

test("operations maps timezone-aware cron definitions to documented Gateway fields", () => {
  const params = buildOpenClawCronAddParams({
    name: "DST-safe brief", agentId: "ops", workspaceId: "workspace-a", prompt: "Report status.",
    trigger: { kind: "cron", expression: "0 9 * * 1-5", timezone: "America/New_York" }, safety: { concurrency: "forbid" }
  });
  assert.deepEqual(params.schedule, { kind: "cron", expr: "0 9 * * 1-5", tz: "America/New_York" });
  assert.equal((params.payload as { kind: string }).kind, "agentTurn");
  assert.equal(params.sessionTarget, "isolated");
});

test("operations keeps a one-shot job visible after success", () => {
  const params = buildOpenClawCronAddParams({
    name: "One time", agentId: "ops", workspaceId: "workspace-a", prompt: "Run once.",
    trigger: { kind: "at", at: "2026-11-01T14:00:00.000Z" }
  });
  assert.equal(params.deleteAfterRun, false);
  assert.deepEqual(params.schedule, { kind: "at", at: "2026-11-01T14:00:00.000Z" });
});

test("operations projects runtime job state without becoming a scheduler", () => {
  const job = normalizeOpenClawOperationJob({
    jobId: "job-1", name: "Nightly", enabled: true, status: "running", agentId: "ops",
    schedule: { kind: "every", everyMs: 60_000 }, state: { runningAtMs: 1_700_000_000_000 }, payload: { message: "check" }
  }, {}, true, true);
  assert.equal(job.status, "running");
  assert.equal(job.trigger?.kind, "every");
  assert.equal(job.capabilities.mutable, true);
});

test("operations preserves native system-owned monitor classification without classifying AgentOS jobs", () => {
  const heartbeat = normalizeOpenClawOperationJob({
    id: "heartbeat-job", declarationKey: "heartbeat:main", name: "heartbeat-main", enabled: true, agentId: "main",
    schedule: { kind: "every", everyMs: 1_800_000 }, payload: { kind: "heartbeat" }
  }, {}, true, true);
  const review = normalizeOpenClawOperationJob({
    id: "review-job", declarationKey: "skill-collection-review:main", name: "skill-collection-review-main", enabled: true, agentId: "main",
    schedule: { kind: "every", everyMs: 604_800_000 }, payload: { message: "Review skills." }
  }, {}, true, true);
  const operatorJob = normalizeOpenClawOperationJob({
    id: "operator-job", declarationKey: "agentos:automation:brief", name: "Brief", enabled: true, agentId: "main",
    schedule: { kind: "every", everyMs: 3_600_000 }, payload: { message: "Report." }
  }, {}, true, true);

  assert.equal(heartbeat.systemOwnedMonitor, "heartbeat");
  assert.equal(review.systemOwnedMonitor, "skill-collection-review");
  assert.equal(operatorJob.systemOwnedMonitor, null);

  const [projection] = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:00:00.000Z",
    source: "openclaw.cron",
    scheduler: { enabled: true, nextWakeAt: null, state: "available" },
    jobs: [heartbeat],
    runs: [],
    audit: [],
    notices: []
  }, []);
  assert.equal(projection?.metadata.systemOwnedMonitor, "heartbeat");
});

test("recurring jobs remain scheduled after an individual run succeeds", () => {
  const job = normalizeOpenClawOperationJob({
    jobId: "job-recurring", name: "Recurring", enabled: true, status: "ok", agentId: "ops",
    schedule: { kind: "every", everyMs: 60_000 }, state: { lastRunStatus: "ok" }, payload: { message: "check" }
  }, {}, true, true);
  assert.equal(job.status, "scheduled");
});

test("disabled recurring jobs are paused even when their last run succeeded", () => {
  const job = normalizeOpenClawOperationJob({
    jobId: "job-paused", name: "Paused", enabled: false, status: "ok", agentId: "ops",
    schedule: { kind: "every", everyMs: 60_000 }, state: { lastRunStatus: "ok" }, payload: { message: "check" }
  }, {}, true, true);
  assert.equal(job.status, "paused");
});

test("completed one-time jobs remain completed after OpenClaw disables them", () => {
  const job = normalizeOpenClawOperationJob({
    jobId: "job-once", name: "One time", enabled: false, status: "ok", agentId: "ops",
    schedule: { kind: "at", at: "2026-07-11T00:00:00.000Z" }, state: { lastRunStatus: "ok" }, payload: { message: "check" }
  }, {}, true, true);
  assert.equal(job.status, "completed");
});

test("operations normalizes retry, error, and recovery evidence from cron.runs", () => {
  const runs = normalizeOpenClawOperationRuns({ runs: [
    { runId: "run-error", status: "error", startedAtMs: 1_700_000_000_000, endedAtMs: 1_700_000_030_000, error: "network timeout" },
    { runId: "run-ok", status: "ok", startedAtMs: 1_700_000_040_000, endedAtMs: 1_700_000_050_000, summary: "Recovered" }
  ] }, "job-1");
  assert.equal(runs[0].status, "error");
  assert.equal(runs[0].durationMs, 30_000);
  assert.equal(runs[1].output, "Recovered");
});

test("operations normalizes the OpenClaw 2026.6 cron.runs entries shape", () => {
  const runs = normalizeOpenClawOperationRuns({ entries: [{
    ts: 1_700_000_050_000,
    jobId: "job-live",
    action: "finished",
    status: "ok",
    summary: "Completed from Gateway",
    runAtMs: 1_700_000_000_000,
    durationMs: 50_000,
    sessionId: "session-live",
    usage: { input_tokens: 1_200, output_tokens: 300, total_tokens: 2_100 }
  }] }, "job-live");

  assert.equal(runs.length, 1);
  assert.equal(runs[0].id, "session-live");
  assert.equal(runs[0].startedAt, "2023-11-14T22:13:20.000Z");
  assert.equal(runs[0].endedAt, "2023-11-14T22:14:10.000Z");
  assert.equal(runs[0].durationMs, 50_000);
  assert.equal(runs[0].tokens, 2_100);
  assert.equal(runs[0].output, "Completed from Gateway");
});

test("operations derives token usage when cron.runs omits a total", () => {
  const [run] = normalizeOpenClawOperationRuns({ entries: [{
    status: "ok",
    runAtMs: 1_700_000_000_000,
    usage: { input_tokens: 900, output_tokens: 100 }
  }] }, "job-token-fallback");

  assert.equal(run.tokens, 1_000);
  assert.equal(run.id, "job-token-fallback:1700000000000");
});

test("scheduled OpenClaw jobs become read-only task cards with a visible cadence", () => {
  const tasks = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:00:00.000Z", source: "openclaw.cron", scheduler: { enabled: true, nextWakeAt: null, state: "available" }, runs: [], audit: [], notices: [],
    jobs: [{ id: "job-1", name: "Morning brief", description: null, enabled: true, status: "scheduled", agentId: "ops", workspaceId: "workspace-a", prompt: "Brief", model: null, thinking: null, trigger: { kind: "cron", expression: "0 9 * * 1-5", timezone: "Europe/Istanbul" }, nextRunAt: "2026-07-13T06:00:00.000Z", lastRunAt: null, lastRunStatus: null, safety: null, health: { consecutiveFailures: 0, successRate: null, degraded: false }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }]
  }, [{ id: "ops", name: "Ops", workspaceId: "workspace-a" } as never]);
  assert.equal(tasks[0].metadata.source, "openclaw-cron");
  assert.equal(tasks[0].metadata.cronExpression, "0 9 * * 1-5");
  assert.match(String(tasks[0].metadata.scheduleLabel), /Europe\/Istanbul/);
});

test("completed operations expose the Gateway transcript result on their task card", () => {
  const [task] = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:00:00.000Z", source: "openclaw.cron", scheduler: { enabled: true, nextWakeAt: null, state: "available" }, runs: [], audit: [], notices: [],
    jobs: [{ id: "job-result", name: "Rate", description: null, enabled: false, status: "completed", agentId: "ops", workspaceId: "workspace-a", prompt: "Rate", model: null, thinking: null, trigger: { kind: "at", at: "2026-07-11T00:00:00.000Z" }, nextRunAt: null, lastRunAt: "2026-07-11T00:01:00.000Z", lastRunStatus: "ok", latestOutput: "1 GBP is 62.99 TRY", recentResults: [{ id: "answer-1", timestamp: "2026-07-11T00:01:00.000Z", text: "1 GBP is 62.99 TRY" }], sessionKey: "agent:ops:cron:job-result", sessionId: "session-1", safety: null, health: { consecutiveFailures: 0, successRate: 1, degraded: false }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }]
  }, [{ id: "ops", name: "Ops", workspaceId: "workspace-a" } as never]);
  assert.equal(task.metadata.resultPreview, "1 GBP is 62.99 TRY");
  assert.equal(task.metadata.openClawSessionKey, "agent:ops:cron:job-result");
  assert.deepEqual(task.metadata.operationFeed, [{ id: "operation:job-result:2026-07-11T00:01:00.000Z:answer-1", kind: "assistant", timestamp: "2026-07-11T00:01:00.000Z", title: "Scheduled result", detail: "1 GBP is 62.99 TRY" }]);
});

test("recurring results keep unique feed ids when OpenClaw reuses message ids", () => {
  const baseJob = {
    id: "job-recurring-results", name: "Clock", description: null, enabled: true, status: "scheduled" as const,
    agentId: "ops", workspaceId: "workspace-a", prompt: "Time", model: null, thinking: null,
    trigger: { kind: "every" as const, everyMs: 60_000 }, nextRunAt: "2026-07-11T00:03:00.000Z",
    lastRunAt: "2026-07-11T00:02:00.000Z", lastRunStatus: "ok", safety: null,
    health: { consecutiveFailures: 0, successRate: 1, degraded: false },
    capabilities: { readable: true, mutable: true, runHistory: true, reason: null },
    recentResults: [
      { id: "history:assistant:1", timestamp: "2026-07-11T00:01:00.000Z", text: "First" },
      { id: "history:assistant:1", timestamp: "2026-07-11T00:02:00.000Z", text: "Second" }
    ]
  };
  const [task] = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:02:00.000Z", source: "openclaw.cron",
    scheduler: { enabled: true, nextWakeAt: null, state: "available" },
    jobs: [baseJob], runs: [], audit: [], notices: []
  }, [{ id: "ops", name: "Ops", workspaceId: "workspace-a" } as never]);
  const feed = task.metadata.operationFeed as Array<{ id: string }>;

  assert.equal(feed.length, 2);
  assert.notEqual(feed[0]?.id, feed[1]?.id);
});

test("interval history marks an observed result gap as possible missed and recovered", () => {
  const [task] = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:15:00.000Z", source: "openclaw.cron",
    scheduler: { enabled: true, nextWakeAt: null, state: "available" }, runs: [], audit: [], notices: [],
    jobs: [{ id: "job-gap", name: "Clock", description: null, enabled: true, status: "scheduled", agentId: "ops",
      workspaceId: "workspace-a", prompt: "Time", model: null, thinking: null,
      trigger: { kind: "every", everyMs: 60_000 }, nextRunAt: "2026-07-11T00:16:00.000Z",
      lastRunAt: "2026-07-11T00:15:00.000Z", lastRunStatus: "ok", safety: null,
      health: { consecutiveFailures: 0, successRate: null, degraded: false },
      capabilities: { readable: true, mutable: true, runHistory: true, reason: null },
      recentResults: [
        { id: "first", timestamp: "2026-07-11T00:01:00.000Z", text: "First" },
        { id: "second", timestamp: "2026-07-11T00:15:00.000Z", text: "Second" }
      ] }]
  }, [{ id: "ops", name: "Ops", workspaceId: "workspace-a" } as never]);
  const recovery = task.metadata.operationRecoveryHistory as Array<{ status: string; missedCount: number; detail: string }>;

  assert.deepEqual(recovery.map((entry) => entry.status), ["missed", "recovered"]);
  assert.equal(recovery[0]?.missedCount, 13);
  assert.match(recovery[0]?.detail ?? "", /Possible missed schedule/);
  assert.match(recovery[1]?.detail ?? "", /recovered automatically/);
});

test("operation task cards retain Gateway run failure evidence for their timeline", () => {
  const [task] = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:00:00.000Z", source: "openclaw.cron", scheduler: { enabled: true, nextWakeAt: null, state: "available" }, audit: [], notices: [],
    jobs: [{ id: "job-error", name: "Check", description: null, enabled: true, status: "failed", agentId: "ops", workspaceId: "workspace-a", prompt: "Check", model: null, thinking: null, trigger: { kind: "every", everyMs: 60_000 }, nextRunAt: "2026-07-11T00:02:00.000Z", lastRunAt: "2026-07-11T00:01:00.000Z", lastRunStatus: "error", safety: null, health: { consecutiveFailures: 1, successRate: 0, degraded: true }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }],
    runs: [{ id: "run-error", jobId: "job-error", status: "error", startedAt: "2026-07-11T00:00:55.000Z", endedAt: "2026-07-11T00:01:00.000Z", durationMs: 5_000, sessionId: null, output: null, error: "provider timeout", tokens: null, cost: null, artifacts: [] }]
  }, [{ id: "ops", name: "Ops", workspaceId: "workspace-a" } as never]);
  assert.deepEqual(task.metadata.operationRunHistory, [{ id: "run-error", timestamp: "2026-07-11T00:01:00.000Z", status: "error", output: null, error: "provider timeout", durationMs: 5_000, tokens: null }]);
});

test("operation task cards expose observed run count and reported token usage", () => {
  const [task] = buildOperationTaskProjections({
    generatedAt: "2026-07-11T00:02:00.000Z", source: "openclaw.cron", scheduler: { enabled: true, nextWakeAt: null, state: "available" }, audit: [], notices: [],
    jobs: [{ id: "job-metrics", name: "Brief", description: null, enabled: true, status: "scheduled", agentId: "ops", workspaceId: "workspace-a", prompt: "Brief", model: null, thinking: null, trigger: { kind: "every", everyMs: 60_000 }, nextRunAt: "2026-07-11T00:03:00.000Z", lastRunAt: "2026-07-11T00:02:00.000Z", lastRunStatus: "ok", safety: null, health: { consecutiveFailures: 0, successRate: 1, degraded: false }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }],
    runs: [
      { id: "run-1", jobId: "job-metrics", status: "ok", startedAt: "2026-07-11T00:00:00.000Z", endedAt: "2026-07-11T00:00:10.000Z", durationMs: 10_000, sessionId: null, output: "One", error: null, tokens: 1_200, cost: null, artifacts: [] },
      { id: "run-2", jobId: "job-metrics", status: "ok", startedAt: "2026-07-11T00:01:00.000Z", endedAt: "2026-07-11T00:01:10.000Z", durationMs: 10_000, sessionId: null, output: "Two", error: null, tokens: 800, cost: null, artifacts: [] }
    ]
  }, [{ id: "ops", name: "Ops", workspaceId: "workspace-a" } as never]);

  assert.equal(task.runtimeCount, 2);
  assert.equal(task.metadata.operationRunCount, 2);
  assert.equal(task.tokenUsage?.total, 2_000);
});

test("a cron runtime and its schedule projection reconcile into one terminal task card", () => {
  const snapshot = {
    generatedAt: "2026-07-11T00:00:00.000Z", source: "openclaw.cron" as const, scheduler: { enabled: true, nextWakeAt: null, state: "available" as const }, audit: [], notices: [],
    jobs: [{ id: "job-1", name: "Exchange rate", description: null, enabled: true, status: "failed" as const, agentId: "ops", workspaceId: "workspace-a", prompt: "Rate", model: null, thinking: null, trigger: { kind: "at" as const, at: "2026-07-11T00:00:00.000Z" }, nextRunAt: null, lastRunAt: "2026-07-11T00:00:00.000Z", lastRunStatus: "error", safety: null, health: { consecutiveFailures: 1, successRate: 0, degraded: true }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }],
    runs: [{ id: "cron:job-1:run", jobId: "job-1", status: "error" as const, startedAt: "2026-07-11T00:00:00.000Z", endedAt: "2026-07-11T00:00:03.000Z", durationMs: 3000, sessionId: null, output: null, error: "provider timeout", tokens: null, cost: null, artifacts: [] }]
  };
  const runtime = { id: "task:1", key: "task:1", title: "Exchange rate", mission: "Rate", subtitle: "running", status: "running" as const, updatedAt: null, ageMs: null, runtimeIds: [], agentIds: ["ops"], sessionIds: [], runIds: ["cron:job-1:run"], runtimeCount: 1, updateCount: 0, liveRunCount: 1, artifactCount: 0, warningCount: 0, metadata: { openClawRunId: "cron:job-1:run" } };
  const tasks = mergeOperationTaskProjections(snapshot, [runtime, { ...runtime, id: "task:stale", key: "task:stale", status: "completed", liveRunCount: 0 }], [{ id: "ops", name: "Ops" } as never]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "operation:job-1");
  assert.equal(tasks[0].status, "stalled");
  assert.equal(tasks[0].metadata.operationJobId, "job-1");
  assert.match(tasks[0].subtitle, /provider timeout/);
});

test("a live cron session merges before OpenClaw publishes its run id", () => {
  const snapshot = {
    generatedAt: "2026-07-11T00:00:00.000Z", source: "openclaw.cron" as const, scheduler: { enabled: true, nextWakeAt: null, state: "available" as const }, audit: [], notices: [], runs: [],
    jobs: [{ id: "job-live", name: "Clock", description: null, enabled: true, status: "running" as const, agentId: "ops", workspaceId: "workspace-a", prompt: "Tell time", model: null, thinking: null, trigger: { kind: "every" as const, everyMs: 60_000 }, nextRunAt: "2026-07-11T00:01:00.000Z", lastRunAt: null, lastRunStatus: null, safety: null, health: { consecutiveFailures: 0, successRate: null, degraded: false }, capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }]
  };
  const runtime = { id: "task:ephemeral", key: "task:ephemeral", title: "Clock", mission: "Tell time", subtitle: "running", status: "running" as const, updatedAt: null, ageMs: null, runtimeIds: [], agentIds: ["ops"], sessionIds: [], runIds: [], runtimeCount: 1, updateCount: 0, liveRunCount: 1, artifactCount: 0, warningCount: 0, metadata: { openClawSessionKey: "agent:ops:cron:job-live" } };
  const tasks = mergeOperationTaskProjections(snapshot, [runtime], [{ id: "ops", name: "Ops" } as never]);
  assert.equal(tasks.length, 1);
  assert.equal(tasks[0].id, "operation:job-live");
  assert.equal(tasks[0].status, "running");
});

test("a recovered recurring schedule outranks a stale stalled runtime", () => {
  const snapshot = {
    generatedAt: "2026-07-11T13:35:00.000Z", source: "openclaw.cron" as const,
    scheduler: { enabled: true, nextWakeAt: null, state: "available" as const }, audit: [], notices: [], runs: [],
    jobs: [{ id: "job-recovered", name: "Clock", description: null, enabled: true, status: "scheduled" as const,
      agentId: "ops", workspaceId: "workspace-a", prompt: "Tell time", model: null, thinking: null,
      trigger: { kind: "every" as const, everyMs: 60_000 }, nextRunAt: "2026-07-11T13:36:00.000Z",
      lastRunAt: "2026-07-11T13:35:00.000Z", lastRunStatus: "ok", safety: null,
      health: { consecutiveFailures: 0, successRate: 1, degraded: false },
      capabilities: { readable: true, mutable: true, runHistory: true, reason: null } }]
  };
  const staleRuntime = { id: "task:stale", key: "task:stale", title: "Clock", mission: "Tell time",
    subtitle: "Partial output", status: "stalled" as const, updatedAt: Date.parse("2026-07-11T13:20:00.000Z"), ageMs: null,
    runtimeIds: [], agentIds: ["ops"], sessionIds: [], runIds: [], runtimeCount: 1, updateCount: 0,
    liveRunCount: 0, artifactCount: 0, warningCount: 1,
    metadata: { openClawSessionKey: "agent:ops:cron:job-recovered", resultPreview: "Partial output" } };

  const [task] = mergeOperationTaskProjections(snapshot, [staleRuntime], [{ id: "ops", name: "Ops" } as never]);

  assert.equal(task.status, "queued");
  assert.equal(task.warningCount, 0);
  assert.equal(task.metadata.operationStatus, "scheduled");
  assert.equal(task.metadata.nextRunAt, "2026-07-11T13:36:00.000Z");
});
