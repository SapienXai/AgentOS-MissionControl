"use client";

import { Badge } from "@/components/ui/badge";
import { ProviderLogo } from "@/components/mission-control/provider-logo";
import type { ModelProviderDescriptor } from "@/lib/openclaw/model-provider-registry";
import { cn } from "@/lib/utils";

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
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "group w-full rounded-[20px] border text-left transition-all",
        compact ? "p-2.5" : "p-3.5",
        active
          ? compact
            ? "border-cyan-300/40 bg-[linear-gradient(180deg,rgba(23,32,52,0.98),rgba(11,18,31,0.98))] shadow-[0_12px_26px_rgba(10,16,28,0.22)]"
            : "border-cyan-300/40 bg-[linear-gradient(180deg,rgba(23,32,52,0.98),rgba(11,18,31,0.98))] shadow-[0_16px_36px_rgba(10,16,28,0.26)]"
          : "border-white/10 bg-[linear-gradient(180deg,rgba(15,23,42,0.92),rgba(10,15,28,0.92))] hover:border-white/18 hover:bg-[linear-gradient(180deg,rgba(20,29,49,0.96),rgba(12,18,31,0.96))]"
      )}
    >
      <div className="flex items-start justify-between gap-2.5">
        <ProviderLogo
          className={cn(compact ? "h-7 w-7" : "h-9 w-9", active ? "ring-1 ring-cyan-300/20" : "")}
          provider={descriptor.id}
        />
        <Badge
          variant={connected ? "success" : active ? "default" : "muted"}
          className={cn("tracking-[0.12em]", compact ? "px-1.5 py-0.5 text-[9px]" : "px-2 py-0.5 text-[10px]")}
        >
          {connected ? "Connected" : active ? "Selected" : "Provider"}
        </Badge>
      </div>

      <div className={compact ? "mt-2" : "mt-3.5"}>
        <p className={cn("font-display text-white", compact ? "text-[0.82rem]" : "text-[0.94rem]")}>
          {descriptor.label}
        </p>
        <p className={cn("mt-1 text-slate-300", compact ? "text-[9px] leading-[0.95rem]" : "text-[11px] leading-5")}>
          {descriptor.description}
        </p>
        <p className={cn("mt-2.5 uppercase tracking-[0.18em] text-slate-500", compact ? "text-[8px]" : "text-[9px]")}>
          {detail || descriptor.helperText}
        </p>
      </div>
    </button>
  );
}
