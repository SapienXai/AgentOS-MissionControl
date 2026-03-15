"use client";

import { Check, Lock, Search } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  const showSearch = models.length > 8 || provider === "openrouter";
  const availableSelectedCount = selectedModelIds.filter(
    (modelId) => !models.find((model) => model.id === modelId)?.alreadyAdded
  ).length;
  const hasOpenRouterTabs = provider === "openrouter";
  const filteredRecommendedModels = filterModels(recommendedModels, search);
  const filteredAllModels = filterModels(models, search);

  return (
    <div className="rounded-[24px] border border-white/10 bg-[linear-gradient(180deg,rgba(10,15,26,0.94),rgba(7,11,20,0.96))] p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-display text-[0.96rem] text-white">Select models to add</p>
          <p className="mt-1 text-[12px] leading-5 text-slate-400">
            Found {models.length} model{models.length === 1 ? "" : "s"} for this provider.
          </p>
        </div>
        <Badge variant="muted">
          {models.filter((model) => model.alreadyAdded).length} already added
        </Badge>
      </div>

      {showSearch ? (
        <div className="relative mt-4">
          <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <Input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder={provider === "openrouter" ? "Search OpenRouter models" : "Search models"}
            className="pl-11"
          />
        </div>
      ) : null}

      {hasOpenRouterTabs ? (
        <Tabs defaultValue="recommended" className="mt-4">
          <TabsList>
            <TabsTrigger value="recommended">Recommended</TabsTrigger>
            <TabsTrigger value="all">All models</TabsTrigger>
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
        <div className="mt-4">
          <ModelList
            models={filteredAllModels}
            selectedModelIds={selectedModelIds}
            onToggleModel={onToggleModel}
            emptyMessage="No models matched this search."
          />
        </div>
      )}

      <div className="mt-4 flex items-center justify-between gap-3 border-t border-white/10 pt-4">
        <p className="text-[11px] text-slate-400">
          {availableSelectedCount > 0
            ? `${availableSelectedCount} model${availableSelectedCount === 1 ? "" : "s"} selected`
            : "Choose at least one model to add"}
        </p>
        <Button
          type="button"
          onClick={onAddSelected}
          disabled={availableSelectedCount === 0 || isAdding}
          className="h-9 rounded-full px-4"
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
      <div className="rounded-[22px] border border-dashed border-white/10 bg-white/[0.03] px-4 py-8 text-center text-[13px] text-slate-400">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="max-h-[min(36vh,320px)] space-y-2 overflow-y-auto pr-1">
      {models.map((model) => {
        const selected = selectedModelIds.includes(model.id);

        return (
          <button
            key={model.id}
            type="button"
            disabled={model.alreadyAdded}
            onClick={() => onToggleModel(model.id)}
            className={cn(
              "flex w-full items-start justify-between gap-3 rounded-[18px] border px-3.5 py-3 text-left transition-all",
              model.alreadyAdded
                ? "cursor-not-allowed border-white/8 bg-white/[0.02] opacity-70"
                : selected
                  ? "border-cyan-300/35 bg-cyan-300/[0.08]"
                  : "border-white/8 bg-white/[0.03] hover:border-white/16 hover:bg-white/[0.05]"
            )}
          >
            <div className="flex min-w-0 items-start gap-3">
              <div
                className={cn(
                  "mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border",
                  model.alreadyAdded
                    ? "border-white/10 bg-white/[0.03] text-slate-500"
                    : selected
                      ? "border-cyan-300/50 bg-cyan-300/15 text-cyan-100"
                      : "border-white/12 bg-white/[0.03] text-transparent"
                )}
              >
                {model.alreadyAdded ? <Lock className="h-3 w-3" /> : <Check className="h-3 w-3" />}
              </div>
              <div className="min-w-0">
                <p className="truncate text-[13px] font-medium text-white">{model.name}</p>
                <p className="mt-1 truncate text-[11px] uppercase tracking-[0.18em] text-slate-500">
                  {model.id}
                </p>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] text-slate-400">
                  <span>{model.input}</span>
                  {model.contextWindow ? <span>{Intl.NumberFormat().format(model.contextWindow)} ctx</span> : null}
                  {model.isFree ? <span>free</span> : null}
                </div>
              </div>
            </div>

            <div className="shrink-0">
              {model.alreadyAdded ? (
                <Badge variant="muted">Already added</Badge>
              ) : model.recommended ? (
                <Badge variant="default">Recommended</Badge>
              ) : model.local ? (
                <Badge variant="success">Local</Badge>
              ) : (
                <Badge variant="muted">Remote</Badge>
              )}
            </div>
          </button>
        );
      })}
    </div>
  );
}
