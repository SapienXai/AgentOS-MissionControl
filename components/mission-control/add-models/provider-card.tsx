"use client";

import type { LucideIcon } from "lucide-react";
import { Bot, Cloud, Cpu, Link2, Sparkles, Waypoints } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import type { ModelProviderDescriptor } from "@/lib/openclaw/model-provider-registry";
import { cn } from "@/lib/utils";

const providerIcons: Record<ModelProviderDescriptor["id"], LucideIcon> = {
  "openai-codex": Sparkles,
  openrouter: Waypoints,
  ollama: Cpu,
  anthropic: Bot,
  openai: Cloud,
  xai: Link2
};

export function ProviderCard({
  descriptor,
  active,
  compact = false,
  connected = false,
  detail,
  onClick
}: {
  descriptor: ModelProviderDescriptor;
  active: boolean;
  compact?: boolean;
  connected?: boolean;
  detail?: string | null;
  onClick: () => void;
}) {
  const Icon = providerIcons[descriptor.id];

  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full rounded-[24px] border text-left transition-all",
        compact ? "p-3.5" : "p-4",
        active
          ? "border-cyan-300/40 bg-[linear-gradient(180deg,rgba(23,32,52,0.98),rgba(11,18,31,0.98))] shadow-[0_18px_45px_rgba(10,16,28,0.26)]"
          : "border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(10,15,28,0.92))] hover:border-white/18 hover:bg-[linear-gradient(180deg,rgba(20,29,49,0.96),rgba(12,18,31,0.96))]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div
          className={cn(
            "flex items-center justify-center rounded-[18px] border",
            compact ? "h-9 w-9" : "h-10 w-10",
            active
              ? "border-cyan-300/25 bg-cyan-300/10 text-cyan-100"
              : "border-white/10 bg-white/[0.04] text-slate-200"
          )}
        >
          <Icon className="h-4 w-4" />
        </div>
        <Badge variant={connected ? "success" : active ? "default" : "muted"}>
          {connected ? "Connected" : active ? "Selected" : "Provider"}
        </Badge>
      </div>

      <div className={compact ? "mt-3" : "mt-4"}>
        <p className={cn("font-display text-white", compact ? "text-[0.92rem]" : "text-[0.98rem]")}>
          {descriptor.label}
        </p>
        <p className={cn("mt-1.5 text-slate-300", compact ? "text-[11px] leading-5" : "text-[12px] leading-5")}>
          {descriptor.description}
        </p>
        <p className="mt-3 text-[10px] uppercase tracking-[0.18em] text-slate-500">
          {detail || descriptor.helperText}
        </p>
      </div>
    </button>
  );
}
