"use client";

import { useEffect, useEffectEvent, useState } from "react";
import {
  ChevronDown,
  CircleCheckBig,
  Copy,
  LoaderCircle,
  RefreshCw,
  SquareTerminal
} from "lucide-react";

import { ModelPicker } from "@/components/mission-control/add-models/model-picker";
import { ProviderCard } from "@/components/mission-control/add-models/provider-card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  otherModelProviders,
  primaryModelProviders,
  getModelProviderDescriptor,
  isAddModelsProviderId,
  normalizeAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import { getModelProviderAdapter } from "@/lib/openclaw/model-provider-adapters";
import type {
  AddModelsCatalogModel,
  AddModelsEmptyState,
  AddModelsFlowState,
  AddModelsProviderActionResult,
  AddModelsProviderConnectionStatus,
  AddModelsProviderId,
  MissionControlSnapshot
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";
import { toast } from "@/components/ui/sonner";

type ProviderDraft = {
  flowState: AddModelsFlowState;
  connection: AddModelsProviderConnectionStatus | null;
  statusMessage: string | null;
  errorMessage: string | null;
  emptyState: AddModelsEmptyState | null;
  manualCommand: string | null;
  docsUrl: string | null;
  models: AddModelsCatalogModel[];
  selectedModelIds: string[];
  apiKey: string;
  search: string;
  loaded: boolean;
};

const initialDraftState = (): ProviderDraft => ({
  flowState: "idle",
  connection: null,
  statusMessage: null,
  errorMessage: null,
  emptyState: null,
  manualCommand: null,
  docsUrl: null,
  models: [],
  selectedModelIds: [],
  apiKey: "",
  search: "",
  loaded: false
});

export function AddModelsDialog({
  open,
  onOpenChange,
  snapshot,
  initialProvider = null,
  onSnapshotChange
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  snapshot: MissionControlSnapshot;
  initialProvider?: AddModelsProviderId | null;
  onSnapshotChange: (snapshot: MissionControlSnapshot) => void;
}) {
  const normalizedInitialProvider = normalizeAddModelsProviderId(initialProvider);
  const [activeProvider, setActiveProvider] = useState<AddModelsProviderId | null>(normalizedInitialProvider);
  const [otherProvidersOpen, setOtherProvidersOpen] = useState(false);
  const [providerDrafts, setProviderDrafts] = useState<Partial<Record<AddModelsProviderId, ProviderDraft>>>({});
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);
  const handleInitialProviderOpen = useEffectEvent((providerId: AddModelsProviderId) => {
    void selectProvider(providerId);
  });

  useEffect(() => {
    if (!open) {
      return;
    }

    if (normalizedInitialProvider) {
      handleInitialProviderOpen(normalizedInitialProvider);
      return;
    }

    setActiveProvider((current) => (isAddModelsProviderId(current) ? current : null));
  }, [open, normalizedInitialProvider]);

  const activeProviderId = isAddModelsProviderId(activeProvider) ? activeProvider : null;
  const activeDraft = activeProviderId ? resolveDraft(providerDrafts[activeProviderId]) : initialDraftState();
  const activeDescriptor = activeProviderId ? getModelProviderDescriptor(activeProviderId) : null;

  async function selectProvider(providerId: AddModelsProviderId) {
    setActiveProvider(providerId);

    if (providerId !== "ollama") {
      const existingDraft = resolveDraft(providerDrafts[providerId]);

      if (!existingDraft.loaded) {
        await runStatus(providerId);
      }

      return;
    }

    await discoverProvider(providerId, true);
  }

  async function runStatus(providerId: AddModelsProviderId) {
    const adapter = getModelProviderAdapter(providerId);

    updateDraft(providerId, {
      flowState: "idle",
      errorMessage: null
    });

    try {
      const result = await adapter.getConnectionStatus();
      applyActionResult(providerId, result, result.emptyState ? "discovery-empty" : "idle");
    } catch (error) {
      updateDraft(providerId, {
        flowState: "auth-error",
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
          ? "Opening the ChatGPT connection flow..."
          : `Connecting ${getModelProviderDescriptor(providerId).shortLabel}...`
    });

    try {
      const result = await adapter.connect({
        apiKey: draft.apiKey
      });

      applyActionResult(
        providerId,
        result,
        providerId === "openai-codex" ? "connecting" : result.models.length ? "discovery-success" : "idle"
      );

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }

      if (providerId !== "openai-codex" && providerId !== "ollama") {
        await discoverProvider(providerId);
      }
    } catch (error) {
      updateDraft(providerId, {
        flowState: "auth-error",
        errorMessage: error instanceof Error ? error.message : "Provider connection failed."
      });
    }
  }

  async function discoverProvider(providerId: AddModelsProviderId, force = false) {
    const adapter = getModelProviderAdapter(providerId);
    const draft = resolveDraft(providerDrafts[providerId]);

    if (!force && draft.flowState === "discovery-loading") {
      return;
    }

    updateDraft(providerId, {
      flowState: "discovery-loading",
      errorMessage: null,
      statusMessage:
        providerId === "ollama"
          ? "Checking the local Ollama runtime..."
          : "Discovering available models..."
    });

    try {
      const result = await adapter.discoverModels();
      applyActionResult(
        providerId,
        result,
        result.models.length > 0
          ? "discovery-success"
          : result.emptyState
            ? "discovery-empty"
            : "idle"
      );

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }
    } catch (error) {
      updateDraft(providerId, {
        flowState: "auth-error",
        errorMessage: error instanceof Error ? error.message : "Model discovery failed."
      });
    }
  }

  async function addSelectedModels(providerId: AddModelsProviderId) {
    const adapter = getModelProviderAdapter(providerId);
    const draft = resolveDraft(providerDrafts[providerId]);
    const selectedModelIds = draft.selectedModelIds.filter(
      (modelId) => !draft.models.find((model) => model.id === modelId)?.alreadyAdded
    );

    if (selectedModelIds.length === 0) {
      return;
    }

    updateDraft(providerId, {
      flowState: "connecting",
      errorMessage: null,
      statusMessage: "Adding selected models..."
    });

    try {
      const result = await adapter.addModels(selectedModelIds);

      applyActionResult(providerId, result, "add-success", {
        selectedModelIds: []
      });

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }

      toast.success("Models added.", {
        description: result.message
      });
    } catch (error) {
      updateDraft(providerId, {
        flowState: "add-error",
        errorMessage: error instanceof Error ? error.message : "Models could not be added."
      });
    }
  }

  async function openTerminal(command: string) {
    try {
      setIsOpeningTerminal(true);

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

      if (!response.ok) {
        throw new Error(result?.error || "Terminal could not be opened.");
      }

      toast.success("Terminal opened.", {
        description: "Finish the provider login there, then return here to discover models."
      });
    } catch (error) {
      toast.error("Unable to open Terminal.", {
        description: error instanceof Error ? error.message : "Unknown terminal error."
      });
    } finally {
      setIsOpeningTerminal(false);
    }
  }

  async function copyText(value: string) {
    try {
      await navigator.clipboard.writeText(value);
      toast.success("Copied.", {
        description: "Command copied to your clipboard."
      });
    } catch {
      toast.error("Copy failed.", {
        description: "Clipboard access is not available."
      });
    }
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
    flowState: AddModelsFlowState,
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

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[84dvh] max-h-[84dvh] w-[calc(100vw-20px)] max-w-[840px] flex-col gap-0 overflow-hidden p-0 sm:h-[min(84dvh,760px)] sm:max-h-[min(84dvh,760px)] sm:w-[min(840px,calc(100vw-40px))]">
        <DialogHeader className="shrink-0 border-b border-white/10 bg-[linear-gradient(180deg,rgba(12,18,31,0.96),rgba(9,13,24,0.98))] px-5 py-4 pr-12">
          <DialogTitle className="text-[1.2rem]">Add Models</DialogTitle>
          <DialogDescription className="max-w-[520px] text-[12px] leading-[1.05rem] text-slate-400">
            Connect a provider, discover available models, and add them in seconds.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-5 px-4 py-4 sm:px-5 sm:py-5">
            <div className="grid gap-3 lg:grid-cols-3">
              {primaryModelProviders.map((provider) => (
                <ProviderCard
                  key={provider.id}
                  descriptor={provider}
                  active={activeProviderId === provider.id}
                  compact
                  connected={resolveConnectionDetail(snapshot, providerDrafts, provider.id).connected}
                  detail={resolveConnectionDetail(snapshot, providerDrafts, provider.id).detail}
                  onClick={() => {
                    void selectProvider(provider.id);
                  }}
                />
              ))}
            </div>

            <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,20,34,0.94),rgba(9,13,24,0.96))]">
              <button
                type="button"
                onClick={() => setOtherProvidersOpen((current) => !current)}
                className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left"
              >
                <div>
                  <p className="font-display text-[0.9rem] text-white">Other providers</p>
                  <p className="mt-1 text-[10px] leading-[1.05rem] text-slate-400">
                    Simpler API-key setup for additional provider routes.
                  </p>
                </div>
                <ChevronDown
                  className={cn(
                    "h-3.5 w-3.5 text-slate-400 transition-transform",
                    otherProvidersOpen ? "rotate-180" : "rotate-0"
                  )}
                />
              </button>

              {otherProvidersOpen ? (
                <div className="grid gap-2.5 border-t border-white/10 px-3.5 py-3.5 md:grid-cols-2 xl:grid-cols-3">
                  {otherModelProviders.map((provider) => (
                    <ProviderCard
                      key={provider.id}
                      descriptor={provider}
                      active={activeProviderId === provider.id}
                      compact
                      connected={resolveConnectionDetail(snapshot, providerDrafts, provider.id).connected}
                      detail={resolveConnectionDetail(snapshot, providerDrafts, provider.id).detail}
                      onClick={() => {
                        void selectProvider(provider.id);
                      }}
                    />
                  ))}
                </div>
              ) : null}
            </div>

            <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))] p-4">
              {activeProviderId && activeDescriptor ? (
                <>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-[0.95rem] text-white">{activeDescriptor.label}</p>
                      <p className="mt-1 max-w-[580px] text-[11px] leading-[1.05rem] text-slate-400">
                        {activeDescriptor.connectKind === "oauth"
                          ? "Use your account login, then discover the models that are ready to add."
                          : activeDescriptor.connectKind === "local"
                            ? "Check the local runtime first, then add the models already available on this machine."
                            : "Connect the provider, review the discovered catalog, and add only the models you want."}
                      </p>
                    </div>
                    <Badge
                      variant={activeDraft.connection?.connected ? "success" : "muted"}
                      className="px-2 py-0.5 text-[10px] tracking-[0.12em]"
                    >
                      {activeDraft.connection?.connected ? "Connected" : "Not connected"}
                    </Badge>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-1.5">
                    {buildProgressSteps(activeProviderId, activeDraft).map((step) => (
                      <div
                        key={step.label}
                        className={cn(
                          "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px] uppercase tracking-[0.16em]",
                          step.status === "done"
                            ? "border-emerald-300/20 bg-emerald-300/10 text-emerald-100"
                            : step.status === "active"
                              ? "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
                              : "border-white/10 bg-white/[0.03] text-slate-500"
                        )}
                      >
                        <span
                          className={cn(
                            "h-1.5 w-1.5 rounded-full",
                            step.status === "done"
                              ? "bg-emerald-300"
                              : step.status === "active"
                                ? "bg-cyan-300"
                                : "bg-slate-600"
                          )}
                        />
                        {step.label}
                      </div>
                    ))}
                  </div>

                  {activeDraft.statusMessage ? (
                    <div className="mt-4 rounded-[18px] border border-white/10 bg-white/[0.04] px-3.5 py-2.5">
                      <p className="text-[12px] text-slate-200">{activeDraft.statusMessage}</p>
                    </div>
                  ) : null}

                  {activeDraft.errorMessage ? (
                    <div className="mt-4 rounded-[18px] border border-rose-400/20 bg-rose-400/[0.08] px-3.5 py-2.5 text-[12px] text-rose-100">
                      {activeDraft.errorMessage}
                    </div>
                  ) : null}

                  {activeProviderId === "openai-codex" ? (
                    <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-[0.95rem] text-white">Connect your ChatGPT account</p>
                          <p className="mt-1 max-w-[540px] text-[11px] leading-[1.05rem] text-slate-400">
                            This uses OpenClaw&apos;s account-based login flow. No API key is required.
                          </p>
                        </div>
                        <Button
                          type="button"
                          className="h-9 rounded-full px-4 text-[11px]"
                          disabled={activeDraft.flowState === "connecting" && !activeDraft.manualCommand}
                          onClick={() => {
                            void connectProvider(activeProviderId);
                          }}
                        >
                          {activeDraft.flowState === "connecting" && !activeDraft.manualCommand ? (
                            <>
                              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            "Connect ChatGPT"
                          )}
                        </Button>
                      </div>

                      {activeDraft.manualCommand ? (
                        <div className="mt-4 rounded-[18px] border border-cyan-300/15 bg-cyan-300/[0.07] p-3.5">
                          <div className="flex flex-wrap items-start justify-between gap-3">
                            <div>
                              <p className="text-[12px] font-medium text-cyan-50">Finish sign-in in Terminal</p>
                              <p className="mt-1 max-w-[520px] text-[11px] leading-[1.05rem] text-cyan-100/80">
                                Open Terminal, complete the provider login, then return here and check discovery.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <Button
                                type="button"
                                variant="secondary"
                                size="sm"
                                className="h-8 rounded-full px-3 text-[11px]"
                                disabled={isOpeningTerminal}
                                onClick={() => {
                                  void openTerminal(activeDraft.manualCommand || "");
                                }}
                              >
                                {isOpeningTerminal ? (
                                  <>
                                    <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                                    Opening...
                                  </>
                                ) : (
                                  <>
                                    <SquareTerminal className="mr-1.5 h-3.5 w-3.5" />
                                    Open Terminal
                                  </>
                                )}
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-full px-3 text-[11px]"
                                onClick={() => {
                                  void copyText(activeDraft.manualCommand || "");
                                }}
                              >
                                <Copy className="mr-1.5 h-3.5 w-3.5" />
                                Copy command
                              </Button>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-full px-3 text-[11px]"
                                onClick={() => {
                                  void discoverProvider(activeProviderId);
                                }}
                              >
                                <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                                I&apos;ve connected it
                              </Button>
                            </div>
                          </div>
                          <div className="mt-3.5 overflow-x-auto rounded-[16px] border border-white/10 bg-slate-950/60 px-3.5 py-2.5">
                            <code className="text-[11px] text-slate-200">{activeDraft.manualCommand}</code>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  {activeDescriptor.connectKind === "apiKey" ? (
                    <div className="mt-5 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
                      <div className="flex flex-wrap items-end gap-3">
                        <div className="min-w-0 flex-1">
                          <label className="block text-[10px] uppercase tracking-[0.16em] text-slate-500">
                            API key
                          </label>
                          <Input
                            type="password"
                            value={activeDraft.apiKey}
                            onChange={(event) => updateDraft(activeProviderId, { apiKey: event.target.value })}
                            placeholder={activeProviderId === "openrouter" ? "sk-or-v1-..." : "Paste API key"}
                            className="mt-2 h-9 text-[12px]"
                          />
                        </div>
                        <Button
                          type="button"
                          className="h-9 rounded-full px-4 text-[11px]"
                          disabled={activeDraft.flowState === "connecting" || !activeDraft.apiKey.trim()}
                          onClick={() => {
                            void connectProvider(activeProviderId);
                          }}
                        >
                          {activeDraft.flowState === "connecting" ? (
                            <>
                              <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                              Connecting...
                            </>
                          ) : (
                            `Connect ${activeDescriptor.shortLabel}`
                          )}
                        </Button>
                      </div>
                    </div>
                  ) : null}

                  {activeDescriptor.connectKind !== "oauth" ? (
                    <div className="mt-3.5 flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        className="h-8 rounded-full px-3.5 text-[11px]"
                        disabled={activeDraft.flowState === "discovery-loading"}
                        onClick={() => {
                          void discoverProvider(activeProviderId);
                        }}
                      >
                        {activeDraft.flowState === "discovery-loading" ? (
                          <>
                            <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                            Discovering...
                          </>
                        ) : (
                          "Discover models"
                        )}
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        className="h-8 rounded-full px-3.5 text-[11px]"
                        onClick={() => {
                          void runStatus(activeProviderId);
                        }}
                      >
                        Refresh status
                      </Button>
                    </div>
                  ) : null}

                  {activeDraft.emptyState ? (
                    <EmptyStateCard
                      emptyState={activeDraft.emptyState}
                      onCopyCommand={(command) => {
                        void copyText(command);
                      }}
                    />
                  ) : null}

                  {activeDraft.models.length > 0 ? (
                    <div className="mt-6">
                      <ModelPicker
                        provider={activeProviderId}
                        models={activeDraft.models}
                        selectedModelIds={activeDraft.selectedModelIds}
                        search={activeDraft.search}
                        onSearchChange={(value) => updateDraft(activeProviderId, { search: value })}
                        onToggleModel={(modelId) => {
                          const selected = activeDraft.selectedModelIds.includes(modelId);
                          updateDraft(activeProviderId, {
                            selectedModelIds: selected
                              ? activeDraft.selectedModelIds.filter((entry) => entry !== modelId)
                              : [...activeDraft.selectedModelIds, modelId]
                          });
                        }}
                        onAddSelected={() => {
                          void addSelectedModels(activeProviderId);
                        }}
                        isAdding={activeDraft.flowState === "connecting" && activeDraft.statusMessage === "Adding selected models..."}
                      />
                    </div>
                  ) : null}

                  {activeDraft.flowState === "add-success" ? (
                    <div className="mt-4 flex items-center gap-3 rounded-[18px] border border-emerald-300/20 bg-emerald-300/[0.08] px-3.5 py-2.5">
                      <CircleCheckBig className="h-4 w-4 text-emerald-200" />
                      <p className="text-[12px] text-emerald-50">
                        {activeDraft.statusMessage || "Models were added successfully."}
                      </p>
                    </div>
                  ) : null}

                  {activeDraft.docsUrl ? (
                    <a
                      href={activeDraft.docsUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="mt-4 inline-flex text-[11px] text-slate-300 underline underline-offset-4"
                    >
                      OpenClaw model docs
                    </a>
                  ) : null}
                </>
              ) : (
                <div className="flex min-h-[210px] items-center justify-center rounded-[22px] border border-dashed border-white/10 bg-white/[0.02] px-5 py-7 text-center">
                  <div>
                    <p className="font-display text-[0.95rem] text-white">Choose a provider to begin</p>
                    <p className="mt-2 max-w-[400px] text-[12px] leading-[1.05rem] text-slate-400">
                      Start with ChatGPT, OpenRouter, Gemini, DeepSeek, Mistral, or Ollama Local. The flow will
                      guide you through connect, discovery, selection, and add.
                    </p>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function EmptyStateCard({
  emptyState,
  onCopyCommand
}: {
  emptyState: AddModelsEmptyState;
  onCopyCommand: (command: string) => void;
}) {
  return (
    <div className="mt-4 rounded-[24px] border border-white/10 bg-white/[0.03] p-4">
      <p className="font-display text-[0.95rem] text-white">{emptyState.title}</p>
      <p className="mt-1 max-w-[580px] text-[12px] leading-[1.05rem] text-slate-400">{emptyState.description}</p>

      {emptyState.commands?.length ? (
        <div className="mt-4 space-y-2">
          {emptyState.commands.map((command) => (
            <div
              key={command}
              className="flex flex-wrap items-center justify-between gap-2.5 rounded-[16px] border border-white/10 bg-slate-950/60 px-3.5 py-2.5"
            >
              <code className="text-[11px] text-slate-200">{command}</code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-8 rounded-full px-3 text-[11px]"
                onClick={() => onCopyCommand(command)}
              >
                <Copy className="mr-1.5 h-3.5 w-3.5" />
                Copy
              </Button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function resolveDraft(draft?: ProviderDraft): ProviderDraft {
  return draft ? draft : initialDraftState();
}

function resolveConnectionDetail(
  snapshot: MissionControlSnapshot,
  drafts: Partial<Record<AddModelsProviderId, ProviderDraft>>,
  providerId: AddModelsProviderId
) {
  const cachedConnection = drafts[providerId]?.connection;

  if (cachedConnection) {
    return cachedConnection;
  }

  const readinessProvider = snapshot.diagnostics.modelReadiness.authProviders.find(
    (provider) => provider.provider === providerId
  );
  const localModelCount = snapshot.models.filter((model) => model.id.startsWith(`${providerId}/`)).length;

  if (providerId === "ollama") {
    return {
      provider: providerId,
      connected: localModelCount > 0,
      canConnect: true,
      needsTerminal: false,
      detail:
        localModelCount > 0
          ? `${localModelCount} model${localModelCount === 1 ? "" : "s"} already visible in AgentOS.`
          : "Detect local models from this machine."
    };
  }

  return {
    provider: providerId,
    connected: Boolean(readinessProvider?.connected || localModelCount > 0),
    canConnect: true,
    needsTerminal: providerId === "openai-codex",
    detail: readinessProvider?.detail || getModelProviderDescriptor(providerId).helperText
  };
}

function buildProgressSteps(providerId: AddModelsProviderId, draft: ProviderDraft) {
  const connectDone =
    providerId === "ollama"
      ? Boolean(draft.connection?.connected || draft.emptyState)
      : Boolean(draft.connection?.connected || draft.manualCommand);
  const discoverDone = draft.models.length > 0 || Boolean(draft.emptyState);
  const selectDone = draft.selectedModelIds.length > 0;
  const addDone = draft.flowState === "add-success";

  return [
    { label: "Choose provider", status: "done" },
    {
      label: providerId === "ollama" ? "Local check" : "Connect",
      status: draft.flowState === "connecting" && !connectDone ? "active" : connectDone ? "done" : "pending"
    },
    {
      label: "Discover",
      status: draft.flowState === "discovery-loading" ? "active" : discoverDone ? "done" : "pending"
    },
    {
      label: "Select",
      status: addDone ? "done" : selectDone ? "active" : "pending"
    },
    {
      label: "Add",
      status: addDone ? "done" : draft.flowState === "add-error" ? "active" : "pending"
    }
  ] as const;
}
