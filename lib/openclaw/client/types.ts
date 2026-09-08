import type { EventFrame } from "@openclaw/gateway-protocol/frame-guards";
import type { CommandResult } from "@/lib/openclaw/cli";
import type {
  OpenClawNativeAuthorizationProof,
  OpenClawOperatorIdentity
} from "@/lib/openclaw/identity/types";
import type {
  AgentMemorySearchConfig,
  AgentSandboxConfig,
  AgentToolPolicyConfig,
  OpenClawThinkingLevel
} from "@/lib/openclaw/types";

export interface OpenClawCommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
  forceCli?: boolean;
  /** Exact array paths whose removal is intentional for a native config mutation. */
  replacePaths?: string[];
  /** Server-created native handshake proof required for mutation CLI fallback. */
  authorizationProof?: OpenClawNativeAuthorizationProof;
  /** Dedicated local Gateway-auth bootstrap path; never accepted from HTTP input. */
  allowGatewayAuthRepairFallback?: boolean;
}

export type OpenClawGatewayControlOptions = OpenClawCommandOptions & {
  force?: boolean;
};

export type OpenClawConfigReloadKind = "restart" | "hot" | "none" | "unknown";

export type OpenClawConfigMutationMetadata = {
  path: string;
  reloadKind: OpenClawConfigReloadKind;
  restartRequired: boolean;
  hotReloaded: boolean;
  appliedVia: "config.patch" | "config.apply" | "config.set" | "noop";
  baseHash?: string;
  /** Authoritative effective paths returned by OpenClaw 2026.9.3+. */
  changedPaths?: string[];
};

export type OpenClawGatewayConnectionState =
  | "cli-forced"
  | "idle"
  | "connecting"
  | "connected"
  | "closed"
  | "error";

export type OpenClawGatewayMode =
  | "native-ws"
  | "cli-forced"
  | "fallback-active"
  | "degraded"
  | "unreachable";

export type OpenClawGatewayRecentFallbackDiagnostic = {
  at: string;
  operation: string;
  issue: string;
  kind: string;
  recovery: string;
};

export type OpenClawGatewayClientDiagnostics = {
  mode: "native-ws" | "cli";
  transportImplementation?: "official" | "cli";
  gatewayMode: OpenClawGatewayMode;
  statusLabel: string;
  recovery: string | null;
  connectionState: OpenClawGatewayConnectionState;
  protocolVersion: number | null;
  protocolRange: {
    min: number;
    max: number;
  };
  gatewayCapabilities?: string[];
  fallbackCounts: Record<string, number>;
  fallbackTotal: number;
  pendingRequestCount?: number;
  sharedInFlightRequestCount?: number;
  cachedReadRequestCount?: number;
  recentFallbackDiagnostics: OpenClawGatewayRecentFallbackDiagnostic[];
  lastNativeError: string | null;
  lastNativeFailureAt: string | null;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  operatorIdentity?: OpenClawOperatorIdentity;
};

export type OpenClawUserProfile = {
  profileId: string;
  displayName: string | null;
  emails: string[];
  avatarMime: "image/png" | "image/jpeg" | "image/webp" | null;
  hasAvatar: boolean;
  mergedInto: string | null;
  createdAt: number | null;
  updatedAt: number | null;
  githubIdentity: { login: string; profileUrl: string; avatarUrl: string } | null;
  role: string | null;
};

export type OpenClawUserListPayload = {
  profiles: OpenClawUserProfile[];
};

export type OpenClawGatewayRequestPolicy = {
  safety: "read" | "mutation";
  timeoutMs?: number;
  allowCliFallback?: boolean;
  allowReadCliFallbackOnNativeFailure?: boolean;
  allowMutationFallbackOnUnsupported?: boolean;
  allowUnsafeMutationCliFallback?: boolean;
};

export interface OpenClawStreamCallbacks {
  onStdout?: (text: string) => Promise<void> | void;
  onStderr?: (text: string) => Promise<void> | void;
}

export type GatewayStatusPayload = {
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
    capability?: string;
    error?: string;
    auth?: {
      role?: string | null;
      scopes?: string[];
      capability?: string;
    };
  };
};

export type GatewayProbePayload = Record<string, unknown>;

export type OpenClawHealthPayload = Record<string, unknown> & {
  ok?: boolean;
};

/** Exact native Gateway diagnostics payloads are intentionally open records.
 * OpenClaw owns their evolving detail; AgentOS only projects bounded fields. */
export type OpenClawDiagnosticsStabilityPayload = Record<string, unknown>;

export type OpenClawConfigSnapshotPayload = Record<string, unknown> & {
  exists?: boolean;
  valid?: boolean;
  hash?: string;
  configRevisionHash?: string;
  appliedConfigHash?: string | null;
  config?: Record<string, unknown>;
  resolved?: unknown;
};

export type OpenClawUpdateRunStep = {
  step: string;
  status: "pending" | "in_progress" | "completed" | "failed" | "skipped";
  startedAtMs?: number;
  endedAtMs?: number;
  detail?: string;
};

export type OpenClawUpdateRunVerification = {
  booted?: boolean;
  runningVersion?: string | null;
  runningBuildId?: string | null;
  serviceRunning?: boolean;
  versionMatch?: boolean;
  channelsReady?: boolean;
  inferenceProbe?: "passed" | "failed" | "skipped";
  noticeDelivered?: boolean;
  doctorHint?: string | null;
};

export type OpenClawUpdateRunRecord = {
  runId: string;
  createdAtMs: number;
  updatedAtMs: number;
  trigger: "chat" | "control-ui" | "cli" | "campaign" | "mac-app" | "api";
  phase: "requested" | "staging" | "validating" | "repairing" | "activating" | "restarting" | "verifying" | "finished";
  status: "running" | "succeeded" | "failed" | "rolled-back" | "skipped";
  reason: string | null;
  target?: {
    channel?: string;
    tag?: string;
    kind?: "package" | "git";
    version?: string;
    sha?: string;
  };
  before?: { version?: string | null; sha?: string | null; buildId?: string | null };
  after?: { version?: string | null; sha?: string | null; buildId?: string | null };
  steps?: OpenClawUpdateRunStep[];
  verification?: OpenClawUpdateRunVerification;
  repair?: Array<{
    attempt: number;
    status: "succeeded" | "failed" | "skipped";
    startedAtMs?: number;
    endedAtMs?: number;
    summary?: string;
    reason?: string;
  }>;
  confirmedAtMs?: number | null;
  finishedAtMs?: number | null;
  downtimeMs?: number | null;
};

