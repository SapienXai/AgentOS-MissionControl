import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getModelProviderDescriptor, isAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import { formatOpenClawCommand, resolveOpenClawBin, runOpenClawJson } from "@/lib/openclaw/cli";
import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import type {
  AddModelsCatalogModel,
  AddModelsEmptyState,
  AddModelsProviderActionRequest,
  AddModelsProviderActionResult,
  AddModelsProviderConnectionStatus,
  AddModelsProviderId,
  MissionControlSnapshot
} from "@/lib/agentos/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const addModelsDocsUrl = "https://docs.openclaw.ai/cli/models";
const openClawConfigPath = path.join(os.homedir(), ".openclaw", "openclaw.json");
const openClawAuthProfilesPath = path.join(
  os.homedir(),
  ".openclaw",
  "agents",
  "main",
  "agent",
  "auth-profiles.json"
);
const providerIdSchema = z.enum([
  "openai-codex",
  "openrouter",
  "ollama",
  "openai",
  "anthropic",
  "xai",
  "gemini",
  "deepseek",
  "mistral"
]);
const optionalInputString = z.preprocess((value) => {
  if (typeof value !== "string") {
    return value;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}, z.string().trim().min(1).optional());

const requestSchema = z.discriminatedUnion("action", [
  z.object({
    action: z.literal("status"),
    provider: providerIdSchema
  }),
  z.object({
    action: z.literal("connect"),
    provider: providerIdSchema,
    apiKey: optionalInputString,
    endpoint: optionalInputString
  }),
  z.object({
    action: z.literal("discover"),
    provider: providerIdSchema
  }),
  z.object({
    action: z.literal("add-models"),
    provider: providerIdSchema,
    modelIds: z.array(z.string().trim().min(1)).min(1)
  })
]);

type OpenClawConfigPayload = {
  meta?: {
    lastTouchedVersion?: string;
    lastTouchedAt?: string;
  };
  auth?: {
    profiles?: Record<string, { provider?: string; mode?: string }>;
  };
  agents?: {
    defaults?: {
      model?: {
        primary?: string;
      };
      models?: Record<string, Record<string, never>>;
    };
  };
};

type OpenClawAuthProfilesPayload = {
  version?: number;
  profiles?: Record<
    string,
    {
      type?: string;
      provider?: string;
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

type OpenClawModelsListPayload = {
  count?: number;
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

type OpenClawModelScanPayload = Array<{
  id: string;
  name: string;
  provider: string;
  modelRef?: string;
  contextLength?: number | null;
  supportsToolsMeta?: boolean;
  isFree?: boolean;
}>;

type OllamaState =
  | {
      installed: false;
      models: string[];
    }
  | {
      installed: true;
      models: string[];
    };

const providerTokenRules: Partial<Record<AddModelsProviderId, RegExp>> = {
  openrouter: /^sk-or-/i,
  openai: /^sk-/i,
  anthropic: /^sk-ant-/i
};

export async function POST(request: Request) {
  let input: AddModelsProviderActionRequest;

  try {
    input = requestSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Model provider action is required."
      },
      { status: 400 }
    );
  }

  try {
    const result = await handleProviderAction(input);
    return NextResponse.json(result, { status: result.ok ? 200 : 400 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Add Models request failed."
      },
      { status: 500 }
    );
  }
}

async function handleProviderAction(
  input: AddModelsProviderActionRequest
): Promise<AddModelsProviderActionResult> {
  const commandBin = await resolveOpenClawBin().catch(() => "openclaw");

  if (input.action === "status") {
    const statusContext = await readProviderConnectionContext(input.provider);

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: resolveProviderStatusMessage(input.provider, statusContext.connection),
      connection: statusContext.connection,
      models: [],
      emptyState: statusContext.ollamaState ? resolveOllamaEmptyState(statusContext.ollamaState) : null,
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "connect") {
    if (input.provider === "ollama") {
      return discoverProviderModels(input.provider);
    }

    if (input.provider === "openai-codex") {
      const statusContext = await readProviderConnectionContext(input.provider);

      return buildActionResult({
        ok: true,
        action: input.action,
        provider: input.provider,
        message: "Continue in Terminal to connect your ChatGPT account, then come back to discover models.",
        connection: statusContext.connection,
        models: [],
        manualCommand: formatOpenClawCommand(commandBin, [
          "models",
          "auth",
          "login",
          "--provider",
          "openai-codex",
          "--set-default"
        ]),
        docsUrl: addModelsDocsUrl
      });
    }

    const apiKey = input.apiKey?.trim();

    if (!apiKey) {
      const statusContext = await readProviderConnectionContext(input.provider);

      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: "Enter an API key to continue.",
        connection: statusContext.connection,
        models: [],
        docsUrl: addModelsDocsUrl
      });
    }

    validateApiKey(input.provider, apiKey);
    await persistProviderToken(input.provider, apiKey);

    const snapshot = await getMissionControlSnapshot({ force: true });
    const statusContext = await readProviderConnectionContext(input.provider);

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: `Connected ${getModelProviderDescriptor(input.provider).shortLabel}. Discovering available models is next.`,
      snapshot,
      connection: statusContext.connection,
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "discover") {
    return discoverProviderModels(input.provider);
  }

  await addModelsToConfig(input.modelIds);
  const refreshedSnapshot = await getMissionControlSnapshot({ force: true });
  const statusContext = await readProviderConnectionContext(input.provider);
  const providerModels = await readProviderCatalog(input.provider, statusContext.configuredModelIds);

  return buildActionResult({
    ok: true,
    action: input.action,
    provider: input.provider,
    message: `Added ${input.modelIds.length} model${input.modelIds.length === 1 ? "" : "s"} to AgentOS.`,
    snapshot: refreshedSnapshot,
    connection: statusContext.connection,
    models: providerModels,
    docsUrl: addModelsDocsUrl
  });
}

