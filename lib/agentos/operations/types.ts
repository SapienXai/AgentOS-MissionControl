export type OperationTrigger =
  | { kind: "at"; at: string; timezone?: string | null }
  | { kind: "cron"; expression: string; timezone?: string | null }
  | { kind: "every"; everyMs: number };

export type OperationAction = "create" | "update" | "run" | "pause" | "resume" | "cancel" | "retry" | "disable" | "delete";

export type SystemOwnedMonitorKind = "heartbeat" | "skill-collection-review";

export type OperationSafety = {
  accountTargetId?: string | null;
  requiresApproval?: boolean;
  fileLease?: string | null;
  concurrency: "allow" | "forbid" | "replace";
};

export type OperationJob = {
  id: string;
  /** Native OpenClaw monitor ownership, when the Gateway declares it. */
  systemOwnedMonitor?: SystemOwnedMonitorKind | null;
  /** AgentOS-side stable automation key, when the job was provisioned by AgentOS. */
  automationId?: string | null;
  /** Exact OpenClaw cron job identity. Kept separate from the AgentOS key. */
  cronJobId?: string | null;
  name: string;
  description: string | null;
  enabled: boolean;
  status: "active" | "scheduled" | "running" | "failed" | "paused" | "completed" | "unknown";
  agentId: string | null;
  workspaceId: string | null;
  prompt: string | null;
  model: string | null;
  thinking: string | null;
  trigger: OperationTrigger | null;
  nextRunAt: string | null;
  lastRunAt: string | null;
  lastRunStatus: string | null;
  /** Gateway transcript projection for the most recent completed cron turn. */
  latestOutput?: string | null;
  recentResults?: OperationResult[];
  sessionKey?: string | null;
  sessionId?: string | null;
  sessionTarget?: string | null;
  safety: OperationSafety | null;
  health: { consecutiveFailures: number; successRate: number | null; degraded: boolean };
  capabilities: { readable: boolean; mutable: boolean; runHistory: boolean; reason: string | null };
};

export type OperationRun = {
  id: string;
  jobId: string;
  /** Exact OpenClaw cron run identity, when exposed by cron.runs. */
  cronRunId?: string | null;
  taskId?: string | null;
  sessionKey?: string | null;
  completionStatus?: string | null;
  deliveryStatus?: string | null;
  identityProvenance?: "authoritative" | "correlated" | "derived" | "heuristic";
  sourceOfTruth?: "openclaw.cron.job" | "openclaw.cron.runs" | "openclaw.tasks" | "agentos.dispatch" | "compatibility";
  status: "queued" | "running" | "ok" | "error" | "skipped" | "unknown";
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  sessionId: string | null;
  output: string | null;
  error: string | null;
  tokens: number | null;
  cost: number | null;
  artifacts: string[];
};

export type OperationResult = {
  id: string;
  timestamp: string;
  text: string;
};

export type OperationAuditEntry = {
  id: string;
  at: string;
  action: OperationAction;
  jobId: string | null;
  outcome: "accepted" | "blocked" | "failed";
  detail: string;
  requestId: string;
  actorId?: string | null;
  actorKind?: string | null;
  authenticationMethod?: string | null;
  sourceOfTruth?: string | null;
};

export type OperationsSnapshot = {
  generatedAt: string;
  source: "openclaw.cron" | "unavailable";
  scheduler: { enabled: boolean | null; nextWakeAt: string | null; state: "available" | "unsupported" | "degraded" };
  jobs: OperationJob[];
  runs: OperationRun[];
  audit: OperationAuditEntry[];
  notices: Array<{ severity: "warning" | "error"; title: string; detail: string }>;
};

export type OperationJobInput = {
  automationId?: string | null;
  idempotencyKey?: string | null;
  name: string;
  description?: string | null;
  agentId: string;
  workspaceId: string;
  prompt: string;
  model?: string | null;
  thinking?: "off" | "minimal" | "low" | "medium" | "high" | "xhigh" | null;
  trigger: OperationTrigger;
  context?: { sessionTarget?: "isolated" | "main" | `session:${string}`; lightContext?: boolean };
  safety?: Partial<OperationSafety>;
};