export type OpenClawUpdateStatusNativePayload = Record<string, unknown> & {
  sentinel?: unknown;
  updateAvailable?: Record<string, unknown> | null;
  effectiveChannel?: "stable" | "extended-stable" | "beta" | "dev";
  schedule?: Record<string, unknown>;
  activeRun?: OpenClawUpdateRunRecord | null;
  lastRun?: OpenClawUpdateRunRecord | null;
};

export type OpenClawUpdateRunInput = {
  sessionKey?: string;
  note?: string;
  continuationMessage?: string;
  restartDelayMs?: number;
  timeoutMs?: number;
  target?: {
    kind: "git";
    upstreamRef: string;
    upstreamSha: string;
  };
};

export type OpenClawGatewayRestartRequestInput = {
  reason?: string;
  skipDeferral?: boolean;
};

export type OpenClawGatewaySuspendPrepareInput = {
  requestId: string;
  terminalPolicy?: "preserve" | "terminate";
  drain?: boolean;
};

export type OpenClawGatewaySuspendStatusInput = {
  suspensionId: string;
};

export type OpenClawGatewaySuspendResumeInput = {
  suspensionId: string;
};

export type OpenClawGatewayEventFrame = EventFrame;

export interface OpenClawGatewayEventCallbacks {
  onEvent: (event: OpenClawGatewayEventFrame) => void;
  onError?: (error: unknown) => void;
  onClose?: () => void;
  /** Official-path lifecycle notifications; custom transports may omit them. */
  onConnectionStateChange?: (state: OpenClawGatewayEventConnectionState) => void;
  onReconnected?: (details: { generation: number }) => Promise<void> | void;
  onGap?: (info: { expected: number; received: number }) => Promise<void> | void;
}

export type OpenClawGatewayEventConnectionState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "reconnect-paused"
  | "stopped";

export type OpenClawGatewayEventSubscription = {
  close: () => void;
  /** True when the official client, rather than AgentOS, owns reconnect. */
  reconnectManagedByClient?: boolean;
};

export interface OpenClawLogsTailInput {
  cursor?: number;
  limit?: number;
  maxBytes?: number;
}

export type OpenClawLogsTailPayload = Record<string, unknown> & {
  file?: string;
  cursor?: number;
  size?: number;
  lines?: string[];
  truncated?: boolean;
  reset?: boolean;
};

export interface OpenClawChannelLogsInput {
  channel: string;
  lines?: number;
}

export type OpenClawChannelLogsPayload = Record<string, unknown> & {
  lines?: Array<Record<string, unknown> & {
    time?: string;
    message?: string;
    raw?: string;
  }>;
};

export interface OpenClawChannelAccountProvisionInput {
  channel: string;
  account?: string | null;
  name?: string | null;
  token?: string | null;
  botToken?: string | null;
  appToken?: string | null;
  webhookUrl?: string | null;
}

export interface OpenClawChannelAccountRemoveInput {
  channel: string;
  account: string;
  delete?: boolean;
}

export interface OpenClawGmailSetupInput {
  account: string;
  config?: Record<string, unknown>;
}

export interface OpenClawAgentIdentityInput {
  agentId: string;
  workspace: string;
  identityFile: string;
  name?: string | null;
  emoji?: string | null;
  theme?: string | null;
  avatar?: string | null;
}

export interface OpenClawAutomationProvisionInput {
  name: string;
  description?: string | null;
  declarationKey?: string | null;
  agentId: string;
  message: string;
  thinking?: string | null;
  timeoutSeconds?: number | null;
  sessionTarget?: "isolated" | "main" | "current" | `session:${string}`;
  schedule:
    | {
        kind: "every";
        value: string;
      }
    | {
        kind: "cron";
        value: string;
      };
  announce?: {
    channel: string;
    target?: string | null;
  } | null;
}

export interface OpenClawDeviceApproveInput {
  latest?: boolean;
  requestId?: string | null;
  scopes?: string[];
}

export type OpenClawDeviceApprovePayload = Record<string, unknown> & {
  requestId?: unknown;
  device?: {
    deviceId?: unknown;
    scopes?: unknown;
    approvedScopes?: unknown;
  };
};

export type OpenClawDeviceListPayload = Record<string, unknown> & {
  pending?: unknown[];
};

