"use client";

import { Copy, LoaderCircle, RefreshCw, Search, SquareTerminal } from "lucide-react";
import { useEffect, useMemo, useState } from "react";

import { ProviderCard } from "@/components/mission-control/add-models/provider-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import type {
  AddModelsCatalogModel,
  AddModelsEmptyState,
  AddModelsProviderActionResult,
  AddModelsProviderConnectionStatus,
  AddModelsProviderId,
  MissionControlSnapshot
} from "@/lib/agentos/contracts";
import {
  formatProviderLabel,
  resolveModelProvider,
  resolveInitialOnboardingProviderId
} from "@/components/mission-control/openclaw-onboarding.utils";
import {
  getModelProviderDescriptor,
  modelProviderRegistry,
  normalizeAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import { getModelProviderAdapter } from "@/lib/openclaw/model-provider-adapters";
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
  flowState: "idle" | "connecting" | "discovering" | "ready" | "error";
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
  selectedModelId,
  onSelectedModelIdChange,
  onOpenAddModels
}: {
  snapshot: MissionControlSnapshot;
  selectedModelId: string;
  onSelectedModelIdChange: (value: string) => void;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
}) {
  const [activeProviderId, setActiveProviderId] = useState<AddModelsProviderId>(() =>
    resolveInitialOnboardingProviderId(snapshot, selectedModelId)
  );
  const [providerDrafts, setProviderDrafts] = useState<Partial<Record<AddModelsProviderId, ProviderDraft>>>(
    {}
  );
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);

  const selectedProviderId = useMemo(
    () => normalizeAddModelsProviderId(resolveModelProvider(selectedModelId)),
    [selectedModelId]
  );

  useEffect(() => {
    if (selectedProviderId) {
      setActiveProviderId((currentProviderId) =>
        currentProviderId === selectedProviderId ? currentProviderId : selectedProviderId
      );
    }
  }, [selectedProviderId]);

  useEffect(() => {
    void ensureProviderStatus(activeProviderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeProviderId]);

  const activeDescriptor = getModelProviderDescriptor(activeProviderId);
  const activeDraft = resolveDraft(providerDrafts[activeProviderId]);
  const activeConnection = activeDraft.connection ?? resolveConnectionDetail(snapshot, activeProviderId);
  const activeModels = useMemo(() => {
    const query = activeDraft.search.trim().toLowerCase();

    return activeDraft.models
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
  }, [activeDraft.models, activeDraft.search]);

  const selectedModelLabel =
    snapshot.models.find((model) => model.id === selectedModelId)?.name ||
    activeModels.find((model) => model.id === selectedModelId)?.name ||
    selectedModelId.trim() ||
    null;
  const showLoadingHero =
    activeDraft.flowState === "connecting" ||
    activeDraft.flowState === "discovering" ||
    (activeDraft.statusMessage?.startsWith("Checking ") === true && !activeConnection.connected);
  const loadingHeroTitle =
    activeDraft.flowState === "discovering"
      ? `Discovering ${activeDescriptor.shortLabel} models...`
      : activeDraft.flowState === "connecting"
        ? activeDraft.statusMessage || `Connecting ${activeDescriptor.shortLabel}...`
        : activeDraft.statusMessage || `Checking ${activeDescriptor.shortLabel}...`;
  const canShowSearch = activeModels.length > 6 || Boolean(activeDescriptor.searchPlaceholder);

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

    updateDraft(providerId, {
      flowState: "idle",
      errorMessage: null,
      statusMessage: `Checking ${formatProviderLabel(providerId)}...`
    });

    try {
      const result = await adapter.getConnectionStatus();
      const nextState = result.connection.connected ? "discovering" : "idle";

      applyActionResult(providerId, result, nextState);

      if (result.connection.connected) {
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

  async function connectProvider(providerId: AddModelsProviderId) {
    const adapter = getModelProviderAdapter(providerId);
    const draft = resolveDraft(providerDrafts[providerId]);

    updateDraft(providerId, {
      flowState: "connecting",
      errorMessage: null,
      statusMessage:
        providerId === "openai-codex"
          ? "Opening the ChatGPT sign-in flow..."
          : `Connecting ${getModelProviderDescriptor(providerId).shortLabel}...`
    });

    try {
      const result = await adapter.connect({
        apiKey: draft.apiKey
      });

      applyActionResult(
        providerId,
        result,
        result.manualCommand ? "idle" : result.connection.connected ? "discovering" : "idle",
        {
          apiKey: result.manualCommand ? draft.apiKey : ""
        }
      );

      if (result.connection.connected && !result.manualCommand) {
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
    } catch (error) {
      updateDraft(providerId, {
        flowState: "error",
        errorMessage: error instanceof Error ? error.message : "Provider discovery failed."
      });
    }
  }

  function chooseModel(model: AddModelsCatalogModel) {
    onSelectedModelIdChange(model.id);
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
    if (!command.trim().startsWith("openclaw ")) {
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
    <div
      className={cn(
        "mt-3 rounded-[16px] border px-3 py-3",
        "border-white/8 bg-[rgba(255,255,255,0.03)]"
      )}
    >
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="whitespace-nowrap text-[8px] font-medium text-slate-500">
            Provider first : {modelProviderRegistry.length} providers
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

      <div className="mt-3 flex snap-x snap-mandatory flex-nowrap gap-2 overflow-x-auto overflow-y-hidden pb-2 pr-1">
        {modelProviderRegistry.map((provider) => {
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
      </div>

      <div className="mt-3 rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))] p-3">
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="font-display text-[0.88rem] text-white">{activeDescriptor.label}</p>
          </div>

          <Badge
            variant={activeConnection.connected ? "success" : "muted"}
            className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]"
          >
            {activeConnection.connected ? "Connected" : "Not connected"}
          </Badge>
        </div>

        {activeDraft.statusMessage && !showLoadingHero ? (
          <div className="mt-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2">
            <p className="text-[11px] text-slate-200">{activeDraft.statusMessage}</p>
          </div>
        ) : null}

        {activeDraft.errorMessage ? (
          <div className="mt-3 rounded-[16px] border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-[11px] text-rose-100">
            {activeDraft.errorMessage}
          </div>
        ) : null}

        {activeDescriptor.connectKind === "apiKey" && !activeConnection.connected && !showLoadingHero ? (
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

        {showLoadingHero ? (
          <div className="relative mt-4 flex min-h-[280px] items-center justify-center overflow-hidden rounded-[28px] border border-cyan-300/20 bg-[radial-gradient(circle_at_top,rgba(34,211,238,0.16),rgba(8,15,28,0.98)_70%)] px-4 py-10 text-center shadow-[0_22px_52px_rgba(7,11,20,0.32)]">
            <div className="absolute inset-x-8 top-8 h-px bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent blur-sm animate-pulse" />
            <div className="absolute inset-x-8 bottom-8 h-px bg-gradient-to-r from-transparent via-cyan-200/30 to-transparent blur-sm animate-pulse [animation-delay:180ms]" />
            <div className="absolute left-8 top-8 h-24 w-24 rounded-full border border-cyan-300/15 bg-cyan-300/[0.04] blur-[1px] animate-pulse" />
            <div className="absolute right-10 top-14 h-16 w-16 rounded-full border border-cyan-300/10 bg-cyan-300/[0.03] blur-[1px] animate-pulse [animation-delay:120ms]" />
            <div className="absolute bottom-10 left-1/2 h-20 w-20 -translate-x-1/2 rounded-full border border-cyan-300/10 bg-cyan-300/[0.03] blur-[1px] animate-pulse [animation-delay:240ms]" />
            <div className="relative flex max-w-[340px] flex-col items-center">
              <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full border border-cyan-300/20 bg-cyan-300/[0.08] shadow-[0_0_0_8px_rgba(34,211,238,0.05)]">
                <LoaderCircle className="h-8 w-8 animate-spin text-cyan-200" />
              </div>
              <p className="font-display text-[1.1rem] leading-[1.2rem] tracking-[0.01em] text-white">
                {loadingHeroTitle}
              </p>
              <p className="mt-2 max-w-[280px] text-[11px] leading-[1rem] text-slate-400">
                {activeDraft.flowState === "discovering"
                  ? "Pulling the provider catalog into AgentOS."
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

        {activeDescriptor.connectKind === "oauth" && !activeConnection.connected && !showLoadingHero ? (
          <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.03] p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="font-display text-[0.88rem] text-white">Connect your ChatGPT account</p>
                <p className="mt-1 max-w-[500px] text-[10px] leading-[0.98rem] text-slate-400">
                  This uses OpenClaw&apos;s account-based login flow. No API key is required.
                </p>
              </div>
              <Button
                type="button"
                className="h-8 rounded-full px-3 text-[10px]"
                disabled={activeDraft.flowState === "connecting" && !activeDraft.manualCommand}
                onClick={() => {
                  void connectProvider(activeProviderId);
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
            </div>

            {activeDraft.manualCommand ? (
              <div className="mt-3 rounded-[16px] border border-cyan-300/15 bg-cyan-300/[0.07] p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="text-[11px] font-medium text-cyan-50">Finish sign-in in Terminal</p>
                    <p className="mt-1 max-w-[460px] text-[10px] leading-[0.98rem] text-cyan-100/80">
                      Open Terminal, complete the provider login, then come back and refresh this provider.
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
                <div className="mt-2.5 overflow-x-auto rounded-[14px] border border-white/10 bg-slate-950/60 px-3 py-2">
                  <code className="text-[10px] text-slate-200">{activeDraft.manualCommand}</code>
                </div>
              </div>
            ) : null}
          </div>
        ) : null}

        {activeConnection.connected && !showLoadingHero ? (
          <>
            <div className="mt-4 flex flex-nowrap items-center justify-between gap-2 overflow-x-auto pb-1">
              <p className="shrink-0 whitespace-nowrap text-[9px] uppercase tracking-[0.16em] text-slate-500">
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
              <div className="mt-3 max-h-[min(34vh,260px)] space-y-1 overflow-y-auto pr-1">
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
                          ? "border-cyan-300/35 bg-cyan-300/[0.08]"
                          : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"
                      )}
                    >
                      <div className="min-w-0">
                        <p className="truncate text-[11px] font-medium text-white">{model.name}</p>
                        <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.16em] text-slate-500">
                          {model.id}
                        </p>
                        <div className="mt-1 flex flex-wrap gap-1.5 text-[9px] text-slate-400">
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

        {selectedModelLabel && !showLoadingHero ? (
          <div className="mt-3 flex items-center justify-between gap-2 rounded-[16px] border border-emerald-300/15 bg-emerald-300/[0.06] px-3 py-2">
            <div className="min-w-0">
              <p className="text-[8px] uppercase tracking-[0.16em] text-emerald-200/75">Selected model</p>
              <p className="truncate text-[11px] text-emerald-50">{selectedModelLabel}</p>
            </div>
            <Badge variant="default" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
              Selected
            </Badge>
          </div>
        ) : null}
      </div>
    </div>
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

function resolveConnectionDetail(snapshot: MissionControlSnapshot, providerId: AddModelsProviderId) {
  const readinessProvider = snapshot.diagnostics.modelReadiness.authProviders.find(
    (provider) => provider.provider === providerId
  );
  const localModelCount = snapshot.models.filter((model) => model.id.startsWith(`${providerId}/`)).length;

  if (providerId === "ollama") {
    return {
      connected: Boolean(localModelCount > 0),
      detail:
        localModelCount > 0
          ? `${localModelCount} model${localModelCount === 1 ? "" : "s"} already visible in AgentOS.`
          : "Detect local models from this machine."
    };
  }

  const connected = Boolean(readinessProvider?.connected);

  return {
    connected,
    detail: connected
      ? readinessProvider?.detail || getModelProviderDescriptor(providerId).helperText
      : localModelCount > 0
        ? `${localModelCount} model${localModelCount === 1 ? "" : "s"} are already saved in AgentOS. Connect ${formatProviderLabel(providerId)} to use them.`
        : getModelProviderDescriptor(providerId).helperText
  };
}
