"use client";

import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

type SuggestionChip = {
  id: string;
  label: string;
};

type WizardSuggestionChipsProps = {
  surfaceTheme: SurfaceTheme;
  chips: SuggestionChip[];
  onSelect: (chip: SuggestionChip) => void;
  disabled?: boolean;
  className?: string;
};

export function WizardSuggestionChips({
  surfaceTheme,
  chips,
  onSelect,
  disabled = false,
  className
}: WizardSuggestionChipsProps) {
  if (chips.length === 0) {
    return null;
  }

  const isLight = surfaceTheme === "light";

  return (
    <div className={cn("flex flex-wrap items-center gap-1.5", className)}>
      {chips.map((chip) => (
        <button
          key={chip.id}
          type="button"
          onClick={() => onSelect(chip)}
          disabled={disabled}
          className={cn(
            "inline-flex min-h-8 items-center rounded-full border px-3.5 py-1.5 text-left text-[11px] transition-colors disabled:cursor-not-allowed disabled:opacity-50",
            isLight
              ? "border-[#ddd7cf] bg-white text-[#4a443f] hover:border-[#cfc7bc] hover:bg-[#f3efe8]"
              : "border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/[0.08] hover:text-white"
          )}
        >
          {chip.label}
        </button>
      ))}
    </div>
  );
}
