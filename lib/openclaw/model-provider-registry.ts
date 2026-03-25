import type {
  AddModelsProviderCategory,
  AddModelsProviderConnectKind,
  AddModelsProviderId
} from "@/lib/openclaw/types";

export type ModelProviderDescriptor = {
  id: AddModelsProviderId;
  label: string;
  shortLabel: string;
  description: string;
  category: AddModelsProviderCategory;
  connectKind: AddModelsProviderConnectKind;
  accent: string;
  helperText: string;
  searchPlaceholder?: string;
};

export const modelProviderRegistry: ModelProviderDescriptor[] = [
  {
    id: "openai-codex",
    label: "ChatGPT",
    shortLabel: "ChatGPT",
    description: "Connect your ChatGPT account and pull in Codex-ready models.",
    category: "primary",
    connectKind: "oauth",
    accent: "from-[#d8f5eb] via-[#ebfbf5] to-white",
    helperText: "Account-based login with the OpenClaw provider flow."
  },
  {
    id: "openrouter",
    label: "OpenRouter",
    shortLabel: "OpenRouter",
    description: "Add an API key, discover the full catalog, and curate the models you want.",
    category: "primary",
    connectKind: "apiKey",
    accent: "from-[#fff2d7] via-[#fff7ea] to-white",
    helperText: "Best for broad model access and curated remote routes.",
    searchPlaceholder: "Search OpenRouter models"
  },
  {
    id: "ollama",
    label: "Ollama Local",
    shortLabel: "Ollama",
    description: "Discover models already available on this machine and add them instantly.",
    category: "primary",
    connectKind: "local",
    accent: "from-[#deefff] via-[#f2f8ff] to-white",
    helperText: "Local-first discovery with helpful pull commands when empty."
  },
  {
    id: "anthropic",
    label: "Anthropic",
    shortLabel: "Anthropic",
    description: "Paste an API key and add Claude models through the same flow.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#efe9ff] via-[#f7f3ff] to-white",
    helperText: "Simple API key connection."
  },
  {
    id: "openai",
    label: "OpenAI API",
    shortLabel: "OpenAI",
    description: "Connect a standard OpenAI API key for direct GPT model access.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#e8f8e8] via-[#f4fbf4] to-white",
    helperText: "Use this for API-key-based OpenAI routing."
  },
  {
    id: "gemini",
    label: "Gemini",
    shortLabel: "Gemini",
    description: "Add a Gemini API key, discover Google models, and pick the routes you want.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#e6f7ff] via-[#f4fbff] to-white",
    helperText: "Simple API key connection.",
    searchPlaceholder: "Search Gemini models"
  },
  {
    id: "deepseek",
    label: "DeepSeek",
    shortLabel: "DeepSeek",
    description: "Add a DeepSeek API key, discover the catalog, and add the models you need.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#e7eeff] via-[#f4f7ff] to-white",
    helperText: "Simple API key connection.",
    searchPlaceholder: "Search DeepSeek models"
  },
  {
    id: "mistral",
    label: "Mistral",
    shortLabel: "Mistral",
    description: "Add a Mistral API key, discover Mistral and Codestral models, and curate your routes.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#f2e8ff] via-[#fbf7ff] to-white",
    helperText: "Simple API key connection.",
    searchPlaceholder: "Search Mistral models"
  },
  {
    id: "xai",
    label: "xAI",
    shortLabel: "xAI",
    description: "Use an xAI API key to bring Grok models into AgentOS.",
    category: "other",
    connectKind: "apiKey",
    accent: "from-[#ffe6ea] via-[#fff3f5] to-white",
    helperText: "Simple API key connection."
  }
];

export const primaryModelProviders = modelProviderRegistry.filter((provider) => provider.category === "primary");

export const otherModelProviders = modelProviderRegistry.filter((provider) => provider.category === "other");

export function getModelProviderDescriptor(providerId: AddModelsProviderId) {
  const descriptor = modelProviderRegistry.find((provider) => provider.id === providerId);

  if (!descriptor) {
    throw new Error(`Unknown model provider: ${providerId}`);
  }

  return descriptor;
}

export function isAddModelsProviderId(value: unknown): value is AddModelsProviderId {
  return typeof value === "string" && modelProviderRegistry.some((provider) => provider.id === value);
}

export function normalizeAddModelsProviderId(value: unknown): AddModelsProviderId | null {
  if (isAddModelsProviderId(value)) {
    return value;
  }

  if (value && typeof value === "object" && "id" in value) {
    const candidateId = (value as { id?: unknown }).id;

    if (isAddModelsProviderId(candidateId)) {
      return candidateId;
    }
  }

  return null;
}

export function formatModelProviderLabel(providerId: string) {
  const descriptor = modelProviderRegistry.find((provider) => provider.id === providerId);

  if (descriptor) {
    return descriptor.shortLabel;
  }

  return providerId
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}
