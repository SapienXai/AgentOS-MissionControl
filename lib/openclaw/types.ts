import type { OpenClawCompatibilityReport } from "@/lib/openclaw/compat/types";
import type { ConfigUpdatePacingSnapshot } from "@/lib/openclaw/config-pacing-types";
import type { RuntimeIssue } from "@/lib/openclaw/runtime-issues";
import type {
  AgentOSWorkerProfile,
  AgentOSWorkerProfileInput
} from "@/lib/agentos/worker-profile";

export type DiagnosticHealth = "healthy" | "degraded" | "offline";
export type OpenClawBinarySelectionMode = "auto" | "local-prefix" | "global-path" | "custom";

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

export type AgentToolProfile = "minimal" | "coding" | "messaging" | "full";

export type AgentToolPolicyConfig = {
  profile?: AgentToolProfile;
  allow?: string[];
  deny?: string[];
  fs?: {
    workspaceOnly?: boolean;
  };
};

/** A supported-field patch for an OpenClaw agents.entries.<agentId>.tools entry. */
export type AgentToolPolicyInput = {
  profile?: AgentToolProfile | null;
  allow?: string[] | null;
  deny?: string[] | null;
  fs?: {
    workspaceOnly?: boolean;
  } | null;
};

export type AgentSandboxMode = "off" | "non-main" | "all";
export type AgentSandboxScope = "session" | "agent" | "shared";
export type AgentSandboxWorkspaceAccess = "none" | "ro" | "rw";

export type AgentSandboxConfig = {
  mode?: AgentSandboxMode;
  scope?: AgentSandboxScope;
  workspaceAccess?: AgentSandboxWorkspaceAccess;
};

/** A supported-field patch for an OpenClaw agents.entries.<agentId>.sandbox entry. */
export type AgentSandboxInput = {
  mode?: AgentSandboxMode | null;
  scope?: AgentSandboxScope | null;
  workspaceAccess?: AgentSandboxWorkspaceAccess | null;
};

export type AgentMemorySearchSource = "memory" | "sessions";

/**
 * Deliberately narrow subset of agents.entries.<agentId>.memory.search. Provider, paths,
 * and credential-backed settings stay in OpenClaw settings rather than an
 * employee profile.
 */
export type AgentMemorySearchConfig = {
  enabled?: boolean;
  sources?: AgentMemorySearchSource[];
};

export type AgentMemorySearchInput = {
  enabled?: boolean | null;
  sources?: AgentMemorySearchSource[] | null;
};

export interface AgentHeartbeatInput {
  enabled: boolean;
  every?: string;
}

export type AgentBootstrapFilePath = "IDENTITY.md" | "SOUL.md" | "TOOLS.md" | "HEARTBEAT.md";

export interface AgentBootstrapFileInput {
  path: AgentBootstrapFilePath;
  content: string;
}

export interface ModelAuthProviderStatus {
  provider: string;
  authMethod?: AddModelsProviderAuthMethod | null;
  availableAuthMethods?: AddModelsProviderAuthMethod[];
  connected: boolean;
  canLogin: boolean;
  detail: string | null;
}

export type OpenClawRuntimeSmokeTestStatus = "not-run" | "passed" | "failed";
export type OpenClawCompatibilityStatus = "compatible" | "degraded" | "incompatible" | "unknown";
export type OpenClawSmokeTestCheckStatus = "pass" | "warning" | "fail";

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

export type TaskHealthTransport = "gateway-native" | "cli-fallback" | "sidecar-derived" | "unsupported" | "unknown";
export type TaskHealthSeverity = "healthy" | "warning" | "critical" | "unknown";
export type TaskAuditState = "clean" | "findings" | "error" | "unknown";

export interface TaskAuditSummary {
  state: TaskAuditState;
  total: number;
  warnings: number;
  errors: number;
  byCode: Record<string, number>;
  explanation: string;
}

export interface TaskRunIssueGroup {
  id: string;
  agentId: string | null;
  agentName: string | null;
  runtime: string;
  sourceId: string | null;
  ownerKey: string | null;
  requesterSessionKey: string | null;
  childSessionKey: string | null;
  statusCounts: Record<string, number>;
  issueCount: number;
  lastErrorAt: string | null;
  lastSummary: string | null;
  lastError: string | null;
  taskIds: string[];
  runIds: string[];
  sessionKeys: string[];
}

export interface TaskHealthSummary {
  generatedAt: string;
  source: {
    status: TaskHealthTransport;
    taskList: TaskHealthTransport;
    audit: TaskHealthTransport;
    fallbackReason: string | null;
  };
  active: {
    active: number;
    queued: number;
    running: number;
  };
  currentIssue: {
    count: number;
    severity: TaskHealthSeverity;
    reasons: string[];
  };
  historical: {
    issueCount: number;
    failed: number;
    timedOut: number;
    lost: number;
    cancelled: number;
    succeeded: number;
    totalTracked: number;
  };
  audit: TaskAuditSummary;
  groups: TaskRunIssueGroup[];
  explanation: string;
}

export interface OpenClawSmokeTestCheck {
  id: string;
  label: string;
  status: OpenClawSmokeTestCheckStatus;
  required: boolean;
  summary: string;
  recovery: string | null;
  durationMs: number;
  rawDetails?: unknown;
}

export interface OpenClawCompatibilitySmokeReport {
  status: OpenClawCompatibilityStatus;
  checkedAt: string;
  durationMs: number;
  safeToDispatchMissions: boolean;
  recovery: string;
  checks: OpenClawSmokeTestCheck[];
  compatibility: {
    installedVersion: string | null;
    requiredOpenClawVersion: string | null;
    recommendedOpenClawVersion: string | null;
    gatewayProtocolVersion: string | null;
    requiredGatewayProtocolVersion: string;
    agentOsSupportedProtocolRange: {
      min: number;
      max: number;
    };
    nodeVersion: string | null;
    nodeRequiredVersion: string;
    nodeRecommendedVersion: string;
    nodeStatus: "supported" | "unsupported" | "unknown";
    gatewayAuthStatus: string;
    nativeGatewayStatus: string;
    cliFallbackUsageCount: number;
    lastNativeError: string | null;
    lastFallbackReason: string | null;
    modelReady: boolean | null;
  };
}

