import "server-only";

import os from "node:os";
import path from "node:path";

import { createErrorSnapshot } from "@/lib/openclaw/fallback";
import { detectOpenClaw, getRecentOpenClawCommandDiagnostics, getResolvedOpenClawBin, resolveOpenClawVersion } from "@/lib/openclaw/cli";
import { probeLocalGatewayStatus } from "@/lib/openclaw/client/local-gateway-probe";
import {
  settleGatewayStatusPayloadFromOpenClaw,
  settleModelStatusPayloadFromOpenClaw,
  settleStatusPayloadFromOpenClaw
} from "@/lib/openclaw/adapter/gateway-payloads";
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
import { DEFAULT_WORKSPACE_RULES } from "@/lib/openclaw/workspace-presets";
import { buildTaskRecords } from "@/lib/openclaw/domains/task-records";
import {
  annotateMissionDispatchMetadata as annotateMissionDispatchMetadataFromRuntime,
  annotateMissionDispatchSessions,
  buildMissionDispatchRuntimes as buildMissionDispatchRuntimesFromRuntime,
  isSyntheticDispatchRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import {
  buildObservedMissionDispatchRuntime,
  persistMissionDispatchObservation,
  readMissionDispatchRecords,
  reconcileMissionDispatchRuntimeState
} from "@/lib/openclaw/domains/mission-dispatch-lifecycle";
import {
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
  filterAgentPolicySkills,
  readAgentIdentityOverrides
} from "@/lib/openclaw/domains/agent-config";
import {
  normalizeChannelRegistry,
  readWorkspaceProjectManifest
} from "@/lib/openclaw/domains/workspace-manifest";
import type { WorkspaceProjectManifest } from "@/lib/openclaw/domains/workspace-manifest";
import {
  applyChannelAccountDisplayNames,
  buildLegacyRegistrySurfaceAccounts,
  mergeMissionControlSurfaceAccounts,
  readChannelAccounts
} from "@/lib/openclaw/domains/channels";
import { normalizeOptionalValue, resolveModelReadiness } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  buildWorkspaceBootstrapProfileCache,
  readWorkspaceInspectorMetadata,
  type WorkspaceBootstrapProfileCache
} from "@/lib/openclaw/adapter/workspace-inspector-adapter";
import {
  getLatestRuntimeSmokeTest,
  normalizeConfiguredWorkspaceRootValue,
  readMissionControlSettings
} from "@/lib/openclaw/domains/control-plane-settings";
import { workspaceIdFromPath } from "@/lib/openclaw/domains/workspace-id";
import type { MissionControlSettings } from "@/lib/openclaw/domains/control-plane-settings";
import type {
  ChannelAccountRecord,
  MissionControlSnapshot,
  OpenClawAgent,
  RelationshipRecord,
  RuntimeRecord,
  WorkspaceProject
} from "@/lib/openclaw/types";

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

export function clearMissionControlRuntimeHistoryCache() {
  clearRuntimeHistoryCache();
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

export function invalidateMissionControlSnapshotCache() {
  missionControlCacheService.clear();
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

async function buildRuntimeDiagnostics(agentIds: string[], settings: MissionControlSettings) {
  const runtimeState = await runtimeDiagnosticsStateCache.read(agentIds);
  const smokeTest = getLatestRuntimeSmokeTest(settings);
  return buildRuntimeDiagnosticsFromState(
    runtimeState,
    smokeTest
  ) satisfies MissionControlSnapshot["diagnostics"]["runtime"];
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

function resolveDefaultWorkspaceRoot() {
  return path.join(os.homedir(), "Documents", "Shared", "projects");
}

function resolveWorkspaceRoot(configuredWorkspaceRoot?: string | null) {
  return configuredWorkspaceRoot || resolveDefaultWorkspaceRoot();
}

function prettifyWorkspaceName(workspacePath: string) {
  const base = path.basename(workspacePath) || workspacePath;
  return base
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
