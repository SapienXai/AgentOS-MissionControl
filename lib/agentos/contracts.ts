import type {
  ChannelAccountRecord,
  ChannelRegistry,
  GatewayDiagnostics,
  AgentInboxItem,
  MissionControlSnapshot,
  ManagedWorktreeProjection,
  NativeWorkSnapshot,
  NativeWorkExecutionProjection,
  SuggestedWorkProjection,
  OpenClawAgent,
  RuntimeRecord,
  TaskRecord,
  WorkspaceChannelSummary,
  WorkspaceChannelWorkspaceBinding,
  WorkspaceProject
} from "@/lib/openclaw/types";

export type ControlPlaneSnapshot = MissionControlSnapshot;
export type ControlPlaneDiagnostics = GatewayDiagnostics;
export type AgentRecord = OpenClawAgent;
export type AgentInboxRecord = AgentInboxItem;
export type WorkspaceRecord = WorkspaceProject;
export type RuntimeActivityRecord = RuntimeRecord;
export type WorkItemRecord = TaskRecord;
export type SurfaceAccountRecord = ChannelAccountRecord;
export type SurfaceChannelRecord = WorkspaceChannelSummary;
export type SurfaceBindingRecord = WorkspaceChannelWorkspaceBinding;
export type SurfaceRegistryRecord = ChannelRegistry;
export type { ManagedWorktreeProjection, NativeWorkSnapshot, NativeWorkExecutionProjection, SuggestedWorkProjection };

export type RuntimeEventKind = "session" | "task" | "artifact" | "approval" | "tool" | "status" | "unknown";

export type RuntimeEventFrame = {
  kind: RuntimeEventKind;
  source: "gateway" | "polling" | "local";
  event: string;
  payload?: unknown;
  receivedAt?: string;
  agentId?: string;
  sessionId?: string;
  taskId?: string;
  runId?: string;
};

export type RuntimeEventSubscriptionRequest = {
  includeSessions?: boolean;
  includeTasks?: boolean;
  includeArtifacts?: boolean;
  includeApprovals?: boolean;
  sessionKeys?: string[];
  taskIds?: string[];
  artifactIds?: string[];
};

export type ChatGptBrowserAuthState =
  | "preparing"
  | "waiting-for-browser"
  | "waiting-for-redirect"
  | "completing"
  | "completed"
  | "error";

export type ChatGptBrowserAuthSnapshot = {
  sessionId: string;
  state: ChatGptBrowserAuthState;
  browserUrl: string | null;
  message: string;
  error: string | null;
};

export type RuntimeSnapshotRecord = {
  agents?: unknown[];
  sessions?: unknown[];
  tasks?: unknown[];
  artifacts?: unknown[];
  capturedAt?: string;
};

export type {
  RuntimeIssue,
  RuntimeIssueSeverity,
  RuntimeIssueSource,
  RuntimeIssueStatus,
  RuntimeIssueType
} from "@/lib/openclaw/runtime-issues";

