import type { AgentStatus, ModelReadiness, RuntimeRecord } from "@/lib/openclaw/types";

type RuntimeLike = {
  status?: RuntimeRecord["status"] | string;
  taskId?: string | null;
};

type AgentLike = {
  id: string;
  status: AgentStatus;
};

type ModelLike = {
  key: string;
  local?: boolean;
  available?: boolean;
  missing?: boolean;
};

type ModelAuthProvider = {
  provider: string;
  profiles?: {
    count?: number | null;
  } | null;
};

type ModelOauthProvider = {
  provider: string;
  status?: string | null;
};

type ModelAuthProviderLike = ModelAuthProvider | null;

type ModelOauthProviderLike = ModelOauthProvider | null;

type ModelStatusLike = {
  resolvedDefault?: string | null;
  defaultModel?: string | null;
  auth?: {
    providers?: ModelAuthProviderLike[] | null;
    oauth?: {
      providers?: ModelOauthProviderLike[] | null;
    } | null;
    missingProvidersInUse?: Array<string | null | undefined> | null;
    unusableProfiles?: Array<unknown> | null;
  } | null;
};

type UpdateInfoParams = {
  currentVersion?: string;
  latestVersion?: string;
  updateError?: string;
  legacyInfo?: string;
};

type DiagnosticHealthParams = {
  rpcOk: boolean | undefined;
  warningCount: number;
  runtimeIssueCount: number;
  hasOpenClawSignal: boolean;
};

export function resolveRuntimeStatus(
  stage: string | undefined,
  key: string | undefined,
  ageMs: number | undefined
): RuntimeRecord["status"] {
  if (stage === "in_progress") {
    return "running";
  }

  if (key?.endsWith(":main") && typeof ageMs === "number" && ageMs < 60 * 60 * 1000) {
    return "running";
  }

  if (stage === "completed" || stage === "done") {
    return "completed";
  }

  if (stage === "failed" || stage === "error") {
    return "stalled";
  }

  return "idle";
}

export function resolveAgentStatus(params: {
  rpcOk: boolean;
  activeRuntime: RuntimeRecord | undefined;
  heartbeatEnabled: boolean;
  lastActiveAt: number | null;
}): AgentStatus {
  if (!params.rpcOk) {
    return "offline";
  }

  if (params.activeRuntime?.status === "running" || params.activeRuntime?.status === "queued") {
    return "engaged";
  }

  if (params.heartbeatEnabled) {
    return "monitoring";
  }

  if (params.lastActiveAt) {
    return "ready";
  }

  return "standby";
}

export function resolveAgentAction(params: {
  runtime: RuntimeLike | undefined;
  heartbeatEvery: string | null;
  status: AgentStatus;
}) {
  if (params.runtime) {
    if (params.runtime.taskId) {
      if (params.runtime.status === "running" || params.runtime.status === "queued") {
        return `Tracking task ${params.runtime.taskId.slice(0, 8)}`;
      }

      if (params.runtime.status === "completed") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} completed`;
      }

      if (params.runtime.status === "cancelled") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} cancelled`;
      }

      if (params.runtime.status === "stalled") {
        return `Recent task ${params.runtime.taskId.slice(0, 8)} stalled`;
      }

      return `Recent task ${params.runtime.taskId.slice(0, 8)}`;
    }

    return params.runtime.status === "running" || params.runtime.status === "queued"
      ? "Maintaining main session context"
      : "Main session recently updated";
  }

  if (params.heartbeatEvery) {
    return `Heartbeat on ${params.heartbeatEvery}`;
  }

  if (params.status === "standby") {
    return "Waiting for assignment";
  }

  return "Ready for next turn";
}

export function resolveWorkspaceHealth(agentIds: string[], agents: AgentLike[]): AgentStatus {
  const workspaceAgents = agents.filter((agent) => agentIds.includes(agent.id));
  if (workspaceAgents.some((agent) => agent.status === "engaged")) {
    return "engaged";
  }
  if (workspaceAgents.some((agent) => agent.status === "monitoring")) {
    return "monitoring";
  }
  if (workspaceAgents.some((agent) => agent.status === "ready")) {
    return "ready";
  }
  if (workspaceAgents.some((agent) => agent.status === "offline")) {
    return "offline";
  }
  return "standby";
}

