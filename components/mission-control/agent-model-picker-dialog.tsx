"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { Check, LoaderCircle, Plus, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/sonner";
import {
  formatModelProviderLabel,
  getModelProviderDescriptor,
  isAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import { formatAgentDisplayName, formatContextWindow, formatModelLabel } from "@/lib/openclaw/presenters";
import type { AddModelsProviderId, MissionControlSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type AgentModelRecord = MissionControlSnapshot["models"][number];

export function AgentModelPickerDialog({
  open,
  agentId,
  snapshot,
  onOpenChange,
  onSnapshotChange,
  onRefresh,
  onOpenAddModels
}: {
  open: boolean;
  agentId: string | null;
  snapshot: MissionControlSnapshot;
  onOpenChange: (open: boolean) => void;
  onSnapshotChange?: (updater: (snapshot: MissionControlSnapshot) => MissionControlSnapshot) => void;
  onRefresh?: () => Promise<void>;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
}) {
  const agent = agentId ? snapshot.agents.find((entry) => entry.id === agentId) ?? null : null;
  const currentModelId = agent?.modelId && agent.modelId !== "unassigned" ? agent.modelId : "";
  const currentModel = currentModelId ? snapshot.models.find((entry) => entry.id === currentModelId) ?? null : null;
  const currentModelSelectable = currentModel ? isSelectableModel(currentModel) : false;
  const [selectedModelId, setSelectedModelId] = useState(currentModelId);
  const [search, setSearch] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const snapshotRef = useRef(snapshot);

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

    setSelectedModelId(currentAgent.modelId === "unassigned" ? "" : currentAgent.modelId);
    setSearch("");
    setError(null);
  }, [agentId, open]);

  const visibleModels = useMemo(() => {
    const query = search.trim().toLowerCase();

    return [...snapshot.models]
      .sort((left, right) => {
        const leftUnavailable = !isSelectableModel(left);
        const rightUnavailable = !isSelectableModel(right);

        if (leftUnavailable !== rightUnavailable) {
          return leftUnavailable ? 1 : -1;
        }

        const providerDelta = left.provider.localeCompare(right.provider);
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
        if (!query) {
          return true;
        }

        const haystack = `${model.name} ${model.id} ${model.provider} ${model.input} ${model.tags.join(" ")}`.toLowerCase();
        return haystack.includes(query);
      });
  }, [search, snapshot.models]);

  const selectedModel = selectedModelId
    ? snapshot.models.find((entry) => entry.id === selectedModelId) ?? null
    : null;
  const selectedModelSelectable = selectedModel ? isSelectableModel(selectedModel) : false;
  const hasChanges = Boolean(selectedModelId) && selectedModelId !== currentModelId;
  const selectableModelCount = snapshot.models.filter((model) => isSelectableModel(model)).length;
  const currentStatusLabel = currentModel
    ? resolveModelStatusLabel(currentModel)
    : currentModelId
      ? "Unknown"
      : "Default route";
  const currentStatusVariant = currentModel
    ? isSelectableModel(currentModel)
      ? currentModel.local
        ? "success"
        : "default"
      : "warning"
    : currentModelId
      ? "warning"
      : "muted";

  const saveModel = async () => {
    if (!agent || !selectedModel || !selectedModelSelectable || !hasChanges) {
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
          modelId: selectedModelId
        })
      });

      const payload = (await response.json()) as { error?: string };

      if (!response.ok || payload.error) {
        throw new Error(payload.error || "Unable to update the agent model.");
      }

      onSnapshotChange?.((current) => updateSnapshotAgentModel(current, agent.id, selectedModelId));
      toast.success("Agent model updated.", {
        description: selectedModel.name
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

  if (!agent) {
    return null;
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[80dvh] max-h-[80dvh] w-[calc(100vw-16px)] max-w-[760px] flex-col gap-0 overflow-hidden p-0 sm:h-[min(80dvh,720px)] sm:max-h-[min(80dvh,720px)] sm:w-[min(760px,calc(100vw-40px))]">
        <DialogHeader className="shrink-0 border-b border-white/10 bg-[linear-gradient(180deg,rgba(12,18,31,0.96),rgba(9,13,24,0.98))] px-4 py-3.5 pr-10">
          <DialogTitle className="text-[1.05rem]">Change model</DialogTitle>
          <DialogDescription className="max-w-[520px] text-[11px] leading-[1rem] text-slate-400">
            Pick a model already available in AgentOS, or add more models if the right one is not listed yet.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
          <div className="space-y-4 px-3 py-3 sm:px-4 sm:py-4">
            <div className="rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(13,20,34,0.94),rgba(9,13,24,0.96))] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[0.84rem] text-white">{formatAgentDisplayName(agent)}</p>
                  <p className="mt-1 text-[9px] leading-[0.95rem] text-slate-400">{agent.id}</p>
                </div>
                <Badge variant={currentStatusVariant} className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                  {currentStatusLabel}
                </Badge>
              </div>

              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Badge
                  variant={
                    currentModel
                      ? currentModelSelectable
                        ? "default"
                        : currentModel.missing
                          ? "danger"
                          : "warning"
                      : "muted"
                  }
                  className="max-w-full truncate px-2 py-0.5 text-[9px] tracking-[0.12em]"
                >
                  {currentModel?.name || (currentModelId ? currentModelId : "OpenClaw default")}
                </Badge>
                <p className="text-[11px] leading-5 text-slate-400">
                  {currentModel
                    ? `${formatModelProviderLabel(currentModel.provider)} · ${formatContextWindow(currentModel.contextWindow)} ctx`
                    : currentModelId
                      ? "Model metadata unavailable."
                      : "No model is assigned yet."}
                </p>
              </div>
              {currentModel && !currentModelSelectable ? (
                <p className="mt-2 text-[11px] leading-5 text-amber-100/85">
                  {resolveModelSetupHint(currentModel)}
                </p>
              ) : null}
            </div>

            <div className="rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(11,18,32,0.96),rgba(6,10,18,0.98))] p-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-display text-[0.84rem] text-white">Available models</p>
                  <p className="mt-1 text-[9px] leading-[0.95rem] text-slate-400">
                    Select one of the models currently known to this workspace.
                  </p>
                </div>
                <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                  {selectableModelCount} ready
                </Badge>
              </div>

              <div className="relative mt-2.5">
                <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
                <Input
                  value={search}
                  onChange={(event) => setSearch(event.target.value)}
                  placeholder="Search models"
                  className="h-8 pl-8 text-[11px]"
                />
              </div>

              <div className="mt-3 max-h-[min(36vh,300px)] space-y-1 overflow-y-auto pr-1">
                {visibleModels.length > 0 ? (
                  visibleModels.map((model) => {
                    const selected = selectedModelId === model.id;
                    const selectable = isSelectableModel(model);

                    return (
                      <button
                        key={model.id}
                        type="button"
                        disabled={!selectable}
                        aria-pressed={selected}
                        onClick={() => {
                          if (!selectable) {
                            return;
                          }

                          setSelectedModelId(model.id);
                        }}
                        className={cn(
                          "flex w-full items-start justify-between gap-2 rounded-[14px] border px-2.5 py-2 text-left transition-all",
                          selected
                            ? "border-cyan-300/35 bg-cyan-300/[0.08]"
                            : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]",
                          !selectable && "cursor-not-allowed opacity-70"
                        )}
                      >
                        <div className="flex min-w-0 items-start gap-2">
                          <div
                            className={cn(
                              "mt-0.5 flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-md border",
                              selected
                                ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                                : "border-white/12 bg-white/[0.03] text-transparent",
                              !selectable && "border-white/10 bg-white/[0.02] text-slate-500"
                            )}
                          >
                            {selected ? <Check className="h-2 w-2" /> : null}
                          </div>

                          <div className="min-w-0">
                            <p className="truncate text-[11px] font-medium text-white">{model.name}</p>
                            <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.16em] text-slate-500">
                              {formatModelLabel(model.id)}
                            </p>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[9px] text-slate-400">
                      <span>{formatModelProviderLabel(model.provider)}</span>
                      {model.input ? <span>{model.input}</span> : null}
                      {model.contextWindow ? <span>{Intl.NumberFormat().format(model.contextWindow)} ctx</span> : null}
                    </div>
                    {!selectable ? (
                      <p className="mt-1 text-[9px] leading-4 text-amber-100/85">
                        {resolveModelSetupHint(model)}
                      </p>
                    ) : null}
                  </div>
                </div>

                        <div className="shrink-0">
                          <Badge variant={getModelStatusVariant(model)} className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                            {resolveModelStatusLabel(model)}
                          </Badge>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <div className="rounded-[16px] border border-dashed border-white/10 bg-white/[0.03] px-3 py-5 text-center text-[11px] text-slate-400">
                    {search.trim()
                      ? "No models matched this search."
                      : "No usable models are available yet. Add models to connect a provider or discover local routes."}
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-[16px] border border-white/10 bg-white/[0.03] p-3">
              <p className="text-[10px] uppercase tracking-[0.18em] text-slate-500">Selection</p>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <Badge variant={selectedModelSelectable ? "default" : "muted"} className="max-w-full truncate px-2 py-0.5 text-[9px] tracking-[0.12em]">
                  {selectedModel?.name || (selectedModelId ? selectedModelId : "No model selected")}
                </Badge>
                <p className="text-[11px] leading-5 text-slate-400">
                  {selectedModel
                    ? selectedModelSelectable
                      ? `${formatModelProviderLabel(selectedModel.provider)} · ${formatContextWindow(selectedModel.contextWindow)} ctx`
                      : resolveModelSetupHint(selectedModel)
                    : "Pick a model above, then save the assignment."
                  }
                </p>
              </div>
            </div>

            {error ? (
              <div className="rounded-[16px] border border-rose-400/20 bg-rose-400/[0.08] px-3 py-2 text-[11px] text-rose-100">
                {error}
              </div>
            ) : null}
          </div>
        </div>

        <div className="shrink-0 border-t border-white/[0.08] px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Button
              type="button"
              variant="secondary"
              className="h-8 rounded-full px-3 text-[10px]"
              disabled={saving}
              onClick={handleOpenAddModels}
            >
              <Plus className="mr-1.5 h-3 w-3" />
              Add models
            </Button>

            <div className="flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant="secondary"
                className="h-8 rounded-full px-3 text-[10px]"
                disabled={saving}
                onClick={() => onOpenChange(false)}
              >
                Cancel
              </Button>
              <Button
                type="button"
                className="h-8 rounded-full px-3 text-[10px]"
                disabled={saving || !hasChanges || !selectedModelSelectable}
                onClick={() => {
                  void saveModel();
                }}
              >
                {saving ? <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
                Save model
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function isSelectableModel(model: AgentModelRecord) {
  return !model.missing && model.available !== false;
}

function resolveModelSetupHint(model: AgentModelRecord) {
  const descriptor = isAddModelsProviderId(model.provider)
    ? getModelProviderDescriptor(model.provider)
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

function resolveModelStatusLabel(model: AgentModelRecord) {
  if (model.missing) {
    return "Missing";
  }

  if (model.available === false) {
    return "Unavailable";
  }

  if (model.local) {
    return "Local";
  }

  return "Remote";
}

function getModelStatusVariant(model: AgentModelRecord) {
  if (model.missing) {
    return "danger";
  }

  if (model.available === false) {
    return "warning";
  }

  if (model.local) {
    return "success";
  }

  return "muted";
}

function updateSnapshotAgentModel(
  snapshot: MissionControlSnapshot,
  agentId: string,
  modelId: string
) {
  const nextAgents = snapshot.agents.map((agent) =>
    agent.id === agentId
      ? {
          ...agent,
          modelId
        }
      : agent
  );

  const modelUsage = new Map<string, number>();
  for (const agent of nextAgents) {
    const assignedModelId = agent.modelId?.trim();

    if (!assignedModelId || assignedModelId === "unassigned") {
      continue;
    }

    modelUsage.set(assignedModelId, (modelUsage.get(assignedModelId) ?? 0) + 1);
  }

  return {
    ...snapshot,
    agents: nextAgents,
    models: snapshot.models.map((model) => ({
      ...model,
      usageCount: modelUsage.get(model.id) ?? 0
    }))
  };
}
