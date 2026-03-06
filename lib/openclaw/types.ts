export type DiagnosticHealth = "healthy" | "degraded" | "offline";

export type AgentStatus = "engaged" | "monitoring" | "ready" | "standby" | "offline";

export type RuntimeStatus = "active" | "queued" | "idle" | "completed" | "error";

export interface GatewayDiagnostics {
  installed: boolean;
  loaded: boolean;
  rpcOk: boolean;
  health: DiagnosticHealth;
  version?: string;
  dashboardUrl: string;
  gatewayUrl: string;
  bindMode?: string;
  port?: number;
  updateChannel?: string;
  updateInfo?: string;
  serviceLabel?: string;
  securityWarnings: string[];
  issues: string[];
}

export interface PresenceRecord {
  host: string;
  ip: string;
  version: string;
  platform: string;
  deviceFamily?: string;
  mode: string;
  reason: string;
  text: string;
  ts: number;
}

export interface WorkspaceProject {
  id: string;
  name: string;
  slug: string;
  path: string;
  kind: "workspace";
  agentIds: string[];
  modelIds: string[];
  activeRuntimeIds: string[];
  totalSessions: number;
  health: AgentStatus;
}

export interface OpenClawAgent {
  id: string;
  name: string;
  workspaceId: string;
  workspacePath: string;
  modelId: string;
  isDefault: boolean;
  status: AgentStatus;
  sessionCount: number;
  lastActiveAt: number | null;
  currentAction: string;
  activeRuntimeIds: string[];
  heartbeat: {
    enabled: boolean;
    every: string | null;
    everyMs: number | null;
  };
  identity: {
    emoji?: string;
    theme?: string;
    avatar?: string;
    source?: string;
  };
  profile: {
    purpose: string | null;
    operatingInstructions: string[];
    responseStyle: string[];
    outputPreference: string | null;
    sourceFiles: string[];
  };
  skills: string[];
  tools: string[];
}

export interface ModelRecord {
  id: string;
  name: string;
  provider: string;
  input: string;
  contextWindow: number | null;
  local: boolean | null;
  available: boolean | null;
  missing: boolean;
  tags: string[];
  usageCount: number;
}

export interface RuntimeRecord {
  id: string;
  source: "session" | "cron" | "turn";
  key: string;
  title: string;
  subtitle: string;
  status: RuntimeStatus;
  updatedAt: number | null;
  ageMs: number | null;
  agentId?: string;
  workspaceId?: string;
  modelId?: string;
  sessionId?: string;
  taskId?: string;
  runId?: string;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
  };
  metadata: Record<string, unknown>;
}

export interface RuntimeOutputItem {
  id: string;
  role: "assistant" | "toolResult" | "user";
  timestamp: string;
  text: string;
  toolName?: string;
  stopReason?: string | null;
  errorMessage?: string | null;
  isError?: boolean;
}

export interface RuntimeOutputRecord {
  runtimeId: string;
  sessionId?: string;
  taskId?: string;
  status: "available" | "missing" | "error";
  finalText: string | null;
  finalTimestamp: string | null;
  stopReason: string | null;
  errorMessage: string | null;
  items: RuntimeOutputItem[];
}

export type RelationshipKind = "contains" | "uses-model" | "active-run";

export interface RelationshipRecord {
  id: string;
  sourceId: string;
  targetId: string;
  kind: RelationshipKind;
  label?: string;
}

export interface MissionControlSnapshot {
  generatedAt: string;
  mode: "live" | "fallback";
  diagnostics: GatewayDiagnostics;
  presence: PresenceRecord[];
  workspaces: WorkspaceProject[];
  agents: OpenClawAgent[];
  models: ModelRecord[];
  runtimes: RuntimeRecord[];
  relationships: RelationshipRecord[];
  missionPresets: string[];
}

export interface MissionSubmission {
  mission: string;
  agentId?: string;
  workspaceId?: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
}

export interface MissionResponse {
  runId: string;
  agentId: string;
  status: string;
  summary: string;
  payloads: Array<{
    text: string;
    mediaUrl: string | null;
  }>;
  meta?: Record<string, unknown>;
}

export interface WorkspaceCreateInput {
  name: string;
  directory?: string;
  modelId?: string;
}

export interface WorkspaceUpdateInput {
  workspaceId: string;
  name?: string;
  directory?: string;
}

export interface WorkspaceDeleteInput {
  workspaceId: string;
}

export interface AgentCreateInput {
  id: string;
  workspaceId: string;
  modelId?: string;
  name?: string;
  emoji?: string;
  theme?: string;
  avatar?: string;
}

export interface AgentUpdateInput {
  id: string;
  workspaceId?: string;
  modelId?: string;
  name?: string;
  emoji?: string;
  theme?: string;
  avatar?: string;
}
