"use client";

import { ArrowRight, Copy, LoaderCircle, Plus, RefreshCw, Search, SquareTerminal } from "lucide-react";
import { useEffect, useEffectEvent, useMemo, useState } from "react";

import { ProviderCard } from "@/components/mission-control/add-models/provider-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import type {
  AddModelsCatalogModel,
  AddModelsEmptyState,
  AddModelsProviderActionResult,
  AddModelsProviderConnectionStatus,
  AddModelsProviderId,
  OpenClawThinkingLevel,
  MissionControlSnapshot
} from "@/lib/agentos/contracts";
import {
  formatProviderLabel,
  resolveSelectedOnboardingProviderId,
  resolveInitialOnboardingProviderId,
  resolveOnboardingModelSelection,
  ONBOARDING_DEFAULT_THINKING
} from "@/components/mission-control/openclaw-onboarding.utils";
import {
  getModelProviderDescriptor,
  isAddModelsProviderId,
  isBuiltInAddModelsProviderId,
  buildExplicitModelProviderDescriptor,
  modelProviderRegistry
} from "@/lib/openclaw/model-provider-registry";
import { getModelProviderAdapter } from "@/lib/openclaw/model-provider-adapters";
import { modelMatchesAddModelsProvider } from "@/lib/openclaw/domains/model-provider-connection";
import { enrichCatalogModels } from "@/lib/openclaw/domains/model-catalog-projection";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";
import { useModelCatalog } from "@/hooks/use-model-catalog";
import { cn } from "@/lib/utils";

type ProviderDraft = {
  loaded: boolean;
  connection: AddModelsProviderConnectionStatus | null;
  statusMessage: string | null;
  errorMessage: string | null;
  emptyState: AddModelsEmptyState | null;
  manualCommand: string | null;
  docsUrl: string | null;
  models: AddModelsCatalogModel[];
  apiKey: string;
  search: string;
  flowState: "idle" | "connecting" | "verifying" | "discovering" | "ready" | "error";
};

type ExplicitProviderSummary = {
  id: string;
  baseUrl: string | null;
  modelCount: number;
};

const initialDraftState = (): ProviderDraft => ({
  loaded: false,
  connection: null,
  statusMessage: null,
  errorMessage: null,
  emptyState: null,
  manualCommand: null,
  docsUrl: null,
  models: [],
  apiKey: "",
  search: "",
  flowState: "idle"
});

