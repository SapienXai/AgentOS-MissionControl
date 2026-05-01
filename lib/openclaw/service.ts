import "server-only";

import { createHash } from "node:crypto";
import { access, readFile, readdir, rename, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { createErrorSnapshot } from "@/lib/openclaw/fallback";
import {
  DEFAULT_AGENT_PRESET,
  formatAgentPresetLabel,
  filterKnownOpenClawSkillIds,
  filterKnownOpenClawToolIds,
  getAgentPresetMeta,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import {
  resolveHeartbeatDraft,
  serializeHeartbeatConfig
} from "@/lib/openclaw/agent-heartbeat";
import { parseAgentIdentityMarkdown } from "@/lib/openclaw/agent-bootstrap-files";
import {
  detectOpenClaw,
  getRecentOpenClawCommandDiagnostics,
  runOpenClaw,
  getResolvedOpenClawBin,
  resolveOpenClawVersion
} from "@/lib/openclaw/cli";
import { getOpenClawGatewayClient } from "@/lib/openclaw/client/gateway-client-factory";
import { probeLocalGatewayStatus } from "@/lib/openclaw/client/local-gateway-probe";
import {
  settleGatewayStatusPayloadFromOpenClaw,
  settleModelStatusPayloadFromOpenClaw,
  settleStatusPayloadFromOpenClaw
} from "@/lib/openclaw/client/gateway-payloads";
import { GatewayStatusCache } from "@/lib/openclaw/client/gateway-status-cache";
import { settleAgentConfigFromStateFile } from "@/lib/openclaw/state/agent-config-payload";
import { settleChannelRegistryFromLocalFile } from "@/lib/openclaw/state/channel-registry-payload";
import {
  channelRegistryPath,
  openClawStateRootPath
} from "@/lib/openclaw/state/paths";
import { inspectOpenClawRuntimeState } from "@/lib/openclaw/state/runtime-state";
import { RuntimeDiagnosticsStateCache } from "@/lib/openclaw/state/runtime-diagnostics-cache";
import type {
  SnapshotLoadProfile,
  SnapshotPair
} from "@/lib/openclaw/state/snapshot-cache";
import { MissionControlCacheService } from "@/lib/openclaw/application/mission-control-cache-service";
import { buildRuntimeDiagnosticsFromState } from "@/lib/openclaw/adapter/runtime-diagnostics-adapter";
import {
  buildModelRecords,
  buildModelsPayloadFromFallbackSources,
  buildModelStatusFromAgentConfig
} from "@/lib/openclaw/adapter/model-adapter";
import { buildAgentPayloadsFromConfig } from "@/lib/openclaw/adapter/agent-adapter";
import { buildSnapshotAgentEntry } from "@/lib/openclaw/adapter/agent-snapshot-adapter";
import { readAgentBootstrapProfile } from "@/lib/openclaw/adapter/agent-profile-adapter";
import { buildPresenceRecords } from "@/lib/openclaw/adapter/presence-adapter";
import {
  buildDiagnosticIssues,
  buildGatewayDiagnostics,
  buildSecurityWarnings,
  buildVersionDiagnostics
} from "@/lib/openclaw/adapter/diagnostics-adapter";
import { buildVisibleSnapshotCollections } from "@/lib/openclaw/adapter/visibility-adapter";
import { buildWorkspaceProjectEntry } from "@/lib/openclaw/adapter/workspace-snapshot-adapter";
import {
  CachedPayloadController,
  createDeferredPayloadResult,
  isDeferredPayloadResult,
  resolveCachedPayload,
  SLOW_PAYLOAD_CACHE_TTL_MS,
  type CachedPayload
} from "@/lib/openclaw/client/payload-cache";
import type {
  AgentConfigPayload,
  AgentPayload,
  GatewayStatusPayload,
  ModelsPayload,
  ModelsStatusPayload,
  PresencePayload,
  StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import {
  buildOpenClawBinarySelectionSnapshot,
  readOpenClawBinarySelection
} from "@/lib/openclaw/binary-selection";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import {
  buildWorkspaceCreateProgressTemplate,
  createOperationProgressTracker
} from "@/lib/openclaw/operation-progress";
import { getSurfaceKind } from "@/lib/openclaw/surface-catalog";
import {
  DEFAULT_WORKSPACE_RULES,
  buildDefaultWorkspaceAgents,
  getWorkspaceTemplateMeta
} from "@/lib/openclaw/workspace-presets";
import { buildWorkspaceScaffoldDocuments, normalizeWorkspaceDocOverrides } from "@/lib/openclaw/workspace-docs";
import {
  buildWorkspaceKickoffPrompt,
  describeWorkspaceSourceActivity,
  describeWorkspaceSourceCompletion,
  describeWorkspaceSourceStart,
  detectWorkspaceToolExamples,
  extractKickoffProgressMessages,
  materializeWorkspaceSource,
  resolveWorkspaceBootstrapInput,
  resolveWorkspaceCreationTargetDir,
  writeTextFileEnsured,
  scaffoldWorkspaceContents
} from "@/lib/openclaw/domains/workspace-bootstrap";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import {
  buildTaskDetailFromDispatchRecord,
  buildTaskDetailFromTaskRecord
} from "@/lib/openclaw/domains/task-detail";
import { extractMissionCommandPayloads } from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  annotateMissionDispatchMetadata as annotateMissionDispatchMetadataFromRuntime,
  annotateMissionDispatchSessions,
  buildMissionDispatchRuntimes as buildMissionDispatchRuntimesFromRuntime,
  isSyntheticDispatchRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import {
  buildObservedMissionDispatchRuntime,
  persistMissionDispatchObservation,
  readMissionDispatchRecordById,
  readMissionDispatchRecords,
  reconcileMissionDispatchRuntimeState
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
  abortMissionDispatchTask as abortMissionDispatchTaskFromWorkflow,
  submitMissionDispatch as submitMissionDispatchFromWorkflow
} from "@/lib/openclaw/domains/mission-dispatch-workflow";
import {
  getRuntimeOutputForResolvedRuntime as getRuntimeOutputForResolvedRuntimeFromTranscript,
  mapSessionToRuntimes as mapSessionToRuntimesFromTranscript
} from "@/lib/openclaw/domains/runtime-transcript";
import {
  annotateAgentChatSessions,
  readAgentChatSessionIndex
} from "@/lib/openclaw/domains/agent-chat-sessions";
import {
  settleSessionsPayloadFromSessionCatalogs,
  type SessionsPayload
} from "@/lib/openclaw/domains/session-catalog";
import { mapSessionCatalogEntryToRuntime } from "@/lib/openclaw/domains/runtime-normalizer";
import {
  mergeRuntimeHistory as mergeRuntimeHistoryRecords,
  sortRuntimesByUpdatedAtDesc
} from "@/lib/openclaw/domains/runtime-history";
import {
  assertWorkspaceBootstrapAgentIdsAvailable as assertWorkspaceBootstrapAgentIdsAvailableFromProvisioning,
  createBootstrappedWorkspaceAgent as createBootstrappedWorkspaceAgentFromProvisioning,
  createWorkspaceAgentId as createWorkspaceAgentIdFromProvisioning,
  ensureAgentPolicySkill as ensureAgentPolicySkillFromProvisioning,
  ensureWorkspaceSkillMarkdown as ensureWorkspaceSkillMarkdownFromProvisioning
} from "@/lib/openclaw/domains/agent-provisioning";
import {
  applyAgentIdentity,
  buildAgentPolicySkillId,
  buildWorkspaceAgentStatePath,
  filterAgentPolicySkills,
  mapAgentHeartbeatToInput,
  normalizeDeclaredAgentTools,
  readAgentConfigList,
  readAgentIdentityOverrides,
  upsertAgentConfigEntry,
  writeAgentBootstrapFiles,
  writeAgentConfigList
} from "@/lib/openclaw/domains/agent-config";
import {
  areWorkspaceAgentsEqual,
  areWorkspaceCreateRulesEqual,
  collectWorkspaceEditableDocPaths,
  createWorkspaceProjectFromEditSeed
} from "@/lib/openclaw/domains/workspace-edit";
import {
  parseWorkspaceProjectManifestAgent,
  readWorkspaceProjectManifest,
  normalizeChannelRegistry,
  uniqueByChatId
} from "@/lib/openclaw/domains/workspace-manifest";
import type {
  WorkspaceProjectManifest,
  WorkspaceProjectManifestAgent
} from "@/lib/openclaw/domains/workspace-manifest";
import {
  applyChannelAccountDisplayNames,
  buildLegacyRegistrySurfaceAccounts,
  buildManagedDiscordBinding,
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  getChannelRegistry,
  mergeMissionControlSurfaceAccounts,
  parseDiscordRouteId,
  readChannelAccounts,
  readChannelRegistry
} from "@/lib/openclaw/domains/channels";
import type { ManagedDiscordBinding } from "@/lib/openclaw/domains/channels";
import { measureTiming, type TimingCollector } from "@/lib/openclaw/timing";
import { normalizeOptionalValue, resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  buildWorkspaceBootstrapProfileCache,
  readWorkspaceInspectorMetadata,
  type WorkspaceBootstrapProfileCache
} from "@/lib/openclaw/adapter/workspace-inspector-adapter";
import {
  getConfiguredWorkspaceRoot,
  getLatestRuntimeSmokeTest,
  getRuntimeSmokeTestCacheEntry,
  hasGatewayRemoteUrlConfig,
  isRuntimeSmokeTestFresh,
  mapRuntimeSmokeTestEntry,
  normalizeConfiguredWorkspaceRootValue,
  normalizeGatewayRemoteUrl,
  normalizeWorkspaceRoot,
  persistRuntimeSmokeTest,
  readMissionControlSettings,
  writeMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import type { MissionControlSettings } from "@/lib/openclaw/domains/control-plane-settings";
import type {
  AgentCreateInput,
  AgentDeleteInput,
  AgentPolicy,
  OperationProgressSnapshot,
  AgentUpdateInput,
  MissionControlSnapshot,
  MissionAbortResponse,
  MissionResponse,
  MissionSubmission,
  OpenClawRuntimeSmokeTest,
  OpenClawAgent,
  RelationshipRecord,
  TaskDetailRecord,
  RuntimeRecord,
  WorkspacePlan,
  RuntimeOutputRecord,
  WorkspaceAgentBlueprintInput,
  WorkspaceCreateResult,
  WorkspaceCreateRules,
  WorkspaceDocOverride,
  WorkspaceDeleteInput,
  WorkspaceCreateInput,
  WorkspaceEditSeed,
  WorkspaceModelProfile,
  WorkspaceChannelSummary,
  WorkspaceSourceMode,
  WorkspaceTeamPreset,
  WorkspaceTemplate,
  WorkspaceUpdateInput,
  WorkspaceProject,
  PlannerChannelType,
  MissionControlSurfaceProvider,
  ChannelRegistry,
  ChannelAccountRecord,
  WorkspaceChannelGroupAssignment,
  WorkspaceChannelWorkspaceBinding
} from "@/lib/openclaw/types";

export { inferSessionKindFromCatalogEntry } from "@/lib/openclaw/domains/session-catalog";

export { inferFallbackModelMetadata } from "@/lib/openclaw/adapter/model-adapter";

export { discoverDiscordRoutes, discoverSurfaceRoutes, discoverTelegramGroups, getChannelRegistry };

const GATEWAY_REMOTE_URL_CONFIG_KEY = "gateway.remote.url";
const runtimeSmokeTestMessage = "AgentOS runtime smoke test. Reply with a brief READY status.";
type WorkspaceCreateOptions = {
  onProgress?: (snapshot: OperationProgressSnapshot) => Promise<void> | void;
};

type KickoffProgressHandler = (update: {
  message: string;
  percent: number;
}) => Promise<void> | void;

const SNAPSHOT_CACHE_TTL_MS = 30_000;
const RUNTIME_DIAGNOSTICS_CACHE_TTL_MS = 5 * 60_000;
const GATEWAY_STATUS_STALE_GRACE_MS = 60_000;

let agentPayloadCache: CachedPayload<AgentPayload> | null = null;
let agentConfigPayloadCache: CachedPayload<AgentConfigPayload> | null = null;
let modelsPayloadCache: CachedPayload<ModelsPayload> | null = null;
let modelsStatusPayloadCache: CachedPayload<ModelsStatusPayload> | null = null;
let sessionsPayloadCache: CachedPayload<SessionsPayload> | null = null;
let presencePayloadCache: CachedPayload<PresencePayload> | null = null;
let runtimeHistoryCache = new Map<string, RuntimeRecord>();
const statusPayloadCache = new CachedPayloadController<StatusPayload>();
const gatewayStatusCache = new GatewayStatusCache(GATEWAY_STATUS_STALE_GRACE_MS);
const missionControlCacheService = new MissionControlCacheService<MissionControlSnapshot>({
  ttlMs: SNAPSHOT_CACHE_TTL_MS,
  load: (profile, generation) => loadMissionControlSnapshots({ profile, generation })
});
const runtimeDiagnosticsStateCache = new RuntimeDiagnosticsStateCache({
  ttlMs: RUNTIME_DIAGNOSTICS_CACHE_TTL_MS,
  getGeneration: () => missionControlCacheService.getGeneration(),
  loadState: (agentIds) => inspectOpenClawRuntimeState(openClawStateRootPath, agentIds)
});

function clearRuntimeHistoryCache() {
  runtimeHistoryCache = new Map();
}

export function clearMissionControlCaches() {
  missionControlCacheService.clear({ incrementGeneration: true });
  runtimeDiagnosticsStateCache.clear();
  gatewayStatusCache.clear();
  statusPayloadCache.clear();
  agentPayloadCache = null;
  agentConfigPayloadCache = null;
  modelsPayloadCache = null;
  modelsStatusPayloadCache = null;
  sessionsPayloadCache = null;
  presencePayloadCache = null;
  clearRuntimeHistoryCache();
}

function invalidateSnapshotCache() {
  missionControlCacheService.clear();
}

function resolveSnapshotDefaultAgentModelId(snapshot: MissionControlSnapshot) {
  if (!snapshot.diagnostics.modelReadiness.defaultModelReady) {
    return undefined;
  }

  return (
    normalizeOptionalValue(snapshot.diagnostics.modelReadiness.resolvedDefaultModel) ??
    normalizeOptionalValue(snapshot.diagnostics.modelReadiness.defaultModel) ??
    undefined
  );
}

export async function getMissionControlSnapshot(options: { force?: boolean; includeHidden?: boolean } = {}) {
  return missionControlCacheService.getSnapshot(options);
}

async function loadMissionControlSnapshots({
  profile = "interactive",
  generation = missionControlCacheService.getGeneration()
}: {
  profile?: SnapshotLoadProfile;
  generation?: number;
} = {}): Promise<SnapshotPair<MissionControlSnapshot>> {
  const localGatewayStatus = await probeLocalGatewayStatus();
  const openclawInstalled = Boolean(localGatewayStatus) || await detectOpenClaw();

  if (!openclawInstalled) {
    return createSnapshotPair(
      createErrorSnapshot("OpenClaw CLI is not installed on this machine.", {
        installed: false,
        loaded: false,
        rpcOk: false
      })
    );
  }

  try {
    const settings = await readMissionControlSettings();
    const configuredWorkspaceRoot = normalizeConfiguredWorkspaceRootValue(settings.workspaceRoot) ?? null;
    const gatewayRemoteUrlResult = createDeferredPayloadResult<string>();
    let gatewayStatusResult: PromiseSettledResult<GatewayStatusPayload>;
    let statusResult: PromiseSettledResult<StatusPayload>;
    let agentsResult: PromiseSettledResult<AgentPayload>;
    let agentConfigResult: PromiseSettledResult<AgentConfigPayload>;
    let modelsResult: PromiseSettledResult<ModelsPayload>;
    let modelStatusResult: PromiseSettledResult<ModelsStatusPayload>;
    let presenceResult: PromiseSettledResult<PresencePayload>;

    const statusCacheNeedsRefresh = statusPayloadCache.shouldRefresh();
    const gatewayStatusCacheNeedsRefresh = gatewayStatusCache.shouldRefresh();
    const modelStatusCacheNeedsRefresh =
      !modelsStatusPayloadCache || Date.now() - modelsStatusPayloadCache.capturedAt > SLOW_PAYLOAD_CACHE_TTL_MS;

    if (profile === "interactive") {
      const shouldHydrateGatewayStatus = !localGatewayStatus && gatewayStatusCacheNeedsRefresh;
      const shouldHydrateStatus = !localGatewayStatus && statusCacheNeedsRefresh;
      const shouldHydrateModelStatus = modelStatusCacheNeedsRefresh;

      gatewayStatusResult = shouldHydrateGatewayStatus
        ? await settleGatewayStatusPayloadFromOpenClaw(15_000)
        : createDeferredPayloadResult();
      statusResult = shouldHydrateStatus
        ? await settleStatusPayloadFromOpenClaw(15_000)
        : createDeferredPayloadResult();
      agentsResult = createDeferredPayloadResult();
      agentConfigResult = await settleAgentConfigFromStateFile(openClawStateRootPath);
      modelsResult = createDeferredPayloadResult();
      modelStatusResult = shouldHydrateModelStatus
        ? await settleModelStatusPayloadFromOpenClaw(15_000)
        : createDeferredPayloadResult();
      presenceResult = createDeferredPayloadResult();
      if (statusCacheNeedsRefresh && !shouldHydrateStatus) {
        statusPayloadCache.scheduleRefresh(() => settleStatusPayloadFromOpenClaw(15_000));
      }
    } else {
      statusResult = await settleStatusPayloadFromOpenClaw(45_000);
      gatewayStatusResult = await settleGatewayStatusPayloadFromOpenClaw(45_000);
      agentsResult = createDeferredPayloadResult();
      agentConfigResult = await settleAgentConfigFromStateFile(openClawStateRootPath);
      modelsResult = createDeferredPayloadResult();
      modelStatusResult = await settleModelStatusPayloadFromOpenClaw(45_000);
      presenceResult = createDeferredPayloadResult();
    }

    let resolvedGatewayStatus = localGatewayStatus
      ? {
          value: localGatewayStatus,
          reusedCachedValue: false
        }
      : gatewayStatusCache.resolve(gatewayStatusResult);

    if (!resolvedGatewayStatus.value) {
      const probedGatewayStatus = await probeLocalGatewayStatus(gatewayStatusCache.getCachedPort());

      if (probedGatewayStatus) {
        gatewayStatusCache.write(probedGatewayStatus);
        resolvedGatewayStatus = {
          value: probedGatewayStatus,
          reusedCachedValue: false
        };
      }
    }

    const gatewayStatus = resolvedGatewayStatus.value;
    const configuredGatewayUrl =
      gatewayRemoteUrlResult.status === "fulfilled"
        ? normalizeOptionalValue(gatewayRemoteUrlResult.value)
        : undefined;
    const resolvedStatus = statusPayloadCache.resolve(statusResult);
    const resolvedAgentConfig = resolveCachedPayload(agentConfigResult, agentConfigPayloadCache, (entry) => {
      agentConfigPayloadCache = entry;
    });
    const sessionsResult = await settleSessionsPayloadFromSessionCatalogs(
      resolvedAgentConfig.value ?? [],
      openClawStateRootPath
    );
    const resolvedAgents = resolveCachedPayload(agentsResult, agentPayloadCache, (entry) => {
      agentPayloadCache = entry;
    });
    const resolvedModels = resolveCachedPayload(modelsResult, modelsPayloadCache, (entry) => {
      modelsPayloadCache = entry;
    });
    const resolvedModelStatus = resolveCachedPayload(modelStatusResult, modelsStatusPayloadCache, (entry) => {
      modelsStatusPayloadCache = entry;
    });
    const resolvedSessions = resolveCachedPayload(sessionsResult, sessionsPayloadCache, (entry) => {
      sessionsPayloadCache = entry;
    });
    const resolvedPresence = resolveCachedPayload(presenceResult, presencePayloadCache, (entry) => {
      presencePayloadCache = entry;
    });
    const status = resolvedStatus.value;
    const agentConfig = resolvedAgentConfig.value ?? [];
    const agentsList = resolvedAgents.value ?? buildAgentPayloadsFromConfig(agentConfig, openClawStateRootPath);
    const modelStatus = resolvedModelStatus.value ?? buildModelStatusFromAgentConfig(agentConfig);
    const localModels = buildModelsPayloadFromFallbackSources(agentConfig, modelStatus);
    const models = resolvedModels.value?.models ?? localModels.models;
    const presence = resolvedPresence.value ?? [];
    const hasOpenClawSignal =
      statusResult.status === "fulfilled" ||
      agentsResult.status === "fulfilled" ||
      agentConfigResult.status === "fulfilled" ||
      modelsResult.status === "fulfilled" ||
      modelStatusResult.status === "fulfilled" ||
      sessionsResult.status === "fulfilled" ||
      presenceResult.status === "fulfilled";
    const agentIds = agentsList.map((agent) => agent.id);
    const runtimeDiagnosticsPromise = buildRuntimeDiagnostics(agentIds, settings);
    void runtimeDiagnosticsPromise.catch(() => {});
    const dispatchRecordsPromise = readMissionDispatchRecords();
    const dispatchRecords = await dispatchRecordsPromise;
    const agentChatSessionIndex = await readAgentChatSessionIndex();
    const sessions = annotateMissionDispatchSessions(
      annotateAgentChatSessions(resolvedSessions.value?.sessions ?? [], agentChatSessionIndex),
      dispatchRecords
    );
    const channelRegistryResult = await settleChannelRegistryFromLocalFile(channelRegistryPath);
    const channelRegistry =
      channelRegistryResult.status === "fulfilled"
        ? channelRegistryResult.value
        : normalizeChannelRegistry({
            version: 1,
            channels: []
          });
    const channelAccountsRaw =
      profile === "interactive"
        ? ([] as ChannelAccountRecord[])
        : await readChannelAccounts();
    const channelAccounts = applyChannelAccountDisplayNames(
      mergeMissionControlSurfaceAccounts([
        ...channelAccountsRaw,
        ...buildLegacyRegistrySurfaceAccounts(channelRegistry)
      ]),
      channelRegistry
    );

    const workspaceByPath = new Map<string, WorkspaceProject>();
    const manifestByWorkspace = new Map<string, WorkspaceProjectManifest>();
    const workspaceBootstrapProfileByWorkspace = new Map<string, WorkspaceBootstrapProfileCache>();
    const agents: OpenClawAgent[] = [];
    const relationships: RelationshipRecord[] = [];

    const heartbeatByAgent = new Map(
      (status?.heartbeat?.agents ?? []).map((entry) => [entry.agentId, entry])
    );
    const configByAgent = new Map(agentConfig.map((entry) => [entry.id, entry]));
    const recentSessionsByAgent = new Map<string, SessionsPayload["sessions"]>();

    for (const session of sessions) {
      if (!session.agentId) {
        continue;
      }

      const list = recentSessionsByAgent.get(session.agentId) ?? [];
      list.push(session);
      recentSessionsByAgent.set(session.agentId, list);
    }

    const liveSessionRuntimes = (
      await Promise.all(
        sessions.map((session) =>
          mapSessionToRuntimesFromTranscript(session, agentConfig, agentsList, mapSessionCatalogEntryToRuntime)
        )
      )
    ).flat();
    const annotatedLiveSessionRuntimes = annotateMissionDispatchMetadataFromRuntime(
      liveSessionRuntimes,
      dispatchRecords
    );
    const baseRuntimes = mergeRuntimeHistory(annotatedLiveSessionRuntimes);
    const dispatchRuntimes = await buildMissionDispatchRuntimesFromRuntime(
      baseRuntimes,
      dispatchRecords,
      {
        buildObservedRuntime: buildObservedMissionDispatchRuntime,
        persistObservation: persistMissionDispatchObservation,
        reconcileRuntimeState: reconcileMissionDispatchRuntimeState
      }
    );
    const runtimes = mergeRuntimeHistory([...dispatchRuntimes, ...annotatedLiveSessionRuntimes]);
    const workspaceBoundAgents = agentsList.filter(
      (agent): agent is AgentPayload[number] & { workspace: string } => Boolean(agent.workspace)
    );
    const workspacePaths = Array.from(new Set(workspaceBoundAgents.map((agent) => agent.workspace)));

    await Promise.all(
      workspacePaths.map(async (workspacePath) => {
        const manifest = await readWorkspaceProjectManifest(workspacePath);
        manifestByWorkspace.set(workspacePath, manifest);
        workspaceBootstrapProfileByWorkspace.set(
          workspacePath,
          await buildWorkspaceBootstrapProfileCache(
            workspacePath,
            manifest.template,
            manifest.rules ?? DEFAULT_WORKSPACE_RULES
          )
        );
      })
    );

    const agentEntries = await Promise.all(
      workspaceBoundAgents.map(async (rawAgent) => {
        const configured = configByAgent.get(rawAgent.id);
        const identityOverrides = await readAgentIdentityOverrides(rawAgent.agentDir);
        const workspaceId = workspaceIdFromPath(rawAgent.workspace);
        const sessionList = recentSessionsByAgent.get(rawAgent.id) ?? [];
        const manifest =
          manifestByWorkspace.get(rawAgent.workspace) ??
          (await readWorkspaceProjectManifest(rawAgent.workspace));
        manifestByWorkspace.set(rawAgent.workspace, manifest);
        const manifestAgent = manifest.agents.find((entry) => entry.id === rawAgent.id) ?? null;
        const profile = await readAgentBootstrapProfile(rawAgent.workspace, {
          agentId: rawAgent.id,
          agentName:
            normalizeOptionalValue(identityOverrides.name) ||
            configured?.name ||
            rawAgent.name ||
            configured?.identity?.name ||
            rawAgent.identityName ||
            rawAgent.id,
          agentDir: rawAgent.agentDir,
          configuredSkills: filterAgentPolicySkills(configured?.skills ?? []),
          configuredTools: uniqueStrings([
            ...(manifestAgent?.toolIds ?? []),
            ...((configured?.tools?.fs?.workspaceOnly || manifestAgent?.policy?.fileAccess === "workspace-only")
              ? ["fs.workspaceOnly"]
              : [])
          ]),
          template: manifest.template,
          rules: manifest.rules ?? DEFAULT_WORKSPACE_RULES,
          workspaceBootstrapProfile:
            workspaceBootstrapProfileByWorkspace.get(rawAgent.workspace) ??
            (await buildWorkspaceBootstrapProfileCache(
              rawAgent.workspace,
              manifest.template,
              manifest.rules ?? DEFAULT_WORKSPACE_RULES
            ))
        });
        const agentRuntimes = runtimes
          .filter((runtime) => runtime.agentId === rawAgent.id)
          .sort(sortRuntimesByUpdatedAtDesc);
        const heartbeat = heartbeatByAgent.get(rawAgent.id);
        return buildSnapshotAgentEntry({
          rawAgent,
          configured,
          identityOverrides,
          workspaceId,
          sessionList,
          manifestAgent,
          agentRuntimes,
          gatewayRpcOk: Boolean(gatewayStatus?.rpc?.ok),
          heartbeat,
          profile
        });
      })
    );

    for (const entry of agentEntries) {
      const workspace = ensureWorkspace(workspaceByPath, entry.workspacePath);
      workspace.agentIds.push(entry.agent.id);
      workspace.modelIds.push(entry.primaryModel);
      workspace.activeRuntimeIds.push(...entry.activeRuntimeIds);
      workspace.totalSessions += entry.sessionCount;
      agents.push(entry.agent);
      relationships.push(...entry.relationships);
    }

    const agentsByWorkspace = new Map<string, OpenClawAgent[]>();
    for (const agent of agents) {
      const list = agentsByWorkspace.get(agent.workspaceId) ?? [];
      list.push(agent);
      agentsByWorkspace.set(agent.workspaceId, list);
    }

    const workspaces = await Promise.all(
      Array.from(workspaceByPath.values()).map(async (workspace) => {
        const workspaceAgents = agentsByWorkspace.get(workspace.id) ?? [];
        const manifest = manifestByWorkspace.get(workspace.path) ?? null;
        const metadata = await readWorkspaceInspectorMetadata(
          workspace.path,
          workspaceAgents,
          manifest ?? undefined
        );

        return buildWorkspaceProjectEntry({
          workspace,
          manifest,
          metadata,
          allAgents: agents
        });
      })
    );

    const {
      visibleWorkspaces,
      visibleAgents,
      visibleRuntimes,
      visibleRelationships
    } = buildVisibleSnapshotCollections({
      workspaces,
      agents,
      runtimes,
      relationships,
      isWorkspaceHidden: (workspace) => Boolean(manifestByWorkspace.get(workspace.path)?.hidden)
    });

    const modelReadiness = resolveModelReadiness(models, modelStatus);

    const securityWarnings = buildSecurityWarnings(status);
    const versionDiagnostics = buildVersionDiagnostics({
      status,
      fallbackVersion: (await resolveOpenClawVersion()) ?? undefined
    });
    const openClawBinarySelection = buildOpenClawBinarySelectionSnapshot(
      await readOpenClawBinarySelection(),
      getResolvedOpenClawBin()
    );
    const runtimeDiagnostics = await runtimeDiagnosticsPromise;

    const snapshotIssueResults = {
      gatewayStatus: gatewayStatusResult,
      status: statusResult,
      agents: agentsResult,
      agentConfig: agentConfigResult,
      models: modelsResult,
      modelStatus: modelStatusResult,
      sessions: sessionsResult,
      presence: presenceResult
    };
    const diagnostics = buildGatewayDiagnostics({
      gatewayStatus,
      status,
      configuredWorkspaceRoot: configuredWorkspaceRoot ?? null,
      workspaceRoot: resolveWorkspaceRoot(configuredWorkspaceRoot),
      configuredGatewayUrl,
      hasOpenClawSignal,
      securityWarnings,
      runtimeDiagnostics,
      openClawBinarySelection,
      modelReadiness,
      commandHistory: getRecentOpenClawCommandDiagnostics(),
      versionDiagnostics,
      issues: buildDiagnosticIssues({
        payloadResults: snapshotIssueResults,
        gatewayStatusRejectedWithCachedValue:
          gatewayStatusResult.status === "rejected" && resolvedGatewayStatus.reusedCachedValue,
        payloadReuse: {
          status: resolvedStatus,
          agents: resolvedAgents,
          agentConfig: resolvedAgentConfig,
          models: resolvedModels,
          modelStatus: resolvedModelStatus,
          sessions: resolvedSessions,
          presence: resolvedPresence
        },
        runtimeIssues: runtimeDiagnostics.issues
      })
    });

    const tasks = buildTaskRecords(runtimes, agents);
    const visibleTasks = buildTaskRecords(visibleRuntimes, visibleAgents);
    const generatedAt = new Date().toISOString();
    const sharedSnapshotFields = {
      generatedAt,
      revision: generation,
      mode: "live" as const,
      diagnostics,
      channelAccounts,
      channelRegistry,
      ...(isDeferredPayloadResult(channelRegistryResult)
        ? {}
        : {}),
      presence: buildPresenceRecords(presence),
      missionPresets: [
        "Audit the selected workspace and generate a concrete first task batch.",
        "Plan a multi-agent delivery mission for the current product goal.",
        "Review active runtimes, identify blockers, and propose the next handoff."
      ]
    };

    return {
      full: {
        ...sharedSnapshotFields,
        workspaces,
        agents,
        models: buildModelRecords(models, agents),
        runtimes,
        tasks,
        relationships
      },
      visible: {
        ...sharedSnapshotFields,
        workspaces: visibleWorkspaces,
        agents: visibleAgents,
        models: buildModelRecords(models, visibleAgents),
        runtimes: visibleRuntimes,
        tasks: visibleTasks,
        relationships: visibleRelationships
      }
    };
  } catch (error) {
    return createSnapshotPair(
      createErrorSnapshot(
        error instanceof Error ? error.message : "Unknown OpenClaw error.",
        {
          installed: openclawInstalled,
          loaded: Boolean(localGatewayStatus?.service?.loaded),
          rpcOk: Boolean(localGatewayStatus?.rpc?.ok)
        }
      )
    );
  }
}

function createSnapshotPair(snapshot: MissionControlSnapshot): SnapshotPair<MissionControlSnapshot> {
  return {
    visible: snapshot,
    full: snapshot
  };
}

function resolveRuntimeSmokeTestAgentId(
  snapshot: MissionControlSnapshot,
  preferredAgentId?: string | null
) {
  if (preferredAgentId && snapshot.agents.some((agent) => agent.id === preferredAgentId)) {
    return preferredAgentId;
  }

  return snapshot.agents.find((agent) => agent.isDefault)?.id || snapshot.agents[0]?.id || null;
}

async function assertOpenClawRuntimeStateAccess(agentId: string | null) {
  const runtimeState = await inspectOpenClawRuntimeState(openClawStateRootPath, agentId ? [agentId] : [], {
    touch: true
  });

  if (runtimeState.issues.length > 0) {
    invalidateSnapshotCache();
    throw new Error(
      `OpenClaw runtime state is not writable. AgentOS needs write access to ${runtimeState.stateRoot} and the agent session store before missions can run.`
    );
  }
}

export async function ensureOpenClawRuntimeStateAccess(options: {
  agentId?: string | null;
} = {}) {
  await assertOpenClawRuntimeStateAccess(options.agentId ?? null);
  invalidateSnapshotCache();
  return getMissionControlSnapshot({ force: true, includeHidden: true });
}

export async function touchOpenClawRuntimeStateAccess(options: {
  agentId?: string | null;
} = {}) {
  await assertOpenClawRuntimeStateAccess(options.agentId ?? null);
  invalidateSnapshotCache();
}

export async function ensureOpenClawRuntimeSmokeTest(options: {
  agentId?: string | null;
  force?: boolean;
} = {}): Promise<OpenClawRuntimeSmokeTest> {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const agentId = resolveRuntimeSmokeTestAgentId(snapshot, options.agentId);

  if (!agentId) {
    return {
      status: "not-run",
      checkedAt: null,
      agentId: null,
      runId: null,
      summary: null,
      error: "AgentOS could not find an OpenClaw agent for the runtime smoke test."
    };
  }

  const settings = await readMissionControlSettings();
  const cached = getRuntimeSmokeTestCacheEntry(settings, agentId);

  if (!options.force && isRuntimeSmokeTestFresh(cached)) {
    return mapRuntimeSmokeTestEntry(agentId, cached);
  }

  await assertOpenClawRuntimeStateAccess(agentId);

  try {
    const payload = await getOpenClawGatewayClient().runAgentTurn(
      {
        agentId,
        message: runtimeSmokeTestMessage,
        thinking: "off",
        timeoutSeconds: 45
      },
      { timeoutMs: 50000 }
    );
    const result: OpenClawRuntimeSmokeTest = {
      status: "passed",
      checkedAt: new Date().toISOString(),
      agentId,
      runId: payload.runId ?? null,
      summary:
        payload.summary ||
        extractMissionCommandPayloads(payload)[0]?.text ||
        "AgentOS verified a real OpenClaw turn.",
      error: null
    };

    await persistRuntimeSmokeTest(result);
    invalidateSnapshotCache();
    return result;
  } catch (error) {
    const result: OpenClawRuntimeSmokeTest = {
      status: "failed",
      checkedAt: new Date().toISOString(),
      agentId,
      runId: null,
      summary: null,
      error: stringifyCommandFailure(error) || "OpenClaw runtime smoke test failed."
    };

    await persistRuntimeSmokeTest(result);
    invalidateSnapshotCache();
    return result;
  }
}

export async function submitMission(input: MissionSubmission): Promise<MissionResponse> {
  return submitMissionDispatchFromWorkflow(input, {
    getMissionControlSnapshot,
    resolveAgentForMission,
    invalidateMissionControlCaches: clearMissionControlCaches
  });
}

export async function abortMissionTask(
  taskId: string,
  reason?: string | null,
  dispatchId?: string | null
): Promise<MissionAbortResponse> {
  return abortMissionDispatchTaskFromWorkflow(taskId, reason, dispatchId, {
    getMissionControlSnapshot,
    resolveAgentForMission,
    invalidateMissionControlCaches: clearMissionControlCaches
  });
}

export async function getRuntimeOutput(runtimeId: string): Promise<RuntimeOutputRecord> {
  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);

  if (!runtime) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    runtime = snapshot.runtimes.find((entry) => entry.id === runtimeId);
  }

  if (!runtime) {
    return {
      runtimeId,
      status: "missing",
      finalText: null,
      finalTimestamp: null,
      stopReason: null,
      errorMessage: "Runtime was not found in the current OpenClaw snapshot.",
      items: [],
      createdFiles: [],
      warnings: [],
      warningSummary: null
    };
  }

  return getRuntimeOutputForResolvedRuntimeFromTranscript(runtime, snapshot);
}

export async function getTaskDetail(
  taskId: string,
  options: {
    dispatchId?: string | null;
  } = {}
): Promise<TaskDetailRecord> {
  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let task = snapshot.tasks.find((entry) => entry.id === taskId);

  if (!task && options.dispatchId) {
    task = snapshot.tasks.find((entry) => entry.dispatchId === options.dispatchId);
  }

  if (!task) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    task = snapshot.tasks.find((entry) => entry.id === taskId);

    if (!task && options.dispatchId) {
      task = snapshot.tasks.find((entry) => entry.dispatchId === options.dispatchId);
    }
  }

  if (!task) {
    const dispatchId = typeof options.dispatchId === "string" ? options.dispatchId.trim() : "";

    if (dispatchId) {
      const dispatchRecord = await readMissionDispatchRecordById(dispatchId);

      if (dispatchRecord) {
        return buildTaskDetailFromDispatchRecord(dispatchRecord, snapshot);
      }
    }

    throw new Error("Task was not found in the current OpenClaw snapshot.");
  }
  const dispatchRecord = task.dispatchId ? await readMissionDispatchRecordById(task.dispatchId) : null;
  return buildTaskDetailFromTaskRecord(task, snapshot, dispatchRecord);
}

export async function createAgent(input: AgentCreateInput) {
  const agentId = slugify(input.id.trim());

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let resolvedWorkspacePath =
    normalizeOptionalValue(input.workspacePath) ??
    snapshot.workspaces.find((entry) => entry.id === input.workspaceId)?.path;

  if (!resolvedWorkspacePath) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    resolvedWorkspacePath =
      normalizeOptionalValue(input.workspacePath) ??
      snapshot.workspaces.find((entry) => entry.id === input.workspaceId)?.path;
  }

  const resolvedWorkspaceId =
    input.workspaceId || (resolvedWorkspacePath ? workspaceIdFromPath(resolvedWorkspacePath) : null);
  assertAgentIdAvailable(snapshot, agentId, resolvedWorkspaceId);

  if (!resolvedWorkspacePath || !resolvedWorkspaceId) {
    throw new Error("Workspace was not found for this agent.");
  }

  const policy = resolveAgentPolicy(input.policy?.preset ?? DEFAULT_AGENT_PRESET, input.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const presetSkillIds = filterKnownOpenClawSkillIds(presetMeta.skillIds);
  const presetToolIds = filterKnownOpenClawToolIds(presetMeta.tools);
  const bootstrapFiles = input.bootstrapFiles ?? [];
  const bootstrapFileMap = new Map(bootstrapFiles.map((entry) => [entry.path, entry.content] as const));
  const identityMarkdown = bootstrapFileMap.get("IDENTITY.md") ?? null;
  const parsedIdentity = identityMarkdown ? parseAgentIdentityMarkdown(identityMarkdown) : null;
  const displayName =
    normalizeOptionalValue(parsedIdentity?.name) ??
    normalizeOptionalValue(input.name) ??
    presetMeta.defaultName;
  const emoji =
    normalizeOptionalValue(parsedIdentity?.emoji) ??
    normalizeOptionalValue(input.emoji) ??
    presetMeta.defaultEmoji;
  const theme =
    normalizeOptionalValue(parsedIdentity?.theme) ??
    normalizeOptionalValue(input.theme) ??
    presetMeta.defaultTheme;
  const avatar = normalizeOptionalValue(parsedIdentity?.avatar) ?? normalizeOptionalValue(input.avatar);
  const heartbeat = serializeHeartbeatConfig(resolveHeartbeatDraft(policy.preset, input.heartbeat));
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === resolvedWorkspaceId && entry.policy.preset === "setup")?.id ?? null;
  const agentDir = buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId);
  const requestedModelId = normalizeOptionalValue(input.modelId);
  const agentModelId = requestedModelId ?? resolveSnapshotDefaultAgentModelId(snapshot);

  await getOpenClawGatewayClient().addAgent({
    id: agentId,
    workspace: resolvedWorkspacePath,
    agentDir,
    model: agentModelId
  });

  const policySkillId = await ensureAgentPolicySkillFromProvisioning({
    workspacePath: resolvedWorkspacePath,
    agentId,
    agentName: displayName,
    policy,
    setupAgentId,
    snapshot
  });
  for (const skillId of presetSkillIds) {
    await ensureWorkspaceSkillMarkdownFromProvisioning(resolvedWorkspacePath, skillId);
  }

  const configEntry = await upsertAgentConfigEntry(
    agentId,
    resolvedWorkspacePath,
    {
      name: displayName,
      model: agentModelId,
      heartbeat,
      skills: uniqueStrings([...presetSkillIds, policySkillId]),
      tools:
        policy.fileAccess === "workspace-only"
          ? {
              fs: {
                workspaceOnly: true
              }
            }
          : null
    },
    snapshot
  );

  await applyAgentIdentity(agentId, resolvedWorkspacePath, {
    name: displayName || configEntry.name,
    emoji,
    theme,
    avatar,
    content: identityMarkdown ?? undefined
  }, agentDir);

  const bootstrapFilesToWrite = bootstrapFiles.filter((entry) => entry.path !== "IDENTITY.md");

  if (bootstrapFilesToWrite.length > 0) {
    await writeAgentBootstrapFiles(agentId, resolvedWorkspacePath, bootstrapFilesToWrite, agentDir);
  }

  await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
    id: agentId,
    name: displayName,
    role: formatAgentPresetLabel(policy.preset),
    emoji,
    theme,
    enabled: true,
    skillId: presetSkillIds[0] ?? policySkillId,
    toolIds: presetToolIds,
    modelId: agentModelId,
    isPrimary: false,
    policy,
    channelIds: input.channelIds ?? []
  });

  invalidateSnapshotCache();
  await syncWorkspaceAgentPolicySkills(resolvedWorkspacePath);

  return {
    agentId,
    workspaceId: resolvedWorkspaceId
  };
}