async function discoverProviderModels(
  provider: AddModelsProviderId
): Promise<AddModelsProviderActionResult> {
  const { connection, ollamaState, configuredModelIds } = await readProviderConnectionContext(provider);
  const models = await readProviderCatalog(provider, configuredModelIds);

  return buildActionResult({
    ok: true,
    action: "discover",
    provider,
    message: models.length
      ? `Found ${models.length} model${models.length === 1 ? "" : "s"}.`
      : "No models were returned for this provider.",
    connection,
    models,
    emptyState:
      models.length === 0
        ? provider === "ollama"
          ? resolveOllamaEmptyState(ollamaState)
          : {
              kind: "no-models",
              title: "No models found",
              description: "This provider connected, but no selectable models were returned yet."
            }
        : null,
    docsUrl: addModelsDocsUrl
  });
}

async function readProviderCatalog(
  provider: AddModelsProviderId,
  configuredModelIds: Set<string>
): Promise<AddModelsCatalogModel[]> {
  const providerPayload = await runOpenClawJson<OpenClawModelsListPayload>([
    "models",
    "list",
    "--all",
    "--json",
    "--provider",
    provider
  ]);
  const providerModels = normalizeCatalogModels(provider, providerPayload.models, configuredModelIds);

  if (providerModels.length > 0) {
    return providerModels;
  }

  const globalPayload = await runOpenClawJson<OpenClawModelsListPayload>(["models", "list", "--all", "--json"]);
  const globalModels = normalizeCatalogModels(provider, globalPayload.models, configuredModelIds);

  if (globalModels.length > 0 || provider === "ollama") {
    return globalModels;
  }

  const scanPayload = await runOpenClawJson<OpenClawModelScanPayload>([
    "models",
    "scan",
    "--json",
    "--yes",
    "--no-input",
    "--no-probe"
  ]);

  return normalizeScanModels(provider, scanPayload, configuredModelIds);
}

