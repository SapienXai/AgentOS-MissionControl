import "server-only";

import { readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { setTimeout as delay } from "node:timers/promises";

import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { normalizeModelStatusPayload } from "@/lib/openclaw/client/native-ws-gateway-payloads";
import { containsRedactedOpenClawSecret } from "@/lib/openclaw/client/native-ws-gateway-utils";
import { getOpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";
import {
  isGatewayConfigRateLimitError,
  readGatewayConfigRateLimitRetryAfterMs
} from "@/lib/openclaw/client/native-ws-gateway-config";
import { normalizeClientError } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  mergeModelStatusWithGatewayCredentials,
  normalizeOpenAiModelId
} from "@/lib/openclaw/domains/model-provider-connection";
import {
  getModelProviderDescriptor,
  getModelProviderCredentialTarget,
  modelProviderCredentialRegistry,
  isAddModelsProviderId,
  isBuiltInAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import { redactSecretText } from "@/lib/security/redaction";
import type {
  AddModelsProviderConnectionStatus,
  AddModelsProviderConfigSummary,
  AddModelsProviderId
} from "@/lib/openclaw/types";
import type {
  ModelsStatusPayload,
  OpenClawModelAuthStatusPayload
} from "@/lib/openclaw/client/gateway-client";

type OpenClawConfigPayload = {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  auth?: {
    profiles?: Record<string, { provider?: string; mode?: string; type?: string; status?: string; expiresAt?: number }>;
  };
  plugins?: {
    allow?: string[];
    entries?: Record<string, Record<string, unknown>>;
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
      };
      models?: Record<string, OpenClawModelDefaultsEntry>;
    };
  };
  models?: {
    providers?: Record<string, OpenClawProviderModelsEntry>;
  };
};

type OpenClawModelDefaultsEntry = Record<string, unknown> & {
  agentRuntime?: {
    id?: string;
  };
};

export type OpenClawProviderModelsEntry = Record<string, unknown> & {
  models?: OpenClawProviderModelEntry[];
  baseUrl?: string;
  baseURL?: string;
  apiKey?: unknown;
  api?: string;
  name?: string;
  label?: string;
};

export type OpenClawProviderModelEntry = Record<string, unknown> & {
  id?: string;
  name?: string;
  input?: string | string[];
  contextWindow?: number | null;
  maxTokens?: number | null;
};

export type OpenClawExplicitProviderSummary = {
  id: string;
  baseUrl: string | null;
  modelCount: number;
};

type OpenClawAuthProfilesPayload = {
  version?: number;
  profiles?: Record<
    string,
    {
      type?: string;
      provider?: string;
      mode?: string;
      status?: string;
      expiresAt?: number;
      token?: string;
    }
  >;
  usageStats?: Record<
    string,
    {
      errorCount?: number;
      lastUsed?: number;
    }
  >;
};

const openClawConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
const openClawAuthProfilesPath = path.join(
  os.homedir(),
  ".openclaw",
  "agents",
  "main",
  "agent",
  "auth-profiles.json"
);
const gatewayConfigPatchRetryDelaysMs = [750, 1_500, 3_000];
const maxInlineGatewayConfigRateLimitRetryMs = 3_000;
const googleGenerativeAiBaseUrl = "https://generativelanguage.googleapis.com/v1beta";
const ollamaLocalBaseUrl = "http://127.0.0.1:11434";
export const OLLAMA_LOCAL_API_KEY_MARKER = "ollama-local";

type OpenClawAgentDefaultsConfig = NonNullable<NonNullable<OpenClawConfigPayload["agents"]>["defaults"]>;

export async function readOpenClawConfiguredModelIds() {
  try {
    const defaults = await getOpenClawAdapter().getConfig<OpenClawAgentDefaultsConfig>(
      "agents.defaults",
      { timeoutMs: 5_000 }
    );

    if (isRecord(defaults)) {
      return readConfiguredModelIdsFromDefaults(defaults);
    }
  } catch {
    // Local file read remains an offline recovery fallback when Gateway config is unavailable.
  }

  const config = await readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {});
  return readConfiguredModelIdsFromDefaults(config.agents?.defaults);
}

function readConfiguredModelIdsFromDefaults(defaults: OpenClawAgentDefaultsConfig | undefined) {
  const modelEntries = defaults?.models ?? {};
  const primaryModel = defaults?.model?.primary?.trim() ?? "";

  return new Set([...Object.keys(modelEntries), primaryModel].filter(Boolean));
}

export type OpenClawProviderModelStatusOptions = {
  /** Reload OpenClaw's in-memory auth state after an external CLI mutation. */
  refreshAuth?: boolean;
};

export class OpenClawModelAuthRefreshError extends Error {
  readonly causeError: unknown;

  constructor(message: string, causeError: unknown) {
    super(message);
    this.name = "OpenClawModelAuthRefreshError";
    this.causeError = causeError;
  }
}

export async function readOpenClawProviderModelStatus(
  options: OpenClawProviderModelStatusOptions = {}
): Promise<ModelsStatusPayload | null> {
  try {
    const adapter = getOpenClawAdapter();
    const status = options.refreshAuth
      ? normalizeModelStatusPayload(
          await (adapter.refreshModelAuthStatus?.({ timeoutMs: 8_000 }) ??
            adapter.call<OpenClawModelAuthStatusPayload>(
              "models.authStatus",
              { refresh: true },
              { timeoutMs: 8_000 }
            )),
          { models: [] }
        )
      : await adapter.getModelStatus({ timeoutMs: 8_000 });
    const credentialProviders = await readOpenClawConfiguredProviderCredentialIds();

    // A forced auth refresh invalidates the upstream runtime state, but it
    // does not need to rediscover models. Catalog discovery is deliberately a
    // separate step so a catalog outage cannot erase a verified login.
    if (options.refreshAuth) {
      adapter.invalidateReadCache?.();
    }

    return mergeModelStatusWithGatewayCredentials(status, credentialProviders);
  } catch (error) {
    if (options.refreshAuth) {
      throw new OpenClawModelAuthRefreshError(
        `OpenClaw Gateway auth refresh failed: ${normalizeClientError(error).message}`,
        error
      );
    }

    return null;
  }
}

export async function readOpenClawConfiguredProviderCredentialIds(): Promise<AddModelsProviderId[]> {
  try {
    const adapter = getOpenClawAdapter();
    const providers = Object.keys(modelProviderCredentialRegistry) as AddModelsProviderId[];
    const configured = await Promise.all(providers.map(async (provider) => {
      const target = getModelProviderCredentialTarget(provider);
      if (!target) {
        return null;
      }

      const value = await adapter.getConfig<unknown>(target.configPath, { timeoutMs: 5_000 });
      return isConfiguredCredentialValue(value) ? provider : null;
    }));

    return configured.filter((provider): provider is AddModelsProviderId => Boolean(provider));
  } catch {
    return [];
  }
}

export async function readOpenClawCodexPluginReady(): Promise<boolean> {
  const plugins = await getOpenClawAdapter().listPlugins({ timeoutMs: 5_000 });

  return plugins.plugins.some(isReadyCodexPlugin);
}

