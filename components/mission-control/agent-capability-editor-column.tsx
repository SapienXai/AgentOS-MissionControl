"use client";

import type { KeyboardEvent, RefObject } from "react";

import { Lock, Plus } from "lucide-react";

import { Badge, type BadgeProps } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { type CapabilityOption } from "@/lib/openclaw/capability-editor";
import { cn } from "@/lib/utils";

type AgentCapabilityEditorColumnProps = {
  title: string;
  selectedValues: string[];
  selectedTone: "cyan" | "amber";
  selectedEmptyLabel: string;
  lockedValues?: string[];
  observedValues?: string[];
  inputRef: RefObject<HTMLInputElement | null>;
  inputValue: string;
  onInputValueChange: (value: string) => void;
  onRemove: (value: string) => void;
  onAddCustom: () => void;
  onPick: (value: string) => void;
  suggestions: CapabilityOption[];
  emptySuggestionLabel: string;
  loading: boolean;
  catalogError: string | null;
  helperLabel: string;
  highlight: boolean;
  customActionLabel: string;
};

export function AgentCapabilityEditorColumn({
  title,
  selectedValues,
  selectedTone,
  selectedEmptyLabel,
  lockedValues = [],
  observedValues = [],
  inputRef,
  inputValue,
  onInputValueChange,
  onRemove,
  onAddCustom,
  onPick,
  suggestions,
  emptySuggestionLabel,
  loading,
  catalogError,
  helperLabel,
  highlight,
  customActionLabel
}: AgentCapabilityEditorColumnProps) {
  const toneClasses =
    selectedTone === "cyan"
      ? {
          border: "border-cyan-300/20",
          chip: "border-cyan-300/15 bg-cyan-400/10 text-cyan-50",
          chipHover: "hover:border-cyan-200/30 hover:bg-cyan-400/15"
        }
      : {
          border: "border-amber-300/20",
          chip: "border-amber-300/15 bg-amber-400/10 text-amber-50",
          chipHover: "hover:border-amber-200/30 hover:bg-amber-400/15"
        };

  const hasLocked = lockedValues.length > 0;

  return (
    <div
      className={cn(
        "rounded-[18px] border bg-[linear-gradient(180deg,rgba(11,18,32,0.86),rgba(8,13,24,0.82))] p-3.5",
        toneClasses.border,
        highlight && "shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
      )}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{title}</p>
        <Badge variant="muted">Declared</Badge>
      </div>

      <div className="space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {selectedValues.length > 0 ? (
            selectedValues.map((value) => (
              <button
                key={value}
                type="button"
                className={cn(
                  "inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition-colors",
                  toneClasses.chip,
                  toneClasses.chipHover
                )}
                onClick={() => {
                  if (lockedValues.includes(value)) {
                    return;
                  }

                  onRemove(value);
                }}
                title={lockedValues.includes(value) ? `Locked by policy: ${value}` : `Remove ${value}`}
              >
                <span className="max-w-full truncate">{value}</span>
                {lockedValues.includes(value) ? (
                  <Lock className="h-3 w-3 text-white/70" />
                ) : (
                  <span className="text-white/70">×</span>
                )}
              </button>
            ))
          ) : (
            <Badge variant="muted">{selectedEmptyLabel}</Badge>
          )}
        </div>

        <div className="flex flex-wrap gap-2">
          <Input
            ref={inputRef}
            value={inputValue}
            onChange={(event) => onInputValueChange(event.target.value)}
            onKeyDown={(event) => handleCapabilityInputKeyDown(event, inputValue, onAddCustom, suggestions, onPick)}
            placeholder={title === "Skills" ? "Search OpenClaw or workspace skills" : "Search built-in tools or plugin tools"}
            className="h-8 flex-1 rounded-xl border-white/10 bg-white/5 px-3 text-[12px]"
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onAddCustom}
            disabled={!inputValue.trim()}
            className="h-8 rounded-xl px-3 text-[11px]"
          >
            <Plus className="mr-1 h-3.5 w-3.5" />
            {customActionLabel}
          </Button>
        </div>

        <div className="max-h-[160px] space-y-1.5 overflow-y-auto pr-1">
          <CapabilityOptionList
            kind={title === "Skills" ? "skill" : "tool"}
            options={suggestions}
            onPick={onPick}
            emptyLabel={emptySuggestionLabel}
          />
        </div>

        {hasLocked ? (
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Policy locked</p>
            <div className="flex flex-wrap gap-2">
              {lockedValues.map((value) => (
                <Badge key={value} variant="success">
                  <Lock className="mr-1 h-3 w-3" />
                  {value}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        {observedValues.length > 0 ? (
          <div>
            <p className="mb-2 text-[10px] uppercase tracking-[0.22em] text-slate-500">Observed</p>
            <div className="flex flex-wrap gap-2">
              {observedValues.slice(0, 10).map((value) => (
                <Badge key={value} variant="muted">
                  {value}
                </Badge>
              ))}
            </div>
          </div>
        ) : null}

        <p className="text-[11px] leading-5 text-slate-500">{helperLabel}</p>
        {catalogError ? <p className="text-[11px] leading-5 text-slate-500">{catalogError}</p> : null}
        {loading && suggestions.length === 0 ? (
          <p className="text-[11px] leading-5 text-slate-500">Loading OpenClaw catalog...</p>
        ) : null}
      </div>
    </div>
  );
}

function CapabilityOptionList({
  kind,
  options,
  onPick,
  emptyLabel
}: {
  kind: CapabilityOption["kind"];
  options: CapabilityOption[];
  onPick: (value: string) => void;
  emptyLabel: string;
}) {
  if (options.length === 0) {
    return <p className="text-[11px] leading-5 text-slate-500">{emptyLabel}</p>;
  }

  return (
    <div className="space-y-1.5">
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={cn(
            "group flex w-full items-start justify-between gap-3 rounded-xl border border-white/[0.08] bg-white/[0.03] px-3 py-1.5 text-left transition-colors hover:border-cyan-300/20 hover:bg-cyan-400/[0.05]",
            kind === "tool" && "hover:border-amber-300/20 hover:bg-amber-400/[0.05]"
          )}
          onClick={() => onPick(option.value)}
          title={option.description}
        >
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <p className="truncate text-[12px] leading-4 text-white">{option.label}</p>
              {option.category === "group" ? <Badge variant="muted">group</Badge> : null}
            </div>
            <p className="line-clamp-2 text-[11px] leading-4 text-slate-400">{option.description}</p>
          </div>
          <Badge variant={getCapabilityBadgeVariant(option)}>{option.sourceLabel}</Badge>
        </button>
      ))}
    </div>
  );
}

function getCapabilityBadgeVariant(option: CapabilityOption): BadgeProps["variant"] {
  if (option.kind === "skill") {
    if (option.category === "workspace") {
      return "success";
    }

    if (option.category === "custom") {
      return "muted";
    }

    return "default";
  }

  if (option.category === "plugin") {
    return "warning";
  }

  if (option.category === "group" || option.category === "custom") {
    return "muted";
  }

  return "default";
}

function handleCapabilityInputKeyDown(
  event: KeyboardEvent<HTMLInputElement>,
  inputValue: string,
  onAddCustom: () => void,
  suggestions: CapabilityOption[],
  onPick: (value: string) => void
) {
  if (event.key !== "Enter") {
    return;
  }

  event.preventDefault();
  const firstSuggestion = suggestions[0];

  if (firstSuggestion) {
    onPick(firstSuggestion.value);
    return;
  }

  if (inputValue.trim()) {
    onAddCustom();
  }
}