export async function updateAgent(input: AgentUpdateInput) {
  const agentId = input.id.trim();

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let agent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    agent = snapshot.agents.find((entry) => entry.id === agentId);
  }

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const resolvedWorkspacePath =
    normalizeOptionalValue(input.workspacePath) ??
    snapshot.workspaces.find((entry) => entry.id === (input.workspaceId || agent.workspaceId))?.path ??
    agent.workspacePath;
  const resolvedWorkspaceId =
    input.workspaceId || (resolvedWorkspacePath ? workspaceIdFromPath(resolvedWorkspacePath) : agent.workspaceId);

  if (!resolvedWorkspacePath || !resolvedWorkspaceId) {
    throw new Error("Workspace was not found for this agent.");
  }

  const policy = resolveAgentPolicy(input.policy?.preset ?? agent.policy.preset, input.policy ?? agent.policy);
  const presetMeta = getAgentPresetMeta(policy.preset);
  const presetSkillIds = filterKnownOpenClawSkillIds(presetMeta.skillIds);
  const presetToolIds = filterKnownOpenClawToolIds(presetMeta.tools);
  const currentName = normalizeOptionalValue(agent.name);
  const currentEmoji = normalizeOptionalValue(agent.identity.emoji);
  const currentTheme = normalizeOptionalValue(agent.identity.theme);
  const heartbeat = serializeHeartbeatConfig(
    resolveHeartbeatDraft(
      policy.preset,
      input.heartbeat ?? mapAgentHeartbeatToInput(agent.heartbeat)
    )
  );
  const setupAgentId =
    snapshot.agents.find((entry) => entry.workspaceId === resolvedWorkspaceId && entry.policy.preset === "setup" && entry.id !== agentId)?.id ??
    null;
  const nextModelId =
    input.modelId !== undefined
      ? normalizeOptionalValue(input.modelId)
      : agent.modelId === "unassigned"
        ? resolveSnapshotDefaultAgentModelId(snapshot)
        : agent.modelId;
  const onlyModelChanged =
    input.modelId !== undefined &&
    input.name === undefined &&
    input.emoji === undefined &&
    input.theme === undefined &&
    input.avatar === undefined &&
    input.policy === undefined &&
    input.heartbeat === undefined &&
    input.channelIds === undefined &&
    input.skills === undefined &&
    input.tools === undefined;

  if (onlyModelChanged) {
    // Pure model swaps do not need policy/identity/skill regeneration.
    await upsertAgentConfigEntry(
      agentId,
      resolvedWorkspacePath,
      {
        model: nextModelId
      },
      snapshot
    );

    await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
      id: agentId,
      name: currentName ?? agent.name ?? agentId,
      emoji: currentEmoji,
      theme: currentTheme,
      enabled: true,
      modelId: nextModelId,
      isPrimary: agent.isDefault,
      policy
    });

    invalidateSnapshotCache();

    return {
      agentId,
      workspaceId: resolvedWorkspaceId
    };
  }

  const policySkillId = await ensureAgentPolicySkillFromProvisioning({
    workspacePath: resolvedWorkspacePath,
    agentId,
    agentName: normalizeOptionalValue(input.name) ?? currentName ?? agentId,
    policy,
    setupAgentId,
    snapshot
  });
  const currentDeclaredSkills = filterAgentPolicySkills(agent.skills);
  const currentDeclaredTools = normalizeDeclaredAgentTools(agent.tools);
  const shouldResetSkills = policy.preset !== agent.policy.preset || currentDeclaredSkills.length === 0;
  const shouldResetTools = policy.preset !== agent.policy.preset || currentDeclaredTools.length === 0;
  const nextDeclaredSkills =
    input.skills === undefined
      ? shouldResetSkills
        ? presetSkillIds
        : currentDeclaredSkills
      : filterKnownOpenClawSkillIds(filterAgentPolicySkills(input.skills));
  for (const skillId of nextDeclaredSkills) {
    await ensureWorkspaceSkillMarkdownFromProvisioning(resolvedWorkspacePath, skillId);
  }

  const configEntry = await upsertAgentConfigEntry(
    agentId,
    resolvedWorkspacePath,
    {
      name: normalizeOptionalValue(input.name),
      model: nextModelId,
      heartbeat,
      skills: uniqueStrings([...nextDeclaredSkills, policySkillId]),
      tools:
        policy.fileAccess === "workspace-only"
          ? {
              fs: {
                workspaceOnly: true
              }
            }
          : null
    },
    snapshot
  );
  const nextDeclaredTools =
    input.tools === undefined
      ? shouldResetTools
        ? presetToolIds
        : undefined
      : normalizeDeclaredAgentTools(input.tools);

  await applyAgentIdentity(agentId, resolvedWorkspacePath, {
    name: normalizeOptionalValue(input.name) ?? configEntry.name,
    emoji: normalizeOptionalValue(input.emoji) ?? currentEmoji,
    theme: normalizeOptionalValue(input.theme) ?? currentTheme,
    avatar: normalizeOptionalValue(input.avatar)
  }, agent.agentDir ?? buildWorkspaceAgentStatePath(resolvedWorkspacePath, agentId));

  await upsertWorkspaceProjectAgentMetadata(resolvedWorkspacePath, {
    id: agentId,
    name: normalizeOptionalValue(input.name) ?? currentName ?? configEntry.name ?? agentId,
    emoji: normalizeOptionalValue(input.emoji) ?? currentEmoji,
    theme: normalizeOptionalValue(input.theme) ?? currentTheme,
    enabled: true,
    modelId: nextModelId,
    isPrimary: agent.isDefault,
    policy,
    channelIds: input.channelIds,
    skillId: nextDeclaredSkills[0] ?? policySkillId,
    toolIds: nextDeclaredTools
  });

  invalidateSnapshotCache();
  await syncWorkspaceAgentPolicySkills(resolvedWorkspacePath);

  return {
    agentId,
    workspaceId: resolvedWorkspaceId
  };
}