export function OpenClawOnboardingProviderFlow({
  snapshot,
  surfaceTheme = "dark",
  selectedModelId,
  selectedThinking = ONBOARDING_DEFAULT_THINKING,
  onSelectedModelIdChange,
  onSelectedThinkingChange = () => {},
  onOpenAddModels,
  onSnapshotChange,
  autoDiscover = true,
  compactSelection = false,
  onContinue
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme?: "dark" | "light";
  selectedModelId: string;
  selectedThinking?: OpenClawThinkingLevel;
  onSelectedModelIdChange: (value: string) => void;
  onSelectedThinkingChange?: (value: OpenClawThinkingLevel) => void;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  autoDiscover?: boolean;
  compactSelection?: boolean;
  onContinue?: () => void;
}) {
  const isLight = surfaceTheme === "light";
  const [activeProviderId, setActiveProviderId] = useState<AddModelsProviderId>(() =>
    resolveInitialOnboardingProviderId(snapshot, selectedModelId)
  );
  const [providerDrafts, setProviderDrafts] = useState<Partial<Record<AddModelsProviderId, ProviderDraft>>>(
    {}
  );
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);
  const [explicitProviderSummaries, setExplicitProviderSummaries] = useState<ExplicitProviderSummary[]>([]);
  const [explicitProviderError, setExplicitProviderError] = useState<string | null>(null);
  const {
    models: sharedCatalogModels,
    error: sharedCatalogError,
    warning: sharedCatalogWarning
  } = useModelCatalog({
    enabled: true,
    snapshot
  });
  const loadExplicitProviders = useEffectEvent(async () => {
    try {
      const response = await fetch("/api/models/providers");
      const payload = (await response.json().catch(() => null)) as
        | { providers?: ExplicitProviderSummary[]; error?: string }
        | null;

      if (!response.ok || !payload) {
        throw new Error(payload?.error || "Custom providers could not be loaded.");
      }

      const summaries = Array.isArray(payload.providers) ? payload.providers : [];
      setExplicitProviderSummaries(summaries);
      setExplicitProviderError(null);
      setProviderDrafts((current) => {
        const next = { ...current };

        for (const provider of summaries) {
          if (!isAddModelsProviderId(provider.id) || isBuiltInAddModelsProviderId(provider.id)) {
            continue;
          }

          next[provider.id] = {
            ...resolveDraft(next[provider.id]),
            loaded: true,
            connection: {
              provider: provider.id,
              connected: Boolean(provider.baseUrl),
              canConnect: true,
              needsTerminal: false,
              source: "openclaw-config",
              degraded: false,
              stale: false,
              recovery: null,
              detail: provider.baseUrl
                ? `${provider.modelCount} configured model${provider.modelCount === 1 ? "" : "s"} in OpenClaw. Endpoint: ${provider.baseUrl}.`
                : "Custom provider is configured in OpenClaw."
            }
          };
        }

        return next;
      });
    } catch (error) {
      setExplicitProviderError(error instanceof Error ? error.message : "Custom providers could not be loaded.");
    }
  });

  useEffect(() => {
    void loadExplicitProviders();
  }, []);

  const providerDescriptors = useMemo(() => {
    const explicitProviderIds = new Set<string>();

    for (const summary of explicitProviderSummaries) {
      if (isAddModelsProviderId(summary.id) && !isBuiltInAddModelsProviderId(summary.id)) {
        explicitProviderIds.add(summary.id);
      }
    }

    for (const model of snapshot.models) {
      const providerId = model.provider || model.id.split("/")[0];
      if (isAddModelsProviderId(providerId) && !isBuiltInAddModelsProviderId(providerId)) {
        explicitProviderIds.add(providerId);
      }
    }

    return [
      ...modelProviderRegistry,
      ...Array.from(explicitProviderIds)
        .sort((left, right) => left.localeCompare(right))
        .map((providerId) => buildExplicitModelProviderDescriptor(providerId))
    ];
  }, [explicitProviderSummaries, snapshot.models]);

  const selectedCatalogModels = useMemo(
    () => Object.values(providerDrafts).flatMap((draft) => draft?.models ?? []),
    [providerDrafts]
  );
  const selectedProviderId = useMemo(
    () => resolveSelectedOnboardingProviderId(snapshot, selectedModelId, selectedCatalogModels),
    [selectedCatalogModels, selectedModelId, snapshot]
  );

  useEffect(() => {
    if (selectedProviderId) {
      setActiveProviderId((currentProviderId) =>
        currentProviderId === selectedProviderId ? currentProviderId : selectedProviderId
      );
    }
  }, [compactSelection, selectedProviderId]);

  useEffect(() => {
    void ensureProviderStatus(activeProviderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProviderId]);

  const activeDescriptor = getModelProviderDescriptor(activeProviderId);
  const activeDraft = resolveDraft(providerDrafts[activeProviderId]);
  const activeConnection = activeDraft.connection ?? resolveConnectionDetail(snapshot, activeProviderId);
  const activeConnectionLabel = resolveProviderConnectionLabel(activeConnection);
  const snapshotProviderModels = useMemo(
    () =>
      snapshot.models
        .filter(
          (model) =>
            modelMatchesProvider(activeProviderId, model.id, model.provider) &&
            model.available !== false &&
            !model.missing
        )
        .map((model) => ({
          id: model.id,
          name: model.name,
          provider: model.provider,
          input: model.input,
          contextWindow: model.contextWindow,
          local: Boolean(model.local),
          available: model.available !== false,
          missing: model.missing,
          alreadyAdded: true,
          recommended:
            model.id === snapshot.diagnostics.modelReadiness.recommendedModelId ||
            model.id === snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
            model.id === snapshot.diagnostics.modelReadiness.defaultModel,
          supportsTools: model.tags.includes("tools"),
          isFree: model.tags.includes("free"),
          tags: model.tags
        })),
    [
      activeProviderId,
      snapshot.diagnostics.modelReadiness.defaultModel,
      snapshot.diagnostics.modelReadiness.recommendedModelId,
      snapshot.diagnostics.modelReadiness.resolvedDefaultModel,
      snapshot.models
    ]
  );
  const activeCatalogModels = useMemo(() => {
    const providerCatalogModels = sharedCatalogModels.filter((model) =>
      modelMatchesProvider(activeProviderId, model.id, model.provider)
    );
    const sourceModels = activeDraft.models.length > 0
      ? activeDraft.models
      : providerCatalogModels.length > 0
        ? providerCatalogModels
        : snapshotProviderModels;

    return enrichCatalogModels(sourceModels, sharedCatalogModels);
  }, [activeDraft.models, activeProviderId, sharedCatalogModels, snapshotProviderModels]);
  const activeModels = useMemo(() => {
    const query = activeDraft.search.trim().toLowerCase();

    return activeCatalogModels
      .filter((model) => model.available !== false && !model.missing)
      .slice()
      .sort((left, right) => {
        const rightScore = Number(right.recommended) + Number(right.isFree) + Number(right.supportsTools);
        const leftScore = Number(left.recommended) + Number(left.isFree) + Number(left.supportsTools);

        if (rightScore !== leftScore) {
          return rightScore - leftScore;
        }

        return left.name.localeCompare(right.name);
      })
      .filter((model) => {
        if (!query) {
          return true;
        }

        const haystack = `${model.name} ${model.id} ${model.tags.join(" ")}`.toLowerCase();
        return haystack.includes(query);
      });
  }, [activeCatalogModels, activeDraft.search]);

  const selectedModelLabel =
    snapshot.models.find((model) => model.id === selectedModelId)?.name ||
    activeModels.find((model) => model.id === selectedModelId)?.name ||
    selectedModelId.trim() ||
    null;
  const showLoadingHero =
    activeDraft.flowState === "connecting" ||
    activeDraft.flowState === "verifying" ||
    activeDraft.flowState === "discovering" ||
    (activeDraft.statusMessage?.startsWith("Checking ") === true && !activeConnection.connected);
  const loadingHeroTitle =
    activeDraft.flowState === "discovering"
      ? `Discovering ${activeDescriptor.shortLabel} models...`
      : activeDraft.flowState === "verifying"
        ? activeDraft.statusMessage || `Verifying ${activeDescriptor.shortLabel} connection...`
      : activeDraft.flowState === "connecting"
        ? activeDraft.statusMessage || `Connecting ${activeDescriptor.shortLabel}...`
        : activeDraft.statusMessage || `Checking ${activeDescriptor.shortLabel}...`;
  const canShowSearch = activeModels.length > 6 || Boolean(activeDescriptor.searchPlaceholder);
  const canShowModelList = activeConnection.connected || activeModels.length > 0 || Boolean(activeDraft.emptyState);

  useEffect(() => {
    if (!compactSelection || activeModels.length === 0) {
      return;
    }

    if (activeModels.some((model) => model.id === selectedModelId)) {
      return;
    }

    const preferredModelId = resolveOnboardingModelSelection(
      snapshot.diagnostics.modelReadiness,
      activeModels
    );

    if (preferredModelId) {
      onSelectedModelIdChange(preferredModelId);
    }
  }, [activeModels, compactSelection, onSelectedModelIdChange, selectedModelId, snapshot.diagnostics.modelReadiness]);

  async function ensureProviderStatus(providerId: AddModelsProviderId) {
    const draft = resolveDraft(providerDrafts[providerId]);

    if (draft.loaded && draft.connection) {
      return;
    }

    await refreshProvider(providerId);
  }

  function updateDraft(providerId: AddModelsProviderId, patch: Partial<ProviderDraft>) {
    setProviderDrafts((current) => ({
      ...current,
      [providerId]: {
        ...resolveDraft(current[providerId]),
        ...patch
      }
    }));
  }

  function applyActionResult(
    providerId: AddModelsProviderId,
    result: AddModelsProviderActionResult,
    flowState: ProviderDraft["flowState"],
    overrides?: Partial<ProviderDraft>
  ) {
    updateDraft(providerId, {
      flowState,
      connection: result.connection,
      statusMessage: result.message,
      errorMessage: null,
      emptyState: result.emptyState ?? null,
      manualCommand: result.manualCommand ?? null,
      docsUrl: result.docsUrl ?? null,
      models: result.models,
      loaded: true,
      ...overrides
    });
  }

  async function refreshProvider(providerId: AddModelsProviderId) {
    const adapter = getModelProviderAdapter(providerId);
    const previousDraft = resolveDraft(providerDrafts[providerId]);
    const isTerminalReturn = Boolean(previousDraft.manualCommand);
    const providerLabel = formatProviderLabel(providerId);

    updateDraft(providerId, {
      flowState: "verifying",
      errorMessage: null,
      statusMessage: isTerminalReturn
        ? `Verifying ${providerLabel} connection and waiting for the default model...`
        : `Checking ${providerLabel}...`
    });

    try {
      const result = await adapter.getConnectionStatus();
      const shouldDiscover =
        result.connection.connected &&
        autoDiscover &&
        !hasVisibleModelsForProvider(providerId);
      const nextState = shouldDiscover ? "discovering" : "idle";

      applyActionResult(
        providerId,
        result,
        nextState,
        isTerminalReturn && result.connection.connected && !shouldDiscover
          ? {
              statusMessage: result.message || `${providerLabel} is connected. Waiting for AgentOS to refresh the default model.`
            }
          : undefined
      );
      applySnapshotResult(result);

      if (shouldDiscover) {
        await discoverProvider(providerId, true);
      }
    } catch (error) {
      updateDraft(providerId, {
        flowState: "error",
        errorMessage: error instanceof Error ? error.message : "Provider status could not be loaded.",
        loaded: true
      });
    }
  }

  async function connectProvider(
    providerId: AddModelsProviderId,
    options?: { force?: boolean; authMethod?: "api-key" | "chatgpt-oauth" }
  ) {
    const adapter = getModelProviderAdapter(providerId);
    const draft = resolveDraft(providerDrafts[providerId]);

    updateDraft(providerId, {
      flowState: "connecting",
      errorMessage: null,
      manualCommand: null,
      statusMessage:
        providerId === "openai" && options?.authMethod === "chatgpt-oauth"
          ? options?.force
            ? "Refreshing ChatGPT authorization..."
            : "Opening ChatGPT authorization..."
          : `Connecting ${getModelProviderDescriptor(providerId).shortLabel}...`
    });

    try {
      const result = await adapter.connect({
        apiKey: draft.apiKey,
        authMethod: options?.authMethod,
        force: options?.force
      });
      const shouldDiscover =
        result.connection.connected &&
        !result.manualCommand &&
        !hasVisibleModelsForProvider(providerId);

      applyActionResult(
        providerId,
        result,
        shouldDiscover ? "discovering" : "idle",
        {
          apiKey: ""
        }
      );
      applySnapshotResult(result);

      if (shouldDiscover) {
        await discoverProvider(providerId, true);
      }
    } catch (error) {
      updateDraft(providerId, {
        flowState: "error",
        errorMessage: error instanceof Error ? error.message : "Provider connection failed."
      });
    }
  }

  async function discoverProvider(providerId: AddModelsProviderId, force = false) {
    const adapter = getModelProviderAdapter(providerId);
    const draft = resolveDraft(providerDrafts[providerId]);

    if (!force && draft.flowState === "discovering") {
      return;
    }

    updateDraft(providerId, {
      flowState: "discovering",
      errorMessage: null,
      statusMessage:
        providerId === "ollama"
          ? "Checking the local Ollama runtime..."
          : `Discovering ${getModelProviderDescriptor(providerId).shortLabel} models...`
    });

    try {
      const result = await adapter.discoverModels();
      applyActionResult(
        providerId,
        result,
        result.models.length > 0 ? "ready" : "idle",
        {
          search: draft.search
        }
      );
      applySnapshotResult(result);
    } catch (error) {
      updateDraft(providerId, {
        flowState: "error",
        errorMessage: error instanceof Error ? error.message : "Provider discovery failed."
      });
    }
  }

  function applySnapshotResult(result: AddModelsProviderActionResult) {
    if (result.snapshot) {
      onSnapshotChange?.(result.snapshot);
    }
  }

  function chooseModel(model: AddModelsCatalogModel) {
    if (isAddModelsProviderId(model.provider)) {
      setActiveProviderId(model.provider);
    }

    onSelectedModelIdChange(model.id);
  }

  function hasVisibleModelsForProvider(providerId: AddModelsProviderId) {
    return snapshot.models.some(
      (model) =>
        modelMatchesProvider(providerId, model.id, model.provider) &&
        model.available !== false &&
        !model.missing
    );
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied.", {
        description: "Command copied to your clipboard."
      });
    } catch (error) {
      toast.error("Copy failed.", {
        description: error instanceof Error ? error.message : "Clipboard access is not available."
      });
    }
  }

  async function openTerminal(command: string) {
    if (!isOpenClawTerminalCommand(command)) {
      await copyText(command);
      return;
    }

    setIsOpeningTerminal(true);

    try {
      const response = await fetch("/api/system/open-terminal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          command
        })
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Unable to open Terminal.");
      }

      toast.success("Terminal opened.", {
        description: "Finish auth there, then refresh this provider."
      });
    } catch (error) {
      toast.error("Could not open Terminal.", {
        description: error instanceof Error ? error.message : "Open Terminal manually and run the command."
      });
    } finally {
      setIsOpeningTerminal(false);
    }
  }

  return (
    <>
      <PikoLoader
        open={showLoadingHero || isOpeningTerminal}
        title={isOpeningTerminal ? "Opening provider terminal" : loadingHeroTitle}
        description={
          isOpeningTerminal
            ? "Opening the recovery command for this provider."
            : activeDraft.flowState === "connecting" && activeProviderId === "openai"
              ? "Complete the OpenClaw authorization page in your browser. AgentOS will refresh the provider automatically."
              : activeDraft.flowState === "discovering"
                ? "Pulling the provider catalog into AgentOS."
                : "Refreshing OpenClaw provider status."
        }
      />
      <div
        className={cn(
          compactSelection ? "mt-0" : "mt-3 rounded-[16px] border px-3 py-3",
          !compactSelection &&
            (isLight ? "border-[#e3d5c8] bg-[#fffaf6]" : "border-white/8 bg-[rgba(255,255,255,0.03)]")
        )}
      >
      {!compactSelection ? (
        <div className="flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p className={cn("whitespace-nowrap text-[8px] font-medium", isLight ? "text-[#8f7664]" : "text-slate-500")}>
              {`Provider first : ${providerDescriptors.length} providers`}
            </p>
          </div>
          <div className="flex shrink-0 flex-wrap gap-1.5">
            {selectedModelLabel ? (
              <Badge variant="default" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                Selected
              </Badge>
            ) : null}
          </div>
        </div>
      ) : null}

      {sharedCatalogError || sharedCatalogWarning || explicitProviderError ? (
        <div className={cn("mt-2 rounded-[12px] border px-2.5 py-2 text-[9px] leading-4", isLight ? "border-amber-200 bg-amber-50 text-amber-800" : "border-amber-300/20 bg-amber-300/[0.06] text-amber-100")}
        >
          {sharedCatalogError || sharedCatalogWarning || explicitProviderError}
        </div>
      ) : null}

      {!compactSelection ? <div className="mt-3 flex snap-x snap-mandatory flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-2 pr-1">
        <div className="w-[128px] shrink-0 snap-start sm:w-[136px]">
          <button
            type="button"
            onClick={() => onOpenAddModels()}
            className={cn(
              "group flex h-full min-h-[104px] w-full flex-col justify-between rounded-[16px] border p-2 text-left transition-colors",
              isLight
                ? "border-cyan-200 bg-cyan-50/70 text-[#2d241f] hover:border-cyan-300 hover:bg-cyan-50"
                : "border-cyan-300/30 bg-cyan-300/[0.06] text-white hover:border-cyan-300/50 hover:bg-cyan-300/[0.1]"
            )}
            aria-label="Browse all models"
          >
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-[9px] border", isLight ? "border-cyan-200 bg-white text-cyan-700" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100")}>
              <Search className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-display text-[0.72rem]">All models</span>
              <span className={cn("mt-1 block text-[8px] leading-[0.85rem]", isLight ? "text-[#71675d]" : "text-slate-400")}>
                Browse the complete model catalog.
              </span>
            </span>
          </button>
        </div>
        {providerDescriptors.map((provider) => {
          const draft = resolveDraft(providerDrafts[provider.id]);
          const connection = draft.connection ?? resolveConnectionDetail(snapshot, provider.id);

          return (
            <div key={provider.id} className="w-[128px] shrink-0 snap-start sm:w-[136px]">
              <ProviderCard
                descriptor={provider}
                active={activeProviderId === provider.id}
                compact
                micro
                connected={connection.connected}
                detail={connection.detail}
                surfaceTheme={surfaceTheme}
                onClick={() => {
                  setActiveProviderId(provider.id);
                  if (selectedProviderId && selectedProviderId !== provider.id) {
                    onSelectedModelIdChange("");
                  }
                }}
              />
            </div>
          );
        })}
        <div className="w-[128px] shrink-0 snap-start sm:w-[136px]">
          <button
            type="button"
            onClick={() => onOpenAddModels("custom")}
            className={cn(
              "group flex h-full min-h-[104px] w-full flex-col justify-between rounded-[16px] border border-dashed p-2 text-left transition-colors",
              isLight
                ? "border-[#d8cfc2] bg-white/60 text-[#2d241f] hover:border-cyan-300 hover:bg-cyan-50/60"
                : "border-white/15 bg-white/[0.025] text-white hover:border-cyan-300/40 hover:bg-cyan-300/[0.06]"
            )}
            aria-label="Add custom provider"
          >
            <span className={cn("flex h-6 w-6 items-center justify-center rounded-[9px] border", isLight ? "border-cyan-200 bg-cyan-50 text-cyan-700" : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100")}>
              <Plus className="h-3.5 w-3.5" aria-hidden="true" />
            </span>
            <span>
              <span className="block font-display text-[0.72rem]">Custom provider</span>
              <span className={cn("mt-1 block text-[8px] leading-[0.85rem]", isLight ? "text-[#71675d]" : "text-slate-400")}>
                Add an OpenAI-compatible endpoint.
              </span>
            </span>
          </button>
        </div>
      </div> : null}

      <div
        className={cn(
          compactSelection ? "mt-3" : "mt-3 rounded-[18px] border p-3",
          !compactSelection &&
            (isLight
              ? "border-[#e3d5c8] bg-[linear-gradient(180deg,rgba(255,252,248,0.98),rgba(247,241,234,0.95))]"
              : "border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))]")
        )}
      >
        {!compactSelection ? (
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className={cn("font-display text-[0.88rem]", isLight ? "text-[#2d241f]" : "text-white")}>
                {activeDescriptor.label}
              </p>
            </div>

            <Badge
              variant={activeConnection.verification === "verified" ? "success" : "muted"}
              className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]"
            >
              {activeConnectionLabel}
            </Badge>
          </div>
        ) : null}

        {activeDraft.statusMessage && !showLoadingHero && !compactSelection ? (
          <div className={cn("mt-3 rounded-[16px] border px-3 py-2", isLight ? "border-[#e3d5c8] bg-white/70" : "border-white/10 bg-white/[0.04]")}>
            <p className={cn("text-[11px]", isLight ? "text-[#4f3d31]" : "text-slate-200")}>{activeDraft.statusMessage}</p>
          </div>
        ) : null}

        {activeDraft.errorMessage ? (
          <div className="mt-3 rounded-[16px] border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-[11px] text-rose-100">
            {activeDraft.errorMessage}
          </div>
        ) : null}

        {activeDescriptor.connectKind === "apiKey" && !activeConnection.connected && activeModels.length === 0 && !showLoadingHero ? (
          <div className="mt-4 flex flex-wrap items-end gap-3">
            <div className="min-w-0 flex-1">
              <label className="block text-[9px] uppercase tracking-[0.16em] text-slate-500">API key</label>
              <Input
                type="password"
                value={activeDraft.apiKey}
                onChange={(event) => updateDraft(activeProviderId, { apiKey: event.target.value })}
                placeholder={activeProviderId === "openrouter" ? "sk-or-v1-..." : "Paste API key"}
                className="mt-1.5 h-8 text-[11px]"
              />
            </div>
            <Button
              type="button"
              className="h-8 rounded-full px-3 text-[10px]"
              disabled={activeDraft.flowState === "connecting" || !activeDraft.apiKey.trim()}
              onClick={() => {
                void connectProvider(activeProviderId);
              }}
            >
              {activeDraft.flowState === "connecting" ? (
                <>
                  <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                  Connecting...
                </>
              ) : (
                `Connect ${activeDescriptor.shortLabel}`
              )}
            </Button>
          </div>
        ) : null}

        {activeDescriptor.connectKind === "apiKey" && activeDraft.manualCommand && !showLoadingHero ? (
          <div className="mt-3 rounded-[16px] border border-cyan-300/15 bg-cyan-300/[0.07] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-medium text-cyan-50">Finish setup in Terminal</p>
                <p className="mt-1 max-w-[460px] text-[10px] leading-[0.98rem] text-cyan-100/80">
                  Open Terminal, paste the provider API key there, then come back and refresh this provider.
                </p>
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-[10px]"
                  disabled={isOpeningTerminal}
                  onClick={() => {
                    void openTerminal(activeDraft.manualCommand || "");
                  }}
                >
                  {isOpeningTerminal ? (
                    <>
                      <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                      Opening...
                    </>
                  ) : (
                    <>
                      <SquareTerminal className="mr-1.5 h-3 w-3" />
                      Open Terminal
                    </>
                  )}
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-[10px]"
                  onClick={() => {
                    void copyText(activeDraft.manualCommand || "");
                  }}
                >
                  <Copy className="mr-1.5 h-3 w-3" />
                  Copy command
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-7 rounded-full px-2.5 text-[10px]"
                  onClick={() => {
                    void refreshProvider(activeProviderId);
                  }}
                >
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                  I&apos;ve connected it
                </Button>
              </div>
            </div>
            <div className={cn("mt-2.5 overflow-x-auto rounded-[14px] border px-3 py-2", isLight ? "border-[#e3d5c8] bg-white/80" : "border-white/10 bg-slate-950/60")}>
              <code className={cn("text-[10px]", isLight ? "text-[#4f3d31]" : "text-slate-200")}>{activeDraft.manualCommand}</code>
            </div>
          </div>
        ) : null}

        {showLoadingHero ? (
          <div
            className={cn(
              "relative mt-4 flex min-h-[280px] items-center justify-center overflow-hidden rounded-[28px] border px-4 py-10 text-center",
              isLight
                ? "border-cyan-200 bg-[radial-gradient(circle_at_top,rgba(207,244,250,0.9),rgba(255,252,248,0.98)_70%)] shadow-[0_22px_52px_rgba(122,91,68,0.12)]"
                : "border-cyan-300/20 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),rgba(8,15,28,0.98)_70%)] shadow-[0_22px_52px_rgba(7,11,20,0.32)]"
            )}
          >
            <div className="absolute inset-x-8 top-8 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent blur-sm animate-pulse" />
            <div className="absolute inset-x-8 bottom-8 h-px bg-gradient-to-r from-transparent via-cyan-200/30 to-transparent blur-sm animate-pulse [animation-delay:180ms]" />
            <div className="absolute left-8 top-8 h-24 w-24 rounded-full border border-cyan-300/15 bg-cyan-300/[0.04] blur-[1px] animate-pulse" />
            <div className="absolute right-10 top-14 h-16 w-16 rounded-full border border-cyan-300/10 bg-cyan-300/[0.03] blur-[1px] animate-pulse [animation-delay:120ms]" />
            <div className="absolute bottom-10 left-1/2 h-20 w-20 -translate-x-1/2 rounded-full border border-cyan-300/10 bg-cyan-300/[0.03] blur-[1px] animate-pulse [animation-delay:240ms]" />
            <div className="relative flex max-w-[340px] flex-col items-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] shadow-[0_0_0_8px_rgba(34,211,238,0.05)]">
                <LoaderCircle className={cn("h-8 w-8 animate-spin", isLight ? "text-cyan-700" : "text-cyan-200")} />
              </div>
              <p className={cn("font-display text-[1.1rem] leading-[1.2rem] tracking-[0.01em]", isLight ? "text-[#2d241f]" : "text-white")}>
                {loadingHeroTitle}
              </p>
              <p className={cn("mt-2 max-w-[280px] text-[11px] leading-[1rem]", isLight ? "text-[#74665c]" : "text-slate-400")}>
                {activeDraft.flowState === "discovering"
                  ? "Pulling the provider catalog into AgentOS, then checking the default model."
                  : activeDraft.flowState === "verifying"
                    ? "Checking the provider connection, refreshing OpenClaw state, and waiting for the default model to appear."
                  : activeDraft.flowState === "connecting"
                    ? "Preparing the provider connection."
                    : "Checking provider status before discovery."}
              </p>
              <div className="mt-4 flex gap-1.5">
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/90" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/60 [animation-delay:120ms]" />
                <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-cyan-300/30 [animation-delay:240ms]" />
              </div>
            </div>
          </div>
        ) : null}

        {activeProviderId === "openai" && !showLoadingHero && !compactSelection ? (
          <div className={cn("mt-4 rounded-[20px] border p-3", isLight ? "border-[#e3d5c8] bg-white/70" : "border-white/10 bg-white/[0.03]")}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className={cn("font-display text-[0.88rem]", isLight ? "text-[#2d241f]" : "text-white")}>Connect ChatGPT</p>
                <p className={cn("mt-1 max-w-[500px] text-[10px] leading-[0.98rem]", isLight ? "text-[#74665c]" : "text-slate-400")}>
                  OpenClaw {OPENCLAW_RECOMMENDED_VERSION} keeps ChatGPT OAuth under provider <code>openai</code> and runtime <code>codex</code>.
                </p>
              </div>
              <Button
                type="button"
                className="h-8 rounded-full px-3 text-[10px]"
                disabled={activeDraft.flowState === "connecting" && !activeDraft.manualCommand}
                onClick={() => {
                  void connectProvider(activeProviderId, { authMethod: "chatgpt-oauth" });
                }}
              >
                {activeDraft.flowState === "connecting" && !activeDraft.manualCommand ? (
                  <>
                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                    Connecting...
                  </>
                ) : (
                  "Connect ChatGPT"
                )}
              </Button>
              <Button
                type="button"
                variant="ghost"
                className="h-8 rounded-full px-3 text-[10px]"
                disabled={activeDraft.flowState === "connecting" && !activeDraft.manualCommand}
                onClick={() => {
                  void connectProvider(activeProviderId, { force: true, authMethod: "chatgpt-oauth" });
                }}
              >
                Reconnect ChatGPT
              </Button>
            </div>

          </div>
        ) : null}

        {compactSelection ? (
          <div className="mt-0">
            {activeModels.length > 0 && !showLoadingHero ? (
              <>
                <label
                  htmlFor="chatgpt-model-select"
                  className={cn("block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-[#8c8177]" : "text-slate-500")}
                >
                  Available ChatGPT models
                </label>
                <select
                  id="chatgpt-model-select"
                  aria-label="ChatGPT model"
                  value={selectedModelId}
                  onChange={(event) => onSelectedModelIdChange(event.target.value)}
                  className={cn(
                    "mt-2 h-10 w-full rounded-[12px] border bg-transparent px-3 text-[12px] outline-none transition-colors",
                    isLight
                      ? "border-[#d8c9bc] bg-white text-[#2d241f] focus:border-cyan-400"
                      : "border-white/12 bg-slate-950/70 text-white focus:border-cyan-300/60"
                  )}
                >
                  {activeModels.map((model) => (
                    <option
                      key={model.id}
                      value={model.id}
                      className={isLight ? "bg-white text-[#2d241f]" : "bg-slate-950 text-white"}
                    >
                      {model.name} ({model.id})
                    </option>
                  ))}
                </select>
                <label
                  htmlFor="chatgpt-reasoning-select"
                  className={cn("mt-4 block text-[9px] uppercase tracking-[0.16em]", isLight ? "text-[#8c8177]" : "text-slate-500")}
                >
                  Reasoning
                </label>
                <select
                  id="chatgpt-reasoning-select"
                  aria-label="Reasoning level"
                  value={selectedThinking}
                  onChange={(event) => onSelectedThinkingChange(event.target.value as OpenClawThinkingLevel)}
                  className={cn(
                    "mt-2 h-10 w-full rounded-[12px] border bg-transparent px-3 text-[12px] outline-none transition-colors",
                    isLight
                      ? "border-[#d8c9bc] bg-white text-[#2d241f] focus:border-cyan-400"
                      : "border-white/12 bg-slate-950/70 text-white focus:border-cyan-300/60"
                  )}
                >
                  {[
                    ["off", "Off"],
                    ["minimal", "Minimal"],
                    ["low", "Low"],
                    ["medium", "Medium"],
                    ["high", "High"],
                    ["xhigh", "Xhigh"]
                  ].map(([value, label]) => (
                    <option
                      key={value}
                      value={value}
                      className={isLight ? "bg-white text-[#2d241f]" : "bg-slate-950 text-white"}
                    >
                      {label}
                    </option>
                  ))}
                </select>
                {onContinue ? (
                  <Button
                    type="button"
                    onClick={onContinue}
                    disabled={!selectedModelId || activeDraft.flowState === "discovering"}
                    className="mt-4 h-10 w-full rounded-full text-[12px]"
                  >
                    Continue to AgentOS
                    <ArrowRight className="ml-1.5 h-3 w-3" />
                  </Button>
                ) : null}
              </>
            ) : !showLoadingHero ? (
              <div className={cn("rounded-[16px] border border-dashed px-3 py-4 text-[11px]", isLight ? "border-[#d8cfc2] bg-white/60 text-[#74665c]" : "border-white/10 bg-white/[0.02] text-slate-400")}>
                No ChatGPT models are available yet. Refresh the provider and try again.
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void refreshProvider(activeProviderId);
                  }}
                  className="mt-3 h-7 rounded-full px-2.5 text-[10px]"
                >
                  <RefreshCw className="mr-1.5 h-3 w-3" />
                  Refresh ChatGPT models
                </Button>
              </div>
            ) : null}
          </div>
        ) : canShowModelList && !showLoadingHero ? (
          <>
            <div className="mt-4 flex flex-nowrap items-center justify-between gap-2 overflow-x-auto pb-1">
              <p className={cn("shrink-0 whitespace-nowrap text-[9px] uppercase tracking-[0.16em]", isLight ? "text-[#8c8177]" : "text-slate-500")}>
                {activeModels.length > 0
                  ? `Found ${activeModels.length} model${activeModels.length === 1 ? "" : "s"}`
                  : "No models found"}
              </p>
              <div className="flex shrink-0 flex-nowrap gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => {
                    void refreshProvider(activeProviderId);
                  }}
                  className="h-6 rounded-full px-2 text-[9px]"
                >
                  <RefreshCw className="mr-1 h-2.5 w-2.5" />
                  Refresh
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onOpenAddModels(activeProviderId)}
                  className="h-6 rounded-full px-2 text-[9px]"
                >
                  Add Models
                </Button>
              </div>
            </div>

            {canShowSearch ? (
              <div className="relative mt-3">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                <Input
                  value={activeDraft.search}
                  onChange={(event) => updateDraft(activeProviderId, { search: event.target.value })}
                  placeholder={activeDescriptor.searchPlaceholder ?? "Search models"}
                  className="h-8 pl-8 text-[11px]"
                />
              </div>
            ) : null}

            {activeDraft.emptyState ? (
              <EmptyStateCard
                emptyState={activeDraft.emptyState}
                onRefresh={() => {
                  void refreshProvider(activeProviderId);
                }}
              />
            ) : null}

            {activeModels.length > 0 ? (
              <div className="mt-3 space-y-1 pr-1">
                {activeModels.map((model) => {
                  const selected = selectedModelId === model.id;

                  return (
                    <button
                      key={model.id}
                      type="button"
                      onClick={() => {
                        void chooseModel(model);
                      }}
                      className={cn(
                        "flex w-full items-start justify-between gap-2 rounded-[14px] border px-2.5 py-2 text-left transition-all",
                        selected
                          ? isLight
                            ? "border-cyan-300 bg-cyan-50"
                            : "border-cyan-300/35 bg-cyan-300/[0.08]"
                          : isLight
                            ? "border-[#e6d8cb] bg-white/80 hover:border-[#d8c6b8] hover:bg-white"
                            : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"
                      )}
                    >
                      <div className="min-w-0">
                        <p className={cn("truncate text-[11px] font-medium", isLight ? "text-[#2d241f]" : "text-white")}>{model.name}</p>
                        <p className={cn("mt-0.5 truncate text-[9px] uppercase tracking-[0.16em]", isLight ? "text-[#8c8177]" : "text-slate-500")}>
                          {model.id}
                        </p>
                        <div className={cn("mt-1 flex flex-wrap gap-1.5 text-[9px]", isLight ? "text-[#74665c]" : "text-slate-400")}>
                          <span>{model.input}</span>
                          {model.contextWindow ? <span>{Intl.NumberFormat().format(model.contextWindow)} ctx</span> : null}
                          {model.isFree ? <span>free</span> : null}
                        </div>
                      </div>
                      <div className="shrink-0">
                        {selected ? (
                          <Badge variant="default" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                            Selected
                          </Badge>
                        ) : model.recommended ? (
                          <Badge variant="default" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                            Recommended
                          </Badge>
                        ) : model.local ? (
                          <Badge variant="success" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                            Local
                          </Badge>
                        ) : (
                          <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                            Remote
                          </Badge>
                        )}
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-[16px] border border-dashed border-white/10 bg-white/[0.02] px-3 py-4 text-[11px] text-slate-400">
                No models are visible yet. Refresh this provider or open the full Add Models flow.
              </div>
            )}
          </>
        ) : null}

        {!compactSelection && selectedModelLabel && !showLoadingHero ? (
          <div
            className={cn(
              "mt-3 flex items-center justify-between gap-2 rounded-[16px] border px-3 py-2",
              isLight ? "border-emerald-200 bg-emerald-50" : "border-emerald-300/15 bg-emerald-300/[0.06]"
            )}
          >
            <div className="min-w-0">
              <p className={cn("text-[8px] uppercase tracking-[0.16em]", isLight ? "text-emerald-700/75" : "text-emerald-200/75")}>Selected model</p>
              <p className={cn("truncate text-[11px]", isLight ? "text-emerald-900" : "text-emerald-50")}>{selectedModelLabel}</p>
            </div>
            <Badge variant="default" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
              Selected
            </Badge>
          </div>
        ) : null}
      </div>
      </div>
    </>
  );
}

