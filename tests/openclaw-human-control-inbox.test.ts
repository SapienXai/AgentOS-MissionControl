import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  dedupeAttentionItems,
  getHumanControlInbox,
  projectRuntimeTask,
  resolveHumanControlCapabilityCandidates,
  projectApprovalRecord,
  projectCapabilityAttention,
  projectQuestionRecord,
  projectSuggestedWork,
  projectRuntimeIssue,
  resolveAttentionItem,
  sortAttentionItems
} from "@/lib/openclaw/application/human-control-inbox-service";
import {
  preserveQuestionAnswers,
  shouldScheduleHumanControlRefresh
} from "@/components/operations/human-control-inbox.utils";
import type { AttentionItem, EffectiveCapability, MissionControlSnapshot, TaskRecord } from "@/lib/openclaw/types";
import { OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS } from "@/lib/openclaw/client/gateway-compatibility";

const agent = { id: "worker-1", name: "Backend Engineer" } as never;
const task = {
  id: "task-1",
  key: "agent:worker-1:main",
  title: "Fix authentication",
  mission: "Fix authentication regression",
  subtitle: "Active work",
  status: "stalled",
  updatedAt: 1_700_000_000_000,
  sessionIds: ["session-1"],
  runtimeIds: [],
  runIds: [],
  agentIds: ["worker-1"],
  runtimeCount: 0,
  updateCount: 0,
  liveRunCount: 0,
  artifactCount: 0,
  warningCount: 0,
  metadata: {}
} as unknown as TaskRecord;

function snapshot(overrides: Record<string, unknown> = {}) {
  return {
    generatedAt: new Date().toISOString(),
    agents: [agent],
    tasks: [],
    runtimes: [],
    diagnostics: { runtimeIssues: [] },
    nativeWork: { suggestions: [] },
    ...overrides
  } as unknown as MissionControlSnapshot;
}

function relevance(toolId: string) {
  return { toolIds: [toolId], sourceKinds: ["session.tool"] };
}

function capability(status: "needs-setup" | "blocked", id = "openclaw:email"): EffectiveCapability {
  return {
    id,
    label: id,
    category: "Communication",
    description: "Email capability",
    status,
    configured: true,
    effective: status === "needs-setup",
    explanation: status === "needs-setup" ? "Connect an email account." : "This capability is blocked.",
    reasons: [{ code: status === "needs-setup" ? "account_not_connected" : "policy_denied", message: "Fixture reason" }],
    evidence: { tool: { id: id.replace("openclaw:", "") } },
    remediation: status === "needs-setup" ? { id: "connect-account", label: "Connect account" } : { id: "review-policy", label: "Review policy" }
  } as EffectiveCapability;
}

function emptyAttentionAdapter() {
  return {
    listNativeExecApprovals: async () => ({ approvals: [] }),
    listNativePluginApprovals: async () => ({ approvals: [] }),
    listQuestions: async () => ({ questions: [] })
  } as never;
}

test("projects native approvals and questions into stable attention items", () => {
  const approval = projectApprovalRecord({
    id: "approval-1",
    request: {
      agentId: "worker-1",
      sessionKey: "session-1",
      commandPreview: "deploy production",
      allowedDecisions: ["allow-once", "deny"]
    }
  }, "exec", [agent], [task]);
  assert.equal(approval?.id, "approval:exec:approval-1");
  assert.equal(approval?.worker.label, "Backend Engineer");
  assert.deepEqual(approval?.availableActions.map((action) => action.id), ["deny", "approve"]);

  const question = projectQuestionRecord({
    id: "question-1",
    questions: [{ questionId: "market", header: "Market", question: "Which market?", options: [{ label: "US" }, { label: "EU" }] }],
    agentId: "worker-1",
    sessionKey: "session-1",
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: Date.now() + 100_000,
    status: "pending"
  }, [agent], [task]);
  assert.equal(question?.id, "question:question-1");
  assert.deepEqual(question?.question?.[0]?.options, [{ label: "US" }, { label: "EU" }]);
  assert.equal(question?.availableActions[0]?.id, "answer");
});

test("expired or terminal Human Control records are not actionable", () => {
  assert.equal(projectApprovalRecord({ id: "expired", expiresAtMs: Date.now() - 1 }, "exec"), null);
  assert.equal(projectApprovalRecord({ id: "resolved", status: "approved" }, "exec"), null);
  assert.equal(projectQuestionRecord({
    id: "expired-question",
    questions: [{ questionId: "scope", header: "Scope", question: "Choose", options: [{ label: "A" }] }],
    createdAtMs: Date.now() - 2_000,
    expiresAtMs: Date.now() - 1,
    status: "pending"
  }, [], []), null);
});