function normalizeCatalogModels(
  provider: AddModelsProviderId,
  models: OpenClawModelsListPayload["models"],
  configuredModelIds: Set<string>
) {
  const uniqueModels = new Map<string, typeof models[number]>();
  for (const model of models || []) {
    const modelProvider = resolveProviderFromModelId(model.key);

    if (modelProvider !== provider || !isAddModelsProviderId(modelProvider)) {
      continue;
    }

    if (!uniqueModels.has(model.key)) {
      uniqueModels.set(model.key, model);
    }
  }

  return Array.from(uniqueModels.values()).map((model) => ({
    id: model.key,
    name: model.name,
    provider,
    input: model.input,
    contextWindow: model.contextWindow ?? null,
    local: Boolean(model.local),
    available: model.available !== false,
    missing: Boolean(model.missing),
    alreadyAdded: configuredModelIds.has(model.key),
    recommended: isRecommendedModel(provider, model.key),
    supportsTools: model.input.includes("text"),
    isFree: /:free$/i.test(model.key) || /\(free\)/i.test(model.name),
    tags: Array.isArray(model.tags) ? model.tags : []
  }));
}

function normalizeScanModels(
  provider: AddModelsProviderId,
  models: OpenClawModelScanPayload,
  configuredModelIds: Set<string>
): AddModelsCatalogModel[] {
  const uniqueModels = new Map<string, OpenClawModelScanPayload[number]>();

  for (const candidate of models || []) {
    const modelId = resolveDiscoveredModelId(candidate);
    if (!modelId) {
      continue;
    }

    const modelProvider = resolveProviderFromModelId(modelId);

    if (
      modelProvider !== provider ||
      !isAddModelsProviderId(modelProvider) ||
      uniqueModels.has(modelId)
    ) {
      continue;
    }

    uniqueModels.set(modelId, candidate);
  }

  return Array.from(uniqueModels.values()).map((candidate) => {
    const modelId = resolveDiscoveredModelId(candidate);

    return {
      id: modelId,
      name: candidate.name.trim(),
      provider,
      input: candidate.supportsToolsMeta ? "text+tools" : "text",
      contextWindow: candidate.contextLength ?? null,
      local: false,
      available: true,
      missing: false,
      alreadyAdded: configuredModelIds.has(modelId),
      recommended: isRecommendedModel(provider, modelId),
      supportsTools: candidate.supportsToolsMeta === true,
      isFree: candidate.isFree === true,
      tags: []
    };
  });
}

function resolveDiscoveredModelId(candidate: OpenClawModelScanPayload[number]) {
  const modelRef = candidate.modelRef?.trim();

  if (modelRef) {
    return modelRef;
  }

  const provider = candidate.provider.trim();
  const id = candidate.id.trim();

  if (!provider || !id) {
    return "";
  }

  return `${provider}/${id}`;
}

function buildActionResult({
  ok,
  action,
  provider,
  message,
  snapshot,
  connection,
  models,
  emptyState = null,
  manualCommand = null,
  docsUrl = null
}: {
  ok: boolean;
  action: AddModelsProviderActionResult["action"];
  provider: AddModelsProviderId;
  message: string;
  snapshot?: MissionControlSnapshot;
  connection: AddModelsProviderConnectionStatus;
  models: AddModelsCatalogModel[];
  emptyState?: AddModelsEmptyState | null;
  manualCommand?: string | null;
  docsUrl?: string | null;
}): AddModelsProviderActionResult {
  return {
    ok,
    action,
    provider,
    message,
    connection,
    models,
    emptyState,
    manualCommand,
    docsUrl,
    snapshot
  };
}

async function readProviderConnectionContext(provider: AddModelsProviderId) {
  const [configuredModelIds, config, authProfiles] = await Promise.all([
    readConfiguredModelIds(),
    readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {}),
    readJsonFile<OpenClawAuthProfilesPayload>(openClawAuthProfilesPath, {
      version: 1
    })
  ]);

  if (provider === "ollama") {
    const ollamaState = await readOllamaState();

    return {
      connection: buildOllamaConnectionStatus(ollamaState),
      configuredModelIds,
      ollamaState
    };
  }

  return {
    connection: buildFileBasedConnectionStatus(provider, config, authProfiles, configuredModelIds),
    configuredModelIds,
    ollamaState: null
  };
}