export type {
  AddModelsCatalogModel,
  AddModelsEmptyState,
  AddModelsFlowState,
  AddModelsProviderAction,
  AddModelsProviderActionRequest,
  AddModelsProviderActionResult,
  AddModelsProviderAuthMethod,
  AddModelsProviderCategory,
  AddModelsProviderConnectKind,
  AddModelsProviderConfigSummary,
  AddModelsProviderConnectionStatus,
  AddModelsProviderDisconnectImpact,
  AddModelsModelRemoveImpact,
  AddModelsProviderId,
  AgentBootstrapFileInput,
  AgentBootstrapFilePath,
  AgentCreateInput,
  AgentDeleteInput,
  AgentFileAccess,
  AgentHeartbeatInput,
  AgentInstallScope,
  AgentMissingToolBehavior,
  AgentNetworkAccess,
  AgentPolicy,
  AgentPreset,
  AgentStatus,
  AgentUpdateInput,
  EffectiveCapability,
  EffectiveCapabilityEvidence,
  EffectiveCapabilityReason,
  EffectiveCapabilityReasonCode,
  EffectiveCapabilityStatus,
  AttentionAction,
  AttentionItem,
  AttentionItemType,
  AttentionSeverity,
  HumanControlInbox,
  HumanControlInboxSummary,
  ChannelAccountRecord,
  ChannelRegistry,
  DiagnosticHealth,
  DiscoveredModelCandidate,
  DiscoveredSurfaceRoute,
  GatewayDiagnostics,
  MissionAbortResponse,
  MissionControlBuiltInSurfaceProvider,
  MissionControlSnapshot,
  MissionControlSurfaceKind,
  MissionControlSurfaceProvider,
  MissionDispatchStatus,
  MissionResponse,
  MissionSubmission,
  ModelAuthProviderStatus,
  ModelReadiness,
  ModelRecord,
  OpenClawAgent,
  OpenClawBinarySelection,
  OpenClawBinarySelectionMode,
  OpenClawCapabilityDiffReport,
  OpenClawCapabilityMatrix,
  OpenClawCapabilityOperation,
  OpenClawCapabilityOperationMode,
  OpenClawCapabilitySupport,
  OpenClawCertificationScorecardArtifact,
  OpenClawCertificationScorecardCategory,
  OpenClawCertificationScorecardCategoryId,
  OpenClawCertificationScorecardFinding,
  OpenClawCertificationScorecardFindingSeverity,
  OpenClawCertificationScorecardReport,
  OpenClawCertificationScorecardStatus,
  OpenClawCommandDiagnostic,
  OpenClawCompatibilitySmokeReport,
  OpenClawCompatibilityStatus,
  OpenClawModelOnboardingPhase,
  OpenClawModelOnboardingStreamEvent,
  OpenClawOnboardingPhase,
  OpenClawOnboardingStreamEvent,
  OpenClawRuntimeDiagnostics,
  OpenClawRuntimeSessionStore,
  OpenClawRuntimeSmokeTest,
  OpenClawRuntimeSmokeTestStatus,
  OpenClawSmokeTestCheck,
  OpenClawSmokeTestCheckStatus,
  OpenClawUpdateStreamEvent,
  OpenClawThinkingLevel,
  OperationProgressActivity,
  OperationProgressSnapshot,
  OperationProgressStepSnapshot,
  OperationProgressStepStatus,
  PlannerAdvisorId,
  PlannerAdvisorNote,
  PlannerAutomationScheduleKind,
  PlannerAutomationSpec,
  PlannerChannelCredentialField,
  PlannerChannelSpec,
  PlannerChannelType,
  PlannerCompanyType,
  PlannerContextSource,
  PlannerContextSourceKind,
  PlannerContextSourceStatus,
  PlannerDecisionStatus,
  PlannerExperienceMode,
  PlannerHookSpec,
  PlannerInference,
  PlannerIntakeState,
  PlannerMessage,
  PlannerMessageRole,
  PlannerPersistentAgentSpec,
  PlannerRuntimeMode,
  PlannerRuntimeState,
  PlannerRuntimeStatus,
  PlannerSandboxMode,
  PlannerSandboxSpec,
  PlannerWorkspaceSize,
  PlannerWorkflowSpec,
  PlannerWorkflowTrigger,
  PresenceRecord,
  RelationshipKind,
  RelationshipRecord,
  ResetPreview,
  ResetPreviewPackageAction,
  ResetPreviewWorkspace,
  ResetStreamEvent,
  ResetStreamPhase,
  ResetTarget,
  ResetWorkspaceAction,
  RuntimeCreatedFile,
  RuntimeOutputItem,
  RuntimeOutputRecord,
  RuntimeRecord,
  RuntimeStatus,
  SurfaceAccountHealthStatus,
  SurfaceAccountRuntimeStatus,
  SurfaceBindingDriftIssue,
  SurfaceBindingRepairResult,
  SurfaceDriftSnapshot,
  SurfaceGatewayAccessState,
  SurfaceGatewayRepairAction,
  SurfaceRuntimeSnapshot,
  SurfaceRuntimeSource,
  SurfaceRouteMatch,
  TaskDetailRecord,
  TaskDetailStreamEvent,
  TaskFeedEvent,
  TaskFeedEventKind,
  TaskAuditSummary,
  TaskHealthSummary,
  TaskRunIssueGroup,
  TaskIntegrityIssue,
  TaskIntegrityRecord,
  TaskIntegritySeverity,
  TaskRecord,
  WorkspaceAgentBlueprintInput,
  WorkspaceBootstrapState,
  WorkspaceCapabilityState,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelSummary,
  WorkspaceChannelWorkspaceBinding,
  WorkspaceCreateInput,
  WorkspaceKnowledgeSource,
  WorkspaceKnowledgeSourceKind,
  WorkspaceKnowledgeSourceProvenance,
  WorkspaceKnowledgeSourceStatus,
  WorkspaceMaterialization,
  WorkspaceCreateResult,
  WorkspaceCreateRules,
  WorkspaceCreateStreamEvent,
  WorkspaceDeleteInput,
  WorkspaceDocOverride,
  WorkspaceEditSeed,
  WorkspaceModelProfile,
  WorkspacePlan,
  WorkspacePlanDeployResult,
  WorkspacePlanDeployStreamEvent,
  WorkspacePlanStage,
  WorkspacePlanStatus,
  WorkspaceProject,
  WorkspaceResourceState,
  WorkspaceSourceMode,
  WorkspaceSurfaceBinding,
  WorkspaceSurfaceOverlay,
  WorkspaceSurfaceRoute,
  WorkspaceTeamPreset,
  WorkspaceTemplate,
  WorkspaceUpdateInput
} from "@/lib/openclaw/types";
