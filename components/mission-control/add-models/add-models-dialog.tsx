"use client";

import { useEffect, useEffectEvent, useMemo, useState } from "react";
import { CircleCheckBig, Copy, LoaderCircle, RefreshCw, SquareTerminal } from "lucide-react";

import { GlobalModelPicker } from "@/components/mission-control/add-models/global-model-picker";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  modelProviderRegistry,
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

type GlobalCatalogModel = Omit<AddModelsCatalogModel, "alreadyAdded">;

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

const CATALOG_PAGE_SIZE = 5;

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
  const [activeTab, setActiveTab] = useState<"catalog" | "providers">("providers");
  const [activeProvider, setActiveProvider] = useState<AddModelsProviderId | null>(normalizedInitialProvider);
  const [providerDrafts, setProviderDrafts] = useState<Partial<Record<AddModelsProviderId, ProviderDraft>>>({});
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);
  const [isAddingCatalogModels, setIsAddingCatalogModels] = useState(false);
  const [catalogSearch, setCatalogSearch] = useState("");
  const [catalogVisibleCount, setCatalogVisibleCount] = useState(CATALOG_PAGE_SIZE);
  const [globalCatalogModels, setGlobalCatalogModels] = useState<GlobalCatalogModel[]>([]);
  const [isLoadingGlobalCatalog, setIsLoadingGlobalCatalog] = useState(false);
  const [globalCatalogError, setGlobalCatalogError] = useState<string | null>(null);
  const handleInitialProviderOpen = useEffectEvent((providerId: AddModelsProviderId) => {
    setActiveTab("providers");
    void selectProvider(providerId);
  });
  const loadGlobalCatalog = useEffectEvent(async () => {
    setIsLoadingGlobalCatalog(true);
    setGlobalCatalogError(null);

    try {
      const response = await fetch("/api/models/catalog");
      const payload = (await response.json().catch(() => null)) as
        | {
            models?: GlobalCatalogModel[];
            error?: string;
          }
        | null;

      if (!response.ok || !payload) {
        throw new Error(payload?.error || "OpenClaw catalog could not be loaded.");
      }

      setGlobalCatalogModels(Array.isArray(payload.models) ? payload.models : []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "OpenClaw catalog could not be loaded.";
      setGlobalCatalogModels([]);
      setGlobalCatalogError(message);
      toast.error("OpenClaw catalog could not be loaded.", {
        description: message
      });
    } finally {
      setIsLoadingGlobalCatalog(false);
    }
  });
  const primeProviders = useEffectEvent(async (skipProviderId?: AddModelsProviderId | null) => {
    const providerIds = [...primaryModelProviders, ...otherModelProviders]
      .map((provider) => provider.id)
      .filter((providerId) => providerId !== skipProviderId);

    for (const providerId of providerIds) {
      const result = await runStatus(providerId);

      if (result?.connection.connected) {
        await discoverProvider(providerId, true);
      }
    }
  });

  useEffect(() => {
    if (!open) {
      setActiveTab("providers");
      setActiveProvider(null);
      setCatalogSearch("");
      setCatalogVisibleCount(CATALOG_PAGE_SIZE);
      setGlobalCatalogModels([]);
      setGlobalCatalogError(null);
      setIsLoadingGlobalCatalog(false);
      setProviderDrafts((current) =>
        Object.fromEntries(
          Object.entries(current).map(([providerId, draft]) => [
            providerId,
            {
              ...draft,
              flowState: "idle",
              statusMessage: null,
              errorMessage: null,
              selectedModelIds: [],
              apiKey: "",
              search: ""
            }
          ])
        ) as Partial<Record<AddModelsProviderId, ProviderDraft>>
      );
      setIsOpeningTerminal(false);
      setIsAddingCatalogModels(false);
      return;
    }

    if (normalizedInitialProvider) {
      handleInitialProviderOpen(normalizedInitialProvider);
    } else {
      setActiveTab("providers");
    }

    void primeProviders(normalizedInitialProvider);
    void loadGlobalCatalog();
  }, [open, normalizedInitialProvider]);

  const activeProviderId = isAddModelsProviderId(activeProvider) ? activeProvider : null;
  const activeDraft = activeProviderId ? resolveDraft(providerDrafts[activeProviderId]) : initialDraftState();
  const activeDescriptor = activeProviderId ? getModelProviderDescriptor(activeProviderId) : null;
  const catalogModels = useMemo(() => {
    const configuredModelIds = new Set(snapshot.models.map((model) => model.id));

    return globalCatalogModels
      .map((model) => ({
        ...model,
        alreadyAdded: configuredModelIds.has(model.id)
      }))
      .sort((left, right) => {
        const leftAlreadyAdded = left.alreadyAdded;
        const rightAlreadyAdded = right.alreadyAdded;

        if (leftAlreadyAdded !== rightAlreadyAdded) {
          return leftAlreadyAdded ? 1 : -1;
        }

        const providerDelta = left.provider.localeCompare(right.provider);
        if (providerDelta !== 0) {
          return providerDelta;
        }

        const leftUnavailable = !isSelectableModel(left);
        const rightUnavailable = !isSelectableModel(right);

        if (leftUnavailable !== rightUnavailable) {
          return leftUnavailable ? 1 : -1;
        }

        const leftPriority = Number(left.recommended) + Number(left.local);
        const rightPriority = Number(right.recommended) + Number(right.local);
        if (leftPriority !== rightPriority) {
          return rightPriority - leftPriority;
        }

        const nameDelta = left.name.localeCompare(right.name);
        if (nameDelta !== 0) {
          return nameDelta;
        }

        return left.id.localeCompare(right.id);
      });
  }, [globalCatalogModels, snapshot.models]);
  const catalogSelectedModelIds = useMemo(
    () => Object.values(providerDrafts).flatMap((draft) => draft?.selectedModelIds ?? []),
    [providerDrafts]
  );
  const catalogModelById = useMemo(
    () => new Map(catalogModels.map((model) => [model.id, model] as const)),
    [catalogModels]
  );
  const catalogProviderCount = useMemo(() => new Set(catalogModels.map((model) => model.provider)).size, [catalogModels]);
  const catalogAddedCount = useMemo(
    () => catalogModels.filter((model) => model.alreadyAdded).length,
    [catalogModels]
  );
  const catalogSelectedModelGroups = useMemo(() => {
    const selectedModelIds = new Set(catalogSelectedModelIds);
    const groups = new Map<AddModelsProviderId, string[]>();

    for (const model of catalogModels) {
      const providerId = model.provider;

      if (!selectedModelIds.has(model.id) || model.alreadyAdded || !isSelectableModel(model)) {
        continue;
      }

      if (!isAddModelsProviderId(providerId)) {
        continue;
      }

      const current = groups.get(providerId) ?? [];
      current.push(model.id);
      groups.set(providerId, current);
    }

    return groups;
  }, [catalogModels, catalogSelectedModelIds]);
  async function selectProvider(providerId: AddModelsProviderId) {
    setActiveProvider(providerId);
    setActiveTab("providers");

    const status = await runStatus(providerId);

    if (status?.connection.connected) {
      await discoverProvider(providerId, true);
    }
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
      return result;
    } catch (error) {
      updateDraft(providerId, {
        flowState: "auth-error",
        errorMessage: error instanceof Error ? error.message : "Provider status could not be loaded.",
        loaded: true
      });

      return null;
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

      return result;
    } catch (error) {
      updateDraft(providerId, {
        flowState: "auth-error",
        errorMessage: error instanceof Error ? error.message : "Model discovery failed."
      });

      return null;
    }
  }

  async function addSelectedModels(
    providerId: AddModelsProviderId,
    options?: {
      silent?: boolean;
      selectedModelIds?: string[];
    }
  ) {
    const adapter = getModelProviderAdapter(providerId);
    const draft = resolveDraft(providerDrafts[providerId]);
    const sourceSelectedModelIds = options?.selectedModelIds ?? draft.selectedModelIds;
    const selectedModelIds = sourceSelectedModelIds.filter((modelId) => {
      const model = catalogModelById.get(modelId) ?? draft.models.find((entry) => entry.id === modelId);
      if (!model) {
        return false;
      }

      return isSelectableModel(model) && !model.alreadyAdded;
    });

    if (selectedModelIds.length === 0) {
      return false;
    }

    updateDraft(providerId, {
      flowState: "connecting",
      errorMessage: null,
      statusMessage: "Adding selected models..."
    });

    try {
      const result = await adapter.addModels(selectedModelIds);

      applyActionResult(providerId, result, "add-success", {
        selectedModelIds: options?.selectedModelIds
          ? draft.selectedModelIds.filter((modelId) => !selectedModelIds.includes(modelId))
          : []
      });

      if (result.snapshot) {
        onSnapshotChange(result.snapshot);
      }

      if (!options?.silent) {
        toast.success("Models added.", {
          description: result.message
        });
      }

      return true;
    } catch (error) {
      updateDraft(providerId, {
        flowState: "add-error",
        errorMessage: error instanceof Error ? error.message : "Models could not be added."
      });

      return false;
    }
  }

  async function addSelectedCatalogModels() {
    const selectedProviderIds = [...catalogSelectedModelGroups.keys()];

    if (selectedProviderIds.length === 0) {
      return;
    }

    setIsAddingCatalogModels(true);

    try {
      let successCount = 0;

      for (const [providerId, modelIds] of catalogSelectedModelGroups.entries()) {
        const didAddModels = await addSelectedModels(providerId, {
          silent: true,
          selectedModelIds: modelIds
        });

        if (didAddModels) {
          successCount += modelIds.length;
        }
      }

      if (successCount > 0) {
        toast.success("Models added.", {
          description:
            `Added ${successCount} model${successCount === 1 ? "" : "s"} from ${selectedProviderIds.length} provider${selectedProviderIds.length === 1 ? "" : "s"}.`
        });
      } else {
        toast.error("Models could not be added.", {
          description: "Select a different catalog entry or open the Providers tab and try again."
        });
      }
    } finally {
      setIsAddingCatalogModels(false);
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
      <DialogContent className="flex h-[80dvh] max-h-[80dvh] w-[calc(100vw-16px)] max-w-[760px] flex-col gap-0 overflow-hidden p-0 sm:h-[min(80dvh,700px)] sm:max-h-[min(80dvh,700px)] sm:w-[min(760px,calc(100vw-40px))]">
        <DialogHeader className="shrink-0 border-b border-white/10 bg-[linear-gradient(180deg,rgba(12,18,31,0.96),rgba(9,13,24,0.98))] px-4 py-3.5 pr-10">
          <DialogTitle className="text-[1.05rem]">Add Models</DialogTitle>
          <DialogDescription className="max-w-[560px] text-[11px] leading-[1rem] text-slate-400">
            Connect or refresh providers first, then browse the catalog when you want to add models in bulk.
          </DialogDescription>
        </DialogHeader>

        <Tabs
          value={activeTab}
          onValueChange={(value) => setActiveTab(value as "catalog" | "providers")}
          className="min-h-0 flex flex-1 flex-col"
        >
          <div className="shrink-0 border-b border-white/10 px-4 py-3">
            <TabsList className="h-8 rounded-[16px] p-0.5">
              <TabsTrigger value="providers" className="rounded-[13px] px-2.5 py-1 text-[10px]">
                Providers
              </TabsTrigger>
              <TabsTrigger value="catalog" className="rounded-[13px] px-2.5 py-1 text-[10px]">
                Catalog
              </TabsTrigger>
            </TabsList>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            <TabsContent value="providers" className="!mt-0 m-0 h-full">
              <div className="space-y-4 px-3 py-3 sm:px-4 sm:py-4">
                <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,20,34,0.94),rgba(9,13,24,0.96))] p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-[0.84rem] text-white">All providers</p>
                      <p className="mt-1 text-[9px] leading-[0.95rem] text-slate-400">
                        Connect or refresh a provider, then return to the catalog when you want to add models in one pass.
                      </p>
                    </div>
                    <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                      {modelProviderRegistry.length} total
                    </Badge>
                  </div>

                  <div className="relative mt-2.5">
                    <div className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-[rgba(13,20,34,0.96)] to-transparent" />
                    <div className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-[rgba(13,20,34,0.96)] to-transparent" />
                    <div className="-mx-1 overflow-x-auto overscroll-x-contain pb-1">
                      <div className="flex min-w-max gap-2.5 px-1">
                        {modelProviderRegistry.map((provider) => (
                          <div key={provider.id} className="w-[236px] shrink-0 snap-start sm:w-[244px]">
                            <ProviderCard
                              descriptor={provider}
                              active={activeProviderId === provider.id}
                              compact
                              connected={resolveConnectionDetail(snapshot, providerDrafts, provider.id).connected}
                              detail={resolveConnectionDetail(snapshot, providerDrafts, provider.id).detail}
                              onClick={() => {
                                void selectProvider(provider.id);
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    </div>
                    <div className="pointer-events-none absolute bottom-1.5 right-3 z-10 rounded-full border border-white/10 bg-slate-950/70 px-2 py-0.5 text-[8px] uppercase tracking-[0.14em] text-slate-400">
                      Scroll -&gt;
                    </div>
                  </div>
                </div>

                <div className="rounded-[22px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))] p-3">
                  {activeProviderId && activeDescriptor ? (
                    <>
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-display text-[0.88rem] text-white">{activeDescriptor.label}</p>
                          <p className="mt-1 max-w-[520px] text-[10px] leading-[0.98rem] text-slate-400">
                            {activeDescriptor.connectKind === "oauth"
                              ? "Use your account login, then discover the models that are ready to add."
                              : activeDescriptor.connectKind === "local"
                                ? "Check the local runtime first, then add the models already available on this machine."
                                : "Connect the provider, review the discovered catalog, and add only the models you want."}
                          </p>
                        </div>
                        <Badge
                          variant={activeDraft.connection?.connected ? "success" : "muted"}
                          className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]"
                        >
                          {activeDraft.connection?.connected ? "Connected" : "Not connected"}
                        </Badge>
                      </div>

                      <div className="mt-3 flex flex-wrap gap-1">
                        {buildProgressSteps(activeProviderId, activeDraft).map((step) => (
                          <div
                            key={step.label}
                            className={cn(
                              "inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.14em]",
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
                        <div className="mt-3 rounded-[16px] border border-white/10 bg-white/[0.04] px-3 py-2">
                          <p className="text-[11px] text-slate-200">{activeDraft.statusMessage}</p>
                        </div>
                      ) : null}

                      {activeDraft.errorMessage ? (
                        <div className="mt-3 rounded-[16px] border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-[11px] text-rose-100">
                          {activeDraft.errorMessage}
                        </div>
                      ) : null}

                      {activeProviderId === "openai-codex" ? (
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
                                  <p className="mt-1 max-w-[480px] text-[10px] leading-[0.98rem] text-cyan-100/80">
                                    Open Terminal, complete the provider login, then return here and check discovery.
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
                                      void discoverProvider(activeProviderId);
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

                      {activeDescriptor.connectKind === "apiKey" ? (
                        <div className="mt-4 rounded-[20px] border border-white/10 bg-white/[0.03] p-3">
                          <div className="flex flex-wrap items-end gap-3">
                            <div className="min-w-0 flex-1">
                              <label className="block text-[9px] uppercase tracking-[0.16em] text-slate-500">
                                API key
                              </label>
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
                        </div>
                      ) : null}

                      {activeDescriptor.connectKind !== "oauth" ? (
                        <div className="mt-3 flex flex-wrap gap-1.5">
                          <Button
                            type="button"
                            variant="secondary"
                            size="sm"
                            className="h-8 rounded-full px-3 text-[10px]"
                            disabled={activeDraft.flowState === "discovery-loading"}
                            onClick={() => {
                              void discoverProvider(activeProviderId);
                            }}
                          >
                            {activeDraft.flowState === "discovery-loading" ? (
                              <>
                                <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
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
                            className="h-8 rounded-full px-3 text-[10px]"
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
                        <div className="mt-5">
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
                            isAdding={
                              activeDraft.flowState === "connecting" &&
                              activeDraft.statusMessage === "Adding selected models..."
                            }
                          />
                        </div>
                      ) : null}

                      {activeDraft.flowState === "add-success" ? (
                        <div className="mt-3 flex items-center gap-2.5 rounded-[16px] border border-emerald-300/20 bg-emerald-300/[0.08] px-3 py-2">
                          <CircleCheckBig className="h-3.5 w-3.5 text-emerald-200" />
                          <p className="text-[11px] text-emerald-50">
                            {activeDraft.statusMessage || "Models were added successfully."}
                          </p>
                        </div>
                      ) : null}

                      {activeDraft.docsUrl ? (
                        <a
                          href={activeDraft.docsUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="mt-3 inline-flex text-[10px] text-slate-300 underline underline-offset-4"
                        >
                          OpenClaw model docs
                        </a>
                      ) : null}
                    </>
                  ) : (
                    <div className="flex min-h-[180px] items-center justify-center rounded-[20px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center">
                      <div>
                        <p className="font-display text-[0.88rem] text-white">Choose a provider to begin</p>
                        <p className="mt-1.5 max-w-[360px] text-[11px] leading-[0.98rem] text-slate-400">
                          Start with ChatGPT, OpenRouter, Gemini, DeepSeek, Mistral, or Ollama Local. The flow will
                          guide you through connect, discovery, selection, and add.
                        </p>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="catalog" className="!mt-0 m-0 h-full">
              <div className="space-y-4 px-3 py-3 sm:px-4 sm:py-4">
                <div className="rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))] p-3">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div>
                      <p className="font-display text-[0.84rem] text-white">OpenClaw catalog</p>
                      <p className="mt-1 text-[9px] leading-[0.95rem] text-slate-400">
                        Search the full OpenClaw model catalog, then load five more whenever you want to extend the list.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-1.5">
                      <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                        {catalogModels.length} models
                      </Badge>
                      <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                        {catalogProviderCount} providers
                      </Badge>
                      <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                        {catalogAddedCount} added
                      </Badge>
                    </div>
                  </div>
                </div>

                {globalCatalogError ? (
                  <div className="rounded-[18px] border border-rose-400/20 bg-rose-400/[0.08] px-4 py-3 text-[11px] text-rose-100">
                    {globalCatalogError}
                  </div>
                ) : null}

                <GlobalModelPicker
                  models={catalogModels}
                  selectedModelIds={catalogSelectedModelIds}
                  search={catalogSearch}
                  onSearchChange={setCatalogSearch}
                  onToggleModel={(providerId, modelId) => {
                    const currentDraft = resolveDraft(providerDrafts[providerId]);
                    updateDraft(providerId, {
                      selectedModelIds: currentDraft.selectedModelIds.includes(modelId)
                        ? currentDraft.selectedModelIds.filter((entry) => entry !== modelId)
                        : [...currentDraft.selectedModelIds, modelId]
                    });
                  }}
                  onAddSelected={() => {
                    void addSelectedCatalogModels();
                  }}
                  onOpenProviders={(providerId) => {
                    setActiveTab("providers");

                    if (providerId) {
                      void selectProvider(providerId);
                    }
                  }}
                  onLoadMore={() => setCatalogVisibleCount((current) => current + CATALOG_PAGE_SIZE)}
                  visibleModelCount={catalogVisibleCount}
                  isAdding={isAddingCatalogModels}
                  isLoading={isLoadingGlobalCatalog && catalogModels.length === 0}
                />

                {!isLoadingGlobalCatalog && catalogModels.length === 0 && !globalCatalogError ? (
                  <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.02] px-4 py-5 text-center text-[11px] text-slate-400">
                    OpenClaw did not return any supported models yet. Check your installation or refresh providers.
                  </div>
                ) : null}
              </div>
            </TabsContent>
          </div>
        </Tabs>
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
    <div className="mt-3 rounded-[20px] border border-white/10 bg-white/[0.03] p-3">
      <p className="font-display text-[0.88rem] text-white">{emptyState.title}</p>
      <p className="mt-1 max-w-[520px] text-[11px] leading-[0.98rem] text-slate-400">{emptyState.description}</p>

      {emptyState.commands?.length ? (
        <div className="mt-3 space-y-1.5">
          {emptyState.commands.map((command) => (
            <div
              key={command}
              className="flex flex-wrap items-center justify-between gap-2 rounded-[14px] border border-white/10 bg-slate-950/60 px-3 py-2"
            >
              <code className="text-[10px] text-slate-200">{command}</code>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                className="h-7 rounded-full px-2.5 text-[10px]"
                onClick={() => onCopyCommand(command)}
              >
                <Copy className="mr-1.5 h-3 w-3" />
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

function isSelectableModel(model: AddModelsCatalogModel) {
  return !model.missing && model.available !== false;
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