function buildOllamaConnectionStatus(ollamaState: OllamaState): AddModelsProviderConnectionStatus {
  return {
    provider: "ollama",
    connected: Boolean(ollamaState.installed),
    canConnect: true,
    needsTerminal: false,
    detail: !ollamaState.installed
      ? "Ollama is not installed on this machine."
      : ollamaState.models.length > 0
        ? `${ollamaState.models.length} local model${ollamaState.models.length === 1 ? "" : "s"} detected.`
        : "Ollama is installed, but no local models were found yet."
  };
}

function buildFileBasedConnectionStatus(
  provider: AddModelsProviderId,
  config: OpenClawConfigPayload,
  authProfiles: OpenClawAuthProfilesPayload,
  configuredModelIds: Set<string>
): AddModelsProviderConnectionStatus {
  const descriptor = getModelProviderDescriptor(provider);
  const configuredCount = [...configuredModelIds].filter(
    (modelId) => resolveProviderFromModelId(modelId) === provider
  ).length;
  const providerAuthCount = [
    ...Object.values(config.auth?.profiles ?? {}),
    ...Object.values(authProfiles.profiles ?? {})
  ].filter((entry) => entry.provider === provider).length;
  const connected = providerAuthCount > 0;

  return {
    provider,
    connected,
    canConnect: true,
    needsTerminal: descriptor.connectKind === "oauth",
    detail:
      connected
        ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} in AgentOS.`
        : configuredCount > 0
          ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} are already saved in AgentOS. Connect ${descriptor.shortLabel} to use them.`
          : descriptor.helperText
  };
}

function resolveProviderStatusMessage(
  provider: AddModelsProviderId,
  connection: AddModelsProviderConnectionStatus
) {
  if (provider === "ollama" && !connection.connected) {
    return "Ollama is not available on this machine yet.";
  }

  if (connection.connected) {
    return connection.detail || `${getModelProviderDescriptor(provider).shortLabel} is ready to use.`;
  }

  return `Connect ${getModelProviderDescriptor(provider).shortLabel} to start discovering models.`;
}

async function readConfiguredModelIds() {
  const config = await readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {});
  const modelEntries = config.agents?.defaults?.models ?? {};

  return new Set(Object.keys(modelEntries));
}

function resolveOllamaEmptyState(ollamaState: OllamaState | null): AddModelsEmptyState | null {
  if (!ollamaState) {
    return null;
  }

  if (!ollamaState.installed) {
    return {
      kind: "ollama-missing",
      title: "Ollama not found",
      description: "Install Ollama locally, then return here and retry discovery.",
      commands: ["brew install ollama", "ollama serve"]
    };
  }

  if (ollamaState.models.length === 0) {
    return {
      kind: "ollama-empty",
      title: "No local models yet",
      description: "Ollama is running, but there are no pulled models on this machine yet.",
      commands: ["ollama pull qwen3.5:9b", "ollama pull llama3:8b", "ollama list"]
    };
  }

  return null;
}