export type StatusPayload = {
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
  gateway?: {
    mode?: string;
    url?: string;
    urlSource?: string;
    reachable?: boolean;
    error?: string | null;
    authWarning?: string | null;
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
  tasks?: {
    total?: number;
    active?: number;
    terminal?: number;
    failures?: number;
    byStatus?: Record<string, number>;
    byRuntime?: Record<string, number>;
  };
  taskAudit?: {
    total?: number;
    warnings?: number;
    errors?: number;
    byCode?: Record<string, number>;
  };
};

export type AgentPayload = Array<{
  id: string;
  kind?: "agent" | "system";
  createdVia?: "operator" | "agent" | "claw";
  creatorAgentId?: string | null;
  createdAt?: number;
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

export type OpenClawAgentListPayload = {
  defaultId?: string;
  mainKey?: string;
  scope?: "per-sender" | "global" | string;
  agents: Array<{
    id: string;
    kind?: "agent" | "system";
    createdVia?: "operator" | "agent" | "claw";
    creatorAgentId?: string | null;
    createdAt?: number;
    name?: string;
    identity?: {
      name?: string;
      theme?: string;
      emoji?: string;
      avatar?: string;
      avatarUrl?: string;
    };
    workspace?: string;
    model?: {
      primary?: string;
      fallbacks?: string[];
    };
  }>;
};

export type AgentConfigPayload = Array<{
  id: string;
  name?: string;
  description?: string;
  workspace: string;
  agentDir?: string;
  model?: string;
  heartbeat?: {
    every?: string;
  };
  skills?: string[];
  tools?: AgentToolPolicyConfig;
  sandbox?: AgentSandboxConfig;
  memorySearch?: AgentMemorySearchConfig;
  identity?: {
    name?: string;
    emoji?: string;
    theme?: string;
    avatar?: string;
  };
  default?: boolean;
}>;

export type ModelsPayload = {
  models: Array<{
    key: string;
    name: string;
    provider?: string;
    input: string;
    contextWindow: number | null;
    contextWindows?: Array<{ id: string; label: string; contextWindow: number }>;
    contextWindowDefault?: string;
    local: boolean | null;
    available: boolean | null;
    unavailableReason?: "missing-auth" | "auth-failed" | "cooldown" | string;
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
    tags: string[];
    missing: boolean;
  }>;
  providerOutcomes?: Array<{
    provider: string;
    profileId?: string;
    status: "ready" | "auth-rejected" | "unavailable" | string;
  }>;
};

export type OpenClawModelsListView = "default" | "configured" | "provider-config" | "all";

export type OpenClawSkillListPayload = {
  skills: Array<{
    name: string;
    description?: string;
    emoji?: string;
    eligible?: boolean;
    disabled?: boolean;
    blockedByAllowlist?: boolean;
    source?: string;
    bundled?: boolean;
  }>;
};

/** Exact OpenClaw 2026.9.1 Skills Library wire types. */
export type OpenClawSkillLibraryScope = "mine" | "team" | "all";

export type OpenClawSkillLibraryEntry = {
  skillId: string;
  slug: string;
  name: string;
  description: string;
  ownerProfileId: string | null;
  ownerLabel: string;
  authorProfileId: string;
  shared: boolean;
  enabled: boolean;
  removed: boolean;
  revision: string;
  createdAt: number;
  updatedAt: number;
  canEdit: boolean;
};

export type OpenClawSkillLibrarySelection = {
  skillId: string;
  revision: string;
  name: string;
  ownerProfileId: string | null;
  slug: string;
  description: string;
  ownerLabel: string;
};

export type OpenClawSkillLibraryListInput = {
  sessionKey?: string;
  scope?: OpenClawSkillLibraryScope;
};

export type OpenClawSkillLibraryListPayload = {
  entries: OpenClawSkillLibraryEntry[];
  profileId: string | null;
  multipleProfiles: boolean;
  defaultTarget: "workspace" | "personal" | "unavailable";
  canManageWorkspace: boolean;
  defaultSelectionLimit: number;
  defaultSelectionNotice?: string;
  session?: {
    sessionKey: string;
    selections: OpenClawSkillLibrarySelection[];
    attachable: OpenClawSkillLibraryEntry[];
  };
};

export type OpenClawSkillLibraryReadInput = {
  skillId: string;
  revision?: string;
  sessionKey?: string;
};

export type OpenClawSkillLibraryReadPayload = {
  entry: OpenClawSkillLibraryEntry;
  content: string;
  files: Array<{
    path: string;
    content: string;
    encoding?: "utf8" | "base64";
    executable?: boolean;
  }>;
  revisions: Array<{
    revision: string;
    createdAt: number;
  }>;
};

export type OpenClawSkillLibraryActivateInput = {
  sessionKey: string;
  action: "attach" | "detach" | "refresh";
  skillId?: string;
  revision?: string;
};

export type OpenClawSkillLibraryActivatePayload = {
  sessionKey: string;
  selections: OpenClawSkillLibrarySelection[];
  sessionActivation: "next-turn";
};

export type OpenClawSkillLibraryReceipt = {
  state: "published" | "unchanged" | "removed";
  target: "personal" | "team";
  entry: OpenClawSkillLibraryEntry;
  sessionActivation: "new-sessions";
  nextAction: string;
};

/** Exact OpenClaw 2026.9.1 memory.search result shape. */
export type OpenClawMemorySearchResult = {
  path: string;
  startLine: number;
  endLine: number;
  score: number;
  vectorScore?: number;
  textScore?: number;
  snippet: string;
  source: "memory" | "sessions";
  importance?: number;
  triggers?: string;
  projectKey?: string;
  originClass?: string;
  citation?: string;
  provenance?: {
    originClass: "owner" | "agent" | "untrusted" | "system";
    sessionKind: "interactive" | "cron" | "heartbeat" | "subagent" | "unknown";
    observedAt: number;
    supersedesKey?: string;
  };
};

export type OpenClawMemorySearchPayload = {
  agentId: string;
  provider: string;
  searchMode: "hybrid" | "fts-only";
  results: OpenClawMemorySearchResult[];
  stale?: true;
  warning?: string;
  action?: string;
};

export type OpenClawMemoryEmbeddingPayload = {
  ok: boolean;
  error?: string;
  checked?: boolean;
  cached?: boolean;
  checkedAtMs?: number;
  cacheExpiresAtMs?: number;
};

export type OpenClawMemoryStatusPayload = {
  agentId: string;
  provider?: string;
  embedding: OpenClawMemoryEmbeddingPayload;
  embeddingRuntime?: {
    engine: "llama.cpp";
    state: "ready" | "failed";
    backend?: "metal" | "cpu";
    buildInfo?: string;
    model?: { id: string; path?: string };
    capabilities?: { vision: boolean; draft: boolean };
    endpoints?: Record<string, "ready" | "unavailable">;
    loadError?: string;
  };
  dreaming?: {
    enabled: boolean;
    timezone?: string;
    verboseLogging: boolean;
    storageMode: "inline" | "separate" | "both";
    separateReports: boolean;
    shortTermCount: number;
    recallSignalCount: number;
    dailySignalCount: number;
    groundedSignalCount: number;
    totalSignalCount: number;
    phaseSignalCount: number;
    lightPhaseHitCount: number;
    remPhaseHitCount: number;
    promotedTotal: number;
    promotedToday: number;
    lastPromotedAt?: string;
    storeError?: string;
    phaseSignalError?: string;
    phases?: Record<string, Record<string, unknown>>;
  };
};

export type OpenClawMemoryDreamDiaryPayload = {
  agentId: string;
  found: boolean;
  path: string;
  content?: string;
  updatedAtMs?: number;
};

export type OpenClawMemoryDreamAction =
  | "backfill"
  | "reset"
  | "resetGroundedShortTerm"
  | "repairDreamingArtifacts"
  | "dedupeDreamDiary";

export type OpenClawMemoryDreamActionPayload = {
  agentId: string;
  action: OpenClawMemoryDreamAction;
  path?: string;
  found?: boolean;
  scannedFiles?: number;
  written?: number;
  replaced?: number;
  removedEntries?: number;
  removedShortTermEntries?: number;
  changed?: boolean;
  archiveDir?: string;
  archivedDreamsDiary?: boolean;
  archivedSessionCorpus?: boolean;
  archivedSessionIngestion?: boolean;
  warnings?: string[];
  dedupedEntries?: number;
  keptEntries?: number;
};

export type OpenClawMemorySearchInput = {
  agentId?: string;
  query: string;
  maxResults?: number;
  minScore?: number;
};

export type OpenClawMemoryAgentInput = {
  agentId?: string;
};

export type OpenClawPluginListPayload = {
  plugins: Array<{
    id: string;
    name: string;
    status?: string;
    enabled?: boolean;
    origin?: string;
    channelIds?: string[];
    toolNames?: string[];
    dependencyStatus?: {
      installed?: boolean;
      requiredInstalled?: boolean;
    };
  }>;
};

export type OpenClawModelScanPayload = Array<{
  id: string;
  name: string;
  provider: string;
  modelRef?: string;
  contextLength?: number | null;
  supportsToolsMeta?: boolean;
  isFree?: boolean;
}>;

export interface OpenClawListModelsInput {
  all?: boolean;
  provider?: string;
  /** Native OpenClaw 2026.9.1 agent-scoped model resolution context. */
  agentId?: string;
  /** OpenClaw 2026.9.1 catalog view. `default` is the fast prepared view. */
  view?: OpenClawModelsListView;
  preparedOnly?: boolean;
  refresh?: boolean;
  includeProviderCapabilities?: boolean;
}

/** Secret-free projection returned by OpenClaw's native models.authStatus RPC. */
export type OpenClawModelAuthStatusPayload = {
  ts?: number;
  providers?: Array<{
    provider?: string;
    displayName?: string;
    status?: string;
    expiry?: { at?: number; remainingMs?: number; label?: string };
    profiles?: Array<{
      profileId?: string;
      type?: "oauth" | "token" | "api_key" | string;
      status?: string;
      reasonCode?: string;
      expiry?: { at?: number; remainingMs?: number; label?: string };
      logoutSupported?: boolean;
    }>;
    apiKey?: { source?: "config" | "env" | string; envVar?: string };
    usage?: Record<string, unknown>;
  }>;
  unavailable?: { code?: string; message?: string };
  providerCapabilities?: Array<{
    provider?: string;
    apiKeySupported?: boolean;
    quickApiKeySetup?: boolean;
  }>;
};

export type OpenClawModelAuthLogoutPayload = {
  provider?: string;
  removedProfiles?: string[];
  abortedRunIds?: string[];
};

export interface OpenClawListSessionsInput {
  limit?: number;
  activeMinutes?: number;
  includeGlobal?: boolean;
  includeUnknown?: boolean;
  includeDerivedTitles?: boolean;
  includeLastMessage?: boolean;
  label?: string;
  spawnedBy?: string;
  agentId?: string;
  search?: string;
}

export type OpenClawSessionsPayload = {
  sessions: Array<Record<string, unknown> & {
    agentId?: string;
    key?: string;
    sessionId?: string;
    updatedAt?: number;
    ageMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
    modelProvider?: string;
    /** Native OpenClaw session model provenance; null means inherited. */
    modelOverrideSource?: "user" | "auto" | null;
    cacheRead?: number;
    kind?: string;
    origin?: string;
  }>;
};

export interface OpenClawSessionReferenceInput {
  key?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
}

export interface OpenClawSessionModelPatchInput extends OpenClawSessionReferenceInput {
  model: string | null;
}

export type OpenClawSessionModelPatchPayload = Record<string, unknown>;

export interface OpenClawDescribeSessionInput extends OpenClawSessionReferenceInput {
  limit?: number;
}

export interface OpenClawSessionHistoryInput extends OpenClawSessionReferenceInput {
  limit?: number;
  cursor?: string | number | null;
}

export interface OpenClawSessionExportInput extends OpenClawSessionReferenceInput {
  format?: string;
}

export type OpenClawSessionPayload = Record<string, unknown> & {
  session?: Record<string, unknown>;
  key?: string;
  sessionKey?: string;
  sessionId?: string;
  messages?: unknown[];
};

/**
 * Exact 2026.9.1 environment facts. OpenClaw owns the inventory and the
 * lifecycle; AgentOS only carries the bounded native projection forward.
 */
export type OpenClawEnvironmentSummary = {
  id: string;
  type: string;
  label?: string;
  status: string;
  platform?: string;
  sessionHost?: boolean;
  trust?: string;
  capabilities?: string[];
  invocableCommands?: string[];
  workerSlots?: {
    total: number;
    available: number;
  };
  workerBundle?:
    | { status: "installed"; version: string }
    | { status: "missing" };
  lastConnectedAtMs?: number;
  lastDisconnectedAtMs?: number;
  lastSeenAtMs?: number;
  lastSeenReason?: string;
  issues?: Array<Record<string, unknown>>;
  worker?: {
    providerId: string;
    leaseId?: string;
    state: string;
    ageMs: number;
    idleMs?: number;
    attachedSessionIds: string[];
    tunnelStatus: string;
    error?: string;
    desktop?: boolean;
    desktopApps?: string[];
  };
  [key: string]: unknown;
};

export type OpenClawEnvironmentProfile = {
  id: string;
  providerId: string;
  trust?: string;
  executionMode?: string;
  executionModes?: string[];
  machines?: Array<Record<string, unknown>>;
};

export type OpenClawEnvironmentListPayload = {
  environments: OpenClawEnvironmentSummary[];
  profiles?: OpenClawEnvironmentProfile[];
};

export type OpenClawEnvironmentMutationPayload = OpenClawEnvironmentSummary;

export type OpenClawSessionPlacement = Record<string, unknown> & {
  state?: string;
  generation?: number;
  environmentId?: string;
  /** Exact native field on worker-owned placements. */
  activeOwnerEpoch?: number;
  /** Legacy compatibility shape accepted only when native data uses it. */
  ownerEpoch?: number;
  profileId?: string;
  runner?: { kind?: string; status?: string; deviceId?: string };
  requestedAtMs?: number;
  updatedAtMs?: number;
};

export type OpenClawSessionsDispatchInput = {
  key: string;
  agentId?: string;
  profileId?: string;
  deviceId?: string;
  autoDevice?: true;
  machineClass?: string;
};

export type OpenClawSessionsDispatchPayload = Record<string, unknown> & {
  ok?: boolean;
  key?: string;
  sessionId?: string;
  placement?: OpenClawSessionPlacement;
};

export type OpenClawSessionsMoveInput = {
  key: string;
  agentId?: string;
  expected: {
    generation: number;
    environmentId: string;
    ownerEpoch: number;
  };
  target:
    | { kind: "gateway" }
    | { kind: "profile"; profileId: string; machineClass?: string }
    | { kind: "device"; deviceId: string };
  abandonSource?: boolean;
};

export type OpenClawSessionsMovePayload = Record<string, unknown> & {
  ok?: boolean;
  key?: string;
  sessionId?: string;
  placement?: Pick<OpenClawSessionPlacement, "state" | "generation"> & OpenClawSessionPlacement;
};

export type OpenClawSessionsReclaimInput = {
  key: string;
  agentId?: string;
};

export type OpenClawSessionsReclaimPayload = Record<string, unknown> & {
  ok?: boolean;
  key?: string;
  sessionId?: string;
  placement?: OpenClawSessionPlacement;
};

export type OpenClawSessionHistoryPayload = Record<string, unknown> & {
  messages?: unknown[];
  turns?: unknown[];
  items?: unknown[];
  cursor?: string | number | null;
};

export type OpenClawSessionExportPayload = Record<string, unknown> & {
  content?: string;
  format?: string;
  session?: unknown;
};

export interface OpenClawTaskListInput {
  status?: string;
  agentId?: string;
  workspace?: string;
  /** Certified OpenClaw `tasks.list` filter. */
  sessionKey?: string;
  /** @deprecated Use the exact Gateway `sessionKey` field. */
  sessionId?: string;
  limit?: number;
  cursor?: string | number | null;
}

export interface OpenClawTaskGetInput {
  taskId: string;
  includeRuns?: boolean;
  includeArtifacts?: boolean;
}

export interface OpenClawTaskAssignInput {
  taskId: string;
  agentId?: string;
  workspace?: string;
  reason?: string | null;
}

export interface OpenClawTaskCancelInput {
  taskId: string;
  reason?: string | null;
}

export type OpenClawTaskListPayload = Record<string, unknown> & {
  tasks?: unknown[];
  nextCursor?: string | number | null;
  cursor?: string | number | null;
};

export type OpenClawTaskPayload = Record<string, unknown> & {
  task?: unknown;
  id?: string;
  taskId?: string;
  status?: string;
};

export interface OpenClawArtifactListInput {
  taskId?: string;
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  workspace?: string;
  limit?: number;
  cursor?: string | number | null;
}

export interface OpenClawArtifactGetInput {
  artifactId: string;
  includeContent?: boolean;
}

export interface OpenClawArtifactDownloadInput {
  artifactId: string;
  format?: string;
  destination?: string;
}

export interface OpenClawArtifactPutInput {
  artifactId?: string;
  taskId?: string;
  sessionId?: string;
  name?: string;
  path?: string;
  mimeType?: string;
  content?: unknown;
  metadata?: Record<string, unknown>;
}

export interface OpenClawArtifactDeleteInput {
  artifactId: string;
  reason?: string | null;
}

export type OpenClawArtifactListPayload = Record<string, unknown> & {
  artifacts?: unknown[];
  cursor?: string | number | null;
};

export type OpenClawArtifactPayload = Record<string, unknown> & {
  artifact?: unknown;
  artifactId?: string;
  content?: unknown;
};

export type OpenClawArtifactDownloadPayload = OpenClawArtifactPayload & {
  bytes?: unknown;
  data?: unknown;
  path?: string;
  url?: string;
};

export interface OpenClawRuntimeSnapshotInput {
  includeSessions?: boolean;
  includeTasks?: boolean;
  includeArtifacts?: boolean;
  agentId?: string;
  workspace?: string;
  taskId?: string;
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
  limit?: number;
}

export type OpenClawRuntimeSnapshotPayload = Record<string, unknown> & {
  runtimes?: unknown[];
  sessions?: unknown[];
  tasks?: unknown[];
  artifacts?: unknown[];
  agents?: unknown[];
};

export interface OpenClawToolsCatalogInput {
  agentId?: string;
  includePlugins?: boolean;
}

export interface OpenClawToolsEffectiveInput {
  agentId?: string;
  sessionKey: string;
}

export interface OpenClawToolInvokeInput {
  name: string;
  args?: Record<string, unknown>;
  sessionKey?: string;
  agentId?: string;
  confirm?: boolean;
  idempotencyKey?: string;
}

export type OpenClawToolCatalogEntry = {
  id: string;
  label: string;
  description: string;
  source: "core" | "plugin";
  pluginId?: string;
  optional?: boolean;
  risk?: "low" | "medium" | "high";
  tags?: string[];
  defaultProfiles: Array<"minimal" | "coding" | "messaging" | "full">;
};

export type OpenClawToolsCatalogPayload = {
  agentId: string;
  profiles: Array<{
    id: "minimal" | "coding" | "messaging" | "full";
    label: string;
  }>;
  groups: Array<{
    id: string;
    label: string;
    source: "core" | "plugin";
    pluginId?: string;
    tools: OpenClawToolCatalogEntry[];
  }>;
};

export type OpenClawToolsEffectivePayload = {
  agentId: string;
  profile: string;
  groups: Array<{
    id: "core" | "plugin" | "channel" | "mcp";
    label: string;
    source: "core" | "plugin" | "channel" | "mcp";
    tools: Array<{
      id: string;
      label: string;
      description: string;
      rawDescription: string;
      source: "core" | "plugin" | "channel" | "mcp";
      pluginId?: string;
      channelId?: string;
      deniedBySession?: boolean;
      tags?: string[];
      risk?: "low" | "medium" | "high";
    }>;
  }>;
  notices?: Array<{
    id: string;
    severity: "info" | "warning";
    message: string;
  }>;
};

export type OpenClawToolInvokePayload = {
  ok: boolean;
  toolName: string;
  output?: unknown;
  requiresApproval?: boolean;
  approvalId?: string;
  source?: string;
  error?: {
    code: string;
    message: string;
    details?: unknown;
  };
};

export type OpenClawGatewaySurfaceInput = Record<string, unknown>;

export type OpenClawGatewaySurfacePayload = Record<string, unknown>;

export interface OpenClawRuntimeEventSubscriptionInput {
  includeSessions?: boolean;
  includeTasks?: boolean;
  includeArtifacts?: boolean;
  includeApprovals?: boolean;
  sessionKeys?: string[];
  taskIds?: string[];
  artifactIds?: string[];
}

export type OpenClawChannelStatusPayload = {
  ts: number;
  channelOrder: string[];
  channelLabels: Record<string, string>;
  channelDetailLabels?: Record<string, string>;
  channelSystemImages?: Record<string, string>;
  channelMeta?: Array<{
    id: string;
    label: string;
    detailLabel: string;
    systemImage?: string;
  }>;
  channels: Record<string, unknown>;
  channelAccounts: Record<string, Array<Record<string, unknown> & {
    accountId: string;
    name?: string;
    enabled?: boolean;
    configured?: boolean;
    linked?: boolean;
    running?: boolean;
    connected?: boolean;
    lastError?: string;
    healthState?: string;
  }>>;
  channelDefaultAccountId: Record<string, string | null>;
};

export interface OpenClawChannelStatusInput {
  probe?: boolean;
  timeoutMs?: number;
  channel?: string;
}

export interface OpenClawWebLoginStartInput {
  accountId?: string;
  force?: boolean;
  timeoutMs?: number;
  verbose?: boolean;
}

export interface OpenClawWebLoginWaitInput {
  accountId?: string;
  timeoutMs?: number;
  currentQrDataUrl?: string;
}

export type OpenClawWebLoginResult = Record<string, unknown> & {
  connected?: boolean;
  qrDataUrl?: string;
  message?: string;
};

export interface OpenClawChannelLogoutInput {
  channel: string;
  accountId?: string;
}

export interface OpenClawChannelLifecycleInput {
  channel: string;
  accountId?: string;
}

export type OpenClawChannelLifecycleOutcome =
  | { status: "handed-off" }
  | { status: "retry"; reason: "stop-in-flight" | "task-owned" | "start-in-flight" }
  | {
      status: "skipped";
      reason: "unsupported" | "autostart-suppressed" | "ambient-suppressed" | "disabled" | "unconfigured" | "secret-unavailable" | "unlinked" | "manual-stop";
    };

export type OpenClawChannelLifecycleResult = Record<string, unknown> & {
  channel?: string;
  accountId?: string;
  started?: boolean;
  stopped?: boolean;
  outcome?: OpenClawChannelLifecycleOutcome;
};

export type ModelsStatusPayload = {
  agentDir?: string | null;
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
        oauth?: number;
        token?: number;
        apiKey?: number;
      };
      syntheticAuth?: {
        value?: string;
        source?: string;
        credential?: string;
        mode?: string;
      };
    }>;
    runtimeAuthRoutes?: Array<{
      provider?: string;
      runtime?: string;
      authProvider?: string;
      status?: string;
    }>;
    missingProvidersInUse?: string[];
    unusableProfiles?: unknown[];
    oauth?: {
      providers?: Array<{
        provider?: string;
        status?: string;
        profiles?: unknown[];
        effectiveProfiles?: unknown[];
      }>;
    };
  };
};

