import "server-only";

import { createHash } from "node:crypto";
import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createErrorSnapshot } from "@/lib/openclaw/fallback";
import {
  DEFAULT_AGENT_PRESET,
  formatAgentPresetLabel,
  formatCapabilityLabel,
  filterKnownOpenClawSkillIds,
  filterKnownOpenClawToolIds,
  getAgentPresetMeta,
  inferAgentPresetFromContext,
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
  runOpenClawJson,
  runOpenClawJsonStream,
  getResolvedOpenClawBin,
  resolveOpenClawVersion
} from "@/lib/openclaw/cli";
import {
  buildOpenClawBinarySelectionSnapshot,
  readOpenClawBinarySelection
} from "@/lib/openclaw/binary-selection";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import {
  buildWorkspaceCreateProgressTemplate,
  createOperationProgressTracker
} from "@/lib/openclaw/operation-progress";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { getSurfaceKind } from "@/lib/openclaw/surface-catalog";
import {
  DEFAULT_WORKSPACE_RULES,
  buildDefaultWorkspaceAgents,
  getWorkspaceTemplateMeta
} from "@/lib/openclaw/workspace-presets";
import {
  buildWorkspaceContextManifest,
  buildWorkspaceScaffoldDocuments,
  WORKSPACE_CONTEXT_CORE_PATHS,
  WORKSPACE_CONTEXT_OPTIONAL_PATHS,
  normalizeWorkspaceDocOverrides
} from "@/lib/openclaw/workspace-docs";
import {
  buildAgentPolicyPromptLines,
  buildWorkspaceKickoffPrompt,
  describeWorkspaceSourceActivity,
  describeWorkspaceSourceCompletion,
  describeWorkspaceSourceStart,
  detectWorkspaceToolExamples,
  extractKickoffProgressMessages,
  materializeWorkspaceSource,
  renderSkillMarkdown,
  resolveWorkspaceBootstrapInput,
  resolveWorkspaceCreationTargetDir,
  writeTextFileEnsured,
  writeTextFileIfMissing,
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
  collectWorkspaceResourceState,
  createWorkspaceProjectFromEditSeed,
  listLocalWorkspaceSkills
} from "@/lib/openclaw/domains/workspace-edit";
import {
  parseWorkspaceProjectManifestAgent,
  readWorkspaceProjectManifest,
  normalizeChannelRegistry,
  parseWorkspaceChannelSummary,
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
import {
  collectIssues,
  compareVersionStrings,
  normalizeOptionalValue,
  normalizeUpdateError,
  resolveAgentAction,
  resolveAgentStatus,
  resolveDiagnosticHealth,
  resolveModelReadiness,
  resolveUpdateInfo,
  resolveWorkspaceHealth,
  unique
} from "@/lib/openclaw/domains/control-plane-normalization";
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
  ModelRecord,
  OpenClawRuntimeSmokeTest,
  OpenClawAgent,
  PresenceRecord,
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

export { discoverDiscordRoutes, discoverSurfaceRoutes, discoverTelegramGroups, getChannelRegistry };

type GatewayStatusPayload = {
  service?: {
    label?: string;
    loaded?: boolean;
  };
  gateway?: {
    bindMode?: string;
    port?: number;
    probeUrl?: string;
  };
  rpc?: {
    ok?: boolean;
  };
};

type StatusPayload = {
  runtimeVersion?: string;
  version?: string;
  updateChannel?: string;
  overview?: {
    version?: string;
    update?: string;
  };
  update?: {
    root?: string;
    installKind?: string;
    packageManager?: string;
    registry?: {
      latestVersion?: string | null;
      error?: string | null;
    };
  };
  securityAudit?: {
    findings?: Array<{ severity?: string; title?: string; detail?: string }>;
  };
  sessions?: {
    recent?: Array<{
      agentId?: string;
      key?: string;
      sessionId?: string;
      updatedAt?: number;
      age?: number;
      inputTokens?: number;
      outputTokens?: number;
      cacheRead?: number;
      totalTokens?: number;
      model?: string;
    }>;
  };
  agents?: {
    defaultId?: string;
  };
  heartbeat?: {
    agents?: Array<{
      agentId: string;
      enabled?: boolean;
      every?: string | null;
      everyMs?: number | null;
    }>;
  };
};

type AgentPayload = Array<{
  id: string;
  name?: string;
  identityName?: string;
  identityEmoji?: string;
  identitySource?: string;
  workspace: string;
  agentDir: string;
  model?: string;
  bindings?: number;
  isDefault?: boolean;
}>;

type AgentConfigPayload = Array<{
  id: string;
  name?: string;
  workspace: string;
  agentDir?: string;
  model?: string;
  heartbeat?: {
    every?: string;
  };
  skills?: string[];
  tools?: {
    fs?: {
      workspaceOnly?: boolean;
    };
  };
  identity?: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  };
  default?: boolean;
}>;

const missionControlRootPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control");
const channelRegistryPath = path.join(missionControlRootPath, "channel-registry.json");
const openClawStateRootPath = path.join(os.homedir(), ".openclaw");
const GATEWAY_REMOTE_URL_CONFIG_KEY = "gateway.remote.url";
const runtimeSmokeTestMessage = "AgentOS runtime smoke test. Reply with a brief READY status.";
type WorkspaceCreateOptions = {
  onProgress?: (snapshot: OperationProgressSnapshot) => Promise<void> | void;
};

type KickoffProgressHandler = (update: {
  message: string;
  percent: number;
}) => Promise<void> | void;

type ModelsPayload = {
  models: Array<{
    key: string;
    name: string;
    input: string;
    contextWindow: number | null;
    local: boolean | null;
    available: boolean | null;
    tags: string[];
    missing: boolean;
  }>;
};

type ModelsStatusPayload = {
  defaultModel?: string | null;
  resolvedDefault?: string | null;
  allowed?: string[];
  auth?: {
    providers?: Array<{
      provider?: string;
      effective?: {
        kind?: string;
        detail?: string;
      };
      profiles?: {
        count?: number;
      };
    }>;
    missingProvidersInUse?: string[];
    unusableProfiles?: unknown[];
    oauth?: {
      providers?: Array<{
        provider?: string;
        status?: string;
      }>;
    };
  };
};

type PresencePayload = Array<{
  host: string;
  ip: string;
  version: string;
  platform: string;
  deviceFamily?: string;
  mode: string;
  reason: string;
  text: string;
  ts: number;
}>;

type MissionCommandPayload = {
  runId?: string;
  status?: string;
  summary?: string;
  payloads?: Array<{
    text: string;
    mediaUrl: string | null;
  }>;
  meta?: Record<string, unknown>;
  result?: {
    payloads?: Array<{
      text: string;
      mediaUrl: string | null;
    }>;
    meta?: Record<string, unknown>;
  };
};

type AgentBootstrapProfile = OpenClawAgent["profile"];
type OpenClawRuntimeState = Omit<MissionControlSnapshot["diagnostics"]["runtime"], "smokeTest">;
type SnapshotLoadProfile = "interactive" | "refresh";

type CachedPayload<T> = {
  value: T;
  capturedAt: number;
};

type BootstrapProfileReadResult = {
  fileName: string;
  lines: string[];
  source: string;
};

type WorkspaceBootstrapProfileCache = {
  profileFiles: readonly string[];
  contextManifest: ReturnType<typeof buildWorkspaceContextManifest>;
  workspaceSections: Map<string, string[]>;
  workspaceSources: string[];
};

const SNAPSHOT_CACHE_TTL_MS = 30_000;
const RUNTIME_DIAGNOSTICS_CACHE_TTL_MS = 5 * 60_000;
const GATEWAY_STATUS_STALE_GRACE_MS = 60_000;
const SLOW_PAYLOAD_CACHE_TTL_MS = 5 * 60_000;
const DEFERRED_SNAPSHOT_PAYLOAD_MESSAGE = "Deferred to background refresh.";

type SnapshotPair = {
  visible: MissionControlSnapshot;
  full: MissionControlSnapshot;
};

type SnapshotCacheEntry = SnapshotPair & {
  expiresAt: number;
};

type RuntimeDiagnosticsCacheEntry = {
  agentIdsKey: string;
  value: OpenClawRuntimeState;
  expiresAt: number;
};

type GatewayStatusCacheEntry = {
  value: GatewayStatusPayload;
  capturedAt: number;
};

let snapshotCache: SnapshotCacheEntry | null = null;
let snapshotPromise: Promise<SnapshotPair> | null = null;
let runtimeDiagnosticsCache: RuntimeDiagnosticsCacheEntry | null = null;
let runtimeDiagnosticsPromise: Promise<OpenClawRuntimeState> | null = null;
let gatewayStatusCache: GatewayStatusCacheEntry | null = null;
let statusPayloadCache: CachedPayload<StatusPayload> | null = null;
let agentPayloadCache: CachedPayload<AgentPayload> | null = null;
let agentConfigPayloadCache: CachedPayload<AgentConfigPayload> | null = null;
let modelsPayloadCache: CachedPayload<ModelsPayload> | null = null;
let modelsStatusPayloadCache: CachedPayload<ModelsStatusPayload> | null = null;
let sessionsPayloadCache: CachedPayload<SessionsPayload> | null = null;
let presencePayloadCache: CachedPayload<PresencePayload> | null = null;
let statusRefreshPromise: Promise<void> | null = null;
let runtimeHistoryCache = new Map<string, RuntimeRecord>();
let snapshotGeneration = 0;

function clearRuntimeHistoryCache() {
  runtimeHistoryCache = new Map();
}

export function clearMissionControlCaches() {
  snapshotGeneration += 1;
  snapshotCache = null;
  runtimeDiagnosticsCache = null;
  runtimeDiagnosticsPromise = null;
  gatewayStatusCache = null;
  statusPayloadCache = null;
  agentPayloadCache = null;
  agentConfigPayloadCache = null;
  modelsPayloadCache = null;
  modelsStatusPayloadCache = null;
  sessionsPayloadCache = null;
  presencePayloadCache = null;
  clearRuntimeHistoryCache();
}

function loadSnapshotPairForCurrentGeneration(profile: SnapshotLoadProfile = "interactive") {
  const generation = snapshotGeneration;

  return loadMissionControlSnapshots({ profile, generation }).then((nextSnapshot) => {
    if (generation === snapshotGeneration) {
      snapshotCache = {
        ...nextSnapshot,
        expiresAt: Date.now() + SNAPSHOT_CACHE_TTL_MS
      };
    }

    return nextSnapshot;
  });
}

