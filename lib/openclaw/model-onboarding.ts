import type { MissionControlSnapshot } from "@/lib/openclaw/types";

export function resolveRequiredLoginProvider(
  snapshot: MissionControlSnapshot,
  preferredModelId?: string | null
) {
  const defaultModelId = snapshot.diagnostics.modelReadiness.resolvedDefaultModel ?? snapshot.diagnostics.modelReadiness.defaultModel;
  const preferredProvider = resolveModelProvider(preferredModelId) ?? resolveModelProvider(defaultModelId);

  if (preferredProvider === "ollama") {
    return null;
  }

  if (preferredProvider === "openrouter") {
    const openrouterProvider = snapshot.diagnostics.modelReadiness.authProviders.find(
      (provider) => provider.provider === "openrouter"
    );

    if (openrouterProvider && !openrouterProvider.connected && openrouterProvider.canLogin) {
      return "openrouter";
    }

    return null;
  }

  if (
    preferredProvider &&
    snapshot.diagnostics.modelReadiness.authProviders.some(
      (provider) =>
        provider.provider === preferredProvider && !provider.connected && provider.canLogin
    )
  ) {
    return preferredProvider;
  }

  const preferredLoginProvider = snapshot.diagnostics.modelReadiness.preferredLoginProvider;
  return preferredLoginProvider === "ollama" ? null : preferredLoginProvider;
}

function resolveModelProvider(modelId?: string | null) {
  const normalized = modelId?.trim();

  if (!normalized) {
    return null;
  }

  const [provider] = normalized.split("/", 1);
  return provider || null;
}