function EmptyStateCard({
  emptyState,
  onRefresh
}: {
  emptyState: AddModelsEmptyState;
  onRefresh: () => void;
}) {
  return (
    <div className="mt-3 rounded-[18px] border border-white/10 bg-white/[0.03] p-3">
      <p className="font-display text-[0.88rem] text-white">{emptyState.title}</p>
      <p className="mt-1 max-w-[520px] text-[11px] leading-[0.98rem] text-slate-400">{emptyState.description}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="h-7 rounded-full px-2.5 text-[10px]"
          onClick={onRefresh}
        >
          <RefreshCw className="mr-1.5 h-3 w-3" />
          Refresh provider
        </Button>
      </div>
    </div>
  );
}

function resolveDraft(draft?: ProviderDraft): ProviderDraft {
  return draft ? draft : initialDraftState();
}

function resolveConnectionDetail(
  snapshot: MissionControlSnapshot,
  providerId: AddModelsProviderId
): AddModelsProviderConnectionStatus {
  const readinessProvider = snapshot.diagnostics.modelReadiness.authProviders.find(
    (provider) => provider.provider === providerId
  );
  const localModelCount = snapshot.models.filter((model) => modelMatchesProvider(providerId, model.id, model.provider)).length;

  if (providerId === "ollama") {
    return {
      provider: providerId,
      connected: Boolean(localModelCount > 0),
      verification: localModelCount > 0 ? "verified" : "not-configured",
      canConnect: true,
      needsTerminal: false,
      source: "local-runtime",
      degraded: false,
      stale: false,
      recovery: localModelCount > 0 ? null : "Start Ollama and refresh local model discovery.",
      detail:
        localModelCount > 0
          ? `${localModelCount} model${localModelCount === 1 ? "" : "s"} already visible in AgentOS.`
          : "Detect local models from this machine."
    };
  }

  const connected = Boolean(readinessProvider?.connected);
  const descriptor = getModelProviderDescriptor(providerId);

  return {
    provider: providerId,
    authMethod: readinessProvider?.authMethod ?? null,
    availableAuthMethods: readinessProvider?.availableAuthMethods ?? (
      descriptor.authMethods
        ? [...descriptor.authMethods]
        : undefined
    ),
    connected,
    verification: connected ? "credential-stored" as const : "not-configured" as const,
    canConnect: true,
    needsTerminal: false,
    source: readinessProvider ? "gateway" : "unknown",
    degraded: false,
    stale: false,
    recovery: connected ? null : `Connect ${formatProviderLabel(providerId)} through OpenClaw, then refresh discovery.`,
    detail: connected
      ? readinessProvider?.detail || getModelProviderDescriptor(providerId).helperText
      : localModelCount > 0
        ? `${localModelCount} model${localModelCount === 1 ? "" : "s"} are already saved in AgentOS. Connect ${formatProviderLabel(providerId)} to use them.`
        : getModelProviderDescriptor(providerId).helperText
  };
}

function resolveProviderConnectionLabel(
  connection: Pick<AddModelsProviderConnectionStatus, "connected" | "degraded" | "stale" | "verification" | "authMethod">
) {
  if (connection.stale) {
    return "Cached";
  }

  if (connection.degraded || connection.verification === "degraded") {
    return connection.connected ? "Degraded" : "Needs reconnect";
  }

  if (connection.verification === "verified") {
    return "Verified";
  }

  if (connection.verification === "credential-stored") {
    if (connection.authMethod === "chatgpt-oauth") {
      return "ChatGPT connected";
    }

    return "Credential stored";
  }

  return connection.connected ? "Connected" : "Not connected";
}

function modelMatchesProvider(providerId: AddModelsProviderId, modelId: string, modelProvider?: string | null) {
  return modelMatchesAddModelsProvider(providerId, modelId, modelProvider);
}