test("Gateway-wide Human Control records are filtered to visible workers", async () => {
  const inbox = await getHumanControlInbox({
    snapshot: snapshot(),
    adapter: {
      listNativeExecApprovals: async () => ({ approvals: [{ id: "hidden", request: { agentId: "hidden-worker" } }] }),
      listNativePluginApprovals: async () => ({ approvals: [] }),
      listQuestions: async () => ({ questions: [] })
    } as never
  });
  assert.equal(inbox.items.some((item) => item.id === "approval:exec:hidden"), false);
});

test("composes suggested work and only promotes actionable capability blockers", () => {
  const suggestion = projectSuggestedWork(snapshot({
    nativeWork: {
      suggestions: [{ id: "suggestion-1", title: "Review database integrity", summary: "Review", sourceAgentId: "worker-1", sourceSessionKey: "session-1", createdAt: 1_700_000_000_000 }]
    }
  }));
  assert.equal(suggestion[0]?.id, "suggestion:suggestion-1");
  assert.deepEqual(suggestion[0]?.availableActions.map((action) => action.id), ["review", "accept", "dismiss"]);

  const capability = projectCapabilityAttention([{
    workerId: "worker-1",
    workerLabel: "Backend Engineer",
    sessionKey: "session-1",
    capability: {
      id: "openclaw:gmail",
      label: "Gmail",
      category: "Communication",
      status: "needs-setup",
      configured: true,
      effective: true,
      explanation: "No usable Gmail account is connected.",
      reasons: [{ code: "account_not_connected", message: "No account" }],
      evidence: { tool: { id: "gmail" } },
      remediation: "Connect a Gmail account"
    },
    relevance: relevance("gmail")
  } as never]);
  assert.equal(capability[0]?.id, "needs-setup:worker-1:session:session-1:openclaw%3Agmail:account_not_connected");
  assert.equal(capability[0]?.availableActions[0]?.id, "open-setup");
});

test("production Inbox composition resolves capability attention from active context", async () => {
  const result = await getHumanControlInbox({
    snapshot: snapshot({
      tasks: [{ ...task, runtimeIds: ["runtime-1"] }],
      runtimes: [{ id: "runtime-1", toolNames: ["email", "shell"], metadata: {} }]
    }),
    adapter: emptyAttentionAdapter(),
    capabilityResolver: async (workerId, options) => {
      assert.equal(workerId, "worker-1");
      assert.equal(options.sessionKey, "agent:worker-1:main");
      return {
        workerId,
        capturedAt: new Date().toISOString(),
        session: { key: "agent:worker-1:main", updatedAt: null, profile: "coding" },
        capabilities: [capability("needs-setup"), capability("blocked", "openclaw:shell")],
        skills: [],
        skillLibrary: { supported: true, error: null },
        sources: { toolsCatalog: "native", toolsEffective: "native", skillsLibrary: "native", accounts: "native" },
        summary: { available: 0, "requires-approval": 0, "needs-setup": 1, blocked: 1, unavailable: 0, unknown: 0 }
      } as never;
    }
  });

  assert.equal(result.items.some((item) => item.type === "needs-setup"), true);
  assert.equal(result.items.some((item) => item.type === "blocked"), true);
  assert.equal(result.sources.capabilities, "available");
});

test("active worker status alone does not promote unrelated capability gaps", async () => {
  let resolverCalls = 0;
  const result = await getHumanControlInbox({
    snapshot: snapshot({
      tasks: [{ ...task, runtimeIds: ["runtime-1"] }],
      runtimes: [{ id: "runtime-1", toolNames: ["shell"], metadata: {} }]
    }),
    adapter: emptyAttentionAdapter(),
    capabilityResolver: async () => {
      resolverCalls += 1;
      return {
        workerId: "worker-1",
        session: { key: "agent:worker-1:main", updatedAt: null, profile: "coding" },
        capabilities: [capability("needs-setup", "openclaw:gmail"), capability("blocked", "openclaw:files")]
      } as never;
    }
  });

  assert.equal(resolverCalls, 1);
  assert.equal(result.items.some((item) => item.type === "needs-setup" || item.type === "blocked"), false);
});