export function resolveModelReadiness(models: ModelLike[], modelStatus?: ModelStatusLike): ModelReadiness {
  const readyModels = models.filter((model) => isReadyModelRecord(model));
  const providerIds = unique(
    [
      ...models.map((model) => model.key.split("/")[0] || "unknown"),
      ...((modelStatus?.auth?.providers ?? []).map((entry) => entry?.provider).filter(isNonEmptyString)),
      ...((modelStatus?.auth?.oauth?.providers ?? []).map((entry) => entry?.provider).filter(isNonEmptyString))
    ].filter(isNonEmptyString)
  );
  const authProviderMap = new Map(
    (modelStatus?.auth?.providers ?? [])
      .filter((entry): entry is ModelAuthProvider => isNonEmptyString(entry?.provider))
      .map((entry) => [entry.provider, entry])
  );
  const oauthProviderMap = new Map(
    (modelStatus?.auth?.oauth?.providers ?? [])
      .filter((entry): entry is ModelOauthProvider => isNonEmptyString(entry?.provider))
      .map((entry) => [entry.provider, entry])
  );
  const resolvedDefaultModel = normalizeOptionalValue(modelStatus?.resolvedDefault ?? undefined);
  const defaultModel = normalizeOptionalValue(modelStatus?.defaultModel ?? undefined);
  const defaultModelId = resolvedDefaultModel ?? defaultModel;
  const defaultProvider = defaultModelId ? resolveModelProviderId(defaultModelId) : null;
  const defaultModelReady = Boolean(defaultModelId && readyModels.some((model) => model.key === defaultModelId));
  const recommendedModelId = defaultModelReady ? defaultModelId : readyModels[0]?.key ?? null;
  const authProviders = providerIds.map((provider) => {
    const providerModels = models.filter((model) => (model.key.split("/")[0] || "unknown") === provider);
    const hasRemoteRoute = providerModels.some((model) => model.local !== true);
    const providerAuth = authProviderMap.get(provider);
    const oauthStatus = oauthProviderMap.get(provider);
    const connected =
      providerModels.some((model) => isReadyModelRecord(model)) ||
      (providerAuth?.profiles?.count ?? 0) > 0 ||
      oauthStatus?.status === "ok";
    let detail: string | null = null;

    if (oauthStatus?.status === "ok") {
      detail = "OAuth connected";
    } else if ((providerAuth?.profiles?.count ?? 0) > 0) {
      detail = `${providerAuth?.profiles?.count} auth profile${providerAuth?.profiles?.count === 1 ? "" : "s"}`;
    } else if (providerModels.some((model) => model.local)) {
      detail = "Install or pull a local model to unlock this route.";
    } else if (hasRemoteRoute) {
      detail = resolveProviderSetupDetail(provider);
    }

    return {
      provider,
      connected,
      canLogin: hasRemoteRoute,
      detail
    };
  });
  const missingProvidersInUse = (modelStatus?.auth?.missingProvidersInUse ?? []).filter(isNonEmptyString);
  const missingProviderSet = new Set(missingProvidersInUse);
  const unusableProfileCount = modelStatus?.auth?.unusableProfiles?.length ?? 0;
  const issues: string[] = [];

  if (readyModels.length === 0) {
    issues.push("No available models were detected yet.");
  }

  if (readyModels.length > 0 && !defaultModelId) {
    issues.push("Choose a default model to finish setup.");
  }

  if (defaultModelId && !defaultModelReady) {
    if (defaultProvider && missingProviderSet.has(defaultProvider)) {
      issues.push(`Default model is set, but ${formatProviderLabel(defaultProvider)} auth is still missing.`);
    } else if (missingProvidersInUse.length > 0) {
      issues.push(`Default model is set, but auth is still missing for: ${missingProvidersInUse.join(", ")}.`);
    } else {
      issues.push("The selected default model is not ready yet.");
    }
  }

  if (missingProvidersInUse.length > 0 && !defaultModelId) {
    issues.push(`Auth is still missing for: ${missingProvidersInUse.join(", ")}.`);
  }

  if (unusableProfileCount > 0) {
    issues.push("Some stored model auth profiles are not usable.");
  }

  return {
    ready: readyModels.length > 0 && defaultModelReady,
    defaultModel: defaultModel ?? null,
    resolvedDefaultModel: resolvedDefaultModel ?? null,
    defaultModelReady,
    recommendedModelId: recommendedModelId ?? null,
    preferredLoginProvider:
      authProviders.find(
        (provider) =>
          provider.provider === defaultProvider && !provider.connected && provider.canLogin
      )?.provider ??
      missingProvidersInUse.find((provider) =>
        authProviders.some((entry) => entry.provider === provider && !entry.connected && entry.canLogin)
      ) ??
      authProviders.find((provider) => !provider.connected && provider.canLogin)?.provider ??
      (providerIds.includes("openai-codex") || readyModels.length === 0 ? "openai-codex" : null),
    totalModelCount: models.length,
    availableModelCount: readyModels.length,
    localModelCount: readyModels.filter((model) => model.local).length,
    remoteModelCount: readyModels.filter((model) => model.local !== true).length,
    missingModelCount: models.filter((model) => model.missing || model.available === false).length,
    authProviders,
    issues: unique(issues)
  };
}