function shouldRefreshStatusPayloadCache() {
  return !statusPayloadCache || Date.now() - statusPayloadCache.capturedAt > SLOW_PAYLOAD_CACHE_TTL_MS;
}

function scheduleStatusPayloadRefresh() {
  if (statusRefreshPromise || !shouldRefreshStatusPayloadCache()) {
    return;
  }

  statusRefreshPromise = (async () => {
    try {
      const value = await settleStatusPayloadFromOpenClaw(15_000);

      if (value.status === "fulfilled") {
        statusPayloadCache = {
          value: value.value,
          capturedAt: Date.now()
        };
      }
    } catch {
      // Background refresh is best-effort.
    } finally {
      statusRefreshPromise = null;
    }
  })();

  void statusRefreshPromise.catch(() => {});
}

async function settleStatusPayloadFromOpenClaw(
  timeoutMs = 20_000
): Promise<PromiseSettledResult<StatusPayload>> {
  try {
    const value = await runOpenClawJson<StatusPayload>(["status", "--json"], {
      timeoutMs
    });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

async function settleGatewayStatusPayloadFromOpenClaw(
  timeoutMs = 20_000
): Promise<PromiseSettledResult<GatewayStatusPayload>> {
  try {
    const value = await runOpenClawJson<GatewayStatusPayload>(["gateway", "status", "--json"], {
      timeoutMs
    });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

async function settleModelStatusPayloadFromOpenClaw(
  timeoutMs = 20_000
): Promise<PromiseSettledResult<ModelsStatusPayload>> {
  try {
    const value = await runOpenClawJson<ModelsStatusPayload>(["models", "status", "--json"], {
      timeoutMs
    });

    return {
      status: "fulfilled",
      value
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

function resolveCachedPayload<T>(
  result: PromiseSettledResult<T>,
  cached: CachedPayload<T> | null,
  writeCache: (entry: CachedPayload<T>) => void
) {
  if (result.status === "fulfilled") {
    const entry = {
      value: result.value,
      capturedAt: Date.now()
    };

    writeCache(entry);

    return {
      value: result.value,
      reusedCachedValue: false,
      failed: false
    };
  }

  if (cached && Date.now() - cached.capturedAt <= SLOW_PAYLOAD_CACHE_TTL_MS) {
    return {
      value: cached.value,
      reusedCachedValue: true,
      failed: true
    };
  }

  return {
    value: undefined,
    reusedCachedValue: false,
    failed: true
  };
}

function createDeferredPayloadResult<T>(): PromiseSettledResult<T> {
  return {
    status: "rejected",
    reason: new Error(DEFERRED_SNAPSHOT_PAYLOAD_MESSAGE)
  };
}

function isDeferredPayloadResult(result: PromiseSettledResult<unknown>) {
  return (
    result.status === "rejected" &&
    result.reason instanceof Error &&
    result.reason.message === DEFERRED_SNAPSHOT_PAYLOAD_MESSAGE
  );
}

async function settleAgentConfigFromStateFile(): Promise<PromiseSettledResult<AgentConfigPayload>> {
  try {
    const raw = await readFile(path.join(openClawStateRootPath, "openclaw.json"), "utf8");
    const parsed = JSON.parse(raw) as {
      agents?: {
        list?: unknown;
      };
    };
    const list = parsed.agents?.list;

    return {
      status: "fulfilled",
      value: Array.isArray(list) ? (list as AgentConfigPayload) : []
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

async function settleChannelRegistryFromLocalFile(): Promise<PromiseSettledResult<ChannelRegistry>> {
  try {
    const raw = await readFile(channelRegistryPath, "utf8");
    const parsed = JSON.parse(raw);
    const registryInput = isObjectRecord(parsed)
      ? parsed
      : { version: 1, channels: [] as unknown[] };
    const channels = Array.isArray(registryInput.channels)
      ? registryInput.channels
          .map((entry) => parseWorkspaceChannelSummary(entry))
          .filter((entry): entry is WorkspaceChannelSummary => Boolean(entry))
      : [];

    return {
      status: "fulfilled",
      value: normalizeChannelRegistry({
        version: 1,
        channels
      })
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

function describeCachedPayloadReuse(label: string, reusedCachedValue: boolean) {
  return reusedCachedValue
    ? `${label}: Reusing the last successful payload while a slow OpenClaw command refreshes in the background.`
    : null;
}

function buildAgentPayloadsFromConfig(agentConfig: AgentConfigPayload): AgentPayload {
  return agentConfig.map((entry) => ({
    id: entry.id,
    name: entry.name || entry.identity?.name || entry.id,
    identityName: entry.identity?.name,
    identityEmoji: entry.identity?.emoji,
    identitySource: entry.identity ? "config" : undefined,
    workspace: normalizeOptionalValue(entry.workspace) ?? "",
    agentDir: entry.agentDir || path.join(openClawStateRootPath, "agents", entry.id, "agent"),
    model: entry.model,
    isDefault: Boolean(entry.default)
  }));
}

function buildModelsPayloadFromFallbackSources(
  agentConfig: AgentConfigPayload,
  modelStatus?: ModelsStatusPayload
): ModelsPayload {
  const modelIds = uniqueStrings([
    ...agentConfig.map((entry) => entry.model ?? "").filter(Boolean),
    ...(modelStatus?.allowed ?? []).filter(Boolean),
    modelStatus?.resolvedDefault ?? "",
    modelStatus?.defaultModel ?? ""
  ]);

  return {
    models: modelIds.map((modelId) => {
      const fallbackMetadata = inferFallbackModelMetadata(modelId);

      return {
        key: modelId,
        name: modelId,
        input: "text",
        contextWindow: fallbackMetadata.contextWindow,
        local: fallbackMetadata.local,
        available: true,
        tags: [],
        missing: false
      };
    })
  };
}

export function inferFallbackModelMetadata(modelId: string): {
  contextWindow: number | null;
  local: boolean | null;
} {
  const normalized = modelId.trim().toLowerCase();
  const provider = normalized.split("/", 1)[0] || "";
  const route = normalized.includes("/") ? normalized.slice(provider.length + 1) : normalized;

  if (provider === "ollama") {
    return {
      contextWindow: inferOllamaContextWindow(route),
      local: true
    };
  }

  if (provider === "openai" || provider === "openai-codex") {
    return {
      contextWindow: route.startsWith("gpt-5") ? 272000 : null,
      local: false
    };
  }

  if (provider === "anthropic") {
    return {
      contextWindow: 200000,
      local: false
    };
  }

  if (provider === "gemini") {
    return {
      contextWindow: 1000000,
      local: false
    };
  }

  if (provider === "deepseek") {
    return {
      contextWindow: 64000,
      local: false
    };
  }

  if (provider === "mistral") {
    return {
      contextWindow: 128000,
      local: false
    };
  }

  if (provider === "openrouter" || provider === "xai") {
    return {
      contextWindow: null,
      local: false
    };
  }

  return {
    contextWindow: null,
    local: null
  };
}

function inferOllamaContextWindow(route: string) {
  if (route.includes("qwen3.5")) {
    return 262144;
  }

  if (
    route.includes("qwen") ||
    route.includes("llama3.2") ||
    route.includes("llama3.3") ||
    route.includes("deepseek-r1")
  ) {
    return 131072;
  }

  return 131072;
}

function buildModelStatusFromAgentConfig(agentConfig: AgentConfigPayload): ModelsStatusPayload | undefined {
  const defaultModel =
    agentConfig.find((entry) => entry.default)?.model ||
    agentConfig.find((entry) => Boolean(entry.model))?.model ||
    null;

  if (!defaultModel) {
    return undefined;
  }

  return {
    defaultModel,
    resolvedDefault: defaultModel
  };
}

function buildRuntimeDiagnosticsAgentKey(agentIds: string[]) {
  return [...new Set(agentIds.filter(Boolean))].sort().join("\u0000");
}

function loadRuntimeDiagnosticsStateForCurrentGeneration(agentIds: string[]) {
  const generation = snapshotGeneration;
  const agentIdsKey = buildRuntimeDiagnosticsAgentKey(agentIds);

  return inspectOpenClawRuntimeState(agentIds).then((nextState) => {
    if (generation === snapshotGeneration) {
      runtimeDiagnosticsCache = {
        agentIdsKey,
        value: nextState,
        expiresAt: Date.now() + RUNTIME_DIAGNOSTICS_CACHE_TTL_MS
      };
    }

    return nextState;
  });
}

async function readBootstrapProfileFile(
  rootPath: string,
  workspacePath: string,
  fileName: string
): Promise<BootstrapProfileReadResult | null> {
  const filePath = path.join(rootPath, fileName);

  try {
    await access(filePath);
    const raw = await readFile(filePath, "utf8");
    const trimmed = raw.trim();

    if (!trimmed) {
      return null;
    }

    return {
      fileName,
      lines: trimmed.split(/\r?\n/),
      source: describeBootstrapSourcePath(workspacePath, filePath)
    };
  } catch {
    return null;
  }
}

async function buildWorkspaceBootstrapProfileCache(
  workspacePath: string,
  template?: WorkspaceTemplate | null,
  rules?: WorkspaceCreateRules
): Promise<WorkspaceBootstrapProfileCache> {
  const contextManifest = buildWorkspaceContextManifest(template, rules ?? DEFAULT_WORKSPACE_RULES);
  const bootstrapFiles = ["AGENTS.md", "SOUL.md", "IDENTITY.md", "TOOLS.md", "HEARTBEAT.md"] as const;
  const profileFiles = [
    ...new Set([...bootstrapFiles, ...contextManifest.resources.map((spec) => spec.relativePath)])
  ];
  const entries = await Promise.all(
    profileFiles.map((fileName) => readBootstrapProfileFile(workspacePath, workspacePath, fileName))
  );
  const workspaceSections = new Map<string, string[]>();
  const workspaceSources: string[] = [];

  for (const entry of entries) {
    if (!entry) {
      continue;
    }

    workspaceSections.set(entry.fileName, entry.lines);
    workspaceSources.push(entry.source);
  }

  return {
    profileFiles,
    contextManifest,
    workspaceSections,
    workspaceSources
  };
}

function resolveGatewayStatus(
  result: PromiseSettledResult<GatewayStatusPayload>
): {
  value: GatewayStatusPayload | undefined;
  reusedCachedValue: boolean;
} {
  if (result.status === "fulfilled") {
    gatewayStatusCache = {
      value: result.value,
      capturedAt: Date.now()
    };

    return {
      value: result.value,
      reusedCachedValue: false
    };
  }

  if (gatewayStatusCache && Date.now() - gatewayStatusCache.capturedAt <= GATEWAY_STATUS_STALE_GRACE_MS) {
    return {
      value: gatewayStatusCache.value,
      reusedCachedValue: true
    };
  }

  return {
    value: undefined,
    reusedCachedValue: false
  };
}

async function probeLocalGatewayStatus(port = 18789): Promise<GatewayStatusPayload | null> {
  const reachable = await probeTcpPort("127.0.0.1", port, 750);

  if (!reachable) {
    return null;
  }

  return {
    service: {
      label: "Local port probe",
      loaded: true
    },
    gateway: {
      bindMode: "loopback",
      port,
      probeUrl: `ws://127.0.0.1:${port}`
    },
    rpc: {
      ok: true
    }
  };
}

async function probeTcpPort(host: string, port: number, timeoutMs: number) {
  return await new Promise<boolean>((resolve) => {
    const socket = net.createConnection({ host, port });
    let settled = false;

    const finish = (ok: boolean) => {
      if (settled) {
        return;
      }

      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(ok);
    };

    socket.setTimeout(timeoutMs);
    socket.once("connect", () => finish(true));
    socket.once("error", () => finish(false));
    socket.once("timeout", () => finish(false));
  });
}

export async function getMissionControlSnapshot(options: { force?: boolean; includeHidden?: boolean } = {}) {
  const cachedSnapshot = snapshotCache;
  const cacheIsFresh = Boolean(cachedSnapshot && cachedSnapshot.expiresAt > Date.now());

  if (!options.force && cacheIsFresh && cachedSnapshot) {
    return options.includeHidden ? cachedSnapshot.full : cachedSnapshot.visible;
  }

  if (!options.force && cachedSnapshot) {
    if (!snapshotPromise) {
      snapshotPromise = loadSnapshotPairForCurrentGeneration("interactive");
      void snapshotPromise.catch(() => {});
      void snapshotPromise.finally(() => {
        snapshotPromise = null;
      }).catch(() => {});
    }

    return options.includeHidden ? cachedSnapshot.full : cachedSnapshot.visible;
  }

  if (options.force) {
    snapshotGeneration += 1;
    snapshotCache = null;
    snapshotPromise = loadSnapshotPairForCurrentGeneration("refresh");
    void snapshotPromise.catch(() => {});

    try {
      const nextSnapshot = await snapshotPromise;

      return options.includeHidden ? nextSnapshot.full : nextSnapshot.visible;
    } finally {
      snapshotPromise = null;
    }
  }

  if (snapshotPromise) {
    const pending = await snapshotPromise;
    return options.includeHidden ? pending.full : pending.visible;
  }

  snapshotPromise = loadSnapshotPairForCurrentGeneration("interactive");
  void snapshotPromise.catch(() => {});

  try {
    const nextSnapshot = await snapshotPromise;

    return options.includeHidden ? nextSnapshot.full : nextSnapshot.visible;
  } finally {
    snapshotPromise = null;
  }
}

async function loadMissionControlSnapshots({
  profile = "interactive",
  generation = snapshotGeneration
}: {
  profile?: SnapshotLoadProfile;
  generation?: number;
} = {}): Promise<SnapshotPair> {
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

    const statusCacheNeedsRefresh = shouldRefreshStatusPayloadCache();
    const gatewayStatusCacheNeedsRefresh =
      !gatewayStatusCache || Date.now() - gatewayStatusCache.capturedAt > GATEWAY_STATUS_STALE_GRACE_MS;
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
      agentConfigResult = await settleAgentConfigFromStateFile();
      modelsResult = createDeferredPayloadResult();
      modelStatusResult = shouldHydrateModelStatus
        ? await settleModelStatusPayloadFromOpenClaw(15_000)
        : createDeferredPayloadResult();
      presenceResult = createDeferredPayloadResult();
      if (statusCacheNeedsRefresh && !shouldHydrateStatus) {
        scheduleStatusPayloadRefresh();
      }
    } else {
      statusResult = await settleStatusPayloadFromOpenClaw(45_000);
      gatewayStatusResult = await settleGatewayStatusPayloadFromOpenClaw(45_000);
      agentsResult = createDeferredPayloadResult();
      agentConfigResult = await settleAgentConfigFromStateFile();
      modelsResult = createDeferredPayloadResult();
      modelStatusResult = await settleModelStatusPayloadFromOpenClaw(45_000);
      presenceResult = createDeferredPayloadResult();
    }

    let resolvedGatewayStatus = localGatewayStatus
      ? {
          value: localGatewayStatus,
          reusedCachedValue: false
        }
      : resolveGatewayStatus(gatewayStatusResult);

    if (!resolvedGatewayStatus.value) {
      const probedGatewayStatus = await probeLocalGatewayStatus(gatewayStatusCache?.value.gateway?.port ?? 18789);

      if (probedGatewayStatus) {
        gatewayStatusCache = {
          value: probedGatewayStatus,
          capturedAt: Date.now()
        };
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
    const resolvedStatus = resolveCachedPayload(statusResult, statusPayloadCache, (entry) => {
      statusPayloadCache = entry;
    });
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
    const agentsList = resolvedAgents.value ?? buildAgentPayloadsFromConfig(agentConfig);
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
    const channelRegistryResult = await settleChannelRegistryFromLocalFile();
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
        const workspaceBootstrapProfile =
          workspaceBootstrapProfileByWorkspace.get(rawAgent.workspace) ??
          (await buildWorkspaceBootstrapProfileCache(
            rawAgent.workspace,
            manifest.template,
            manifest.rules ?? DEFAULT_WORKSPACE_RULES
          ));
        const manifestAgent = manifest.agents.find((entry) => entry.id === rawAgent.id) ?? null;
        const configuredSkills = filterAgentPolicySkills(configured?.skills ?? []);
        const agentName =
          normalizeOptionalValue(identityOverrides.name) ||
          configured?.name ||
          rawAgent.name ||
          configured?.identity?.name ||
          rawAgent.identityName ||
          rawAgent.id;
        const policy =
          manifestAgent?.policy ??
          resolveAgentPolicy(
            inferAgentPresetFromContext({
              skills: configuredSkills,
              id: rawAgent.id,
              name: agentName
            }),
            {
              fileAccess: configured?.tools?.fs?.workspaceOnly ? "workspace-only" : "extended"
            }
          );
        const configuredTools = uniqueStrings([
          ...(manifestAgent?.toolIds ?? []),
          ...(policy.fileAccess === "workspace-only" ? ["fs.workspaceOnly"] : [])
        ]);
        const primaryModel = rawAgent.model || configured?.model || "unassigned";
        const profile = await readAgentBootstrapProfile(rawAgent.workspace, {
          agentId: rawAgent.id,
          agentName,
          agentDir: rawAgent.agentDir,
          configuredSkills,
          configuredTools,
          template: manifest.template,
          rules: manifest.rules ?? DEFAULT_WORKSPACE_RULES,
          workspaceBootstrapProfile
        });
        const agentRuntimes = runtimes
          .filter((runtime) => runtime.agentId === rawAgent.id)
          .sort(sortRuntimesByUpdatedAtDesc);
        const observedToolNames = uniqueStrings(agentRuntimes.flatMap((runtime) => runtime.toolNames ?? []));
        const activeRuntimeIds = agentRuntimes.map((runtime) => runtime.id);
        const latestRuntime = agentRuntimes[0];
        const lastActiveAt =
          sessionList
            .map((entry) => entry.updatedAt ?? 0)
            .sort((left, right) => right - left)
            .at(0) || null;
        const heartbeat = heartbeatByAgent.get(rawAgent.id);
        const statusValue = resolveAgentStatus({
          rpcOk: Boolean(gatewayStatus?.rpc?.ok),
          activeRuntime: latestRuntime,
          heartbeatEnabled: Boolean(heartbeat?.enabled),
          lastActiveAt
        });

        const agent: OpenClawAgent = {
          id: rawAgent.id,
          name: agentName,
          identityName:
            normalizeOptionalValue(identityOverrides.name) ||
            configured?.identity?.name ||
            rawAgent.identityName ||
            undefined,
          workspaceId,
          workspacePath: rawAgent.workspace,
          agentDir: rawAgent.agentDir,
          modelId: primaryModel,
          isDefault: Boolean(rawAgent.isDefault || configured?.default),
          status: statusValue,
          sessionCount: sessionList.length,
          lastActiveAt,
          currentAction: resolveAgentAction({
            runtime: latestRuntime,
            heartbeatEvery: heartbeat?.every ?? null,
            status: statusValue
          }),
          activeRuntimeIds,
          heartbeat: {
            enabled: Boolean(heartbeat?.enabled),
            every: heartbeat?.every ?? null,
            everyMs: heartbeat?.everyMs ?? null
          },
          identity: {
            emoji:
              normalizeOptionalValue(identityOverrides.emoji) ||
              configured?.identity?.emoji ||
              rawAgent.identityEmoji,
            theme: normalizeOptionalValue(identityOverrides.theme) || configured?.identity?.theme,
            avatar: normalizeOptionalValue(identityOverrides.avatar) || configured?.identity?.avatar,
            source: rawAgent.identitySource
          },
          profile,
          skills: configuredSkills,
          tools: configuredTools,
          observedTools: observedToolNames,
          policy
        };

        const runtimeRelationships = activeRuntimeIds.map((runtimeId) => ({
          id: `edge:${agent.id}:${runtimeId}:run`,
          sourceId: agent.id,
          targetId: runtimeId,
          kind: "active-run" as const,
          label: "runtime"
        })) satisfies RelationshipRecord[];

        const relationships: RelationshipRecord[] = [
          {
            id: `edge:${workspaceId}:${agent.id}:contains`,
            sourceId: workspaceId,
            targetId: agent.id,
            kind: "contains",
            label: "workspace member"
          },
          {
            id: `edge:${agent.id}:${primaryModel}:model`,
            sourceId: agent.id,
            targetId: primaryModel,
            kind: "uses-model",
            label: "model assignment"
          },
          ...runtimeRelationships
        ];

        return {
          agent,
          workspacePath: rawAgent.workspace,
          workspaceId,
          primaryModel,
          sessionCount: sessionList.length,
          activeRuntimeIds,
          relationships
        };
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

        return {
          ...workspace,
          name: manifest?.name ?? workspace.name,
          modelIds: unique(workspace.modelIds),
          activeRuntimeIds: unique(workspace.activeRuntimeIds),
          health: resolveWorkspaceHealth(workspace.agentIds, agents),
          bootstrap: metadata.bootstrap,
          capabilities: metadata.capabilities
        };
      })
    );

    const hiddenWorkspaceIds = new Set(
      workspaces
        .filter((workspace) => manifestByWorkspace.get(workspace.path)?.hidden)
        .map((workspace) => workspace.id)
    );
    const visibleAgents = agents.filter((agent) => !hiddenWorkspaceIds.has(agent.workspaceId));
    const hiddenAgentIds = new Set(
      agents
        .filter((agent) => hiddenWorkspaceIds.has(agent.workspaceId))
        .map((agent) => agent.id)
    );
    const visibleRuntimes = runtimes.filter(
      (runtime) =>
        !(runtime.agentId && hiddenAgentIds.has(runtime.agentId)) &&
        !(runtime.workspaceId && hiddenWorkspaceIds.has(runtime.workspaceId))
    );
    const hiddenRuntimeIds = new Set(
      runtimes
        .filter(
          (runtime) =>
            (runtime.agentId && hiddenAgentIds.has(runtime.agentId)) ||
            (runtime.workspaceId && hiddenWorkspaceIds.has(runtime.workspaceId))
        )
        .map((runtime) => runtime.id)
    );
    const hiddenNodeIds = new Set<string>([
      ...hiddenWorkspaceIds,
      ...hiddenAgentIds,
      ...hiddenRuntimeIds
    ]);
    const visibleRelationships = relationships.filter(
      (relationship) =>
        !hiddenNodeIds.has(relationship.sourceId) &&
        !hiddenNodeIds.has(relationship.targetId)
    );
    const visibleWorkspaces = workspaces.filter((workspace) => !hiddenWorkspaceIds.has(workspace.id));

    const mapModels = (sourceAgents: OpenClawAgent[]) => {
      const modelUsage = new Map<string, number>();
      for (const agent of sourceAgents) {
        modelUsage.set(agent.modelId, (modelUsage.get(agent.modelId) ?? 0) + 1);
      }

      return models.map((model) => ({
        id: model.key,
        name: model.name,
        provider: model.key.split("/")[0] || "unknown",
        input: model.input,
        contextWindow: model.contextWindow,
        local: model.local,
        available: model.available,
        missing: model.missing,
        tags: model.tags,
        usageCount: modelUsage.get(model.key) ?? 0
      })) satisfies ModelRecord[];
    };

    const modelReadiness = resolveModelReadiness(models, modelStatus);

    const securityWarnings =
      status?.securityAudit?.findings
        ?.filter((entry) => entry.severity === "warn")
        .map((entry) => entry.title || entry.detail || "Security warning") ?? [];
    const resolvedStatusVersion = normalizeOptionalValue(
      status?.runtimeVersion || status?.overview?.version || status?.version
    );
    const currentVersion = resolvedStatusVersion ?? (await resolveOpenClawVersion()) ?? undefined;
    const latestVersion = normalizeOptionalValue(status?.update?.registry?.latestVersion ?? undefined);
    const updateError = normalizeUpdateError(status?.update?.registry?.error ?? undefined);
    const updateAvailable =
      currentVersion && latestVersion ? compareVersionStrings(latestVersion, currentVersion) > 0 : undefined;
    const updateInfo = resolveUpdateInfo({
      currentVersion,
      latestVersion,
      updateError,
      legacyInfo: status?.overview?.update
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
    const diagnostics = {
      installed: true,
      loaded: Boolean(gatewayStatus?.service?.loaded),
      rpcOk: Boolean(gatewayStatus?.rpc?.ok),
      health: resolveDiagnosticHealth({
        rpcOk: gatewayStatus?.rpc?.ok,
        warningCount: securityWarnings.length,
        runtimeIssueCount: runtimeDiagnostics.issues.length,
        hasOpenClawSignal
      }),
      version: currentVersion,
      latestVersion,
      updateAvailable,
      updateError,
      updateRoot: normalizeOptionalValue(status?.update?.root ?? undefined),
      updateInstallKind: normalizeOptionalValue(status?.update?.installKind ?? undefined),
      updatePackageManager: normalizeOptionalValue(status?.update?.packageManager ?? undefined),
      workspaceRoot: resolveWorkspaceRoot(configuredWorkspaceRoot),
      configuredWorkspaceRoot: configuredWorkspaceRoot ?? null,
      dashboardUrl: `http://127.0.0.1:${gatewayStatus?.gateway?.port ?? 18789}/`,
      gatewayUrl: gatewayStatus?.gateway?.probeUrl || "ws://127.0.0.1:18789",
      configuredGatewayUrl: configuredGatewayUrl ?? null,
      bindMode: gatewayStatus?.gateway?.bindMode,
      port: gatewayStatus?.gateway?.port,
      updateChannel: status?.updateChannel || "stable",
      updateInfo,
      serviceLabel: gatewayStatus?.service?.label,
      openClawBinarySelection,
      modelReadiness,
      runtime: runtimeDiagnostics,
      commandHistory: getRecentOpenClawCommandDiagnostics(),
      securityWarnings,
      issues: [
        ...collectIssues(
          Object.fromEntries(
            Object.entries(snapshotIssueResults).filter(([, result]) => !isDeferredPayloadResult(result))
          )
        ),
        ...(gatewayStatusResult.status === "rejected" && resolvedGatewayStatus.reusedCachedValue
          ? ["gatewayStatus: Reusing the last successful gateway status after a transient OpenClaw check failure."]
          : []),
        ...[
          describeCachedPayloadReuse("status", resolvedStatus.reusedCachedValue),
          describeCachedPayloadReuse("agents", resolvedAgents.reusedCachedValue),
          describeCachedPayloadReuse("agentConfig", resolvedAgentConfig.reusedCachedValue),
          describeCachedPayloadReuse("models", resolvedModels.reusedCachedValue),
          describeCachedPayloadReuse("modelStatus", resolvedModelStatus.reusedCachedValue),
          describeCachedPayloadReuse("sessions", resolvedSessions.reusedCachedValue),
          describeCachedPayloadReuse("presence", resolvedPresence.reusedCachedValue)
        ].filter((issue): issue is string => Boolean(issue)),
        ...runtimeDiagnostics.issues
      ]
    } satisfies MissionControlSnapshot["diagnostics"];

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
      presence: presence.map((entry) => ({
        host: entry.host,
        ip: entry.ip,
        version: entry.version,
        platform: entry.platform,
        deviceFamily: entry.deviceFamily,
        mode: entry.mode,
        reason: entry.reason,
        text: entry.text,
        ts: entry.ts
      })) as PresenceRecord[],
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
        models: mapModels(agents),
        runtimes,
        tasks,
        relationships
      },
      visible: {
        ...sharedSnapshotFields,
        workspaces: visibleWorkspaces,
        agents: visibleAgents,
        models: mapModels(visibleAgents),
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

function createSnapshotPair(snapshot: MissionControlSnapshot): SnapshotPair {
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
  const runtimeState = await inspectOpenClawRuntimeState(agentId ? [agentId] : [], {
    touch: true
  });

  if (runtimeState.issues.length > 0) {
    snapshotCache = null;
    throw new Error(
      `OpenClaw runtime state is not writable. AgentOS needs write access to ${runtimeState.stateRoot} and the agent session store before missions can run.`
    );
  }
}

export async function ensureOpenClawRuntimeStateAccess(options: {
  agentId?: string | null;
} = {}) {
  await assertOpenClawRuntimeStateAccess(options.agentId ?? null);
  snapshotCache = null;
  return getMissionControlSnapshot({ force: true, includeHidden: true });
}

export async function touchOpenClawRuntimeStateAccess(options: {
  agentId?: string | null;
} = {}) {
  await assertOpenClawRuntimeStateAccess(options.agentId ?? null);
  snapshotCache = null;
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
    const payload = await runOpenClawJson<MissionCommandPayload>(
      [
        "agent",
        "--agent",
        agentId,
        "--message",
        runtimeSmokeTestMessage,
        "--thinking",
        "off",
        "--timeout",
        "45",
        "--json"
      ],
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
    snapshotCache = null;
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
    snapshotCache = null;
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

  const args = [
    "agents",
    "add",
    agentId,
    "--workspace",
    resolvedWorkspacePath,
    "--agent-dir",
    agentDir,
    "--non-interactive",
    "--json"
  ];

  if (input.modelId?.trim()) {
    args.push("--model", input.modelId.trim());
  }

  await runOpenClaw(args);

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
      model: normalizeOptionalValue(input.modelId),
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
    modelId: normalizeOptionalValue(input.modelId),
    isPrimary: false,
    policy,
    channelIds: input.channelIds ?? []
  });

  snapshotCache = null;
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
        ? undefined
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

    snapshotCache = null;

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

  snapshotCache = null;
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

  await runOpenClaw(["agents", "delete", agent.id, "--force", "--json"]);

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

    snapshotCache = null;
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

  snapshotCache = null;
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

  snapshotCache = null;
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

  snapshotCache = null;
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

  snapshotCache = null;
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

  snapshotCache = null;
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

  snapshotCache = null;
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

  snapshotCache = null;
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

    snapshotCache = null;
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
      workspaceModelId: normalized.modelId,
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

  snapshotCache = null;
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

  snapshotCache = null;
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

  snapshotCache = null;
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

  snapshotCache = null;
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
    await runOpenClaw(["agents", "delete", agent.id, "--force", "--json"]);
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
    await runOpenClaw(["config", "set", GATEWAY_REMOTE_URL_CONFIG_KEY, gatewayUrl]);
  } else if (await hasGatewayRemoteUrlConfig()) {
    await runOpenClaw(["config", "unset", GATEWAY_REMOTE_URL_CONFIG_KEY]);
  }

  snapshotCache = null;
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

  snapshotCache = null;
  clearRuntimeHistoryCache();

  return getMissionControlSnapshot({ force: true });
}

function buildOpenClawSessionStorePath(agentId: string) {
  return path.join(openClawStateRootPath, "agents", agentId, "sessions");
}

function formatRuntimeWriteabilityIssue(targetPath: string, error: unknown) {
  if (!error || typeof error !== "object") {
    return `${targetPath}: unknown filesystem error`;
  }

  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : "unknown";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "unknown filesystem error";

  return `${targetPath}: ${code} ${message}`;
}

async function probeDirectoryWriteability(
  targetPath: string,
  options: {
    createIfMissing?: boolean;
    touch?: boolean;
  } = {}
) {
  try {
    if (options.createIfMissing !== false) {
      await mkdir(targetPath, { recursive: true });
    }

    await access(targetPath, fsConstants.R_OK | fsConstants.W_OK);

    if (options.touch) {
      const probeFilePath = path.join(
        targetPath,
        `.agentos-write-check-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      );

      await writeFile(probeFilePath, "", "utf8");
      await rm(probeFilePath, { force: true });
    }

    return {
      writable: true,
      issue: null
    };
  } catch (error) {
    return {
      writable: false,
      issue: formatRuntimeWriteabilityIssue(targetPath, error)
    };
  }
}

async function inspectOpenClawRuntimeState(
  agentIds: string[],
  options: {
    touch?: boolean;
  } = {}
): Promise<OpenClawRuntimeState> {
  const uniqueAgentIds = [...new Set(agentIds.filter(Boolean))];
  const stateRootProbe = await probeDirectoryWriteability(openClawStateRootPath, {
    createIfMissing: true,
    touch: options.touch
  });
  const sessionStores = await Promise.all(
    uniqueAgentIds.map(async (agentId) => {
      const storePath = buildOpenClawSessionStorePath(agentId);
      const probe = await probeDirectoryWriteability(storePath, {
        createIfMissing: true,
        touch: options.touch
      });

      return {
        id: agentId,
        path: storePath,
        writable: probe.writable,
        issue: probe.issue
      };
    })
  );
  const sessionStoreWritable = sessionStores.every((entry) => entry.writable);
  const issues = [
    stateRootProbe.writable
      ? null
      : `OpenClaw state root is not writable. ${stateRootProbe.issue ?? openClawStateRootPath}`,
    ...sessionStores
      .filter((entry) => !entry.writable)
      .map((entry) => `OpenClaw session store for ${entry.id} is not writable. ${entry.issue ?? entry.path}`)
  ].filter((value): value is string => Boolean(value));

  return {
    stateRoot: openClawStateRootPath,
    stateWritable: stateRootProbe.writable,
    sessionStoreWritable: stateRootProbe.writable && sessionStoreWritable,
    sessionStores,
    issues
  };
}

async function readOpenClawRuntimeState(agentIds: string[], force = false) {
  const agentIdsKey = buildRuntimeDiagnosticsAgentKey(agentIds);
  const cached = runtimeDiagnosticsCache;
  const cacheMatches = Boolean(cached && cached.agentIdsKey === agentIdsKey);
  const cacheIsFresh = Boolean(cacheMatches && cached && cached.expiresAt > Date.now());

  if (!force && cacheIsFresh && cached) {
    return cached.value;
  }

  if (!force && cacheMatches && cached) {
    if (!runtimeDiagnosticsPromise) {
      runtimeDiagnosticsPromise = loadRuntimeDiagnosticsStateForCurrentGeneration(agentIds);
      void runtimeDiagnosticsPromise.catch(() => {});
      void runtimeDiagnosticsPromise.finally(() => {
        runtimeDiagnosticsPromise = null;
      }).catch(() => {});
    }

    return cached.value;
  }

  if (!force && runtimeDiagnosticsPromise && cacheMatches && cached) {
    return cached.value;
  }

  if (runtimeDiagnosticsPromise && !force) {
    return runtimeDiagnosticsPromise;
  }

  if (force && runtimeDiagnosticsPromise) {
    return runtimeDiagnosticsPromise;
  }

  runtimeDiagnosticsPromise = loadRuntimeDiagnosticsStateForCurrentGeneration(agentIds);
  void runtimeDiagnosticsPromise.catch(() => {});
  void runtimeDiagnosticsPromise.finally(() => {
    runtimeDiagnosticsPromise = null;
  }).catch(() => {});

  return force ? await runtimeDiagnosticsPromise : runtimeDiagnosticsPromise;
}

async function buildRuntimeDiagnostics(agentIds: string[], settings: MissionControlSettings) {
  const runtimeState = await readOpenClawRuntimeState(agentIds);
  const smokeTest = getLatestRuntimeSmokeTest(settings);
  const issues = [
    ...runtimeState.issues,
    ...(smokeTest.status === "failed" && smokeTest.error
      ? [
          `Latest runtime smoke test failed for ${smokeTest.agentId ?? "unknown agent"}. ${smokeTest.error}`
        ]
      : [])
  ];

  return {
    ...runtimeState,
    smokeTest,
    issues
  } satisfies MissionControlSnapshot["diagnostics"]["runtime"];
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _createBootstrappedWorkspaceAgent(params: {
  workspacePath: string;
  workspaceSlug: string;
  workspaceModelId?: string;
  agent: WorkspaceAgentBlueprintInput;
}) {
  const agentId = createWorkspaceAgentId(params.workspaceSlug, params.agent.id);
  const modelId =
    normalizeOptionalValue(params.agent.modelId) ?? normalizeOptionalValue(params.workspaceModelId);
  const policy = resolveAgentPolicy(
    params.agent.policy?.preset ?? inferAgentPresetFromContext({
      skills: params.agent.skillId ? [params.agent.skillId] : [],
      id: agentId,
      name: params.agent.name
    }),
    params.agent.policy
  );
  const args = [
    "agents",
    "add",
    agentId,
    "--workspace",
    params.workspacePath,
    "--agent-dir",
    buildWorkspaceAgentStatePath(params.workspacePath, agentId),
    "--non-interactive",
    "--json"
  ];

  if (modelId) {
    args.push("--model", modelId);
  }

  await runOpenClaw(args);

  const policySkillId = await ensureAgentPolicySkill({
    workspacePath: params.workspacePath,
    agentId,
    agentName: params.agent.name,
    policy
  });

  const configEntry = await upsertAgentConfigEntry(agentId, params.workspacePath, {
    name: normalizeOptionalValue(params.agent.name),
    model: modelId,
    heartbeat: serializeHeartbeatConfig(params.agent.heartbeat),
    skills: [normalizeOptionalValue(params.agent.skillId), policySkillId].filter((value): value is string => Boolean(value)),
    tools: policy.fileAccess === "workspace-only"
      ? {
          fs: {
            workspaceOnly: true
          }
        }
      : null
  });

  await applyAgentIdentity(agentId, params.workspacePath, {
    name: normalizeOptionalValue(params.agent.name) ?? configEntry.name,
    emoji: normalizeOptionalValue(params.agent.emoji),
    theme: normalizeOptionalValue(params.agent.theme)
  }, buildWorkspaceAgentStatePath(params.workspacePath, agentId));

  return agentId;
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

  const result = await runOpenClawJsonStream<MissionCommandPayload>(
    [
      "agent",
      "--agent",
      params.agentId,
      "--message",
      prompt,
      "--thinking",
      thinking,
      "--timeout",
      "90",
      "--json"
    ],
    {
      timeoutMs: 120000,
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
    }
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

type TelegramCoordinationChannelSummary = {
  channelId: string;
  channelName: string;
  groups: Array<{ chatId: string; title: string | null }>;
  peers: Array<{ agentId: string; name: string; summary: string }>;
};

type TelegramOwnedGroupSummary = {
  channelId: string;
  channelName: string;
  chatId: string;
  title: string | null;
  primaryAgentId: string;
  primaryAgentName: string;
  peers: Array<{ agentId: string; name: string; summary: string }>;
};

type TelegramCoordinationContext = {
  primaryChannels: TelegramCoordinationChannelSummary[];
  ownedGroups: TelegramOwnedGroupSummary[];
  delegateChannels: Array<
    TelegramCoordinationChannelSummary & {
      primaryAgentId: string;
      primaryAgentName: string;
    }
  >;
};

type WorkspaceTeamMemberSummary = {
  agentId: string;
  name: string;
  role: string;
  isPrimary: boolean;
  isCurrent: boolean;
};

type WorkspaceTeamContext = {
  members: WorkspaceTeamMemberSummary[];
};

async function ensureAgentPolicySkill(params: {
  workspacePath: string;
  agentId: string;
  agentName: string;
  policy: AgentPolicy;
  setupAgentId?: string | null;
  snapshot?: MissionControlSnapshot;
  channelRegistry?: ChannelRegistry;
}) {
  const skillId = buildAgentPolicySkillId(params.agentId);
  await ensureTelegramDelegationHelper(params.workspacePath);
  const team = await buildWorkspaceTeamContext(
    params.workspacePath,
    params.agentId,
    params.snapshot ?? null
  );
  const coordination = buildTelegramCoordinationContext(
    params.agentId,
    params.snapshot ?? null,
    params.channelRegistry ?? params.snapshot?.channelRegistry ?? null
  );
  await writeTextFileEnsured(
    path.join(params.workspacePath, "skills", skillId, "SKILL.md"),
    `${renderAgentPolicySkillMarkdown(params.agentName, params.policy, params.setupAgentId, team, coordination)}\n`
  );
  return skillId;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
async function _ensureWorkspaceSkillMarkdown(workspacePath: string, skillId: string) {
  const [knownSkillId] = filterKnownOpenClawSkillIds([skillId]);

  if (!knownSkillId) {
    return;
  }

  const skillPath = path.join(workspacePath, "skills", skillId);
  await mkdir(skillPath, { recursive: true });
  await writeTextFileIfMissing(
    path.join(skillPath, "SKILL.md"),
    `${renderSkillMarkdown(knownSkillId, formatCapabilityLabel(knownSkillId))}\n`
  );
}

async function ensureTelegramDelegationHelper(workspacePath: string) {
  const helperPath = path.join(workspacePath, ".openclaw", "tools", "telegram-delegate-agent.mjs");
  await writeTextFileEnsured(helperPath, `${renderTelegramDelegationHelperScript()}\n`);
}

function formatTelegramGroupReference(group: { chatId: string; title: string | null }) {
  return group.title && group.title !== group.chatId ? `${group.title} (\`${group.chatId}\`)` : `\`${group.chatId}\``;
}

function describeTelegramAgentCapability(agent: OpenClawAgent | null) {
  if (!agent) {
    return "no capability snapshot";
  }

  const parts: string[] = [formatAgentPresetLabel(agent.policy.preset)];

  const purpose = agent.profile.purpose?.trim();
  if (purpose) {
    parts.push(purpose);
  }

  const skills = uniqueStrings(agent.skills).slice(0, 2);
  if (skills.length > 0) {
    parts.push(`skills: ${skills.join(", ")}`);
  }

  const tools = uniqueStrings(agent.tools).slice(0, 2);
  if (tools.length > 0) {
    parts.push(`tools: ${tools.join(", ")}`);
  }

  return parts.join(" · ");
}

function buildTelegramCoordinationContext(
  agentId: string,
  snapshot: MissionControlSnapshot | null,
  registry: ChannelRegistry | null
): TelegramCoordinationContext | null {
  if (!registry) {
    return null;
  }

  const agentNameById = new Map(
    snapshot?.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]) ?? []
  );
  const agentById = new Map(snapshot?.agents.map((agent) => [agent.id, agent]) ?? []);
  const currentAgent = agentById.get(agentId) ?? null;
  const currentWorkspaceId = currentAgent?.workspaceId ?? null;
  const primaryChannels: TelegramCoordinationChannelSummary[] = [];
  const ownedGroups: TelegramOwnedGroupSummary[] = [];
  const delegateChannels: Array<
    TelegramCoordinationChannelSummary & {
      primaryAgentId: string;
      primaryAgentName: string;
    }
  > = [];

  for (const channel of registry.channels.filter((entry) => entry.type === "telegram")) {
    const workspaceBindings = channel.workspaces.filter((workspace) => workspace.workspaceId === currentWorkspaceId);

    if (workspaceBindings.length === 0) {
      continue;
    }

    const groups = uniqueByChatId(
      workspaceBindings.flatMap((workspace) =>
        workspace.groupAssignments.filter((assignment) => assignment.enabled !== false)
      )
    ).map((assignment) => ({
      chatId: assignment.chatId,
      title: assignment.title ?? null
    }));
    const ownedAssignments = uniqueByChatId(
      workspaceBindings.flatMap((workspace) =>
        workspace.groupAssignments.filter(
          (assignment) => assignment.enabled !== false && assignment.agentId === agentId
        )
      )
    );
    const fallbackGroups = groups.filter(
      (group) =>
        !ownedAssignments.some((assignment) => assignment.chatId === group.chatId) &&
        !workspaceBindings.some((workspace) =>
          workspace.groupAssignments.some(
            (assignment) => assignment.enabled !== false && assignment.chatId === group.chatId && assignment.agentId
          )
        )
    );

    if (channel.primaryAgentId === agentId) {
      const peers = uniqueStrings(
        workspaceBindings.flatMap((workspace) => workspace.agentIds.filter((candidate) => candidate !== agentId))
      ).map((peerId) => {
        const peer = agentById.get(peerId) ?? null;
        return {
          agentId: peerId,
          name: agentNameById.get(peerId) ?? peerId,
          summary: describeTelegramAgentCapability(peer)
        };
      });

      primaryChannels.push({
        channelId: channel.id,
        channelName: channel.name,
        groups: fallbackGroups,
        peers
      });
    }

    for (const assignment of ownedAssignments) {
      const peers = uniqueStrings(
        workspaceBindings.flatMap((workspace) =>
          workspace.agentIds.filter((candidate) => candidate !== agentId && candidate !== channel.primaryAgentId)
        )
      ).map((peerId) => {
        const peer = agentById.get(peerId) ?? null;
        return {
          agentId: peerId,
          name: agentNameById.get(peerId) ?? peerId,
          summary: describeTelegramAgentCapability(peer)
        };
      });

      ownedGroups.push({
        channelId: channel.id,
        channelName: channel.name,
        chatId: assignment.chatId,
        title: assignment.title ?? null,
        primaryAgentId: channel.primaryAgentId ?? "",
        primaryAgentName: channel.primaryAgentId ? agentNameById.get(channel.primaryAgentId) ?? channel.primaryAgentId : "Unset",
        peers
      });
    }

    if (channel.primaryAgentId && channel.primaryAgentId !== agentId && ownedAssignments.length === 0) {
      delegateChannels.push({
        channelId: channel.id,
        channelName: channel.name,
        groups: fallbackGroups,
        peers: uniqueStrings(
          workspaceBindings.flatMap((workspace) =>
            workspace.agentIds.filter((candidate) => candidate !== channel.primaryAgentId && candidate !== agentId)
          )
        ).map((peerId) => {
          const peer = agentById.get(peerId) ?? null;
          return {
            agentId: peerId,
            name: agentNameById.get(peerId) ?? peerId,
            summary: describeTelegramAgentCapability(peer)
          };
        }),
        primaryAgentId: channel.primaryAgentId,
        primaryAgentName: agentNameById.get(channel.primaryAgentId) ?? channel.primaryAgentId
      });
    }
  }

  if (primaryChannels.length === 0 && delegateChannels.length === 0) {
    if (ownedGroups.length === 0) {
      return null;
    }
  }

  return {
    primaryChannels: primaryChannels.sort((left, right) => left.channelName.localeCompare(right.channelName)),
    ownedGroups: ownedGroups.sort((left, right) => {
      const leftLabel = `${left.channelName}:${left.title ?? left.chatId}`;
      const rightLabel = `${right.channelName}:${right.title ?? right.chatId}`;
      return leftLabel.localeCompare(rightLabel);
    }),
    delegateChannels: delegateChannels.sort((left, right) => left.channelName.localeCompare(right.channelName))
  };
}

function renderTelegramCoordinationMarkdown(coordination: TelegramCoordinationContext | null | undefined) {
  if (
    !coordination ||
    (coordination.primaryChannels.length === 0 &&
      coordination.ownedGroups.length === 0 &&
      coordination.delegateChannels.length === 0)
  ) {
    return null;
  }

  const lines: string[] = ["## Telegram coordination"];

  lines.push(
    "- Telegram credentials are managed by OpenClaw for the listed channels. Do not ask the operator for `TELEGRAM_BOT_TOKEN` or `channels.telegram.botToken` when sending to listed groups."
  );
  lines.push(
    '- To send or post, call the `message` tool with `action: "send"`, `channel: "telegram"`, `target: "<chatId>"`, and the exact message text. Use the listed chat id as `target`.'
  );
  lines.push("- If sending fails, report the actual tool error instead of inventing a missing-token error.");

  if (coordination.primaryChannels.length > 0) {
    lines.push("- You are the public Telegram fallback for these channels:");
    for (const channel of coordination.primaryChannels) {
      const groupSummary =
        channel.groups.length > 0
          ? channel.groups.map(formatTelegramGroupReference).join(", ")
          : "no allowed groups yet";
      lines.push(`  - ${channel.channelName} (\`${channel.channelId}\`) · fallback groups: ${groupSummary}.`);
      if (channel.peers.length > 0) {
        lines.push("  - Internal assistants:");
        for (const peer of channel.peers) {
          lines.push(`    - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- Keep public Telegram replies under your own voice for unassigned groups, even when you ask another agent for help.");
    lines.push("- For specialist help, call another agent from the workspace terminal with:");
    lines.push("```bash");
    lines.push('node .openclaw/tools/telegram-delegate-agent.mjs --agent <delegate-agent-id> --message "Summarize what I need from you"');
    lines.push("```");
    lines.push("- Use delegate turns for internal research, drafting, or analysis only. Do not ask them to answer Telegram directly.");
    lines.push("- After a delegate responds, decide what to share publicly and send the final Telegram reply yourself.");
  }

  if (coordination.ownedGroups.length > 0) {
    lines.push("- You are the public Telegram voice for these assigned groups:");
    for (const group of coordination.ownedGroups) {
      lines.push(
        `  - ${group.channelName} (\`${group.channelId}\`) · ${group.title ?? group.chatId} (\`${group.chatId}\`) · primary ${group.primaryAgentName} (\`${group.primaryAgentId}\`).`
      );
      if (group.peers.length > 0) {
        lines.push("  - Internal assistants for this group:");
        for (const peer of group.peers) {
          lines.push(`    - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- Reply directly to those groups as the public voice. Use other agents only for internal help.");
  }

  if (coordination.delegateChannels.length > 0) {
    lines.push("- You can assist these Telegram admin channels when the primary agent asks:");
    for (const channel of coordination.delegateChannels) {
      const groupSummary =
        channel.groups.length > 0
          ? channel.groups.map(formatTelegramGroupReference).join(", ")
          : "no allowed groups yet";
      lines.push(
        `  - ${channel.channelName} (\`${channel.channelId}\`) · primary ${channel.primaryAgentName} (\`${channel.primaryAgentId}\`) · groups: ${groupSummary}.`
      );
      if (channel.peers.length > 0) {
        lines.push("    - Nearby assistants:");
        for (const peer of channel.peers) {
          lines.push(`      - ${peer.name} (\`${peer.agentId}\`) · ${peer.summary}.`);
        }
      }
    }
    lines.push("- When helping with Telegram work for groups not assigned to you, return concise internal findings or draft language. Do not speak as the public Telegram agent for those unassigned groups.");
  }

  return lines.join("\n");
}

function renderTelegramDelegationHelperScript() {
  return String.raw`#!/usr/bin/env node
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

function parseArgs(argv) {
  const options = {
    agentId: "",
    message: "",
    thinking: "low",
    json: false,
    stdin: false
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--agent") {
      options.agentId = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--message") {
      options.message = argv[index + 1] ?? "";
      index += 1;
      continue;
    }

    if (arg === "--thinking") {
      options.thinking = argv[index + 1] ?? "low";
      index += 1;
      continue;
    }

    if (arg === "--json") {
      options.json = true;
      continue;
    }

    if (arg === "--stdin") {
      options.stdin = true;
      continue;
    }
  }

  return options;
}

function usage() {
  process.stderr.write(
    "Usage: node .openclaw/tools/telegram-delegate-agent.mjs --agent <id> --message <text> [--thinking low|medium|high] [--json]\n"
  );
}

function extractText(payload) {
  if (!payload || typeof payload !== "object") {
    return "";
  }

  if (typeof payload.summary === "string" && payload.summary.trim()) {
    return payload.summary.trim();
  }

  if (Array.isArray(payload.payloads)) {
    for (const entry of payload.payloads) {
      if (entry && typeof entry === "object") {
        if (typeof entry.text === "string" && entry.text.trim()) {
          return entry.text.trim();
        }

        if (typeof entry.content === "string" && entry.content.trim()) {
          return entry.content.trim();
        }
      }
    }
  }

  if (payload.result && typeof payload.result === "object") {
    return extractText(payload.result);
  }

  return "";
}

async function readStdin() {
  const chunks = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk)));
  }
  return Buffer.concat(chunks).toString("utf8").trim();
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.stdin) {
    options.message = await readStdin();
  }

  if (!options.agentId || !options.message.trim()) {
    usage();
    process.exit(1);
  }

  const args = [
    "agent",
    "--agent",
    options.agentId,
    "--message",
    options.message.trim(),
    "--thinking",
    options.thinking,
    "--json"
  ];

  try {
    const { stdout } = await execFileAsync("openclaw", args, {
      cwd: process.cwd(),
      maxBuffer: 4 * 1024 * 1024
    });
    const parsed = JSON.parse(stdout);

    if (options.json) {
      process.stdout.write(JSON.stringify(parsed, null, 2) + "\n");
      return;
    }

    const text = extractText(parsed);
    process.stdout.write((text || JSON.stringify(parsed, null, 2)) + "\n");
  } catch (error) {
    const message =
      error && typeof error === "object" && "stderr" in error && typeof error.stderr === "string"
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : "Telegram delegation failed.";
    process.stderr.write(String(message) + "\n");
    process.exit(1);
  }
}

await main();
`;
}

async function buildWorkspaceTeamContext(
  workspacePath: string,
  agentId: string,
  snapshot: MissionControlSnapshot | null
): Promise<WorkspaceTeamContext | null> {
  if (!snapshot) {
    return null;
  }

  const currentAgent = snapshot.agents.find((entry) => entry.id === agentId);

  if (!currentAgent) {
    return null;
  }

  const manifest = await readWorkspaceProjectManifest(workspacePath);
  const manifestAgentById = new Map(manifest.agents.map((entry) => [entry.id, entry]));
  const members = snapshot.agents
    .filter((entry) => entry.workspaceId === currentAgent.workspaceId)
    .sort((left, right) => {
      if (left.id === agentId && right.id !== agentId) {
        return -1;
      }

      if (right.id === agentId && left.id !== agentId) {
        return 1;
      }

      const leftManifest = manifestAgentById.get(left.id);
      const rightManifest = manifestAgentById.get(right.id);
      const leftPrimary = leftManifest?.isPrimary ?? false;
      const rightPrimary = rightManifest?.isPrimary ?? false;

      if (leftPrimary !== rightPrimary) {
        return leftPrimary ? -1 : 1;
      }

      return formatAgentDisplayName(left).localeCompare(formatAgentDisplayName(right));
    })
    .map((entry) => {
      const manifestAgent = manifestAgentById.get(entry.id);

      return {
        agentId: entry.id,
        name: formatAgentDisplayName(entry),
        role: manifestAgent?.role?.trim() || formatAgentPresetLabel(entry.policy.preset),
        isPrimary: manifestAgent?.isPrimary ?? false,
        isCurrent: entry.id === agentId
      } satisfies WorkspaceTeamMemberSummary;
    });

  return members.length > 0 ? { members } : null;
}

function renderWorkspaceTeamMarkdown(team: WorkspaceTeamContext | null | undefined) {
  if (!team || team.members.length === 0) {
    return null;
  }

  const lines = [
    "## Workspace team",
    "- This workspace currently includes these agents. Do not assume you are the only agent unless you verify the roster again.",
    "- Use these exact agent ids when referring to teammates or handing work off:"
  ];

  for (const member of team.members) {
    const labels = [
      member.isCurrent ? "you" : null,
      member.isPrimary ? "primary" : null,
      member.role
    ].filter((value): value is string => Boolean(value));

    lines.push(`- ${member.name} (\`${member.agentId}\`) · ${labels.join(" · ")}.`);
  }

  lines.push(
    "- If you are asked who is in this workspace, answer from this roster or re-check `.openclaw/project.json` before replying."
  );

  return lines.join("\n");
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

function renderAgentPolicySkillMarkdown(
  agentName: string,
  policy: AgentPolicy,
  setupAgentId?: string | null,
  team?: WorkspaceTeamContext | null,
  coordination?: TelegramCoordinationContext | null
) {
  const presetLabel = formatAgentPresetLabel(policy.preset);
  const teamSection = renderWorkspaceTeamMarkdown(team);
  const coordinationSection = renderTelegramCoordinationMarkdown(coordination);

  return `# ${agentName} Policy

Preset: ${presetLabel}

## Output routing
- Final deliverables belong in the current deliverables run folder for the task.
- Keep temporary notes and durable workspace memory inside memory/.
- Treat MEMORY.md, memory/*.md, docs/brief.md, docs/architecture.md, and any template-specific docs under docs/ as shared workspace context before large edits.
- Avoid writing final artifacts to the workspace root unless the task explicitly asks for it.

## Operating rules
${buildAgentPolicyPromptLines(policy, setupAgentId)
  .map((line) => line.replace(/^- /, "- "))
  .join("\n")}
${teamSection ? `\n\n${teamSection}` : ""}${coordinationSection ? `\n\n${coordinationSection}` : ""}
`;
}

function workspaceIdFromPath(workspacePath: string) {
  const hash = createHash("sha1").update(workspacePath).digest("hex").slice(0, 8);
  return `workspace:${hash}`;
}

async function readAgentBootstrapProfile(
  workspacePath: string,
  options: {
    agentId: string;
    agentName: string;
    agentDir?: string;
    configuredSkills: string[];
    configuredTools: string[];
    template?: WorkspaceTemplate | null;
    rules?: WorkspaceCreateRules;
    workspaceBootstrapProfile?: WorkspaceBootstrapProfileCache;
  }
): Promise<AgentBootstrapProfile> {
  const workspaceBootstrapProfile =
    options.workspaceBootstrapProfile ??
    (await buildWorkspaceBootstrapProfileCache(
      workspacePath,
      options.template,
      options.rules
    ));
  const profileFiles = workspaceBootstrapProfile.profileFiles;
  const contextManifest = workspaceBootstrapProfile.contextManifest;
  const sections = new Map(workspaceBootstrapProfile.workspaceSections);
  const sources = [...workspaceBootstrapProfile.workspaceSources];
  const agentDir = normalizeOptionalValue(options.agentDir);

  if (agentDir) {
    const agentEntries = await Promise.all(
      profileFiles.map((fileName) => readBootstrapProfileFile(agentDir, workspacePath, fileName))
    );

    for (const entry of agentEntries) {
      if (!entry) {
        continue;
      }

      sources.push(entry.source);
      sections.set(entry.fileName, entry.lines);
    }
  }

  const purpose =
    extractPurpose(sections) ??
    inferPurposeFromConfig({
      agentId: options.agentId,
      agentName: options.agentName,
      skills: options.configuredSkills
    });
  const operatingInstructions = collectBulletSections(sections, [
    { file: "AGENTS.md", heading: "Safety defaults" },
    { file: "AGENTS.md", heading: "Daily memory" },
    { file: "AGENTS.md", heading: "Output" },
    { file: "SOUL.md", heading: "How I Operate" },
    { file: "TOOLS.md", heading: "Examples" },
    { file: "MEMORY.md", heading: "Stable facts" },
    { file: "memory/blueprint.md", heading: "Constraints" },
    { file: "memory/blueprint.md", heading: "Unknowns" },
    { file: "docs/brief.md", heading: "Success signals" },
    { file: "docs/brief.md", heading: "Open questions" },
    { file: "docs/architecture.md", heading: "Dependencies" },
    { file: "docs/architecture.md", heading: "Risks" },
    { file: "deliverables/README.md", heading: "Deliverables" },
    ...contextManifest.resources
      .filter((spec) => spec.relativePath.startsWith("docs/") && spec.relativePath !== "docs/brief.md" && spec.relativePath !== "docs/architecture.md")
      .flatMap((spec) => spec.headings.map((heading) => ({ file: spec.relativePath, heading })))
  ]).slice(0, 8);
  const responseStyle =
    uniqueStrings([
      ...extractInlineList(sections.get("IDENTITY.md"), "Vibe"),
      ...extractBulletSection(sections.get("SOUL.md"), "My Quirks"),
      ...extractBulletSection(sections.get("SOUL.md"), "How I Operate")
    ]).slice(0, 6) || [];
  const outputPreference =
    extractOutputPreference(sections.get("AGENTS.md")) ??
    extractOutputPreference(sections.get("deliverables/README.md")) ??
    inferOutputPreference(options.configuredTools);

  return {
    purpose,
    operatingInstructions:
      operatingInstructions.length > 0 ? operatingInstructions : inferOperatingInstructions(options.configuredTools),
    responseStyle,
    outputPreference,
    sourceFiles: sources
  };
}

function describeBootstrapSourcePath(workspacePath: string, filePath: string) {
  const resolvedWorkspacePath = path.resolve(workspacePath);
  const resolvedFilePath = path.resolve(filePath);

  if (
    resolvedFilePath === resolvedWorkspacePath ||
    resolvedFilePath.startsWith(`${resolvedWorkspacePath}${path.sep}`)
  ) {
    return path.relative(resolvedWorkspacePath, resolvedFilePath) || path.basename(resolvedFilePath);
  }

  return resolvedFilePath;
}

async function readWorkspaceInspectorMetadata(
  workspacePath: string,
  agents: OpenClawAgent[],
  projectMeta?: WorkspaceProjectManifest
): Promise<Pick<WorkspaceProject, "bootstrap" | "capabilities">> {
  const resolvedProjectMeta = projectMeta ?? (await readWorkspaceProjectManifest(workspacePath));
  const contextManifest = buildWorkspaceContextManifest(
    resolvedProjectMeta.template ?? null,
    resolvedProjectMeta.rules ?? DEFAULT_WORKSPACE_RULES
  );
  const nonContextPaths = new Set<string>([
    ...WORKSPACE_CONTEXT_CORE_PATHS,
    ...WORKSPACE_CONTEXT_OPTIONAL_PATHS
  ]);
  const [coreFiles, optionalFiles, contextFiles, folders, projectShell, localSkillIds] = await Promise.all([
    collectWorkspaceResourceState(workspacePath, [
      { id: "agents", label: "AGENTS.md", relativePath: "AGENTS.md", kind: "file" },
      { id: "soul", label: "SOUL.md", relativePath: "SOUL.md", kind: "file" },
      { id: "identity", label: "IDENTITY.md", relativePath: "IDENTITY.md", kind: "file" },
      { id: "tools", label: "TOOLS.md", relativePath: "TOOLS.md", kind: "file" },
      { id: "heartbeat", label: "HEARTBEAT.md", relativePath: "HEARTBEAT.md", kind: "file" }
    ]),
    collectWorkspaceResourceState(workspacePath, [
      { id: "memory-md", label: "MEMORY.md", relativePath: "MEMORY.md", kind: "file" }
    ]),
    collectWorkspaceResourceState(
      workspacePath,
      contextManifest.resources.filter((resource) => !nonContextPaths.has(resource.relativePath))
    ),
    collectWorkspaceResourceState(workspacePath, [
      { id: "docs", label: "docs/", relativePath: "docs", kind: "directory" },
      { id: "memory", label: "memory/", relativePath: "memory", kind: "directory" },
      { id: "deliverables", label: "deliverables/", relativePath: "deliverables", kind: "directory" },
      { id: "skills", label: "skills/", relativePath: "skills", kind: "directory" },
      { id: "openclaw", label: ".openclaw/", relativePath: ".openclaw", kind: "directory" }
    ]),
    collectWorkspaceResourceState(workspacePath, [
      {
        id: "project-json",
        label: ".openclaw/project.json",
        relativePath: ".openclaw/project.json",
        kind: "file"
      },
      {
        id: "events",
        label: ".openclaw/project-shell/events.jsonl",
        relativePath: ".openclaw/project-shell/events.jsonl",
        kind: "file"
      },
      {
        id: "runs",
        label: ".openclaw/project-shell/runs",
        relativePath: ".openclaw/project-shell/runs",
        kind: "directory"
      },
      {
        id: "tasks",
        label: ".openclaw/project-shell/tasks",
        relativePath: ".openclaw/project-shell/tasks",
        kind: "directory"
      }
    ]),
    listLocalWorkspaceSkills(workspacePath)
  ]);
  const tools = uniqueStrings(agents.flatMap((agent) => agent.tools));
  const skills = uniqueStrings([...localSkillIds, ...agents.flatMap((agent) => agent.skills)]);
  const workspaceOnlyAgentCount = agents.filter((agent) => agent.tools.includes("fs.workspaceOnly")).length;

  return {
    bootstrap: {
      template: resolvedProjectMeta.template,
      sourceMode: resolvedProjectMeta.sourceMode,
      agentTemplate: resolvedProjectMeta.agentTemplate,
      coreFiles,
      optionalFiles,
      contextFiles,
      folders,
      projectShell,
      localSkillIds
    },
    capabilities: {
      skills,
      tools,
      workspaceOnlyAgentCount
    }
  };
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
        runOpenClawJson<Record<string, unknown>>(["config", "get", configPath, "--json"]).catch(() => null)
      );
      const currentHooksConfig = await measureTiming(timings, "managed-surface.gmail.read-hooks", () =>
        runOpenClawJson<Record<string, unknown>>(["config", "get", "hooks", "--json"]).catch(() => null)
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
        runOpenClaw(["config", "set", "hooks", JSON.stringify(nextHooksConfig), "--strict-json"], {
          timeoutMs: 60000
        })
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
        runOpenClaw(["config", "set", configPath, JSON.stringify(nextConfig), "--strict-json"], {
          timeoutMs: 60000
        })
      );
      break;
    }
    case "webhook": {
      const currentConfig = await measureTiming(timings, "managed-surface.webhook.read-config", () =>
        runOpenClawJson<Record<string, unknown>>(["config", "get", configPath, "--json"]).catch(() => null)
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
        runOpenClaw(["config", "set", configPath, JSON.stringify(nextConfig), "--strict-json"], {
          timeoutMs: 60000
        })
      );
      break;
    }
    case "cron": {
      const currentConfig = await measureTiming(timings, "managed-surface.cron.read-config", () =>
        runOpenClawJson<Record<string, unknown>>(["config", "get", configPath, "--json"]).catch(() => null)
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
        runOpenClaw(["config", "set", configPath, JSON.stringify(nextConfig), "--strict-json"], {
          timeoutMs: 60000
        })
      );
      break;
    }
    case "email": {
      const currentConfig = await measureTiming(timings, "managed-surface.email.read-config", () =>
        runOpenClawJson<Record<string, unknown>>(["config", "get", configPath, "--json"]).catch(() => null)
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
        runOpenClaw(["config", "set", configPath, JSON.stringify(nextConfig), "--strict-json"], {
          timeoutMs: 60000
        })
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
    runOpenClawJson<unknown[]>(["config", "get", "bindings", "--json"]).catch(() => [])
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
    runOpenClaw(["config", "set", "bindings", JSON.stringify(nextBindings), "--strict-json"])
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
    runOpenClaw([
      "config",
      "set",
      "channels.telegram.enabled",
      managedChannels.length > 0 ? "true" : "false",
      "--strict-json"
    ])
  );

  const defaultAccountId = await measureTiming(timings, "telegram-settings.default-account-resolve", () =>
    resolveManagedTelegramDefaultAccountId(managedChannels, timings)
  );

  if (defaultAccountId) {
    await measureTiming(timings, "telegram-settings.default-account", () =>
      runOpenClaw([
        "config",
        "set",
        "channels.telegram.defaultAccount",
        JSON.stringify(defaultAccountId),
        "--strict-json"
      ])
    );
  } else {
    await measureTiming(timings, "telegram-settings.default-account-unset", () =>
      runOpenClaw(["config", "unset", "channels.telegram.defaultAccount"]).catch(() => {})
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
    runOpenClaw([
      "config",
      "set",
      "channels.telegram.groups",
      JSON.stringify(nextGroupsConfig),
      "--strict-json"
    ])
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
    runOpenClawJson<DiscordGuildConfig>(["config", "get", "channels.discord.guilds", "--json"]).catch(() => ({}))
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
    runOpenClaw([
      "config",
      "set",
      "channels.discord.guilds",
      JSON.stringify(nextGuilds),
      "--strict-json"
    ])
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
  snapshotCache = null;
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

function collectBulletSections(
  sections: Map<string, string[]>,
  entries: Array<{ file: string; heading: string }>
) {
  return uniqueStrings(entries.flatMap((entry) => extractBulletSection(sections.get(entry.file), entry.heading)));
}

function extractPurpose(sections: Map<string, string[]>) {
  const workspaceObjective =
    extractSectionParagraph(sections.get("docs/brief.md"), "Objective") ??
    extractSectionParagraph(sections.get("memory/blueprint.md"), "Outcome") ??
    extractSectionParagraph(sections.get("MEMORY.md"), "Current brief") ??
    extractSectionParagraph(sections.get("SOUL.md"), "My Purpose") ??
    extractSectionParagraph(sections.get("IDENTITY.md"), "Role") ??
    extractSectionParagraph(sections.get("AGENTS.md"), "Customize");

  if (workspaceObjective) {
    return workspaceObjective;
  }

  return null;
}

function extractOutputPreference(lines?: string[]) {
  if (!lines) {
    return null;
  }

  const match = lines.find((line) =>
    /be concise in chat|write longer output to files|output/i.test(line)
  );

  return match ? cleanMarkdown(match) : null;
}

function inferPurposeFromConfig({
  agentId,
  agentName,
  skills
}: {
  agentId: string;
  agentName: string;
  skills: string[];
}) {
  if (skills.length > 0) {
    return `${agentName} specializes in ${skills.join(", ")} workflows inside the attached workspace.`;
  }

  if (/dev|build|coder|engineer/i.test(agentId)) {
    return `${agentName} is configured as a development-focused OpenClaw operator for this workspace.`;
  }

  if (/review/i.test(agentId)) {
    return `${agentName} is configured to review work and surface quality risks for this workspace.`;
  }

  if (/test/i.test(agentId)) {
    return `${agentName} is configured to validate behavior, testing, and runtime quality for this workspace.`;
  }

  return `${agentName} is a general-purpose OpenClaw operator attached to this workspace.`;
}

function inferOperatingInstructions(configuredTools: string[]) {
  if (configuredTools.includes("fs.workspaceOnly")) {
    return ["Operate within the attached workspace and avoid spilling changes outside it."];
  }

  return ["No explicit operating instructions were found in workspace bootstrap files."];
}

function inferOutputPreference(configuredTools: string[]) {
  if (configuredTools.includes("fs.workspaceOnly")) {
    return "Prefer workspace-grounded output tied to real project files and artifacts.";
  }

  return null;
}

function extractSectionParagraph(lines: string[] | undefined, heading: string) {
  if (!lines) {
    return null;
  }

  const start = lines.findIndex((line) => normalizeHeading(line) === normalizeHeading(heading));
  if (start === -1) {
    return null;
  }

  const collected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line) {
      if (collected.length > 0) {
        break;
      }
      continue;
    }

    if (/^#+\s+/.test(line)) {
      break;
    }

    if (/^[-*]\s+/.test(line)) {
      break;
    }

    collected.push(cleanMarkdown(line));
    if (collected.length >= 2) {
      break;
    }
  }

  return collected.length > 0 ? collected.join(" ") : null;
}

function extractBulletSection(lines: string[] | undefined, heading: string) {
  if (!lines) {
    return [];
  }

  const start = lines.findIndex((line) => normalizeHeading(line) === normalizeHeading(heading));
  if (start === -1) {
    return [];
  }

  const bullets: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index].trim();

    if (!line && bullets.length > 0) {
      break;
    }

    if (/^#+\s+/.test(line)) {
      break;
    }

    if (/^[-*]\s+/.test(line)) {
      bullets.push(cleanMarkdown(line.replace(/^[-*]\s+/, "")));
      continue;
    }

    if (bullets.length > 0) {
      break;
    }
  }

  return bullets;
}

function extractInlineList(lines: string[] | undefined, label: string) {
  if (!lines) {
    return [];
  }

  const entry = lines.find((line) => line.toLowerCase().includes(`**${label.toLowerCase()}:**`));
  if (!entry) {
    return [];
  }

  const [, rawValue = ""] = entry.split(":");
  return rawValue
    .split(",")
    .map((item) => cleanMarkdown(item))
    .filter(Boolean);
}

function normalizeHeading(line: string) {
  return line.replace(/^#+\s+/, "").trim().toLowerCase();
}

function cleanMarkdown(value: string) {
  return value
    .replace(/[`*_>#-]/g, "")
    .replace(/\s+/g, " ")
    .trim();
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