test("exact current tool evidence promotes only the matching capability blocker", async () => {
  const result = await getHumanControlInbox({
    snapshot: snapshot({
      tasks: [{ ...task, runtimeIds: ["runtime-1"] }],
      runtimes: [{ id: "runtime-1", toolNames: ["gmail"], metadata: {} }]
    }),
    adapter: emptyAttentionAdapter(),
    capabilityResolver: async () => ({
      workerId: "worker-1",
      session: { key: "agent:worker-1:main", updatedAt: null, profile: "coding" },
      capabilities: [capability("needs-setup", "openclaw:gmail"), capability("blocked", "openclaw:files")]
    } as never)
  });

  assert.deepEqual(result.items.filter((item) => item.type === "needs-setup" || item.type === "blocked").map((item) => item.evidence?.toolId), ["gmail"]);
});

test("capability contexts without relevance evidence skip full resolution", async () => {
  let resolverCalls = 0;
  const result = await resolveHumanControlCapabilityCandidates(snapshot({
    tasks: [task],
    runtimes: [{ id: "runtime-1", taskId: task.id, toolNames: [], metadata: {} }]
  }), [], {
    resolver: async () => {
      resolverCalls += 1;
      return {} as never;
    }
  });

  assert.equal(result.candidateCount, 0);
  assert.equal(result.resolvedCount, 0);
  assert.equal(resolverCalls, 0);
});

test("idle worker capability gaps are not eligible for Human Control", async () => {
  let resolverCalls = 0;
  const result = await getHumanControlInbox({
    snapshot: snapshot({ tasks: [{ ...task, status: "idle" }] }),
    adapter: emptyAttentionAdapter(),
    capabilityResolver: async () => {
      resolverCalls += 1;
      return {} as never;
    }
  });

  assert.equal(resolverCalls, 0);
  assert.equal(result.items.some((item) => item.type === "needs-setup" || item.type === "blocked"), false);
});

test("capability resolver failures preserve native Inbox items and source uncertainty", async () => {
  const result = await getHumanControlInbox({
    snapshot: snapshot({
      tasks: [{ ...task, runtimeIds: ["runtime-1"] }],
      runtimes: [{ id: "runtime-1", toolNames: ["shell"], metadata: {} }]
    }),
    adapter: {
      listNativeExecApprovals: async () => ({ approvals: [{ id: "approval-1", request: { agentId: "worker-1", sessionKey: "session-1" } }] }),
      listNativePluginApprovals: async () => ({ approvals: [] }),
      listQuestions: async () => ({ questions: [] })
    } as never,
    capabilityResolver: async () => {
      throw new Error("Gateway timeout");
    }
  });

  assert.equal(result.items.some((item) => item.type === "approval"), true);
  assert.equal(result.sources.capabilities, "unavailable");
  assert.deepEqual(result.issues, ["Some active capability blockers could not be verified."]);
});

test("capability candidate resolution is bounded, deduplicated, and concurrency-limited", async () => {
  const agents = Array.from({ length: 20 }, (_, index) => ({ id: `worker-${index}`, name: `Worker ${index}` }));
  const tasks = agents.map((entry) => ({ ...task, id: `task-${entry.id}`, key: `agent:${entry.id}:main`, primaryAgentId: entry.id, primaryAgentName: entry.name, agentIds: [entry.id], runtimeIds: [`runtime-${entry.id}`], metadata: {} }));
  let active = 0;
  let maxActive = 0;
  let calls = 0;

  const result = await resolveHumanControlCapabilityCandidates(snapshot({
    agents,
    tasks,
    runtimes: tasks.map((entry) => ({ id: entry.runtimeIds[0], toolNames: ["shell"], metadata: {} }))
  }), [], {
    concurrency: 4,
    resolver: async (workerId) => {
      calls += 1;
      active += 1;
      maxActive = Math.max(maxActive, active);
      await new Promise((resolve) => setTimeout(resolve, 2));
      active -= 1;
      return {
        workerId,
        session: { key: `agent:${workerId}:main`, updatedAt: null, profile: null },
        capabilities: [],
        skills: [],
        skillLibrary: { supported: true, error: null },
        sources: { toolsCatalog: "native", toolsEffective: "native", skillsLibrary: "native", accounts: "native" },
        summary: { available: 0, "requires-approval": 0, "needs-setup": 0, blocked: 0, unavailable: 0, unknown: 0 }
      } as never;
    }
  });

  assert.equal(result.candidateCount, 16);
  assert.equal(calls, 16);
  assert.ok(maxActive <= 4);
  assert.equal(result.failedCount, 0);
});

