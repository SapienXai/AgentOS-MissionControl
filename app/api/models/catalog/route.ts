import { NextResponse } from "next/server";

import { isAddModelsProviderId, modelProviderRegistry } from "@/lib/openclaw/model-provider-registry";
import { runOpenClawJson } from "@/lib/openclaw/cli";
import { getMissionControlSnapshot } from "@/lib/openclaw/service";
import type { AddModelsCatalogModel, MissionControlSnapshot } from "@/lib/openclaw/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type GlobalCatalogModel = Omit<AddModelsCatalogModel, "alreadyAdded">;
const supportedProviderIds = new Set(modelProviderRegistry.map((provider) => provider.id));

type OpenClawModelsListPayload = {
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

export async function GET() {
  try {
    const models = await readGlobalCatalog();
    return NextResponse.json({ models }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "OpenClaw catalog could not be loaded."
      },
      { status: 500 }
    );
  }
}

async function readGlobalCatalog(): Promise<GlobalCatalogModel[]> {
  try {
    const payload = await runOpenClawJson<OpenClawModelsListPayload>(["models", "list", "--all", "--json"]);
    return normalizeCatalogModels(payload.models);
  } catch {
    const snapshot = await getMissionControlSnapshot({ force: true });
    return normalizeSnapshotModels(snapshot);
  }
}

function normalizeCatalogModels(
  models: OpenClawModelsListPayload["models"]
): GlobalCatalogModel[] {
  const uniqueModels = new Map<string, OpenClawModelsListPayload["models"][number]>();

  for (const model of models || []) {
    const providerId = resolveProviderFromModelId(model.key);

    if (!isAddModelsProviderId(providerId) || !supportedProviderIds.has(providerId)) {
      continue;
    }

    if (!uniqueModels.has(model.key)) {
      uniqueModels.set(model.key, model);
    }
  }

  return Array.from(uniqueModels.values()).map((model) => ({
    id: model.key,
    name: model.name,
    provider: resolveProviderFromModelId(model.key),
    input: model.input,
    contextWindow: model.contextWindow ?? null,
    local: Boolean(model.local),
    available: model.available !== false,
    missing: Boolean(model.missing),
    recommended: isRecommendedModel(resolveProviderFromModelId(model.key), model.key),
    supportsTools: model.input.includes("text"),
    isFree: /:free$/i.test(model.key) || /\(free\)/i.test(model.name),
    tags: Array.isArray(model.tags) ? model.tags : []
  }));
}

function normalizeSnapshotModels(
  snapshot: MissionControlSnapshot
): GlobalCatalogModel[] {
  return snapshot.models
    .filter((model) => isAddModelsProviderId(model.provider) && supportedProviderIds.has(model.provider))
    .map((model) => ({
      id: model.id,
      name: model.name,
      provider: model.provider,
      input: model.input,
      contextWindow: model.contextWindow,
      local: Boolean(model.local),
      available: model.available !== false,
      missing: Boolean(model.missing),
      recommended: isRecommendedModel(model.provider, model.id),
      supportsTools: model.input.includes("text"),
      isFree: /:free$/i.test(model.id) || /\(free\)/i.test(model.name),
      tags: Array.isArray(model.tags) ? model.tags : []
    }));
}

function resolveProviderFromModelId(modelId: string) {
  return modelId.split("/")[0] || "unknown";
}

function isRecommendedModel(provider: string, modelId: string) {
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