export interface OpenClawBinarySelection {
  mode: OpenClawBinarySelectionMode;
  path: string | null;
  resolvedPath: string | null;
  label: string;
  detail: string;
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

export type OpenClawCapabilitySupport = "supported" | "unsupported" | "unknown";
export type OpenClawCapabilityOperationMode = "gateway-native" | "cli-fallback" | "degraded" | "disabled" | "unknown";

export interface OpenClawCapabilityOperation {
  label: string;
  mode: OpenClawCapabilityOperationMode;
  methods: string[];
  events: string[];
  fallbackAllowed: boolean;
  baseline?: "required" | "optional" | "experimental";
  productIntegration?: "integrated" | "discovery-only";
  productIntegratedMethods?: string[];
  reason: string;
  recovery?: string | null;
  preferredMethod?: string | null;
  supportedMethod?: string | null;
  aliasMethods?: string[];
  compatibility?: "preferred" | "alias" | "missing" | "unknown";
}

export type OpenClawGatewayMethodContractAuditStatus = "advertised" | "verified" | "drift" | "unknown";
export type OpenClawGatewayMethodContractAuditSource =
  | "rpc.discover"
  | "rpc.methods"
  | "system.capabilities"
  | "capabilities"
  | "gateway-handshake"
  | "disabled"
  | "unavailable";

export interface OpenClawGatewayMethodContractAudit {
  status: OpenClawGatewayMethodContractAuditStatus;
  checkedAt: string;
  source: OpenClawGatewayMethodContractAuditSource;
  refreshIntervalMs: number;
  expectedMethodCount: number;
  advertisedMethodCount: number;
  missingMethodCount: number;
  missingMethods: string[];
  missingOperations: string[];
  baselineVersion?: string;
  requiredMethodCount?: number;
  missingRequiredMethods?: string[];
  optionalMethodCount?: number;
  missingOptionalMethods?: string[];
  experimentalMethodCount?: number;
  missingExperimentalMethods?: string[];
  reason: string;
}

export interface OpenClawGatewayCompatibilityProfile {
  protocol: {
    status: "compatible" | "unknown" | "unsupported";
    version: string | null;
    reason: string;
  };
  methodContract: OpenClawGatewayMethodContractAudit;
  nativeOperationCount: number;
  degradedOperationCount: number;
  unknownOperationCount: number;
  aliasOperations: string[];
  degradedOperations: string[];
}

export interface OpenClawGatewayFallbackDiagnosticRecord {
  at: string;
  operation: string;
  operationLabel: string;
  issue: string;
  kind: string;
  recovery: string;
}

export interface OpenClawEventBridgeStreamStatus {
  mode: "live" | "reconnecting" | "polling";
  connected: boolean;
  reconnecting: boolean;
  reconnectAttempt: number;
  lastEventAt: string | null;
  lastError: string | null;
  message: string | null;
  recovery: string | null;
  lastSequenceGapAt?: string | null;
  expectedSeq?: number | null;
  receivedSeq?: number | null;
  reconciliationState?: "idle" | "in-flight" | "failed";
  lastReconciledAt?: string | null;
  gapCount?: number;
}

export interface OpenClawCapabilityMatrix {
  detectedAt: string;
  openClawVersion: string | null;
  gatewayProtocolVersion: string | null;
  requestedProtocolRange?: {
    min: number;
    max: number;
  };
  authMode: string | null;
  authRole?: string | null;
  authScopes?: string[];
  supportedMethods: string[];
  supportedEvents?: string[];
  supportedCapabilities?: string[];
  configSchema: OpenClawCapabilitySupport;
  configSchemaLookup?: OpenClawCapabilitySupport;
  configPatch: OpenClawCapabilitySupport;
  chatEvents: OpenClawCapabilitySupport;
  logsTail?: OpenClawCapabilitySupport;
  cronRead?: OpenClawCapabilitySupport;
  channels: OpenClawCapabilitySupport;
  skills: OpenClawCapabilitySupport;
  approvals: OpenClawCapabilitySupport;
  updates: OpenClawCapabilitySupport;
  nativeMissionDispatch: OpenClawCapabilitySupport;
  nativeAgentLifecycle: OpenClawCapabilitySupport;
  eventBridge: OpenClawCapabilitySupport;
  operations?: Record<string, OpenClawCapabilityOperation>;
  compatibility?: OpenClawGatewayCompatibilityProfile;
  degradedFeatures?: string[];
  fallbackDiagnostics?: OpenClawGatewayFallbackDiagnosticRecord[];
  fallbackReasons?: string[];
  unsupportedGatewayMethods: string[];
  diagnostics: string[];
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
  updateCompatibility?: OpenClawUpdateCompatibilitySnapshot;
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
  openClawBinarySelection: OpenClawBinarySelection;
  modelReadiness: ModelReadiness;
  capabilityMatrix?: OpenClawCapabilityMatrix;
  compatibilityReport?: OpenClawCompatibilityReport | null;
  configUpdatePacing: ConfigUpdatePacingSnapshot;
  gatewayFallbackDiagnostics?: OpenClawGatewayFallbackDiagnosticRecord[];
  gatewayFallbackReasons?: string[];
  compatibilitySmokeTest?: OpenClawCompatibilitySmokeReport | null;
  runtime: OpenClawRuntimeDiagnostics;
  eventBridge?: OpenClawEventBridgeStreamStatus;
  commandHistory?: OpenClawCommandDiagnostic[];
  transport?: import("@/lib/openclaw/client/types").OpenClawGatewayClientDiagnostics;
  runtimeIssues: RuntimeIssue[];
  taskHealth?: TaskHealthSummary;
  securityWarnings: string[];
  issues: string[];
}

export type OpenClawUpdateCompatibilityStatus = "certified" | "candidate" | "blocked" | "unknown";
export type OpenClawUpdateCompatibilityMode = "recommended" | "candidate" | "advanced";

export interface OpenClawUpdateCompatibilityVersion {
  version: string;
  status: OpenClawUpdateCompatibilityStatus;
  minRequiredAgentOsVersion: string | null;
  notes: string | null;
  reason: string | null;
}

export interface OpenClawUpdateDecision {
  version: string;
  status: OpenClawUpdateCompatibilityStatus;
  allowed: boolean;
  defaultVisible: boolean;
  requiresExplicitOptIn: boolean;
  requiresAgentOsUpdate: boolean;
  minRequiredAgentOsVersion: string | null;
  reason: string;
  notes: string | null;
}

export interface OpenClawUpdateCompatibilitySnapshot {
  manifestSource: "local-fallback" | "remote" | "override";
  agentOsVersion: string;
  currentVersion: string | null;
  recommendedVersion: string;
  recommendedDecision: OpenClawUpdateDecision;
  latestDecision: OpenClawUpdateDecision | null;
  certifiedVersions: OpenClawUpdateCompatibilityVersion[];
  candidateVersions: OpenClawUpdateCompatibilityVersion[];
  blockedVersions: OpenClawUpdateCompatibilityVersion[];
  unknownVersions: OpenClawUpdateCompatibilityVersion[];
}

export type OpenClawUpdateSafetyCheckStatus = "safe" | "warning" | "blocker" | "unknown";

export interface OpenClawUpdateSafetyCheck {
  id: string;
  label: string;
  status: OpenClawUpdateSafetyCheckStatus;
  message: string;
}

export type OpenClawServerMethodContractDiffStatus = "safe" | "warning" | "blocker" | "unknown";

export interface OpenClawServerMethodContractChange {
  method: string;
  kind: "added" | "removed" | "renamed" | "replaced" | "scope-changed" | "policy-changed";
  status: OpenClawServerMethodContractDiffStatus;
  authorizationEvidence: "static" | "runtime-required";
  currentScope: string | null;
  targetScope: string | null;
  affectedOperations: string[];
  message: string;
}

export interface OpenClawServerMethodContractDiffReport {
  generatedAt: string;
  source: "github-static" | "unavailable";
  currentVersion: string;
  targetVersion: string;
  status: OpenClawServerMethodContractDiffStatus;
  currentMethodCount: number | null;
  targetMethodCount: number | null;
  currentRegisteredMethodCount: number | null;
  targetRegisteredMethodCount: number | null;
  changedFiles: string[];
  changedServerMethodFiles: string[];
  changedProtocolFiles: string[];
  changes: OpenClawServerMethodContractChange[];
  blockerCount: number;
  warningCount: number;
  unknownCount: number;
  renamedCount: number;
  replacedCount: number;
  summary: string;
  error: string | null;
}

export interface OpenClawUpdateSafetyReport {
  generatedAt: string;
  targetVersion: string;
  currentVersion: string | null;
  recommendedVersion: string;
  supportedBaselineVersion: string;
  decision: OpenClawUpdateDecision;
  canAttemptUpdate: boolean;
  requiresExplicitConfirmation: boolean;
  rollbackSnapshotAvailable: boolean;
  serverMethodContractDiff?: OpenClawServerMethodContractDiffReport | null;
  recommendedNextAction: string;
  safeChecks: OpenClawUpdateSafetyCheck[];
  warnings: OpenClawUpdateSafetyCheck[];
  blockers: OpenClawUpdateSafetyCheck[];
  unknowns: OpenClawUpdateSafetyCheck[];
  summary: {
    gatewayReachable: boolean;
    gatewayProtocol: string;
    nativeAuth: string;
    modelReadiness: string;
    nativeGatewayCoverage: string;
    cliFallbackCount: number;
    runtimeIssueCount: number;
    unsupportedOperationCount: number;
    degradedSurfaceCount: number;
  };
}

export interface OpenClawShadowProbeReport {
  generatedAt: string;
  targetVersion: string;
  supported: boolean;
  mutationSafe: true;
  ok: boolean;
  limitation: string | null;
  command: string | null;
  currentBinaryVersion: string | null;
  stdout: string;
  stderr: string;
  checks: OpenClawUpdateSafetyCheck[];
  recommendedNextAction: string;
}

export type OpenClawCapabilityDiffChangeKind =
  | "added"
  | "removed"
  | "mode-changed"
  | "method-changed"
  | "fallback-changed"
  | "unchanged";

export type OpenClawCapabilityDiffSeverity = "improvement" | "regression" | "changed" | "unchanged";

export interface OpenClawCapabilityDiffRow {
  operationId: string;
  label: string;
  changeKind: OpenClawCapabilityDiffChangeKind;
  severity: OpenClawCapabilityDiffSeverity;
  certifiedMode: OpenClawCapabilityOperationMode | "missing";
  targetMode: OpenClawCapabilityOperationMode | "missing";
  certifiedNative: boolean;
  targetNative: boolean;
  certifiedFallbackAllowed: boolean;
  targetFallbackAllowed: boolean;
  addedMethods: string[];
  removedMethods: string[];
  addedEvents: string[];
  removedEvents: string[];
  missingRequiredMethods: string[];
  reason: string;
  recovery: string | null;
  evidenceSource: string | null;
  preferredMethod: string | null;
  supportedMethod: string | null;
  aliasMethods: string[];
  targetReason: string;
  targetRecovery: string | null;
}

export interface OpenClawPluginConfigMigrationFinding {
  kind: "plugin-api" | "plugin-install" | "config-version" | "config-patch" | "update-status-schema";
  severity: OpenClawCertificationScorecardFindingSeverity;
  pluginId: string | null;
  pluginVersion: string | null;
  requiredApiVersion: string | null;
  hostVersion: string | null;
  configWriterVersion: string | null;
  configKey: string | null;
  message: string;
  recovery: string | null;
}

export interface OpenClawCertificationRoundTripStep {
  id: "baseline-restore" | "target-install" | "target-verify" | "rollback-verify" | "final-target-verify";
  requestedVersion: string;
  installedVersion: string | null;
  gatewayLoaded: boolean;
  rpcReady: boolean;
  runtimeSmokeStatus: OpenClawRuntimeSmokeTest["status"] | "unknown";
  fallbackCount: number;
  exitCode: number | null;
  ok: boolean;
  message: string;
  stdoutPreview: string | null;
  stderrPreview: string | null;
}

export interface OpenClawCertificationRoundTripEvidence {
  status: "passed" | "failed" | "not-run";
  startedAt: string | null;
  finishedAt: string | null;
  baselineVersion: string | null;
  targetVersion: string | null;
  steps: OpenClawCertificationRoundTripStep[];
  failureMessage: string | null;
}

export interface OpenClawCapabilityDiffReport {
  generatedAt: string;
  certifiedVersion: string | null;
  targetVersion: string | null;
  certifiedProtocolVersion: string | null;
  targetProtocolVersion: string | null;
  summary: {
    totalOperations: number;
    unchangedOperations: number;
    addedOperations: number;
    removedOperations: number;
    nativeImprovements: number;
    nativeRegressions: number;
    fallbackRegressions: number;
    newMissingRequiredMethods: number;
    degradedOrUnknownOperations: number;
    certificationBlockerCount: number;
  };
  rows: OpenClawCapabilityDiffRow[];
}

export type OpenClawCertificationScorecardStatus =
  | "certified"
  | "pre_certified_eligible"
  | "compatible_with_warnings"
  | "degraded"
  | "blocked"
  | "evidence_missing";

export type OpenClawCertificationScorecardCategoryId =
  | "registry-policy"
  | "capability-contract"
  | "gateway-lifecycle"
  | "runtime-smoke"
  | "update-rollback"
  | "plugin-config";

export type OpenClawCertificationScorecardFindingSeverity = "blocker" | "warning" | "unknown" | "info";

export interface OpenClawCertificationScorecardFinding {
  id: string;
  severity: OpenClawCertificationScorecardFindingSeverity;
  message: string;
}

export interface OpenClawCertificationScorecardCategory {
  id: OpenClawCertificationScorecardCategoryId;
  label: string;
  score: number;
  maxScore: number;
  status: OpenClawCertificationScorecardStatus;
  evidence: string;
  findings: OpenClawCertificationScorecardFinding[];
}

export interface OpenClawCertificationScorecardArtifact {
  schemaVersion: 1;
  generatedAt: string;
  baselineVersion: string | null;
  targetVersion: string | null;
  score: number;
  status: OpenClawCertificationScorecardStatus;
  globalCertification: "certified" | "not_certified";
  hardBlockers: string[];
  warnings: string[];
  unknowns: string[];
  categories: OpenClawCertificationScorecardCategory[];
  capabilityDiff: OpenClawCapabilityDiffReport | null;
  capabilityBlockerRows: OpenClawCapabilityDiffRow[];
  pluginConfigFindings: OpenClawPluginConfigMigrationFinding[];
  roundTripEvidence: OpenClawCertificationRoundTripEvidence;
}

export interface OpenClawCertificationScorecardReport {
  generatedAt: string;
  baselineVersion: string | null;
  targetVersion: string | null;
  score: number;
  status: OpenClawCertificationScorecardStatus;
  globalCertification: "certified" | "not_certified";
  hardBlockers: string[];
  warnings: string[];
  unknowns: string[];
  categories: OpenClawCertificationScorecardCategory[];
  capabilityDiff: OpenClawCapabilityDiffReport | null;
  capabilityBlockerRows: OpenClawCapabilityDiffRow[];
  pluginConfigFindings: OpenClawPluginConfigMigrationFinding[];
  roundTripEvidence: OpenClawCertificationRoundTripEvidence;
  artifact: OpenClawCertificationScorecardArtifact | null;
}

export interface OpenClawCommandDiagnostic {
  id: string;
  command: string;
  args: string[];
  startedAt: string;
  finishedAt: string;
  durationMs: number;
  status: "ok" | "failed" | "timeout" | "aborted" | "start-error";
  exitCode: number | null;
  stdoutPreview: string | null;
  stderrPreview: string | null;
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
  contextFiles?: WorkspaceResourceState[];
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
  createdAt?: number | null;
  agentIds: string[];
  modelIds: string[];
  activeRuntimeIds: string[];
  totalSessions: number;
  health: AgentStatus;
  bootstrap: WorkspaceBootstrapState;
  capabilities: WorkspaceCapabilityState;
  channels: WorkspaceChannelSummary[];
}

export interface WorkspaceChannelGroupAssignment {
  chatId: string;
  agentId: string | null;
  title?: string | null;
  enabled: boolean;
}

export interface WorkspaceChannelWorkspaceBinding {
  workspaceId: string;
  workspacePath: string;
  agentIds: string[];
  groupAssignments: WorkspaceChannelGroupAssignment[];
}

export interface WorkspaceChannelSummary {
  id: string;
  type: MissionControlSurfaceProvider;
  name: string;
  primaryAgentId: string | null;
  workspaces: WorkspaceChannelWorkspaceBinding[];
}

export interface ChannelRegistry {
  version: 1;
  channels: WorkspaceChannelSummary[];
}

export interface ChannelAccountRecord {
  id: string;
  /** Canonical OpenClaw accountId; id remains the persisted compatibility key. */
  accountId?: string;
  type: MissionControlSurfaceProvider;
  name: string;
  enabled: boolean;
  configured?: boolean;
  isDefault?: boolean;
  kind?: MissionControlSurfaceKind;
  capabilities?: string[];
  metadata?: Record<string, unknown>;
}

export type SurfaceRuntimeSource = "gateway-probe" | "gateway-status" | "config-only" | "unavailable";

export type SurfaceAccountHealthStatus =
  | "connected"
  | "running"
  | "linked"
  | "stopped"
  | "needs-authentication"
  | "configured"
  | "disabled"
  | "failed"
  | "unknown"
  | "gateway-blocked";

export interface SurfaceAccountRuntimeStatus {
  key: string;
  provider: MissionControlSurfaceProvider;
  accountId: string;
  name: string;
  label: string;
  enabled: boolean;
  configured: boolean;
  linked: boolean;
  running: boolean;
  connected: boolean;
  isDefault?: boolean | null;
  authenticationRequired?: boolean | null;
  disabled: boolean;
  failed: boolean;
  status: SurfaceAccountHealthStatus;
  healthState: string | null;
  errorMessage: string | null;
  source: SurfaceRuntimeSource;
  checkedAt: string | null;
  raw?: Record<string, unknown>;
}

export interface SurfaceGatewayRepairAction {
  apiAction: "generateLocalToken" | "repairDeviceAccess";
  cta: string;
  label: string;
  detail: string;
}

export interface SurfaceGatewayAccessState {
  ok: boolean;
  blocked: boolean;
  role: string | null;
  scopes: string[];
  missingScopes: string[];
  requestId: string | null;
  issue: string | null;
  repairAvailable: boolean;
  repairAction: SurfaceGatewayRepairAction | null;
}

export interface SurfaceRuntimeSnapshot {
  source: SurfaceRuntimeSource;
  checkedAt: string | null;
  gatewayAccess: SurfaceGatewayAccessState;
  providerOrder: MissionControlSurfaceProvider[];
  providerLabels: Record<string, string>;
  accountsByProvider: Record<string, Record<string, SurfaceAccountRuntimeStatus>>;
  accountsByKey: Record<string, SurfaceAccountRuntimeStatus>;
  issue: string | null;
}

export type SurfaceBindingDriftKind =
  | "missing-binding"
  | "extra-binding"
  | "agent-mismatch"
  | "account-missing"
  | "provider-disabled";

export interface SurfaceBindingDriftIssue {
  id: string;
  kind: SurfaceBindingDriftKind;
  severity: "warning" | "error";
  title: string;
  detail: string;
  workspaceId: string | null;
  workspacePath: string | null;
  provider: MissionControlSurfaceProvider;
  accountId: string | null;
  routeId: string | null;
  routeKind: string | null;
  expectedAgentId: string | null;
  actualAgentId: string | null;
  bindingKey: string | null;
}

export interface SurfaceDriftSnapshot {
  checked: boolean;
  source: "openclaw-bindings" | "unavailable";
  checkedAt: string | null;
  expectedBindingCount: number;
  currentBindingCount: number;
  summary: {
    ok: number;
    missingBindings: number;
    extraBindings: number;
    agentMismatch: number;
    accountMissing: number;
    providerDisabled: number;
  };
  issues: SurfaceBindingDriftIssue[];
}

export interface SurfaceBindingRepairResult {
  scope: "workspace" | "all";
  workspaceId: string | null;
  checkedAt: string;
  dryRun: boolean;
  applied: boolean;
  auditId?: string;
  auditPath?: string;
  confirmedPreviewAuditId?: string;
  backupId?: string;
  backupPath?: string;
  restorePlan?: SurfaceBindingRepairRestorePlan;
  expectedBindingCount: number;
  previousBindingCount: number;
  nextBindingCount: number;
  changed: boolean;
  removedBindingCount: number;
  addedBindingCount: number;
  configMutations?: SurfaceConfigRepairMutation[];
  drift: SurfaceDriftSnapshot;
}

export interface SurfaceBindingRepairRestorePlan {
  auditId: string;
  createdAt: string;
  configPaths: string[];
  backupId?: string;
  backupPath?: string;
  confirmedPreviewAuditId?: string;
  instructions: string[];
}

export interface SurfaceConfigRepairMutation {
  path: string;
  appliedVia: "config.patch" | "config.apply" | "config.set" | "cli" | "noop";
  baseHash?: string;
  reloadKind?: string;
  restartRequired?: boolean;
  hotReloaded?: boolean;
  changedPaths?: string[];
}

export interface OpenClawAgent {
  id: string;
  kind?: "agent" | "system";
  createdVia?: "operator" | "agent" | "claw";
  creatorAgentId?: string | null;
  createdAt?: number;
  name: string;
  identityName?: string;
  workspaceId: string;
  workspacePath: string;
  agentDir?: string;
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
  workerProfile?: AgentOSWorkerProfile | null;
  toolPolicy?: AgentToolPolicyConfig | null;
  sandbox?: AgentSandboxConfig | null;
  memorySearch?: AgentMemorySearchConfig | null;
  skills: string[];
  tools: string[];
  observedTools?: string[];
  policy: AgentPolicy;
}

export type EffectiveCapabilityStatus =
  | "available"
  | "requires-approval"
  | "needs-setup"
  | "blocked"
  | "unavailable"
  | "unknown";

export type EffectiveCapabilityReasonCode =
  | "tool_effective"
  | "tool_not_effective"
  | "tool_blocked"
  | "tool_not_available"
  | "account_not_connected"
  | "approval_required"
  | "runtime_unavailable"
  | "effective_state_unavailable"
  | "session_context_missing"
  | "skill_not_active"
  | "policy_denied"
  | "unknown";

export type EffectiveCapabilityReason = {
  code: EffectiveCapabilityReasonCode;
  message: string;
};

export type EffectiveCapabilityEvidence = {
  tool?: {
    id: string;
    toolIds?: string[];
    catalogPresent: boolean;
    effectivePresent: boolean | null;
    deniedBySession: boolean;
    source?: string | null;
    sessionKey?: string | null;
  };
  effectiveTools?: {
    status: "available" | "failed" | "not-requested";
    failure?: "timeout" | "insufficient-scope" | "unsupported" | "interrupted" | "malformed" | "unknown";
  };
  skill?: {
    skillId: string;
    revision: string;
    active: boolean;
  };
  account?: {
    provider: string;
    connected: boolean | null;
    accountId?: string | null;
  };
  policy?: {
    denied: boolean | null;
    layer?: string | null;
  };
  approval?: {
    required: boolean | null;
    canRequest: boolean | null;
  };
  runtime?: {
    available: boolean | null;
    sessionKey?: string | null;
    profile?: string | null;
  };
};

export type EffectiveCapability = {
  id: string;
  label: string;
  category: string;
  description: string;
  status: EffectiveCapabilityStatus;
  explanation: string;
  configured: boolean | null;
  effective: boolean | null;
  evidence: EffectiveCapabilityEvidence;
  reasons: EffectiveCapabilityReason[];
  remediation?: {
    id: "connect-account" | "review-policy" | "activate-skill" | "open-settings";
    label: string;
  };
};

export type AttentionItemType =
  | "approval"
  | "question"
  | "suggested-work"
  | "needs-setup"
  | "blocked"
  | "runtime-issue";

export type AttentionSeverity = "critical" | "high" | "normal" | "low";

export type AttentionAction = {
  id: "approve" | "deny" | "answer" | "accept" | "dismiss" | "review" | "inspect" | "open-setup" | "review-policy";
  label: string;
  requiresPayload?: boolean;
};

export type AttentionItem = {
  id: string;
  type: AttentionItemType;
  source: {
    system: "openclaw" | "agentos";
    kind: string;
    nativeId?: string | null;
    sessionKey?: string | null;
    taskId?: string | null;
  };
  worker: {
    id: string | null;
    label: string | null;
  };
  mission?: {
    id: string | null;
    title: string | null;
  };
  severity: AttentionSeverity;
  title: string;
  summary: string;
  createdAt: string | null;
  updatedAt: string | null;
  availableActions: AttentionAction[];
  status: "pending" | "resolved" | "unavailable";
  question?: Array<{
    questionId: string;
    text: string;
    options: Array<{ label: string; description?: string }>;
    multiSelect: boolean;
    isOther?: boolean;
    isSecret?: boolean;
  }>;
  evidence?: {
    allowedDecisions?: string[];
    capabilityId?: string;
    toolId?: string;
    reasonCode?: string;
    runtimeIssueType?: string;
  };
};

export type HumanControlInboxSummary = {
  totalPending: number;
  approvals: number;
  questions: number;
  suggestedWork: number;
  setupAndBlockers: number;
  runtimeIssues: number;
};

export type HumanControlInbox = {
  items: AttentionItem[];
  summary: HumanControlInboxSummary;
  sources: {
    approvals: "available" | "unavailable";
    questions: "available" | "unavailable";
    suggestedWork: "available" | "unavailable";
    capabilities: "available" | "partial" | "unavailable";
    runtime: "available" | "unavailable";
  };
  generatedAt: string;
  issues?: string[];
};

export type SkillLibraryOwnershipScope = "personal" | "shared" | "unknown";

export type SkillLibraryItem = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  ownership: {
    scope: SkillLibraryOwnershipScope;
    ownerId: string | null;
    ownerLabel: string | null;
    authorId: string | null;
  };
  revision: {
    id: string;
    version: string | null;
    createdAt: string | null;
    updatedAt: string | null;
  };
  activation: {
    enabled: boolean;
    activeInSession: boolean | null;
    activeRevisionId: string | null;
    sessionKey: string | null;
  };
  source: "openclaw-library";
  canEdit: boolean;
  removed: boolean;
};

