export type DiagnosticHealth = "healthy" | "degraded" | "offline";

export type AgentStatus = "engaged" | "monitoring" | "ready" | "standby" | "offline";

export type RuntimeStatus = "running" | "queued" | "idle" | "completed" | "stalled" | "cancelled";

export type MissionDispatchStatus = "queued" | "running" | "completed" | "stalled" | "cancelled";

export type AgentPreset = "worker" | "setup" | "browser" | "monitoring" | "custom";

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

export interface AgentHeartbeatInput {
  enabled: boolean;
  every?: string;
}

export interface ModelAuthProviderStatus {
  provider: string;
  connected: boolean;
  canLogin: boolean;
  detail: string | null;
}

export type OpenClawRuntimeSmokeTestStatus = "not-run" | "passed" | "failed";

export interface OpenClawRuntimeSessionStore {
  id: string;
  path: string;
  writable: boolean;
  issue?: string | null;
}

export interface OpenClawRuntimeSmokeTest {
  status: OpenClawRuntimeSmokeTestStatus;
  checkedAt: string | null;
  agentId: string | null;
  runId: string | null;
  summary: string | null;
  error: string | null;
}

export interface OpenClawRuntimeDiagnostics {
  stateRoot: string;
  stateWritable: boolean;
  sessionStoreWritable: boolean;
  sessionStores: OpenClawRuntimeSessionStore[];
  smokeTest: OpenClawRuntimeSmokeTest;
  issues: string[];
}

export interface ModelReadiness {
  ready: boolean;
  defaultModel: string | null;
  resolvedDefaultModel: string | null;
  defaultModelReady: boolean;
  recommendedModelId: string | null;
  preferredLoginProvider: string | null;
  totalModelCount: number;
  availableModelCount: number;
  localModelCount: number;
  remoteModelCount: number;
  missingModelCount: number;
  authProviders: ModelAuthProviderStatus[];
  issues: string[];
}

export interface DiscoveredModelCandidate {
  id: string;
  modelId: string;
  name: string;
  provider: string;
  contextWindow: number | null;
  supportsTools: boolean;
  isFree: boolean;
  input: string | null;
}

export interface GatewayDiagnostics {
  installed: boolean;
  loaded: boolean;
  rpcOk: boolean;
  health: DiagnosticHealth;
  version?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  updateError?: string;
  updateRoot?: string;
  updateInstallKind?: string;
  updatePackageManager?: string;
  workspaceRoot: string;
  configuredWorkspaceRoot: string | null;
  dashboardUrl: string;
  gatewayUrl: string;
  configuredGatewayUrl: string | null;
  bindMode?: string;
  port?: number;
  updateChannel?: string;
  updateInfo?: string;
  serviceLabel?: string;
  modelReadiness: ModelReadiness;
  runtime: OpenClawRuntimeDiagnostics;
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
  observedTools?: string[];
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
  toolNames?: string[];
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

export interface TaskRecord {
  id: string;
  key: string;
  title: string;
  mission: string | null;
  subtitle: string;
  status: RuntimeStatus;
  updatedAt: number | null;
  ageMs: number | null;
  workspaceId?: string;
  primaryAgentId?: string;
  primaryAgentName?: string | null;
  primaryRuntimeId?: string;
  dispatchId?: string;
  runtimeIds: string[];
  agentIds: string[];
  sessionIds: string[];
  runIds: string[];
  runtimeCount: number;
  updateCount: number;
  liveRunCount: number;
  artifactCount: number;
  warningCount: number;
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
  };
  metadata: Record<string, unknown>;
}

export type TaskFeedEventKind = "status" | "assistant" | "tool" | "artifact" | "warning" | "user";

export interface TaskFeedEvent {
  id: string;
  kind: TaskFeedEventKind;
  timestamp: string;
  title: string;
  detail: string;
  url?: string;
  filePath?: string;
  displayPath?: string;
  runtimeId?: string;
  agentId?: string;
  toolName?: string;
  isError?: boolean;
}

export type TaskIntegritySeverity = "warning" | "error";

export interface TaskIntegrityIssue {
  id: string;
  severity: TaskIntegritySeverity;
  title: string;
  detail: string;
}

