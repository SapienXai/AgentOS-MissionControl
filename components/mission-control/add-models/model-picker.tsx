"use client";

import { Check, Lock, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { getModelProviderDescriptor } from "@/lib/openclaw/model-provider-registry";
import type { AddModelsCatalogModel, AddModelsProviderId } from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

function filterModels(models: AddModelsCatalogModel[], search: string) {
  const query = search.trim().toLowerCase();

  if (!query) {
    return models;
  }

  return models.filter((model) => {
    const haystack = `${model.name} ${model.id} ${model.tags.join(" ")}`.toLowerCase();
    return haystack.includes(query);
  });
}

export function ModelPicker({
  provider,
  models,
  selectedModelIds,
  search,
  onSearchChange,
  onToggleModel,
  onAddSelected,
  isAdding
}: {
  provider: AddModelsProviderId;
  models: AddModelsCatalogModel[];
  selectedModelIds: string[];
  search: string;
  onSearchChange: (value: string) => void;
  onToggleModel: (modelId: string) => void;
  onAddSelected: () => void;
  isAdding: boolean;
}) {
  const recommendedModels = models.filter((model) => model.recommended);
  const availableSelectedCount = selectedModelIds.filter(
    (modelId) => !models.find((model) => model.id === modelId)?.alreadyAdded
  ).length;
  const hasOpenRouterTabs = provider === "openrouter";
  const searchPlaceholder = getModelProviderDescriptor(provider).searchPlaceholder;
  const showSearch = models.length > 8 || Boolean(searchPlaceholder);
  const filteredRecommendedModels = filterModels(recommendedModels, search);
  const filteredAllModels = filterModels(models, search);

  return (
    <div className="rounded-[20px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,15,26,0.94),rgba(7,11,20,0.96))] p-3.5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-[0.9rem] text-white">Select models to add</p>
          <p className="mt-1 text-[11px] leading-[1.05rem] text-slate-400">
            Found {models.length} model{models.length === 1 ? "" : "s"} for this provider.
          </p>
        </div>
        <Badge variant="muted" className="px-2 py-0.5 text-[10px] tracking-[0.12em]">
          {models.filter((model) => model.alreadyAdded).length} already added
        </Badge>
      </div>

      {showSearch ? (
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={searchPlaceholder ?? "Search models"}
            className="h-9 pl-9 text-[12px]"
          />
        </div>
      ) : null}

      {hasOpenRouterTabs ? (
        <Tabs defaultValue="recommended" className="mt-3.5">
          <TabsList className="h-9 rounded-[18px] p-0.5">
            <TabsTrigger value="recommended" className="rounded-[14px] px-2.5 py-1.5 text-[11px]">
              Recommended
            </TabsTrigger>
            <TabsTrigger value="all" className="rounded-[14px] px-2.5 py-1.5 text-[11px]">
              All models
            </TabsTrigger>
          </TabsList>
          <TabsContent value="recommended">
            <ModelList
              models={filteredRecommendedModels}
              selectedModelIds={selectedModelIds}
              onToggleModel={onToggleModel}
              emptyMessage="No recommended matches. Switch to All models to browse the full catalog."
            />
          </TabsContent>
          <TabsContent value="all">
            <ModelList
              models={filteredAllModels}
              selectedModelIds={selectedModelIds}
              onToggleModel={onToggleModel}
              emptyMessage="No models matched this search."
            />
          </TabsContent>
        </Tabs>
      ) : (
        <div className="mt-3.5">
          <ModelList
            models={filteredAllModels}
            selectedModelIds={selectedModelIds}
            onToggleModel={onToggleModel}
            emptyMessage="No models matched this search."
          />
        </div>
      )}

      <div className="mt-3.5 flex items-center justify-between gap-2 border-t border-white/10 pt-3.5">
        <p className="text-[10px] leading-4 text-slate-400">
          {availableSelectedCount > 0
            ? `${availableSelectedCount} model${availableSelectedCount === 1 ? "" : "s"} selected`
            : "Choose at least one model to add"}
        </p>
        <Button
          type="button"
          onClick={onAddSelected}
          disabled={availableSelectedCount === 0 || isAdding}
          className="h-8 rounded-full px-3 text-[11px]"
        >
          {isAdding ? "Adding..." : "Add selected models"}
        </Button>
      </div>
    </div>
  );
}

function ModelList({
  models,
  selectedModelIds,
  onToggleModel,
  emptyMessage
}: {
  models: AddModelsCatalogModel[];
  selectedModelIds: string[];
  onToggleModel: (modelId: string) => void;
  emptyMessage: string;
}) {
  if (models.length === 0) {
    return (
      <div className="rounded-[18px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-6 text-center text-[12px] text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="max-h-[min(30vh,260px)] space-y-1.5 overflow-y-auto pr-1">
      {models.map((model) => {
        const selected = selectedModelIds.includes(model.id);

        return (
          <button
            key={model.id}
            type="button"
            disabled={model.alreadyAdded}
            onClick={() => onToggleModel(model.id)}
            className={cn(
              "flex w-full items-start justify-between gap-2.5 rounded-[16px] border px-3 py-2.5 text-left transition-all",
              model.alreadyAdded
                ? "cursor-not-allowed border-white/8 bg-white/[0.02] opacity-70"
                : selected
                  ? "border-cyan-300/35 bg-cyan-300/[0.08]"
                  : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"
            )}
          >
            <div className="flex min-w-0 items-start gap-2.5">
              <div
                className={cn(
                  "mt-0.5 flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded-md border",
                  model.alreadyAdded
                    ? "border-white/10 bg-white/[0.03] text-slate-500"
                    : selected
                      ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                      : "border-white/12 bg-white/[0.03] text-transparent"
                )}
              >
                {model.alreadyAdded ? <Lock className="h-2.5 w-2.5" /> : <Check className="h-2.5 w-2.5" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[12px] font-medium text-white">{model.name}</p>
                <p className="mt-0.5 truncate text-[10px] uppercase tracking-[0.16em] text-slate-500">
                  {model.id}
                </p>
                <div className="mt-1.5 flex flex-wrap gap-1.5 text-[10px] text-slate-400">
                  <span>{model.input}</span>
                  {model.contextWindow ? <span>{Intl.NumberFormat().format(model.contextWindow)} ctx</span> : null}
                  {model.isFree ? <span>free</span> : null}
                </div>
              </div>
            </div>

            <div className="shrink-0">
              {model.alreadyAdded ? (
                <Badge variant="muted" className="px-2 py-0.5 text-[10px] tracking-[0.12em]">
                  Already added
                </Badge>
              ) : model.recommended ? (
                <Badge variant="default" className="px-2 py-0.5 text-[10px] tracking-[0.12em]">
                  Recommended
                </Badge>
              ) : model.local ? (
                <Badge variant="success" className="px-2 py-0.5 text-[10px] tracking-[0.12em]">
                  Local
                </Badge>
              ) : (
                <Badge variant="muted" className="px-2 py-0.5 text-[10px] tracking-[0.12em]">
                  Remote
                </Badge>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