export async function deleteAgent(input: AgentDeleteInput) {
  const agentId = input.agentId.trim();

  if (!agentId) {
    throw new Error("Agent id is required.");
  }

  let snapshot = await getMissionControlSnapshot({ includeHidden: true });
  let agent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!agent) {
    snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
    agent = snapshot.agents.find((entry) => entry.id === agentId);
  }

  if (!agent) {
    throw new Error("Agent was not found.");
  }

  const workspace = snapshot.workspaces.find((entry) => entry.id === agent.workspaceId) ?? null;
  const runtimeCount = snapshot.runtimes.filter((runtime) => runtime.agentId === agent.id).length;

  await getOpenClawGatewayClient().deleteAgent(agent.id);

  try {
    const configList = await readAgentConfigList(snapshot);
    const nextConfigList = configList.filter((entry) => entry.id !== agent.id);

    if (nextConfigList.length !== configList.length) {
      await writeAgentConfigList(nextConfigList);
    }
  } catch {
    // Ignore config cleanup failures if the CLI delete already removed the entry.
  }

  if (workspace) {
    await removeWorkspaceProjectAgentMetadata(workspace.path, agent.id);

    try {
      await rm(path.join(workspace.path, "skills", buildAgentPolicySkillId(agent.id)), {
        recursive: true,
        force: true
      });
    } catch {
      // Ignore skill cleanup failures for already-pruned workspaces.
    }

    invalidateSnapshotCache();
    await syncWorkspaceAgentPolicySkills(workspace.path);
  }

  clearRuntimeHistoryCache();

  return {
    agentId: agent.id,
    workspaceId: agent.workspaceId,
    workspacePath: agent.workspacePath,
    deletedRuntimeCount: runtimeCount
  };
}