test("same worker and session is resolved once while separate sessions remain candidates", async () => {
  const duplicateTask = { ...task, id: "task-duplicate", metadata: { openClawSessionKey: "agent:worker-1:main" } };
  const secondSessionTask = { ...task, id: "task-second", key: "agent:worker-1:secondary", metadata: { openClawSessionKey: "agent:worker-1:secondary" } };
  const calls: string[] = [];
  await resolveHumanControlCapabilityCandidates(snapshot({
    tasks: [duplicateTask, secondSessionTask],
    runtimes: [
      { id: "runtime-duplicate", taskId: duplicateTask.id, toolNames: ["shell"], metadata: {} },
      { id: "runtime-second", taskId: secondSessionTask.id, toolNames: ["shell"], metadata: {} }
    ]
  }), [], {
    resolver: async (workerId, options) => {
      calls.push(`${workerId}:${options.sessionKey}`);
      return {
        workerId,
        session: { key: options.sessionKey ?? null, updatedAt: null, profile: null },
        capabilities: [],
        skills: [],
        skillLibrary: { supported: true, error: null },
        sources: { toolsCatalog: "native", toolsEffective: "native", skillsLibrary: "native", accounts: "native" },
        summary: { available: 0, "requires-approval": 0, "needs-setup": 0, blocked: 0, unavailable: 0, unknown: 0 }
      } as never;
    }
  });
  assert.deepEqual(calls.sort(), ["worker-1:agent:worker-1:main", "worker-1:agent:worker-1:secondary"]);
});

test("deduplicates a matching blocker behind native approval and keeps unrelated blockers", () => {
  const approval = projectApprovalRecord({ id: "approval-1", request: { sessionKey: "session-1", toolName: "shell" } }, "exec");
  const blocked = projectCapabilityAttention([{
    workerId: "worker-1",
    sessionKey: "session-1",
    capability: { id: "openclaw:shell", label: "Shell", category: "Development", status: "blocked", configured: true, effective: false, explanation: "Shell is blocked.", reasons: [{ code: "policy_denied", message: "Denied" }], evidence: { tool: { id: "shell" } } },
    relevance: relevance("shell")
  } as never])[0];
  const unrelated = projectCapabilityAttention([{
    workerId: "worker-1",
    sessionKey: "session-1",
    capability: { id: "openclaw:files", label: "Files", category: "Files & Data", status: "blocked", configured: true, effective: false, explanation: "Files are blocked.", reasons: [{ code: "policy_denied", message: "Denied" }], evidence: { tool: { id: "files" } } },
    relevance: relevance("files")
  } as never])[0];
  const result = dedupeAttentionItems([approval!, blocked!, unrelated!]);
  assert.equal(result.some((item) => item.id === blocked?.id), false);
  assert.equal(result.some((item) => item.id === unrelated?.id), true);
});

test("runtime projections carry reliable task session linkage", () => {
  const runtime = projectRuntimeTask(task);
  assert.equal(runtime.source.taskId, task.id);
  assert.equal(runtime.source.sessionKey, "agent:worker-1:main");

  const issue = projectRuntimeIssue({
    id: "runtime-linked",
    type: "unknown_runtime_action",
    source: "system",
    severity: "action_required",
    title: "Execution needs review",
    message: "The active task needs inspection.",
    requestId: task.id,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "open"
  }, [agent], [task]);
  assert.equal(issue.source.sessionKey, "agent:worker-1:main");
  assert.equal(issue.source.taskId, task.id);
});