async function readOllamaState(): Promise<OllamaState> {
  try {
    const models = await readProviderCatalog("ollama", new Set());

    return {
      installed: true,
      models: models
        .map((model) => (model.id.startsWith("ollama/") ? model.id.slice("ollama/".length) : model.id))
        .filter((modelName) => modelName.length > 0)
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (/ollama/i.test(message) && (/spawn/i.test(message) || /not found/i.test(message) || /enoent/i.test(message))) {
      return {
        installed: false,
        models: []
      };
    }

    return {
      installed: true,
      models: []
    };
  }
}

async function persistProviderToken(provider: AddModelsProviderId, token: string) {
  const config = await readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {});
  const authProfiles = await readJsonFile<OpenClawAuthProfilesPayload>(openClawAuthProfilesPath, {
    version: 1
  });
  const profileId = `${provider}:manual`;

  config.meta = {
    ...config.meta,
    lastTouchedAt: new Date().toISOString()
  };
  config.auth = config.auth || {};
  config.auth.profiles = config.auth.profiles || {};
  config.auth.profiles[profileId] = {
    provider,
    mode: "token"
  };

  authProfiles.version = 1;
  authProfiles.profiles = authProfiles.profiles || {};
  authProfiles.profiles[profileId] = {
    type: "token",
    provider,
    token
  };
  authProfiles.usageStats = authProfiles.usageStats || {};
  authProfiles.usageStats[profileId] = {
    errorCount: authProfiles.usageStats[profileId]?.errorCount ?? 0,
    lastUsed: Date.now()
  };

  await writeJsonFile(openClawConfigPath, config);
  await writeJsonFile(openClawAuthProfilesPath, authProfiles);
}

async function addModelsToConfig(modelIds: string[]) {
  const config = await readJsonFile<OpenClawConfigPayload>(openClawConfigPath, {});

  config.meta = {
    ...config.meta,
    lastTouchedAt: new Date().toISOString()
  };
  config.agents = config.agents || {};
  config.agents.defaults = config.agents.defaults || {};
  config.agents.defaults.models = config.agents.defaults.models || {};

  for (const modelId of modelIds) {
    config.agents.defaults.models[modelId] = config.agents.defaults.models[modelId] || {};
  }

  if (!config.agents.defaults.model?.primary && modelIds[0]) {
    config.agents.defaults.model = {
      ...(config.agents.defaults.model || {}),
      primary: modelIds[0]
    };
  }

  await writeJsonFile(openClawConfigPath, config);
}

function validateApiKey(provider: AddModelsProviderId, token: string) {
  const expectedPattern = providerTokenRules[provider];

  if (token.length < 8) {
    throw new Error("That API key looks too short.");
  }

  if (expectedPattern && !expectedPattern.test(token)) {
    if (provider === "openrouter") {
      throw new Error("OpenRouter keys usually start with sk-or-.");
    }

    if (provider === "openai") {
      throw new Error("OpenAI API keys usually start with sk-.");
    }

    if (provider === "anthropic") {
      throw new Error("Anthropic keys usually start with sk-ant-.");
    }
  }
}

async function readJsonFile<T>(filePath: string, fallback: T): Promise<T> {
  try {
    const raw = await readFile(filePath, "utf8");
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

async function writeJsonFile(filePath: string, value: unknown) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

function resolveProviderFromModelId(modelId: string) {
  return modelId.split("/")[0] as AddModelsProviderId;
}

function isRecommendedModel(provider: AddModelsProviderId, modelId: string) {
  const normalized = modelId.toLowerCase();

  if (provider === "openrouter") {
    return /gpt-5|claude-sonnet|gemini-2\.5|gemini-3|qwen3-coder|codestral|openrouter\/auto/.test(normalized);
  }

  if (provider === "openai-codex") {
    return /gpt-5\.4|gpt-5\.3-codex|codex/.test(normalized);
  }

  if (provider === "ollama") {
    return /qwen|llama3/.test(normalized);
  }

  if (provider === "anthropic") {
    return /claude-sonnet|claude-opus/.test(normalized);
  }

  if (provider === "openai") {
    return /gpt-5|o3|o4/.test(normalized);
  }

  if (provider === "xai") {
    return /grok-4|grok-code/.test(normalized);
  }

  if (provider === "gemini") {
    return /gemini-2\.|gemini-3/.test(normalized);
  }

  if (provider === "deepseek") {
    return /deepseek-(chat|reasoner|coder|r1|v3)/.test(normalized);
  }

  if (provider === "mistral") {
    return /mistral-(large|small|medium|tiny)|codestral|pixtral|ministral/.test(normalized);
  }

  return false;
}