export async function upsertWorkspaceChannel(input: {
  workspaceId: string;
  workspacePath: string;
  channelId: string;
  type: MissionControlSurfaceProvider;
  name: string;
  primaryAgentId?: string | null;
  agentIds?: string[];
  groupAssignments?: WorkspaceChannelGroupAssignment[];
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);

  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await measureTiming(timings, "workspace-channel.registry-upsert", () =>
    mutateChannelRegistry((registry) => {
      const existingChannel = registry.channels.find((entry) => entry.id === channelId);
      const nextChannel: WorkspaceChannelSummary =
        existingChannel ??
        ({
          id: channelId,
          type: input.type,
          name: input.name.trim() || channelId,
          primaryAgentId: normalizeOptionalValue(input.primaryAgentId) ?? null,
          workspaces: []
        } satisfies WorkspaceChannelSummary);
      const workspaceId = input.workspaceId.trim();
      const workspacePath = input.workspacePath.trim();
      const workspaceBinding =
        nextChannel.workspaces.find((entry) => entry.workspaceId === workspaceId) ??
        ({
          workspaceId,
          workspacePath,
          agentIds: [],
          groupAssignments: []
        } satisfies WorkspaceChannelWorkspaceBinding);
      const nextAgentIds = uniqueStrings([
        ...workspaceBinding.agentIds,
        ...(input.agentIds ?? []).map((entry) => entry.trim()).filter(Boolean)
      ]);
      const nextGroupAssignments = uniqueByChatId([
        ...workspaceBinding.groupAssignments,
        ...(input.groupAssignments ?? []).filter((assignment) => Boolean(assignment.chatId))
      ]);

      const mergedWorkspaceBinding: WorkspaceChannelWorkspaceBinding = {
        ...workspaceBinding,
        workspacePath,
        agentIds: nextAgentIds,
        groupAssignments: nextGroupAssignments
      };

      const workspaceBindings = nextChannel.workspaces.filter((entry) => entry.workspaceId !== workspaceId);
      workspaceBindings.push(mergedWorkspaceBinding);

      const nextPrimaryAgentId = normalizeOptionalValue(input.primaryAgentId) ?? nextChannel.primaryAgentId;

      registry.channels = [
        ...registry.channels.filter((entry) => entry.id !== channelId),
        {
          ...nextChannel,
          id: channelId,
          type: input.type,
          name: input.name.trim() || nextChannel.name || channelId,
          primaryAgentId:
            nextPrimaryAgentId ||
            mergedWorkspaceBinding.agentIds[0] ||
            mergedWorkspaceBinding.groupAssignments.find((assignment) => assignment.agentId)?.agentId ||
            null,
          workspaces: workspaceBindings
        }
      ];
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function disconnectWorkspaceChannel(input: {
  workspaceId: string;
  channelId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await measureTiming(timings, "channel-registry.disconnect", () =>
    mutateChannelRegistry((registry) => {
      registry.channels = registry.channels
        .map((channel) => {
          if (channel.id !== channelId) {
            return channel;
          }

          const workspaceBindings = channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId);
          const remainingCandidates = uniqueStrings([
            ...workspaceBindings.flatMap((binding) => binding.agentIds),
            ...workspaceBindings.flatMap((binding) =>
              binding.groupAssignments
                .filter((assignment) => assignment.enabled !== false && assignment.agentId)
                .map((assignment) => assignment.agentId as string)
            )
          ]);

          return {
            ...channel,
            primaryAgentId: channel.primaryAgentId && remainingCandidates.includes(channel.primaryAgentId)
              ? channel.primaryAgentId
              : remainingCandidates[0] ?? null,
            workspaces: workspaceBindings
          };
        })
        .filter((channel) => channel.workspaces.length > 0 || channel.primaryAgentId);
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function deleteWorkspaceChannelEverywhere(input: {
  channelId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  const registry = await measureTiming(timings, "channel-registry.read-before-delete", () => readChannelRegistry());
  const channel = registry.channels.find((entry) => entry.id === channelId);

  if (!channel) {
    throw new Error("Channel was not found.");
  }

  const removedGroupIds = uniqueStrings(
    channel.workspaces.flatMap((workspace) =>
      workspace.groupAssignments
        .filter((assignment) => Boolean(assignment.chatId))
        .map((assignment) => assignment.chatId)
    )
  );
  const workspacePaths = uniqueStrings(channel.workspaces.map((workspace) => workspace.workspacePath));

  if (isPlannerChannelTypeValue(channel.type) && channel.type !== "internal") {
    await measureTiming(timings, "channel.delete-openclaw-remove", () =>
      runOpenClaw(["channels", "remove", "--channel", channel.type, "--account", channelId, "--delete"], {
        timeoutMs: 60000
      })
    );
  }

  await measureTiming(timings, "channel.delete-registry-sync", () =>
    mutateChannelRegistry(
      (nextRegistry) => {
        nextRegistry.channels = nextRegistry.channels.filter((entry) => entry.id !== channelId);
      },
      {
        removedAccountIds: [channelId],
        removedGroupIds
      },
      timings
    )
  );

  await measureTiming(timings, "channel.delete-project-cleanup", () =>
    Promise.all(
      workspacePaths.map((workspacePath) =>
        removeWorkspaceProjectChannelReferences(workspacePath, channelId, timings)
      )
    )
  );

  invalidateSnapshotCache();
  return measureTiming(timings, "channel.delete-read-final-registry", () => getChannelRegistry());
}

export async function setWorkspaceChannelPrimary(input: {
  channelId: string;
  primaryAgentId: string | null;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  await measureTiming(timings, "channel.primary-update", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      channel.primaryAgentId = normalizeOptionalValue(input.primaryAgentId) ?? null;
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function setWorkspaceChannelGroups(input: {
  channelId: string;
  workspaceId: string;
  groupAssignments: WorkspaceChannelGroupAssignment[];
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  if (!channelId) {
    throw new Error("Channel id is required.");
  }

  const removedGroupIds: string[] = [];

  await measureTiming(timings, "channel.groups-update", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
      if (!workspace) {
        throw new Error("Workspace binding was not found for this channel.");
      }

      const previousGroupIds = new Set(
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && Boolean(assignment.chatId))
          .map((assignment) => assignment.chatId)
      );

      workspace.groupAssignments = uniqueByChatId(
        input.groupAssignments.map((assignment) => ({
          chatId: assignment.chatId.trim(),
          agentId: normalizeOptionalValue(assignment.agentId) ?? null,
          title: normalizeOptionalValue(assignment.title) ?? null,
          enabled: assignment.enabled !== false
        }))
      );
      workspace.agentIds = uniqueStrings([
        ...workspace.agentIds,
        ...workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && assignment.agentId)
          .map((assignment) => assignment.agentId as string)
      ]);

      const nextGroupIds = new Set(
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && Boolean(assignment.chatId))
          .map((assignment) => assignment.chatId)
      );

      for (const chatId of previousGroupIds) {
        if (!nextGroupIds.has(chatId)) {
          removedGroupIds.push(chatId);
        }
      }
    }, { removedGroupIds }, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function bindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  workspacePath: string;
  agentId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  const agentId = slugify(input.agentId.trim());
  if (!channelId || !agentId) {
    throw new Error("Channel id and agent id are required.");
  }

  await measureTiming(timings, "channel.bind-agent", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
      const nextWorkspace: WorkspaceChannelWorkspaceBinding =
        workspace ??
        ({
          workspaceId: input.workspaceId,
          workspacePath: input.workspacePath,
          agentIds: [],
          groupAssignments: []
        } satisfies WorkspaceChannelWorkspaceBinding);

      nextWorkspace.agentIds = uniqueStrings([...nextWorkspace.agentIds, agentId]);
      nextWorkspace.workspacePath = input.workspacePath;
      channel.workspaces = [
        ...channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId),
        nextWorkspace
      ];

      if (!channel.primaryAgentId) {
        channel.primaryAgentId = agentId;
      }
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function unbindWorkspaceChannelAgent(input: {
  channelId: string;
  workspaceId: string;
  agentId: string;
}, timings?: TimingCollector) {
  const channelId = normalizeChannelId(input.channelId);
  const agentId = slugify(input.agentId.trim());
  if (!channelId || !agentId) {
    throw new Error("Channel id and agent id are required.");
  }

  await measureTiming(timings, "channel.unbind-agent", () =>
    mutateChannelRegistry((registry) => {
      const channel = registry.channels.find((entry) => entry.id === channelId);
      if (!channel) {
        throw new Error("Channel was not found.");
      }

      const workspace = channel.workspaces.find((entry) => entry.workspaceId === input.workspaceId);
      if (!workspace) {
        return;
      }

      workspace.agentIds = workspace.agentIds.filter((entry) => entry !== agentId);
      workspace.groupAssignments = workspace.groupAssignments.filter((assignment) => assignment.agentId !== agentId);

      if (channel.primaryAgentId === agentId) {
        const fallbackAgent =
          workspace.agentIds[0] ??
          workspace.groupAssignments.find((assignment) => assignment.enabled !== false && assignment.agentId)?.agentId ??
          channel.workspaces
            .flatMap((binding) => binding.agentIds)
            .find((candidate) => candidate !== agentId) ??
          channel.workspaces
            .flatMap((binding) => binding.groupAssignments)
            .find((assignment) => assignment.enabled !== false && assignment.agentId && assignment.agentId !== agentId)
            ?.agentId ??
          null;
        channel.primaryAgentId = fallbackAgent;
      }

      channel.workspaces = [
        ...channel.workspaces.filter((entry) => entry.workspaceId !== input.workspaceId),
        {
          ...workspace,
          agentIds: workspace.agentIds,
          groupAssignments: workspace.groupAssignments
        }
      ];
    }, {}, timings)
  );

  invalidateSnapshotCache();
  return getChannelRegistry();
}

export async function createWorkspaceProject(
  input: WorkspaceCreateInput,
  options: WorkspaceCreateOptions = {}
): Promise<WorkspaceCreateResult> {
  const normalized = resolveWorkspaceBootstrapInput(input);
  const enabledAgents = normalized.agents.filter((agent) => agent.enabled);
  const progress = createOperationProgressTracker({
    template: buildWorkspaceCreateProgressTemplate({
      sourceMode: normalized.sourceMode,
      agentCount: enabledAgents.length,
      kickoffMission: normalized.rules.kickoffMission
    }),
    onProgress: options.onProgress
  });

  if (enabledAgents.length === 0) {
    throw new Error("Enable at least one agent for the workspace.");
  }

  await progress.startStep(
    "validate",
    "Resolving workspace settings and reserving the target directory."
  );
  await progress.addActivity("validate", `Validated workspace name "${normalized.name}".`);

  const targetDir = await resolveWorkspaceCreationTargetDir(
    normalized,
    resolveWorkspaceRoot(await getConfiguredWorkspaceRoot())
  );
  await progress.updateStep("validate", {
    percent: 38,
    detail: `Reserved target directory at ${targetDir}.`
  });
  await progress.addActivity("validate", `Reserved target directory ${targetDir}.`, "done");

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  await progress.updateStep("validate", {
    percent: 72,
    detail: "Checking current OpenClaw snapshot and agent ids."
  });
  assertWorkspaceBootstrapAgentIdsAvailableFromProvisioning(snapshot, normalized.slug, enabledAgents);
  await progress.completeStep(
    "validate",
    `Workspace input and ${enabledAgents.length} agent configuration${enabledAgents.length === 1 ? "" : "s"} are ready.`
  );

  const existingWorkspaceResult = await resolveExistingWorkspaceCreateResult(targetDir, snapshot, normalized.slug);

  if (existingWorkspaceResult) {
    await progress.startStep("source", describeWorkspaceSourceStart(normalized.sourceMode, targetDir));
    await progress.addActivity("source", "Workspace already exists. Reusing the existing folder.", "done");
    await progress.completeStep("source", "Existing workspace folder reused.");
    await progress.startStep("scaffold", "Writing the initial workspace scaffold and local metadata.");
    await progress.addActivity("scaffold", "Workspace scaffold already exists. Reusing existing files.", "done");
    await progress.completeStep("scaffold", "Workspace files and starter docs are already in place.");
    await progress.startStep(
      "agents",
      existingWorkspaceResult.agentIds.length === 1
        ? "Reusing the existing workspace agent."
        : `Reusing ${existingWorkspaceResult.agentIds.length} workspace agents.`
    );
    await progress.addActivity(
      "agents",
      `${existingWorkspaceResult.agentIds.length} agent${existingWorkspaceResult.agentIds.length === 1 ? "" : "s"} already linked to the workspace.`,
      "done"
    );
    await progress.completeStep(
      "agents",
      `${existingWorkspaceResult.agentIds.length} agent${existingWorkspaceResult.agentIds.length === 1 ? "" : "s"} already linked to the workspace.`
    );
    await progress.startStep("kickoff", "Finalizing workspace bootstrap.");
    await progress.addActivity("kickoff", "Kickoff was already handled by the existing workspace.", "done");
    await progress.completeStep("kickoff", "Workspace bootstrap is already complete.");

    invalidateSnapshotCache();
    clearRuntimeHistoryCache();

    return existingWorkspaceResult;
  }

  await progress.startStep("source", describeWorkspaceSourceStart(normalized.sourceMode, targetDir));
  await progress.addActivity("source", describeWorkspaceSourceActivity(normalized.sourceMode, normalized), "active");
  await materializeWorkspaceSource({
    targetDir,
    sourceMode: normalized.sourceMode,
    repoUrl: normalized.repoUrl
  });
  await progress.completeStep("source", describeWorkspaceSourceCompletion(normalized.sourceMode, targetDir));

  await progress.startStep("scaffold", "Writing the initial workspace scaffold and local metadata.");
  await progress.addActivity("scaffold", "Generating workspace docs, memory, and configuration files.");
  await scaffoldWorkspaceContents(targetDir, {
    name: normalized.name,
    brief: normalized.brief,
    template: normalized.template,
    teamPreset: normalized.teamPreset,
    modelProfile: normalized.modelProfile,
    rules: normalized.rules,
    docOverrides: normalized.docOverrides,
    sourceMode: normalized.sourceMode,
    agents: enabledAgents,
    contextSources: normalized.contextSources
  });
  await progress.completeStep("scaffold", "Workspace files and starter docs are in place.");

  const createdAgentIds: string[] = [];
  const workspaceModelId =
    normalized.modelId ??
    resolveSnapshotDefaultAgentModelId(await getMissionControlSnapshot({ includeHidden: true }));

  await progress.startStep(
    "agents",
    enabledAgents.length === 1
      ? "Provisioning the first workspace agent."
      : `Provisioning ${enabledAgents.length} workspace agents.`
  );

  for (const agent of enabledAgents) {
    const createdCount = createdAgentIds.length;
    const nextIndex = createdCount + 1;
    await progress.updateStep("agents", {
      percent: Math.round((createdCount / enabledAgents.length) * 100),
      detail: `Creating agent ${nextIndex} of ${enabledAgents.length}: ${agent.name}.`
    });
    await progress.addActivity("agents", `Creating ${agent.name} (${agent.role}).`);

    const createdAgentId = await createBootstrappedWorkspaceAgentFromProvisioning({
      workspacePath: targetDir,
      workspaceSlug: normalized.slug,
      workspaceModelId,
      agent
    });
    createdAgentIds.push(createdAgentId);

    await progress.addActivity("agents", `Created ${agent.name} as ${createdAgentId}.`, "done");
    await progress.updateStep("agents", {
      percent: Math.round((createdAgentIds.length / enabledAgents.length) * 100),
      detail: `${createdAgentIds.length} of ${enabledAgents.length} agent${enabledAgents.length === 1 ? "" : "s"} ready.`
    });
  }
  await progress.completeStep(
    "agents",
    `${createdAgentIds.length} agent${createdAgentIds.length === 1 ? "" : "s"} linked to the workspace.`
  );

  invalidateSnapshotCache();
  await syncWorkspaceAgentPolicySkills(targetDir);

  const primaryAgentId =
    createdAgentIds.find((agentId) =>
      enabledAgents.some(
        (agent) => agent.isPrimary && createWorkspaceAgentIdFromProvisioning(normalized.slug, agent.id) === agentId
      )
    ) ?? createdAgentIds[0];

  let kickoffRunId: string | undefined;
  let kickoffStatus: string | undefined;
  let kickoffError: string | undefined;

  if (normalized.rules.kickoffMission) {
    await progress.startStep("kickoff", `Dispatching the kickoff mission to ${primaryAgentId}.`);
    await progress.addActivity("kickoff", `Selected ${primaryAgentId} as the primary agent.`);

    try {
      const kickoffResult = await runWorkspaceKickoffMission({
        agentId: primaryAgentId,
        brief: normalized.brief,
        modelProfile: normalized.modelProfile,
        template: normalized.template,
        rules: normalized.rules
      }, {
        onProgress: async ({ message, percent }) => {
          await progress.updateStep("kickoff", {
            percent,
            detail: message
          });
          await progress.addActivity(
            "kickoff",
            message,
            percent >= 100 ? "done" : "active"
          );
        }
      });
      kickoffRunId = kickoffResult.runId;
      kickoffStatus = kickoffResult.status;
      await progress.completeStep("kickoff", `Kickoff mission finished with status ${kickoffStatus || "unknown"}.`);
    } catch (error) {
      kickoffError =
        error instanceof Error ? error.message : "Kickoff mission could not be started.";
      await progress.addActivity("kickoff", kickoffError, "error");
      await progress.failStep("kickoff", kickoffError);
    }
  } else {
    await progress.startStep("kickoff", "Finalizing workspace bootstrap.");
    await progress.addActivity("kickoff", "Kickoff mission is disabled for this workspace.", "done");
    await progress.completeStep("kickoff", "Workspace bootstrap finished without kickoff.");
  }

  invalidateSnapshotCache();
  clearRuntimeHistoryCache();

  return {
    workspaceId: workspaceIdFromPath(targetDir),
    workspacePath: targetDir,
    agentIds: createdAgentIds,
    primaryAgentId,
    kickoffRunId,
    kickoffStatus,
    kickoffError
  };
}

async function resolveExistingWorkspaceCreateResult(
  targetDir: string,
  snapshot: MissionControlSnapshot,
  workspaceSlug: string
): Promise<WorkspaceCreateResult | null> {
  const manifest = await readWorkspaceProjectManifest(targetDir);
  const enabledManifestAgents = manifest.agents.filter((agent) => agent.enabled);
  const hasExistingWorkspaceContent =
    Boolean(manifest.name || manifest.template || manifest.sourceMode || manifest.agentTemplate) ||
    enabledManifestAgents.length > 0 ||
    manifest.channels.length > 0 ||
    manifest.contextSources.length > 0;

  if (!hasExistingWorkspaceContent) {
    return null;
  }

  const workspaceId = workspaceIdFromPath(targetDir);
  const workspace =
    snapshot.workspaces.find((entry) => entry.id === workspaceId) ??
    snapshot.workspaces.find((entry) => path.resolve(entry.path) === path.resolve(targetDir)) ??
    null;

  const workspaceAgents = snapshot.agents.filter(
    (agent) => agent.workspaceId === workspaceId || path.resolve(agent.workspacePath) === path.resolve(targetDir)
  );
  const existingAgentIds = new Set(workspaceAgents.map((agent) => agent.id));
  const manifestAgentRefs = enabledManifestAgents.map((agent) =>
    resolveManifestWorkspaceAgentProvisioningRef(workspaceSlug, agent)
  );

  const repairedAgentIds: string[] = [];
  for (const entry of manifestAgentRefs) {
    if (existingAgentIds.has(entry.agentId)) {
      continue;
    }

    const createdAgentId = await createBootstrappedWorkspaceAgentFromProvisioning({
      workspacePath: targetDir,
      workspaceSlug,
      workspaceModelId: entry.agent.modelId,
      agent: entry.agent
    });
    repairedAgentIds.push(createdAgentId);
    existingAgentIds.add(createdAgentId);
  }

  const manifestAgentIds = uniqueStrings(manifestAgentRefs.map((entry) => entry.agentId));
  const resolvedAgentIds = uniqueStrings([
    ...workspaceAgents.map((agent) => agent.id),
    ...repairedAgentIds,
    ...manifestAgentIds
  ]);

  if (resolvedAgentIds.length === 0) {
    return null;
  }

  const manifestPrimaryAgent = manifest.agents.find((agent) => agent.enabled && agent.isPrimary) ?? null;
  const manifestPrimaryAgentRef = manifestPrimaryAgent
    ? resolveManifestWorkspaceAgentProvisioningRef(workspaceSlug, manifestPrimaryAgent)
    : null;
  const primaryAgentId =
    workspaceAgents[0]?.id ??
    manifestPrimaryAgentRef?.agentId ??
    resolvedAgentIds[0];

  return {
    workspaceId: workspace?.id ?? workspaceId,
    workspacePath: workspace?.path ?? targetDir,
    agentIds: resolvedAgentIds,
    primaryAgentId,
    kickoffRunId: undefined,
    kickoffStatus: undefined,
    kickoffError: undefined
  };
}

function resolveManifestWorkspaceAgentProvisioningRef(
  workspaceSlug: string,
  manifestAgent: WorkspaceProjectManifestAgent
) {
  const slugPrefix = `${workspaceSlug}-`;
  const agentKey = manifestAgent.id.startsWith(slugPrefix)
    ? manifestAgent.id.slice(slugPrefix.length)
    : manifestAgent.id;
  const normalizedAgentKey = agentKey || manifestAgent.id;

  return {
    agentId: manifestAgent.id.startsWith(slugPrefix)
      ? manifestAgent.id
      : createWorkspaceAgentId(workspaceSlug, manifestAgent.id),
    agent: {
      id: normalizedAgentKey,
      name: manifestAgent.name ?? normalizedAgentKey,
      role: manifestAgent.role ?? "Agent",
      enabled: manifestAgent.enabled,
      emoji: manifestAgent.emoji ?? undefined,
      theme: manifestAgent.theme ?? undefined,
      skillId: manifestAgent.skillId ?? undefined,
      modelId: manifestAgent.modelId ?? undefined,
      isPrimary: manifestAgent.isPrimary,
      policy: manifestAgent.policy ?? undefined,
      channelIds: manifestAgent.channelIds
    } satisfies WorkspaceAgentBlueprintInput
  };
}

export async function updateWorkspaceProject(input: WorkspaceUpdateInput) {
  const workspaceId = input.workspaceId.trim();

  if (!workspaceId) {
    throw new Error("Workspace id is required.");
  }

  if (input.plan) {
    const baseline = input.baseline ?? (await readWorkspaceEditSeed(workspaceId));
    const workspace = createWorkspaceProjectFromEditSeed(baseline);
    return applyWorkspacePlanEdits(workspace, input.plan, {
      name: input.name,
      directory: input.directory,
      baseline
    });
  }

  const snapshot = await getMissionControlSnapshot({ force: true });
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const targetPath = resolveWorkspaceTargetPath(workspace.path, input.name, input.directory);

  if (targetPath !== workspace.path) {
    await ensurePathAvailable(targetPath, workspace.path);

    try {
      await rename(workspace.path, targetPath);
    } catch (error) {
      throw new Error(
        error instanceof Error ? `Unable to move workspace directory. ${error.message}` : "Unable to move workspace directory."
      );
    }

    const configList = await readAgentConfigList(snapshot);
    const updatedConfig = configList.map((entry) =>
      entry.workspace === workspace.path
        ? {
            ...entry,
            workspace: targetPath,
            agentDir:
              typeof entry.agentDir === "string" && entry.agentDir.startsWith(`${workspace.path}${path.sep}`)
                ? path.join(targetPath, path.relative(workspace.path, entry.agentDir))
                : entry.agentDir
          }
        : entry
    );

    await writeAgentConfigList(updatedConfig);
  }

  invalidateSnapshotCache();
  clearRuntimeHistoryCache();

  return {
    workspaceId: workspaceIdFromPath(targetPath),
    previousWorkspaceId: workspace.id,
    workspacePath: targetPath
  };
}

async function applyWorkspacePlanEdits(
  workspace: WorkspaceProject,
  plan: WorkspacePlan,
  input: {
    name?: string;
    directory?: string;
    baseline: WorkspaceEditSeed;
  }
) {
  const desiredName = normalizeOptionalValue(input.name) ?? normalizeOptionalValue(plan.workspace.name) ?? workspace.name;
  const requestedDirectory = normalizeOptionalValue(input.directory);
  const baselineDirectory = normalizeOptionalValue(input.baseline.directory) ?? workspace.path;
  const baselineName = normalizeOptionalValue(input.baseline.name) ?? workspace.name;
  const baselineBrief = normalizeOptionalValue(input.baseline.brief) ?? "";
  const desiredBrief = normalizeOptionalValue(plan.company.mission) ?? normalizeOptionalValue(plan.product.offer) ?? "";
  const currentDocOverrides = normalizeWorkspaceDocOverrides(plan.workspace.docOverrides);
  const baselineDocOverrides = normalizeWorkspaceDocOverrides(input.baseline.docOverrides);
  const currentDocOverrideMap = new Map(currentDocOverrides.map((entry) => [entry.path, entry.content]));
  const baselineDocOverrideMap = new Map(baselineDocOverrides.map((entry) => [entry.path, entry.content]));
  const currentEnabledAgents = plan.team.persistentAgents.filter((agent) => agent.enabled);
  const baselineEnabledAgents = input.baseline.agents.filter((agent) => agent.enabled);
  const nameChanged = desiredName.trim() !== baselineName.trim();
  const scaffoldInputsChanged =
    nameChanged ||
    desiredBrief !== baselineBrief ||
    plan.workspace.template !== input.baseline.template ||
    plan.workspace.sourceMode !== input.baseline.sourceMode ||
    !areWorkspaceCreateRulesEqual(plan.workspace.rules, input.baseline.rules) ||
    !areWorkspaceAgentsEqual(currentEnabledAgents, baselineEnabledAgents);
  const directoryChanged = Boolean(requestedDirectory && requestedDirectory !== baselineDirectory);
  const targetPath = directoryChanged
    ? resolveWorkspaceTargetPath(workspace.path, undefined, requestedDirectory)
    : nameChanged
      ? resolveWorkspaceTargetPath(workspace.path, desiredName, undefined)
      : workspace.path;
  const workspaceRelocated = targetPath !== workspace.path;
  const snapshot = workspaceRelocated
    ? await getMissionControlSnapshot({ force: true, includeHidden: true })
    : null;

  if (workspaceRelocated) {
    await ensurePathAvailable(targetPath, workspace.path);

    try {
      await rename(workspace.path, targetPath);
    } catch (error) {
      throw new Error(
        error instanceof Error
          ? `Unable to move workspace directory. ${error.message}`
          : "Unable to move workspace directory."
      );
    }

    const configList = await readAgentConfigList(snapshot ?? undefined);
    const updatedConfig = configList.map((entry) =>
      entry.workspace === workspace.path
        ? {
            ...entry,
            workspace: targetPath,
            agentDir:
              typeof entry.agentDir === "string" && entry.agentDir.startsWith(`${workspace.path}${path.sep}`)
                ? path.join(targetPath, path.relative(workspace.path, entry.agentDir))
                : entry.agentDir
          }
        : entry
    );

    await writeAgentConfigList(updatedConfig);
  }

  const currentWorkspacePath = targetPath;
  const projectManifestPath = path.join(currentWorkspacePath, ".openclaw", "project.json");
  let createdAt = new Date().toISOString();
  let hidden = false;
  let systemTag: string | null = null;

  try {
    const raw = await readFile(projectManifestPath, "utf8");
    const parsed = JSON.parse(raw);

    if (isObjectRecord(parsed)) {
      createdAt = typeof parsed.createdAt === "string" ? parsed.createdAt : createdAt;
      hidden = parsed.hidden === true;
      systemTag = typeof parsed.systemTag === "string" ? parsed.systemTag : null;
    }
  } catch {
    // Ignore missing or unreadable metadata and write a fresh manifest below.
  }

  const manifestAgents = plan.team.persistentAgents.map((agent) => ({
    id: agent.id,
    name: agent.name,
    role: agent.role,
    enabled: agent.enabled,
    emoji: normalizeOptionalValue(agent.emoji) ?? null,
    theme: normalizeOptionalValue(agent.theme) ?? null,
    isPrimary: Boolean(agent.isPrimary),
    skillId: normalizeOptionalValue(agent.skillId) ?? null,
    modelId: normalizeOptionalValue(agent.modelId) ?? null,
    policy: agent.policy ?? null,
    channelIds: Array.from(
      new Set(
        (agent.channelIds ?? [])
          .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
          .filter((entry) => Boolean(entry))
      )
    )
  }));
  const teamPreset: WorkspaceTeamPreset =
    manifestAgents.length <= 1
      ? "solo"
      : manifestAgents.every((agent) => agent.enabled)
        ? "core"
        : "custom";
  const projectManifest = {
    version: 1,
    slug: slugify(path.basename(currentWorkspacePath)),
    name: desiredName,
    directory: currentWorkspacePath,
    icon: getWorkspaceTemplateMeta(plan.workspace.template).icon,
    createdAt,
    updatedAt: new Date().toISOString(),
    template: plan.workspace.template,
    sourceMode: plan.workspace.sourceMode,
    teamPreset,
    modelProfile: plan.workspace.modelProfile,
    agentTemplate: teamPreset === "solo" ? "solo" : "core-team",
    rules: {
      workspaceOnly: plan.workspace.rules.workspaceOnly,
      generateStarterDocs: plan.workspace.rules.generateStarterDocs,
      generateMemory: plan.workspace.rules.generateMemory,
      kickoffMission: plan.workspace.rules.kickoffMission
    },
    contextSources: plan.intake.sources,
    hidden,
    systemTag,
    agents: manifestAgents
  };

  if (scaffoldInputsChanged) {
    const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
      name: desiredName,
      brief: desiredBrief || desiredName,
      template: plan.workspace.template,
      sourceMode: plan.workspace.sourceMode,
      rules: plan.workspace.rules,
      agents: currentEnabledAgents,
      toolExamples: await detectWorkspaceToolExamples(currentWorkspacePath),
      docOverrides: currentDocOverrides,
      contextSources: plan.intake.sources
    });
    const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));

    for (const document of scaffoldDocuments) {
      await writeTextFileEnsured(path.join(currentWorkspacePath, document.path), document.content);
    }

    for (const override of currentDocOverrides) {
      if (scaffoldPathSet.has(override.path)) {
        continue;
      }

      await writeTextFileEnsured(path.join(currentWorkspacePath, override.path), override.content);
    }
  } else {
    const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
      name: baselineName,
      brief: baselineBrief || baselineName,
      template: input.baseline.template,
      sourceMode: input.baseline.sourceMode,
      rules: input.baseline.rules,
      agents: baselineEnabledAgents,
      toolExamples: [],
      docOverrides: [],
      contextSources: input.baseline.contextSources ?? []
    });
    const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));

    for (const override of currentDocOverrides) {
      const baselineContent = baselineDocOverrideMap.get(override.path);

      if (baselineContent === override.content) {
        continue;
      }

      await writeTextFileEnsured(path.join(currentWorkspacePath, override.path), override.content);
    }

    for (const baselineOverride of baselineDocOverrides) {
      if (currentDocOverrideMap.has(baselineOverride.path)) {
        continue;
      }

      const scaffoldDocument = scaffoldDocuments.find((document) => document.path === baselineOverride.path);

      if (!scaffoldDocument || !scaffoldPathSet.has(scaffoldDocument.path)) {
        continue;
      }

      await writeTextFileEnsured(path.join(currentWorkspacePath, scaffoldDocument.path), scaffoldDocument.baseContent);
    }
  }

  if (workspaceRelocated || !areWorkspaceAgentsEqual(currentEnabledAgents, baselineEnabledAgents)) {
    const currentWorkspace = {
      ...workspace,
      id: workspaceIdFromPath(currentWorkspacePath),
      path: currentWorkspacePath
    };

    await syncWorkspaceAgentsToPlan({
      currentWorkspace,
      desiredAgents: plan.team.persistentAgents,
      workspaceSlug: slugify(path.basename(currentWorkspacePath)),
      previousWorkspaceId: input.baseline.workspaceId,
      previousWorkspacePath: input.baseline.workspacePath
    });
  }

  await writeTextFileEnsured(projectManifestPath, `${JSON.stringify(projectManifest, null, 2)}\n`);

  invalidateSnapshotCache();
  clearRuntimeHistoryCache();

  return {
    workspaceId: workspaceIdFromPath(currentWorkspacePath),
    previousWorkspaceId: workspace.id,
    workspacePath: currentWorkspacePath
  };
}

async function syncWorkspaceAgentsToPlan(input: {
  currentWorkspace: WorkspaceProject;
  desiredAgents: WorkspaceAgentBlueprintInput[];
  workspaceSlug: string;
  previousWorkspaceId?: string;
  previousWorkspacePath?: string;
}) {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const currentAgents = Array.from(
    new Map(
      snapshot.agents
        .filter((agent) => {
          if (agent.workspaceId === input.currentWorkspace.id) {
            return true;
          }

          if (input.previousWorkspaceId && agent.workspaceId === input.previousWorkspaceId) {
            return true;
          }

          return Boolean(input.previousWorkspacePath && agent.workspacePath === input.previousWorkspacePath);
        })
        .map((agent) => [agent.id, agent])
    ).values()
  );
  const matchedAgentIds = new Set<string>();

  for (const desiredAgent of input.desiredAgents) {
    const currentAgent = findMatchingWorkspaceAgent(currentAgents, input.workspaceSlug, desiredAgent.id);

    if (!desiredAgent.enabled) {
      if (currentAgent) {
        matchedAgentIds.add(currentAgent.id);
        await deleteAgent({ agentId: currentAgent.id });
      }

      continue;
    }

    if (currentAgent) {
      matchedAgentIds.add(currentAgent.id);
      await updateAgent({
        id: currentAgent.id,
        workspaceId: input.currentWorkspace.id,
        workspacePath: input.currentWorkspace.path,
        name: normalizeOptionalValue(desiredAgent.name) ?? currentAgent.name,
        emoji: normalizeOptionalValue(desiredAgent.emoji) ?? currentAgent.identity.emoji,
        theme: normalizeOptionalValue(desiredAgent.theme) ?? currentAgent.identity.theme,
        modelId: normalizeOptionalValue(desiredAgent.modelId) ?? (currentAgent.modelId === "unassigned" ? undefined : currentAgent.modelId),
        policy: desiredAgent.policy,
        heartbeat: desiredAgent.heartbeat,
        channelIds: desiredAgent.channelIds
      });
      continue;
    }

    const createdAgentId = await createAgent({
      id: createWorkspaceAgentIdFromProvisioning(input.workspaceSlug, desiredAgent.id),
      workspaceId: input.currentWorkspace.id,
      workspacePath: input.currentWorkspace.path,
      name: normalizeOptionalValue(desiredAgent.name) ?? undefined,
      emoji: normalizeOptionalValue(desiredAgent.emoji) ?? undefined,
      theme: normalizeOptionalValue(desiredAgent.theme) ?? undefined,
      modelId: normalizeOptionalValue(desiredAgent.modelId) ?? undefined,
      policy: desiredAgent.policy,
      heartbeat: desiredAgent.heartbeat,
      channelIds: desiredAgent.channelIds
    });

    matchedAgentIds.add(createdAgentId.agentId);
  }

  for (const currentAgent of currentAgents) {
    if (!matchedAgentIds.has(currentAgent.id)) {
      await deleteAgent({ agentId: currentAgent.id });
    }
  }
}

export async function deleteWorkspaceProject(input: WorkspaceDeleteInput) {
  const workspaceId = input.workspaceId.trim();

  if (!workspaceId) {
    throw new Error("Workspace id is required.");
  }

  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
  const runtimeCount = snapshot.runtimes.filter((runtime) => runtime.workspaceId === workspace.id).length;

  for (const agent of workspaceAgents) {
    await getOpenClawGatewayClient().deleteAgent(agent.id);
  }

  try {
    const configList = await readAgentConfigList(snapshot);
    const nextConfigList = configList.filter(
      (entry) => entry.workspace !== workspace.path && !workspaceAgents.some((agent) => agent.id === entry.id)
    );

    if (nextConfigList.length !== configList.length) {
      await writeAgentConfigList(nextConfigList);
    }
  } catch {
    // Ignore config cleanup failures if the agent delete command already pruned state.
  }

  await rm(workspace.path, { recursive: true, force: true });

  clearMissionControlCaches();

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    deletedAgentIds: workspaceAgents.map((agent) => agent.id),
    deletedRuntimeCount: runtimeCount
  };
}

export async function updateGatewayRemoteUrl(input: { gatewayUrl?: string | null }) {
  const gatewayUrl = normalizeGatewayRemoteUrl(input.gatewayUrl);

  if (gatewayUrl) {
    await getOpenClawGatewayClient().setConfig(GATEWAY_REMOTE_URL_CONFIG_KEY, gatewayUrl);
  } else if (await hasGatewayRemoteUrlConfig()) {
    await getOpenClawGatewayClient().unsetConfig(GATEWAY_REMOTE_URL_CONFIG_KEY);
  }

  invalidateSnapshotCache();
  clearRuntimeHistoryCache();

  return getMissionControlSnapshot({ force: true });
}

export async function updateWorkspaceRoot(input: { workspaceRoot?: string | null }) {
  const workspaceRoot = normalizeWorkspaceRoot(input.workspaceRoot);
  const settings = await readMissionControlSettings();

  await writeMissionControlSettings({
    ...(workspaceRoot ? { workspaceRoot } : {}),
    ...(settings.runtimePreflight ? { runtimePreflight: settings.runtimePreflight } : {})
  });

  invalidateSnapshotCache();
  clearRuntimeHistoryCache();

  return getMissionControlSnapshot({ force: true });
}

async function buildRuntimeDiagnostics(agentIds: string[], settings: MissionControlSettings) {
  const runtimeState = await runtimeDiagnosticsStateCache.read(agentIds);
  const smokeTest = getLatestRuntimeSmokeTest(settings);
  return buildRuntimeDiagnosticsFromState(
    runtimeState,
    smokeTest
  ) satisfies MissionControlSnapshot["diagnostics"]["runtime"];
}

async function runWorkspaceKickoffMission(
  params: {
    agentId: string;
    brief?: string;
    modelProfile: WorkspaceModelProfile;
    template: WorkspaceTemplate;
    rules: WorkspaceCreateRules;
  },
  options: {
    onProgress?: KickoffProgressHandler;
  } = {}
) {
  const prompt = buildWorkspaceKickoffPrompt(params.template, params.brief, params.rules);
  const thinking =
    params.modelProfile === "fast"
      ? "low"
      : params.modelProfile === "quality"
        ? "high"
      : "medium";
  const emittedRuntimeMessages = new Set<string>();

  await options.onProgress?.({
    message: "Submitting the kickoff brief to the primary agent.",
    percent: 18
  });

  const result = await getOpenClawGatewayClient().streamAgentTurn(
    {
      agentId: params.agentId,
      message: prompt,
      thinking,
      timeoutSeconds: 90
    },
    {
      onStdout: async (text: string) => {
        const messages = extractKickoffProgressMessages(text);

        if (messages.length === 0 && text.trim()) {
          await options.onProgress?.({
            message: "Primary agent responded. Finalizing kickoff output.",
            percent: 82
          });
          return;
        }

        for (const message of messages) {
          await options.onProgress?.({
            message,
            percent: 72
          });
        }
      },
      onStderr: async (text: string) => {
        const stderr = text.trim();

        if (!stderr) {
          return;
        }

        const message = resolveKickoffRuntimeProgressMessage(stderr);

        if (!message || emittedRuntimeMessages.has(message)) {
          return;
        }

        emittedRuntimeMessages.add(message);
        await options.onProgress?.({
          message,
          percent: 64
        });
      }
    },
    { timeoutMs: 120000 }
  );

  await options.onProgress?.({
    message: "Kickoff mission completed. Recording the resulting run metadata.",
    percent: 100
  });

  return result;
}

function resolveKickoffRuntimeProgressMessage(output: string) {
  const cleaned = stripAnsiSequences(output)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .join(" ");

  if (!cleaned) {
    return null;
  }

  const normalized = cleaned.toLowerCase();

  if (
    normalized.includes("scope upgrade pending approval") ||
    normalized.includes("pairing required") ||
    normalized.includes("more scopes than currently approved")
  ) {
    return "Gateway permissions need approval; continuing with the embedded runtime.";
  }

  if (normalized.includes("falling back to embedded")) {
    return "Gateway agent is unavailable; continuing with the embedded runtime.";
  }

  if (normalized.includes("gateway connect failed")) {
    return "Gateway connection is not ready; continuing with the embedded runtime.";
  }

  return `Runtime notice: ${summarizeKickoffRuntimeOutput(cleaned)}`;
}

function summarizeKickoffRuntimeOutput(value: string) {
  const redacted = value
    .replace(/\(requestId:\s*[^)]+\)/gi, "")
    .replace(/\brequestId:\s*\S+/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return redacted.length > 160 ? `${redacted.slice(0, 157).trim()}...` : redacted;
}

function stripAnsiSequences(value: string) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

function createWorkspaceAgentId(workspaceSlug: string, agentKey: string) {
  return `${workspaceSlug}-${slugify(agentKey) || "agent"}`;
}

function findDuplicateStrings(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return Array.from(duplicates).sort((left, right) => left.localeCompare(right));
}

function describeAgentWorkspace(
  snapshot: MissionControlSnapshot,
  agent: Pick<OpenClawAgent, "workspaceId" | "workspacePath">
) {
  return (
    snapshot.workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ??
    path.basename(agent.workspacePath)
  );
}

function assertAgentIdAvailable(
  snapshot: MissionControlSnapshot,
  agentId: string,
  targetWorkspaceId?: string | null
) {
  const existingAgent = snapshot.agents.find((agent) => agent.id === agentId);

  if (!existingAgent) {
    return;
  }

  const workspaceLabel = describeAgentWorkspace(snapshot, existingAgent);

  if (existingAgent.workspaceId === targetWorkspaceId) {
    throw new Error(`Agent id "${agentId}" already exists in workspace "${workspaceLabel}".`);
  }

  throw new Error(
    `Agent id "${agentId}" is already used by workspace "${workspaceLabel}". Choose a different id.`
  );
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function _assertWorkspaceBootstrapAgentIdsAvailable(
  snapshot: MissionControlSnapshot,
  workspaceSlug: string,
  agents: WorkspaceAgentBlueprintInput[]
) {
  const finalAgentIds = agents.map((agent) => createWorkspaceAgentId(workspaceSlug, agent.id));
  const duplicateFinalIds = findDuplicateStrings(finalAgentIds);

  if (duplicateFinalIds.length > 0) {
    throw new Error(
      `Workspace bootstrap would create duplicate agent ids: ${duplicateFinalIds.join(", ")}.`
    );
  }

  for (const agentId of finalAgentIds) {
    const existingAgent = snapshot.agents.find((agent) => agent.id === agentId);

    if (!existingAgent) {
      continue;
    }

    throw new Error(
      `Workspace bootstrap would create agent id "${agentId}", but it already exists in workspace "${describeAgentWorkspace(snapshot, existingAgent)}". Rename the workspace or adjust the agent ids.`
    );
  }
}

export function renderAgentsMarkdown(params: {
  name: string;
  brief?: string;
  template: WorkspaceTemplate;
  sourceMode: WorkspaceSourceMode;
  agents: WorkspaceAgentBlueprintInput[];
  rules: WorkspaceCreateRules;
}) {
  const templateMeta = getWorkspaceTemplateMeta(params.template);
  const teamLines = params.agents.map(
    (agent) =>
      `- ${agent.role}: ${agent.name}${agent.skillId ? ` · skill ${agent.skillId}` : ""}${
        agent.policy ? ` · ${formatAgentPresetLabel(agent.policy.preset)}` : ""
      }`
  );

  return `# ${params.name}

Shared project context for all agents working in this workspace.

## Workspace
- Template: ${templateMeta.label}
- Source mode: ${params.sourceMode}
- Workspace-only access: ${params.rules.workspaceOnly ? "enabled" : "disabled"}

## Team
${teamLines.join("\n")}

## Customize
${params.brief || "Clarify the project goal, definition of done, constraints, and success signals before large changes."}

## Safety defaults
- Stay inside the attached workspace unless the task explicitly requires another location.
- Prefer direct, reviewable changes over speculative rewrites.
- Preserve user work and avoid destructive actions without clear approval.
- Update durable docs when stable architecture, workflow, or product decisions change.
- Worker and browser agents should not install tooling unless their explicit policy allows it.
- Route environment preparation to setup-oriented agents when the work depends on new tooling.

## Daily memory
- Capture durable facts in MEMORY.md and memory/*.md.
- Record stable decisions in memory/decisions.md.
- Keep temporary chatter and scratch notes in memory/.

## Output
- Be concise in chat and write longer output to files when the artifact matters.
- Put task-specific deliverables, drafts, reports, and docs inside per-run folders under deliverables/.
- Avoid writing final artifacts to the workspace root unless explicitly requested.
`;
}

export function renderSoulMarkdown(template: WorkspaceTemplate, brief?: string) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# SOUL

## My Purpose
Help this ${templateMeta.label.toLowerCase()} workspace turn intent into real outcomes with pragmatic execution, verification, and durable memory.

## How I Operate
- Start from the current workspace reality before proposing large moves.
- Prefer concrete action, visible artifacts, and clear handoffs.
- Keep docs, memory, and deliverables aligned with the actual state of the work.

## My Quirks
- Pragmatic
- Direct
- Product-aware
- Quality-minded

${brief ? `## Active Focus\n${brief}\n` : ""}`;
}

export function renderIdentityMarkdown(template: WorkspaceTemplate) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# IDENTITY

## Role
This workspace hosts a ${templateMeta.label.toLowerCase()} team coordinated through OpenClaw.

**Vibe:** pragmatic, concise, quality-minded, workspace-grounded
`;
}

export function renderToolsMarkdown(template: WorkspaceTemplate, toolExamples: string[]) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# TOOLS

Repository commands and workflow notes for this ${templateMeta.label.toLowerCase()} workspace.

## Examples
${toolExamples.map((line) => `- ${line}`).join("\n")}

## Notes
- Replace these examples with sharper project-specific commands when the repo exposes them.
- Prefer repeatable commands that other agents can run without interpretation drift.
`;
}

export function renderHeartbeatMarkdown(template: WorkspaceTemplate) {
  const templateMeta = getWorkspaceTemplateMeta(template);

  return `# HEARTBEAT

- Start each substantial task by refreshing the brief, docs, and current files.
- Keep the ${templateMeta.label.toLowerCase()} workspace coherent across code, docs, and memory.
- Prefer explicit handoffs between implementation, review, testing, and knowledge capture.
`;
}

export function renderMemoryMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return `# ${name} Memory

Durable project facts for this ${getWorkspaceTemplateMeta(template).label.toLowerCase()} workspace.

## Current brief
${brief || "No brief captured yet. Fill this in as soon as the project goal is clarified."}

## Stable facts
- Add durable architecture, product, or workflow facts here.
- Move longer notes into memory/*.md when they outgrow this file.
`;
}

export function renderBlueprintMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return `# ${name} Blueprint

## Workspace type
${getWorkspaceTemplateMeta(template).label}

## Outcome
${brief || "Define the target outcome, user impact, and quality bar for this workspace."}

## Constraints
- Add technical, product, legal, or operational constraints here.

## Unknowns
- Capture unresolved questions that block confident execution.
`;
}

export function renderDecisionsMarkdown() {
  return `# Decisions

Use this file for durable decisions that should survive across sessions.

## Template
- Date:
- Decision:
- Context:
- Consequence:
`;
}

export function renderBriefMarkdown(
  name: string,
  template: WorkspaceTemplate,
  brief: string | undefined,
  sourceMode: WorkspaceSourceMode
) {
  return `# ${name} Brief

## Template
${getWorkspaceTemplateMeta(template).label}

## Source mode
${sourceMode}

## Objective
${brief || "Clarify the main goal, target user, and success definition for this workspace."}

## Success signals
- Define what success looks like in observable terms.

## Open questions
- List the unknowns worth resolving first.
`;
}

export function renderArchitectureMarkdown(template: WorkspaceTemplate) {
  return `# Architecture

## Current shape
- Describe the main components, systems, or content lanes in this ${getWorkspaceTemplateMeta(template).label.toLowerCase()} workspace.

## Dependencies
- List critical external services, repos, data sources, or channels.

## Risks
- Capture structural, operational, or delivery risks here.
`;
}

export function renderDeliverablesMarkdown() {
  return `# Deliverables

Use this folder for substantial output artifacts that should be easy to hand off or review.

- Create one subfolder per task or run, for example \`deliverables/2026-03-07-15-30-00-launch-brief/\`.
- Put drafts, reports, docs, and publishable assets for that task inside its run folder.
- Keep filenames descriptive and tied to the task or audience.
`;
}

export function renderTemplateSpecificDoc(kind: "ux" | "backend" | "research" | "content") {
  if (kind === "ux") {
    return `# UX Notes

- Track interaction patterns, responsive edge cases, and visual risk areas here.
`;
  }

  if (kind === "backend") {
    return `# Service Map

- Document services, jobs, queues, external dependencies, and critical flows here.
`;
  }

  if (kind === "research") {
    return `# Research Plan

- State the question, method, evidence sources, and expected output before large investigation work.
`;
  }

  return `# Content Brief

- Capture audience, channel, tone, CTA, and distribution assumptions for this content workspace.
`;
}

function workspaceIdFromPath(workspacePath: string) {
  const hash = createHash("sha1").update(workspacePath).digest("hex").slice(0, 8);
  return `workspace:${hash}`;
}

export async function readWorkspaceEditSeed(workspaceId: string): Promise<WorkspaceEditSeed> {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

  if (!workspace) {
    throw new Error("Workspace was not found.");
  }

  const manifest = await readWorkspaceProjectManifest(workspace.path);
  const displayName = manifest.name ?? workspace.name;
  const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.id);
  const configuredSkills = uniqueStrings(workspaceAgents.flatMap((agent) => agent.skills));
  const configuredTools = uniqueStrings(workspaceAgents.flatMap((agent) => agent.tools));
  const template = manifest.template ?? workspace.bootstrap.template ?? "software";
  const sourceMode = manifest.sourceMode ?? workspace.bootstrap.sourceMode ?? "empty";
  const teamPreset = manifest.teamPreset ?? (workspaceAgents.length <= 1 ? "solo" : "core");
  const modelProfile = manifest.modelProfile ?? "balanced";
  const rules = manifest.rules ?? DEFAULT_WORKSPACE_RULES;
  const bootstrapProfileCache = await buildWorkspaceBootstrapProfileCache(
    workspace.path,
    manifest.template,
    manifest.rules ?? DEFAULT_WORKSPACE_RULES
  );
  const bootstrapProfile = await readAgentBootstrapProfile(workspace.path, {
    agentId: workspaceAgents[0]?.id ?? workspace.id,
    agentName: workspaceAgents[0]?.name ?? displayName,
    configuredSkills,
    configuredTools,
    template,
    rules,
    workspaceBootstrapProfile: bootstrapProfileCache
  });
  const agents =
    manifest.agents.length > 0
      ? manifest.agents.map((entry) => {
          const currentAgent = findMatchingWorkspaceAgent(workspaceAgents, workspace.slug, entry.id);
          const resolvedPolicy = resolveAgentPolicy(
            entry.policy?.preset ?? currentAgent?.policy.preset ?? DEFAULT_AGENT_PRESET,
            entry.policy ?? currentAgent?.policy
          );

          return {
            id: entry.id,
            role: entry.role ?? formatAgentPresetLabel(resolvedPolicy.preset),
            name: entry.name ?? currentAgent?.name ?? entry.role ?? entry.id,
            enabled: entry.enabled,
            emoji: entry.emoji ?? currentAgent?.identity.emoji,
            theme: entry.theme ?? currentAgent?.identity.theme,
            skillId: entry.skillId ?? undefined,
            modelId:
              entry.modelId ??
              (currentAgent?.modelId && currentAgent.modelId !== "unassigned" ? currentAgent.modelId : undefined),
            isPrimary: entry.isPrimary,
            policy: resolvedPolicy,
            channelIds: entry.channelIds ?? [],
            heartbeat: {
              enabled: currentAgent?.heartbeat.enabled ?? false,
              ...(currentAgent?.heartbeat.every ? { every: currentAgent.heartbeat.every } : {})
            }
          } satisfies WorkspaceAgentBlueprintInput;
        })
      : buildDefaultWorkspaceAgents(template, teamPreset, displayName);
  const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
    name: displayName,
    brief: bootstrapProfile.purpose || displayName,
    template,
    sourceMode,
    rules,
    agents,
    toolExamples: await detectWorkspaceToolExamples(workspace.path),
    docOverrides: [],
    contextSources: manifest.contextSources ?? []
  });
  const docOverrides: WorkspaceDocOverride[] = [];
  const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));
  const editableDocPaths = await collectWorkspaceEditableDocPaths(workspace.path);

  for (const document of scaffoldDocuments) {
    const filePath = path.join(workspace.path, document.path);

    try {
      const currentContent = await readFile(filePath, "utf8");

      if (currentContent !== document.baseContent) {
        docOverrides.push({
          path: document.path,
          content: currentContent
        });
      }
    } catch {
      continue;
    }
  }

  for (const relativePath of editableDocPaths) {
    if (scaffoldPathSet.has(relativePath)) {
      continue;
    }

    const filePath = path.join(workspace.path, relativePath);

    try {
      const currentContent = await readFile(filePath, "utf8");
      docOverrides.push({
        path: relativePath,
        content: currentContent
      });
    } catch {
      continue;
    }
  }

  return {
    workspaceId: workspace.id,
    workspacePath: workspace.path,
    name: displayName,
    directory: workspace.path,
    template,
    sourceMode,
    teamPreset,
    modelProfile,
    modelId: workspace.modelIds[0] && workspace.modelIds[0] !== "unassigned" ? workspace.modelIds[0] : undefined,
    rules,
    docOverrides,
    agents,
    brief: bootstrapProfile.purpose || displayName,
    contextSources: manifest.contextSources ?? []
  };
}

function isPlannerChannelTypeValue(value: unknown): value is PlannerChannelType {
  return value === "internal" || value === "slack" || value === "telegram" || value === "discord" || value === "googlechat";
}

type ManagedChatChannelProvider = Exclude<PlannerChannelType, "internal">;

async function buildManagedSurfaceAccountId(
  provider: MissionControlSurfaceProvider,
  name: string,
  timings?: TimingCollector
) {
  const baseSlug = slugify(name.trim()) || provider;
  const baseId = `${provider}-${baseSlug}`;
  const registry = await measureTiming(timings, `managed-surface.${provider}.read-channel-registry`, () =>
    readChannelRegistry()
  );
  const channelAccounts = await measureTiming(timings, `managed-surface.${provider}.read-channel-accounts`, () =>
    readChannelAccounts()
  );
  const existingIds = new Set([
    ...registry.channels.filter((channel) => channel.type === provider).map((channel) => channel.id),
    ...channelAccounts.filter((account) => account.type === provider).map((account) => account.id)
  ]);

  if (!existingIds.has(baseId)) {
    return baseId;
  }

  let index = 2;
  while (existingIds.has(`${baseId}-${index}`)) {
    index += 1;
  }

  return `${baseId}-${index}`;
}

async function buildTelegramAccountId(name: string, timings?: TimingCollector) {
  return buildManagedSurfaceAccountId("telegram", name, timings);
}

async function writeChannelRegistry(registry: ChannelRegistry) {
  await writeTextFileEnsured(channelRegistryPath, `${JSON.stringify(registry, null, 2)}\n`);
}

type TelegramPairingRequest = {
  id?: string;
  code?: string;
  createdAt?: string;
  lastSeenAt?: string;
  meta?: {
    username?: string;
    firstName?: string;
    accountId?: string;
  };
};

async function readTelegramPairingAccounts() {
  try {
    const raw = await readFile(path.join(openClawStateRootPath, "credentials", "telegram-pairing.json"), "utf8");
    const parsed = JSON.parse(raw) as { requests?: TelegramPairingRequest[] } | null;
    const requests = Array.isArray(parsed?.requests) ? parsed.requests : [];
    const accounts = new Map<string, ChannelAccountRecord>();

    for (const request of requests) {
      const accountId = normalizeOptionalValue(request.meta?.accountId);
      if (!accountId) {
        continue;
      }

      accounts.set(accountId, {
        id: accountId,
        type: "telegram",
        name:
          normalizeOptionalValue(request.meta?.username) ??
          normalizeOptionalValue(request.meta?.firstName) ??
          accountId,
        enabled: true
      });
    }

    return Array.from(accounts.values());
  } catch {
    return [] as ChannelAccountRecord[];
  }
}

async function readTelegramAccountBotIds(timings?: TimingCollector) {
  try {
    const telegramDir = path.join(openClawStateRootPath, "telegram");
    const files = await measureTiming(timings, "telegram.resolve.read-bot-id-files", () => readdir(telegramDir));
    const pairs = await Promise.all(
      files
        .filter((fileName) => fileName.startsWith("update-offset-") && fileName.endsWith(".json"))
        .map(async (fileName) => {
          try {
            const raw = await measureTiming(timings, `telegram.resolve.read-bot-id-file.${fileName}`, () =>
              readFile(path.join(telegramDir, fileName), "utf8")
            );
            const parsed = JSON.parse(raw) as { botId?: string } | null;
            const botId = normalizeOptionalValue(parsed?.botId);
            const accountId = fileName.slice("update-offset-".length, -".json".length);

            if (!botId || !accountId) {
              return null;
            }

            return [accountId, botId] as const;
          } catch {
            return null;
          }
        })
    );

    return new Map(pairs.filter((entry): entry is readonly [string, string] => Boolean(entry)));
  } catch {
    return new Map<string, string>();
  }
}

async function findTelegramAccountByToken(token: string, accounts: ChannelAccountRecord[], timings?: TimingCollector) {
  const botId = normalizeOptionalValue(token.split(":", 1)[0]);
  if (!botId) {
    return null;
  }

  const accountBotIds = await measureTiming(timings, "telegram.resolve.read-bot-ids", () =>
    readTelegramAccountBotIds(timings)
  );
  return accounts.find((account) => accountBotIds.get(account.id) === botId) ?? null;
}

export async function createManagedChatChannelAccount(input: {
  provider: ManagedChatChannelProvider;
  name: string;
  accountId?: string;
  token?: string;
  botToken?: string;
  webhookUrl?: string;
}, timings?: TimingCollector) {
  if (input.provider === "telegram") {
    if (!input.token?.trim()) {
      throw new Error("Telegram bot token is required.");
    }

    return createTelegramChannelAccount({
      name: input.name,
      token: input.token,
      accountId: input.accountId
    }, timings);
  }

  const accountId =
    normalizeOptionalValue(input.accountId) ?? (await buildManagedSurfaceAccountId(input.provider, input.name, timings));
  const before = new Set(
    (
      await measureTiming(timings, `managed-chat.${input.provider}.read-before`, () => readChannelAccounts())
    )
      .filter((account) => account.type === input.provider)
      .map((account) => account.id)
  );
  const args = (() => {
    switch (input.provider) {
      case "discord":
        if (!input.token?.trim()) {
          throw new Error("Discord bot token is required.");
        }
        return ["channels", "add", "--channel", "discord", "--account", accountId, "--token", input.token, "--name", input.name];
      case "slack":
        if (!input.botToken?.trim()) {
          throw new Error("Slack bot token is required.");
        }
        return [
          "channels",
          "add",
          "--channel",
          "slack",
          "--account",
          accountId,
          "--bot-token",
          input.botToken,
          "--name",
          input.name
        ];
      case "googlechat":
        if (!input.webhookUrl?.trim()) {
          throw new Error("Google Chat webhook URL is required.");
        }
        return [
          "channels",
          "add",
          "--channel",
          "googlechat",
          "--account",
          accountId,
          "--webhook-url",
          input.webhookUrl,
          "--name",
          input.name
        ];
      default:
        throw new Error(`OpenClaw provisioning is not implemented for ${input.provider}.`);
    }
  })();

  await measureTiming(timings, `managed-chat.${input.provider}.provision-openclaw`, () =>
    runOpenClaw(args, { timeoutMs: 60000 })
  );

  const afterAccounts = (
    await measureTiming(timings, `managed-chat.${input.provider}.read-after`, () => readChannelAccounts())
  ).filter((account) => account.type === input.provider);
  const created =
    afterAccounts.find((account) => account.id === accountId) ??
    afterAccounts.find((account) => !before.has(account.id) && account.name === input.name) ??
    afterAccounts.find((account) => !before.has(account.id)) ??
    null;

  return (
    created ?? {
      id: accountId,
      type: input.provider,
      kind: getSurfaceKind(input.provider),
      name: input.name.trim() || accountId,
      enabled: true
    }
  );
}

export async function createManagedSurfaceAccount(input: {
  provider: MissionControlSurfaceProvider;
  name: string;
  accountId?: string;
  token?: string;
  botToken?: string;
  webhookUrl?: string;
  config?: Record<string, unknown>;
}, timings?: TimingCollector) {
  if (isManagedChatChannelProvider(input.provider)) {
    return createManagedChatChannelAccount({
      provider: input.provider,
      name: input.name,
      accountId: input.accountId,
      token: input.token,
      botToken: input.botToken,
      webhookUrl: input.webhookUrl
    }, timings);
  }

  const provisionConfig = normalizeManagedSurfaceProvisionConfig(input.config);
  const normalizedName = input.name.trim();
  const accountIdentity = extractManagedSurfaceIdentity(input.provider, provisionConfig);
  const accountId =
    normalizeOptionalValue(input.accountId) ??
    accountIdentity ??
    (await buildManagedSurfaceAccountId(input.provider, input.name, timings));
  const configPath = getManagedSurfaceConfigPath(input.provider);

  switch (input.provider) {
    case "gmail": {
      const account = normalizeOptionalValue(
        (provisionConfig.account as string | null | undefined) ??
          (provisionConfig.email as string | null | undefined) ??
          (provisionConfig.address as string | null | undefined)
      );

      if (!account) {
        throw new Error("Gmail account email is required.");
      }

      const gmailSetupArgs = buildGmailProvisionArgs({
        account,
        config: provisionConfig
      });

      await measureTiming(timings, "managed-surface.gmail.setup-openclaw", () =>
        runOpenClaw(gmailSetupArgs, { timeoutMs: 60000 })
      );

      const currentConfig = await measureTiming(timings, "managed-surface.gmail.read-config", () =>
        getOpenClawGatewayClient().getConfig<Record<string, unknown>>(configPath, { timeoutMs: 60000 })
      );
      const currentHooksConfig = await measureTiming(timings, "managed-surface.gmail.read-hooks", () =>
        getOpenClawGatewayClient().getConfig<Record<string, unknown>>("hooks", { timeoutMs: 60000 })
      );
      const currentPresetsValue = currentHooksConfig?.presets;
      const currentPresets = Array.isArray(currentPresetsValue)
        ? currentPresetsValue.filter((entry): entry is string => typeof entry === "string")
        : [];
      const nextHooksConfig = mergeManagedSurfaceConfig(currentHooksConfig, {
        enabled: true,
        presets: uniqueStrings([...currentPresets, "gmail"])
      });

      await measureTiming(timings, "managed-surface.gmail.write-hooks", () =>
        getOpenClawGatewayClient().setConfig("hooks", nextHooksConfig, { strictJson: true, timeoutMs: 60000 })
      );

      const nextConfig = mergeManagedSurfaceConfig(currentConfig, {
        enabled: true,
        name: normalizedName || account,
        label: normalizedName || account,
        accountId,
        account,
        email: account,
        address: account,
        ...provisionConfig
      });

      await measureTiming(timings, "managed-surface.gmail.write-config", () =>
        getOpenClawGatewayClient().setConfig(configPath, nextConfig, { strictJson: true, timeoutMs: 60000 })
      );
      break;
    }
    case "webhook": {
      const currentConfig = await measureTiming(timings, "managed-surface.webhook.read-config", () =>
        getOpenClawGatewayClient().getConfig<Record<string, unknown>>(configPath, { timeoutMs: 60000 })
      );
      const token = normalizeManagedSurfaceString(provisionConfig.token);
      if (!token) {
        throw new Error("Webhook token is required.");
      }

      const nextConfig = mergeManagedSurfaceConfig(currentConfig, {
        enabled: true,
        name: normalizedName || accountId,
        label: normalizedName || accountId,
        accountId,
        token,
        ...provisionConfig
      });

      await measureTiming(timings, "managed-surface.webhook.write-config", () =>
        getOpenClawGatewayClient().setConfig(configPath, nextConfig, { strictJson: true, timeoutMs: 60000 })
      );
      break;
    }
    case "cron": {
      const currentConfig = await measureTiming(timings, "managed-surface.cron.read-config", () =>
        getOpenClawGatewayClient().getConfig<Record<string, unknown>>(configPath, { timeoutMs: 60000 })
      );
      const webhookToken = normalizeManagedSurfaceString(provisionConfig.webhookToken);
      if (!webhookToken) {
        throw new Error("Cron webhook token is required.");
      }

      const nextConfig = mergeManagedSurfaceConfig(currentConfig, {
        enabled: true,
        name: normalizedName || accountId,
        label: normalizedName || accountId,
        accountId,
        webhookToken,
        ...provisionConfig
      });

      await measureTiming(timings, "managed-surface.cron.write-config", () =>
        getOpenClawGatewayClient().setConfig(configPath, nextConfig, { strictJson: true, timeoutMs: 60000 })
      );
      break;
    }
    case "email": {
      const currentConfig = await measureTiming(timings, "managed-surface.email.read-config", () =>
        getOpenClawGatewayClient().getConfig<Record<string, unknown>>(configPath, { timeoutMs: 60000 })
      );
      const address = normalizeManagedSurfaceString(provisionConfig.address ?? provisionConfig.email);
      if (!address) {
        throw new Error("Email address is required.");
      }

      const nextConfig = mergeManagedSurfaceConfig(currentConfig, {
        enabled: true,
        name: normalizedName || address,
        label: normalizedName || address,
        accountId,
        address,
        email: address,
        ...provisionConfig
      });

      await measureTiming(timings, "managed-surface.email.write-config", () =>
        getOpenClawGatewayClient().setConfig(configPath, nextConfig, { strictJson: true, timeoutMs: 60000 })
      );
      break;
    }
    default:
      throw new Error(`OpenClaw provisioning is not implemented for ${input.provider}.`);
  }

  const refreshedAccounts = (
    await measureTiming(timings, `managed-surface.${input.provider}.read-after`, () => readChannelAccounts())
  ).filter((account) => account.type === input.provider);
  const created =
    refreshedAccounts.find((account) => account.id === accountId) ??
    refreshedAccounts.find((account) => account.name.trim().toLowerCase() === input.name.trim().toLowerCase()) ??
    refreshedAccounts[0] ??
    null;

  return (
    created ?? {
      id: accountId,
    type: input.provider,
    kind: getSurfaceKind(input.provider),
    name: normalizedName || accountId,
    enabled: true
  }
  );
}

export async function createTelegramChannelAccount(
  input: { name: string; token: string; accountId?: string },
  timings?: TimingCollector
) {
  const accountId = normalizeOptionalValue(input.accountId) ?? (await buildTelegramAccountId(input.name, timings));
  const before = new Set(
    (
      await measureTiming(timings, "telegram.read-before", () => readChannelAccounts())
    )
      .filter((account) => account.type === "telegram")
      .map((account) => account.id)
  );

  await measureTiming(timings, "telegram.openclaw-add", () =>
    runOpenClaw(
      [
        "channels",
        "add",
        "--channel",
        "telegram",
        "--account",
        accountId,
        "--token",
        input.token,
        "--name",
        input.name
      ],
      { timeoutMs: 60000 }
    )
  );

  const explicitAccount: ChannelAccountRecord = {
    id: accountId,
    type: "telegram",
    name: input.name.trim() || accountId,
    enabled: true
  };

  const afterAccounts = (
    await measureTiming(timings, "telegram.read-after", () => readChannelAccounts())
  ).filter((account) => account.type === "telegram");
  const explicitMatch = afterAccounts.find((account) => account.id === accountId);
  if (explicitMatch) {
    return {
      ...explicitMatch,
      name: input.name.trim() || explicitMatch.name
    };
  }

  const resolveDeadline = Date.now() + 8000;
  let created: ChannelAccountRecord | null = null;
  let attempt = 0;

  while (Date.now() < resolveDeadline) {
    attempt += 1;
    const after = (
      await measureTiming(timings, `telegram.resolve.${attempt}.read-channel-accounts`, () => readChannelAccounts())
    ).filter((account) => account.type === "telegram");
    created =
      after.find((account) => account.id === accountId) ??
      after.find((account) => !before.has(account.id) && account.name === input.name) ??
      after.find((account) => !before.has(account.id)) ??
      after.find((account) => account.name === input.name) ??
      null;

    if (created) {
      break;
    }

    const pairingAccounts = await measureTiming(
      timings,
      `telegram.resolve.${attempt}.read-pairing-accounts`,
      () => readTelegramPairingAccounts()
    );
    created =
      pairingAccounts.find((account) => !before.has(account.id) && account.name === input.name) ??
      pairingAccounts.find((account) => !before.has(account.id)) ??
      pairingAccounts.find((account) => account.name === input.name) ??
      null;

    if (created) {
      break;
    }

    await measureTiming(timings, `telegram.resolve.${attempt}.sleep`, () =>
      new Promise((resolve) => setTimeout(resolve, 750))
    );
  }

  if (!created) {
    const existing = await measureTiming(timings, "telegram.resolve.token-lookup", async () =>
      findTelegramAccountByToken(
        input.token,
        (
          await measureTiming(timings, "telegram.resolve.token-lookup.read-channel-accounts", () =>
            readChannelAccounts()
          )
        ).filter((account) => account.type === "telegram"),
        timings
      )
    );

    if (existing) {
      created = existing;
    } else {
      created = explicitAccount;
    }
  }

  return {
    ...created,
    name: input.name.trim() || created.name
  };
}

function getManagedSurfaceConfigPath(provider: MissionControlSurfaceProvider) {
  switch (provider) {
    case "gmail":
      return "hooks.gmail";
    case "email":
      return "email";
    case "webhook":
      return "hooks";
    case "cron":
      return "cron";
    default:
      throw new Error(`OpenClaw provisioning is not implemented for ${provider}.`);
  }
}

function isManagedChatChannelProvider(provider: MissionControlSurfaceProvider): provider is ManagedChatChannelProvider {
  return provider === "telegram" || provider === "discord" || provider === "slack" || provider === "googlechat";
}

function extractManagedSurfaceIdentity(provider: MissionControlSurfaceProvider, config: Record<string, unknown>) {
  switch (provider) {
    case "gmail":
      return (
        normalizeManagedSurfaceString(config.account) ??
        normalizeManagedSurfaceString(config.email) ??
        normalizeManagedSurfaceString(config.address)
      );
    case "email":
      return normalizeManagedSurfaceString(config.address) ?? normalizeManagedSurfaceString(config.email);
    case "webhook":
      return normalizeManagedSurfaceString(config.accountId) ?? normalizeManagedSurfaceString(config.name);
    case "cron":
      return normalizeManagedSurfaceString(config.accountId) ?? normalizeManagedSurfaceString(config.name);
    default:
      return null;
  }
}

function buildGmailProvisionArgs(input: { account: string; config: Record<string, unknown> }) {
  const args = ["webhooks", "gmail", "setup", "--account", input.account];
  const serveConfig = isObjectRecord(input.config.serve) ? (input.config.serve as Record<string, unknown>) : {};
  const tailscaleConfig = isObjectRecord(input.config.tailscale) ? (input.config.tailscale as Record<string, unknown>) : {};

  appendFlag(args, "--project", input.config.project);
  appendFlag(args, "--topic", input.config.topic);
  appendFlag(args, "--subscription", input.config.subscription);
  appendFlag(args, "--label", input.config.label);
  appendFlag(args, "--hook-url", input.config.hookUrl);
  appendFlag(args, "--hook-token", input.config.hookToken);
  appendFlag(args, "--push-token", input.config.pushToken);
  appendFlag(args, "--bind", serveConfig.bind);
  appendFlag(args, "--port", serveConfig.port);
  appendFlag(args, "--path", serveConfig.path);
  appendBooleanFlag(args, "--include-body", input.config.includeBody);
  appendFlag(args, "--max-bytes", input.config.maxBytes);
  appendFlag(args, "--renew-minutes", input.config.renewEveryMinutes);
  appendFlag(args, "--tailscale", tailscaleConfig.mode);
  appendFlag(args, "--tailscale-path", tailscaleConfig.path);
  appendFlag(args, "--tailscale-target", tailscaleConfig.target);
  appendFlag(args, "--push-endpoint", input.config.pushEndpoint);

  return args;
}

function appendFlag(args: string[], flag: string, value: unknown) {
  const normalized = normalizeManagedSurfaceFlagValue(value);
  if (normalized === null) {
    return;
  }

  args.push(flag, normalized);
}

function appendBooleanFlag(args: string[], flag: string, value: unknown) {
  if (value === true || value === "true") {
    args.push(flag);
  }
}

function normalizeManagedSurfaceProvisionConfig(config?: Record<string, unknown>) {
  const nextConfig: Record<string, unknown> = {};

  if (!isObjectRecord(config)) {
    return nextConfig;
  }

  for (const [key, value] of Object.entries(config)) {
    assignManagedSurfaceConfigValue(nextConfig, key, normalizeManagedSurfaceConfigValue(value));
  }

  return nextConfig;
}

function mergeManagedSurfaceConfig(
  baseConfig: Record<string, unknown> | null,
  patch: Record<string, unknown>
) {
  const nextConfig = cloneManagedSurfaceConfig(baseConfig);

  for (const [key, value] of Object.entries(patch)) {
    assignManagedSurfaceConfigValue(nextConfig, key, normalizeManagedSurfaceConfigValue(value));
  }

  return nextConfig;
}

function cloneManagedSurfaceConfig(config: Record<string, unknown> | null) {
  if (!isObjectRecord(config)) {
    return {};
  }

  return JSON.parse(JSON.stringify(config)) as Record<string, unknown>;
}

function assignManagedSurfaceConfigValue(target: Record<string, unknown>, pathValue: string, value: unknown) {
  if (value === undefined) {
    return;
  }

  const segments = pathValue
    .split(".")
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (segments.length === 0) {
    return;
  }

  let cursor: Record<string, unknown> = target;
  for (let index = 0; index < segments.length - 1; index += 1) {
    const segment = segments[index];
    const current = cursor[segment];
    if (!isObjectRecord(current)) {
      cursor[segment] = {};
    }

    cursor = cursor[segment] as Record<string, unknown>;
  }

  cursor[segments[segments.length - 1]] = value;
}

function normalizeManagedSurfaceConfigValue(value: unknown): unknown {
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return undefined;
    }

    if (
      (trimmed.startsWith("{") && trimmed.endsWith("}")) ||
      (trimmed.startsWith("[") && trimmed.endsWith("]"))
    ) {
      try {
        return JSON.parse(trimmed);
      } catch {
        return trimmed;
      }
    }

    return trimmed;
  }

  if (Array.isArray(value)) {
    return value
      .map((entry) => normalizeManagedSurfaceConfigValue(entry))
      .filter((entry) => entry !== undefined);
  }

  if (isObjectRecord(value)) {
    const nextValue: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value)) {
      const normalized = normalizeManagedSurfaceConfigValue(nestedValue);
      if (normalized !== undefined) {
        nextValue[key] = normalized;
      }
    }
    return nextValue;
  }

  return value;
}

function normalizeManagedSurfaceString(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function normalizeManagedSurfaceFlagValue(value: unknown) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  if (typeof value === "boolean") {
    return value ? "true" : "false";
  }

  const normalized = normalizeManagedSurfaceString(value);
  return normalized ?? null;
}

async function upsertWorkspaceProjectAgentMetadata(
  workspacePath: string,
  agent: {
    id: string;
    name?: string | null;
    role?: string | null;
    isPrimary?: boolean;
    enabled?: boolean;
    emoji?: string | null;
    theme?: string | null;
    skillId?: string | null;
    toolIds?: string[];
    modelId?: string | null;
    policy: AgentPolicy;
    channelIds?: string[];
  }
) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};
  let existingAgent: WorkspaceProjectManifestAgent | null = null;

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
    if (Array.isArray(parsed.agents)) {
      existingAgent =
        parsed.agents
          .map((entry) => parseWorkspaceProjectManifestAgent(entry))
          .filter((entry): entry is WorkspaceProjectManifestAgent => Boolean(entry))
          .find((entry) => entry.id === agent.id) ?? null;
    }
  } catch {
    parsed = {};
  }

  const nextAgent = {
    id: agent.id,
    name: agent.name ?? existingAgent?.name ?? null,
    role: agent.role ?? existingAgent?.role ?? null,
    isPrimary: agent.isPrimary ?? existingAgent?.isPrimary ?? false,
    enabled: agent.enabled ?? existingAgent?.enabled ?? true,
    emoji: agent.emoji ?? existingAgent?.emoji ?? null,
    theme: agent.theme ?? existingAgent?.theme ?? null,
    skillId: agent.skillId ?? existingAgent?.skillId ?? null,
    toolIds: Array.isArray(agent.toolIds)
      ? uniqueStrings(
          agent.toolIds
            .map((toolId) => toolId.trim())
            .filter((toolId) => Boolean(toolId) && toolId !== "fs.workspaceOnly")
        )
      : existingAgent?.toolIds ?? [],
    modelId: agent.modelId ?? existingAgent?.modelId ?? null,
    policy: agent.policy,
    channelIds: Array.isArray(agent.channelIds)
      ? Array.from(new Set(agent.channelIds.filter((entry) => typeof entry === "string" && entry.trim())))
      : existingAgent?.channelIds ?? []
  };
  const agents = Array.isArray(parsed.agents)
    ? parsed.agents.filter((entry) => isObjectRecord(entry) && typeof entry.id === "string" && entry.id !== agent.id)
    : [];

  agents.push(nextAgent);
  parsed.version = typeof parsed.version === "number" ? parsed.version : 1;
  parsed.slug = typeof parsed.slug === "string" ? parsed.slug : slugify(path.basename(workspacePath));
  parsed.name = typeof parsed.name === "string" ? parsed.name : path.basename(workspacePath);
  parsed.updatedAt = new Date().toISOString();
  parsed.agents = agents;

  await writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

async function removeWorkspaceProjectAgentMetadata(workspacePath: string, agentId: string) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};

  try {
    const raw = await readFile(projectFilePath, "utf8");
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
  } catch {
    return;
  }

  if (!Array.isArray(parsed.agents)) {
    return;
  }

  const existingAgents = parsed.agents
    .map((entry) => parseWorkspaceProjectManifestAgent(entry))
    .filter((entry): entry is WorkspaceProjectManifestAgent => Boolean(entry));
  const nextAgents = existingAgents.filter((entry) => entry.id !== agentId);

  if (nextAgents.length === existingAgents.length) {
    return;
  }

  if (nextAgents.length > 0 && !nextAgents.some((entry) => entry.isPrimary)) {
    nextAgents[0] = {
      ...nextAgents[0],
      isPrimary: true
    };
  }

  parsed.updatedAt = new Date().toISOString();
  parsed.agents = nextAgents;

  await writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`);
}

async function removeWorkspaceProjectChannelReferences(
  workspacePath: string,
  channelId: string,
  timings?: TimingCollector
) {
  const projectFilePath = path.join(workspacePath, ".openclaw", "project.json");
  let parsed: Record<string, unknown> = {};

  try {
    const raw = await measureTiming(timings, `workspace-project.${path.basename(workspacePath)}.read`, () =>
      readFile(projectFilePath, "utf8")
    );
    const candidate = JSON.parse(raw);
    parsed = isObjectRecord(candidate) ? candidate : {};
  } catch {
    return;
  }

  if (!Array.isArray(parsed.agents)) {
    return;
  }

  let didChange = false;
  const nextAgents = parsed.agents.map((entry) => {
    if (!isObjectRecord(entry) || typeof entry.id !== "string") {
      return entry;
    }

    const currentChannelIds = Array.isArray(entry.channelIds)
      ? entry.channelIds.filter((value): value is string => typeof value === "string")
      : [];
    const nextChannelIds = currentChannelIds.filter((entry) => entry !== channelId);

    if (nextChannelIds.length === currentChannelIds.length) {
      return entry;
    }

    didChange = true;
    return {
      ...entry,
      channelIds: nextChannelIds
    };
  });

  if (!didChange) {
    return;
  }

  parsed.updatedAt = new Date().toISOString();
  parsed.agents = nextAgents;

  await measureTiming(timings, `workspace-project.${path.basename(workspacePath)}.write`, () =>
    writeTextFileEnsured(projectFilePath, `${JSON.stringify(parsed, null, 2)}\n`)
  );
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function cloneChannelRegistry(registry: ChannelRegistry): ChannelRegistry {
  return normalizeChannelRegistry({
    version: 1,
    channels: registry.channels.map((channel) => ({
      ...channel,
      workspaces: channel.workspaces.map((workspace) => ({
        ...workspace,
        agentIds: [...workspace.agentIds],
        groupAssignments: workspace.groupAssignments.map((assignment) => ({ ...assignment }))
      }))
    }))
  });
}

async function saveChannelRegistry(registry: ChannelRegistry) {
  await writeChannelRegistry(normalizeChannelRegistry(registry));
}

type ManagedTelegramRoutingCleanup = {
  removedAccountIds?: string[];
  removedGroupIds?: string[];
};

type DiscordGuildConfig = Record<
  string,
  {
    requireMention?: boolean;
    roles?: unknown;
    channels?: Record<string, unknown>;
    name?: string;
  }
>;
async function updateManagedSurfaceRouting(
  registry: ChannelRegistry,
  cleanup: ManagedTelegramRoutingCleanup = {},
  timings?: TimingCollector
) {
  const currentBindings = await measureTiming(timings, "routing.read-bindings", () =>
    getOpenClawGatewayClient().getConfig<unknown[]>("bindings").then((value) => value ?? [])
  );

  const managedChannels = registry.channels.filter(
    (channel) => isPlannerChannelTypeValue(channel.type) && channel.type !== "internal"
  );
  const removedAccountIds = new Set(cleanup.removedAccountIds ?? []);
  const removedGroupIds = new Set(cleanup.removedGroupIds ?? []);
  const managedAccountIdsByProvider = new Map<string, Set<string>>();

  for (const channel of managedChannels) {
    const current = managedAccountIdsByProvider.get(channel.type) ?? new Set<string>();
    current.add(channel.id);
    managedAccountIdsByProvider.set(channel.type, current);
  }

  const managedTelegramChannels = managedChannels.filter((channel) => channel.type === "telegram");
  const managedDiscordChannels = managedChannels.filter((channel) => channel.type === "discord");

  const nextBindings = dedupeManagedBindings([
    ...currentBindings.filter((entry) => {
      if (!isObjectRecord(entry)) {
        return true;
      }

      const match = isObjectRecord(entry.match) ? entry.match : null;
      if (!match || typeof match.channel !== "string") {
        return true;
      }

      const managedAccountIds = managedAccountIdsByProvider.get(match.channel);
      if (
        managedAccountIds &&
        typeof match.accountId === "string" &&
        (managedAccountIds.has(match.accountId) || removedAccountIds.has(match.accountId))
      ) {
        return false;
      }

      if (
        match.channel === "telegram" &&
        isObjectRecord(match.peer) &&
        typeof match.peer.id === "string" &&
        removedGroupIds.has(match.peer.id)
      ) {
        return false;
      }

      return true;
    }),
    ...managedChannels
      .filter((channel) => Boolean(channel.primaryAgentId))
      .map((channel) => ({
        agentId: channel.primaryAgentId as string,
        match: {
          channel: channel.type,
          accountId: channel.id
        }
      })),
    ...managedTelegramChannels.flatMap((channel) =>
      channel.workspaces.flatMap((workspace) =>
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && assignment.agentId)
          .flatMap((assignment) => {
            const agentId = assignment.agentId as string;

            return [
              {
                agentId,
                match: {
                  channel: "telegram",
                  accountId: channel.id
                }
              },
              {
                agentId,
                match: {
                  channel: "telegram",
                  accountId: channel.id,
                  peer: {
                    kind: "group",
                    id: assignment.chatId
                  }
                }
              }
            ];
        })
      )
    ),
    ...managedDiscordChannels.flatMap((channel) =>
      channel.workspaces.flatMap((workspace) =>
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false && assignment.agentId)
          .map((assignment) => buildManagedDiscordBinding(channel.id, assignment))
          .filter((binding): binding is Exclude<ManagedDiscordBinding, null> => Boolean(binding))
      )
    )
  ]);

  await measureTiming(timings, "routing.write-bindings", () =>
    getOpenClawGatewayClient().setConfig("bindings", nextBindings, { strictJson: true })
  );
  await measureTiming(timings, "routing.sync-telegram-settings", () =>
    syncManagedTelegramSettings(managedTelegramChannels, timings)
  );
  await measureTiming(timings, "routing.sync-discord-settings", () =>
    syncManagedDiscordSettings(managedDiscordChannels, timings)
  );
}

function dedupeManagedBindings(bindings: unknown[]) {
  const seen = new Set<string>();

  return bindings.filter((binding) => {
    const key = JSON.stringify(binding);
    if (seen.has(key)) {
      return false;
    }

    seen.add(key);
    return true;
  });
}

async function syncManagedTelegramSettings(managedChannels: WorkspaceChannelSummary[], timings?: TimingCollector) {
  await measureTiming(timings, "telegram-settings.enabled", () =>
    getOpenClawGatewayClient().setConfig("channels.telegram.enabled", managedChannels.length > 0, {
      strictJson: true
    })
  );

  const defaultAccountId = await measureTiming(timings, "telegram-settings.default-account-resolve", () =>
    resolveManagedTelegramDefaultAccountId(managedChannels, timings)
  );

  if (defaultAccountId) {
    await measureTiming(timings, "telegram-settings.default-account", () =>
      getOpenClawGatewayClient().setConfig("channels.telegram.defaultAccount", defaultAccountId, {
        strictJson: true
      })
    );
  } else {
    await measureTiming(timings, "telegram-settings.default-account-unset", () =>
      getOpenClawGatewayClient().unsetConfig("channels.telegram.defaultAccount").catch(() => {})
    );
  }

  const nextGroupsConfig = Object.fromEntries(
    managedChannels.flatMap((channel) =>
      channel.workspaces.flatMap((workspace) =>
        workspace.groupAssignments
          .filter((assignment) => assignment.enabled !== false)
          .map((assignment) => [assignment.chatId, { requireMention: true }] as const)
      )
    )
  );

  await measureTiming(timings, "telegram-settings.groups", () =>
    getOpenClawGatewayClient().setConfig("channels.telegram.groups", nextGroupsConfig, {
      strictJson: true
    })
  );

  if (defaultAccountId) {
    await measureTiming(timings, "telegram-settings.reconcile-session-stores", () =>
      reconcileManagedTelegramSessionStores(managedChannels, defaultAccountId, timings)
    );
  }
}

function collectManagedTelegramSessionStoreRoots(managedChannels: WorkspaceChannelSummary[]) {
  return uniqueStrings([
    path.join(os.homedir(), ".openclaw", "agents"),
    ...managedChannels.flatMap((channel) =>
      channel.workspaces.map((workspace) => path.join(workspace.workspacePath, ".openclaw", "agents"))
    )
  ]);
}

function isTelegramSessionStoreEntry(value: unknown): value is Record<string, unknown> {
  if (!isObjectRecord(value)) {
    return false;
  }

  if (value.channel === "telegram" || value.lastChannel === "telegram") {
    return true;
  }

  const deliveryContext = isObjectRecord(value.deliveryContext) ? value.deliveryContext : null;
  if (deliveryContext?.channel === "telegram") {
    return true;
  }

  const origin = isObjectRecord(value.origin) ? value.origin : null;
  return origin?.provider === "telegram";
}

function resolveTelegramSessionStoreAccountId(value: Record<string, unknown>) {
  const lastAccountId = normalizeOptionalValue(typeof value.lastAccountId === "string" ? value.lastAccountId : null);
  if (lastAccountId) {
    return lastAccountId;
  }

  const deliveryContext = isObjectRecord(value.deliveryContext) ? value.deliveryContext : null;
  const deliveryAccountId = normalizeOptionalValue(
    typeof deliveryContext?.accountId === "string" ? deliveryContext.accountId : null
  );
  if (deliveryAccountId) {
    return deliveryAccountId;
  }

  const origin = isObjectRecord(value.origin) ? value.origin : null;
  return normalizeOptionalValue(typeof origin?.accountId === "string" ? origin.accountId : null);
}

async function reconcileTelegramSessionStoreFile(
  filePath: string,
  preferredAccountId: string,
  knownAccountIds: Set<string>,
  timings?: TimingCollector
) {
  try {
    const raw = await measureTiming(timings, `telegram-settings.read-session-store.${path.basename(filePath)}`, () =>
      readFile(filePath, "utf8")
    );
    const parsed = JSON.parse(raw);
    if (!isObjectRecord(parsed)) {
      return false;
    }

    let changed = false;

    for (const entry of Object.values(parsed)) {
      if (!isTelegramSessionStoreEntry(entry)) {
        continue;
      }

      const currentAccountId = resolveTelegramSessionStoreAccountId(entry);
      if (currentAccountId && knownAccountIds.has(currentAccountId)) {
        continue;
      }

      if (entry.lastAccountId !== preferredAccountId) {
        entry.lastAccountId = preferredAccountId;
        changed = true;
      }

      if (isObjectRecord(entry.deliveryContext) && entry.deliveryContext.accountId !== preferredAccountId) {
        entry.deliveryContext.accountId = preferredAccountId;
        changed = true;
      }

      if (isObjectRecord(entry.origin) && entry.origin.accountId !== preferredAccountId) {
        entry.origin.accountId = preferredAccountId;
        changed = true;
      }
    }

    if (!changed) {
      return false;
    }

    await measureTiming(timings, `telegram-settings.write-session-store.${path.basename(filePath)}`, () =>
      writeTextFileEnsured(filePath, `${JSON.stringify(parsed, null, 2)}\n`)
    );
    return true;
  } catch {
    return false;
  }
}

async function reconcileManagedTelegramSessionStores(
  managedChannels: WorkspaceChannelSummary[],
  preferredAccountId: string,
  timings?: TimingCollector
) {
  const knownAccountIds = new Set(
    (await readChannelAccounts())
      .filter((account) => account.type === "telegram")
      .map((account) => account.id)
  );
  knownAccountIds.add(preferredAccountId);

  for (const root of collectManagedTelegramSessionStoreRoots(managedChannels)) {
    let entries;

    try {
      entries = await measureTiming(timings, `telegram-settings.read-agent-root.${path.basename(root)}`, () =>
        readdir(root, { withFileTypes: true })
      );
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sessionsPath = path.join(root, entry.name, "sessions", "sessions.json");
      try {
        await access(sessionsPath);
      } catch {
        continue;
      }

      await reconcileTelegramSessionStoreFile(sessionsPath, preferredAccountId, knownAccountIds, timings);
    }
  }
}

async function resolveManagedTelegramDefaultAccountId(
  managedChannels: WorkspaceChannelSummary[],
  timings?: TimingCollector
) {
  const channelAccounts = await measureTiming(timings, "telegram-settings.read-channel-accounts", () =>
    readChannelAccounts()
  );
  const telegramAccounts = channelAccounts.filter((account) => account.type === "telegram");
  const tokenBackedAccounts = telegramAccounts.filter(
    (account) => typeof account.metadata?.botId === "string" && account.metadata.botId.trim().length > 0
  );
  const managedChannelIds = new Set(managedChannels.map((channel) => channel.id));

  for (const channel of managedChannels) {
    const managedMatch = tokenBackedAccounts.find((account) => account.id === channel.id) ?? null;
    if (managedMatch) {
      return managedMatch.id;
    }
  }

  if (tokenBackedAccounts.length === 1) {
    return tokenBackedAccounts[0].id;
  }

  if (tokenBackedAccounts.length > 1) {
    const managedMatch =
      telegramAccounts.find(
        (account) =>
          managedChannelIds.has(account.id) &&
          typeof account.metadata?.botId === "string" &&
          account.metadata.botId.trim().length > 0
      ) ?? null;

    if (managedMatch) {
      return managedMatch.id;
    }

    return tokenBackedAccounts[0].id;
  }

  return managedChannels.find((channel) => Boolean(channel.primaryAgentId))?.id ?? managedChannels[0]?.id ?? null;
}

async function syncManagedDiscordSettings(managedChannels: WorkspaceChannelSummary[], timings?: TimingCollector) {
  if (managedChannels.length === 0) {
    return;
  }

  const currentGuilds = await measureTiming(timings, "discord-settings.read-guilds", () =>
    getOpenClawGatewayClient().getConfig<DiscordGuildConfig>("channels.discord.guilds").then((value) => value ?? {})
  );
  const nextGuilds: Record<string, Record<string, unknown>> = {};

  for (const [guildId, rawGuild] of Object.entries(currentGuilds ?? {})) {
    nextGuilds[guildId] = isObjectRecord(rawGuild) ? { ...(rawGuild as Record<string, unknown>) } : {};
  }

  let didChange = false;

  for (const channel of managedChannels) {
    for (const workspace of channel.workspaces) {
      for (const assignment of workspace.groupAssignments.filter((entry) => entry.enabled !== false)) {
        const parsed = parseDiscordRouteId(assignment.chatId);
        if (!parsed?.guildId) {
          continue;
        }

        const guild = nextGuilds[parsed.guildId] ?? {};
        const roles = Array.isArray(guild.roles)
          ? guild.roles
              .filter((entry) => typeof entry === "string" || typeof entry === "number")
              .map((entry) => String(entry))
              .map((entry) => entry.trim())
              .filter(Boolean)
          : [];
        const channels = isObjectRecord(guild.channels) ? { ...(guild.channels as Record<string, unknown>) } : {};

        if (guild.requireMention === undefined) {
          guild.requireMention = true;
          didChange = true;
        }

        if (parsed.kind === "role") {
          if (!roles.includes(parsed.targetId)) {
            roles.push(parsed.targetId);
            didChange = true;
          }
          guild.roles = roles;
        } else {
          const allowedChannelIds = uniqueStrings(
            [parsed.targetId, parsed.kind === "thread" ? parsed.parentId ?? "" : ""].filter(Boolean)
          );

          for (const allowedChannelId of allowedChannelIds) {
            const existing = isObjectRecord(channels[allowedChannelId])
              ? (channels[allowedChannelId] as Record<string, unknown>)
              : {};
            if (existing.allow !== true) {
              existing.allow = true;
              didChange = true;
            }
            if (existing.requireMention === undefined) {
              existing.requireMention = true;
              didChange = true;
            }
            channels[allowedChannelId] = existing;
          }

          guild.channels = channels;
        }

        nextGuilds[parsed.guildId] = guild;
      }
    }
  }

  if (!didChange) {
    return;
  }

  await measureTiming(timings, "discord-settings.write-guilds", () =>
    getOpenClawGatewayClient().setConfig("channels.discord.guilds", nextGuilds, { strictJson: true })
  );
}

function collectTelegramChannelAgentIds(channel: WorkspaceChannelSummary | null | undefined) {
  if (!channel) {
    return [] as string[];
  }

  return uniqueStrings([
    channel.primaryAgentId ?? "",
    ...channel.workspaces.flatMap((workspace) => [
      ...workspace.agentIds,
      ...workspace.groupAssignments
        .filter((assignment) => assignment.enabled !== false && assignment.agentId)
        .map((assignment) => assignment.agentId as string)
    ])
  ]);
}

function normalizeTelegramCoordinationChannel(channel: WorkspaceChannelSummary | null | undefined) {
  if (!channel) {
    return null;
  }

  return {
    id: channel.id,
    name: channel.name,
    primaryAgentId: channel.primaryAgentId ?? null,
    workspaces: channel.workspaces
      .map((workspace) => ({
        workspaceId: workspace.workspaceId,
        workspacePath: workspace.workspacePath,
        agentIds: uniqueStrings([...workspace.agentIds]).sort(),
        groupAssignments: workspace.groupAssignments
          .map((assignment) => ({
            chatId: assignment.chatId,
            agentId: assignment.agentId ?? null,
            title: assignment.title ?? null,
            enabled: assignment.enabled !== false
          }))
          .sort((left, right) => {
            const leftKey = `${left.chatId}:${left.agentId ?? ""}:${left.title ?? ""}:${left.enabled}`;
            const rightKey = `${right.chatId}:${right.agentId ?? ""}:${right.title ?? ""}:${right.enabled}`;
            return leftKey.localeCompare(rightKey);
          })
      }))
      .sort((left, right) => left.workspaceId.localeCompare(right.workspaceId))
  };
}

function areTelegramCoordinationChannelsEqual(
  previousChannel: WorkspaceChannelSummary | null | undefined,
  nextChannel: WorkspaceChannelSummary | null | undefined
) {
  return (
    JSON.stringify(normalizeTelegramCoordinationChannel(previousChannel)) ===
    JSON.stringify(normalizeTelegramCoordinationChannel(nextChannel))
  );
}

async function syncAgentPolicySkills(
  agentIds: string[],
  options: {
    snapshot?: MissionControlSnapshot;
    channelRegistry?: ChannelRegistry;
    timings?: TimingCollector;
  } = {}
) {
  const relevantAgentIds = uniqueStrings(agentIds);

  if (relevantAgentIds.length === 0) {
    return;
  }

  const snapshot =
    options.snapshot ??
    (await measureTiming(options.timings, "agent-policy.snapshot", () =>
      getMissionControlSnapshot({ includeHidden: true })
    ));
  const nextSnapshot = options.channelRegistry
    ? {
        ...snapshot,
        channelRegistry: options.channelRegistry
      }
    : snapshot;

  for (const agentId of relevantAgentIds) {
    await measureTiming(options.timings, `agent-policy.sync-agent.${agentId}`, async () => {
      const agent = nextSnapshot.agents.find((entry) => entry.id === agentId);

      if (!agent) {
        return;
      }

      const setupAgentId =
        nextSnapshot.agents.find(
          (entry) => entry.workspaceId === agent.workspaceId && entry.policy.preset === "setup" && entry.id !== agent.id
        )?.id ?? null;

      const policySkillId = await ensureAgentPolicySkillFromProvisioning({
        workspacePath: agent.workspacePath,
        agentId: agent.id,
        agentName: agent.name,
        policy: agent.policy,
        setupAgentId,
        snapshot: nextSnapshot,
        channelRegistry: options.channelRegistry,
        timings: options.timings
      });

      await upsertAgentConfigEntry(
        agent.id,
        agent.workspacePath,
        {
          name: agent.name,
          model: normalizeOptionalValue(agent.modelId),
          heartbeat: agent.heartbeat.enabled && agent.heartbeat.every ? { every: agent.heartbeat.every } : null,
          skills: [...filterAgentPolicySkills(agent.skills), policySkillId],
          tools: agent.tools.includes("fs.workspaceOnly")
            ? {
                fs: {
                  workspaceOnly: true
                }
              }
            : null
        },
        nextSnapshot,
        options.timings
      );
    });
  }
}

async function syncWorkspaceAgentPolicySkills(
  workspacePath: string,
  options: {
    snapshot?: MissionControlSnapshot;
    channelRegistry?: ChannelRegistry;
  } = {}
) {
  const snapshot = options.snapshot ?? (await getMissionControlSnapshot({ includeHidden: true }));
  const agentIds = snapshot.agents
    .filter((entry) => entry.workspacePath === workspacePath)
    .map((entry) => entry.id);

  await syncAgentPolicySkills(agentIds, {
    snapshot,
    channelRegistry: options.channelRegistry
  });
}

async function syncTelegramCoordinationSkills(
  previousRegistry: ChannelRegistry,
  nextRegistry: ChannelRegistry,
  timings?: TimingCollector
) {
  const relevantAgentIds = await measureTiming(timings, "telegram-coordination.collect-changes", () => {
    const previousTelegramChannels = new Map(
      previousRegistry.channels
        .filter((channel) => channel.type === "telegram")
        .map((channel) => [channel.id, channel] as const)
    );
    const nextTelegramChannels = new Map(
      nextRegistry.channels
        .filter((channel) => channel.type === "telegram")
        .map((channel) => [channel.id, channel] as const)
    );

    return uniqueStrings(
      uniqueStrings([...previousTelegramChannels.keys(), ...nextTelegramChannels.keys()]).flatMap((channelId) => {
        const previousChannel = previousTelegramChannels.get(channelId) ?? null;
        const nextChannel = nextTelegramChannels.get(channelId) ?? null;

        if (areTelegramCoordinationChannelsEqual(previousChannel, nextChannel)) {
          return [];
        }

        return [...collectTelegramChannelAgentIds(previousChannel), ...collectTelegramChannelAgentIds(nextChannel)];
      })
    );
  });

  if (relevantAgentIds.length === 0) {
    return;
  }

  const snapshot = await measureTiming(timings, "telegram-coordination.snapshot", () =>
    getMissionControlSnapshot({ includeHidden: true })
  );
  await measureTiming(timings, "telegram-coordination.sync-agent-policies", () =>
    syncAgentPolicySkills(relevantAgentIds, {
      snapshot,
      channelRegistry: nextRegistry,
      timings
    })
  );
}

async function mutateChannelRegistry(
  mutate: (registry: ChannelRegistry) => void | Promise<void>,
  cleanup: ManagedTelegramRoutingCleanup = {},
  timings?: TimingCollector
) {
  const registry = cloneChannelRegistry(await measureTiming(timings, "channel-registry.read", () => readChannelRegistry()));
  const previousRegistry = cloneChannelRegistry(registry);
  await measureTiming(timings, "channel-registry.mutate", () => mutate(registry));
  await measureTiming(timings, "channel-registry.save", () => saveChannelRegistry(registry));
  await measureTiming(timings, "channel-registry.update-routing", () =>
    updateManagedSurfaceRouting(registry, cleanup, timings)
  );
  invalidateSnapshotCache();
  await measureTiming(timings, "channel-registry.sync-telegram-coordination", () =>
    syncTelegramCoordinationSkills(previousRegistry, registry, timings)
  );
}

function findMatchingWorkspaceAgent(
  agents: OpenClawAgent[],
  workspaceSlug: string,
  agentKey: string
) {
  const normalizedKey = slugify(agentKey);
  const workspacePrefix = `${workspaceSlug}-`;

  return (
    agents.find((agent) => agent.id === createWorkspaceAgentIdFromProvisioning(workspaceSlug, agentKey)) ??
    agents.find((agent) => agent.id === `${workspacePrefix}${normalizedKey}`) ??
    agents.find((agent) => normalizedKey.length > 0 && agent.id.endsWith(`-${normalizedKey}`)) ??
    agents.find((agent) => agent.id === normalizedKey) ??
    null
  );
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function ensureWorkspace(store: Map<string, WorkspaceProject>, workspacePath: string) {
  const workspaceId = workspaceIdFromPath(workspacePath);
  const existing = store.get(workspaceId);

  if (existing) {
    return existing;
  }

  const workspace: WorkspaceProject = {
    id: workspaceId,
    name: prettifyWorkspaceName(workspacePath),
    slug: slugify(path.basename(workspacePath)),
    path: workspacePath,
    kind: "workspace",
    agentIds: [],
    modelIds: [],
    activeRuntimeIds: [],
    totalSessions: 0,
    health: "standby",
    bootstrap: {
      template: null,
      sourceMode: null,
      agentTemplate: null,
      coreFiles: [],
      optionalFiles: [],
      folders: [],
      projectShell: [],
      localSkillIds: []
    },
    capabilities: {
      skills: [],
      tools: [],
      workspaceOnlyAgentCount: 0
    },
    channels: []
  };

  store.set(workspaceId, workspace);
  return workspace;
}

function mergeRuntimeHistory(currentRuntimes: RuntimeRecord[]) {
  const result = mergeRuntimeHistoryRecords(currentRuntimes, runtimeHistoryCache, {
    excludeFromCache: isSyntheticDispatchRuntime
  });
  runtimeHistoryCache = result.cache;
  return result.runtimes;
}

function resolveAgentForMission(snapshot: MissionControlSnapshot, workspaceId?: string) {
  if (!workspaceId) {
    return snapshot.agents.find((agent) => agent.isDefault)?.id || snapshot.agents[0]?.id;
  }

  const workspaceAgents = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);
  return (
    workspaceAgents.find((agent) => agent.isDefault)?.id ||
    workspaceAgents.find((agent) => agent.status === "engaged")?.id ||
    workspaceAgents[0]?.id
  );
}

function resolveDefaultWorkspaceRoot() {
  return path.join(os.homedir(), "Documents", "Shared", "projects");
}

function resolveWorkspaceRoot(configuredWorkspaceRoot?: string | null) {
  return configuredWorkspaceRoot || resolveDefaultWorkspaceRoot();
}

async function ensurePathAvailable(targetPath: string, currentPath: string) {
  if (targetPath === currentPath) {
    return;
  }

  try {
    await access(targetPath);
    throw new Error("Target workspace directory already exists.");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return;
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to verify target workspace directory.");
  }
}

function resolveWorkspaceTargetPath(currentPath: string, name?: string, directory?: string) {
  const normalizedDirectory = normalizeOptionalValue(directory);

  if (normalizedDirectory) {
    return path.isAbsolute(normalizedDirectory)
      ? normalizedDirectory
      : path.join(path.dirname(currentPath), normalizedDirectory);
  }

  const normalizedName = normalizeOptionalValue(name);

  if (!normalizedName) {
    return currentPath;
  }

  const nextSlug = slugify(normalizedName);

  if (!nextSlug) {
    throw new Error("Workspace name is required.");
  }

  return path.join(path.dirname(currentPath), nextSlug);
}

function prettifyWorkspaceName(workspacePath: string) {
  const base = path.basename(workspacePath) || workspacePath;
  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function normalizeChannelId(value: string) {
  const normalized = normalizeOptionalValue(value);
  return normalized ?? "";
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