test("approval and question deduplication uses task/session identity without hiding unrelated work", () => {
  const approval = projectApprovalRecord({ id: "approval-linked", request: { agentId: "worker-1", sessionKey: "session-1", toolName: "shell" } }, "exec", [agent], [task]);
  const runtimeSameTask = projectRuntimeTask(task);
  assert.equal(dedupeAttentionItems([approval!, runtimeSameTask]).some((item) => item.type === "runtime-issue"), false);

  const otherTask = { ...task, id: "task-2", key: "agent:worker-1:secondary", sessionIds: ["session-2"], metadata: {} } as TaskRecord;
  const approvalOtherSession = projectApprovalRecord({ id: "approval-other", request: { agentId: "worker-1", sessionKey: "session-1" } }, "exec", [agent], [task]);
  const runtimeOtherSession = projectRuntimeTask(otherTask);
  assert.equal(dedupeAttentionItems([approvalOtherSession!, runtimeOtherSession]).length, 2);

  const question = projectQuestionRecord({
    id: "question-linked",
    questions: [{ questionId: "decision", header: "Decision", question: "Choose", options: [{ label: "A" }] }],
    sessionKey: "session-1",
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: Date.now() + 100_000,
    status: "pending"
  }, [agent], [task]);
  assert.equal(dedupeAttentionItems([question!, runtimeSameTask]).some((item) => item.type === "runtime-issue"), false);

  const unrelatedRuntime = projectRuntimeTask({ ...task, id: "task-3", key: "agent:worker-1:unrelated", sessionIds: ["session-3"], metadata: {} } as TaskRecord);
  const questionWithoutLink = projectQuestionRecord({
    id: "question-unrelated",
    questions: [{ questionId: "decision", header: "Decision", question: "Choose", options: [{ label: "A" }] }],
    agentId: "worker-1",
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: Date.now() + 100_000,
    status: "pending"
  }, [agent], []);
  assert.equal(dedupeAttentionItems([questionWithoutLink!, unrelatedRuntime]).length, 2);
});

test("blocked capability deduplication requires the same tool relationship", () => {
  const approval = projectApprovalRecord({ id: "approval-shell", request: { sessionKey: "session-1", toolName: "shell" } }, "exec");
  const blockedFiles = projectCapabilityAttention([{
    workerId: "worker-1",
    sessionKey: "session-1",
    capability: { ...capability("blocked", "openclaw:files"), evidence: { tool: { id: "files" } } },
    relevance: relevance("files")
  } as never])[0];
  assert.equal(dedupeAttentionItems([approval!, blockedFiles!]).length, 2);
});

test("derived capability attention identity is stable and session-scoped", () => {
  const first = projectCapabilityAttention([{
    workerId: "worker-1",
    sessionKey: "session-a",
    capability: capability("blocked", "openclaw:shell"),
    relevance: relevance("shell")
  }])[0];
  const second = projectCapabilityAttention([{
    workerId: "worker-1",
    sessionKey: "session-b",
    capability: capability("blocked", "openclaw:shell"),
    relevance: relevance("shell")
  }])[0];
  const repeated = projectCapabilityAttention([{
    workerId: "worker-1",
    sessionKey: "session-a",
    capability: capability("blocked", "openclaw:shell"),
    relevance: relevance("shell")
  }])[0];
  const taskScoped = projectCapabilityAttention([{
    workerId: "worker-1",
    taskId: "task-a",
    capability: capability("blocked", "openclaw:shell"),
    relevance: relevance("shell")
  }])[0];
  const secondTaskScoped = projectCapabilityAttention([{
    workerId: "worker-1",
    taskId: "task-b",
    capability: capability("blocked", "openclaw:shell"),
    relevance: relevance("shell")
  }])[0];

  assert.notEqual(first?.id, second?.id);
  assert.equal(first?.id, repeated?.id);
  assert.match(taskScoped?.id ?? "", /:task:task-a:/);
  assert.notEqual(taskScoped?.id, secondTaskScoped?.id);
});

test("sorts by deterministic severity and oldest blocking time", () => {
  const items = [
    { id: "new-high", type: "runtime-issue", severity: "high", createdAt: "2026-01-02T00:00:00.000Z" },
    { id: "old-critical", type: "approval", severity: "critical", createdAt: "2026-01-03T00:00:00.000Z" },
    { id: "old-high", type: "question", severity: "high", createdAt: "2026-01-01T00:00:00.000Z" }
  ].map((item) => ({ ...item, source: { system: "openclaw", kind: item.type }, worker: { id: null, label: null }, title: item.id, summary: item.id, updatedAt: item.createdAt, availableActions: [], status: "pending" })) as AttentionItem[];
  assert.deepEqual(sortAttentionItems(items).map((item) => item.id), ["old-critical", "old-high", "new-high"]);
});

test("inbox reads native attention families in parallel without per-item calls", async () => {
  const calls: string[] = [];
  const inbox = await getHumanControlInbox({
    snapshot: snapshot(),
    adapter: {
      listNativeExecApprovals: async () => { calls.push("exec.approval.list"); return { approvals: [] }; },
      listNativePluginApprovals: async () => { calls.push("plugin.approval.list"); return {}; },
      listQuestions: async () => { calls.push("question.list"); return { questions: [] }; }
    } as never
  });
  assert.deepEqual(calls.sort(), ["exec.approval.list", "plugin.approval.list", "question.list"]);
  assert.equal(inbox.summary.totalPending, 0);
});