export function isReadyModelRecord(model: ModelLike) {
  return model.available !== false && !model.missing;
}

export function resolveModelProviderId(modelId: string) {
  const [provider] = modelId.split("/", 1);
  return provider || null;
}

export function formatProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openrouter") {
    return "OpenRouter";
  }

  if (normalized === "openai-codex") {
    return "OpenAI Codex";
  }

  if (normalized === "openai") {
    return "OpenAI";
  }

  if (normalized === "anthropic") {
    return "Anthropic";
  }

  if (normalized === "ollama") {
    return "Ollama";
  }

  if (normalized === "xai") {
    return "xAI";
  }

  if (normalized === "gemini") {
    return "Gemini";
  }

  if (normalized === "deepseek") {
    return "DeepSeek";
  }

  if (normalized === "mistral") {
    return "Mistral";
  }

  return provider
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function resolveProviderSetupDetail(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openai-codex") {
    return "Use the ChatGPT account-based login flow in terminal to use this route.";
  }

  if (
    normalized === "openrouter" ||
    normalized === "openai" ||
    normalized === "anthropic" ||
    normalized === "xai" ||
    normalized === "gemini" ||
    normalized === "deepseek" ||
    normalized === "mistral"
  ) {
    return `Add your ${formatProviderLabel(provider)} API key in terminal to use this route.`;
  }

  return `Connect ${formatProviderLabel(provider)} auth in terminal to use this route.`;
}

export function resolveDiagnosticHealth(params: DiagnosticHealthParams) {
  if (!params.rpcOk && !params.hasOpenClawSignal) {
    return "offline";
  }

  if (!params.rpcOk || params.warningCount > 0 || params.runtimeIssueCount > 0) {
    return "degraded";
  }

  return "healthy";
}

export function collectIssues(results: Record<string, PromiseSettledResult<unknown>>) {
  return Object.entries(results)
    .flatMap(([key, result]) => {
      if (result.status !== "rejected") {
        return [];
      }

      return [`${key}: ${result.reason instanceof Error ? result.reason.message : String(result.reason)}`];
    });
}

export function resolveUpdateInfo(params: UpdateInfoParams) {
  const legacyInfo = normalizeOptionalValue(params.legacyInfo);

  if (params.latestVersion && params.currentVersion) {
    const comparison = compareVersionStrings(params.latestVersion, params.currentVersion);

    if (comparison > 0) {
      return `Update available: v${params.latestVersion} is ready. Current version: v${params.currentVersion}.`;
    }

    if (comparison === 0) {
      return `OpenClaw is up to date on v${params.currentVersion}.`;
    }

    return `Running v${params.currentVersion}. Registry currently reports v${params.latestVersion}.`;
  }

  if (params.latestVersion) {
    return `Latest available version: v${params.latestVersion}. Current version could not be determined.`;
  }

  if (legacyInfo) {
    return legacyInfo;
  }

  if (params.updateError) {
    return `Update registry check failed: ${params.updateError}`;
  }

  return undefined;
}

export function compareVersionStrings(left: string, right: string) {
  const leftParts = tokenizeVersion(left);
  const rightParts = tokenizeVersion(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (typeof leftPart === "number" && typeof rightPart === "number") {
      if (leftPart !== rightPart) {
        return leftPart - rightPart;
      }

      continue;
    }

    const leftText = String(leftPart);
    const rightText = String(rightPart);

    if (leftText !== rightText) {
      return leftText.localeCompare(rightText);
    }
  }

  return 0;
}

export function tokenizeVersion(value: string) {
  return value
    .trim()
    .replace(/^v/i, "")
    .split(/[^0-9a-zA-Z]+/)
    .filter(Boolean)
    .map((part) => (/^\d+$/.test(part) ? Number(part) : part.toLowerCase()));
}

export function normalizeOptionalValue(value: string | null | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

export function normalizeUpdateError(value: string | undefined) {
  const normalized = normalizeOptionalValue(value);

  if (!normalized) {
    return undefined;
  }

  return normalized.split(/\r?\n/, 1)[0]?.trim() || normalized;
}

export function unique(values: string[]) {
  return Array.from(new Set(values));
}

export function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value);
}