export type SkillLibraryRevision = {
  id: string;
  createdAt: string | null;
};

export type SkillLibraryDetail = {
  item: SkillLibraryItem;
  content: string;
  files: Array<{
    path: string;
    content: string;
    encoding: "utf8" | "base64";
    executable: boolean;
  }>;
  revisions: SkillLibraryRevision[];
};

export type WorkerEffectiveCapabilitiesPayload = {
  workerId: string;
  capturedAt: string;
  session: {
    key: string | null;
    updatedAt: number | null;
    profile: string | null;
  };
  capabilities: EffectiveCapability[];
  skills: SkillLibraryItem[];
  skillLibrary: {
    supported: boolean;
    error: string | null;
  };
  sources: {
    toolsCatalog: "native" | "unavailable";
    toolsEffective: "native" | "failed" | "not-requested";
    skillsLibrary: "native" | "unavailable";
    accounts: "native" | "unavailable";
  };
  summary: Record<EffectiveCapabilityStatus, number>;
};

export interface ModelRecord {
  id: string;
  name: string;
  provider: string;
  input: string;
  contextWindow: number | null;
  contextWindows?: Array<{ id: string; label: string; contextWindow: number }>;
  contextWindowDefault?: string;
  local: boolean | null;
  available: boolean | null;
  unavailableReason?: string;
  unavailableUntil?: number;
  reasoning?: boolean;
  thinkingLevels?: Array<{ id: string; label: string }>;
  thinkingDefault?: string;
  supportsTools?: boolean;
  alias?: string;
  apiKeySupported?: boolean;
  agentRuntime?: { id: string; fallback?: "openclaw" | "none"; source?: string };
  deprecated?: boolean;
  disabled?: boolean;
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
  workspacePath?: string;
  modelId?: string;
  /** Native OpenClaw provenance for the session model shown in this runtime. */
  modelOverrideSource?: "user" | "auto" | null;
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

export type NativeWorkCapabilityState = "supported" | "unsupported" | "unknown" | "degraded";

export interface ManagedWorktreeProjection {
  id: string;
  name: string;
  repoRoot: string;
  path: string;
  branch: string;
  baseRef: string;
  ownerKind: "manual" | "workboard" | "session";
  ownerId: string | null;
  createdAt: number;
  lastActiveAt: number;
  lifecycle: "active" | "removed" | "cleanup-failed";
  cleanupOutcome: string | null;
  sourceOfTruth: "openclaw";
}

export type SessionMembershipDetailState = "not-loaded" | "available" | "unavailable";

export interface SessionOwnershipProjection {
  createdActor: { type: "human" | "agent" | "system"; id: string | null; label: string | null } | null;
  owner: { type: "human" | "agent" | "system"; id: string | null; label: string | null; assignedAt: number | null } | null;
  participants: Array<{ identityId: string; label: string | null }>;
  participantCount: number;
  visibility: "shared" | "read-only" | "suggest" | "draft" | null;
  allowedVisibilities: Array<"shared" | "read-only" | "suggest" | "draft">;
  sharingRole: "admin" | "owner" | "member" | "viewer" | null;
  memberEvidence: Array<{ identityId: string; addedBy: string | null; addedByState: "known" | "unknown"; addedAt: number }>;
  membershipDetailState: SessionMembershipDetailState;
  sourceOfTruth: "openclaw";
}

export interface NativeWorkExecutionProjection {
  sessionKey: string;
  sessionId: string | null;
  agentId: string | null;
  status: RuntimeStatus;
  updatedAt: number | null;
  execCwd: string | null;
  worktree: { id: string; branch: string; repoRoot: string; path: string | null } | null;
  ownership: SessionOwnershipProjection;
  taskIds: string[];
  sourceOfTruth: "openclaw";
}

export interface SuggestedWorkProjection {
  id: string;
  title: string;
  summary: string;
  prompt: string;
  cwd: string;
  sourceSessionKey: string;
  sourceAgentId: string | null;
  createdAt: number;
  availableAcceptModes: Array<"worktree" | "local" | "cloud" | "session">;
  status: "suggested";
  sourceOfTruth: "openclaw";
}

export interface NativeWorkSnapshot {
  availability: {
    worktrees: NativeWorkCapabilityState;
    suggestions: NativeWorkCapabilityState;
    ownership: NativeWorkCapabilityState;
    assignment: NativeWorkCapabilityState;
  };
  worktrees: ManagedWorktreeProjection[];
  suggestions: SuggestedWorkProjection[];
  executions: NativeWorkExecutionProjection[];
  issues: string[];
}

export interface RuntimeOutputItem {
  id: string;
  role: "assistant" | "toolCall" | "toolResult" | "user";
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
  tokenUsage?: {
    input: number;
    output: number;
    total: number;
    cacheRead?: number;
  };
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

export interface AgentInboxItem {
  id: string;
  agentId: string;
  workspaceId?: string;
  kind: "handoff-result" | "handoff-update";
  status: RuntimeStatus;
  title: string;
  summary: string;
  sourceAgentId?: string;
  sourceAgentName?: string | null;
  taskId?: string;
  runtimeId?: string;
  sessionId?: string;
  runId?: string;
  updatedAt: number | null;
  provenance: "openclaw-task" | "openclaw-runtime";
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
  revision?: number;
  mode: "live" | "fallback";
  diagnostics: GatewayDiagnostics;
  presence: PresenceRecord[];
  channelAccounts: ChannelAccountRecord[];
  workspaces: WorkspaceProject[];
  agents: OpenClawAgent[];
  models: ModelRecord[];
  runtimes: RuntimeRecord[];
  tasks: TaskRecord[];
  agentInbox: AgentInboxItem[];
  nativeWork?: NativeWorkSnapshot;
  relationships: RelationshipRecord[];
  missionPresets: string[];
  channelRegistry: ChannelRegistry;
  surfaceRuntime: SurfaceRuntimeSnapshot;
  surfaceDrift: SurfaceDriftSnapshot;
}

export type MissionControlSurfaceKind = "chat" | "inbox" | "trigger";

export type MissionControlBuiltInSurfaceProvider =
  | PlannerChannelType
  | "gmail"
  | "email"
  | "webhook"
  | "cron";

export type MissionControlSurfaceProvider = MissionControlBuiltInSurfaceProvider | (string & {});

export interface SurfaceRouteMatch {
  peer?: {
    kind: "dm" | "group" | "channel" | "thread" | "topic" | "label" | "query";
    id: string;
  };
  guildId?: string;
  roles?: string[];
  teamId?: string;
  query?: string;
}

export interface WorkspaceSurfaceRoute {
  id: string;
  enabled: boolean;
  label?: string | null;
  match: SurfaceRouteMatch;
  agentId: string | null;
  assistantAgentIds: string[];
}

export interface WorkspaceSurfaceBinding {
  workspaceId: string;
  workspacePath: string;
  defaultAgentId: string | null;
  assistantAgentIds: string[];
  routes: WorkspaceSurfaceRoute[];
  presetId?: string | null;
}

export interface WorkspaceSurfaceOverlay {
  id: string;
  provider: MissionControlSurfaceProvider;
  kind: MissionControlSurfaceKind;
  accountId: string | null;
  name: string;
  workspaces: WorkspaceSurfaceBinding[];
  ui?: {
    pinned?: boolean;
    accent?: string | null;
  };
}

export interface DiscoveredSurfaceRoute {
  routeId: string;
  provider: MissionControlSurfaceProvider;
  kind: "group" | "channel" | "thread" | "role" | "label" | "query" | "hook" | "job";
  title: string | null;
  subtitle?: string | null;
  lastSeen: string | null;
  guildId?: string | null;
  parentId?: string | null;
}

export interface MissionSubmission {
  mission: string;
  requestId?: string;
  agentId?: string;
  workspaceId?: string;
  executionMode?: "standard" | "isolated-worktree";
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
  browserAccount?: {
    accountId: string;
    actorUserId: string;
  };
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
      phase:
        | "preflight"
        | "probe"
        | "starting"
        | "refreshing"
        | "rollback"
        | "baseline-restore"
        | "target-install"
        | "target-verify"
        | "rollback-verify"
        | "final-target-verify";
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
      capabilityDiff?: OpenClawCapabilityDiffReport;
      certificationScorecard?: OpenClawCertificationScorecardReport;
      manualCommand?: string;
      docsUrl?: string;
    };

export type TaskDetailStreamEvent =
  | {
      type: "task";
      detail: TaskDetailRecord;
    }
  | {
      type: "ready";
      ok: boolean;
      eventBridge?: OpenClawEventBridgeStreamStatus;
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
      workspaceId?: string;
      manualCommand?: string;
      docsUrl?: string;
      discoveredModels?: DiscoveredModelCandidate[];
    };

export type BuiltInAddModelsProviderId =
  | "openrouter"
  | "ollama"
  | "openai"
  | "anthropic"
  | "xai"
  | "google"
  | "deepseek"
  | "mistral";

export type AddModelsProviderId = BuiltInAddModelsProviderId | (string & {});

export type AddModelsProviderCategory = "primary" | "other";

export type AddModelsProviderConnectKind = "oauth" | "apiKey" | "local";

export type AddModelsProviderAuthMethod = "api-key" | "chatgpt-oauth";

export type AddModelsFlowState =
  | "idle"
  | "connecting"
  | "disconnecting"
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
  /** null means OpenClaw did not report availability, rather than available. */
  available: boolean | null;
  deprecated?: boolean;
  disabled?: boolean;
  missing: boolean;
  alreadyAdded: boolean;
  recommended: boolean;
  /** null means the native catalog did not report tool support. */
  supportsTools: boolean | null;
  isFree: boolean;
  tags: string[];
}

export interface AddModelsProviderConnectionStatus {
  provider: string;
  authMethod?: AddModelsProviderAuthMethod | null;
  availableAuthMethods?: AddModelsProviderAuthMethod[];
  connected: boolean;
  verification?: "not-configured" | "credential-stored" | "verified" | "degraded" | "unknown";
  canConnect: boolean;
  needsTerminal: boolean;
  detail: string | null;
  source:
    | "gateway"
    | "openclaw-config"
    | "legacy-file"
    | "local-runtime"
    | "agentos-sidecar"
    | "cache"
    | "unsupported"
    | "unknown";
  degraded: boolean;
  stale: boolean;
  recovery?: string | null;
}

export interface AddModelsProviderConfigSummary {
  provider: AddModelsProviderId;
  kind: "builtin" | "custom";
  providerId: string;
  baseUrl: string | null;
  api: string | null;
  modelCount: number;
  credentialConfigured: boolean;
  endpointOverride: boolean;
  editable: boolean;
}

export interface AddModelsEmptyState {
  kind: "no-models" | "ollama-empty" | "ollama-missing";
  title: string;
  description: string;
  commands?: string[];
}

export type AddModelsProviderAction =
  | "status"
  | "connect"
  | "update-provider"
  | "replace-credential"
  | "switch-account"
  | "discover"
  | "add-models"
  | "set-default"
  | "remove-model-impact"
  | "remove-model"
  | "disconnect-impact"
  | "disconnect"
  | "disconnect-credential-impact"
  | "disconnect-credential"
  | "delete-provider-impact"
  | "delete-provider";

export type ModelProviderAuthMethod = AddModelsProviderAuthMethod;

export interface AddModelsProviderDisconnectImpact {
  providerModelIds: string[];
  affectedAgents: Array<{
    id: string;
    name: string;
    modelId: string;
  }>;
  activeAgentIds: string[];
  defaultModelAffected: boolean;
  currentDefaultModelId: string | null;
  replacementModelId: string | null;
  blockedReason: string | null;
  credentialCleanup: "removed" | "not-required" | "retained-unsupported";
}

export interface AddModelsModelRemoveImpact {
  modelId: string;
  provider: AddModelsProviderId;
  affectedAgents: Array<{
    id: string;
    name: string;
    modelId: string;
  }>;
  activeAgentIds: string[];
  defaultModelAffected: boolean;
  currentDefaultModelId: string | null;
  replacementModelId: string | null;
  blockedReason: string | null;
}

export type AddModelsProviderActionRequest =
  | {
      action: "status";
      provider: AddModelsProviderId;
      includeSnapshot?: boolean;
      refreshAuth?: boolean;
      discover?: boolean;
    }
  | {
      action: "connect";
      provider: AddModelsProviderId;
      authMethod?: ModelProviderAuthMethod;
      providerName?: string;
      apiKey?: string;
      endpoint?: string;
      modelId?: string;
      force?: boolean;
    }
  | {
      action: "update-provider";
      provider: AddModelsProviderId;
      endpoint?: string | null;
      api?: string;
    }
  | {
      action: "replace-credential";
      provider: AddModelsProviderId;
      apiKey: string;
    }
  | {
      action: "switch-account";
      provider: AddModelsProviderId;
    }
  | {
      action: "discover";
      provider: AddModelsProviderId;
    }
  | {
      action: "add-models";
      provider: AddModelsProviderId;
      modelIds: string[];
    }
  | {
      action: "set-default";
      provider: AddModelsProviderId;
      modelId: string;
    }
  | {
      action: "remove-model-impact";
      provider: AddModelsProviderId;
      modelId: string;
    }
  | {
      action: "remove-model";
      provider: AddModelsProviderId;
      modelId: string;
    }
  | {
      action: "disconnect-impact";
      provider: AddModelsProviderId;
    }
  | {
      action: "disconnect";
      provider: AddModelsProviderId;
      confirmed: true;
    }
  | {
      action: "disconnect-credential-impact";
      provider: AddModelsProviderId;
    }
  | {
      action: "disconnect-credential";
      provider: AddModelsProviderId;
      confirmed: true;
    }
  | {
      action: "delete-provider-impact";
      provider: AddModelsProviderId;
    }
  | {
      action: "delete-provider";
      provider: AddModelsProviderId;
      confirmed: true;
    };

export interface AddModelsProviderActionResult {
  ok: boolean;
  action: AddModelsProviderAction;
  provider: AddModelsProviderId;
  message: string;
  connection: AddModelsProviderConnectionStatus;
  models: AddModelsCatalogModel[];
  discovery?: {
    status: "not-requested" | "ready" | "empty" | "failed";
    retryable: boolean;
    error?: string | null;
  };
  emptyState?: AddModelsEmptyState | null;
  manualCommand?: string | null;
  docsUrl?: string | null;
  defaultModel?: {
    id: string;
    provider: AddModelsProviderId;
    via: "gateway" | "legacy-file";
  };
  disconnectImpact?: AddModelsProviderDisconnectImpact;
  modelRemoveImpact?: AddModelsModelRemoveImpact;
  providerConfig?: AddModelsProviderConfigSummary;
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

export type OpenClawThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

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
  skillIds?: string[];
  modelId?: string;
  isPrimary?: boolean;
  policy?: AgentPolicy;
  heartbeat?: AgentHeartbeatInput;
  channelIds?: string[];
}

export interface WorkspaceCreateInput {
  name: string;
  brief?: string;
  directory?: string;
  modelId?: string;
  thinking?: OpenClawThinkingLevel;
  sourceMode?: WorkspaceSourceMode;
  repoUrl?: string;
  existingPath?: string;
  template?: WorkspaceTemplate;
  teamPreset?: WorkspaceTeamPreset;
  modelProfile?: WorkspaceModelProfile;
  rules?: Partial<WorkspaceCreateRules>;
  docOverrides?: WorkspaceDocOverride[];
  agents?: WorkspaceAgentBlueprintInput[];
  contextSources?: PlannerContextSource[];
  creation?: WorkspaceCreationContext;
}

export type WorkspaceCreationSource = "api" | "quick-create" | "launchpad" | "planner-deploy" | "planner-runtime";

export interface WorkspaceCreationContext {
  source: WorkspaceCreationSource;
  planId?: string;
  idempotencyKey?: string;
}

export interface WorkspaceEditSeed {
  workspaceId: string;
  workspacePath: string;
  name: string;
  directory: string;
  template: WorkspaceTemplate;
  sourceMode: WorkspaceSourceMode;
  teamPreset: WorkspaceTeamPreset;
  modelProfile: WorkspaceModelProfile;
  modelId?: string;
  repoUrl?: string;
  existingPath?: string;
  rules: WorkspaceCreateRules;
  docOverrides: WorkspaceDocOverride[];
  agents: WorkspaceAgentBlueprintInput[];
  brief: string;
  contextSources?: PlannerContextSource[];
}

export interface WorkspaceUpdateInput {
  workspaceId: string;
  name?: string;
  directory?: string;
  plan?: WorkspacePlan;
  baseline?: WorkspaceEditSeed;
}

export interface WorkspaceDeleteInput {
  workspaceId: string;
}

export interface WorkspaceCreateResult {
  workspaceId: string;
  workspaceName?: string;
  workspacePath: string;
  agentIds: string[];
  primaryAgentId: string;
  agentProjections?: WorkspaceCreateAgentProjection[];
  kickoffRunId?: string;
  kickoffStatus?: string;
  kickoffError?: string;
  warnings?: string[];
}

export interface WorkspaceCreateAgentProjection {
  id: string;
  name: string;
  modelId?: string;
  emoji?: string;
  theme?: string;
  policy?: AgentPolicy;
  heartbeat?: AgentHeartbeatInput;
  skills?: string[];
  tools?: string[];
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

export type PlannerChannelType = "internal" | "slack" | "telegram" | "whatsapp" | "discord" | "googlechat";

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
  skillIds?: string[];
  modelId?: string;
  policy: AgentPolicy;
  heartbeat: AgentHeartbeatInput;
  responsibilities: string[];
  outputs: string[];
  channelIds: string[];
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
  accountId?: string;
  primaryAgentId?: string | null;
  allowedChatIds?: string[];
  groupAssignments?: WorkspaceChannelGroupAssignment[];
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
  workspaceName?: string;
  workspacePath: string;
  primaryAgentId: string;
  agentIds: string[];
  agentProjections?: WorkspaceCreateAgentProjection[];
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
  workspacePath?: string;
  modelId?: string;
  name?: string;
  emoji?: string;
  theme?: string;
  avatar?: string;
  policy?: AgentPolicy;
  heartbeat?: AgentHeartbeatInput;
  channelIds?: string[];
  skills?: string[];
  tools?: string[];
  workerProfile?: AgentOSWorkerProfileInput;
  toolPolicy?: AgentToolPolicyInput | null;
  sandbox?: AgentSandboxInput | null;
  memorySearch?: AgentMemorySearchInput | null;
}

export interface AgentUpdateInput {
  id: string;
  workspaceId?: string;
  workspacePath?: string;
  modelId?: string | null;
  name?: string;
  emoji?: string;
  theme?: string;
  avatar?: string;
  policy?: AgentPolicy;
  heartbeat?: AgentHeartbeatInput;
  channelIds?: string[];
  skills?: string[];
  tools?: string[];
  workerProfile?: AgentOSWorkerProfileInput;
  toolPolicy?: AgentToolPolicyInput | null;
  sandbox?: AgentSandboxInput | null;
  memorySearch?: AgentMemorySearchInput | null;
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