test("ambiguous native approval resolution reconciles without a blind retry", async () => {
  let listCalls = 0;
  let resolveCalls = 0;
  const result = await resolveAttentionItem("approval:exec:approval-1", "approve", {}, {
    listNativeExecApprovals: async () => {
      listCalls += 1;
      return listCalls === 1 ? { approvals: [{ id: "approval-1", request: {} }] } : { approvals: [] };
    },
    resolveNativeExecApproval: async () => {
      resolveCalls += 1;
      throw new Error("Gateway request timed out after send");
    }
  } as never);
  assert.deepEqual(result, { reconciled: true, status: "resolved" });
  assert.equal(resolveCalls, 1);
  assert.equal(listCalls, 2);
});

test("runtime failures are projected only when the existing runtime model marks them actionable", () => {
  const item = projectRuntimeIssue({
    id: "runtime-1",
    type: "gateway_unreachable",
    source: "openclaw_gateway",
    severity: "action_required",
    title: "Gateway unavailable",
    message: "The runtime needs inspection.",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    status: "open"
  });
  assert.equal(item.type, "runtime-issue");
  assert.deepEqual(item.availableActions.map((action) => action.id), ["inspect"]);
});

test("Human Control integrates only native reads and resolutions", () => {
  const integrated = new Map(OPENCLAW_GATEWAY_COMPATIBILITY_OPERATIONS.map((operation) => [operation.id, operation]));
  assert.deepEqual(integrated.get("execApprovals")?.productIntegratedMethods, ["exec.approval.list", "exec.approval.resolve"]);
  assert.deepEqual(integrated.get("pluginApprovals")?.productIntegratedMethods, ["plugin.approval.list", "plugin.approval.resolve"]);
  assert.deepEqual(integrated.get("questions")?.productIntegratedMethods, ["question.list", "question.resolve"]);
  assert.equal(integrated.get("execApprovals")?.fallbackAllowed, false);
  assert.equal(integrated.get("pluginApprovals")?.fallbackAllowed, false);
  assert.equal(integrated.get("questions")?.fallbackAllowed, false);
});

test("open Human Control reuses the existing live refresh signal and preserves drafts", async () => {
  const source = await readFile("components/operations/human-control-inbox.tsx", "utf8");
  const hookSource = await readFile("hooks/use-mission-control-data.ts", "utf8");
  const streamSource = await readFile("app/api/stream/route.ts", "utf8");
  assert.match(source, /attentionRefreshGeneration/);
  assert.match(source, /HUMAN_CONTROL_INBOX_REFRESH_DEBOUNCE_MS/);
  assert.match(source, /if \(!openRef\.current\) return/);
  assert.match(source, /deferredRefreshRef/);
  assert.match(source, /preserveQuestionAnswers/);
  assert.doesNotMatch(source, /new EventSource/);
  assert.match(hookSource, /addEventListener\("attention"/);
  assert.match(hookSource, /attentionRefreshGeneration/);
  assert.doesNotMatch(hookSource, /liveRefreshGeneration/);
  assert.match(streamSource, /isHumanControlAttentionEvent/);
  assert.match(streamSource, /sendEvent\("attention"/);
  assert.doesNotMatch(streamSource, /HumanControl EventSource/);

  assert.equal(shouldScheduleHumanControlRefresh({ open: false, loading: false, pendingAction: false }), false);
  assert.equal(shouldScheduleHumanControlRefresh({ open: true, loading: false, pendingAction: false }), true);
  assert.equal(shouldScheduleHumanControlRefresh({ open: true, loading: true, pendingAction: false }), false);
  assert.equal(shouldScheduleHumanControlRefresh({ open: true, loading: false, pendingAction: true }), false);

  const question = projectQuestionRecord({
    id: "question-draft",
    questions: [{ questionId: "scope", header: "Scope", question: "Choose scope", options: [{ label: "US" }] }],
    createdAtMs: 1_700_000_000_000,
    expiresAtMs: Date.now() + 100_000,
    status: "pending"
  }, [], []);
  assert.deepEqual(preserveQuestionAnswers([question!], { scope: ["US"], resolved: ["old"] }), { scope: ["US"] });
  assert.deepEqual(preserveQuestionAnswers([], { resolved: ["old"] }), {});
});
