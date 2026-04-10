"use client";

import { AlertTriangle, Check, Lock, Search, LoaderCircle } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { formatModelProviderLabel, getModelProviderDescriptor, isAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import { formatContextWindow } from "@/lib/openclaw/presenters";
import type { AddModelsCatalogModel, AddModelsProviderId } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

function filterModels(models: AddModelsCatalogModel[], search: string) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return models;
  }

  return models.filter((model) => {
    const haystack = `${model.name} ${model.id} ${model.provider} ${model.input} ${model.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });
}

export function GlobalModelPicker({
  models,
  selectedModelIds,
  search,
  onSearchChange,
  onToggleModel,
  onAddSelected,
  onOpenProviders,
  onLoadMore,
  visibleModelCount,
  isAdding,
  isLoading
}: {
  models: AddModelsCatalogModel[];
  selectedModelIds: string[];
  search: string;
  onSearchChange: (value: string) => void;
  onToggleModel: (providerId: AddModelsProviderId, modelId: string) => void;
  onAddSelected: () => void;
  onOpenProviders: (providerId?: AddModelsProviderId | null) => void;
  onLoadMore: () => void;
  visibleModelCount: number;
  isAdding: boolean;
  isLoading: boolean;
}) {
  const filteredModels = filterModels(models, search);
  const showAllMatches = search.trim().length > 0;
  const visibleModels = showAllMatches ? filteredModels : filteredModels.slice(0, visibleModelCount);
  const hasMoreModels = !showAllMatches && visibleModelCount < filteredModels.length;
  const remainingModelCount = filteredModels.length - visibleModelCount;
  const selectedModelCount = selectedModelIds.filter(
    (modelId) => {
      const model = models.find((entry) => entry.id === modelId);
      if (!model) {
        return false;
      }

      return !model.alreadyAdded;
    }
  ).length;
  const providerCount = new Set(models.map((model) => model.provider)).size;
  const addedModelCount = models.filter((model) => model.alreadyAdded).length;

  return (
    <div className="rounded-[18px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,15,26,0.94),rgba(7,11,20,0.96))] p-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-[0.84rem] text-white">Catalog</p>
          <p className="mt-1 text-[10px] leading-[0.98rem] text-slate-400">
            Browse the full OpenClaw catalog. Unavailable entries show which provider setup is missing.
          </p>
        </div>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
            {models.length} models
          </Badge>
          <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
            {providerCount} providers
          </Badge>
          <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
            {addedModelCount} added
          </Badge>
        </div>
      </div>

      <div className="relative mt-3">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-3 w-3 -translate-y-1/2 text-slate-500" />
        <Input
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder="Search all discovered models"
          className="h-8 pl-8 text-[11px]"
        />
      </div>

      {isLoading ? (
        <div className="mt-3 rounded-[16px] border border-white/10 bg-white/[0.03] px-3 py-5 text-center text-[11px] text-slate-400">
          <LoaderCircle className="mx-auto mb-2 h-4 w-4 animate-spin text-slate-400" />
          Loading OpenClaw catalog...
        </div>
      ) : visibleModels.length > 0 ? (
        <div className="mt-3 max-h-[min(38vh,340px)] space-y-1 overflow-y-auto pr-1">
          {visibleModels.map((model) => {
            const selected = selectedModelIds.includes(model.id);
            const locked = model.alreadyAdded;
            const needsSetup = !locked && (model.available === false || model.missing);
            const providerDescriptor = isAddModelsProviderId(model.provider)
              ? getModelProviderDescriptor(model.provider)
              : null;
            const setupHint = resolveSetupHint(model, providerDescriptor?.shortLabel ?? model.provider);

            return (
              <button
                key={model.id}
                type="button"
                disabled={locked}
                aria-pressed={selected}
                onClick={() => {
                  if (locked) {
                    return;
                  }

                  onToggleModel(model.provider as AddModelsProviderId, model.id);
                }}
                className={cn(
                  "flex w-full items-start justify-between gap-2 rounded-[14px] border px-2.5 py-2 text-left transition-all",
                  locked
                    ? "cursor-not-allowed border-white/8 bg-white/[0.02] opacity-70"
                    : selected
                      ? "border-cyan-300/35 bg-cyan-300/[0.08]"
                    : needsSetup
                      ? "border-amber-300/20 bg-amber-300/[0.06] hover:border-amber-300/30 hover:bg-amber-300/[0.08]"
                      : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"
                )}
              >
                <div className="flex min-w-0 items-start gap-2">
                  <div
                    className={cn(
                      "mt-0.5 flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-md border",
                      locked
                        ? "border-white/10 bg-white/[0.03] text-slate-500"
                        : selected
                          ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                        : needsSetup
                          ? "border-amber-300/30 bg-amber-300/10 text-amber-100"
                          : "border-white/12 bg-white/[0.03] text-transparent"
                    )}
                  >
                    {locked ? (
                      <Lock className="h-2 w-2" />
                    ) : selected ? (
                      <Check className="h-2 w-2" />
                    ) : (
                      <AlertTriangle className="h-2 w-2" />
                    )}
                  </div>

                  <div className="min-w-0">
                    <p className="truncate text-[11px] font-medium text-white">{model.name}</p>
                    <p className="mt-0.5 truncate text-[9px] uppercase tracking-[0.16em] text-slate-500">
                      {model.id}
                    </p>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[9px] text-slate-400">
                      <span>{formatModelProviderLabel(model.provider)}</span>
                      {model.input ? <span>{model.input}</span> : null}
                      {model.contextWindow ? <span>{formatContextWindow(model.contextWindow)} ctx</span> : null}
                    </div>
                    {needsSetup ? (
                      <p className="mt-1 text-[9px] leading-4 text-amber-100/85">{setupHint}</p>
                    ) : null}
                  </div>
                </div>

                <div className="shrink-0">
                  {locked ? (
                    <Badge variant="muted" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                      Already added
                    </Badge>
                  ) : needsSetup ? (
                    <Badge variant="warning" className="px-1.5 py-0.5 text-[9px] tracking-[0.12em]">
                      Needs setup
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
          {hasMoreModels ? (
            <div className="pt-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onLoadMore}
                className="h-8 w-full rounded-full px-3 text-[10px]"
              >
                Load {Math.min(5, remainingModelCount)} more
              </Button>
            </div>
          ) : null}
        </div>
      ) : (
        <div className="mt-3 rounded-[16px] border border-dashed border-white/10 bg-white/[0.03] px-3 py-5 text-center text-[11px] text-slate-400">
          {search.trim()
            ? "No models matched this search."
            : "OpenClaw did not return any supported models yet."}
          <div className="mt-3">
            <Button
              type="button"
              variant="secondary"
              className="h-8 rounded-full px-3 text-[10px]"
              onClick={() => onOpenProviders()}
            >
              Open providers
            </Button>
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center justify-between gap-2 border-t border-white/10 pt-3">
        <p className="text-[9px] leading-4 text-slate-400">
          {selectedModelCount > 0
            ? `${selectedModelCount} model${selectedModelCount === 1 ? "" : "s"} selected`
            : "Choose one or more models to add"}
        </p>
        <Button
          type="button"
          onClick={onAddSelected}
          disabled={selectedModelCount === 0 || isAdding}
          className="h-7 rounded-full px-2.5 text-[10px]"
        >
          {isAdding ? "Adding..." : "Add selected models"}
        </Button>
      </div>
    </div>
  );
}

function resolveSetupHint(model: AddModelsCatalogModel, providerLabel: string) {
  if (model.missing) {
    return `${providerLabel} is configured, but this model is not available locally yet. You can still add it now, then finish setup in Providers.`;
  }

  if (model.available === false) {
    return `${providerLabel} needs a one-time setup before this model can be used. You can add it now, then connect it in Add Models > Providers.`;
  }

  return "";
}
