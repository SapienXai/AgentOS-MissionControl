import type { CommandResult } from "@/lib/openclaw/cli";

export interface OpenClawCommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
}

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
  };
};

export type GatewayProbePayload = Record<string, unknown>;

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

export type AgentPayload = Array<{
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

export type OpenClawAgentListPayload = {
  defaultId?: string;
  mainKey?: string;
  scope?: "per-sender" | "global" | string;
  agents: Array<{
    id: string;
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

export type ModelsPayload = {
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

export type OpenClawPluginListPayload = {
  plugins: Array<{
    id: string;
    name: string;
    status?: string;
    toolNames?: string[];
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
}

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
    cacheRead?: number;
    kind?: string;
    origin?: string;
  }>;
};

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
  channelDefaultAccountId: Record<string, string>;
};

export interface OpenClawChannelStatusInput {
  probe?: boolean;
  timeoutMs?: number;
}

export type ModelsStatusPayload = {
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
}

export interface OpenClawAgentTurnInput {
  agentId: string;
  sessionId?: string;
  message: string;
  thinking?: "off" | "minimal" | "low" | "medium" | "high";
  timeoutSeconds?: number;
}

export interface OpenClawGatewayClient {
  getStatus(options?: OpenClawCommandOptions): Promise<StatusPayload>;
  getGatewayStatus(options?: OpenClawCommandOptions): Promise<GatewayStatusPayload>;
  getModelStatus(options?: OpenClawCommandOptions): Promise<ModelsStatusPayload>;
  listAgents(options?: OpenClawCommandOptions): Promise<OpenClawAgentListPayload>;
  listSessions(input?: OpenClawListSessionsInput, options?: OpenClawCommandOptions): Promise<OpenClawSessionsPayload>;
  getChannelStatus(
    input?: OpenClawChannelStatusInput,
    options?: OpenClawCommandOptions
  ): Promise<OpenClawChannelStatusPayload>;
  listSkills(options?: OpenClawCommandOptions & { eligible?: boolean }): Promise<OpenClawSkillListPayload>;
  listPlugins(options?: OpenClawCommandOptions): Promise<OpenClawPluginListPayload>;
  listModels(input?: OpenClawListModelsInput, options?: OpenClawCommandOptions): Promise<ModelsPayload>;
  scanModels(options?: OpenClawCommandOptions & { yes?: boolean; noInput?: boolean; noProbe?: boolean }): Promise<OpenClawModelScanPayload>;
  probeGateway(options?: OpenClawCommandOptions): Promise<GatewayProbePayload>;
  controlGateway(
    action: "start" | "stop" | "restart",
    options?: OpenClawCommandOptions
  ): Promise<Record<string, unknown>>;
  call<TPayload>(
    method: string,
    params?: Record<string, unknown>,
    options?: OpenClawCommandOptions
  ): Promise<TPayload>;
  hasConfig(path: string, options?: OpenClawCommandOptions): Promise<boolean>;
  getConfig<TPayload>(path: string, options?: OpenClawCommandOptions): Promise<TPayload | null>;
  setConfig(
    path: string,
    value: unknown,
    options?: OpenClawCommandOptions & { strictJson?: boolean }
  ): Promise<CommandResult>;
  unsetConfig(path: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  addAgent(input: OpenClawAddAgentInput, options?: OpenClawCommandOptions): Promise<CommandResult>;
  deleteAgent(agentId: string, options?: OpenClawCommandOptions): Promise<CommandResult>;
  runAgentTurn(
    input: OpenClawAgentTurnInput,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
  streamAgentTurn(
    input: OpenClawAgentTurnInput,
    callbacks?: OpenClawStreamCallbacks,
    options?: OpenClawCommandOptions
  ): Promise<MissionCommandPayload>;
}