export interface TaskIntegrityRecord {
  status: "verified" | "warning" | "error";
  outputDir: string | null;
  outputDirRelative: string | null;
  outputDirExists: boolean;
  outputFileCount: number;
  transcriptTurnCount: number;
  matchingTranscriptTurnCount: number;
  finalResponseText: string | null;
  finalResponseSource: "runtime" | "dispatch" | "none";
  dispatchSessionId: string | null;
  sessionMismatch: boolean;
  toolNames: string[];
  emails: string[];
  issues: TaskIntegrityIssue[];
}

export interface TaskDetailRecord {
  task: TaskRecord;
  runs: RuntimeRecord[];
  outputs: RuntimeOutputRecord[];
  liveFeed: TaskFeedEvent[];
  createdFiles: RuntimeCreatedFile[];
  warnings: string[];
  integrity: TaskIntegrityRecord;
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
  tasks: TaskRecord[];
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
  dispatchId?: string;
  runId: string | null;
  agentId: string;
  status: MissionDispatchStatus;
  summary: string;
  payloads: Array<{
    text: string;
    mediaUrl: string | null;
  }>;
  meta?: Record<string, unknown>;
}

export interface MissionAbortResponse {
  taskId: string;
  dispatchId: string | null;
  status: MissionDispatchStatus;
  summary: string;
  reason: string | null;
  runnerPid: number | null;
  childPid: number | null;
  abortedAt: string;
}

export type OpenClawUpdateStreamEvent =
  | {
      type: "status";
      phase: "starting" | "refreshing";
      message: string;
    }
  | {
      type: "log";
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "done";
      ok: boolean;
      message: string;
      exitCode?: number | null;
      stdout: string;
      stderr: string;
      snapshot?: MissionControlSnapshot;
    };

export type TaskDetailStreamEvent =
  | {
      type: "task";
      detail: TaskDetailRecord;
    }
  | {
      type: "ready";
      ok: boolean;
    }
  | {
      type: "error";
      error: string;
    };

export type OpenClawOnboardingPhase =
  | "detecting"
  | "installing-cli"
  | "installing-gateway"
  | "starting-gateway"
  | "verifying"
  | "ready";

export type OpenClawOnboardingStreamEvent =
  | {
      type: "status";
      phase: OpenClawOnboardingPhase;
      message: string;
    }
  | {
      type: "log";
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "done";
      ok: boolean;
      phase: OpenClawOnboardingPhase;
      message: string;
      exitCode?: number | null;
      stdout: string;
      stderr: string;
      snapshot?: MissionControlSnapshot;
      manualCommand?: string;
      docsUrl?: string;
    };

export type OpenClawModelOnboardingPhase =
  | "detecting"
  | "discovering"
  | "refreshing"
  | "configuring-default"
  | "authenticating"
  | "verifying"
  | "ready";

export type OpenClawModelOnboardingStreamEvent =
  | {
      type: "status";
      phase: OpenClawModelOnboardingPhase;
      message: string;
    }
  | {
      type: "log";
      stream: "stdout" | "stderr";
      text: string;
    }
  | {
      type: "done";
      ok: boolean;
      phase: OpenClawModelOnboardingPhase;
      message: string;
      exitCode?: number | null;
      stdout: string;
      stderr: string;
      snapshot?: MissionControlSnapshot;
      manualCommand?: string;
      docsUrl?: string;
      discoveredModels?: DiscoveredModelCandidate[];
    };

export type AddModelsProviderId =
  | "openai-codex"
  | "openrouter"
  | "ollama"
  | "openai"
  | "anthropic"
  | "xai";

export type AddModelsProviderCategory = "primary" | "other";

export type AddModelsProviderConnectKind = "oauth" | "apiKey" | "local";

export type AddModelsFlowState =
  | "idle"
  | "connecting"
  | "auth-error"
  | "discovery-loading"
  | "discovery-success"
  | "discovery-empty"
  | "add-success"
  | "add-error";