export async function buildOpenClawFileBasedProviderConnectionStatus(
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>
): Promise<AddModelsProviderConnectionStatus> {
  const [config, authProfiles] = await Promise.all([
    readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {}),
    readJsonFile<OpenClawAuthProfilesPayload>(openClawAuthProfilesPath, {
      version: 1
    })
  ]);
  const descriptor = getModelProviderDescriptor(provider);
  const configuredCount = [...configuredModelIds].filter(
    (modelId) => modelMatchesProvider(provider, modelId)
  ).length;
  const providerAuthEntries: Array<{
    profileId: string;
    provider?: string;
    type?: string;
    mode?: string;
    status?: string;
    expiresAt?: number;
  }> = [
    ...Object.entries(config.auth?.profiles ?? {}).map(([profileId, entry]) => ({ profileId, ...entry })),
    ...Object.entries(authProfiles.profiles ?? {}).map(([profileId, entry]) => ({ profileId, ...entry }))
  ]
    .filter((entry) => providerAuthEntryMatchesAddModelsProvider(entry, provider))
    .filter(isUsableFileAuthEntry);
  const providerAuthCount = providerAuthEntries.length;
  const customEndpoint = provider === "openai" ? readOpenAiBaseUrl(config) : null;
  const hasOpenAiApiKey = provider === "openai" ? Boolean(readOpenAiApiKey(config)) : false;
  const hasOpenAiOAuthProfile = provider === "openai" && providerAuthEntries.some((entry) =>
    entry.mode?.toLowerCase() === "oauth" || entry.type?.toLowerCase() === "oauth"
  );
  const connected = providerAuthCount > 0 ||
    (provider === "openai" && hasOpenAiApiKey);

  return {
    provider,
    authMethod: hasOpenAiOAuthProfile ? "chatgpt-oauth" : hasOpenAiApiKey ? "api-key" : null,
    availableAuthMethods: descriptor.authMethods ? [...descriptor.authMethods] : undefined,
    connected,
    canConnect: true,
    needsTerminal: descriptor.connectKind === "oauth",
    source: "legacy-file",
    degraded: true,
    stale: true,
    recovery: connected
      ? "Reconnect this provider through Gateway-backed OpenClaw auth so AgentOS can verify live readiness."
      : `Connect ${descriptor.shortLabel} through OpenClaw Gateway before using these configured models.`,
    detail:
      connected
        ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} in AgentOS.${customEndpoint ? ` Custom endpoint: ${customEndpoint}.` : ""}`
        : configuredCount > 0
          ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} are already saved in AgentOS. Connect ${descriptor.shortLabel} to use them.${customEndpoint ? ` Custom endpoint: ${customEndpoint}.` : ""}`
          : customEndpoint
            ? `Custom endpoint: ${customEndpoint}. Connect ${descriptor.shortLabel} to use it.`
            : descriptor.helperText
  };
}

export async function persistOpenClawOpenAiProviderConfig(
  apiKey: string,
  options?: { endpoint?: string }
) {
  const adapter = getOpenClawAdapter();
  const existingProviderConfig = await adapter.getConfig<OpenClawProviderModelsEntry>(
    "models.providers.openai",
    { timeoutMs: 5_000 }
  );
  const nextProviderConfig = cloneProviderCredentialOverlay(existingProviderConfig);
  const trimmedApiKey = apiKey.trim();
  const trimmedEndpoint = options?.endpoint?.trim();
  const existingBaseUrl = readProviderConfigBaseUrl(nextProviderConfig);
  const repairedBlankEndpoint =
    isRecord(existingProviderConfig) &&
    (("baseUrl" in existingProviderConfig && !existingBaseUrl) ||
      ("baseURL" in existingProviderConfig && !existingBaseUrl));

  nextProviderConfig.apiKey = trimmedApiKey;

  if (trimmedEndpoint) {
    if (!isConcreteHttpEndpoint(trimmedEndpoint)) {
      throw new Error("The provider endpoint must be a valid HTTP or HTTPS URL.");
    }
    nextProviderConfig.baseUrl = trimmedEndpoint;
    delete nextProviderConfig.baseURL;
  } else if (!existingBaseUrl) {
    delete nextProviderConfig.baseUrl;
    delete nextProviderConfig.baseURL;
  }

  await adapter.setConfig("models.providers.openai", nextProviderConfig, { timeoutMs: 5_000 });
  return { repairedBlankEndpoint };
}

export async function readOpenClawExplicitProviderConfig(provider: string) {
  const providerId = provider.trim();

  if (!providerId) {
    return null;
  }

  try {
    return await getOpenClawAdapter().getConfig<OpenClawProviderModelsEntry>(
      `models.providers.${providerId}`,
      { timeoutMs: 5_000 }
    );
  } catch {
    return null;
  }
}

export async function readOpenClawOpenAiProviderConfig(): Promise<OpenClawProviderModelsEntry | null> {
  try {
    return await getOpenClawAdapter().getConfig<OpenClawProviderModelsEntry>(
      "models.providers.openai",
      { timeoutMs: 5_000 }
    );
  } catch {
    return null;
  }
}

