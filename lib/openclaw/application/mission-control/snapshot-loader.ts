import "server-only";

import { createErrorSnapshot } from "@/lib/openclaw/fallback";
import { detectOpenClaw } from "@/lib/openclaw/cli";
import { probeLocalGatewayStatus } from "@/lib/openclaw/client/local-gateway-probe";
import {
  settleGatewayStatusPayloadFromOpenClaw,
  settleDeviceAccessPayloadFromOpenClaw,
  settleModelStatusPayloadFromOpenClaw,
  settleStatusPayloadFromOpenClaw,
  settleTaskListPayloadFromOpenClaw,
  settleUpdateStatusPayloadFromOpenClaw,
  type UpdateStatusPayload
} from "@/lib/openclaw/adapter/gateway-payloads";
import { GatewayStatusCache } from "@/lib/openclaw/client/gateway-status-cache";
import { settleAgentConfigFromStateFile } from "@/lib/openclaw/state/agent-config-payload";
import { getOpenClawStateRootPath } from "@/lib/openclaw/state/paths";
import { inspectOpenClawRuntimeState } from "@/lib/openclaw/state/runtime-state";
import { RuntimeDiagnosticsStateCache } from "@/lib/openclaw/state/runtime-diagnostics-cache";
import type {
  SnapshotLoadProfile,
  SnapshotPair
} from "@/lib/openclaw/state/snapshot-cache";
import { MissionControlCacheService } from "@/lib/openclaw/application/mission-control-cache-service";
import {
  getCachedOpenClawCapabilityMatrix,
  getOpenClawCapabilityMatrix
} from "@/lib/openclaw/application/capability-matrix-service";
import {
  registerMissionControlSnapshotInvalidator,
  startOpenClawEventBridge
} from "@/lib/openclaw/application/event-bridge-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { loadNativeWorkSnapshot } from "@/lib/openclaw/application/mission-control/native-work-snapshot";
import {
  settleRuntimeSnapshotPayloadFromOpenClaw
} from "@/lib/openclaw/application/runtime-state-service";
import {
  mergeModelStatusWithAgentConfigDefaults
} from "@/lib/openclaw/adapter/model-adapter";
import {
  buildAgentPayloadsFromConfig
} from "@/lib/openclaw/adapter/agent-adapter";
import { buildPresenceRecords } from "@/lib/openclaw/adapter/presence-adapter";
import { buildVisibleSnapshotCollections } from "@/lib/openclaw/adapter/visibility-adapter";
import {
  CachedPayloadController,
  createDeferredPayloadResult,
  isDeferredPayloadResult,
  resolveCachedPayload,
  SLOW_PAYLOAD_CACHE_TTL_MS,
  type CachedPayload
} from "@/lib/openclaw/client/payload-cache";
import {
  type AgentConfigPayload,
  type AgentPayload,
  type GatewayStatusPayload,
  type ModelsPayload,
  type ModelsStatusPayload,
  type OpenClawDeviceListPayload,
  type OpenClawRuntimeSnapshotPayload,
  type OpenClawTaskListPayload,
  type PresencePayload,
  type StatusPayload
} from "@/lib/openclaw/client/gateway-client";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import { mergeOperationTaskProjections } from "@/lib/openclaw/domains/operation-task-projection";
import { getOperationsSnapshot } from "@/lib/agentos/application/operations-service";
import { buildAgentInboxItems } from "@/lib/openclaw/domains/agent-inbox";
import {
  type SessionsPayload
} from "@/lib/openclaw/domains/session-catalog";
import {
  normalizeConfiguredWorkspaceRootValue,
  readMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import {
  readOpenClawConfiguredModelIds,
  readOpenClawConfiguredProviderCredentialIds
} from "@/lib/openclaw/application/model-provider-state-service";
import { mergeModelStatusWithGatewayCredentials } from "@/lib/openclaw/domains/model-provider-connection";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import type { AddModelsProviderId } from "@/lib/openclaw/types";
import {
  hydrateMissionControlChannels
} from "@/lib/openclaw/application/mission-control/channel-hydration";
import {
  buildFallbackModels,
  buildLiveMissionControlDiagnostics,
  buildMissionControlModelRecords,
  buildMissionControlRuntimeDiagnostics
} from "@/lib/openclaw/application/mission-control/diagnostics";
import {
  normalizeGatewayRemoteUrlConfigValue,
  readGatewayRemoteUrlConfig,
  settleAgentPayloadFromOpenClaw,
  settleSessionsPayloadFromOpenClaw
} from "@/lib/openclaw/application/mission-control/payload-loader";
import {
  clearMissionControlRuntimeHistoryStore,
  createMissionControlRuntimeHistoryStore,
  hydrateMissionControlSessions,
  readMissionControlDispatchRecords,
  reconcileMissionControlRuntimes
} from "@/lib/openclaw/application/mission-control/runtime-reconciliation";
import {
  createMissionControlWorkspaceBindings,
  hydrateMissionControlWorkspaceGraph
} from "@/lib/openclaw/application/mission-control/workspace-hydration";
import { buildWorkspaceContextDiagnosticIssues } from "@/lib/openclaw/application/mission-control/workspace-context-diagnostics";
import {
  createSnapshotPair,
  MISSION_CONTROL_GATEWAY_STATUS_STALE_GRACE_MS,
  MISSION_CONTROL_MISSION_PRESETS,
  MISSION_CONTROL_RUNTIME_DIAGNOSTICS_TTL_MS,
  MISSION_CONTROL_SNAPSHOT_TTL_MS
} from "@/lib/openclaw/application/mission-control/snapshot-utils";
import { buildSystemReadinessSnapshot } from "@/lib/openclaw/application/mission-control/system-readiness-snapshot";

let agentPayloadCache: CachedPayload<AgentPayload> | null = null;
let agentConfigPayloadCache: CachedPayload<AgentConfigPayload> | null = null;
let modelsPayloadCache: CachedPayload<ModelsPayload> | null = null;
let modelsStatusPayloadCache: CachedPayload<ModelsStatusPayload> | null = null;
let sessionsPayloadCache: CachedPayload<SessionsPayload> | null = null;
let runtimeSnapshotPayloadCache: CachedPayload<OpenClawRuntimeSnapshotPayload> | null = null;
let taskListPayloadCache: CachedPayload<OpenClawTaskListPayload> | null = null;
let presencePayloadCache: CachedPayload<PresencePayload> | null = null;
const runtimeHistoryStore = createMissionControlRuntimeHistoryStore();
const statusPayloadCache = new CachedPayloadController<StatusPayload>();
const updateStatusPayloadCache = new CachedPayloadController<UpdateStatusPayload>();
const gatewayStatusCache = new GatewayStatusCache(MISSION_CONTROL_GATEWAY_STATUS_STALE_GRACE_MS);
const missionControlCacheService = new MissionControlCacheService<MissionControlSnapshot>({
  ttlMs: MISSION_CONTROL_SNAPSHOT_TTL_MS,
  load: (profile, generation) => loadMissionControlSnapshots({ profile, generation })
});
const runtimeDiagnosticsStateCache = new RuntimeDiagnosticsStateCache({
  ttlMs: MISSION_CONTROL_RUNTIME_DIAGNOSTICS_TTL_MS,
  getGeneration: () => missionControlCacheService.getGeneration(),
  loadState: (agentIds, agentDirs) =>
    inspectOpenClawRuntimeState(getOpenClawStateRootPath(), agentIds, {
      agentDirs
    })
});

function clearRuntimeHistoryCache() {
  clearMissionControlRuntimeHistoryStore(runtimeHistoryStore);
}

export function clearMissionControlRuntimeHistoryCache() {
  clearRuntimeHistoryCache();
}

function clearMissionControlPayloadCaches() {
  agentPayloadCache = null;
  agentConfigPayloadCache = null;
  modelsPayloadCache = null;
  modelsStatusPayloadCache = null;
  sessionsPayloadCache = null;
  runtimeSnapshotPayloadCache = null;
  taskListPayloadCache = null;
  presencePayloadCache = null;
}

export function clearMissionControlCaches() {
  missionControlCacheService.clear({ incrementGeneration: true });
  runtimeDiagnosticsStateCache.clear();
  gatewayStatusCache.clear();
  statusPayloadCache.clear();
  updateStatusPayloadCache.clear();
  clearMissionControlPayloadCaches();
  clearRuntimeHistoryCache();
}

export function invalidateMissionControlSnapshotCache() {
  missionControlCacheService.clear();
  clearMissionControlPayloadCaches();
}

registerMissionControlSnapshotInvalidator(invalidateMissionControlSnapshotCache);

export async function getMissionControlSnapshot(
  options: { force?: boolean; includeHidden?: boolean; loadProfile?: SnapshotLoadProfile } = {}
) {
  if (options.force) {
    clearMissionControlPayloadCaches();
  }

  return missionControlCacheService.getSnapshot(options);
}

async function loadMissionControlSnapshots({
  profile = "interactive",
  generation = missionControlCacheService.getGeneration()
}: {
  profile?: SnapshotLoadProfile;
  generation?: number;
} = {}): Promise<SnapshotPair<MissionControlSnapshot>> {
  const stateRoot = getOpenClawStateRootPath();
  const localGatewayStatus = await probeLocalGatewayStatus();
  const openclawCliInstalled = await detectOpenClaw();
  const openclawInstalled = openclawCliInstalled || Boolean(localGatewayStatus?.rpc?.ok);

  if (!openclawInstalled) {
    return createSnapshotPair(
      createErrorSnapshot("OpenClaw CLI is not installed on this machine.", {
        installed: false,
        loaded: Boolean(localGatewayStatus?.service?.loaded),
        rpcOk: false
      })
    );
  }

  try {
    const systemProfile = profile === "system";
    const settings = await readMissionControlSettings();
    if (!systemProfile) {
      startOpenClawEventBridge();
    }
    const configuredWorkspaceRoot = normalizeConfiguredWorkspaceRootValue(settings.workspaceRoot) ?? null;

    if (systemProfile) {
      return createSnapshotPair(
        await buildSystemReadinessSnapshot({
          generation,
          settings,
          localGatewayStatus,
          openclawInstalled,
          configuredWorkspaceRoot,
          gatewayStatusCache
        })
      );
    }

    const gatewayRemoteUrlResult = systemProfile
      ? createDeferredPayloadResult<unknown>()
      : await readGatewayRemoteUrlConfig();
    let gatewayStatusResult: PromiseSettledResult<GatewayStatusPayload>;
    let statusResult: PromiseSettledResult<StatusPayload>;
    let updateStatusResult: PromiseSettledResult<UpdateStatusPayload> = createDeferredPayloadResult();
    let agentsResult: PromiseSettledResult<AgentPayload>;
    let agentConfigResult: PromiseSettledResult<AgentConfigPayload>;
    let configuredModelIdsResult: PromiseSettledResult<string[]>;
    let credentialProviderIdsResult: PromiseSettledResult<AddModelsProviderId[]>;
    let modelsResult: PromiseSettledResult<ModelsPayload>;
    let modelStatusResult: PromiseSettledResult<ModelsStatusPayload>;
    let deviceAccessResult: PromiseSettledResult<OpenClawDeviceListPayload>;
    let taskListResult: PromiseSettledResult<OpenClawTaskListPayload> = createDeferredPayloadResult();
    let presenceResult: PromiseSettledResult<PresencePayload>;

    const statusCacheNeedsRefresh = statusPayloadCache.shouldRefresh();
    const gatewayStatusCacheNeedsRefresh = gatewayStatusCache.shouldRefresh();
    const modelStatusCacheNeedsRefresh =
      !modelsStatusPayloadCache || Date.now() - modelsStatusPayloadCache.capturedAt > SLOW_PAYLOAD_CACHE_TTL_MS;

    if (profile === "interactive" || systemProfile) {
      const shouldHydrateGatewayStatus = gatewayStatusCacheNeedsRefresh;
      const shouldHydrateStatus = !localGatewayStatus && statusCacheNeedsRefresh;
      const shouldHydrateModelStatus = !systemProfile && modelStatusCacheNeedsRefresh;

      const gatewayStatusPromise = shouldHydrateGatewayStatus
        ? settleGatewayStatusPayloadFromOpenClaw(15_000)
        : Promise.resolve(createDeferredPayloadResult<GatewayStatusPayload>());
      const statusPromise = shouldHydrateStatus
        ? settleStatusPayloadFromOpenClaw(15_000)
        : Promise.resolve(createDeferredPayloadResult<StatusPayload>());
      const agentConfigPromise = settleAgentConfigFromStateFile(stateRoot);
      const configuredModelIdsPromise = readOpenClawConfiguredModelIds().then(
        (configuredModelIds) => ({
          status: "fulfilled",
          value: Array.from(configuredModelIds)
        }) as PromiseSettledResult<string[]>
      );
      const credentialProviderIdsPromise = readOpenClawConfiguredProviderCredentialIds().then(
        (providers) => ({ status: "fulfilled", value: providers }) as PromiseSettledResult<AddModelsProviderId[]>
      );
      const modelStatusPromise = shouldHydrateModelStatus
        ? settleModelStatusPayloadFromOpenClaw(15_000)
        : Promise.resolve(createDeferredPayloadResult<ModelsStatusPayload>());
      const deviceAccessPromise = systemProfile
        ? Promise.resolve(createDeferredPayloadResult<OpenClawDeviceListPayload>())
        : settleDeviceAccessPayloadFromOpenClaw(5_000);
      [
        gatewayStatusResult,
        statusResult,
        agentConfigResult,
        configuredModelIdsResult,
        credentialProviderIdsResult,
        modelStatusResult,
        deviceAccessResult
      ] = await Promise.all([
        gatewayStatusPromise,
        statusPromise,
        agentConfigPromise,
        configuredModelIdsPromise,
        credentialProviderIdsPromise,
        modelStatusPromise,
        deviceAccessPromise
      ]);
      agentsResult = createDeferredPayloadResult();
      modelsResult = createDeferredPayloadResult();
      presenceResult = createDeferredPayloadResult();
      if (statusCacheNeedsRefresh && !shouldHydrateStatus) {
        statusPayloadCache.scheduleRefresh(() => settleStatusPayloadFromOpenClaw(15_000));
      }
    } else {
      [
        statusResult,
        gatewayStatusResult,
        agentConfigResult,
        configuredModelIdsResult,
        credentialProviderIdsResult,
        modelStatusResult,
        deviceAccessResult
      ] = await Promise.all([
        settleStatusPayloadFromOpenClaw(45_000),
        settleGatewayStatusPayloadFromOpenClaw(45_000),
        settleAgentConfigFromStateFile(stateRoot),
        readOpenClawConfiguredModelIds().then(
          (configuredModelIds) => ({
            status: "fulfilled",
            value: Array.from(configuredModelIds)
          }) as PromiseSettledResult<string[]>
        ),
        readOpenClawConfiguredProviderCredentialIds().then(
          (providers) => ({ status: "fulfilled", value: providers }) as PromiseSettledResult<AddModelsProviderId[]>
        ),
        settleModelStatusPayloadFromOpenClaw(45_000),
        settleDeviceAccessPayloadFromOpenClaw(10_000)
      ]);
      agentsResult = createDeferredPayloadResult();
      modelsResult = createDeferredPayloadResult();
      presenceResult = createDeferredPayloadResult();
    }

    let resolvedGatewayStatus = gatewayStatusCache.resolve(gatewayStatusResult);

    if (!resolvedGatewayStatus.value && localGatewayStatus) {
      resolvedGatewayStatus = {
        value: localGatewayStatus,
        reusedCachedValue: false
      };
    }

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
        ? normalizeGatewayRemoteUrlConfigValue(gatewayRemoteUrlResult.value)
        : undefined;
    const resolvedStatus = statusPayloadCache.resolve(statusResult);
    const resolvedAgentConfig = resolveCachedPayload(agentConfigResult, agentConfigPayloadCache, (entry) => {
      agentConfigPayloadCache = entry;
    });
    const agentConfig = resolvedAgentConfig.value ?? [];
    const configuredModelIds = configuredModelIdsResult.status === "fulfilled"
      ? configuredModelIdsResult.value
      : [];
    const credentialProviderIds = credentialProviderIdsResult.status === "fulfilled"
      ? credentialProviderIdsResult.value
      : [];
    if (isDeferredPayloadResult(agentsResult) && !systemProfile) {
      agentsResult = await settleAgentPayloadFromOpenClaw(agentConfig);
    }
    const sessionsResult: PromiseSettledResult<SessionsPayload> = systemProfile
      ? createDeferredPayloadResult<SessionsPayload>()
      : await settleSessionsPayloadFromOpenClaw(agentConfig);
    const runtimeSnapshotMode = getCachedOpenClawCapabilityMatrix()?.operations?.runtimeSnapshot?.mode;
    const shouldHydrateRuntimeSnapshot =
      !systemProfile &&
      runtimeSnapshotMode !== "degraded" &&
      runtimeSnapshotMode !== "disabled" &&
      runtimeSnapshotMode !== "cli-fallback";
    const runtimeSnapshotResult: PromiseSettledResult<OpenClawRuntimeSnapshotPayload> = systemProfile
      ? createDeferredPayloadResult<OpenClawRuntimeSnapshotPayload>()
      : shouldHydrateRuntimeSnapshot
        ? await settleRuntimeSnapshotPayloadFromOpenClaw(profile === "interactive" ? 8_000 : 15_000)
        : createDeferredPayloadResult<OpenClawRuntimeSnapshotPayload>();
    if (!systemProfile) {
      taskListResult = await settleTaskListPayloadFromOpenClaw(profile === "interactive" ? 8_000 : 15_000);
    }
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
    const resolvedRuntimeSnapshot = resolveCachedPayload(runtimeSnapshotResult, runtimeSnapshotPayloadCache, (entry) => {
      runtimeSnapshotPayloadCache = entry;
    });
    const resolvedTaskList = resolveCachedPayload(taskListResult, taskListPayloadCache, (entry) => {
      taskListPayloadCache = entry;
    });
    const resolvedPresence = resolveCachedPayload(presenceResult, presencePayloadCache, (entry) => {
      presencePayloadCache = entry;
    });
    const status = resolvedStatus.value;
    const statusHasUpdateRegistry = hasStatusUpdateRegistry(status);
    if (!systemProfile && !statusHasUpdateRegistry && profile === "refresh") {
      updateStatusResult = await settleUpdateStatusPayloadFromOpenClaw(20_000);
    } else if (!systemProfile && !statusHasUpdateRegistry && updateStatusPayloadCache.shouldRefresh()) {
      updateStatusPayloadCache.scheduleRefresh(() => settleUpdateStatusPayloadFromOpenClaw(15_000));
    }
    const resolvedUpdateStatus = statusHasUpdateRegistry
      ? { value: undefined, reusedCachedValue: false, failed: false }
      : updateStatusPayloadCache.resolve(updateStatusResult);
    const agentsList = resolvedAgents.value ?? buildAgentPayloadsFromConfig(agentConfig, stateRoot);
    const modelStatus = mergeModelStatusWithGatewayCredentials(
      mergeModelStatusWithAgentConfigDefaults(resolvedModelStatus.value, agentConfig, agentsList),
      credentialProviderIds
    ) ?? undefined;
    const localModels = buildFallbackModels({ agentConfig, modelStatus, configuredModelIds });
    const models = resolvedModels.value?.models ?? localModels.models;
    const presence = resolvedPresence.value ?? [];
    const hasOpenClawSignal =
      gatewayStatusResult.status === "fulfilled" ||
      statusResult.status === "fulfilled" ||
      agentsResult.status === "fulfilled" ||
      agentConfigResult.status === "fulfilled" ||
      modelsResult.status === "fulfilled" ||
      modelStatusResult.status === "fulfilled" ||
      sessionsResult.status === "fulfilled" ||
      runtimeSnapshotResult.status === "fulfilled" ||
      taskListResult.status === "fulfilled" ||
      updateStatusResult.status === "fulfilled" ||
      deviceAccessResult.status === "fulfilled" ||
      presenceResult.status === "fulfilled";
    const runtimeDiagnosticsPromise = buildMissionControlRuntimeDiagnostics(
      agentsList.map((agent) => ({
        id: agent.id,
        agentDir: agent.agentDir
      })),
      settings,
      runtimeDiagnosticsStateCache
    );
    void runtimeDiagnosticsPromise.catch(() => {});
    const dispatchRecords = await readMissionControlDispatchRecords();
    const sessions = await hydrateMissionControlSessions(
      resolvedSessions.value?.sessions ?? [],
      dispatchRecords
    );
    const { channelRegistry, channelAccounts, surfaceRuntime, surfaceDrift } = await hydrateMissionControlChannels(profile);
    const workspaceBindings = createMissionControlWorkspaceBindings(agentsList);
    const runtimes = await reconcileMissionControlRuntimes({
      sessions,
      agentConfig,
      agentsList,
      runtimeSnapshot: resolvedRuntimeSnapshot.value,
      taskList: resolvedTaskList.value,
      systemProfile,
      dispatchRecords,
      resolveWorkspaceId: workspaceBindings.resolveWorkspaceId,
      historyStore: runtimeHistoryStore
    });
    const {
      workspaces,
      agents,
      relationships,
      manifestByWorkspace
    } = await hydrateMissionControlWorkspaceGraph({
      bindings: workspaceBindings,
      agentConfig,
      sessions,
      status,
      gatewayStatus,
      hasOpenClawSignal,
      runtimes
    });
    const nativeWork = await loadNativeWorkSnapshot({
      sessions: resolvedSessions.value?.sessions ?? [],
      agents,
      taskList: resolvedTaskList.value,
      matrix: getCachedOpenClawCapabilityMatrix() ?? await getOpenClawCapabilityMatrix().catch(() => null),
      adapter: getOpenClawAdapter(),
      timeoutMs: profile === "interactive" ? 8_000 : 15_000
    });

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

    const [runtimeTasks, visibleRuntimeTasks, operations] = await Promise.all([
      Promise.resolve(buildTaskRecords(runtimes, agents)),
      Promise.resolve(buildTaskRecords(visibleRuntimes, visibleAgents)),
      getOperationsSnapshot()
    ]);
    const tasks = mergeOperationTaskProjections(operations, runtimeTasks, agents);
    const visibleTasks = mergeOperationTaskProjections(operations, visibleRuntimeTasks, visibleAgents);
    const agentInbox = buildAgentInboxItems(tasks, runtimes, agents);
    const visibleAgentInbox = buildAgentInboxItems(visibleTasks, visibleRuntimes, visibleAgents);
    const runtimeDiagnostics = await runtimeDiagnosticsPromise;
    const diagnostics = await buildLiveMissionControlDiagnostics({
      profile,
      settings,
      configuredWorkspaceRoot: configuredWorkspaceRoot ?? null,
      configuredGatewayUrl,
      gatewayStatus,
      status,
      taskList: resolvedTaskList.value,
      updateStatus: resolvedUpdateStatus.value,
      hasOpenClawSignal,
      runtimeDiagnostics,
      workspaceContextIssues: buildWorkspaceContextDiagnosticIssues({
        workspaces,
        agents,
        runtimes,
        tasks
      }),
      models,
      agents,
      modelStatus,
      configuredModelIds,
      deviceAccess: deviceAccessResult.status === "fulfilled" ? deviceAccessResult.value : undefined,
      payloadResults: {
        gatewayStatus: gatewayStatusResult,
        status: statusResult,
        taskList: taskListResult,
        updateStatus: updateStatusResult,
        deviceAccess: deviceAccessResult,
        agents: agentsResult,
        agentConfig: agentConfigResult,
        models: modelsResult,
        modelStatus: modelStatusResult,
        sessions: sessionsResult,
        presence: presenceResult
      },
      gatewayStatusRejectedWithCachedValue:
        gatewayStatusResult.status === "rejected" && resolvedGatewayStatus.reusedCachedValue,
      payloadReuse: {
        status: resolvedStatus,
        taskList: resolvedTaskList,
        updateStatus: resolvedUpdateStatus,
        agents: resolvedAgents,
        agentConfig: resolvedAgentConfig,
        models: resolvedModels,
        modelStatus: resolvedModelStatus,
        sessions: resolvedSessions,
        presence: resolvedPresence
      }
    });

    const generatedAt = new Date().toISOString();
    const sharedSnapshotFields = {
      generatedAt,
      revision: generation,
      mode: "live" as const,
      diagnostics,
      channelAccounts,
      channelRegistry,
      surfaceRuntime,
      surfaceDrift,
      presence: buildPresenceRecords(presence),
      missionPresets: MISSION_CONTROL_MISSION_PRESETS
    };

    return {
      full: {
        ...sharedSnapshotFields,
        workspaces,
        agents,
        models: buildMissionControlModelRecords({ models, agents, modelStatus, configuredModelIds }),
        runtimes,
        tasks,
        agentInbox,
        nativeWork,
        relationships
      },
      visible: {
        ...sharedSnapshotFields,
        workspaces: visibleWorkspaces,
        agents: visibleAgents,
        models: buildMissionControlModelRecords({ models, agents: visibleAgents, modelStatus, configuredModelIds }),
        runtimes: visibleRuntimes,
        tasks: visibleTasks,
        agentInbox: visibleAgentInbox,
        nativeWork,
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

function hasStatusUpdateRegistry(status: StatusPayload | undefined) {
  return Boolean(status?.update?.registry?.latestVersion || status?.update?.registry?.error);
}
