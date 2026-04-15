"use client";

import type { ReactNode } from "react";
import { Sparkles } from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Label } from "@/components/ui/label";
import { defaultHeartbeatForPreset } from "@/lib/openclaw/agent-heartbeat";
import { getAgentPresetMeta } from "@/lib/openclaw/agent-presets";
import type { AgentPreset } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

export function FormField({
  label,
  htmlFor,
  children,
  surfaceTheme = "dark"
}: {
  label: string;
  htmlFor: string;
  children: ReactNode;
  surfaceTheme?: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div className="space-y-1.5">
      <Label
        htmlFor={htmlFor}
        className={cn(
          "text-[10px] uppercase tracking-[0.16em]",
          isLight ? "text-[#8d7766]" : "text-slate-400"
        )}
      >
        {label}
      </Label>
      {children}
    </div>
  );
}

export function AgentPresetCard({
  preset,
  active,
  onClick,
  surfaceTheme = "dark"
}: {
  preset: AgentPreset;
  active: boolean;
  onClick: () => void;
  surfaceTheme?: SurfaceTheme;
}) {
  const meta = getAgentPresetMeta(preset);
  const heartbeat = defaultHeartbeatForPreset(preset);
  const isLight = surfaceTheme === "light";

  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex h-full min-h-[200px] min-w-0 flex-col justify-between rounded-[24px] border p-4 text-left transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 snap-start",
        isLight
          ? "border-[#e3d7cc] bg-white/92 shadow-[0_16px_34px_rgba(161,125,101,0.08)] focus-visible:ring-[#c89e73]/30 hover:border-[#d3c0b2] hover:bg-white"
          : "border-white/10 bg-white/[0.03] shadow-[0_12px_28px_rgba(0,0,0,0.22)] focus-visible:ring-cyan-300/40 hover:border-white/20 hover:bg-white/[0.05]",
        active &&
          (isLight
            ? "border-[#c89e73] bg-[#fff8f0] shadow-[0_18px_44px_rgba(161,125,101,0.14)]"
            : "border-cyan-300/30 bg-cyan-400/10 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]")
      )}
    >
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={cn(
                "inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-2xl border text-[15px]",
                isLight ? "border-[#ded0c2] bg-[#faf5ef] text-[#7b604c]" : "border-white/10 bg-white/5 text-white"
              )}
            >
              {meta.defaultEmoji ?? <Sparkles className="h-4 w-4" />}
            </span>
            <div className="min-w-0">
              <p className={cn("line-clamp-2 break-words text-[14px] font-semibold leading-5", isLight ? "text-[#2f2016]" : "text-white")}>
                {meta.label}
              </p>
              <p className={cn("mt-1 line-clamp-3 text-[12px] leading-5", isLight ? "text-[#6d5849]" : "text-slate-400")}>
                {meta.description}
              </p>
            </div>
          </div>
          <Badge
            variant={active ? "default" : "muted"}
            className={cn(
              "shrink-0 px-2 py-0.5 text-[9px] normal-case tracking-normal",
              isLight
                ? active
                  ? "border-[#c89e73]/35 bg-[#f4e6d8] text-[#5f432f]"
                  : "border-[#e1d5c8] bg-white text-[#846a58]"
                : active
                  ? "border-cyan-300/30 bg-cyan-400/10 text-cyan-50"
                  : "border-white/10 bg-white/5 text-slate-300"
            )}
          >
            {active ? "selected" : "preset"}
          </Badge>
        </div>

        <div className="flex flex-wrap gap-2">
          <Badge
            variant="muted"
            className={cn(
              "px-2 py-0.5 text-[10px] normal-case tracking-normal",
              isLight ? "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]" : ""
            )}
          >
            {meta.tools.length} tools
          </Badge>
          <Badge
            variant="muted"
            className={cn(
              "px-2 py-0.5 text-[10px] normal-case tracking-normal",
              isLight ? "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]" : ""
            )}
          >
            {meta.skillIds.length} skills
          </Badge>
          <Badge
            variant={heartbeat.enabled ? "success" : "muted"}
            className={cn(
              "px-2 py-0.5 text-[10px] normal-case tracking-normal",
              isLight
                ? heartbeat.enabled
                  ? "border-emerald-300/40 bg-emerald-100 text-emerald-800"
                  : "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]"
                : ""
            )}
          >
            Heartbeat {heartbeat.enabled ? heartbeat.every : "off"}
          </Badge>
        </div>
      </div>
    </button>
  );
}

export function AgentPolicySelect<T extends string>({
  label,
  htmlFor,
  value,
  options,
  onChange,
  surfaceTheme = "dark"
}: {
  label: string;
  htmlFor: string;
  value: T;
  options: Array<{ value: T; label: string; description: string }>;
  onChange: (value: T) => void;
  surfaceTheme?: SurfaceTheme;
}) {
  const isLight = surfaceTheme === "light";

  const selectedOption = options.find((option) => option.value === value);

  return (
    <FormField label={label} htmlFor={htmlFor} surfaceTheme={surfaceTheme}>
      <select
        id={htmlFor}
        value={value}
        onChange={(event) => onChange(event.target.value as T)}
        style={isLight ? { colorScheme: "light" } : undefined}
        className={cn(
          "flex h-10 w-full rounded-2xl border px-3.5 py-2 text-[13px] outline-none transition-colors",
          isLight
            ? "border-[#dccfc3] bg-white text-[#3f2f24] placeholder:text-[#9b8573] focus:border-[#c89e73] focus:ring-2 focus:ring-[#c89e73]/15"
            : "border-white/10 bg-white/5 text-white placeholder:text-slate-500 focus:border-cyan-300/30 focus:ring-2 focus:ring-cyan-300/15"
        )}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      {selectedOption?.description ? (
        <p className={cn("mt-1 text-[10px] leading-[1.4]", isLight ? "text-[#9a8070]" : "text-slate-500")}>
          {selectedOption.description}
        </p>
      ) : null}
    </FormField>
  );
}
