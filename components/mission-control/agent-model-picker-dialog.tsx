"use client";

import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";

import {
  Bot,
  Boxes,
  Check,
  ChevronRight,
  Cpu,
  Database,
  Grid2X2,
  Info,
  Library,
  LoaderCircle,
  Plus,
  Search,
  SlidersHorizontal,
  Sparkles,
  Trash2
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { PikoLoader } from "@/components/ui/piko-loader";
import { toast } from "@/components/ui/sonner";
import {
  formatModelProviderLabel,
  getModelProviderDescriptor,
  isAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import {
  modelRecordIdentityKey,
  normalizeOpenAiModelId
} from "@/lib/openclaw/domains/model-provider-connection";
import { isSelectableModel } from "@/lib/openclaw/domains/model-management";
import { formatAgentDisplayName, formatContextWindow, formatModelLabel } from "@/lib/openclaw/presenters";
import type {
  AddModelsCatalogModel,
  AddModelsProviderActionResult,
  AddModelsProviderId,
  MissionControlSnapshot
} from "@/lib/agentos/contracts";
import { useModelCatalog } from "@/hooks/use-model-catalog";
import { cn } from "@/lib/utils";

type AgentModelRecord = MissionControlSnapshot["models"][number];

export function AgentModelPickerDialog({
  open,
  agentId,
  snapshot,
  onOpenChange,
  onSnapshotChange,
  onRefresh,
  onOpenAddModels,
  surfaceTheme = "dark"
}: {
  open: boolean;
  agentId: string | null;
  snapshot: MissionControlSnapshot;
  onOpenChange: (open: boolean) => void;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void>;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";
  const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) ?? null : null;
  const currentModelId = agent?.modelId && agent.modelId !== "unassigned" ? normalizeOpenAiModelId(agent.modelId) : "";
  const [selectedModelId, setSelectedModelId] = useState(currentModelId);
  const [search, setSearch] = useState("");
  const [providerFilter, setProviderFilter] = useState("all");
  const [typeFilter, setTypeFilter] = useState("ready");
  const [sortMode, setSortMode] = useState("name");
  const [showNeedsSetup, setShowNeedsSetup] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [removingModelId, setRemovingModelId] = useState<string | null>(null);
  const [deleteTargetModelId, setDeleteTargetModelId] = useState<string | null>(null);
  const [deleteImpactLoading, setDeleteImpactLoading] = useState(false);
  const [deleteImpact, setDeleteImpact] = useState<AddModelsProviderActionResult["modelRemoveImpact"] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);
  const pendingSetupModelIdRef = useRef<string | null>(null);
  const {
    models: sharedCatalogModels,
    refresh: refreshSharedCatalog,
    selection: nativeSelection
  } = useModelCatalog({
    enabled: open,
    snapshot,
    agentId
  });
  const modelOptions = useMemo(
    () => dedupeSnapshotModels(buildConfiguredModelRecords(sharedCatalogModels, snapshot.models)),
    [sharedCatalogModels, snapshot.models]
  );
  const currentModel = currentModelId ? findModelByCanonicalId(modelOptions, currentModelId) : null;
  const currentModelSelectable = currentModel ? isSelectableModel(currentModel) : false;
  const deleteTargetModel = deleteTargetModelId ? findModelByCanonicalId(modelOptions, deleteTargetModelId) : null;
  const globalDefaultModelId =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    "";
  const sessionOverrides = snapshot.runtimes.filter(
    (runtime) =>
      runtime.agentId === agent?.id &&
      Boolean(runtime.sessionId) &&
      Boolean(runtime.modelId) &&
      normalizeOpenAiModelId(runtime.modelId ?? "") !== currentModelId
  );
  const setupRequiredCount = modelOptions.filter((model) => !isSelectableModel(model)).length;

  useEffect(() => {
    snapshotRef.current = snapshot;
  }, [snapshot]);

  useEffect(() => {
    if (!open || !agentId) {
      return;
    }

    const currentAgent = snapshotRef.current.agents.find((entry) => entry.id === agentId);

    if (!currentAgent) {
      return;
    }

    const pendingModelId = pendingSetupModelIdRef.current;
    const pendingModel = pendingModelId ? findModelByCanonicalId(modelOptions, pendingModelId) : null;
    setSelectedModelId(
      pendingModel && isSelectableModel(pendingModel)
        ? pendingModel.id
        : currentAgent.modelId === "unassigned"
          ? ""
          : normalizeOpenAiModelId(currentAgent.modelId)
    );
    setSearch("");
    setProviderFilter("all");
    setTypeFilter(pendingModel && !isSelectableModel(pendingModel) ? "needs-setup" : "ready");
    setSortMode("name");
    setShowNeedsSetup(Boolean(pendingModel && !isSelectableModel(pendingModel)));
    setMobileFiltersOpen(false);
    setError(null);
  }, [agentId, modelOptions, open]);

  useEffect(() => {
    pendingSetupModelIdRef.current = null;
  }, [agentId]);

  const visibleModels = useMemo(() => {
    const query = search.trim().toLowerCase();

    return [...modelOptions]
      .sort((left, right) => {
        if (sortMode === "context") {
          return (right.contextWindow ?? 0) - (left.contextWindow ?? 0);
        }

        if (sortMode === "provider") {
          const providerDelta = resolvePickerModelProvider(left).localeCompare(resolvePickerModelProvider(right));
          if (providerDelta !== 0) {
            return providerDelta;
          }
        }

        const leftUnavailable = !isSelectableModel(left);
        const rightUnavailable = !isSelectableModel(right);

        if (leftUnavailable !== rightUnavailable) {
          return leftUnavailable ? 1 : -1;
        }

        const providerDelta = resolvePickerModelProvider(left).localeCompare(resolvePickerModelProvider(right));
        if (providerDelta !== 0) {
          return providerDelta;
        }

        const nameDelta = left.name.localeCompare(right.name);
        if (nameDelta !== 0) {
          return nameDelta;
        }

        return left.id.localeCompare(right.id);
      })
      .filter((model) => {
        const provider = resolvePickerModelProvider(model);

        if (providerFilter !== "all" && provider !== providerFilter) {
          return false;
        }

        if (typeFilter === "local" && !model.local) {
          return false;
        }

        if (typeFilter === "remote" && model.local) {
          return false;
        }

        if (typeFilter === "ready" && !isSelectableModel(model)) {
          return false;
        }

        if (typeFilter === "needs-setup" && isSelectableModel(model)) {
          return false;
        }

        if (!showNeedsSetup && !isSelectableModel(model)) {
          return false;
        }

        if (!query) {
          return true;
        }

        const haystack =
          `${model.name} ${model.id} ${resolvePickerModelProvider(model)} ${model.provider} ${model.input} ${model.tags.join(" ")}`
            .toLowerCase();
        return haystack.includes(query);
      });
  }, [modelOptions, providerFilter, search, showNeedsSetup, sortMode, typeFilter]);
  const activeFilterCount = [providerFilter !== "all", typeFilter !== "ready", sortMode !== "name", showNeedsSetup].filter(Boolean).length;

  const selectedModel = selectedModelId
    ? findModelByCanonicalId(modelOptions, selectedModelId)
    : null;
  const selectedModelSelectable = selectedModel ? isSelectableModel(selectedModel) : !selectedModelId;
  const hasChanges = selectedModelId !== currentModelId;
  const providerOptions = useMemo(
    () =>
      Array.from(new Set(modelOptions.map((model) => resolvePickerModelProvider(model))))
        .filter(Boolean)
        .sort((left, right) => formatModelProviderLabel(left).localeCompare(formatModelProviderLabel(right))),
    [modelOptions]
  );
  const saveModel = async () => {
    if (!agent || !hasChanges || (selectedModelId && (!selectedModel || !selectedModelSelectable))) {
      return;
    }

    setSaving(true);
    setError(null);

    try {
      const response = await fetch("/api/agents", {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          id: agent.id,
          modelId: selectedModelId || null
        })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Unable to update the agent model.");
      }

      onSnapshotChange?.((current) => updateSnapshotAgentModel(current, agent.id, selectedModelId || null));
      pendingSetupModelIdRef.current = null;
      toast.success("Agent model updated.", {
        description: selectedModel?.name || "Automatic — OpenClaw global default"
      });
      onOpenChange(false);

      const refreshPromise = onRefresh?.();
      if (refreshPromise) {
        void refreshPromise.catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to update the agent model.";
      setError(message);
      toast.error(message);
    } finally {
      setSaving(false);
    }
  };

  const handleOpenAddModels = () => {
    onOpenAddModels(null);
    onOpenChange(false);
  };

  const handleOpenProviderSetup = (model: AgentModelRecord) => {
    pendingSetupModelIdRef.current = normalizeOpenAiModelId(model.id);
    setSelectedModelId(model.id);
    const provider = resolvePickerModelProvider(model);
    onOpenAddModels(isAddModelsProviderId(provider) ? provider : null);
    onOpenChange(false);
  };

  const handleRequestDeleteModel = async (model: AgentModelRecord) => {
    setDeleteTargetModelId(model.id);
    setDeleteImpact(null);
    setError(null);

    setDeleteImpactLoading(true);
    try {
      const response = await fetch("/api/models/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "remove-model-impact",
          provider: resolvePickerModelProvider(model),
          modelId: model.id
        })
      });
      const payload = (await response.json()) as AddModelsProviderActionResult & { error?: string };

      if (!response.ok || payload.error || payload.ok === false) {
        throw new Error(payload.error || payload.message || "Unable to inspect model removal impact.");
      }

      setDeleteImpact(payload.modelRemoveImpact ?? null);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to inspect model removal impact.";
      setError(message);
      toast.error(message);
    } finally {
      setDeleteImpactLoading(false);
    }
  };

  const handleConfirmDeleteModel = async () => {
    if (!deleteTargetModel) {
      return;
    }

    setRemovingModelId(deleteTargetModel.id);
    setError(null);

    try {
      const response = await fetch("/api/models/providers", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          action: "remove-model",
          provider: resolvePickerModelProvider(deleteTargetModel),
          modelId: deleteTargetModel.id
        })
      });
      const payload = (await response.json()) as AddModelsProviderActionResult & { error?: string };

      if (!response.ok || payload.error || payload.ok === false) {
        throw new Error(payload.error || payload.message || "Unable to remove the model.");
      }

      const removedModelId = normalizeOpenAiModelId(deleteTargetModel.id);
      const nextSnapshot = removeSnapshotModel(payload.snapshot ?? snapshotRef.current, removedModelId);

      snapshotRef.current = nextSnapshot;
      onSnapshotChange?.(() => nextSnapshot);
      void refreshSharedCatalog(true);
      setSelectedModelId((currentSelected) =>
        normalizeOpenAiModelId(currentSelected) === removedModelId
          ? resolveFallbackSelectedModelId(nextSnapshot)
          : currentSelected
      );
      setDeleteTargetModelId(null);
      setDeleteImpact(null);

      toast.success("Model removed.", {
        description: deleteTargetModel.name
      });

      const refreshPromise = onRefresh?.();
      if (refreshPromise) {
        void refreshPromise.catch(() => undefined);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unable to remove the model.";
      setError(message);
      toast.error(message);
    } finally {
      setRemovingModelId(null);
    }
  };

  if (!agent) {
    return null;
  }

  return (
    <>
      <PikoLoader
        open={saving || Boolean(removingModelId) || deleteImpactLoading}
        title={
          saving
            ? "Changing agent model"
            : removingModelId
              ? "Removing model"
              : "Checking model impact"
        }
        description={
          saving
            ? "Updating the OpenClaw model assignment and refreshing agent state."
            : removingModelId
              ? "Reassigning affected agents and updating OpenClaw configuration."
              : "Checking affected agents and the OpenClaw global default."
        }
      />
      <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        closeClassName="right-3 top-[max(0.75rem,env(safe-area-inset-top))] sm:right-4 sm:top-4"
        className={cn(
          "flex h-dvh max-h-dvh w-screen max-w-none flex-col gap-0 overflow-hidden rounded-none border-0 p-0 sm:h-[min(94dvh,940px)] sm:max-h-[94dvh] sm:w-[min(1400px,calc(100vw-64px))] sm:max-w-[1400px] sm:rounded-[28px] sm:border",
          isLight
            ? "border-border bg-card text-card-foreground shadow-[0_30px_90px_rgba(63,47,34,0.18),0_0_0_1px_rgba(120,92,66,0.08)]"
            : "border-violet-400/45 bg-[#070a14] text-white shadow-[0_0_0_1px_rgba(168,85,247,0.18),0_30px_120px_rgba(3,7,18,0.72),0_0_80px_rgba(124,58,237,0.20)]"
        )}
      >
        <DialogHeader
          className={cn(
            "relative shrink-0 overflow-hidden border-b px-4 pb-3.5 pt-[max(1rem,env(safe-area-inset-top))] pr-12 sm:px-5 sm:py-3.5",
            isLight
              ? "border-border bg-[radial-gradient(circle_at_10%_0%,rgba(124,58,237,0.12),transparent_32%),linear-gradient(135deg,hsl(var(--card)),hsl(var(--muted)/0.64))]"
              : "border-white/10 bg-[radial-gradient(circle_at_10%_0%,rgba(124,58,237,0.20),transparent_32%),linear-gradient(135deg,rgba(12,18,34,0.98),rgba(8,10,23,0.98))]"
          )}
        >
          <div className={cn("absolute inset-x-12 bottom-0 h-px bg-gradient-to-r from-transparent to-transparent", isLight ? "via-primary/25" : "via-violet-400/60")} />
          <div className="flex items-center gap-3">
            <div
              className={cn(
                "flex h-12 w-12 items-center justify-center rounded-[16px] border",
                isLight
                  ? "border-primary/20 bg-primary/10 text-primary shadow-[0_18px_42px_rgba(124,58,237,0.10)]"
                  : "border-violet-300/25 bg-[linear-gradient(145deg,rgba(124,58,237,0.30),rgba(76,29,149,0.18))] text-violet-200 shadow-[0_0_36px_rgba(124,58,237,0.22)]"
              )}
            >
              <Grid2X2 className="h-5 w-5" />
            </div>
            <div>
              <DialogTitle className={cn("font-display text-[1.3rem] leading-none tracking-[-0.04em]", isLight ? "text-foreground" : "text-white")}>
                Change Model
              </DialogTitle>
              <p className={cn("mt-1 text-[0.72rem] font-medium lg:hidden", isLight ? "text-foreground" : "text-slate-100")}>
                {formatAgentDisplayName(agent)}
              </p>
              <DialogDescription className={cn("mt-1 max-w-[620px] text-[0.78rem] leading-[1.15rem]", isLight ? "text-muted-foreground" : "text-slate-300")}>
                Choose the model this agent will use.
              </DialogDescription>
            </div>
          </div>
        </DialogHeader>

        <div
          className={cn(
            "grid min-h-0 flex-1 grid-cols-1 gap-0 overflow-hidden p-0 sm:gap-3 sm:p-3 lg:grid-cols-[300px_minmax(0,1fr)]",
            isLight
              ? "bg-[radial-gradient(circle_at_8%_85%,hsl(var(--primary)/0.08),transparent_28%),linear-gradient(180deg,hsl(var(--background)),hsl(var(--muted)/0.42))]"
              : "bg-[radial-gradient(circle_at_8%_85%,rgba(34,211,238,0.10),transparent_28%),linear-gradient(180deg,rgba(4,7,17,0.96),rgba(3,6,14,0.98))]"
          )}
        >
          <aside
            className={cn(
              "hidden min-h-0 overflow-y-auto rounded-[18px] border p-2.5 lg:block",
              isLight
                ? "border-border bg-card shadow-card"
                : "border-white/10 bg-[linear-gradient(180deg,rgba(17,24,43,0.90),rgba(9,13,25,0.92))] shadow-[inset_0_1px_0_rgba(255,255,255,0.06)]"
            )}
          >
            <div className="flex items-center gap-2.5">
              <div
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-[16px] border",
                  isLight
                    ? "border-primary/20 bg-[radial-gradient(circle_at_50%_15%,rgba(255,255,255,0.65),transparent_28%),linear-gradient(145deg,hsl(var(--primary)/0.16),hsl(var(--muted)))] text-primary shadow-[0_18px_42px_rgba(124,58,237,0.10)]"
                    : "border-violet-300/25 bg-[radial-gradient(circle_at_50%_15%,rgba(255,255,255,0.18),transparent_25%),linear-gradient(145deg,rgba(124,58,237,0.72),rgba(30,41,59,0.82))] text-white shadow-[0_18px_48px_rgba(124,58,237,0.28)]"
                )}
              >
                <Bot className="h-6 w-6" />
              </div>
              <div className="min-w-0">
                <p className={cn("truncate font-display text-[0.98rem]", isLight ? "text-foreground" : "text-white")}>{formatAgentDisplayName(agent)}</p>
                <p className={cn("mt-0.5 truncate text-[0.68rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>{agent.id}</p>
                <Badge className={cn("mt-1 px-2 py-0.5 text-[8px] uppercase tracking-[0.14em]", isLight ? "border-primary/25 bg-primary/10 text-primary" : "border-violet-400/30 bg-violet-400/15 text-violet-100")}>
                  Current agent
                </Badge>
              </div>
            </div>

            <div className={cn("mt-2.5 rounded-[14px] border p-2.5", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.035]")}>
              <div className="flex items-center gap-2.5">
                <div className={cn("flex h-8 w-8 items-center justify-center rounded-[11px] border", isLight ? "border-primary/20 bg-primary/10 text-primary" : "border-violet-300/20 bg-violet-400/15 text-violet-100")}>
                  <ProviderGlyph provider={currentModel ? resolvePickerModelProvider(currentModel) : "openai"} />
                </div>
                <div className="min-w-0">
                  <p className={cn("text-[0.62rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Configured worker model</p>
                  <p className={cn("truncate text-[0.8rem] font-semibold", isLight ? "text-foreground" : "text-white")}>
                    {currentModel?.name || (currentModelId ? currentModelId : "Automatic — OpenClaw global default")}
                  </p>
                </div>
              </div>
            </div>

            <div className="mt-2.5 grid grid-cols-3 gap-1.5">
              <MetricTile label="Global default" value={globalDefaultModelId ? formatModelLabel(globalDefaultModelId) : "Not set"} surfaceTheme={surfaceTheme} />
              <MetricTile label="Agent model" value={currentModel ? formatModelLabel(currentModel.id) : "Inherits default"} tone={currentModelSelectable ? "success" : "warning"} surfaceTheme={surfaceTheme} />
              <MetricTile label="Session overrides" value={sessionOverrides.length > 0 ? String(sessionOverrides.length) : "None"} tone={sessionOverrides.length > 0 ? "warning" : "success"} surfaceTheme={surfaceTheme} />
            </div>

            <div className={cn("mt-2.5 rounded-[14px] border p-2.5", isLight ? "border-border bg-muted/35" : "border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.74),rgba(15,23,42,0.34))]")}>
              <div className="flex items-center gap-2.5">
                <div className={cn("relative flex h-10 w-10 items-center justify-center rounded-full border", isLight ? "border-primary/20 bg-primary/10" : "border-violet-400/20 bg-violet-500/10")}>
                  <div className={cn("absolute inset-1 rounded-full border-[4px] border-r-transparent opacity-70", isLight ? "border-primary/50" : "border-violet-500/55")} />
                  <span className={cn("text-[0.62rem] font-semibold", isLight ? "text-primary" : "text-white")}>N/A</span>
                </div>
                <div>
                  <p className={cn("text-[0.62rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Context capacity</p>
                  <p className={cn("mt-0.5 text-[0.84rem] font-semibold", isLight ? "text-foreground" : "text-white")}>
                    {currentModel ? formatContextWindow(currentModel.contextWindow) : "Unknown"}
                  </p>
                  <p className={cn("mt-0.5 text-[0.62rem]", isLight ? "text-muted-foreground" : "text-slate-500")}>Live token usage is not available from OpenClaw yet</p>
                </div>
              </div>
            </div>

            <div className={cn("mt-2.5 rounded-[14px] border p-2", isLight ? "border-border bg-muted/35" : "border-white/10 bg-white/[0.035]")}>
              <p className={cn("px-1 text-[0.62rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Quick actions</p>
              <button
                type="button"
                onClick={handleOpenAddModels}
                className={cn(
                  "mt-1.5 flex w-full items-center justify-between rounded-[12px] border px-2 py-2 text-left transition",
                  isLight
                    ? "border-border bg-card text-foreground hover:border-primary/25 hover:bg-accent"
                    : "border-white/8 bg-white/[0.04] hover:border-violet-300/30 hover:bg-violet-400/10"
                )}
              >
                <span className="flex items-center gap-2.5">
                  <span className={cn("flex h-7 w-7 items-center justify-center rounded-[9px]", isLight ? "bg-primary/10 text-primary" : "bg-white/[0.06] text-slate-200")}>
                    <Database className="h-3 w-3" />
                  </span>
                  <span>
                    <span className={cn("block text-[0.72rem] font-medium", isLight ? "text-foreground" : "text-white")}>Open Model Library</span>
                    <span className={cn("block text-[0.62rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Manage providers & models</span>
                  </span>
                </span>
                <ChevronRight className={cn("h-3.5 w-3.5", isLight ? "text-muted-foreground" : "text-slate-500")} />
              </button>
            </div>
          </aside>

          <section
            className={cn(
              "flex min-h-0 flex-col overflow-hidden rounded-none border-0 p-4 sm:rounded-[18px] sm:border sm:p-2.5",
              isLight
                ? "border-border bg-card shadow-card"
                : "border-white/10 bg-[linear-gradient(180deg,rgba(10,15,30,0.82),rgba(5,8,18,0.86))] shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]"
            )}
          >
            {nativeSelection ? (
              <div className={cn("mb-2 rounded-[13px] border px-3 py-2 text-[0.7rem]", isLight ? "border-primary/20 bg-primary/5 text-foreground" : "border-violet-300/20 bg-violet-400/[0.07] text-slate-200")}>
                <span className="font-semibold">
                  {nativeSelection.scope === "session" ? "Current session model: " : "Configured model: "}
                </span>
                {nativeSelection.scope === "session"
                  ? nativeSelection.effectiveModelId ? formatModelLabel(nativeSelection.effectiveModelId) : "Unknown"
                  : nativeSelection.configuredModelId ? formatModelLabel(nativeSelection.configuredModelId) : "Automatic — OpenClaw global default"}
                <span className={cn("ml-1.5", isLight ? "text-muted-foreground" : "text-slate-400")}>{nativeSelection.explanation}</span>
              </div>
            ) : null}
            <div className="flex flex-col gap-1.5 xl:flex-row">
              <div className="flex min-w-0 flex-1 gap-1.5">
                <div className="relative min-w-0 flex-1">
                  <Search className={cn("pointer-events-none absolute left-3 top-1/2 h-3.5 w-3.5 -translate-y-1/2", isLight ? "text-muted-foreground" : "text-slate-500")} />
                  <Input
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="Search models..."
                    className={cn("h-8 rounded-[11px] pl-9 text-[0.76rem]", isLight ? "border-input bg-card text-foreground" : "border-white/10 bg-slate-950/45 text-slate-100")}
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setMobileFiltersOpen((current) => !current)}
                  className="h-8 shrink-0 rounded-[11px] px-2.5 text-[0.72rem] xl:hidden"
                  aria-expanded={mobileFiltersOpen}
                >
                  <SlidersHorizontal className="h-3.5 w-3.5" />
                  <span className="ml-1.5">Filters{activeFilterCount > 0 ? ` (${activeFilterCount})` : ""}</span>
                </Button>
              </div>
              <div className={cn("grid grid-cols-2 gap-1.5 xl:flex", mobileFiltersOpen ? "grid" : "hidden")}>
                <NativeFilter className="min-w-0 w-full xl:w-auto" value={providerFilter} onChange={setProviderFilter} ariaLabel="Provider filter" surfaceTheme={surfaceTheme}>
                  <option value="all">All providers</option>
                  {providerOptions.map((provider) => (
                    <option key={provider} value={provider}>{formatModelProviderLabel(provider)}</option>
                  ))}
                </NativeFilter>
                <NativeFilter className="min-w-0 w-full xl:w-auto" value={typeFilter} onChange={setTypeFilter} ariaLabel="Type filter" surfaceTheme={surfaceTheme}>
                  <option value="all">All availability</option>
                  <option value="remote">Remote</option>
                  <option value="local">Local</option>
                  <option value="ready">Ready</option>
                  <option value="needs-setup">Needs setup</option>
                </NativeFilter>
                <NativeFilter className="col-span-2 min-w-0 w-full xl:col-auto xl:w-auto" value={sortMode} onChange={setSortMode} ariaLabel="Sort models" surfaceTheme={surfaceTheme}>
                  <option value="name">Sort: Name</option>
                  <option value="context">Sort: Context</option>
                  <option value="provider">Sort: Provider</option>
                </NativeFilter>
              </div>
              <Button type="button" variant="secondary" onClick={handleOpenAddModels} className="h-8 rounded-[11px] px-3">
                <Library className="h-3.5 w-3.5" />
                <span className="ml-1.5 text-[0.72rem] lg:hidden">Library</span>
              </Button>
              {setupRequiredCount > 0 ? (
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setShowNeedsSetup((current) => !current);
                    setTypeFilter(showNeedsSetup ? "ready" : "all");
                  }}
                  className="h-8 rounded-[11px] px-3 text-[0.68rem]"
                >
                  {showNeedsSetup ? "Hide setup needed" : `Show setup needed (${setupRequiredCount})`}
                </Button>
              ) : null}
            </div>

            <div className="mt-2 min-h-0 flex-1 overflow-y-auto pr-1 lg:max-h-[calc(90dvh-180px)]">
              <div className="space-y-1">
                <button
                  type="button"
                  aria-pressed={!selectedModelId}
                  onClick={() => setSelectedModelId("")}
                  className={cn(
                    "flex w-full items-center gap-2 rounded-[14px] border px-3 py-2.5 text-left transition",
                    !selectedModelId
                      ? isLight
                        ? "border-primary/55 bg-primary/10"
                        : "border-violet-400/85 bg-violet-500/10"
                      : isLight
                        ? "border-border bg-card hover:border-primary/25"
                        : "border-white/8 bg-white/[0.035] hover:border-violet-300/25"
                  )}
                >
                  <span className={cn("flex h-7 w-7 shrink-0 items-center justify-center rounded-full border text-[0.62rem]", !selectedModelId ? "border-primary bg-primary text-primary-foreground" : isLight ? "border-border text-muted-foreground" : "border-slate-500/70 text-slate-400")}>A</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn("block text-[0.78rem] font-semibold", isLight ? "text-foreground" : "text-white")}>Automatic</span>
                    <span className={cn("block text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>Inherit the OpenClaw global default</span>
                  </span>
                  {!selectedModelId ? <Check className="h-3.5 w-3.5 text-primary" /> : null}
                </button>
                {visibleModels.length > 0 ? (
                  visibleModels.map((model) => {
                    const selected = selectedModelId === model.id;
                    const selectable = isSelectableModel(model);
                    const provider = resolvePickerModelProvider(model);

                    return (
                      <div
                        key={model.id}
                        className={cn(
                          "grid w-full grid-cols-[minmax(0,1fr)_32px] items-stretch gap-1.5 rounded-[14px] border p-1.5 transition",
                          selected
                            ? isLight
                              ? "border-primary/55 bg-primary/10 shadow-[0_0_0_1px_hsl(var(--primary)/0.14),0_14px_28px_rgba(124,58,237,0.10)]"
                              : "border-violet-400/85 bg-[radial-gradient(circle_at_10%_50%,rgba(124,58,237,0.28),transparent_36%),linear-gradient(180deg,rgba(39,25,79,0.80),rgba(12,18,35,0.86))] shadow-[0_0_0_1px_rgba(168,85,247,0.28),0_0_36px_rgba(124,58,237,0.22)]"
                            : isLight
                              ? "border-border bg-card hover:border-primary/25 hover:bg-accent/60"
                              : "border-white/8 bg-white/[0.035] hover:border-violet-300/25 hover:bg-white/[0.055]",
                          !selectable && "opacity-70"
                        )}
                      >
                        <button
                          type="button"
                          aria-pressed={selected}
                          onClick={() => {
                            if (selectable) {
                              setSelectedModelId(model.id);
                            } else {
                              handleOpenProviderSetup(model);
                            }
                          }}
                          className={cn(
                            "grid min-h-[72px] min-w-0 grid-cols-[22px_1fr] items-center gap-2 rounded-[12px] px-2 py-1.5 text-left transition lg:grid-cols-[22px_1.15fr_110px_100px_72px]",
                            isLight ? "hover:bg-accent/50" : "hover:bg-white/[0.03]"
                          )}
                        >
                          <span className={cn(
                            "flex h-[18px] w-[18px] items-center justify-center rounded-full border",
                            selected
                              ? "border-primary bg-primary text-primary-foreground"
                              : isLight
                                ? "border-border bg-card"
                                : "border-slate-500/70 bg-slate-950/40"
                          )}>
                            {selected ? <Check className="h-2.5 w-2.5" /> : null}
                          </span>

                          <span className="flex min-w-0 items-center gap-2">
                            <span className={cn("flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] border", getProviderIconTone(provider, surfaceTheme))}>
                              <ProviderGlyph provider={provider} />
                            </span>
                            <span className="min-w-0">
                              <span className={cn("block truncate text-[0.78rem] font-semibold", isLight ? "text-foreground" : "text-white")}>{formatModelLabel(model.id)}</span>
                              <span className={cn("mt-0.5 block truncate text-[0.66rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>{model.name}</span>
                              <span className="mt-0.5 flex flex-wrap gap-1">
                                <Badge variant="muted" className="px-1.5 py-0.5 text-[7.5px]">{formatModelProviderLabel(provider)}</Badge>
                                {model.contextWindow ? (
                                  <Badge variant="muted" className="px-1.5 py-0.5 text-[7.5px]">{formatContextWindow(model.contextWindow)} context window</Badge>
                                ) : null}
                              </span>
                              {!selectable ? (
                                <span
                                  title={resolveModelSetupHint(model)}
                                  className={cn("mt-1 block truncate text-[0.66rem] leading-tight", isLight ? "text-amber-800" : "text-amber-200")}
                                >
                                  {resolveModelSetupHint(model)}
                                </span>
                              ) : null}
                              {!selectable ? (
                                <span className={cn("mt-1 block text-[0.62rem] font-semibold", isLight ? "text-amber-800" : "text-amber-200")}>
                                  Set up {formatModelProviderLabel(provider)}
                                </span>
                              ) : null}
                            </span>
                          </span>

                          <MetricInline icon={<Cpu className="h-3.5 w-3.5" />} value={formatContextWindow(model.contextWindow)} label="Context window" surfaceTheme={surfaceTheme} />
                          <MetricInline icon={<span className={cn("h-2.5 w-2.5 rounded-full", selectable ? "bg-emerald-400" : "bg-amber-400")} />} value={selectable ? "Ready" : "Needs setup"} label="Status" tone={selectable ? "success" : "warning"} surfaceTheme={surfaceTheme} />
                          <Badge className={cn("justify-self-start rounded-[8px] px-2 py-0.5 text-[0.6rem]", model.local ? (isLight ? "border-cyan-300 bg-cyan-50 text-cyan-800" : "border-cyan-300/30 bg-cyan-400/10 text-cyan-100") : (isLight ? "border-primary/25 bg-primary/10 text-primary" : "border-violet-300/30 bg-violet-500/10 text-violet-100"))}>
                            {model.local ? "Local" : "Remote"}
                          </Badge>
                        </button>

                        <button
                          type="button"
                          aria-label={`Remove ${formatModelLabel(model.id)} from config`}
                          title="Remove from config"
                          disabled={removingModelId === model.id}
                          onClick={() => {
                            void handleRequestDeleteModel(model);
                          }}
                          className={cn(
                            "flex h-8 w-8 items-center justify-center self-center justify-self-end rounded-full border border-transparent text-rose-500 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-rose-500/40 focus-visible:ring-offset-2 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-50",
                            isLight ? "hover:bg-rose-50 hover:text-rose-600" : "hover:bg-rose-500/10 hover:text-rose-300"
                          )}
                        >
                          {removingModelId === model.id ? (
                            <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden="true" />
                          ) : (
                            <Trash2 className="h-4 w-4" aria-hidden="true" />
                          )}
                        </button>
                      </div>
                    );
                  })
                ) : (
                  <div className={cn("rounded-[18px] border border-dashed px-4 py-12 text-center", isLight ? "border-border bg-muted/35" : "border-white/12 bg-white/[0.03]")}>
                    <p className={cn("text-sm", isLight ? "text-muted-foreground" : "text-slate-300")}>{search.trim() ? "No models matched this search." : "No usable models are available yet."}</p>
                    <Button type="button" className="mt-4 rounded-full" onClick={handleOpenAddModels}>
                      <Plus className="mr-2 h-4 w-4" />
                      Open Model Library
                    </Button>
                  </div>
                )}
              </div>
            </div>

            {error ? (
              <div className={cn("mt-3 rounded-[16px] border px-4 py-3 text-[0.82rem]", isLight ? "border-rose-200 bg-rose-50 text-rose-800" : "border-rose-400/25 bg-rose-400/[0.10] text-rose-100")}>
                {error}
              </div>
            ) : null}
          </section>
        </div>

        <div className={cn("shrink-0 border-t px-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:py-2", isLight ? "border-border bg-card" : "border-white/[0.08] bg-slate-950/55")}>
          <div className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-center sm:justify-between sm:gap-3">
            <div className={cn("flex min-w-0 flex-1 items-center gap-2 text-[0.68rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>
              <Info className={cn("h-3.5 w-3.5 shrink-0", isLight ? "text-muted-foreground" : "text-slate-500")} />
              <span className="min-w-0 truncate">
                Saving changes the agent assignment. Existing session overrides continue until reset from the runtime inspector.
              </span>
            </div>
            <div className="flex shrink-0 items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className={cn(
                  "hidden h-[34px] shrink-0 rounded-[11px] px-[14px] text-[0.76rem] sm:flex",
                  isLight
                    ? "border-border bg-card text-foreground hover:border-primary/25 hover:bg-accent"
                    : "border-white/10 bg-white/[0.04] text-white hover:border-violet-300/30 hover:bg-violet-400/10"
                )}
                onClick={handleOpenAddModels}
              >
                <Plus className="mr-1.5 h-3.5 w-3.5" />
                Add model
              </Button>
              <Button
                type="button"
                variant="secondary"
                className="h-[34px] shrink-0 rounded-[11px] px-[18px] text-[0.76rem] max-sm:flex-1"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className={cn(
                  "h-[34px] shrink-0 rounded-[11px] px-[18px] text-[0.76rem] font-semibold shadow-[0_18px_45px_rgba(124,58,237,0.35)] max-sm:flex-1",
                  isLight
                    ? "bg-primary text-primary-foreground hover:bg-primary/90"
                    : "bg-[linear-gradient(135deg,#8b5cf6,#6d28d9)]"
                )}
                disabled={saving || !hasChanges || (Boolean(selectedModelId) && !selectedModelSelectable)}
                onClick={() => {
                  void saveModel();
                }}
              >
                {saving ? <LoaderCircle className="mr-2 h-4 w-4 animate-spin" /> : <Check className="mr-2 h-4 w-4" />}
                Save Model
              </Button>
            </div>
          </div>
        </div>

        <Dialog open={Boolean(deleteTargetModel)} onOpenChange={(nextOpen) => {
          if (!nextOpen) {
            setDeleteTargetModelId(null);
            setDeleteImpact(null);
          }
        }}>
          <DialogContent
            className={cn(
              "w-[calc(100vw-48px)] max-w-[520px] rounded-[24px] p-0",
              isLight
                ? "agentos-light-modal border-border bg-card text-card-foreground shadow-[0_24px_72px_rgba(63,47,34,0.18)]"
                : "border-white/10 bg-[#0b1020] text-white shadow-[0_24px_72px_rgba(0,0,0,0.55)]"
            )}
          >
            <DialogHeader className={cn("border-b px-5 py-4", isLight ? "border-border bg-muted/30" : "border-white/10 bg-white/[0.03]")}>
              <DialogTitle className={cn("font-display text-lg", isLight ? "text-foreground" : "text-white")}>
                Remove model
              </DialogTitle>
              <DialogDescription className={cn("text-sm", isLight ? "text-muted-foreground" : "text-slate-300")}>
                This removes the model from the OpenClaw config and hides it from this model list.
              </DialogDescription>
            </DialogHeader>
            <div className="px-5 py-4">
              <div className={cn("rounded-[16px] border px-4 py-3", isLight ? "border-border bg-muted/30" : "border-white/10 bg-white/[0.03]")}>
                <p className={cn("text-[0.72rem] uppercase tracking-[0.18em]", isLight ? "text-muted-foreground" : "text-slate-400")}>Model</p>
                <p className={cn("mt-1 font-semibold", isLight ? "text-foreground" : "text-white")}>{deleteTargetModel?.name}</p>
                <p className={cn("mt-0.5 text-sm", isLight ? "text-muted-foreground" : "text-slate-300")}>{deleteTargetModel?.id}</p>
              </div>
              <div className={cn("mt-3 text-sm leading-6", isLight ? "text-foreground/80" : "text-slate-300")}>
                Removing the model updates OpenClaw config immediately. AgentOS will reassign affected agents before removing the model.
              </div>
              <div className={cn("mt-3 rounded-[16px] border px-4 py-3 text-sm", isLight ? "border-border bg-background" : "border-white/10 bg-slate-950/45")}>
                {deleteImpactLoading ? (
                  <div className={cn("flex items-center gap-2", isLight ? "text-muted-foreground" : "text-slate-300")}>
                    <LoaderCircle className="h-4 w-4 animate-spin" />
                    Checking affected agents and default model…
                  </div>
                ) : deleteImpact ? (
                  <div className="space-y-2">
                    <p className={cn("font-medium", deleteImpact.blockedReason ? "text-rose-500" : isLight ? "text-foreground" : "text-white")}>
                      {deleteImpact.blockedReason ?? "Removal can proceed safely."}
                    </p>
                    <p className={isLight ? "text-muted-foreground" : "text-slate-300"}>
                      Affected agents: {deleteImpact.affectedAgents.length}
                      {deleteImpact.activeAgentIds.length > 0 ? ` (${deleteImpact.activeAgentIds.length} active)` : ""}.
                    </p>
                    <p className={isLight ? "text-muted-foreground" : "text-slate-300"}>
                      OpenClaw global default affected: {deleteImpact.defaultModelAffected ? "yes" : "no"}.
                    </p>
                    {deleteImpact.replacementModelId ? (
                      <p className={isLight ? "text-muted-foreground" : "text-slate-300"}>
                        Replacement model: {deleteImpact.replacementModelId}
                      </p>
                    ) : null}
                  </div>
                ) : (
                  <p className={isLight ? "text-muted-foreground" : "text-slate-300"}>
                    Impact could not be inspected yet. Retry before removing this model.
                  </p>
                )}
              </div>
            </div>
            <div className={cn("flex items-center justify-end gap-2 border-t px-5 py-4", isLight ? "border-border bg-card" : "border-white/10 bg-slate-950/50")}>
              <Button
                type="button"
                variant="secondary"
                className="h-9 rounded-[11px] px-4 text-sm"
                disabled={removingModelId === deleteTargetModel?.id}
                onClick={() => setDeleteTargetModelId(null)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className={cn(
                  "h-9 rounded-[11px] px-4 text-sm font-semibold",
                  isLight
                    ? "bg-rose-600 text-white hover:bg-rose-700"
                    : "bg-rose-500 text-white hover:bg-rose-400"
                )}
                disabled={
                  !deleteTargetModel ||
                  deleteImpactLoading ||
                  Boolean(deleteImpact?.blockedReason) ||
                  removingModelId === deleteTargetModel.id
                }
                onClick={() => {
                  void handleConfirmDeleteModel();
                }}
              >
                {removingModelId === deleteTargetModel?.id ? (
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Trash2 className="mr-2 h-4 w-4" />
                )}
                Remove model
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </DialogContent>
      </Dialog>
    </>
  );
}

function ProviderGlyph({ provider }: { provider: string }) {
  if (provider === "openai") {
    return <Sparkles className="h-5 w-5" />;
  }

  if (provider === "ollama") {
    return <Bot className="h-5 w-5" />;
  }

  if (provider === "openrouter") {
    return <Boxes className="h-5 w-5" />;
  }

  return <Database className="h-5 w-5" />;
}

function MetricTile({
  label,
  value,
  tone = "default",
  surfaceTheme = "dark"
}: {
  label: string;
  value: string;
  tone?: "default" | "success" | "warning";
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className={cn("rounded-[13px] border p-2", isLight ? "border-border bg-card" : "border-white/10 bg-white/[0.035]")}>
      <p className={cn("text-[0.6rem] leading-3", isLight ? "text-muted-foreground" : "text-slate-400")}>{label}</p>
      <p
        className={cn(
          "mt-1.5 truncate text-[0.76rem] font-semibold",
          tone === "success"
            ? isLight ? "text-emerald-700" : "text-emerald-300"
            : tone === "warning"
              ? isLight ? "text-amber-800" : "text-amber-300"
              : isLight ? "text-foreground" : "text-white"
        )}
      >
        {value}
      </p>
    </div>
  );
}

function MetricInline({
  icon,
  value,
  label,
  tone = "default",
  surfaceTheme = "dark"
}: {
  icon: ReactNode;
  value: string;
  label: string;
  tone?: "default" | "success" | "warning";
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";
  const toneText =
    tone === "success"
      ? isLight ? "text-emerald-700" : "text-emerald-300"
      : tone === "warning"
        ? isLight ? "text-amber-800" : "text-amber-300"
        : isLight ? "text-foreground" : "text-white";

  return (
    <span className="hidden min-w-0 items-center gap-3 lg:flex">
      <span className={cn(isLight ? "text-muted-foreground" : "text-slate-300", toneText)}>
        {icon}
      </span>
      <span className="min-w-0">
        <span className={cn("block truncate text-[0.78rem] font-semibold", toneText)}>
          {value}
        </span>
        <span className={cn("block text-[0.64rem]", isLight ? "text-muted-foreground" : "text-slate-400")}>{label}</span>
      </span>
    </span>
  );
}

function NativeFilter({
  value,
  onChange,
  ariaLabel,
  children,
  className,
  surfaceTheme = "dark"
}: {
  value: string;
  onChange: (value: string) => void;
  ariaLabel: string;
  children: ReactNode;
  className?: string;
  surfaceTheme?: "dark" | "light";
}) {
  const isLight = surfaceTheme === "light";

  return (
    <select
      aria-label={ariaLabel}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className={cn(
        "h-8 min-w-[118px] rounded-[11px] border px-3 text-[0.76rem] font-medium outline-none transition",
        className,
        isLight
          ? "border-input bg-card text-foreground hover:border-primary/30 focus:border-primary/50"
          : "border-white/10 bg-slate-950/45 text-slate-100 hover:border-violet-300/30 focus:border-violet-300/50"
      )}
    >
      {children}
    </select>
  );
}

function getProviderIconTone(provider: string, surfaceTheme: "dark" | "light" = "dark") {
  const isLight = surfaceTheme === "light";

  if (provider === "openai") {
    return isLight
      ? "border-primary/20 bg-primary/10 text-primary shadow-[0_16px_34px_rgba(124,58,237,0.10)]"
      : "border-violet-300/25 bg-violet-500/15 text-violet-100 shadow-[0_0_28px_rgba(124,58,237,0.16)]";
  }

  if (provider === "openrouter") {
    return isLight
      ? "border-slate-300 bg-slate-100 text-slate-700"
      : "border-slate-300/20 bg-slate-400/10 text-slate-100";
  }

  if (provider === "ollama") {
    return isLight
      ? "border-cyan-300 bg-cyan-50 text-cyan-800"
      : "border-cyan-300/25 bg-cyan-400/10 text-cyan-100";
  }

  return isLight
    ? "border-amber-300 bg-amber-50 text-amber-800"
    : "border-amber-300/25 bg-amber-400/10 text-amber-100";
}

function resolveModelSetupHint(model: AgentModelRecord) {
  const provider = resolvePickerModelProvider(model);
  const descriptor = isAddModelsProviderId(provider)
    ? getModelProviderDescriptor(provider)
    : null;

  if (model.missing) {
    if (descriptor?.connectKind === "local") {
      return `${descriptor.shortLabel} is installed, but this model is not pulled locally yet.`;
    }

    return descriptor
      ? `${descriptor.shortLabel} does not have this model available yet. Open Add Models > Providers to connect or refresh it.`
      : "This model is not available yet.";
  }

  if (model.available === false) {
    if (descriptor?.connectKind === "apiKey") {
      return `Connect your ${descriptor.shortLabel} API key in Add Models > Providers to use this model.`;
    }

    if (descriptor?.connectKind === "oauth") {
      return `Connect your ${descriptor.shortLabel} account in Add Models > Providers to use this model.`;
    }

    if (descriptor?.connectKind === "local") {
      return `Pull this model locally with Ollama, then refresh the list.`;
    }

    return descriptor
      ? `Open Add Models > Providers to finish setup for ${descriptor.shortLabel}.`
      : "Open Add Models > Providers to finish setup.";
  }

  return "This model is not ready for assignment.";
}

function resolvePickerModelProvider(model: AgentModelRecord) {
  return model.provider;
}

function updateSnapshotAgentModel(
  snapshot: MissionControlSnapshot,
  agentId: string,
  modelId: string | null
) {
  const canonicalModelId = modelId ? normalizeOpenAiModelId(modelId) : "unassigned";
  const nextAgents = snapshot.agents.map((agent) =>
    agent.id === agentId
      ? {
          ...agent,
          modelId: canonicalModelId
        }
      : agent
  );

  const modelUsage = new Map<string, number>();
  for (const agent of nextAgents) {
    const assignedModelId = agent.modelId?.trim();

    if (!assignedModelId || assignedModelId === "unassigned") {
      continue;
    }

    const canonicalAssignedModelId = normalizeOpenAiModelId(assignedModelId);
    modelUsage.set(canonicalAssignedModelId, (modelUsage.get(canonicalAssignedModelId) ?? 0) + 1);
  }

  return {
    ...snapshot,
    agents: nextAgents,
    models: dedupeSnapshotModels(snapshot.models).map((model) => ({
      ...model,
      usageCount: modelUsage.get(model.id) ?? 0
    }))
  };
}

function removeSnapshotModel(
  snapshot: MissionControlSnapshot,
  modelId: string
) {
  const canonicalModelId = normalizeOpenAiModelId(modelId);
  const nextModels = dedupeSnapshotModels(snapshot.models).filter(
    (model) => normalizeOpenAiModelId(model.id) !== canonicalModelId
  );

  return {
    ...snapshot,
    models: nextModels
  };
}

function resolveFallbackSelectedModelId(snapshot: MissionControlSnapshot) {
  const nextModel = dedupeSnapshotModels(snapshot.models).find((model) => isSelectableModel(model));

  return nextModel?.id ?? "";
}

function findModelByCanonicalId(
  models: AgentModelRecord[],
  modelId: string
) {
  const canonicalModelId = normalizeOpenAiModelId(modelId);

  return models.find((entry) => normalizeOpenAiModelId(entry.id) === canonicalModelId) ?? null;
}

function dedupeSnapshotModels(models: AgentModelRecord[]) {
  const recordsByIdentity = new Map<string, AgentModelRecord>();

  for (const model of models) {
    const canonicalId = normalizeOpenAiModelId(model.id);
    const provider = resolvePickerModelProvider(model);
    const normalizedModel = canonicalId === model.id
      ? {
          ...model,
          provider
        }
      : {
          ...model,
          id: canonicalId,
          provider
        };
    const identityKey = modelRecordIdentityKey(model.id, provider);
    const existing = recordsByIdentity.get(identityKey);

    recordsByIdentity.set(
      identityKey,
      existing ? mergeSnapshotModelRecords(existing, normalizedModel) : normalizedModel
    );
  }

  return Array.from(recordsByIdentity.values());
}

function buildConfiguredModelRecords(
  catalogModels: AddModelsCatalogModel[],
  snapshotModels: AgentModelRecord[]
) {
  const snapshotByIdentity = new Map(
    snapshotModels.map((model) => [modelRecordIdentityKey(model.id, model.provider), model] as const)
  );

  return catalogModels
    .filter((model) => model.alreadyAdded)
    .map((model): AgentModelRecord => {
      const snapshotModel = snapshotByIdentity.get(modelRecordIdentityKey(model.id, model.provider));

      return {
        id: model.id,
        name: model.name,
        provider: model.provider,
        input: model.input,
        contextWindow: model.contextWindow,
        local: model.local,
        available: model.available,
        deprecated: snapshotModel?.deprecated ?? model.deprecated,
        disabled: snapshotModel?.disabled ?? model.disabled,
        missing: model.missing,
        tags: model.tags,
        usageCount: snapshotModel?.usageCount ?? 0
      };
    });
}

function mergeSnapshotModelRecords(
  existing: AgentModelRecord,
  candidate: AgentModelRecord
) {
  const preferred = scoreSnapshotModelRecord(candidate) > scoreSnapshotModelRecord(existing) ? candidate : existing;
  const fallback = preferred === candidate ? existing : candidate;

  return {
    ...preferred,
    contextWindow: preferred.contextWindow ?? fallback.contextWindow,
    local: preferred.local ?? fallback.local,
    available: preferred.available === true || fallback.available === true
      ? true
      : preferred.available ?? fallback.available,
    missing: preferred.missing && fallback.missing,
    tags: Array.from(new Set([...preferred.tags, ...fallback.tags].filter(Boolean))),
    usageCount: Math.max(preferred.usageCount, fallback.usageCount)
  };
}

function scoreSnapshotModelRecord(model: AgentModelRecord) {
  let score = 0;

  if (model.available === true) {
    score += 100;
  }

  if (!model.missing) {
    score += 50;
  }

  if (model.usageCount > 0) {
    score += 5;
  }

  return score;
}