export interface AddModelsCatalogModel {
  id: string;
  name: string;
  provider: string;
  input: string;
  contextWindow: number | null;
  local: boolean;
  available: boolean;
  missing: boolean;
  alreadyAdded: boolean;
  recommended: boolean;
  supportsTools: boolean;
  isFree: boolean;
  tags: string[];
}

export interface AddModelsProviderConnectionStatus {
  provider: string;
  connected: boolean;
  canConnect: boolean;
  needsTerminal: boolean;
  detail: string | null;
}

export interface AddModelsEmptyState {
  kind: "no-models" | "ollama-empty" | "ollama-missing";
  title: string;
  description: string;
  commands?: string[];
}

export type AddModelsProviderAction = "status" | "connect" | "discover" | "add-models";

export type AddModelsProviderActionRequest =
  | {
      action: "status";
      provider: AddModelsProviderId;
    }
  | {
      action: "connect";
      provider: AddModelsProviderId;
      apiKey?: string;
      endpoint?: string;
    }
  | {
      action: "discover";
      provider: AddModelsProviderId;
    }
  | {
      action: "add-models";
      provider: AddModelsProviderId;
      modelIds: string[];
    };

export interface AddModelsProviderActionResult {
  ok: boolean;
  action: AddModelsProviderAction;
  provider: AddModelsProviderId;
  message: string;
  connection: AddModelsProviderConnectionStatus;
  models: AddModelsCatalogModel[];
  emptyState?: AddModelsEmptyState | null;
  manualCommand?: string | null;
  docsUrl?: string | null;
  snapshot?: MissionControlSnapshot;
}

export type OperationProgressStepStatus = "pending" | "active" | "done" | "error";

export interface OperationProgressActivity {
  id: string;
  message: string;
  status: OperationProgressStepStatus;
}

export interface OperationProgressStepSnapshot {
  id: string;
  label: string;
  description: string;
  status: OperationProgressStepStatus;
  percent: number;
  detail?: string;
  activities: OperationProgressActivity[];
}

