export type DiagnosticHealth = "healthy" | "degraded" | "offline";

export type AgentStatus = "engaged" | "monitoring" | "ready" | "standby" | "offline";

export type RuntimeStatus = "active" | "queued" | "idle" | "completed" | "partial" | "error";

export type AgentPreset = "worker" | "setup" | "browser" | "custom";

export type AgentMissingToolBehavior = "fallback" | "ask-setup" | "route-setup" | "allow-install";

export type AgentInstallScope = "none" | "workspace" | "system";

export type AgentFileAccess = "workspace-only" | "extended";

export type AgentNetworkAccess = "restricted" | "enabled";

export interface AgentPolicy {
  preset: AgentPreset;
  missingToolBehavior: AgentMissingToolBehavior;
  installScope: AgentInstallScope;
  fileAccess: AgentFileAccess;
  networkAccess: AgentNetworkAccess;
}

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

export interface WorkspaceResourceState {
  id: string;
  label: string;
  present: boolean;
}

export interface WorkspaceBootstrapState {
  template: WorkspaceTemplate | null;
  sourceMode: WorkspaceSourceMode | null;
  agentTemplate: string | null;
  coreFiles: WorkspaceResourceState[];
  optionalFiles: WorkspaceResourceState[];
  folders: WorkspaceResourceState[];
  projectShell: WorkspaceResourceState[];
  localSkillIds: string[];
}

export interface WorkspaceCapabilityState {
  skills: string[];
  tools: string[];
  workspaceOnlyAgentCount: number;
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
  bootstrap: WorkspaceBootstrapState;
  capabilities: WorkspaceCapabilityState;
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
  policy: AgentPolicy;
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
  isWarning?: boolean;
}

export interface RuntimeCreatedFile {
  path: string;
  displayPath: string;
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
  createdFiles: RuntimeCreatedFile[];
  warnings: string[];
  warningSummary: string | null;
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

export type WorkspaceSourceMode = "empty" | "clone" | "existing";

export type WorkspaceTemplate = "software" | "frontend" | "backend" | "research" | "content";

export type WorkspaceTeamPreset = "solo" | "core" | "custom";

export type WorkspaceModelProfile = "balanced" | "fast" | "quality";

export interface WorkspaceCreateRules {
  workspaceOnly: boolean;
  generateStarterDocs: boolean;
  generateMemory: boolean;
  kickoffMission: boolean;
}

export interface WorkspaceAgentBlueprintInput {
  id: string;
  role: string;
  name: string;
  enabled: boolean;
  emoji?: string;
  theme?: string;
  skillId?: string;
  modelId?: string;
  isPrimary?: boolean;
  policy?: AgentPolicy;
}

export interface WorkspaceCreateInput {
  name: string;
  brief?: string;
  directory?: string;
  modelId?: string;
  sourceMode?: WorkspaceSourceMode;
  repoUrl?: string;
  existingPath?: string;
  template?: WorkspaceTemplate;
  teamPreset?: WorkspaceTeamPreset;
  modelProfile?: WorkspaceModelProfile;
  rules?: Partial<WorkspaceCreateRules>;
  agents?: WorkspaceAgentBlueprintInput[];
}

export interface WorkspaceUpdateInput {
  workspaceId: string;
  name?: string;
  directory?: string;
}

export interface WorkspaceDeleteInput {
  workspaceId: string;
}

export interface WorkspaceCreateResult {
  workspaceId: string;
  workspacePath: string;
  agentIds: string[];
  primaryAgentId: string;
  kickoffRunId?: string;
  kickoffStatus?: string;
  kickoffError?: string;
}

export interface AgentCreateInput {
  id: string;
  workspaceId: string;
  modelId?: string;
  name?: string;
  emoji?: string;
  theme?: string;
  avatar?: string;
  policy?: AgentPolicy;
}

export interface AgentUpdateInput {
  id: string;
  workspaceId?: string;
  modelId?: string;
  name?: string;
  emoji?: string;
  theme?: string;
  avatar?: string;
  policy?: AgentPolicy;
}
