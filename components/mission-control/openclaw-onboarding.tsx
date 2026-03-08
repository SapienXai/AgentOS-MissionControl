"use client";

import { ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { compactPath } from "@/lib/openclaw/presenters";
import type {
  MissionControlSnapshot,
  OpenClawOnboardingPhase
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type RunState = "idle" | "running" | "success" | "error";
type StepState = "complete" | "current" | "pending";

export function OpenClawOnboarding({
  snapshot,
  surfaceTheme,
  runState,
  phase,
  statusMessage,
  resultMessage,
  log,
  manualCommand,
  docsUrl,
  actionLabel,
  actionDescription,
  onPrimaryAction,
  onDismiss,
  canDismiss
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  runState: RunState;
  phase: OpenClawOnboardingPhase | null;
  statusMessage: string | null;
  resultMessage: string | null;
  log: string;
  manualCommand: string | null;
  docsUrl: string | null;
  actionLabel: string;
  actionDescription: string;
  onPrimaryAction: () => void;
  onDismiss: () => void;
  canDismiss: boolean;
}) {
  const steps = buildSteps(snapshot, phase);
  const statusCopy = statusMessage || resultMessage || actionDescription;
  const showDetails = runState !== "idle" || Boolean(manualCommand) || log.trim().length > 0;

  return (
    <motion.div
      initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
      animate={{ opacity: 1, backdropFilter: "blur(12px)" }}
      exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
      className={cn(
        "absolute inset-0 z-[80] pointer-events-auto flex items-center justify-center px-4 py-6",
        surfaceTheme === "light"
          ? "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.94),rgba(247,239,232,0.88)_46%,rgba(242,230,220,0.92))]"
          : "bg-[radial-gradient(circle_at_top,rgba(17,24,39,0.9),rgba(3,7,18,0.92)_48%,rgba(2,6,23,0.96))]"
      )}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className={cn(
          "w-full max-w-[520px] rounded-[24px] border p-4 shadow-[0_24px_72px_rgba(0,0,0,0.22)] backdrop-blur-2xl lg:p-5",
          surfaceTheme === "light"
            ? "border-[#dccabd]/90 bg-[rgba(255,250,246,0.9)] text-[#47362b] shadow-[0_22px_64px_rgba(161,125,101,0.16)]"
            : "border-white/10 bg-[rgba(6,10,18,0.84)] text-slate-100"
        )}
      >
        <div className="flex items-center justify-between gap-2.5">
          <span
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[9px] uppercase tracking-[0.22em]",
              surfaceTheme === "light"
                ? "border-[#d8c0b0] bg-[#f3e7dc] text-[#8d725f]"
                : "border-white/10 bg-white/[0.06] text-slate-300"
            )}
          >
            <Sparkles className="h-2.5 w-2.5" />
            Welcome
          </span>
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[9px] uppercase tracking-[0.2em]",
              runState === "error"
                ? surfaceTheme === "light"
                  ? "border-rose-300 bg-rose-50 text-rose-700"
                  : "border-rose-300/25 bg-rose-300/10 text-rose-200"
                : runState === "success"
                  ? surfaceTheme === "light"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                  : surfaceTheme === "light"
                    ? "border-[#d8c0b0] bg-white/80 text-[#8d725f]"
                    : "border-white/10 bg-white/[0.04] text-slate-400"
            )}
          >
            {runState === "running"
              ? "Running"
              : runState === "success"
                ? "Ready"
                : runState === "error"
                  ? "Needs attention"
                  : snapshot.diagnostics.installed
                    ? "Local machine"
                    : "First setup"}
          </span>
        </div>

        <div className="mt-4">
          <p
            className={cn(
              "text-[9px] uppercase tracking-[0.24em]",
              surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
            )}
          >
            OpenClaw Mission Control
          </p>
          <h1
            className={cn(
              "mt-1.5 font-display text-[1.55rem] leading-[1.75rem]",
              surfaceTheme === "light" ? "text-[#33251c]" : "text-white"
            )}
          >
            Bring your local OpenClaw online.
          </h1>
          <p
            className={cn(
              "mt-2.5 text-[13px] leading-[1.35rem]",
              surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-300"
            )}
          >
            Mission Control checks the CLI, gateway service, and live connection, then opens the
            app when OpenClaw is ready.
          </p>
        </div>

        <div className="mt-4.5 space-y-2">
          {steps.map((step, index) => (
            <div
              key={step.id}
              className={cn(
                "flex items-start gap-2.5 rounded-[16px] border px-3 py-2.5",
                stepContainerClassName(step.state, surfaceTheme)
              )}
            >
              <span
                className={cn(
                  "mt-0.5 inline-flex h-6 w-6 items-center justify-center rounded-full border text-[10px] font-medium",
                  stepIconClassName(step.state, surfaceTheme)
                )}
              >
                {step.state === "complete" ? <Check className="h-3 w-3" /> : index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2.5">
                  <p className={cn("text-[13px]", surfaceTheme === "light" ? "text-[#3e2f24]" : "text-white")}>
                    {step.label}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[8px] uppercase tracking-[0.18em]",
                      stepBadgeClassName(step.state, surfaceTheme)
                    )}
                  >
                    {step.state === "complete"
                      ? "Ready"
                      : step.state === "current"
                        ? "Active"
                        : "Pending"}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-0.5 text-[11px] leading-[1.05rem]",
                    surfaceTheme === "light" ? "text-[#7d6758]" : "text-slate-400"
                  )}
                >
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>

        <div
          className={cn(
            "mt-4 rounded-[18px] border px-3.5 py-2.5",
            surfaceTheme === "light"
              ? "border-[#e5d5c9] bg-[#fffaf6]"
              : "border-white/8 bg-white/[0.03]"
          )}
        >
          <p
            className={cn(
              "text-[9px] uppercase tracking-[0.2em]",
              surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
            )}
          >
            Current status
          </p>
          <p
            className={cn(
              "mt-1.5 text-[13px] leading-[1.35rem]",
              surfaceTheme === "light" ? "text-[#5f4b3e]" : "text-slate-300"
            )}
          >
            {statusCopy}
          </p>
          <div
            className={cn(
              "mt-2.5 border-t pt-2.5",
              surfaceTheme === "light" ? "border-[#ebddd2]" : "border-white/8"
            )}
          >
            <p
              className={cn(
                "text-[9px] uppercase tracking-[0.2em]",
                surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
              )}
            >
              Workspace root
            </p>
            <p
              className={cn(
                "mt-1.5 break-all font-mono text-[10px] leading-[1rem]",
                surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
              )}
            >
              {compactPath(snapshot.diagnostics.workspaceRoot)}
            </p>
          </div>
        </div>

        {showDetails ? (
          <div
            className={cn(
              "mt-3.5 rounded-[18px] border",
              surfaceTheme === "light"
                ? "border-[#e5d5c9] bg-[#fffaf6]"
                : "border-white/8 bg-[rgba(255,255,255,0.02)]"
            )}
          >
            <div
              className={cn(
                "flex items-center justify-between border-b px-3.5 py-2.5",
                surfaceTheme === "light" ? "border-[#ebddd2]" : "border-white/8"
              )}
            >
              <p
                className={cn(
                  "text-[9px] uppercase tracking-[0.2em]",
                  surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
                )}
              >
                Setup log
              </p>
              <span
                className={
                  surfaceTheme === "light" ? "text-[11px] text-[#8c7362]" : "text-[11px] text-slate-400"
                }
              >
                {phase ? phase.replace("-", " ") : "waiting"}
              </span>
            </div>
            <pre
              className={cn(
                "max-h-[156px] min-h-[92px] overflow-auto whitespace-pre-wrap break-words px-3.5 py-3 font-mono text-[10px] leading-[1rem]",
                surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
              )}
            >
              {log ||
                "No command output yet.\n\nStart the flow and Mission Control will stream each setup step here."}
            </pre>
            {manualCommand ? (
              <div
                className={cn(
                  "border-t px-3.5 py-2.5",
                  surfaceTheme === "light" ? "border-[#ebddd2]" : "border-white/8"
                )}
              >
                <p
                  className={cn(
                    "text-[9px] uppercase tracking-[0.2em]",
                    surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
                  )}
                >
                  Manual fallback
                </p>
                <p
                  className={cn(
                    "mt-1.5 break-all font-mono text-[10px] leading-[1rem]",
                    surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                  )}
                >
                  {manualCommand}
                </p>
                {docsUrl ? (
                  <a
                    href={docsUrl}
                    target="_blank"
                    rel="noreferrer"
                    className={cn(
                      "mt-2.5 inline-flex items-center gap-1 text-[10px] underline underline-offset-4",
                      surfaceTheme === "light" ? "text-[#7f6554]" : "text-slate-300"
                    )}
                  >
                    Installation docs
                    <ArrowRight className="h-2.5 w-2.5" />
                  </a>
                ) : null}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-4 flex flex-wrap items-center justify-between gap-2.5">
          {canDismiss ? (
            <button
              type="button"
              onClick={onDismiss}
              className={cn(
                "text-[10px] uppercase tracking-[0.18em] transition-colors",
                surfaceTheme === "light" ? "text-[#8f7664] hover:text-[#6f5949]" : "text-slate-500 hover:text-slate-300"
              )}
            >
              Open demo surface
            </button>
          ) : (
            <span />
          )}

          <Button
            type="button"
            onClick={onPrimaryAction}
            disabled={runState === "running"}
            className={cn(
              "h-10 min-w-[176px] rounded-full px-4 text-[13px]",
              surfaceTheme === "light"
                ? "bg-[#c8946f] text-white shadow-[0_14px_34px_rgba(200,148,111,0.24)] hover:bg-[#b88461]"
                : "bg-white text-slate-950 hover:bg-white/92"
            )}
          >
            {runState === "running" ? (
              <>
                <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                Working...
              </>
            ) : (
              <>
                {actionLabel}
                <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
              </>
            )}
          </Button>
        </div>
      </motion.div>
    </motion.div>
  );
}

function buildSteps(snapshot: MissionControlSnapshot, phase: OpenClawOnboardingPhase | null) {
  const cliComplete =
    snapshot.diagnostics.installed ||
    phase === "installing-gateway" ||
    phase === "starting-gateway" ||
    phase === "verifying" ||
    phase === "ready";
  const gatewayComplete =
    snapshot.diagnostics.loaded || phase === "starting-gateway" || phase === "verifying" || phase === "ready";
  const liveComplete = snapshot.diagnostics.rpcOk || phase === "ready";

  return [
    {
      id: "cli",
      label: "OpenClaw CLI",
      description: snapshot.diagnostics.installed
        ? `Installed${snapshot.diagnostics.version ? ` · v${snapshot.diagnostics.version}` : ""}`
        : "Install the OpenClaw CLI on this machine.",
      state: resolveStepState(cliComplete, !cliComplete && (phase === "detecting" || phase === "installing-cli"))
    },
    {
      id: "gateway",
      label: "Gateway service",
      description: snapshot.diagnostics.loaded
        ? "The local gateway service is already registered on this machine."
        : "Register the local gateway service once so Mission Control can start it reliably.",
      state: resolveStepState(
        gatewayComplete,
        !gatewayComplete && (phase === "installing-gateway" || (cliComplete && phase === "detecting"))
      )
    },
    {
      id: "runtime",
      label: "Live connection",
      description: snapshot.diagnostics.rpcOk
        ? "Mission Control is connected to a live OpenClaw gateway."
        : "Start the gateway and wait for RPC health to turn online.",
      state: resolveStepState(
        liveComplete,
        !liveComplete &&
          (phase === "starting-gateway" || phase === "verifying" || (gatewayComplete && phase === "detecting"))
      )
    }
  ] as Array<{ id: string; label: string; description: string; state: StepState }>;
}

function resolveStepState(complete: boolean, current: boolean): StepState {
  if (complete) {
    return "complete";
  }

  if (current) {
    return "current";
  }

  return "pending";
}

function stepContainerClassName(state: StepState, surfaceTheme: SurfaceTheme) {
  if (state === "complete") {
    return surfaceTheme === "light"
      ? "border-emerald-200 bg-emerald-50/60"
      : "border-emerald-400/20 bg-emerald-400/8";
  }

  if (state === "current") {
    return surfaceTheme === "light"
      ? "border-[#d9c2b3] bg-white/70"
      : "border-white/12 bg-white/[0.05]";
  }

  return surfaceTheme === "light"
    ? "border-[#eadcd0] bg-[#fffaf6]/80"
    : "border-white/6 bg-white/[0.02]";
}

function stepIconClassName(state: StepState, surfaceTheme: SurfaceTheme) {
  if (state === "complete") {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-emerald-100 text-emerald-700"
      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  }

  if (state === "current") {
    return surfaceTheme === "light"
      ? "border-[#d5b9a5] bg-[#f5ebe3] text-[#8b6d5a]"
      : "border-white/12 bg-white/[0.06] text-white";
  }

  return surfaceTheme === "light"
    ? "border-[#e1ccc0] bg-white text-[#9a7f6c]"
    : "border-white/8 bg-white/[0.03] text-slate-400";
}

function stepBadgeClassName(state: StepState, surfaceTheme: SurfaceTheme) {
  if (state === "complete") {
    return surfaceTheme === "light" ? "bg-emerald-100 text-emerald-700" : "bg-emerald-300/10 text-emerald-200";
  }

  if (state === "current") {
    return surfaceTheme === "light" ? "bg-[#efe1d4] text-[#876c5a]" : "bg-white/[0.06] text-slate-300";
  }

  return surfaceTheme === "light" ? "bg-[#f6ece4] text-[#a08471]" : "bg-white/[0.04] text-slate-500";
}
