import type {
  AgentConfigPayload,
  ModelsPayload,
  ModelsStatusPayload
} from "@/lib/openclaw/client/gateway-client";
import type { ModelRecord, OpenClawAgent } from "@/lib/openclaw/types";

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

export function buildModelsPayloadFromFallbackSources(
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

export function buildModelStatusFromAgentConfig(
  agentConfig: AgentConfigPayload
): ModelsStatusPayload | undefined {
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

export function buildModelRecords(
  models: ModelsPayload["models"],
  agents: OpenClawAgent[]
): ModelRecord[] {
  const modelUsage = new Map<string, number>();

  for (const agent of agents) {
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
  }));
}
