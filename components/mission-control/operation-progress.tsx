"use client";

import { AlertTriangle, Check, LoaderCircle } from "lucide-react";

import type { OperationProgressSnapshot } from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";

type OperationProgressProps = {
  progress: OperationProgressSnapshot;
  className?: string;
};

export function OperationProgress({ progress, className }: OperationProgressProps) {
  return (
    <div className={cn("rounded-[18px] border border-white/10 bg-slate-950/50 p-4", className)}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-2xl">
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">{progress.title}</p>
          <p className="mt-2 text-sm text-slate-200">{progress.description}</p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-[10px] uppercase tracking-[0.22em] text-slate-500">Progress</p>
          <p className="mt-1 text-lg font-semibold text-white">{progress.percent}%</p>
        </div>
      </div>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-white/8">
        <div
          className="h-full rounded-full bg-cyan-300/85 transition-[width] duration-500 ease-out"
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <div className="mt-4 space-y-2.5">
        {progress.steps.map((step, index) => {
          const stepTone =
            step.status === "done"
              ? "border-emerald-400/20 bg-emerald-400/10"
              : step.status === "active"
                ? "border-cyan-400/25 bg-cyan-400/10"
                : step.status === "error"
                  ? "border-amber-400/25 bg-amber-400/10"
                  : "border-white/10 bg-white/[0.03]";
          const iconTone =
            step.status === "done"
              ? "border-emerald-300/30 bg-emerald-300/15 text-emerald-100"
              : step.status === "active"
                ? "border-cyan-300/30 bg-cyan-300/15 text-cyan-100"
                : step.status === "error"
                  ? "border-amber-300/30 bg-amber-300/15 text-amber-100"
                  : "border-white/10 bg-slate-950/65 text-slate-400";
          const barTone =
            step.status === "done"
              ? "bg-emerald-300/85"
              : step.status === "active"
                ? "bg-cyan-300/85"
                : step.status === "error"
                  ? "bg-amber-300/85"
                  : "bg-transparent";

          return (
            <div
              key={step.id}
              className={cn(
                "rounded-[14px] border px-3 py-2.5 transition-colors",
                stepTone
              )}
            >
              <div className="flex items-start gap-3">
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                    iconTone
                  )}
                >
                  {step.status === "done" ? (
                    <Check className="h-3.5 w-3.5" />
                  ) : step.status === "active" ? (
                    <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
                  ) : step.status === "error" ? (
                    <AlertTriangle className="h-3.5 w-3.5" />
                  ) : (
                    index + 1
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <p className="text-sm text-white">{step.label}</p>
                    <span className="text-xs tabular-nums text-slate-400">{step.percent}%</span>
                  </div>
                  <p className="mt-0.5 text-xs leading-5 text-slate-400">
                    {step.detail || step.description}
                  </p>

                  <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-white/8">
                    <div
                      className={cn("h-full rounded-full transition-[width] duration-500 ease-out", barTone)}
                      style={{ width: `${step.percent}%` }}
                    />
                  </div>

                  {step.activities.length > 0 ? (
                    <div className="mt-2.5 space-y-1.5">
                      {step.activities.map((activity) => (
                        <div
                          key={activity.id}
                          className="flex items-start gap-2 text-[11px] leading-5 text-slate-300"
                        >
                          <span
                            className={cn(
                              "mt-[7px] h-1.5 w-1.5 shrink-0 rounded-full",
                              activity.status === "done" && "bg-emerald-300",
                              activity.status === "active" && "bg-cyan-300",
                              activity.status === "error" && "bg-amber-300",
                              activity.status === "pending" && "bg-slate-500"
                            )}
                          />
                          <span className="min-w-0">{activity.message}</span>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </div>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
