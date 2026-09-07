import "server-only";

import type { CommandResult } from "@/lib/openclaw/cli";
import { runGatewayConfigMutationWithPacing } from "@/lib/openclaw/application/config-pacing-service";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import {
  NativeGatewayError,
  OpenClawGatewayClientError
} from "@/lib/openclaw/client/native-ws-gateway-errors";
import type {
  GatewayProbePayload,
    GatewayStatusPayload,
    MissionCommandPayload,
    ModelsPayload,
    ModelsStatusPayload,
    OpenClawAddAgentInput,
    OpenClawAgentIdentityInput,
    OpenClawAgentModelStatusInput,
    OpenClawAbortTurnInput,
    OpenClawArtifactDeleteInput,
    OpenClawArtifactDownloadInput,
    OpenClawArtifactDownloadPayload,
    OpenClawArtifactGetInput,
    OpenClawArtifactListInput,
    OpenClawArtifactListPayload,
    OpenClawArtifactPayload,
    OpenClawArtifactPutInput,
  OpenClawAutomationProvisionInput,
  OpenClawChannelAccountProvisionInput,
  OpenClawChannelAccountRemoveInput,
  OpenClawChannelStatusInput,
  OpenClawChannelStatusPayload,
  OpenClawChannelLifecycleInput,
  OpenClawChannelLifecycleResult,
  OpenClawChannelLogoutInput,
  OpenClawWebLoginResult,
  OpenClawWebLoginStartInput,
  OpenClawWebLoginWaitInput,
  OpenClawChannelLogsInput,
  OpenClawChannelLogsPayload,
  OpenClawConfigSchemaPayload,
  OpenClawConfigSchemaLookupInput,
  OpenClawConfigSchemaLookupPayload,
  OpenClawCronListInput,
  OpenClawCronListPayload,
  OpenClawCronGetInput,
  OpenClawCronRunInput,
  OpenClawCronRunPayload,
  OpenClawCronRunsInput,
  OpenClawCronRunsPayload,
  OpenClawCronStatusPayload,
  OpenClawDescribeSessionInput,
  OpenClawDeviceApproveInput,
  OpenClawDeviceApprovePayload,
  OpenClawExecApprovalListInput,
  OpenClawExecApprovalListPayload,
  OpenClawExecApprovalResolveInput,
  OpenClawExecApprovalResolvePayload,
  OpenClawNativeExecApprovalResolveInput,
  OpenClawNativePluginApprovalResolveInput,
  OpenClawAgentListPayload,
  OpenClawAgentTurnInput,
  OpenClawCommandOptions,
  OpenClawConfigSnapshotPayload,
  OpenClawEnvironmentListPayload,
  OpenClawEnvironmentMutationPayload,
  OpenClawEnvironmentSummary,
  OpenClawGatewayControlOptions,
  OpenClawGatewayRestartRequestInput,
  OpenClawGatewaySuspendPrepareInput,
  OpenClawGatewaySuspendResumeInput,
  OpenClawGatewaySuspendStatusInput,
  OpenClawChatInjectInput,
    OpenClawGatewayClient,
    OpenClawGatewayEventCallbacks,
    OpenClawGatewayEventSubscription,
    OpenClawGatewaySurfaceInput,
    OpenClawGatewaySurfacePayload,
  OpenClawGmailSetupInput,
  OpenClawHealthPayload,
  OpenClawDiagnosticsStabilityPayload,
  OpenClawListModelsInput,
  OpenClawListSessionsInput,
  OpenClawLogsTailInput,
  OpenClawLogsTailPayload,
  OpenClawMemoryAgentInput,
  OpenClawMemoryDreamActionPayload,
  OpenClawMemoryDreamDiaryPayload,
  OpenClawMemorySearchInput,
  OpenClawMemorySearchPayload,
  OpenClawMemoryStatusPayload,
  OpenClawModelAuthOrderSetInput,
  OpenClawModelAuthStatusPayload,
  OpenClawModelScanPayload,
  OpenClawPluginListPayload,
  OpenClawQuestionListPayload,
  OpenClawQuestionResolveInput,
  OpenClawQuestionResolvePayload,
  OpenClawRuntimeEventSubscriptionInput,
  OpenClawRuntimeSnapshotInput,
  OpenClawRuntimeSnapshotPayload,
  OpenClawSessionExportInput,
  OpenClawSessionExportPayload,
  OpenClawSessionHistoryInput,
  OpenClawSessionHistoryPayload,
  OpenClawSessionControlPayload,
  OpenClawSessionModelPatchInput,
  OpenClawSessionModelPatchPayload,
  OpenClawSessionAssignOwnerPayload,
  OpenClawSessionCreateInput,
  OpenClawSessionCreatePayload,
  OpenClawSessionMemberMutationInput,
  OpenClawSessionMemberMutationPayload,
  OpenClawSessionMembersEvidencePayload,
  OpenClawSessionMembersPayload,
  OpenClawSessionPayload,
  OpenClawSessionSteerInput,
  OpenClawSessionsPayload,
  OpenClawSessionVisibilitySetInput,
  OpenClawSessionVisibilitySetPayload,
  OpenClawSessionsDispatchInput,
  OpenClawSessionsDispatchPayload,
  OpenClawSessionsMoveInput,
  OpenClawSessionsMovePayload,
  OpenClawSessionsReclaimInput,
  OpenClawSessionsReclaimPayload,
  OpenClawSkillListPayload,
  OpenClawSkillLibraryActivateInput,
  OpenClawSkillLibraryActivatePayload,
  OpenClawSkillLibraryListInput,
  OpenClawSkillLibraryListPayload,
  OpenClawSkillLibraryReadInput,
  OpenClawSkillLibraryReadPayload,
  OpenClawStreamCallbacks,
  OpenClawTaskAssignInput,
  OpenClawTaskCancelInput,
  OpenClawTaskGetInput,
  OpenClawTaskListInput,
  OpenClawTaskListPayload,
  OpenClawTaskSuggestionAcceptMode,
  OpenClawTaskSuggestionsListPayload,
  OpenClawTaskPayload,
  OpenClawWorktreesBranchesPayload,
  OpenClawWorktreesListPayload,
  OpenClawToolInvokeInput,
  OpenClawToolInvokePayload,
  OpenClawToolsCatalogInput,
  OpenClawToolsCatalogPayload,
  OpenClawToolsEffectiveInput,
  OpenClawToolsEffectivePayload,
  OpenClawUpdateAgentInput,
  OpenClawUpdateRunInput,
  OpenClawUpdateStatusNativePayload,
  OpenClawUpdateStatusPayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";

export interface OpenClawAdapter {
  /** Capture a stable Gateway-backed adapter for long-lived setup sessions. */
  capture?(): OpenClawAdapter;
  /** Identity used to prevent answers crossing a Gateway reconnect. */
  getConnectionIdentity?(): { client: OpenClawGatewayClient; connectionId: string | null };
  /** Read the official transport generation without creating a new connection. */
  getNativeConnectionGeneration?(): number | null;
  invalidateReadCache?(): void;
  getHealth(options?: OpenClawCommandOptions): Promise<OpenClawHealthPayload>;
  getNativeHealth?(options?: OpenClawCommandOptions & { probe?: boolean }): Promise<OpenClawHealthPayload>;
  getNativeStatus?(options?: OpenClawCommandOptions): Promise<StatusPayload>;
  getDiagnosticsStability?(options?: OpenClawCommandOptions): Promise<OpenClawDiagnosticsStabilityPayload>;
  getConfigSnapshot?(options?: OpenClawCommandOptions): Promise<OpenClawConfigSnapshotPayload>;
  getStatus(options?: OpenClawCommandOptions): Promise<StatusPayload>;
  getUpdateStatus(options?: OpenClawCommandOptions): Promise<OpenClawUpdateStatusPayload>;
  getNativeUpdateStatus?(options?: OpenClawCommandOptions & { refreshCheckout?: boolean }): Promise<OpenClawUpdateStatusNativePayload>;
  holdNativeUpdate?(options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  runNativeUpdate?(input?: OpenClawUpdateRunInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  getNativeGatewayRestartPreflight?(options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  requestNativeGatewayRestart?(input?: OpenClawGatewayRestartRequestInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  prepareNativeGatewaySuspend?(input: OpenClawGatewaySuspendPrepareInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  getNativeGatewaySuspendStatus?(input: OpenClawGatewaySuspendStatusInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  resumeNativeGatewaySuspend?(input: OpenClawGatewaySuspendResumeInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  getGatewayStatus(options?: OpenClawCommandOptions): Promise<GatewayStatusPayload>;
  getModelStatus(options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  /** Force OpenClaw to reload provider auth after an external CLI mutation. */
  refreshModelAuthStatus?(options?: OpenClawCommandOptions): Promise<OpenClawModelAuthStatusPayload>;
  getAgentModelStatus(input: OpenClawAgentModelStatusInput, options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  setModelAuthOrder(input: OpenClawModelAuthOrderSetInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  listAgents(options?: OpenClawCommandOptions): Promise<OpenClawAgentListPayload>;
  listSessions(input?: OpenClawListSessionsInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionsPayload>;
  listWorktrees?(options?: OpenClawCommandOptions): Promise<OpenClawWorktreesListPayload>;
  inspectWorktreeBranches?(input: { repoRoot: string; includeRepositoryStatus?: boolean }, options?: OpenClawCommandOptions): Promise<OpenClawWorktreesBranchesPayload>;
  createSession?(input: OpenClawSessionCreateInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionCreatePayload>;
  listTaskSuggestions?(input?: { sessionKey?: string; agentId?: string }, options?: OpenClawCommandOptions): Promise<OpenClawTaskSuggestionsListPayload>;
  createTaskSuggestion?(input: { title: string; prompt: string; tldr: string; cwd: string; sessionKey: string; agentId?: string }, options?: OpenClawCommandOptions): Promise<{ taskId: string; suggestion: OpenClawTaskSuggestionsListPayload["suggestions"][number] }>;
  acceptTaskSuggestion?(input: { taskId: string; mode?: OpenClawTaskSuggestionAcceptMode; cloudProfileId?: string }, options?: OpenClawCommandOptions): Promise<{ taskId: string; key: string }>;
  dismissTaskSuggestion?(input: { taskId: string; reason?: string }, options?: OpenClawCommandOptions): Promise<{ taskId: string; dismissed: boolean }>;
  listSessionMembers?(input: { sessionKey: string; agentId?: string }, options?: OpenClawCommandOptions): Promise<OpenClawSessionMembersPayload>;
  listSessionMembersEvidence?(input: { sessionKey: string; agentId?: string }, options?: OpenClawCommandOptions): Promise<OpenClawSessionMembersEvidencePayload>;
  setSessionVisibility?(input: OpenClawSessionVisibilitySetInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionVisibilitySetPayload>;
  addSessionMember?(input: OpenClawSessionMemberMutationInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionMemberMutationPayload>;
  removeSessionMember?(input: OpenClawSessionMemberMutationInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionMemberMutationPayload>;
  assignSessionOwner?(input: { key: string; agentId?: string; owner: { type: "agent" | "human"; id: string } }, options?: OpenClawCommandOptions): Promise<OpenClawSessionAssignOwnerPayload>;
  patchSessionModel?(input: OpenClawSessionModelPatchInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionModelPatchPayload>;
  describeSession(input?: OpenClawDescribeSessionInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionPayload>;
  getSessionHistory(
    input?: OpenClawSessionHistoryInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawSessionHistoryPayload>;
  exportSession(input?: OpenClawSessionExportInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionExportPayload>;
  listTasks(input?: OpenClawTaskListInput, options?: OpenClawCommandOptions): Promise<OpenClawTaskListPayload>;
  getTask(input: OpenClawTaskGetInput, options?: OpenClawCommandOptions): Promise<OpenClawTaskPayload>;
  assignTask(input: OpenClawTaskAssignInput, options?: OpenClawCommandOptions): Promise<OpenClawTaskPayload>;
  cancelTask(input: OpenClawTaskCancelInput, options?: OpenClawCommandOptions): Promise<OpenClawTaskPayload>;
    listArtifacts(input?: OpenClawArtifactListInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactListPayload>;
    getArtifact(input: OpenClawArtifactGetInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactPayload>;
    downloadArtifact?(
      input: OpenClawArtifactDownloadInput,
      options?: OpenClawCommandOptions
    ): Promise<OpenClawArtifactDownloadPayload>;
    putArtifact(input: OpenClawArtifactPutInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactPayload>;
    deleteArtifact(input: OpenClawArtifactDeleteInput, options?: OpenClawCommandOptions): Promise<OpenClawArtifactPayload>;
  getRuntimeSnapshot(
    input?: OpenClawRuntimeSnapshotInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawRuntimeSnapshotPayload>;
    getToolsCatalog(input?: OpenClawToolsCatalogInput, options?: OpenClawCommandOptions): Promise<OpenClawToolsCatalogPayload>;
    getEffectiveTools(input: OpenClawToolsEffectiveInput, options?: OpenClawCommandOptions): Promise<OpenClawToolsEffectivePayload>;
    invokeTool(input: OpenClawToolInvokeInput, options?: OpenClawCommandOptions): Promise<OpenClawToolInvokePayload>;
    listCommands?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getUsageStatus?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getUsageCost?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getSessionUsage?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getSessionUsageTimeseries?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  getSessionUsageLogs?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  searchMemory?(input: OpenClawMemorySearchInput, options?: OpenClawCommandOptions): Promise<OpenClawMemorySearchPayload>;
  getNativeMemoryDoctorStatus?(input?: OpenClawMemoryAgentInput, options?: OpenClawCommandOptions): Promise<OpenClawMemoryStatusPayload>;
  getNativeMemoryDreamDiary?(input?: OpenClawMemoryAgentInput, options?: OpenClawCommandOptions): Promise<OpenClawMemoryDreamDiaryPayload>;
  backfillNativeMemoryDreamDiary?(input?: OpenClawMemoryAgentInput, options?: OpenClawCommandOptions): Promise<OpenClawMemoryDreamActionPayload>;
  resetNativeMemoryDreamDiary?(input?: OpenClawMemoryAgentInput, options?: OpenClawCommandOptions): Promise<OpenClawMemoryDreamActionPayload>;
  resetNativeGroundedShortTerm?(input?: OpenClawMemoryAgentInput, options?: OpenClawCommandOptions): Promise<OpenClawMemoryDreamActionPayload>;
  repairNativeDreamingArtifacts?(input?: OpenClawMemoryAgentInput, options?: OpenClawCommandOptions): Promise<OpenClawMemoryDreamActionPayload>;
  dedupeNativeDreamDiary?(input?: OpenClawMemoryAgentInput, options?: OpenClawCommandOptions): Promise<OpenClawMemoryDreamActionPayload>;
  getMemoryDoctorStatus?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getMemoryDreamDiary?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    listAgentFiles?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getAgentFile?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    setAgentFile?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    listEnvironments?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getEnvironmentStatus?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    /** Native-only topology and placement methods; no CLI compatibility fallback. */
    listNativeExecutionEnvironments?(options?: OpenClawCommandOptions): Promise<OpenClawEnvironmentListPayload>;
    getNativeExecutionEnvironmentStatus?(input: { environmentId: string }, options?: OpenClawCommandOptions): Promise<OpenClawEnvironmentSummary>;
    createNativeExecutionEnvironment?(input: { profileId: string; idempotencyKey: string }, options?: OpenClawCommandOptions): Promise<OpenClawEnvironmentMutationPayload>;
    destroyNativeExecutionEnvironment?(input: { environmentId: string; force?: boolean }, options?: OpenClawCommandOptions): Promise<OpenClawEnvironmentMutationPayload>;
    listNativeNodes?(options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    describeNativeNode?(input: { nodeId: string }, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getNativeSession?(input: { key: string; agentId?: string }, options?: OpenClawCommandOptions): Promise<OpenClawSessionPayload>;
    dispatchNativeSession?(input: OpenClawSessionsDispatchInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionsDispatchPayload>;
    moveNativeSession?(input: OpenClawSessionsMoveInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionsMovePayload>;
    reclaimNativeSession?(input: OpenClawSessionsReclaimInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionsReclaimPayload>;
    getTalkCatalog?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getTalkConfig?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getTtsStatus?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    getTtsProviders?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    listNodes?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    describeNode?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
    invokeNode?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  listPluginApprovals?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  resolvePluginApproval?(input: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  listNativeExecApprovals?(input?: OpenClawExecApprovalListInput, options?: OpenClawCommandOptions): Promise<OpenClawExecApprovalListPayload>;
  resolveNativeExecApproval?(input: OpenClawNativeExecApprovalResolveInput, options?: OpenClawCommandOptions): Promise<OpenClawExecApprovalResolvePayload>;
  listNativePluginApprovals?(input?: OpenClawGatewaySurfaceInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  resolveNativePluginApproval?(input: OpenClawNativePluginApprovalResolveInput, options?: OpenClawCommandOptions): Promise<OpenClawGatewaySurfacePayload>;
  listQuestions?(options?: OpenClawCommandOptions): Promise<OpenClawQuestionListPayload>;
  resolveQuestion?(input: OpenClawQuestionResolveInput, options?: OpenClawCommandOptions): Promise<OpenClawQuestionResolvePayload>;
  subscribeNativeRuntimeEvents?(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawGatewayEventSubscription>;
  subscribeRuntimeEvents(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawGatewayEventSubscription>;
  getChannelStatus(
    input?: OpenClawChannelStatusInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawChannelStatusPayload>;
  startChannel?(input: OpenClawChannelLifecycleInput, options?: OpenClawCommandOptions): Promise<OpenClawChannelLifecycleResult>;
  stopChannel?(input: OpenClawChannelLifecycleInput, options?: OpenClawCommandOptions): Promise<OpenClawChannelLifecycleResult>;
  startWebLogin?(input?: OpenClawWebLoginStartInput, options?: OpenClawCommandOptions): Promise<OpenClawWebLoginResult>;
  waitForWebLogin?(input?: OpenClawWebLoginWaitInput, options?: OpenClawCommandOptions): Promise<OpenClawWebLoginResult>;
  logoutChannel?(input: OpenClawChannelLogoutInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  getChannelLogs(input: OpenClawChannelLogsInput, options?: OpenClawCommandOptions): Promise<OpenClawChannelLogsPayload>;
  provisionChannelAccount(input: OpenClawChannelAccountProvisionInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  removeChannelAccount(input: OpenClawChannelAccountRemoveInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  setupGmailWebhook(input: OpenClawGmailSetupInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  listModels(input?: OpenClawListModelsInput, options?: OpenClawCommandOptions): Promise<ModelsPayload>;
  listSkills(options?: OpenClawCommandOptions & { eligible?: boolean }): Promise<OpenClawSkillListPayload>;
  listSkillLibrary?(input?: OpenClawSkillLibraryListInput, options?: OpenClawCommandOptions): Promise<OpenClawSkillLibraryListPayload>;
  readSkillLibrary?(input: OpenClawSkillLibraryReadInput, options?: OpenClawCommandOptions): Promise<OpenClawSkillLibraryReadPayload>;
  activateSkillLibrary?(input: OpenClawSkillLibraryActivateInput, options?: OpenClawCommandOptions): Promise<OpenClawSkillLibraryActivatePayload>;
  listPlugins(options?: OpenClawCommandOptions): Promise<OpenClawPluginListPayload>;
  scanModels(options?: OpenClawCommandOptions & {
    yes?: boolean;
    noInput?: boolean;
    noProbe?: boolean;
  }): Promise<OpenClawModelScanPayload>;
  getConfig<TPayload>(path: string, options?: OpenClawCommandOptions): Promise<TPayload | null>;
  getConfigSchema(options?: OpenClawCommandOptions): Promise<OpenClawConfigSchemaPayload | null>;
  lookupConfigSchema(
    input: OpenClawConfigSchemaLookupInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawConfigSchemaLookupPayload | null>;
  hasConfig(path: string, options?: OpenClawCommandOptions): Promise<boolean>;
  setConfig(
    path: string,
    value: unknown,
    options?: OpenClawCommandOptions & { strictJson?: boolean }
  ): Promise<CommandResult>;
  unsetConfig(path: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  addAgent(
    input: OpenClawAddAgentInput,
    options?: OpenClawCommandOptions
  ): Promise<CommandResult>;
  updateAgent(input: OpenClawUpdateAgentInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  setAgentIdentity(input: OpenClawAgentIdentityInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  deleteAgent(agentId: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  provisionAutomation(input: OpenClawAutomationProvisionInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  runAgentTurn(input: OpenClawAgentTurnInput, options?: OpenClawCommandOptions): Promise<MissionCommandPayload>;
  abortAgentTurn(input: OpenClawAbortTurnInput, options?: OpenClawCommandOptions): Promise<MissionCommandPayload>;
  steerSession(input: OpenClawSessionSteerInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionControlPayload>;
  injectChat(input: OpenClawChatInjectInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionControlPayload>;
  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks?: OpenClawStreamCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
  probeGateway(options?: OpenClawCommandOptions): Promise<GatewayProbePayload>;
  controlGateway(
    action: "start" | "stop" | "restart",
    options?: OpenClawGatewayControlOptions
  ): Promise<Record<string, unknown>>;
  listDeviceAccess?(options?: OpenClawCommandOptions): Promise<import("@/lib/openclaw/client/types").OpenClawDeviceListPayload>;
  approveDeviceAccess(input?: OpenClawDeviceApproveInput, options?: OpenClawCommandOptions): Promise<OpenClawDeviceApprovePayload>;
  call<TPayload>(
    method: string,
    params?: Record<string, unknown>,
    options?: OpenClawCommandOptions
  ): Promise<TPayload>;
  tailLogs(input?: OpenClawLogsTailInput, options?: OpenClawCommandOptions): Promise<OpenClawLogsTailPayload>;
  listExecApprovals(
    input?: OpenClawExecApprovalListInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawExecApprovalListPayload>;
  resolveExecApproval(
    input: OpenClawExecApprovalResolveInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawExecApprovalResolvePayload>;
  getCronStatus(options?: OpenClawCommandOptions): Promise<OpenClawCronStatusPayload>;
  listCronJobs(input?: OpenClawCronListInput, options?: OpenClawCommandOptions): Promise<OpenClawCronListPayload>;
  getCronJob?(input: OpenClawCronGetInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  runCronJob?(input: OpenClawCronRunInput, options?: OpenClawCommandOptions): Promise<OpenClawCronRunPayload>;
  listCronRuns?(input?: OpenClawCronRunsInput, options?: OpenClawCommandOptions): Promise<OpenClawCronRunsPayload>;
}

export class GatewayBackedOpenClawAdapter implements OpenClawAdapter {
  constructor(private readonly getClient: () => OpenClawGatewayClient = getOpenClawGatewayClient) {}

  capture() {
    const client = this.getClient();
    return new GatewayBackedOpenClawAdapter(() => client);
  }

  getConnectionIdentity() {
    const client = this.getClient();
    return {
      client,
      connectionId: client.getDiagnostics?.()?.operatorIdentity?.connectionId ?? null
    };
  }

  getNativeConnectionGeneration() {
    return this.getClient().getNativeConnectionGeneration?.() ?? null;
  }

  invalidateReadCache() {
    this.getClient().invalidateReadCache?.();
  }

  getHealth(options: OpenClawCommandOptions = {}) {
    return this.getClient().getHealth(options);
  }

  getNativeHealth(options: OpenClawCommandOptions & { probe?: boolean } = {}) {
    return this.getClient().getNativeHealth?.(options) ?? Promise.reject(nativeMethodUnavailable("health"));
  }

  getNativeStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getNativeStatus?.(options) ?? Promise.reject(nativeMethodUnavailable("status"));
  }

  getDiagnosticsStability(options: OpenClawCommandOptions = {}) {
    return this.getClient().getDiagnosticsStability?.(options) ?? Promise.reject(nativeMethodUnavailable("diagnostics.stability"));
  }

  getConfigSnapshot(options: OpenClawCommandOptions = {}) {
    return this.getClient().getConfigSnapshot?.(options) ?? Promise.reject(nativeMethodUnavailable("config.get"));
  }

  getStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getStatus(options);
  }

  getUpdateStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getUpdateStatus(options);
  }

  getNativeUpdateStatus(options: OpenClawCommandOptions & { refreshCheckout?: boolean } = {}) {
    return this.getClient().getNativeUpdateStatus?.(options) ?? Promise.reject(nativeMethodUnavailable("update.status"));
  }

  holdNativeUpdate(options: OpenClawCommandOptions = {}) {
    return this.getClient().holdNativeUpdate?.(options) ?? Promise.reject(nativeMethodUnavailable("update.hold"));
  }

  runNativeUpdate(input: OpenClawUpdateRunInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().runNativeUpdate?.(input, options) ?? Promise.reject(nativeMethodUnavailable("update.run"));
  }

  getNativeGatewayRestartPreflight(options: OpenClawCommandOptions = {}) {
    return this.getClient().getNativeGatewayRestartPreflight?.(options) ?? Promise.reject(nativeMethodUnavailable("gateway.restart.preflight"));
  }

  requestNativeGatewayRestart(input: OpenClawGatewayRestartRequestInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().requestNativeGatewayRestart?.(input, options) ?? Promise.reject(nativeMethodUnavailable("gateway.restart.request"));
  }

  prepareNativeGatewaySuspend(input: OpenClawGatewaySuspendPrepareInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().prepareNativeGatewaySuspend?.(input, options) ?? Promise.reject(nativeMethodUnavailable("gateway.suspend.prepare"));
  }

  getNativeGatewaySuspendStatus(input: OpenClawGatewaySuspendStatusInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getNativeGatewaySuspendStatus?.(input, options) ?? Promise.reject(nativeMethodUnavailable("gateway.suspend.status"));
  }

  resumeNativeGatewaySuspend(input: OpenClawGatewaySuspendResumeInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().resumeNativeGatewaySuspend?.(input, options) ?? Promise.reject(nativeMethodUnavailable("gateway.suspend.resume"));
  }

  getGatewayStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getGatewayStatus(options);
  }

  getModelStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().getModelStatus(options);
  }

  refreshModelAuthStatus(options: OpenClawCommandOptions = {}) {
    return this.getClient().call<OpenClawModelAuthStatusPayload>(
      "models.authStatus",
      { refresh: true },
      options
    );
  }

  getAgentModelStatus(input: OpenClawAgentModelStatusInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getAgentModelStatus(input, options);
  }

  setModelAuthOrder(input: OpenClawModelAuthOrderSetInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().setModelAuthOrder(input, options);
  }

  listAgents(options: OpenClawCommandOptions = {}) {
    return this.getClient().listAgents(options);
  }

  listSessions(input: OpenClawListSessionsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().listSessions(input, options);
  }

  listWorktrees(options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.listWorktrees) return Promise.reject(new Error("OpenClaw does not expose worktrees.list."));
    return client.listWorktrees(options);
  }

  inspectWorktreeBranches(input: { repoRoot: string; includeRepositoryStatus?: boolean }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.inspectWorktreeBranches) return Promise.reject(new Error("OpenClaw does not expose worktrees.branches."));
    return client.inspectWorktreeBranches(input, options);
  }

  createSession(input: OpenClawSessionCreateInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.createSession) return Promise.reject(new Error("OpenClaw does not expose sessions.create."));
    return client.createSession(input, options);
  }

  listTaskSuggestions(input: { sessionKey?: string; agentId?: string } = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.listTaskSuggestions) return Promise.reject(new Error("OpenClaw does not expose taskSuggestions.list."));
    return client.listTaskSuggestions(input, options);
  }

  createTaskSuggestion(input: { title: string; prompt: string; tldr: string; cwd: string; sessionKey: string; agentId?: string }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.createTaskSuggestion) return Promise.reject(new Error("OpenClaw does not expose taskSuggestions.create."));
    return client.createTaskSuggestion(input, options);
  }

  acceptTaskSuggestion(input: { taskId: string; mode?: OpenClawTaskSuggestionAcceptMode; cloudProfileId?: string }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.acceptTaskSuggestion) return Promise.reject(new Error("OpenClaw does not expose taskSuggestions.accept."));
    return client.acceptTaskSuggestion(input, options);
  }

  dismissTaskSuggestion(input: { taskId: string; reason?: string }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.dismissTaskSuggestion) return Promise.reject(new Error("OpenClaw does not expose taskSuggestions.dismiss."));
    return client.dismissTaskSuggestion(input, options);
  }

  listSessionMembers(input: { sessionKey: string; agentId?: string }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.listSessionMembers) return Promise.reject(new Error("OpenClaw does not expose session.members.list."));
    return client.listSessionMembers(input, options);
  }

  listSessionMembersEvidence(input: { sessionKey: string; agentId?: string }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.listSessionMembersEvidence) return Promise.reject(new Error("OpenClaw does not expose session.members.listEvidence."));
    return client.listSessionMembersEvidence(input, options);
  }

  setSessionVisibility(input: OpenClawSessionVisibilitySetInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.setSessionVisibility) {
      return Promise.reject(new NativeGatewayError("OpenClaw does not expose session.visibility.set.", { kind: "unsupported" }));
    }
    return client.setSessionVisibility(input, options);
  }

  addSessionMember(input: OpenClawSessionMemberMutationInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.addSessionMember) {
      return Promise.reject(new NativeGatewayError("OpenClaw does not expose session.members.add.", { kind: "unsupported" }));
    }
    return client.addSessionMember(input, options);
  }

  removeSessionMember(input: OpenClawSessionMemberMutationInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.removeSessionMember) {
      return Promise.reject(new NativeGatewayError("OpenClaw does not expose session.members.remove.", { kind: "unsupported" }));
    }
    return client.removeSessionMember(input, options);
  }

  assignSessionOwner(input: { key: string; agentId?: string; owner: { type: "agent" | "human"; id: string } }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.assignSessionOwner) {
      return Promise.reject(new NativeGatewayError("OpenClaw does not expose sessions.assignOwner.", { kind: "unsupported" }));
    }
    return client.assignSessionOwner(input, options);
  }

  patchSessionModel(input: OpenClawSessionModelPatchInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.patchSessionModel) {
      return Promise.reject(new Error("This OpenClaw client does not support sessions.patch."));
    }
    return client.patchSessionModel(input, options);
  }

  describeSession(input: OpenClawDescribeSessionInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().describeSession(input, options);
  }

  getSessionHistory(input: OpenClawSessionHistoryInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().getSessionHistory(input, options);
  }

  exportSession(input: OpenClawSessionExportInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().exportSession(input, options);
  }

  listTasks(input: OpenClawTaskListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().listTasks(input, options);
  }

  getTask(input: OpenClawTaskGetInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getTask(input, options);
  }

  assignTask(input: OpenClawTaskAssignInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().assignTask(input, options);
  }

  cancelTask(input: OpenClawTaskCancelInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().cancelTask(input, options);
  }

  listArtifacts(input: OpenClawArtifactListInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().listArtifacts(input, options);
  }

  getArtifact(input: OpenClawArtifactGetInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getArtifact(input, options);
  }

  downloadArtifact(input: OpenClawArtifactDownloadInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.downloadArtifact?.(input, options) ??
      client.call<OpenClawArtifactDownloadPayload>("artifacts.download", { ...input }, options);
  }

  putArtifact(input: OpenClawArtifactPutInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().putArtifact(input, options);
  }

  deleteArtifact(input: OpenClawArtifactDeleteInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().deleteArtifact(input, options);
  }

  getRuntimeSnapshot(input: OpenClawRuntimeSnapshotInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().getRuntimeSnapshot(input, options);
  }

  getToolsCatalog(input: OpenClawToolsCatalogInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().getToolsCatalog(input, options);
  }

  getEffectiveTools(input: OpenClawToolsEffectiveInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getEffectiveTools(input, options);
  }

  invokeTool(input: OpenClawToolInvokeInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().invokeTool(input, options);
  }

  listCommands(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listCommands?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("commands.list", input, options);
  }

  getUsageStatus(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getUsageStatus?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("usage.status", input, options);
  }

  getUsageCost(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getUsageCost?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("usage.cost", input, options);
  }

  getSessionUsage(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getSessionUsage?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("sessions.usage", input, options);
  }

  getSessionUsageTimeseries(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getSessionUsageTimeseries?.(input, options) ??
      client.call<OpenClawGatewaySurfacePayload>("sessions.usage.timeseries", input, options);
  }

  getSessionUsageLogs(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getSessionUsageLogs?.(input, options) ??
      client.call<OpenClawGatewaySurfacePayload>("sessions.usage.logs", input, options);
  }

  searchMemory(input: OpenClawMemorySearchInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.searchMemory) {
      return Promise.reject(new Error("OpenClaw native memory.search is unavailable."));
    }
    return client.searchMemory(input, options);
  }

  getNativeMemoryDoctorStatus(input: OpenClawMemoryAgentInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.getNativeMemoryDoctorStatus) {
      return Promise.reject(new Error("OpenClaw native doctor.memory.status is unavailable."));
    }
    return client.getNativeMemoryDoctorStatus(input, options);
  }

  getNativeMemoryDreamDiary(input: OpenClawMemoryAgentInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.getNativeMemoryDreamDiary) {
      return Promise.reject(new Error("OpenClaw native doctor.memory.dreamDiary is unavailable."));
    }
    return client.getNativeMemoryDreamDiary(input, options);
  }

  backfillNativeMemoryDreamDiary(input: OpenClawMemoryAgentInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.backfillNativeMemoryDreamDiary) {
      return Promise.reject(new Error("OpenClaw native doctor.memory.backfillDreamDiary is unavailable."));
    }
    return client.backfillNativeMemoryDreamDiary(input, options);
  }

  resetNativeMemoryDreamDiary(input: OpenClawMemoryAgentInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.resetNativeMemoryDreamDiary) {
      return Promise.reject(new Error("OpenClaw native doctor.memory.resetDreamDiary is unavailable."));
    }
    return client.resetNativeMemoryDreamDiary(input, options);
  }

  resetNativeGroundedShortTerm(input: OpenClawMemoryAgentInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.resetNativeGroundedShortTerm) {
      return Promise.reject(new Error("OpenClaw native doctor.memory.resetGroundedShortTerm is unavailable."));
    }
    return client.resetNativeGroundedShortTerm(input, options);
  }

  repairNativeDreamingArtifacts(input: OpenClawMemoryAgentInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.repairNativeDreamingArtifacts) {
      return Promise.reject(new Error("OpenClaw native doctor.memory.repairDreamingArtifacts is unavailable."));
    }
    return client.repairNativeDreamingArtifacts(input, options);
  }

  dedupeNativeDreamDiary(input: OpenClawMemoryAgentInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.dedupeNativeDreamDiary) {
      return Promise.reject(new Error("OpenClaw native doctor.memory.dedupeDreamDiary is unavailable."));
    }
    return client.dedupeNativeDreamDiary(input, options);
  }

  getMemoryDoctorStatus(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getMemoryDoctorStatus?.(input, options) ??
      client.call<OpenClawGatewaySurfacePayload>("doctor.memory.status", input, options);
  }

  getMemoryDreamDiary(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getMemoryDreamDiary?.(input, options) ??
      client.call<OpenClawGatewaySurfacePayload>("doctor.memory.dreamDiary", input, options);
  }

  listAgentFiles(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listAgentFiles?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("agents.files.list", input, options);
  }

  getAgentFile(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getAgentFile?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("agents.files.get", input, options);
  }

  setAgentFile(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.setAgentFile?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("agents.files.set", input, options);
  }

  listEnvironments(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listEnvironments?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("environments.list", input, options);
  }

  getEnvironmentStatus(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getEnvironmentStatus?.(input, options) ??
      client.call<OpenClawGatewaySurfacePayload>("environments.status", input, options);
  }

  listNativeExecutionEnvironments(options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.listNativeExecutionEnvironments) return Promise.reject(nativeMethodUnavailable("environments.list"));
    return client.listNativeExecutionEnvironments(options);
  }

  getNativeExecutionEnvironmentStatus(input: { environmentId: string }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.getNativeExecutionEnvironmentStatus) return Promise.reject(nativeMethodUnavailable("environments.status"));
    return client.getNativeExecutionEnvironmentStatus(input, options);
  }

  createNativeExecutionEnvironment(input: { profileId: string; idempotencyKey: string }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.createNativeExecutionEnvironment) return Promise.reject(nativeMethodUnavailable("environments.create"));
    return client.createNativeExecutionEnvironment(input, options);
  }

  destroyNativeExecutionEnvironment(input: { environmentId: string; force?: boolean }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.destroyNativeExecutionEnvironment) return Promise.reject(nativeMethodUnavailable("environments.destroy"));
    return client.destroyNativeExecutionEnvironment(input, options);
  }

  getTalkCatalog(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getTalkCatalog?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("talk.catalog", input, options);
  }

  getTalkConfig(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getTalkConfig?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("talk.config", input, options);
  }

  getTtsStatus(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getTtsStatus?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("tts.status", input, options);
  }

  getTtsProviders(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getTtsProviders?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("tts.providers", input, options);
  }

  listNodes(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listNodes?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("node.list", input, options);
  }

  describeNode(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.describeNode?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("node.describe", input, options);
  }

  listNativeNodes(options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.listNativeNodes) return Promise.reject(nativeMethodUnavailable("node.list"));
    return client.listNativeNodes(options);
  }

  describeNativeNode(input: { nodeId: string }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.describeNativeNode) return Promise.reject(nativeMethodUnavailable("node.describe"));
    return client.describeNativeNode(input, options);
  }

  invokeNode(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.invokeNode?.(input, options) ?? client.call<OpenClawGatewaySurfacePayload>("node.invoke", input, options);
  }

  getNativeSession(input: { key: string; agentId?: string }, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.getNativeSession) return Promise.reject(nativeMethodUnavailable("sessions.get"));
    return client.getNativeSession(input, options);
  }

  dispatchNativeSession(input: OpenClawSessionsDispatchInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.dispatchNativeSession) return Promise.reject(nativeMethodUnavailable("sessions.dispatch"));
    return client.dispatchNativeSession(input, options);
  }

  moveNativeSession(input: OpenClawSessionsMoveInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.moveNativeSession) return Promise.reject(nativeMethodUnavailable("sessions.move"));
    return client.moveNativeSession(input, options);
  }

  reclaimNativeSession(input: OpenClawSessionsReclaimInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.reclaimNativeSession) return Promise.reject(nativeMethodUnavailable("sessions.reclaim"));
    return client.reclaimNativeSession(input, options);
  }

  listPluginApprovals(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listPluginApprovals?.(input, options) ??
      client.call<OpenClawGatewaySurfacePayload>("plugin.approval.list", input, options);
  }

  resolvePluginApproval(input: OpenClawGatewaySurfaceInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.resolvePluginApproval?.(input, options) ??
      client.call<OpenClawGatewaySurfacePayload>("plugin.approval.resolve", input, options);
  }

  listNativePluginApprovals(input: OpenClawGatewaySurfaceInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.listNativePluginApprovals) {
      return Promise.reject(new Error("OpenClaw native plugin approvals are unavailable."));
    }
    return client.listNativePluginApprovals(input, options);
  }

  resolveNativePluginApproval(input: OpenClawNativePluginApprovalResolveInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.resolveNativePluginApproval) {
      return Promise.reject(new Error("OpenClaw native plugin approval resolution is unavailable."));
    }
    return client.resolveNativePluginApproval(input, options);
  }

  listQuestions(options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.listQuestions) {
      return Promise.reject(new Error("OpenClaw does not expose question.list."));
    }
    return client.listQuestions(options);
  }

  resolveQuestion(input: OpenClawQuestionResolveInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.resolveQuestion) {
      return Promise.reject(new Error("OpenClaw does not expose question.resolve."));
    }
    return client.resolveQuestion(input, options);
  }

  subscribeRuntimeEvents(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions = {}
  ) {
    return this.getClient().subscribeRuntimeEvents(input, callbacks, options);
  }

  subscribeNativeRuntimeEvents(
    input: OpenClawRuntimeEventSubscriptionInput,
    callbacks: OpenClawGatewayEventCallbacks,
    options: OpenClawCommandOptions = {}
  ) {
    const client = this.getClient();
    if (!client.subscribeNativeRuntimeEvents) {
      return Promise.reject(new Error("Native OpenClaw lifecycle observation is unavailable."));
    }
    return client.subscribeNativeRuntimeEvents(input, callbacks, options);
  }

  getChannelStatus(input: OpenClawChannelStatusInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().getChannelStatus(input, options);
  }

  startChannel(input: OpenClawChannelLifecycleInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.startChannel?.(input, options) ?? Promise.reject(
      new Error("OpenClaw native channel lifecycle is unavailable: channels.start is not supported by this adapter.")
    );
  }

  stopChannel(input: OpenClawChannelLifecycleInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.stopChannel?.(input, options) ?? Promise.reject(
      new Error("OpenClaw native channel lifecycle is unavailable: channels.stop is not supported by this adapter.")
    );
  }

  startWebLogin(input: OpenClawWebLoginStartInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.startWebLogin?.(input, options) ?? client.call<OpenClawWebLoginResult>("web.login.start", { ...input }, options);
  }

  waitForWebLogin(input: OpenClawWebLoginWaitInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.waitForWebLogin?.(input, options) ?? client.call<OpenClawWebLoginResult>("web.login.wait", { ...input }, options);
  }

  logoutChannel(input: OpenClawChannelLogoutInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.logoutChannel?.(input, options) ?? client.call<Record<string, unknown>>(
      "channels.logout",
      { channel: input.channel, accountId: input.accountId },
      options
    );
  }

  getChannelLogs(input: OpenClawChannelLogsInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().getChannelLogs(input, options);
  }

  provisionChannelAccount(input: OpenClawChannelAccountProvisionInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().provisionChannelAccount(input, options);
  }

  removeChannelAccount(input: OpenClawChannelAccountRemoveInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().removeChannelAccount(input, options);
  }

  setupGmailWebhook(input: OpenClawGmailSetupInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().setupGmailWebhook(input, options);
  }

  listModels(input: OpenClawListModelsInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().listModels(input, options);
  }

  listSkills(options: OpenClawCommandOptions & { eligible?: boolean } = {}) {
    return this.getClient().listSkills(options);
  }

  listSkillLibrary(input: OpenClawSkillLibraryListInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listSkillLibrary?.(input, options) ?? Promise.reject(
      new Error("OpenClaw does not expose skills.library.list.")
    );
  }

  readSkillLibrary(input: OpenClawSkillLibraryReadInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.readSkillLibrary?.(input, options) ?? Promise.reject(
      new Error("OpenClaw does not expose skills.library.read.")
    );
  }

  activateSkillLibrary(input: OpenClawSkillLibraryActivateInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.activateSkillLibrary?.(input, options) ?? Promise.reject(
      new Error("OpenClaw does not expose skills.library.activate.")
    );
  }

  listPlugins(options: OpenClawCommandOptions = {}) {
    return this.getClient().listPlugins(options);
  }

  scanModels(options: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean } = {}) {
    return this.getClient().scanModels(options);
  }

  getConfig<TPayload>(path: string, options: OpenClawCommandOptions = {}) {
    return this.getClient().getConfig<TPayload>(path, options);
  }

  getConfigSchema(options: OpenClawCommandOptions = {}) {
    return this.getClient().getConfigSchema?.(options) ?? Promise.resolve(null);
  }

  lookupConfigSchema(input: OpenClawConfigSchemaLookupInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().lookupConfigSchema?.(input, options) ?? Promise.resolve(null);
  }

  hasConfig(path: string, options: OpenClawCommandOptions = {}) {
    return this.getClient().hasConfig(path, options);
  }

  setConfig(path: string, value: unknown, options: OpenClawCommandOptions & { strictJson?: boolean } = {}) {
    return runGatewayConfigMutationWithPacing({
      path,
      operation: "set",
      value,
      options,
      execute: () => this.getClient().setConfig(path, value, options)
    });
  }

  unsetConfig(path: string, options: OpenClawCommandOptions = {}) {
    return runGatewayConfigMutationWithPacing({
      path,
      operation: "unset",
      value: null,
      options,
      execute: () => this.getClient().unsetConfig(path, options)
    });
  }

  addAgent(input: OpenClawAddAgentInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().addAgent(input, options);
  }

  updateAgent(input: OpenClawUpdateAgentInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();

    if (!client.updateAgent) {
      throw new Error(
        "OpenClaw agent update is unavailable: the active Gateway client does not expose agents.update or a real CLI fallback."
      );
    }

    return client.updateAgent(input, options);
  }

  setAgentIdentity(input: OpenClawAgentIdentityInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().setAgentIdentity(input, options);
  }

  deleteAgent(agentId: string, options: OpenClawCommandOptions = {}) {
    return this.getClient().deleteAgent(agentId, options);
  }

  provisionAutomation(input: OpenClawAutomationProvisionInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().provisionAutomation(input, options);
  }

  runAgentTurn(input: OpenClawAgentTurnInput, options: OpenClawCommandOptions = {}) {
    return this.getClient().runAgentTurn(input, options);
  }

  abortAgentTurn(input: OpenClawAbortTurnInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.abortAgentTurn
      ? client.abortAgentTurn(input, options)
      : client.call<MissionCommandPayload>("chat.abort", { ...input }, options);
  }

  steerSession(input: OpenClawSessionSteerInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();

    if (!client.steerSession) {
      throw new Error("Native OpenClaw Gateway is required for chat.send steering.");
    }

    return client.steerSession(input, options);
  }

  injectChat(input: OpenClawChatInjectInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();

    if (!client.injectChat) {
      throw new Error("Native OpenClaw Gateway is required for chat.inject.");
    }

    return client.injectChat(input, options);
  }

  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks: OpenClawStreamCallbacks = {},
    options: OpenClawCommandOptions = {}
  ) {
    return this.getClient().streamAgentTurn(input, callbacks, options);
  }

  probeGateway(options: OpenClawCommandOptions = {}) {
    return this.getClient().probeGateway(options);
  }

  controlGateway(action: "start" | "stop" | "restart", options: OpenClawCommandOptions & { force?: boolean } = {}) {
    return this.getClient().controlGateway(action, options);
  }

  listDeviceAccess(options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (client.listDeviceAccess) {
      return client.listDeviceAccess(options);
    }

    return client.call<import("@/lib/openclaw/client/types").OpenClawDeviceListPayload>("device.pair.list", {}, options);
  }

  approveDeviceAccess(input: OpenClawDeviceApproveInput = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().approveDeviceAccess(input, options);
  }

  call<TPayload>(method: string, params: Record<string, unknown> = {}, options: OpenClawCommandOptions = {}) {
    return this.getClient().call<TPayload>(method, params, options);
  }

  tailLogs(input: OpenClawLogsTailInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.tailLogs?.(input, options) ?? client.call<OpenClawLogsTailPayload>("logs.tail", { ...input }, options);
  }

  listExecApprovals(input: OpenClawExecApprovalListInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listExecApprovals?.(input, options) ??
      client.call<OpenClawExecApprovalListPayload>("exec.approval.list", { ...input }, options);
  }

  resolveExecApproval(input: OpenClawExecApprovalResolveInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.resolveExecApproval?.(input, options) ??
      client.call<OpenClawExecApprovalResolvePayload>(
        "exec.approval.resolve",
        {
          approvalId: input.approvalId,
          decision: input.decision,
          reason: input.reason ?? undefined
        },
        options
      );
  }

  listNativeExecApprovals(input: OpenClawExecApprovalListInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.listNativeExecApprovals) {
      return Promise.reject(new Error("OpenClaw native exec approvals are unavailable."));
    }
    return client.listNativeExecApprovals(input, options);
  }

  resolveNativeExecApproval(input: OpenClawNativeExecApprovalResolveInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    if (!client.resolveNativeExecApproval) {
      return Promise.reject(new Error("OpenClaw native exec approval resolution is unavailable."));
    }
    return client.resolveNativeExecApproval(input, options);
  }

  getCronStatus(options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getCronStatus?.(options) ?? client.call<OpenClawCronStatusPayload>("cron.status", {}, options);
  }

  listCronJobs(input: OpenClawCronListInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listCronJobs?.(input, options) ?? client.call<OpenClawCronListPayload>("cron.list", { ...input }, options);
  }

  getCronJob(input: OpenClawCronGetInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.getCronJob?.(input, options) ?? client.call<Record<string, unknown>>("cron.get", { id: input.id }, options);
  }

  runCronJob(input: OpenClawCronRunInput, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.runCronJob?.(input, options) ?? client.call<OpenClawCronRunPayload>("cron.run", {
      id: input.id,
      mode: input.mode,
      expectedProcessInstanceId: input.expectedProcessInstanceId
    }, options);
  }

  listCronRuns(input: OpenClawCronRunsInput = {}, options: OpenClawCommandOptions = {}) {
    const client = this.getClient();
    return client.listCronRuns?.(input, options) ?? client.call<OpenClawCronRunsPayload>("cron.runs", { ...input }, options);
  }
}

function nativeMethodUnavailable(method: string) {
  return new OpenClawGatewayClientError(
    `OpenClaw native ${method} is unavailable; the adapter does not provide a native implementation.`,
    "unsupported"
  );
}

let defaultAdapter: OpenClawAdapter | null = null;

export function getOpenClawAdapter() {
  if (!defaultAdapter) {
    defaultAdapter = new GatewayBackedOpenClawAdapter();
  }

  return defaultAdapter;
}

export function setOpenClawAdapterForTesting(adapter: OpenClawAdapter | null) {
  defaultAdapter = adapter;
}