export interface OperationProgressSnapshot {
  title: string;
  description: string;
  percent: number;
  steps: OperationProgressStepSnapshot[];
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

export interface WorkspaceDocOverride {
  path: string;
  content: string;
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
  heartbeat?: AgentHeartbeatInput;
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
  docOverrides?: WorkspaceDocOverride[];
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

export type WorkspaceCreateStreamEvent =
  | {
      type: "progress";
      progress: OperationProgressSnapshot;
    }
  | {
      type: "done";
      ok: true;
      progress: OperationProgressSnapshot;
      result: WorkspaceCreateResult;
    }
  | {
      type: "done";
      ok: false;
      error: string;
      progress?: OperationProgressSnapshot;
    };

export type WorkspacePlanStatus =
  | "draft"
  | "review"
  | "ready"
  | "deploying"
  | "deployed"
  | "blocked";

export type WorkspacePlanStage =
  | "intake"
  | "context-harvest"
  | "team-synthesis"
  | "pressure-test"
  | "decision-lock"
  | "ready"
  | "deploying"
  | "deployed";

export type PlannerAdvisorId =
  | "founder"
  | "product"
  | "architect"
  | "ops"
  | "growth"
  | "reviewer";

export type PlannerMessageRole = "assistant" | "user" | "system";

export type PlannerCompanyType =
  | "saas"
  | "agency"
  | "research-lab"
  | "content-brand"
  | "internal-ops"
  | "custom";

export type PlannerChannelType = "internal" | "slack" | "telegram" | "discord" | "googlechat";

export type PlannerWorkflowTrigger = "manual" | "event" | "cron" | "launch";

export type PlannerAutomationScheduleKind = "every" | "cron";

export type PlannerSandboxMode = "default" | "strict" | "extended";

export interface PlannerMessage {
  id: string;
  role: PlannerMessageRole;
  author: string;
  text: string;
  createdAt: string;
}

export interface PlannerAdvisorNote {
  id: string;
  advisorId: PlannerAdvisorId;
  advisorName: string;
  summary: string;
  recommendations: string[];
  concerns: string[];
  createdAt: string;
}

export type PlannerContextSourceKind = "prompt" | "website" | "repo" | "folder";

export type PlannerContextSourceStatus = "ready" | "error";

export type PlannerExperienceMode = "guided" | "advanced";

export type PlannerWorkspaceSize = "small" | "medium" | "large";

export type PlannerDecisionStatus = "inferred" | "confirmed" | "needs-confirmation";

export type PlannerRuntimeMode = "agent" | "fallback";

export type PlannerRuntimeStatus = "pending" | "ready" | "error";

export interface PlannerContextSource {
  id: string;
  kind: PlannerContextSourceKind;
  label: string;
  summary: string;
  details: string[];
  status: PlannerContextSourceStatus;
  createdAt: string;
  confidence?: number;
  url?: string;
  error?: string;
}

export interface PlannerInference {
  id: string;
  section: "company" | "product" | "workspace" | "team" | "operations" | "deploy";
  label: string;
  value: string;
  confidence: number;
  status: PlannerDecisionStatus;
  rationale: string;
  sourceLabels: string[];
}

export interface PlannerRuntimeState {
  mode: PlannerRuntimeMode;
  status: PlannerRuntimeStatus;
  workspaceId?: string;
  workspacePath?: string;
  architectAgentId?: string;
  architectSessionId: string;
  advisorAgentIds: Partial<Record<PlannerAdvisorId, string>>;
  advisorSessionIds: Partial<Record<PlannerAdvisorId, string>>;
  lastArchitectRunId?: string;
  lastAdvisorRunIds: string[];
  lastError?: string;
}

export interface PlannerIntakeState {
  started: boolean;
  initialPrompt: string;
  latestPrompt: string;
  sources: PlannerContextSource[];
  confirmations: string[];
  mode: PlannerExperienceMode;
  size: PlannerWorkspaceSize;
  reviewRequested: boolean;
  turnCount: number;
  inferences: PlannerInference[];
  suggestedReplies: string[];
}

export interface PlannerPersistentAgentSpec {
  id: string;
  role: string;
  name: string;
  purpose: string;
  enabled: boolean;
  isPrimary: boolean;
  emoji?: string;
  theme?: string;
  skillId?: string;
  modelId?: string;
  policy: AgentPolicy;
  heartbeat: AgentHeartbeatInput;
  responsibilities: string[];
  outputs: string[];
}

export interface PlannerWorkflowSpec {
  id: string;
  name: string;
  goal: string;
  trigger: PlannerWorkflowTrigger;
  ownerAgentId?: string;
  collaboratorAgentIds: string[];
  successDefinition: string;
  outputs: string[];
  channelIds: string[];
  enabled: boolean;
}

export interface PlannerChannelCredentialField {
  key: string;
  label: string;
  value: string;
  secret: boolean;
  placeholder?: string;
}

export interface PlannerChannelSpec {
  id: string;
  type: PlannerChannelType;
  name: string;
  purpose: string;
  target?: string;
  enabled: boolean;
  announce: boolean;
  requiresCredentials: boolean;
  credentials: PlannerChannelCredentialField[];
}

export interface PlannerAutomationSpec {
  id: string;
  name: string;
  description: string;
  enabled: boolean;
  scheduleKind: PlannerAutomationScheduleKind;
  scheduleValue: string;
  agentId?: string;
  mission: string;
  thinking: NonNullable<MissionSubmission["thinking"]>;
  announce: boolean;
  channelId?: string;
}

export interface PlannerHookSpec {
  id: string;
  name: string;
  source: string;
  enabled: boolean;
  notes: string;
}

export interface PlannerSandboxSpec {
  workspaceOnly: boolean;
  mode: PlannerSandboxMode;
  notes: string[];
}

export interface WorkspacePlan {
  id: string;
  status: WorkspacePlanStatus;
  stage: WorkspacePlanStage;
  createdAt: string;
  updatedAt: string;
  autopilot: boolean;
  readinessScore: number;
  architectSummary: string;
  runtime: PlannerRuntimeState;
  intake: PlannerIntakeState;
  company: {
    name: string;
    type: PlannerCompanyType;
    mission: string;
    targetCustomer: string;
    constraints: string[];
    successSignals: string[];
  };
  product: {
    offer: string;
    scopeV1: string[];
    nonGoals: string[];
    revenueModel: string;
    launchPriority: string[];
  };
  workspace: {
    name: string;
    directory?: string;
    sourceMode: WorkspaceSourceMode;
    repoUrl?: string;
    existingPath?: string;
    template: WorkspaceTemplate;
    modelProfile: WorkspaceModelProfile;
    modelId?: string;
    stackDecisions: string[];
    docs: string[];
    docOverrides: WorkspaceDocOverride[];
    rules: WorkspaceCreateRules;
  };
  team: {
    persistentAgents: PlannerPersistentAgentSpec[];
    allowEphemeralSubagents: boolean;
    maxParallelRuns: number;
    escalationRules: string[];
  };
  operations: {
    workflows: PlannerWorkflowSpec[];
    channels: PlannerChannelSpec[];
    automations: PlannerAutomationSpec[];
    hooks: PlannerHookSpec[];
    sandbox: PlannerSandboxSpec;
  };
  deploy: {
    blockers: string[];
    warnings: string[];
    firstMissions: string[];
    lastDeployedAt?: string;
    workspaceId?: string;
    workspacePath?: string;
    primaryAgentId?: string;
    createdAgentIds: string[];
    provisionedChannels: string[];
    provisionedAutomations: string[];
    kickoffRunIds: string[];
  };
  conversation: PlannerMessage[];
  advisorNotes: PlannerAdvisorNote[];
}

export interface WorkspacePlanDeployResult {
  plan: WorkspacePlan;
  workspaceId: string;
  workspacePath: string;
  primaryAgentId: string;
  agentIds: string[];
  kickoffRunIds: string[];
  warnings: string[];
}

export type WorkspacePlanDeployStreamEvent =
  | {
      type: "progress";
      progress: OperationProgressSnapshot;
    }
  | {
      type: "done";
      ok: true;
      progress: OperationProgressSnapshot;
      result: WorkspacePlanDeployResult;
    }
  | {
      type: "done";
      ok: false;
      error: string;
      progress?: OperationProgressSnapshot;
    };

export interface AgentCreateInput {
  id: string;
  workspaceId: string;
  modelId?: string;
  name?: string;
  emoji?: string;
  theme?: string;
  avatar?: string;
  policy?: AgentPolicy;
  heartbeat?: AgentHeartbeatInput;
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
  heartbeat?: AgentHeartbeatInput;
}

export interface AgentDeleteInput {
  agentId: string;
}

export type ResetTarget = "mission-control" | "full-uninstall";

export type ResetWorkspaceAction = "delete-folder" | "clean-integration";

export interface ResetPreviewWorkspace {
  workspaceId: string;
  name: string;
  path: string;
  sourceMode: WorkspaceSourceMode | null;
  action: ResetWorkspaceAction;
  agentCount: number;
  runtimeCount: number;
  liveAgentCount: number;
  reasons: string[];
}

export interface ResetPreviewPackageAction {
  packageName: string;
  manager: string | null;
  command: string | null;
  detected: boolean;
  reason: string | null;
}

export interface ResetPreview {
  target: ResetTarget;
  generatedAt: string;
  summary: {
    deleteFolderCount: number;
    metadataOnlyCount: number;
    agentCount: number;
    liveAgentCount: number;
    activeRuntimeCount: number;
  };
  workspaces: ResetPreviewWorkspace[];
  missionControlPaths: string[];
  browserStorageKeys: string[];
  openClawPaths: string[];
  packageActions: ResetPreviewPackageAction[];
  warnings: string[];
}

export type ResetStreamPhase =
  | "planning"
  | "agents"
  | "workspaces"
  | "mission-control-state"
  | "openclaw-state"
  | "package-removal"
  | "refreshing";

export type ResetStreamEvent =
  | {
      type: "status";
      phase: ResetStreamPhase;
      message: string;
    }
  | {
      type: "log";
      text: string;
    }
  | {
      type: "done";
      ok: boolean;
      target: ResetTarget;
      message: string;
      snapshot?: MissionControlSnapshot;
      backgroundLogPath?: string;
    };