export interface OpenClawAgentModelStatusInput {
  agentId: string;
}

export interface OpenClawModelAuthOrderSetInput {
  provider: string;
  agentId: string;
  profileIds: string[];
}

export type PresencePayload = Array<{
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

export type MissionCommandPayload = {
  runId?: string;
  sessionKey?: string;
  sessionId?: string;
  agentId?: string;
  runStarted?: boolean;
  messageSeq?: number;
  idempotencyKey?: string;
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

export interface OpenClawAddAgentInput {
  id: string;
  workspace: string;
  agentDir: string;
  model?: string | null;
  bindings?: unknown;
  skills?: string[];
  name?: string | null;
  emoji?: string | null;
  avatar?: string | null;
}

export interface OpenClawUpdateAgentInput {
  id: string;
  name?: string | null;
  workspace?: string | null;
  model?: string | null;
  emoji?: string | null;
  avatar?: string | null;
}

export interface OpenClawAgentTurnInput {
  agentId: string;
  /** Caller-selected OpenClaw session key, when a workflow already owns one. */
  sessionKey?: string;
  sessionId?: string;
  message: string;
  thinking?: OpenClawThinkingLevel;
  timeoutSeconds?: number;
  workspace?: string | null;
  dispatchId?: string | null;
  idempotencyKey?: string | null;
  local?: boolean;
}

export type OpenClawWorktreeOwnerKind = "manual" | "workboard" | "session";
export type OpenClawWorktreeCleanupOutcome =
  | "removed-lossless"
  | "retained-busy"
  | "retained-dirty"
  | "retained-unpushed"
  | "retained-provisioned-drift";

export interface OpenClawWorktreeRecord {
  id: string;
  name: string;
  repoFingerprint: string;
  repoRoot: string;
  path: string;
  branch: string;
  baseRef: string;
  ownerKind: OpenClawWorktreeOwnerKind;
  ownerId?: string;
  snapshotRef?: string;
  createdAt: number;
  lastActiveAt: number;
  removedAt?: number;
  runEndCleanup?: {
    outcome: OpenClawWorktreeCleanupOutcome | "failed";
    at: number;
    reason?: string;
  };
}

export interface OpenClawWorktreesListPayload {
  worktrees: OpenClawWorktreeRecord[];
}

export interface OpenClawWorktreesBranchesPayload {
  branches: Array<{ name: string; kind: "local" | "remote" }>;
  defaultBranch?: string;
  headBranch?: string;
  repositoryStatus?: "git" | "not_git" | "unavailable";
}

export interface OpenClawTaskSuggestion {
  id: string;
  title: string;
  prompt: string;
  tldr: string;
  cwd: string;
  sessionKey: string;
  agentId?: string;
  createdAt: number;
}

export interface OpenClawTaskSuggestionsListPayload {
  suggestions: OpenClawTaskSuggestion[];
}

export type OpenClawTaskSuggestionAcceptMode = "worktree" | "local" | "cloud" | "session";

export interface OpenClawSessionCreateInput {
  agentId: string;
  task: string;
  cwd: string;
  worktree: true;
  key?: string;
  idempotencyKey?: string;
  label?: string;
  worktreeBaseRef?: string;
  worktreeName?: string;
}

export interface OpenClawSessionCreatePayload {
  ok?: boolean;
  key?: string;
  sessionKey?: string;
  sessionId?: string;
  runId?: string;
  status?: string;
  entry?: unknown;
  worktree?: Pick<OpenClawWorktreeRecord, "id" | "path" | "branch" | "repoRoot">;
  [key: string]: unknown;
}

export interface OpenClawSessionOwner {
  actor: {
    type: "agent" | "human" | "system";
    id?: string;
    label?: string;
    avatarUrl?: string;
  };
  assignedBy?: {
    type: "agent" | "human" | "system";
    id?: string;
    label?: string;
    avatarUrl?: string;
  };
  assignedAt?: number;
}

export interface OpenClawSessionMembersPayload {
  sessionKey: string;
  owner?: { type: "agent" | "human" | "system"; id: string; label?: string; identity?: string };
  members: Array<{ identityId: string; addedBy: string; addedAt: number }>;
  identities: Array<Record<string, unknown>>;
  role: "admin" | "owner" | "member" | "viewer";
  allowedVisibilities: Array<"shared" | "read-only" | "suggest" | "draft">;
}

export interface OpenClawSessionMembersEvidencePayload {
  sessionKey: string;
  owner?: { type: "agent" | "human" | "system"; id: string; label?: string; identity?: string };
  members: Array<{ identityId: string; addedBy?: string; addedByState?: "unknown"; addedAt: number }>;
  identities: Array<Record<string, unknown>>;
  role: "admin" | "owner" | "member" | "viewer";
  allowedVisibilities: Array<"shared" | "read-only" | "suggest" | "draft">;
}

export interface OpenClawSessionAssignOwnerPayload {
  ok: true;
  key: string;
  owner: OpenClawSessionOwner;
}

export type OpenClawSessionVisibility = "shared" | "read-only" | "suggest" | "draft";

export interface OpenClawSessionVisibilitySetInput {
  sessionKey: string;
  agentId?: string;
  visibility: OpenClawSessionVisibility;
}

export interface OpenClawSessionVisibilitySetPayload {
  ok: true;
  sessionKey: string;
  visibility: OpenClawSessionVisibility;
}

export interface OpenClawSessionMemberMutationInput {
  sessionKey: string;
  agentId?: string;
  identityId: string;
}

export interface OpenClawSessionMemberMutationPayload {
  ok: true;
  sessionKey: string;
  identityId: string;
}

export interface OpenClawAbortTurnInput {
  sessionKey?: string | null;
  runId?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  reason?: string | null;
  clearQueued?: boolean;
}

export interface OpenClawSessionSteerInput {
  key?: string | null;
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  message: string;
  idempotencyKey?: string | null;
}

export interface OpenClawChatInjectInput {
  sessionKey?: string | null;
  sessionId?: string | null;
  agentId?: string | null;
  label?: string | null;
  message: string;
}

export type OpenClawSessionControlPayload = Record<string, unknown> & {
  ok?: boolean;
  status?: string;
  runId?: string;
  sessionId?: string;
  taskId?: string;
};

export type OpenClawConfigSchemaPayload = Record<string, unknown> & {
  schema?: unknown;
  hash?: string;
  version?: string;
};

export type OpenClawConfigSchemaLookupPayload = Record<string, unknown> & {
  path?: string;
  normalizedPath?: string;
  reloadKind?: OpenClawConfigReloadKind | string;
  schema?: unknown;
  hint?: unknown;
  hintPath?: string;
  children?: unknown[];
};

export interface OpenClawConfigSchemaLookupInput {
  path: string;
}

export interface OpenClawExecApprovalListInput {
  status?: string;
  limit?: number;
}

export type OpenClawExecApprovalListPayload = Record<string, unknown> & {
  approvals?: unknown[];
  pending?: unknown[];
};

export interface OpenClawExecApprovalResolveInput {
  approvalId: string;
  decision: "allow" | "deny" | "approved" | "rejected";
  reason?: string | null;
}

export type OpenClawExecApprovalResolvePayload = Record<string, unknown> & {
  ok?: boolean;
  approvalId?: string;
  status?: string;
};

export interface OpenClawNativeExecApprovalResolveInput {
  approvalId: string;
  decision: "allow-once" | "allow-always" | "deny";
  grantExpiresInDays?: number;
}

export interface OpenClawNativePluginApprovalResolveInput {
  approvalId: string;
  decision: "allow-once" | "allow-always" | "deny";
}

export interface OpenClawQuestionOption {
  label: string;
  description?: string;
}

export interface OpenClawQuestionPrompt {
  questionId: string;
  header: string;
  question: string;
  options: OpenClawQuestionOption[];
  multiSelect?: boolean;
  isOther?: boolean;
  isSecret?: boolean;
}

export interface OpenClawQuestionRecord {
  id: string;
  questions: OpenClawQuestionPrompt[];
  agentId?: string;
  sessionKey?: string;
  runId?: string;
  createdAtMs: number;
  expiresAtMs: number;
  status: "pending" | "answered" | "cancelled" | "expired";
  answers?: { answers: Record<string, string[]> };
  resolvedBy?: string;
}

export interface OpenClawQuestionListPayload {
  questions: OpenClawQuestionRecord[];
}

export interface OpenClawQuestionResolveInput {
  id: string;
  answers?: { answers: Record<string, string[]> };
  cancel?: true;
  resolvedBy?: string;
}

export type OpenClawQuestionResolvePayload = Record<string, unknown> & {
  status?: "answered" | "cancelled";
};

export type OpenClawCronStatusPayload = Record<string, unknown> & {
  enabled?: boolean;
  triggersEnabled?: boolean;
  storage?: string;
  sqlitePath?: string | null;
  jobs?: number;
  nextWakeAtMs?: number | null;
};

export interface OpenClawCronListInput {
  includeDisabled?: boolean;
  limit?: number;
  offset?: number;
  query?: string;
  enabled?: boolean;
  scheduleKind?: string;
  lastRunStatus?: string;
  trigger?: string;
  sortBy?: string;
  sortDir?: "asc" | "desc";
  agentId?: string;
  compact?: boolean;
  includeDeliveryPreviews?: boolean;
}

export type OpenClawCronListPayload = Record<string, unknown> & {
  jobs?: unknown[];
};

export interface OpenClawCronGetInput {
  id: string;
}

export type OpenClawCronRunMode = "due" | "force" | "if-enabled";

export interface OpenClawCronRunInput {
  id: string;
  mode?: OpenClawCronRunMode;
  expectedProcessInstanceId?: string;
}

export type OpenClawCronRunPayload = Record<string, unknown> & {
  ok?: boolean;
  ran?: boolean;
  enqueued?: boolean;
  runId?: string;
  reason?: "disabled" | "not-due" | "already-running" | "invalid-spec" | "stopped" | string;
  processInstanceId?: string;
};

export interface OpenClawCronRunsInput {
  id?: string;
  jobId?: string;
  runId?: string;
  scope?: "job" | "all";
  agentId?: string;
  limit?: number;
  offset?: number;
  statuses?: string[];
  status?: string;
  deliveryStatuses?: string[];
  deliveryStatus?: string;
  query?: string;
  sortDir?: "asc" | "desc";
}

export type OpenClawCronRunsPayload = Record<string, unknown> & {
  entries?: unknown[];
  total?: number;
  offset?: number;
  limit?: number;
  hasMore?: boolean;
  nextOffset?: number | null;
};

export type OpenClawUpdateStatusPayload = Record<string, unknown> & {
  currentVersion?: string;
  latestVersion?: string;
  updateAvailable?: boolean;
  update?: {
    root?: string | null;
    installKind?: string | null;
    packageManager?: string | null;
    registry?: {
      latestVersion?: string | null;
      tag?: string | null;
      error?: string | null;
    } | null;
  };
  availability?: {
    available?: boolean | null;
    hasRegistryUpdate?: boolean | null;
    latestVersion?: string | null;
  };
  channel?: {
    value?: string | null;
    label?: string | null;
  };
  sentinel?: unknown;
};

export interface OpenClawGatewayClient {
  getDiagnostics?(): OpenClawGatewayClientDiagnostics;
  /** Current official transport generation; this never creates a connection. */
  getNativeConnectionGeneration?(): number;
  /** Invalidate AgentOS request-policy reads after a native upstream event. */
  invalidateReadCache?(): void;
  getOperatorIdentity?(options?: OpenClawCommandOptions): Promise<OpenClawOperatorIdentity>;
  getHealth(options?: OpenClawCommandOptions): Promise<OpenClawHealthPayload>;
  /** Native-only diagnostics methods; the CLI client intentionally omits these. */
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
  listUsers?(options?: OpenClawCommandOptions): Promise<OpenClawUserListPayload>;
  getCurrentUser?(options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  setUserDisplayName?(profileId: string, displayName: string | null, options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  setUserAvatar?(profileId: string, input: { mime: "image/png" | "image/jpeg" | "image/webp"; avatarBase64: string }, options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  linkUserEmail?(profileId: string, email: string, options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  setUserRole?(profileId: string, role: string | null, options?: OpenClawCommandOptions): Promise<OpenClawUserProfile | null>;
  listGatewayRoleNames?(options?: OpenClawCommandOptions): Promise<string[]>;
  getModelStatus(options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  getAgentModelStatus(input: OpenClawAgentModelStatusInput, options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  setModelAuthOrder(input: OpenClawModelAuthOrderSetInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  listAgents(options?: OpenClawCommandOptions): Promise<OpenClawAgentListPayload>;
  listSessions(input?: OpenClawListSessionsInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionsPayload>;
  listWorktrees?(options?: OpenClawCommandOptions): Promise<OpenClawWorktreesListPayload>;
  inspectWorktreeBranches?(input: { repoRoot: string; includeRepositoryStatus?: boolean }, options?: OpenClawCommandOptions): Promise<OpenClawWorktreesBranchesPayload>;
  createSession?(input: OpenClawSessionCreateInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionCreatePayload>;
  listTaskSuggestions?(input?: { sessionKey?: string; agentId?: string }, options?: OpenClawCommandOptions): Promise<OpenClawTaskSuggestionsListPayload>;
  createTaskSuggestion?(input: Omit<OpenClawTaskSuggestion, "id" | "createdAt">, options?: OpenClawCommandOptions): Promise<{ taskId: string; suggestion: OpenClawTaskSuggestion }>;
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
  /** Native-only Phase 5 memory operations. The CLI client intentionally does not implement these. */
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
  /** Native-only execution topology and placement methods. The CLI client intentionally omits these. */
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
  /** Native-only lifecycle observation; unlike subscribeRuntimeEvents, no CLI fallback is allowed. */
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
  listSkills(options?: OpenClawCommandOptions & { eligible?: boolean }): Promise<OpenClawSkillListPayload>;
  listSkillLibrary?(input?: OpenClawSkillLibraryListInput, options?: OpenClawCommandOptions): Promise<OpenClawSkillLibraryListPayload>;
  readSkillLibrary?(input: OpenClawSkillLibraryReadInput, options?: OpenClawCommandOptions): Promise<OpenClawSkillLibraryReadPayload>;
  activateSkillLibrary?(input: OpenClawSkillLibraryActivateInput, options?: OpenClawCommandOptions): Promise<OpenClawSkillLibraryActivatePayload>;
  listPlugins(options?: OpenClawCommandOptions): Promise<OpenClawPluginListPayload>;
  listModels(input?: OpenClawListModelsInput, options?: OpenClawCommandOptions): Promise<ModelsPayload>;
  scanModels(options?: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean }): Promise<OpenClawModelScanPayload>;
  probeGateway(options?: OpenClawCommandOptions): Promise<GatewayProbePayload>;
  controlGateway(
    action: "start" | "stop" | "restart",
    options?: OpenClawGatewayControlOptions
  ): Promise<Record<string, unknown>>;
  listDeviceAccess?(options?: OpenClawCommandOptions): Promise<OpenClawDeviceListPayload>;
  approveDeviceAccess(input?: OpenClawDeviceApproveInput, options?: OpenClawCommandOptions): Promise<OpenClawDeviceApprovePayload>;
  call<TPayload>(
    method: string,
    params?: Record<string, unknown>,
    options?: OpenClawCommandOptions
  ): Promise<TPayload>;
  hasConfig(path: string, options?: OpenClawCommandOptions): Promise<boolean>;
  getConfig<TPayload>(path: string, options?: OpenClawCommandOptions): Promise<TPayload | null>;
  getConfigSchema?(options?: OpenClawCommandOptions): Promise<OpenClawConfigSchemaPayload | null>;
  lookupConfigSchema?(
    input: OpenClawConfigSchemaLookupInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawConfigSchemaLookupPayload | null>;
  setConfig(
    path: string,
    value: unknown,
    options?: OpenClawCommandOptions & { strictJson?: boolean }
  ): Promise<CommandResult>;
  unsetConfig(path: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  addAgent(input: OpenClawAddAgentInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  updateAgent?(input: OpenClawUpdateAgentInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  setAgentIdentity(input: OpenClawAgentIdentityInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  deleteAgent(agentId: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  provisionAutomation(input: OpenClawAutomationProvisionInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  runAgentTurn(
    input: OpenClawAgentTurnInput,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
  abortAgentTurn?(input: OpenClawAbortTurnInput, options?: OpenClawCommandOptions): Promise<MissionCommandPayload>;
  steerSession?(input: OpenClawSessionSteerInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionControlPayload>;
  injectChat?(input: OpenClawChatInjectInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionControlPayload>;
  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks?: OpenClawStreamCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
  tailLogs?(input?: OpenClawLogsTailInput, options?: OpenClawCommandOptions): Promise<OpenClawLogsTailPayload>;
  listExecApprovals?(
    input?: OpenClawExecApprovalListInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawExecApprovalListPayload>;
  resolveExecApproval?(
    input: OpenClawExecApprovalResolveInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawExecApprovalResolvePayload>;
  getCronStatus?(options?: OpenClawCommandOptions): Promise<OpenClawCronStatusPayload>;
  listCronJobs?(input?: OpenClawCronListInput, options?: OpenClawCommandOptions): Promise<OpenClawCronListPayload>;
  getCronJob?(input: OpenClawCronGetInput, options?: OpenClawCommandOptions): Promise<Record<string, unknown>>;
  runCronJob?(input: OpenClawCronRunInput, options?: OpenClawCommandOptions): Promise<OpenClawCronRunPayload>;
  listCronRuns?(input?: OpenClawCronRunsInput, options?: OpenClawCommandOptions): Promise<OpenClawCronRunsPayload>;
  close?(reason?: string): Promise<void> | void;
  getDiagnostics?(): OpenClawGatewayClientDiagnostics;
}
