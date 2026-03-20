"use client";

import { ArrowUp, LoaderCircle } from "lucide-react";
import { useEffect, useRef, type FormEvent, type KeyboardEvent, type ReactNode } from "react";

import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";

type WizardComposerProps = {
  surfaceTheme: SurfaceTheme;
  value: string;
  placeholder: string;
  onChange: (value: string) => void;
  onSubmit: () => void | Promise<void>;
  disabled?: boolean;
  isBusy?: boolean;
  helperText?: string;
  toolbar?: ReactNode;
  className?: string;
};

export function WizardComposer({
  surfaceTheme,
  value,
  placeholder,
  onChange,
  onSubmit,
  disabled = false,
  isBusy = false,
  helperText,
  toolbar,
  className
}: WizardComposerProps) {
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const canSubmit = Boolean(value.trim()) && !disabled;

  useEffect(() => {
    const textarea = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "0px";
    textarea.style.height = `${Math.min(textarea.scrollHeight, 200)}px`;
  }, [value]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    await onSubmit();
  };

  const handleKeyDown = async (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== "Enter" || event.shiftKey || event.nativeEvent.isComposing) {
      return;
    }

    event.preventDefault();

    if (!canSubmit) {
      return;
    }

    await onSubmit();
  };

  const isLight = surfaceTheme === "light";

  return (
    <form
      onSubmit={handleSubmit}
      className={cn(
        "rounded-[20px] border p-2.5 transition-all duration-200 focus-within:shadow-[0_0_0_1px_rgba(0,0,0,0.02)]",
        isLight
          ? "border-[#ddd6cb] bg-white shadow-[0_18px_56px_rgba(56,47,38,0.08)] focus-within:border-[#cfc6ba]"
          : "border-white/10 bg-[rgba(7,12,22,0.92)] shadow-[0_18px_56px_rgba(0,0,0,0.34)] focus-within:border-cyan-300/30",
        className
      )}
    >
      <textarea
        ref={textareaRef}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={placeholder}
        className={cn(
          "min-h-[44px] max-h-[200px] w-full resize-none overflow-y-auto border-0 bg-transparent px-1.5 py-1.5 text-[15px] leading-6 outline-none",
          isLight ? "text-[#191714] placeholder:text-[#9b948c]" : "text-slate-100 placeholder:text-slate-500"
        )}
      />

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div className="flex min-h-8 items-center gap-2">
          {toolbar}
          {helperText ? (
            <p className={cn("text-[11px]", isLight ? "text-[#8b837a]" : "text-slate-400")}>{helperText}</p>
          ) : null}
        </div>

        <button
          type="submit"
          disabled={!canSubmit}
          className={cn(
            "inline-flex size-8 items-center justify-center rounded-full transition-colors disabled:cursor-not-allowed",
            isLight
              ? "bg-[#161514] text-white hover:bg-[#26231f] disabled:bg-[#d5cec5] disabled:text-[#8d857c]"
              : "bg-cyan-300 text-slate-950 hover:bg-cyan-200 disabled:bg-white/[0.08] disabled:text-slate-500"
          )}
        >
          {isBusy ? <LoaderCircle className="h-3.5 w-3.5 animate-spin" /> : <ArrowUp className="h-3.5 w-3.5" />}
        </button>
      </div>
    </form>
  );
}
