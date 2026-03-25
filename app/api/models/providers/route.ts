import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";
import { z } from "zod";

import { getModelProviderDescriptor } from "@/lib/openclaw/model-provider-registry";
import { runOpenClawJson } from "@/lib/openclaw/cli";
import { getMissionControlSnapshot } from "@/lib/openclaw/service";
import type {
  AddModelsCatalogModel,
  AddModelsEmptyState,
  AddModelsProviderActionRequest,
  AddModelsProviderActionResult,
  AddModelsProviderConnectionStatus,
  AddModelsProviderId,
  MissionControlSnapshot
} from "@/lib/openclaw/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);
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
  const snapshot = await getMissionControlSnapshot({ force: true });

  if (input.action === "status") {
    const ollamaState = input.provider === "ollama" ? await readOllamaState() : null;

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: resolveProviderStatusMessage(input.provider, snapshot, ollamaState),
      snapshot,
      connection: buildConnectionStatus(input.provider, snapshot, ollamaState),
      models: [],
      emptyState: resolveOllamaEmptyState(ollamaState),
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "connect") {
    if (input.provider === "ollama") {
      return discoverProviderModels(input.provider);
    }

    if (input.provider === "openai-codex") {
      return buildActionResult({
        ok: true,
        action: input.action,
        provider: input.provider,
        message: "Continue in Terminal to connect your ChatGPT account, then come back to discover models.",
        snapshot,
        connection: buildConnectionStatus(input.provider, snapshot, null),
        models: [],
        manualCommand: "openclaw models auth login --provider openai-codex --set-default",
        docsUrl: addModelsDocsUrl
      });
    }

    const apiKey = input.apiKey?.trim();

    if (!apiKey) {
      return buildActionResult({
        ok: false,
        action: input.action,
        provider: input.provider,
        message: "Enter an API key to continue.",
        snapshot,
        connection: buildConnectionStatus(input.provider, snapshot, null),
        models: [],
        docsUrl: addModelsDocsUrl
      });
    }

    validateApiKey(input.provider, apiKey);
    await persistProviderToken(input.provider, apiKey);

    const refreshedSnapshot = await getMissionControlSnapshot({ force: true });

    return buildActionResult({
      ok: true,
      action: input.action,
      provider: input.provider,
      message: `Connected ${getModelProviderDescriptor(input.provider).shortLabel}. Discovering available models is next.`,
      snapshot: refreshedSnapshot,
      connection: buildConnectionStatus(input.provider, refreshedSnapshot, null),
      models: [],
      docsUrl: addModelsDocsUrl
    });
  }

  if (input.action === "discover") {
    return discoverProviderModels(input.provider);
  }

  await addModelsToConfig(input.modelIds);
  const refreshedSnapshot = await getMissionControlSnapshot({ force: true });
  const providerModels = await readProviderCatalog(input.provider, refreshedSnapshot);

  return buildActionResult({
    ok: true,
    action: input.action,
    provider: input.provider,
    message: `Added ${input.modelIds.length} model${input.modelIds.length === 1 ? "" : "s"} to AgentOS.`,
    snapshot: refreshedSnapshot,
    connection: buildConnectionStatus(input.provider, refreshedSnapshot, null),
    models: providerModels,
    docsUrl: addModelsDocsUrl
  });
}

async function discoverProviderModels(
  provider: AddModelsProviderId
): Promise<AddModelsProviderActionResult> {
  const snapshot = await getMissionControlSnapshot({ force: true });
  const ollamaState = provider === "ollama" ? await readOllamaState() : null;
  const connection = buildConnectionStatus(provider, snapshot, ollamaState);
  const emptyState = resolveOllamaEmptyState(ollamaState);

  if (provider === "ollama" && emptyState) {
    return buildActionResult({
      ok: true,
      action: "discover",
      provider,
      message: emptyState.description,
      snapshot,
      connection,
      models: [],
      emptyState,
      docsUrl: addModelsDocsUrl
    });
  }

  const models = await readProviderCatalog(provider, snapshot);

  return buildActionResult({
    ok: true,
    action: "discover",
    provider,
    message: models.length
      ? `Found ${models.length} model${models.length === 1 ? "" : "s"}.`
      : "No models were returned for this provider.",
    snapshot,
    connection,
    models,
    emptyState:
      models.length === 0
        ? {
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
  snapshot: MissionControlSnapshot
): Promise<AddModelsCatalogModel[]> {
  const payload = await runOpenClawJson<OpenClawModelsListPayload>([
    "models",
    "list",
    "--all",
    "--json",
    "--provider",
    provider
  ]);
  const configuredModelIds = new Set(snapshot.models.map((model) => model.id));

  const uniqueModels = new Map<string, typeof payload.models[number]>();
  for (const model of payload.models || []) {
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
  snapshot: MissionControlSnapshot;
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

function buildConnectionStatus(
  provider: AddModelsProviderId,
  snapshot: MissionControlSnapshot,
  ollamaState: OllamaState | null
): AddModelsProviderConnectionStatus {
  const readinessProvider = snapshot.diagnostics.modelReadiness.authProviders.find(
    (entry) => entry.provider === provider
  );
  const configuredCount = snapshot.models.filter((model) => resolveProviderFromModelId(model.id) === provider).length;
  const descriptor = getModelProviderDescriptor(provider);

  if (provider === "ollama") {
    return {
      provider,
      connected: Boolean(ollamaState?.installed),
      canConnect: true,
      needsTerminal: false,
      detail: !ollamaState?.installed
        ? "Ollama is not installed on this machine."
        : ollamaState.models.length > 0
          ? `${ollamaState.models.length} local model${ollamaState.models.length === 1 ? "" : "s"} detected.`
          : "Ollama is installed, but no local models were found yet."
    };
  }

  return {
    provider,
    connected: Boolean(readinessProvider?.connected || configuredCount > 0),
    canConnect: true,
    needsTerminal: descriptor.connectKind === "oauth",
    detail:
      readinessProvider?.detail ||
      (configuredCount > 0
        ? `${configuredCount} configured model${configuredCount === 1 ? "" : "s"} in AgentOS.`
        : descriptor.helperText)
  };
}

function resolveProviderStatusMessage(
  provider: AddModelsProviderId,
  snapshot: MissionControlSnapshot,
  ollamaState: OllamaState | null
) {
  const connection = buildConnectionStatus(provider, snapshot, ollamaState);

  if (provider === "ollama" && !ollamaState?.installed) {
    return "Ollama is not available on this machine yet.";
  }

  if (connection.connected) {
    return connection.detail || `${getModelProviderDescriptor(provider).shortLabel} is ready to use.`;
  }

  return `Connect ${getModelProviderDescriptor(provider).shortLabel} to start discovering models.`;
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
    const result = await execFileAsync("ollama", ["list"], {
      timeout: 15_000,
      maxBuffer: 1024 * 1024
    });
    const rows = result.stdout
      .toString()
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);
    const models = rows
      .slice(1)
      .map((line) => line.split(/\s+/)[0])
      .filter(Boolean);

    return {
      installed: true,
      models
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : "";

    if (/spawn ollama ENOENT/i.test(message) || /not found/i.test(message)) {
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