export async function readOpenClawExplicitProviderSummaries(): Promise<OpenClawExplicitProviderSummary[]> {
  let providers: Record<string, OpenClawProviderModelsEntry> | null = null;

  try {
    providers = await getOpenClawAdapter().getConfig<Record<string, OpenClawProviderModelsEntry>>(
      "models.providers",
      { timeoutMs: 5_000 }
    );
  } catch {
    return [];
  }

  if (!isRecord(providers)) {
    return [];
  }

  return Object.entries(providers)
    .filter(([providerId, providerConfig]) =>
      isAddModelsProviderId(providerId) &&
      !isBuiltInAddModelsProviderId(providerId) &&
      isRecord(providerConfig)
    )
    .map(([providerId, providerConfig]) => ({
      id: providerId,
      baseUrl: readProviderConfigBaseUrl(providerConfig),
      modelCount: Array.isArray(providerConfig.models) ? providerConfig.models.length : 0
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
}

export async function readOpenClawProviderConfigSummary(
  provider: AddModelsProviderId
): Promise<AddModelsProviderConfigSummary> {
  const providerConfig = await readOpenClawExplicitProviderConfig(resolveProviderConfigId(provider));
  const baseUrl = providerConfig ? readProviderConfigBaseUrl(providerConfig) : null;
  const credentialConfigured = providerConfig
    ? isConfiguredCredentialValue(providerConfig.apiKey)
    : await readOpenClawProviderCredentialConfigured(provider);

  return {
    provider,
    kind: isBuiltInAddModelsProviderId(provider) ? "builtin" : "custom",
    providerId: provider,
    baseUrl,
    api: typeof providerConfig?.api === "string" && providerConfig.api.trim()
      ? providerConfig.api.trim()
      : null,
    modelCount: Array.isArray(providerConfig?.models) ? providerConfig.models.length : 0,
    credentialConfigured,
    endpointOverride: Boolean(baseUrl),
    editable: provider !== "ollama"
  };
}

export async function updateOpenClawProviderSettings(
  provider: AddModelsProviderId,
  input: {
    endpoint?: string | null;
    api?: string;
  }
) {
  const adapter = getOpenClawAdapter();
  const configProvider = resolveProviderConfigId(provider);
  const isBuiltIn = isBuiltInAddModelsProviderId(provider);
  const existingProviderConfig = await readOpenClawExplicitProviderConfig(configProvider);

  if (provider === "ollama") {
    throw new Error(`${getModelProviderDescriptor(provider).shortLabel} connection settings are managed by OpenClaw.`);
  }

  if (!isBuiltIn && !existingProviderConfig) {
    throw new Error("Custom provider configuration no longer exists in OpenClaw.");
  }

  if (input.endpoint !== undefined) {
    const endpoint = input.endpoint?.trim() || null;

    if (!endpoint) {
      if (!isBuiltIn) {
        throw new Error("Custom providers require a base URL.");
      }
      if (isRecord(existingProviderConfig) && "baseUrl" in existingProviderConfig) {
        await adapter.unsetConfig(`models.providers.${configProvider}.baseUrl`, { timeoutMs: 5_000 });
      }
      if (isRecord(existingProviderConfig) && "baseURL" in existingProviderConfig) {
        await adapter.unsetConfig(`models.providers.${configProvider}.baseURL`, { timeoutMs: 5_000 });
      }
    } else {
      if (!isConcreteHttpEndpoint(endpoint)) {
        throw new Error("The provider endpoint must be a valid HTTP or HTTPS URL.");
      }
      await adapter.setConfig(`models.providers.${configProvider}.baseUrl`, endpoint, { timeoutMs: 5_000 });
      await adapter.unsetConfig(`models.providers.${configProvider}.baseURL`, { timeoutMs: 5_000 }).catch(() => undefined);
    }
  }

  if (input.api !== undefined) {
    if (isBuiltIn) {
      throw new Error("Bundled provider API modes are managed by OpenClaw.");
    }

    const api = input.api.trim();
    if (!supportedCustomProviderApis.has(api)) {
      throw new Error("Choose a supported OpenClaw provider API mode.");
    }
    await adapter.setConfig(`models.providers.${configProvider}.api`, api, { timeoutMs: 5_000 });
  }

  return readOpenClawProviderConfigSummary(provider);
}

/**
 * OpenClaw uses a non-secret marker to authenticate local Ollama endpoints.
 * The provider is still local-only; this value only prevents the Gateway from
 * treating the provider as an unconfigured remote API.
 */
export async function ensureOpenClawOllamaLocalCredential() {
  const adapter = getOpenClawAdapter();
  const providerConfig = await readOpenClawExplicitProviderConfig("ollama");
  const configuredBaseUrl = providerConfig ? readProviderConfigBaseUrl(providerConfig) : null;
  const isLocalProvider = !configuredBaseUrl || isLoopbackProviderUrl(configuredBaseUrl);
  let configured = false;

  if (!configuredBaseUrl) {
    await adapter.setConfig("models.providers.ollama.baseUrl", ollamaLocalBaseUrl, { timeoutMs: 5_000 });
    configured = true;
  }

  if (!providerConfig?.api?.trim()) {
    await adapter.setConfig("models.providers.ollama.api", "ollama", { timeoutMs: 5_000 });
    configured = true;
  }

  if (isLocalProvider && (!providerConfig || !isConfiguredCredentialValue(providerConfig.apiKey))) {
    await adapter.setConfig(
      "models.providers.ollama.apiKey",
      OLLAMA_LOCAL_API_KEY_MARKER,
      { timeoutMs: 5_000 }
    );
    configured = true;
  }

  return { configured };
}

export async function removeOpenClawProviderCredential(provider: AddModelsProviderId) {
  const target = getModelProviderCredentialTarget(provider);

  if (!target) {
    return {
      removed: false,
      credentialCleanup: provider === "ollama" ? "not-required" as const : "retained-unsupported" as const
    };
  }

  const configured = await readOpenClawProviderCredentialConfigured(provider);

  if (configured) {
    await getOpenClawAdapter().unsetConfig(target.configPath, { timeoutMs: 5_000 });
  }

  return {
    removed: configured,
    credentialCleanup: "removed" as const
  };
}

export async function replaceOpenClawProviderCredential(
  provider: AddModelsProviderId,
  credential: string
) {
  const apiKey = credential.trim();

  if (!apiKey) {
    throw new Error("Enter an API key to replace the provider credential.");
  }

  if (isBuiltInAddModelsProviderId(provider)) {
    if (provider === "openai") {
      return persistOpenClawOpenAiProviderConfig(apiKey);
    }
    return persistOpenClawProviderToken(provider, apiKey);
  }

  const providerConfig = await readOpenClawExplicitProviderConfig(provider);
  const baseUrl = providerConfig ? readProviderConfigBaseUrl(providerConfig) : null;

  if (!providerConfig || !baseUrl) {
    throw new Error("Custom provider configuration no longer exists in OpenClaw.");
  }

  await persistOpenClawExplicitProviderConfig(provider, {
    baseUrl,
    apiKey,
    api: typeof providerConfig.api === "string" ? providerConfig.api : "openai-completions",
    models: providerConfig.models ?? []
  });

  return { repairedBlankEndpoint: false };
}

export async function persistOpenClawExplicitProviderConfig(
  provider: string,
  input: {
    providerName?: string | null;
    baseUrl: string;
    apiKey: string;
    api?: string;
    models?: OpenClawProviderModelEntry[];
  }
) {
  const providerId = provider.trim();
  const existingProviderConfig = await readOpenClawExplicitProviderConfig(providerId);
  const nextProviderConfig = cloneProviderModelsEntry(existingProviderConfig);

  nextProviderConfig.baseUrl = input.baseUrl.trim();
  delete nextProviderConfig.baseURL;
  nextProviderConfig.apiKey = input.apiKey.trim();
  nextProviderConfig.api = input.api?.trim() || "openai-completions";

  if (input.models?.length) {
    nextProviderConfig.models = mergeProviderModelEntries(nextProviderConfig.models ?? [], input.models);
  }

  await getOpenClawAdapter().setConfig(
    `models.providers.${providerId}`,
    sanitizeProviderConfigForOpenClaw(nextProviderConfig),
    { timeoutMs: 5_000 }
  );
}

export async function addOpenClawExplicitProviderModelsToConfig(
  provider: string,
  modelIds: string[],
  metadata: OpenClawProviderModelEntry[] = []
) {
  const providerId = provider.trim();
  const normalizedModelIds = modelIds
    .map((modelId) => normalizeExplicitProviderModelId(providerId, modelId))
    .filter(Boolean);

  if (!providerId || normalizedModelIds.length === 0) {
    return;
  }

  const adapter = getOpenClawAdapter();
  const existingProviderConfig = await readOpenClawExplicitProviderConfig(providerId);
  const nextProviderConfig = cloneProviderModelsEntry(existingProviderConfig);
  const metadataById = new Map(
    metadata
      .map((entry) => [entry.id?.trim(), entry] as const)
      .filter((entry): entry is [string, OpenClawProviderModelEntry] => Boolean(entry[0]))
  );
  nextProviderConfig.models = mergeProviderModelEntries(
    nextProviderConfig.models ?? [],
    normalizedModelIds.map((modelId) => ({
      id: modelId,
      name: metadataById.get(modelId)?.name || modelId,
      input: metadataById.get(modelId)?.input || "text",
      contextWindow: metadataById.get(modelId)?.contextWindow,
      maxTokens: metadataById.get(modelId)?.maxTokens
    }))
  );

  await adapter.setConfig(
    `models.providers.${providerId}.models`,
    mergeProviderModelEntries([], nextProviderConfig.models ?? []),
    { timeoutMs: 5_000 }
  );

  // Catalog discovery and provider model definitions do not imply aliases or
  // per-model settings. Keep agents.defaults.models reserved for the native
  // OpenClaw alias/settings surface rather than using it as an AgentOS
  // allowlist.
}

export async function persistOpenClawProviderToken(
  provider: AddModelsProviderId,
  token: string,
  options?: { endpoint?: string }
) {
  const target = getModelProviderCredentialTarget(provider);

  if (!target) {
    throw new Error(`OpenClaw does not support API-key configuration for ${getModelProviderDescriptor(provider).shortLabel}.`);
  }

  // config.patch is optimistic/atomic in the native client. The retry only
  // covers Gateway cooldown or a revision race; it never falls back to files.
  return persistProviderCredentialViaGateway(provider, target, token.trim(), options?.endpoint);
}

async function persistProviderCredentialViaGateway(
  provider: AddModelsProviderId,
  target: NonNullable<ReturnType<typeof getModelProviderCredentialTarget>>,
  credential: string,
  endpoint?: string
) {
  let lastError: unknown = null;
  const adapter = getOpenClawAdapter();
  const requestedEndpoint = endpoint?.trim();

  if (requestedEndpoint && !isConcreteHttpEndpoint(requestedEndpoint)) {
    throw new Error("The provider endpoint must be a valid HTTP or HTTPS URL.");
  }

  for (let attempt = 0; attempt <= gatewayConfigPatchRetryDelaysMs.length; attempt += 1) {
    try {
      const existingProviderConfig = await adapter.getConfig<OpenClawProviderModelsEntry>(
        `models.providers.${provider}`,
        { timeoutMs: 5_000 }
      );
      const existingBaseUrl = isRecord(existingProviderConfig)
        ? readProviderConfigBaseUrl(existingProviderConfig)
        : null;
      const repairedBlankEndpoint =
        isRecord(existingProviderConfig) &&
        (("baseUrl" in existingProviderConfig && !existingBaseUrl) ||
          ("baseURL" in existingProviderConfig && !existingBaseUrl));

      if (requestedEndpoint) {
        await adapter.setConfig(`models.providers.${provider}.baseUrl`, requestedEndpoint, { timeoutMs: 5_000 });
        await adapter.unsetConfig(`models.providers.${provider}.baseURL`, { timeoutMs: 5_000 });
      } else if (repairedBlankEndpoint) {
        await adapter.unsetConfig(`models.providers.${provider}.baseUrl`, { timeoutMs: 5_000 });
        await adapter.unsetConfig(`models.providers.${provider}.baseURL`, { timeoutMs: 5_000 });
      }

      await adapter.setConfig(target.configPath, credential, { timeoutMs: 5_000 });
      return { repairedBlankEndpoint };
    } catch (error) {
      lastError = error;

      const retryDelayMs = resolveGatewayConfigPatchRetryDelayMs(error, attempt);

      if (retryDelayMs === null) {
        throw new Error(buildProviderCredentialMutationFailureMessage(provider, error));
      }

      await tryStartGatewayAfterTransientConfigFailure(error);
      await delay(retryDelayMs);
    }
  }

  throw new Error(buildProviderCredentialMutationFailureMessage(provider, lastError));
}

function cloneProviderCredentialOverlay(value: unknown): OpenClawProviderModelsEntry {
  if (!isRecord(value)) {
    return {};
  }

  return {
    ...value,
    ...(Array.isArray(value.models)
      ? {
          models: value.models
            .filter(isRecord)
            .map((entry) => ({ ...entry } as OpenClawProviderModelEntry))
        }
      : {})
  };
}

function isConcreteHttpEndpoint(value: string | null | undefined) {
  if (!value) {
    return false;
  }

  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

const supportedCustomProviderApis = new Set([
  "openai-completions",
  "openai-responses",
  "anthropic-messages",
  "google-generative-ai"
]);

function buildProviderCredentialMutationFailureMessage(provider: AddModelsProviderId, error: unknown) {
  const message = readErrorMessage(error);

  if (/config validation failed: models\.providers\.[^.]+\.baseurl: too small/i.test(message)) {
    return `OpenClaw did not accept the ${getModelProviderDescriptor(provider).shortLabel} endpoint. Remove or replace the provider endpoint, then retry the connection.`;
  }

  if (isGatewayConfigRateLimitError(error) || isGatewayConfigSettleError(error)) {
    return "The Gateway configuration is temporarily unavailable. Try again.";
  }

  return "OpenClaw did not accept this provider configuration. Review the Gateway logs.";
}

export async function readOpenClawProviderCredentialConfigured(provider: AddModelsProviderId) {
  const target = getModelProviderCredentialTarget(provider);

  if (!target) {
    return false;
  }

  try {
    const value = await getOpenClawAdapter().getConfig<unknown>(target.configPath, { timeoutMs: 5_000 });
    return isConfiguredCredentialValue(value);
  } catch {
    return false;
  }
}

function isConfiguredCredentialValue(value: unknown) {
  if (typeof value === "string") {
    return value.trim().length > 0;
  }

  if (!isRecord(value)) {
    return false;
  }

  const source = typeof value.source === "string" ? value.source.trim() : "";
  const id = typeof value.id === "string" ? value.id.trim() : "";
  return (source === "env" || source === "file" || source === "exec") && id.length > 0;
}

export async function addOpenClawModelsToConfig(provider: AddModelsProviderId, modelIds: string[]) {
  const normalizedModelIds = modelIds.map((modelId) => normalizeModelIdForProvider(provider, modelId));

  try {
    await addModelsToConfigViaGateway(provider, normalizedModelIds);
    return;
  } catch (error) {
    throw new Error(buildGatewayConfigMutationFailureMessage("adding models", error));
  }
}

export async function removeOpenClawConfiguredModelFromConfig(
  modelId: string,
  options: { provider?: AddModelsProviderId | null } = {}
) {
  const requestedModelId = modelId.trim();
  const provider = options.provider ?? resolveProviderFromModelIdForRuntime(requestedModelId);
  const canonicalModelId = normalizeOpenAiModelId(requestedModelId);

  if (!requestedModelId) {
    return {
      modelId: canonicalModelId,
      provider,
      via: "skipped" as const
    };
  }

  try {
    await removeOpenClawConfiguredModelViaGateway(provider, canonicalModelId, requestedModelId);
    return {
      modelId: canonicalModelId,
      provider,
      via: "gateway" as const
    };
  } catch (error) {
    throw new Error(buildGatewayConfigMutationFailureMessage("removing the model", error));
  }
}

export async function removeOpenClawProviderConfiguration(provider: AddModelsProviderId) {
  const adapter = getOpenClawAdapter();
  const configProvider = resolveProviderConfigId(provider);
  let providerConfigRemoved = false;
  let authMetadataRemoved = 0;

  const providerConfig = await adapter.getConfig<OpenClawProviderModelsEntry>(
    `models.providers.${configProvider}`,
    { timeoutMs: 5_000 }
  ).catch(() => null);

  if (providerConfig) {
    await adapter.unsetConfig(`models.providers.${configProvider}`, { timeoutMs: 5_000 });
    providerConfigRemoved = true;
  }

  const authProfiles = await adapter.getConfig<Record<string, { provider?: string }>>(
    "auth.profiles",
    { timeoutMs: 5_000 }
  ).catch(() => null);

  for (const [profileId, profile] of Object.entries(authProfiles ?? {})) {
    if (!providerAuthEntryMatchesAddModelsProvider(profile, provider)) {
      continue;
    }

    await adapter.unsetConfig(buildQuotedConfigKeyPath("auth.profiles", profileId), { timeoutMs: 5_000 });
    authMetadataRemoved += 1;
  }

  return {
    providerConfigRemoved,
    authMetadataRemoved,
    credentialCleanup: resolveProviderCredentialCleanup(provider, providerConfigRemoved)
  };
}

function resolveProviderCredentialCleanup(
  provider: AddModelsProviderId,
  providerConfigRemoved: boolean
): "removed" | "not-required" | "retained-unsupported" {
  if (provider === "ollama") {
    return "not-required";
  }

  if (providerConfigRemoved) {
    return "removed";
  }

  return "retained-unsupported";
}

export async function ensureOpenClawModelRuntimeConfig(
  modelId: string,
  options: { provider?: AddModelsProviderId | null } = {}
) {
  const requestedModelId = modelId.trim();
  const provider = options.provider ?? resolveProviderFromModelIdForRuntime(requestedModelId);

  if (!requestedModelId || !provider) {
    return {
      modelId: requestedModelId,
      provider,
      via: "skipped" as const
    };
  }

  const normalizedModelId = normalizeModelIdForProvider(provider, requestedModelId);

  try {
    await ensureModelRuntimeConfigViaGateway(provider, normalizedModelId);
    return {
      modelId: normalizedModelId,
      provider,
      via: "gateway" as const
    };
  } catch (error) {
    throw new Error(buildGatewayConfigMutationFailureMessage("preparing the model runtime", error));
  }
}

export async function setOpenClawDefaultModel(
  modelId: string,
  options: { provider?: AddModelsProviderId | null } = {}
) {
  const requestedModelId = modelId.trim();
  const provider = options.provider ?? resolveProviderFromModelId(requestedModelId);
  const normalizedModelId = provider ? normalizeModelIdForProvider(provider, requestedModelId) : requestedModelId;

  try {
    await setDefaultModelViaGateway(provider, normalizedModelId);
    return {
      modelId: normalizedModelId,
      provider,
      via: "gateway" as const
    };
  } catch (error) {
    throw new Error(buildGatewayConfigMutationFailureMessage("setting the default model", error));
  }
}

async function addModelsToConfigViaGateway(provider: AddModelsProviderId, normalizedModelIds: string[]) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= gatewayConfigPatchRetryDelaysMs.length; attempt += 1) {
    try {
      await addModelsToConfigViaGatewayOnce(provider, normalizedModelIds);
      return;
    } catch (error) {
      lastError = error;
      const retryDelayMs = resolveGatewayConfigPatchRetryDelayMs(error, attempt);

      if (retryDelayMs === null) {
        throw error;
      }

      await tryStartGatewayAfterTransientConfigFailure(error);
      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

async function addModelsToConfigViaGatewayOnce(provider: AddModelsProviderId, normalizedModelIds: string[]) {
  const adapter = getOpenClawAdapter();
  await ensureProviderModelRegistryViaGateway(adapter, provider, normalizedModelIds);

  const existingDefaults = await adapter.getConfig<OpenClawAgentDefaultsConfig>(
    "agents.defaults",
    { timeoutMs: 5_000 }
  );
  const nextDefaults = cloneAgentDefaults(existingDefaults);
  const nextModels = cloneModelEntries(nextDefaults.models);

  for (const modelId of normalizedModelIds) {
    nextModels[modelId] = isRecord(nextModels[modelId]) ? nextModels[modelId] : {};
  }

  nextDefaults.models = nextModels;

  if (!nextDefaults.model?.primary && normalizedModelIds[0]) {
    nextDefaults.model = {
      ...(nextDefaults.model || {}),
      primary: normalizedModelIds[0]
    };
  }

  await adapter.setConfig("agents.defaults", nextDefaults, { timeoutMs: 5_000 });
}

async function setDefaultModelViaGateway(
  provider: AddModelsProviderId | null,
  normalizedModelId: string
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= gatewayConfigPatchRetryDelaysMs.length; attempt += 1) {
    try {
      await setDefaultModelViaGatewayOnce(provider, normalizedModelId);
      return;
    } catch (error) {
      lastError = error;
      const retryDelayMs = resolveGatewayConfigPatchRetryDelayMs(error, attempt);

      if (retryDelayMs === null) {
        throw error;
      }

      await tryStartGatewayAfterTransientConfigFailure(error);
      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

async function ensureModelRuntimeConfigViaGateway(provider: AddModelsProviderId, normalizedModelId: string) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= gatewayConfigPatchRetryDelaysMs.length; attempt += 1) {
    try {
      await ensureModelRuntimeConfigViaGatewayOnce(provider, normalizedModelId);
      return;
    } catch (error) {
      lastError = error;
      const retryDelayMs = resolveGatewayConfigPatchRetryDelayMs(error, attempt);

      if (retryDelayMs === null) {
        throw error;
      }

      await tryStartGatewayAfterTransientConfigFailure(error);
      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

async function ensureModelRuntimeConfigViaGatewayOnce(provider: AddModelsProviderId, normalizedModelId: string) {
  const adapter = getOpenClawAdapter();
  await ensureProviderModelRegistryViaGateway(adapter, provider, [normalizedModelId]);

  const existingDefaults = await adapter.getConfig<OpenClawAgentDefaultsConfig>(
    "agents.defaults",
    { timeoutMs: 5_000 }
  );

  if (isModelRuntimePrepared(existingDefaults, normalizedModelId)) {
    return;
  }

  const nextDefaults = cloneAgentDefaults(existingDefaults);
  const nextModels = cloneModelEntries(nextDefaults.models);

  nextModels[normalizedModelId] = isRecord(nextModels[normalizedModelId])
    ? nextModels[normalizedModelId]
    : {};
  nextDefaults.models = nextModels;
  await adapter.setConfig("agents.defaults", nextDefaults, { timeoutMs: 5_000 });
}

async function removeOpenClawConfiguredModelViaGateway(
  provider: AddModelsProviderId | null,
  canonicalModelId: string,
  requestedModelId: string
) {
  let lastError: unknown = null;

  for (let attempt = 0; attempt <= gatewayConfigPatchRetryDelaysMs.length; attempt += 1) {
    try {
      await removeOpenClawConfiguredModelViaGatewayOnce(provider, canonicalModelId, requestedModelId);
      return;
    } catch (error) {
      lastError = error;
      const retryDelayMs = resolveGatewayConfigPatchRetryDelayMs(error, attempt);

      if (retryDelayMs === null) {
        throw error;
      }

      await tryStartGatewayAfterTransientConfigFailure(error);
      await delay(retryDelayMs);
    }
  }

  throw lastError;
}

async function removeOpenClawConfiguredModelViaGatewayOnce(
  provider: AddModelsProviderId | null,
  canonicalModelId: string,
  requestedModelId: string
) {
  const adapter = getOpenClawAdapter();
  const existingDefaults = await adapter.getConfig<OpenClawAgentDefaultsConfig>(
    "agents.defaults",
    { timeoutMs: 5_000 }
  );
  const nextDefaults = cloneAgentDefaults(existingDefaults);
  const nextModels = cloneModelEntries(nextDefaults.models);
  const matchingModelIds = Object.keys(nextModels).filter(
    (modelId) => normalizeOpenAiModelId(modelId) === canonicalModelId
  );
  let changed = false;

  if (provider) {
    changed = await removeProviderModelEntryViaGateway(adapter, provider, canonicalModelId, requestedModelId) || changed;
  }

  // Rewrite the object once through the native Gateway instead of issuing one
  // config.unset per model key. Besides being less chatty, this avoids the
  // CLI-only fallback path for quoted/dynamic keys when the Gateway is healthy.
  for (const modelId of matchingModelIds) {
    delete nextModels[modelId];
    changed = true;
  }

  nextDefaults.models = nextModels;

  if (
    nextDefaults.model?.primary &&
    normalizeOpenAiModelId(nextDefaults.model.primary) === canonicalModelId
  ) {
    const nextPrimary = Object.keys(nextModels)[0];

    if (nextPrimary) {
      nextDefaults.model = {
        ...(nextDefaults.model || {}),
        primary: nextPrimary
      };
    } else {
      delete nextDefaults.model;
    }

    changed = true;
  }

  if (changed) {
    await adapter.setConfig("agents.defaults", nextDefaults, { timeoutMs: 5_000 });
  }

  const persistedModels = await adapter.getConfig<Record<string, OpenClawModelDefaultsEntry>>(
    "agents.defaults.models",
    { timeoutMs: 5_000 }
  );
  const removalPersisted = !Object.keys(isRecord(persistedModels) ? persistedModels : {}).some(
    (modelId) => normalizeOpenAiModelId(modelId) === canonicalModelId
  );

  if (!removalPersisted) {
    throw new Error(`OpenClaw kept ${canonicalModelId} in agents.defaults.models after removal.`);
  }
}

function buildQuotedConfigKeyPath(parentPath: string, key: string) {
  return `${parentPath}[${JSON.stringify(key)}]`;
}

async function removeProviderModelEntryViaGateway(
  adapter: ReturnType<typeof getOpenClawAdapter>,
  provider: AddModelsProviderId,
  canonicalModelId: string,
  requestedModelId: string
) {
  const configProvider = resolveProviderConfigId(provider);

  if (!configProvider) {
    return false;
  }

  const providerConfig = await adapter.getConfig<OpenClawProviderModelsEntry>(
    `models.providers.${configProvider}`,
    { timeoutMs: 5_000 }
  ).catch(() => null);
  const modelIndex = findProviderModelEntryIndex(providerConfig?.models ?? [], configProvider, canonicalModelId, requestedModelId);

  if (modelIndex < 0) {
    return false;
  }

  // OpenClaw's config.patch uses JSON Merge Patch semantics; nulling an array
  // slot does not remove that slot and can fail schema validation. Replace only
  // the models array so redacted provider credentials are never written back.
  const modelsPath = `models.providers.${configProvider}.models`;
  await adapter.setConfig(
    modelsPath,
    (providerConfig?.models ?? []).filter((_, index) => index !== modelIndex),
    { timeoutMs: 5_000, replacePaths: [modelsPath] }
  );
  return true;
}

function findProviderModelEntryIndex(
  models: OpenClawProviderModelEntry[],
  provider: string,
  canonicalModelId: string,
  requestedModelId: string
) {
  const targetIdentity = normalizeProviderModelIdentity(provider, canonicalModelId, requestedModelId);

  return models.findIndex((entry) =>
    normalizeProviderModelIdentity(provider, entry.id ?? "", entry.id ?? "") === targetIdentity
  );
}

function normalizeProviderModelIdentity(
  provider: string,
  modelId: string,
  alternateModelId?: string
) {
  const candidates = [modelId, alternateModelId].filter((value): value is string => Boolean(value));

  for (const candidate of candidates) {
    const trimmed = candidate.trim();
    if (!trimmed) {
      continue;
    }

    const canonical = normalizeOpenAiModelId(trimmed);
    const scoped = normalizeExplicitProviderModelId(provider, canonical);
    if (scoped) {
      return scoped.toLowerCase();
    }

    return canonical.toLowerCase();
  }

  return "";
}

function resolveProviderConfigId(provider: AddModelsProviderId) {
  return provider.trim();
}

function isModelRuntimePrepared(
  defaults: OpenClawAgentDefaultsConfig | null,
  modelId: string
) {
  const expectedRuntimeId = resolveModelScopedRuntimeId();

  if (!expectedRuntimeId) {
    return true;
  }

  if (!defaults) {
    return false;
  }

  return defaults.models?.[modelId]?.agentRuntime?.id === expectedRuntimeId;
}

async function setDefaultModelViaGatewayOnce(
  provider: AddModelsProviderId | null,
  normalizedModelId: string
) {
  const adapter = getOpenClawAdapter();
  await ensureProviderModelRegistryViaGateway(adapter, provider, [normalizedModelId]);

  const existingDefaults = await adapter.getConfig<OpenClawAgentDefaultsConfig>(
    "agents.defaults",
    { timeoutMs: 5_000 }
  );
  const nextDefaults = cloneAgentDefaults(existingDefaults);
  const nextModels = cloneModelEntries(nextDefaults.models);
  nextModels[normalizedModelId] = isRecord(nextModels[normalizedModelId])
    ? nextModels[normalizedModelId]
    : {};

  nextDefaults.models = nextModels;
  nextDefaults.model = {
    ...(nextDefaults.model || {}),
    primary: normalizedModelId
  };
  await adapter.setConfig("agents.defaults", nextDefaults, { timeoutMs: 5_000 });
}

function resolveGatewayConfigPatchRetryDelayMs(error: unknown, attempt: number) {
  if (attempt >= gatewayConfigPatchRetryDelaysMs.length) {
    return null;
  }

  const retryAfterMs = readGatewayConfigRateLimitRetryAfterMs(error);

  if (retryAfterMs !== null) {
    return retryAfterMs <= maxInlineGatewayConfigRateLimitRetryMs ? retryAfterMs : null;
  }

  const message = readErrorMessage(error);

  if (isGatewayConfigSettleError(error) ||
      /1012|service restart|connection closed|closed before|gateway closed|websocket|failed to connect|could not connect|unreachable|not reachable|ECONNREFUSED|ECONNRESET|socket hang up|timed out|timeout/i.test(message)) {
    return gatewayConfigPatchRetryDelaysMs[attempt] ?? null;
  }

  return null;
}

async function tryStartGatewayAfterTransientConfigFailure(error: unknown) {
  if (!isGatewayConfigSettleError(error)) {
    return;
  }

  await getOpenClawLifecycleService().start().catch(() => {});
}

function isGatewayTransportSettleError(error: unknown) {
  const kind = normalizeClientError(error).kind;
  return kind === "timeout" || kind === "unreachable";
}

function isGatewayConfigSettleError(error: unknown) {
  return isGatewayTransportSettleError(error) ||
    /gateway starting|retry shortly/i.test(readErrorMessage(error));
}

function buildGatewayConfigMutationFailureMessage(action: string, error: unknown) {
  if (isGatewayConfigRateLimitError(error)) {
    const retryAfterMs = readGatewayConfigRateLimitRetryAfterMs(error);
    const retryHint = retryAfterMs !== null
      ? ` Wait about ${formatRetryAfter(retryAfterMs)} before retrying.`
      : " Wait for the Gateway config cooldown, then retry.";

    return `OpenClaw Gateway is rate limiting config updates while ${action}.${retryHint} AgentOS did not use CLI or legacy file fallback for this model change.`;
  }

  if (isGatewayConfigSettleError(error)) {
    return `OpenClaw Gateway was not reachable while ${action}. AgentOS retried the Gateway config update and attempted to start the Gateway. Start or repair the Gateway from system setup, then retry model setup. AgentOS did not use CLI or legacy file fallback for this model change. ${readErrorMessage(error)}`;
  }

  return `OpenClaw Gateway config update failed while ${action}. AgentOS did not edit OpenClaw state files. ${readErrorMessage(error)}`;
}

function formatRetryAfter(ms: number) {
  if (ms >= 60_000) {
    return `${Math.ceil(ms / 60_000)} minute${Math.ceil(ms / 60_000) === 1 ? "" : "s"}`;
  }

  return `${Math.ceil(ms / 1_000)} second${Math.ceil(ms / 1_000) === 1 ? "" : "s"}`;
}

function cloneAgentDefaults(value: unknown): OpenClawAgentDefaultsConfig {
  if (!isRecord(value)) {
    return {};
  }

  const output = {
    ...value,
    models: cloneModelEntries(value.models)
  } as OpenClawAgentDefaultsConfig;

  if (isRecord(value.model)) {
    output.model = { ...value.model };
  } else if (value.model === undefined) {
    delete output.model;
  }

  return output;
}

function cloneModelEntries(value: unknown) {
  const output: Record<string, OpenClawModelDefaultsEntry> = {};

  if (!isRecord(value)) {
    return output;
  }

  for (const [modelId, entry] of Object.entries(value)) {
    output[modelId] = cloneModelDefaultsEntry(entry);
  }

  return output;
}

function cloneModelDefaultsEntry(value: unknown): OpenClawModelDefaultsEntry {
  if (!isRecord(value)) {
    return {};
  }

  const output = { ...value } as OpenClawModelDefaultsEntry;

  if (isRecord(value.agentRuntime)) {
    output.agentRuntime = { ...value.agentRuntime };
  }

  return output;
}

async function ensureProviderModelRegistryViaGateway(
  adapter: ReturnType<typeof getOpenClawAdapter>,
  provider: AddModelsProviderId | null,
  normalizedModelIds: string[]
) {
  if (provider !== "ollama" && provider !== "google") {
    return;
  }

  const modelEntries = normalizedModelIds
    .map((modelId) => toProviderScopedModelId(provider, modelId))
    .filter(Boolean);

  if (modelEntries.length === 0) {
    return;
  }

  const configProvider = resolveProviderConfigId(provider);
  let existingProviderConfig: unknown = null;

  try {
    existingProviderConfig = await adapter.getConfig<OpenClawProviderModelsEntry>(
      `models.providers.${configProvider}`,
      { timeoutMs: 5_000 }
    );
  } catch {
    existingProviderConfig = null;
  }

  const nextProviderConfig = cloneProviderModelsEntry(existingProviderConfig);
  applyBuiltInProviderConfigDefaults(nextProviderConfig, provider);
  const existingIds = new Set(
    nextProviderConfig.models
      ?.map((entry) => entry.id?.trim())
      .filter((id): id is string => Boolean(id)) ?? []
  );
  let changed = false;

  if (provider === "ollama" && !isConfiguredCredentialValue(nextProviderConfig.apiKey)) {
    nextProviderConfig.apiKey = OLLAMA_LOCAL_API_KEY_MARKER;
    changed = true;
  }

  for (const id of modelEntries) {
    if (!existingIds.has(id)) {
      nextProviderConfig.models = [...(nextProviderConfig.models ?? []), { id, name: id }];
      existingIds.add(id);
      changed = true;
    }
  }

  if (changed) {
    if (containsRedactedOpenClawSecret(existingProviderConfig)) {
      // OpenClaw intentionally redacts provider credentials in config reads.
      // Update only the model registry so the redacted secret never becomes
      // part of a subsequent config mutation.
      const modelsPath = `models.providers.${configProvider}.models`;
      await adapter.setConfig(
        modelsPath,
        nextProviderConfig.models ?? [],
        { timeoutMs: 5_000, replacePaths: [modelsPath] }
      );
    } else {
      await adapter.setConfig(`models.providers.${configProvider}`, nextProviderConfig, { timeoutMs: 5_000 });
    }
  }
}

function applyBuiltInProviderConfigDefaults(
  providerConfig: OpenClawProviderModelsEntry,
  provider: AddModelsProviderId
) {
  if (provider !== "google") {
    return;
  }

  providerConfig.baseUrl = providerConfig.baseUrl?.trim() || googleGenerativeAiBaseUrl;
  delete providerConfig.baseURL;
  providerConfig.api = providerConfig.api?.trim() || "google-generative-ai";
}

function cloneProviderModelsEntry(value: unknown): OpenClawProviderModelsEntry {
  if (!isRecord(value)) {
    return { models: [] };
  }

  const models = Array.isArray(value.models)
    ? value.models
        .filter(isRecord)
        .map((entry) => ({ ...entry } as OpenClawProviderModelEntry))
    : [];

  return {
    ...value,
    models
  } as OpenClawProviderModelsEntry;
}

function sanitizeProviderConfigForOpenClaw(entry: OpenClawProviderModelsEntry): OpenClawProviderModelsEntry {
  const baseUrl = readProviderConfigBaseUrl(entry) ?? undefined;
  const apiKey = typeof entry.apiKey === "string" && entry.apiKey.trim() ? entry.apiKey.trim() : undefined;
  const api = typeof entry.api === "string" && entry.api.trim() ? entry.api.trim() : undefined;
  const models = mergeProviderModelEntries([], entry.models ?? []);

  return {
    ...(models.length > 0 ? { models } : {}),
    ...(baseUrl ? { baseUrl } : {}),
    ...(apiKey ? { apiKey } : {}),
    ...(api ? { api } : {})
  };
}

function readProviderConfigBaseUrl(entry: OpenClawProviderModelsEntry) {
  return typeof entry.baseUrl === "string" && entry.baseUrl.trim()
    ? entry.baseUrl.trim()
    : typeof entry.baseURL === "string" && entry.baseURL.trim()
      ? entry.baseURL.trim()
      : null;
}

function isLoopbackProviderUrl(value: string) {
  try {
    const url = new URL(value);
    return ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  } catch {
    return false;
  }
}

function mergeProviderModelEntries(
  existingEntries: OpenClawProviderModelEntry[],
  incomingEntries: OpenClawProviderModelEntry[]
) {
  const entriesById = new Map<string, OpenClawProviderModelEntry>();

  for (const entry of existingEntries) {
    const id = entry.id?.trim();

    if (id) {
      entriesById.set(id, sanitizeProviderModelEntryForConfig({ ...entry, id }));
    }
  }

  for (const entry of incomingEntries) {
    const id = entry.id?.trim();

    if (!id) {
      continue;
    }

    entriesById.set(id, sanitizeProviderModelEntryForConfig({
      ...entriesById.get(id),
      ...entry,
      id,
      name: entry.name?.trim() || entriesById.get(id)?.name || id
    }));
  }

  return [...entriesById.values()];
}

function sanitizeProviderModelEntryForConfig(entry: OpenClawProviderModelEntry): OpenClawProviderModelEntry {
  const id = entry.id?.trim();
  const name = entry.name?.trim() || id;
  const input = normalizeProviderModelInputForConfig(entry.input);
  const contextWindow = typeof entry.contextWindow === "number" && Number.isFinite(entry.contextWindow)
    ? entry.contextWindow
    : undefined;
  const maxTokens = typeof entry.maxTokens === "number" && Number.isFinite(entry.maxTokens)
    ? entry.maxTokens
    : undefined;

  return {
    ...(id ? { id } : {}),
    ...(name ? { name } : {}),
    ...(input.length > 0 ? { input } : {}),
    ...(contextWindow !== undefined ? { contextWindow } : {}),
    ...(maxTokens !== undefined ? { maxTokens } : {})
  };
}

function normalizeProviderModelInputForConfig(input: OpenClawProviderModelEntry["input"]) {
  const values = Array.isArray(input)
    ? input
    : typeof input === "string"
      ? input.split(/[,+]/)
      : [];

  return values
    .map((value) => value.trim())
    .filter((value, index, allValues) => value.length > 0 && allValues.indexOf(value) === index);
}

function normalizeExplicitProviderModelId(provider: string, modelId: string) {
  const trimmed = modelId.trim();
  const prefix = `${provider}/`;

  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function toProviderScopedModelId(provider: AddModelsProviderId, modelId: string) {
  const trimmed = modelId.trim();
  const prefix = `${provider}/`;

  if (!trimmed) {
    return "";
  }

  return trimmed.startsWith(prefix) ? trimmed.slice(prefix.length) : trimmed;
}

function resolveModelScopedRuntimeId() {
  return null;
}

function normalizeModelIdForProvider(provider: AddModelsProviderId, modelId: string) {
  return provider === "openai" ? normalizeOpenAiModelId(modelId) : modelId;
}

function resolveProviderFromModelId(modelId: string): AddModelsProviderId | null {
  const modelProvider = modelId.split("/", 1)[0] || null;
  return isAddModelsProviderId(modelProvider) ? modelProvider : null;
}

function resolveProviderFromModelIdForRuntime(modelId: string): AddModelsProviderId | null {
  return resolveProviderFromModelId(modelId);
}

function isReadyCodexPlugin(plugin: { id: string; name: string; status?: string }) {
  const id = plugin.id.trim().toLowerCase();
  const name = plugin.name.trim().toLowerCase();
  const status = plugin.status?.trim().toLowerCase() ?? "";
  const isCodexPlugin = id === "codex" || id === "@openclaw/codex" || name === "codex" || name === "@openclaw/codex";

  return isCodexPlugin && !["disabled", "missing", "error", "failed", "blocked"].includes(status);
}

export function applyProviderEndpointConfig(
  config: OpenClawConfigPayload,
  provider: AddModelsProviderId,
  endpoint?: string
) {
  if (provider !== "openai") {
    return;
  }

  config.models = config.models || {};
  config.models.providers = config.models.providers || {};
  const nextProviderConfig = cloneProviderModelsEntry(config.models.providers.openai);
  const trimmedEndpoint = endpoint?.trim();

  if (trimmedEndpoint) {
    nextProviderConfig.baseUrl = trimmedEndpoint;
    delete nextProviderConfig.baseURL;
  } else {
    delete nextProviderConfig.baseUrl;
    delete nextProviderConfig.baseURL;
  }

  config.models.providers.openai = nextProviderConfig;
}

export function readOpenAiBaseUrl(config: OpenClawConfigPayload) {
  const rawBaseUrl = config.models?.providers?.openai?.baseUrl ?? config.models?.providers?.openai?.baseURL;
  const trimmed = typeof rawBaseUrl === "string" ? rawBaseUrl.trim() : "";

  if (!trimmed) {
    return null;
  }

  try {
    const url = new URL(trimmed);
    return `${url.origin}${url.pathname.replace(/\/$/, "")}`;
  } catch {
    return trimmed;
  }
}

function readOpenAiApiKey(config: OpenClawConfigPayload) {
  const rawApiKey = config.models?.providers?.openai?.apiKey;

  return typeof rawApiKey === "string" && rawApiKey.trim() ? rawApiKey.trim() : null;
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function readErrorMessage(error: unknown) {
  return redactSecretText(error instanceof Error ? error.message : String(error || "Unknown Gateway error."));
}

function modelMatchesProvider(provider: AddModelsProviderId, modelId: string) {
  const modelProvider = modelId.split("/")[0] ?? "";

  return modelProvider === provider && isAddModelsProviderId(modelProvider);
}

function providerAuthEntryMatchesAddModelsProvider(
  entry: { provider?: string; type?: string; mode?: string; profileId?: string },
  provider: AddModelsProviderId
) {
  const entryProvider = entry.provider;
  if (!entryProvider) {
    return false;
  }

  if (entryProvider !== provider) {
    return false;
  }

  if (provider === "openai" && (entry.mode?.toLowerCase() === "oauth" || entry.type?.toLowerCase() === "oauth")) {
    return entry.profileId?.toLowerCase().startsWith("openai:") ?? false;
  }

  return true;
}

function isUsableFileAuthEntry(
  entry: { status?: string; expiresAt?: number }
) {
  const status = entry.status?.trim().toLowerCase();
  if (status && ["expired", "missing", "invalid", "error", "disabled", "revoked"].includes(status)) {
    return false;
  }

  return !(typeof entry.expiresAt === "number" && entry.expiresAt > 0 && entry.expiresAt <= Date.now());
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}
