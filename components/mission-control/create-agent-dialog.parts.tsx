"use client";

import type { ReactNode } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import {
  formatAgentFileAccessLabel,
  formatAgentInstallScopeLabel,
  formatAgentMissingToolBehaviorLabel,
  formatAgentNetworkAccessLabel,
  formatCapabilityLabel,
  getAgentPresetMeta,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import { defaultHeartbeatForPreset } from "@/lib/openclaw/agent-heartbeat";
import type { AgentPreset } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

export function FormField({
  label,
  htmlFor,
  children
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-2">
      <Label htmlFor={htmlFor} className="text-[11px] uppercase tracking-[0.18em] text-slate-400">
        {label}
      </Label>
      {children}
    </div>
  );
}

export function AgentPresetCard({
  preset,
  active,
  expanded,
  onClick
}: {
  preset: AgentPreset;
  active: boolean;
  expanded: boolean;
  onClick: () => void;
}) {
  const meta = getAgentPresetMeta(preset);
  const policy = resolveAgentPolicy(preset);
  const heartbeat = defaultHeartbeatForPreset(preset);
  const isExpanded = expanded;

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      aria-expanded={isExpanded}
      className={cn(
        "flex h-full min-w-0 shrink-0 flex-col rounded-[20px] border p-3 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300/40 snap-start",
        isExpanded ? "w-[16rem] sm:w-[17rem]" : "w-[11rem] sm:w-[12rem]",
        active
          ? "border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
          : "border-white/10 bg-white/[0.03] hover:border-white/20 hover:bg-white/[0.05]"
      )}
      data-expanded={isExpanded ? "true" : "false"}
    >
      <div className="flex h-full flex-col gap-2.5">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-white/10 bg-white/5 text-[11px]">
                {meta.defaultEmoji}
              </span>
              <p className="truncate text-[13px] font-medium text-white">{meta.label}</p>
            </div>
            <p
              className={cn(
                "text-[11px] leading-4 text-slate-400",
                isExpanded ? "line-clamp-none" : "line-clamp-2"
              )}
            >
              {meta.description}
            </p>
          </div>
          <Badge variant={meta.badgeVariant} className="shrink-0 px-2 py-1 text-[9px] normal-case tracking-normal">
            {active ? "selected" : isExpanded ? "open" : "preset"}
          </Badge>
        </div>

        {isExpanded ? (
          <div className="space-y-3 border-t border-white/10 pt-3">
            <PresetChipGroup title="Tools" tone="cyan" items={meta.tools} />
            <PresetChipGroup title="Skills" tone="amber" items={meta.skillIds} />

            <div className="space-y-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Policy</p>
              <div className="flex flex-wrap gap-1.5">
                <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                  {formatAgentMissingToolBehaviorLabel(policy.missingToolBehavior)}
                </Badge>
                <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                  {formatAgentInstallScopeLabel(policy.installScope)}
                </Badge>
                <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                  {formatAgentFileAccessLabel(policy.fileAccess)}
                </Badge>
                <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                  Network {formatAgentNetworkAccessLabel(policy.networkAccess)}
                </Badge>
                <Badge
                  variant={heartbeat.enabled ? "success" : "muted"}
                  className="px-2 py-1 text-[9px] normal-case tracking-normal"
                >
                  Heartbeat {heartbeat.enabled ? heartbeat.every : "off"}
                </Badge>
              </div>
            </div>

            <div className="flex items-center justify-between gap-2">
              <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Click again to collapse</p>
              <Badge variant="muted" className="gap-1 px-2 py-1 text-[9px] normal-case tracking-normal">
                <ChevronUp className="h-3 w-3" />
                Collapse
              </Badge>
            </div>
          </div>
        ) : (
          <div className="mt-auto space-y-2">
            <p className="text-[10px] leading-4 text-slate-500">
              {meta.tools.length} tools · {meta.skillIds.length} skills · Network{" "}
              {formatAgentNetworkAccessLabel(policy.networkAccess)}
            </p>
            <div className="flex items-center justify-between gap-2">
              <Badge variant="muted" className="px-2 py-1 text-[9px] normal-case tracking-normal">
                Heartbeat {heartbeat.enabled ? heartbeat.every : "off"}
              </Badge>
              <span className="inline-flex items-center gap-1 text-[10px] uppercase tracking-[0.2em] text-slate-500">
                Details
                <ChevronDown className="h-3 w-3" />
              </span>
            </div>
          </div>
        )}
      </div>
    </button>
  );
}

export function PresetChipGroup({
  title,
  tone,
  items
}: {
  title: string;
  tone: "cyan" | "amber";
  items: string[];
}) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{title}</p>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {items.map((item) => (
          <PresetChip key={item} tone={tone} label={formatCapabilityLabel(item)} />
        ))}
      </div>
    </div>
  );
}

export function PresetChip({
  label,
  tone
}: {
  label: string;
  tone: "cyan" | "amber";
}) {
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center whitespace-nowrap rounded-full border px-2 py-1 text-[9px] font-medium leading-none tracking-normal",
        tone === "cyan"
          ? "border-cyan-300/20 bg-cyan-400/10 text-cyan-50"
          : "border-amber-300/20 bg-amber-400/10 text-amber-50"
      )}
    >
      {label}
    </span>
  );
}

export function AgentPolicySelect<T extends string>({
  label,
  htmlFor,
  value,
  options,
  onChange
}: {
  label: string;
  htmlFor: string;
  value: T;
  options: Array<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <FormField label={label} htmlFor={htmlFor}>
      <select
        id={htmlFor}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        className="flex h-11 w-full rounded-2xl border border-white/10 bg-white/5 px-4 py-2 text-sm text-white outline-none"
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label} - {option.description}
          </option>
        ))}
      </select>
    </FormField>
  );
}
