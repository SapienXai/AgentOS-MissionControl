"use client";

import { AlertTriangle, ArrowRight, Check, Copy, LoaderCircle, Route, SquareTerminal } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import type { AddModelsProviderId, MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { OpenClawModelOnboardingPhase, OperationProgressSnapshot } from "@/lib/agentos/contracts";
import {
  secondaryActionClassName,
  stepBadgeClassName,
  stepContainerClassName,
  stepIconClassName,
  resolveSelectedModelLabel,
  type StageRunDetails,
  type SurfaceTheme,
  type StepState
} from "@/components/mission-control/openclaw-onboarding.utils";
import { OpenClawOnboardingProviderFlow } from "@/components/mission-control/openclaw-onboarding-provider-flow";
import { formatModelLabel } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";

export type ModelSwitchFeedback = {
  phase: "idle" | "saving" | "success" | "error";
  previousModelId: string | null;
  nextModelId: string | null;
  message: string | null;
};

export function SystemStage({
  steps,
  surfaceTheme,
  statusCopy,
  showDetails,
  phaseLabel,
  run
}: {
  steps: Array<{ id: string; label: string; description: string; state: StepState }>;
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
  run: StageRunDetails;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <>
      <div className="mt-3">
        <p
          className={cn(
            "text-[7px] uppercase tracking-[0.18em]",
            surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
          )}
        >
          Step 1
        </p>
        <h2 className={cn("mt-1 text-[13px] font-medium", surfaceTheme === "light" ? "text-[#33251c]" : "text-white")}>
          System setup
        </h2>
        <p
          className={cn(
            "mt-1 text-[10px] leading-[0.95rem]",
            surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400"
          )}
        >
          Install the CLI, start the gateway, and verify RPC.
        </p>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {steps.map((step, index) => {
          const isCurrentRunning = step.state === "current" && run.runState === "running";
          const isRuntimeStep = step.id === "runtime";

          return (
            <div
              key={step.id}
              className={cn(
                "relative flex items-center gap-1.5 overflow-hidden rounded-[12px] border px-2 py-1.5",
                isCurrentRunning
                  ? surfaceTheme === "light"
                    ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_0_1px_rgba(215,178,154,0.18)]"
                    : "shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_rgba(103,232,249,0.08)]"
                  : "",
                stepContainerClassName(step.state, surfaceTheme)
              )}
            >
              {isCurrentRunning ? (
                <>
                  <motion.div
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-y-0 left-0 w-1/3 blur-[1px]",
                      surfaceTheme === "light"
                        ? "bg-gradient-to-r from-transparent via-[#d9b08d]/26 to-transparent"
                        : "bg-gradient-to-r from-transparent via-cyan-200/12 to-transparent"
                    )}
                    animate={{ x: ["-30%", isRuntimeStep ? "250%" : "230%"] }}
                    transition={{
                      duration: isRuntimeStep ? 1.45 : 2.05,
                      repeat: Infinity,
                      ease: "linear"
                    }}
                  />
                  <motion.div
                    aria-hidden="true"
                    className={cn(
                      "pointer-events-none absolute inset-x-2 bottom-0 h-px rounded-full",
                      surfaceTheme === "light"
                        ? "bg-gradient-to-r from-transparent via-[#c99672] to-transparent"
                        : "bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent"
                    )}
                    animate={{ opacity: [0.28, 0.92, 0.28], scaleX: [0.86, 1, 0.86] }}
                    transition={{
                      duration: isRuntimeStep ? 1.2 : 1.65,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                  />
                </>
              ) : null}
              <span
                className={cn(
                  "relative mt-0.5 inline-flex h-5 w-5 items-center justify-center overflow-hidden rounded-full border text-[9px] font-medium",
                  stepIconClassName(step.state, surfaceTheme)
                )}
              >
                {isCurrentRunning ? (
                  <motion.span
                    aria-hidden="true"
                    className={cn(
                      "absolute inset-0 rounded-full border",
                      surfaceTheme === "light"
                        ? "border-[#d9b59a]/35 bg-[#f7eee7]/80"
                        : "border-cyan-200/16 bg-cyan-300/[0.06]"
                    )}
                    animate={{ scale: [1, 1.16, 1], opacity: [0.45, 0.95, 0.45] }}
                    transition={{
                      duration: isRuntimeStep ? 1.5 : 1.9,
                      repeat: Infinity,
                      ease: "easeInOut"
                    }}
                  />
                ) : null}
                <span className="relative z-[1]">
                  {step.state === "complete" ? (
                    <Check className="h-2.5 w-2.5" />
                  ) : isCurrentRunning ? (
                    <LoaderCircle className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    index + 1
                  )}
                </span>
              </span>
              <div className="relative z-[1] min-w-0 flex-1">
                <div className="flex items-center justify-between gap-1.5">
                  <p className={cn("text-[11px]", surfaceTheme === "light" ? "text-[#3e2f24]" : "text-white")}>
                    {step.label}
                  </p>
                  <span
                    className={cn(
                      "rounded-full px-1.5 py-0.5 text-[6px] uppercase tracking-[0.14em]",
                      stepBadgeClassName(step.state, surfaceTheme)
                    )}
                  >
                    {step.state === "complete" ? "Ready" : step.state === "current" ? (isCurrentRunning ? "Working" : "Active") : "Pending"}
                  </span>
                </div>
                <p
                  className={cn(
                    "mt-0.5 text-[8px] leading-[0.82rem]",
                    surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
                  )}
                >
                  {step.description}
                </p>
              </div>
            </div>
          );
        })}
      </div>

      <StageConsole
        surfaceTheme={surfaceTheme}
        statusCopy={statusCopy}
        showDetails={showDetails}
        phaseLabel={phaseLabel}
        detailsOpen={detailsOpen}
        onDetailsOpenChange={setDetailsOpen}
        run={run}
      />
    </>
  );
}

export function ModelStage({
  snapshot,
  surfaceTheme,
  statusCopy,
  showDetails,
  phaseLabel,
  run,
  modelPhase,
  selectedModelId,
  modelSwitchFeedback,
  onSelectedModelIdChange,
  onClearModelSwitchFeedback,
  onOpenAddModels
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
  run: StageRunDetails;
  modelPhase: OpenClawModelOnboardingPhase | null;
  selectedModelId: string;
  modelSwitchFeedback: ModelSwitchFeedback;
  onSelectedModelIdChange: (value: string) => void;
  onClearModelSwitchFeedback: () => void;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(true);
  const availableModels = useMemo(
    () => snapshot.models.filter((model) => model.available !== false && !model.missing),
    [snapshot.models]
  );
  const selectedModelLabel = useMemo(
    () => resolveSelectedModelLabel(selectedModelId, availableModels),
    [availableModels, selectedModelId]
  );
  const defaultModelId =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    null;
  const defaultModelLabel = resolveModelDisplayLabel(defaultModelId, availableModels);
  const switchTargetLabel = resolveModelDisplayLabel(selectedModelId, availableModels);
  const hasPendingModelSwitch = Boolean(
    selectedModelId.trim() && selectedModelId.trim() !== (defaultModelId?.trim() ?? "")
  );
  const buildScene = useMemo(
    () =>
      resolveWorkspaceBuildScene({
        statusCopy,
        run,
        selectedModelLabel,
        phase: modelPhase
      }),
    [modelPhase, run, selectedModelLabel, statusCopy]
  );

  return (
    <>
      <div className="mt-3">
        <p className={cn("text-[11px] font-medium", surfaceTheme === "light" ? "text-[#33251c]" : "text-white")}>
          Step 2: Model setup
        </p>
      </div>

      {buildScene ? (
        <WorkspaceBuildScene
          surfaceTheme={surfaceTheme}
          statusCopy={statusCopy}
          phaseLabel={phaseLabel}
          buildScene={buildScene}
        />
      ) : modelSwitchFeedback.phase !== "idle" ? (
        <>
          <ModelSwitchScene
            surfaceTheme={surfaceTheme}
            feedback={modelSwitchFeedback}
            defaultModelLabel={resolveModelDisplayLabel(modelSwitchFeedback.previousModelId, availableModels)}
            nextModelLabel={resolveModelDisplayLabel(modelSwitchFeedback.nextModelId, availableModels)}
            onChangeAgain={onClearModelSwitchFeedback}
          />

          <StageConsole
            surfaceTheme={surfaceTheme}
            statusCopy={statusCopy}
            showDetails={showDetails}
            phaseLabel={phaseLabel}
            detailsOpen={detailsOpen}
            onDetailsOpenChange={setDetailsOpen}
            run={run}
          />
        </>
      ) : (
        <>
          <ModelDefaultSummary
            surfaceTheme={surfaceTheme}
            defaultModelLabel={defaultModelLabel}
            switchTargetLabel={switchTargetLabel}
            hasPendingModelSwitch={hasPendingModelSwitch}
          />

          <OpenClawOnboardingProviderFlow
            snapshot={snapshot}
            selectedModelId={selectedModelId}
            onSelectedModelIdChange={onSelectedModelIdChange}
            onOpenAddModels={onOpenAddModels}
          />

          <StageConsole
            surfaceTheme={surfaceTheme}
            statusCopy={statusCopy}
            showDetails={showDetails}
            phaseLabel={phaseLabel}
            detailsOpen={detailsOpen}
            onDetailsOpenChange={setDetailsOpen}
            run={run}
          />
        </>
      )}
    </>
  );
}

function ModelDefaultSummary({
  surfaceTheme,
  defaultModelLabel,
  switchTargetLabel,
  hasPendingModelSwitch
}: {
  surfaceTheme: SurfaceTheme;
  defaultModelLabel: string | null;
  switchTargetLabel: string | null;
  hasPendingModelSwitch: boolean;
}) {
  return (
    <div
      className={cn(
        "mt-2 rounded-[14px] border px-2.5 py-2",
        surfaceTheme === "light"
          ? "border-[#e8d8ca] bg-[#fffaf6]"
          : "border-white/8 bg-white/[0.03]"
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0">
          <p
            className={cn(
              "text-[7px] uppercase tracking-[0.16em]",
              surfaceTheme === "light" ? "text-[#9a7a65]" : "text-slate-500"
            )}
          >
            Detected default
          </p>
          <p className={cn("mt-1 truncate text-[10px]", surfaceTheme === "light" ? "text-[#3e2f24]" : "text-white")}>
            {defaultModelLabel ?? "Not set"}
          </p>
        </div>

        {hasPendingModelSwitch ? (
          <div className="min-w-0 text-right">
            <p
              className={cn(
                "text-[7px] uppercase tracking-[0.16em]",
                surfaceTheme === "light" ? "text-[#9a7a65]" : "text-slate-500"
              )}
            >
              Switch to
            </p>
            <p className={cn("mt-1 truncate text-[10px]", surfaceTheme === "light" ? "text-[#7a4d2d]" : "text-cyan-100")}>
              {switchTargetLabel}
            </p>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function ModelSwitchScene({
  surfaceTheme,
  feedback,
  defaultModelLabel,
  nextModelLabel,
  onChangeAgain
}: {
  surfaceTheme: SurfaceTheme;
  feedback: ModelSwitchFeedback;
  defaultModelLabel: string | null;
  nextModelLabel: string | null;
  onChangeAgain: () => void;
}) {
  const isLight = surfaceTheme === "light";
  const isRunning = feedback.phase === "saving";
  const isSuccess = feedback.phase === "success";
  const isError = feedback.phase === "error";
  const title = isSuccess
    ? "Default model updated"
    : isError
      ? "Default model could not be changed"
      : "Switching default model";
  const detail = feedback.message ||
    (isSuccess
      ? "AgentOS will use this route for new actions."
      : isError
        ? "Review the log below, then try again."
        : "Saving the route, refreshing OpenClaw config, and updating AgentOS.");
  const steps = [
    "Saving model route",
    "Refreshing OpenClaw config",
    "Verifying selected provider",
    "Updating AgentOS snapshot"
  ];

  return (
    <div
      className={cn(
        "mt-3 overflow-hidden rounded-[22px] border",
        isLight
          ? "border-[#e1d0c2] bg-[linear-gradient(180deg,rgba(255,250,246,0.98),rgba(248,240,232,0.98))]"
          : "border-cyan-300/16 bg-[radial-gradient(circle_at_top,rgba(16,28,44,0.98),rgba(6,10,18,0.98)_72%)]"
      )}
    >
      <div className="relative isolate min-h-[300px] overflow-hidden px-4 py-4 text-center">
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-0",
            isLight
              ? "bg-[radial-gradient(circle_at_50%_0%,rgba(232,186,151,0.22),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.4),transparent_48%)]"
              : "bg-[radial-gradient(circle_at_50%_0%,rgba(34,211,238,0.18),transparent_34%),linear-gradient(135deg,rgba(255,255,255,0.04),transparent_48%)]"
          )}
        />

        <div className="relative z-[1] flex flex-col items-center">
          <div className="relative flex h-20 w-20 items-center justify-center">
            {isRunning ? (
              <>
                <motion.div
                  aria-hidden="true"
                  className={cn("absolute h-20 w-20 rounded-full border", isLight ? "border-[#d1a98b]" : "border-cyan-200/24")}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 8, repeat: Infinity, ease: "linear" }}
                />
                <motion.div
                  aria-hidden="true"
                  className={cn("absolute h-14 w-14 rounded-full border border-dashed", isLight ? "border-[#c8946f]" : "border-cyan-200/40")}
                  animate={{ rotate: -360 }}
                  transition={{ duration: 6, repeat: Infinity, ease: "linear" }}
                />
              </>
            ) : null}
            <span
              className={cn(
                "relative z-[1] inline-flex h-12 w-12 items-center justify-center rounded-full border",
                isSuccess
                  ? isLight
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                  : isError
                    ? isLight
                      ? "border-rose-300 bg-rose-50 text-rose-700"
                      : "border-rose-300/25 bg-rose-300/10 text-rose-200"
                    : isLight
                      ? "border-[#d7b59a] bg-white text-[#9a6a48]"
                      : "border-cyan-300/20 bg-cyan-300/10 text-cyan-100"
              )}
            >
              {isSuccess ? <Check className="h-5 w-5" /> : isRunning ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Route className="h-5 w-5" />}
            </span>
          </div>

          <p
            className={cn(
              "mt-3 text-[8px] uppercase tracking-[0.22em]",
              isLight ? "text-[#94735e]" : "text-cyan-200/70"
            )}
          >
            Model route
          </p>
          <h3 className={cn("mt-1 text-[17px] font-medium tracking-[-0.03em]", isLight ? "text-[#2d2118]" : "text-white")}>
            {title}
          </h3>
          <p className={cn("mt-1 max-w-[320px] text-[10px] leading-[1rem]", isLight ? "text-[#6d5647]" : "text-slate-300")}>
            {detail}
          </p>

          <div
            className={cn(
              "mt-4 grid w-full gap-2 rounded-[16px] border px-3 py-3 text-left",
              isLight ? "border-[#ead8c8] bg-white/70" : "border-white/8 bg-white/[0.04]"
            )}
          >
            <ModelSwitchLine label="Previous" value={defaultModelLabel ?? "Not set"} surfaceTheme={surfaceTheme} muted />
            <ModelSwitchLine label="New default" value={nextModelLabel ?? "Not selected"} surfaceTheme={surfaceTheme} />
          </div>

          {isRunning ? (
            <div className="mt-4 grid w-full gap-1.5 text-left">
              {steps.map((step, index) => (
                <div
                  key={step}
                  className={cn(
                    "flex items-center gap-2 rounded-[12px] border px-2.5 py-2",
                    isLight ? "border-[#ead8c8] bg-white/55" : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <span
                    className={cn(
                      "inline-flex h-4 w-4 items-center justify-center rounded-full border text-[8px]",
                      index === 0
                        ? isLight
                          ? "border-[#c8946f] bg-[#f8eadf] text-[#8c5d3d]"
                          : "border-cyan-300/30 bg-cyan-300/10 text-cyan-100"
                        : isLight
                          ? "border-[#e0cec0] bg-white text-[#9a7f6c]"
                          : "border-white/10 bg-white/[0.03] text-slate-500"
                    )}
                  >
                    {index + 1}
                  </span>
                  <p className={cn("text-[10px]", isLight ? "text-[#5f4b3e]" : "text-slate-300")}>{step}</p>
                </div>
              ))}
            </div>
          ) : null}

          {!isRunning ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onChangeAgain}
              className={cn("mt-4 h-8 rounded-full px-3 text-[10px]", secondaryActionClassName(surfaceTheme))}
            >
              Change again
            </Button>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function ModelSwitchLine({
  label,
  value,
  surfaceTheme,
  muted = false
}: {
  label: string;
  value: string;
  surfaceTheme: SurfaceTheme;
  muted?: boolean;
}) {
  return (
    <div className="flex items-center justify-between gap-3">
      <span
        className={cn(
          "text-[7px] uppercase tracking-[0.16em]",
          surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "min-w-0 truncate text-right text-[10px]",
          muted
            ? surfaceTheme === "light"
              ? "text-[#8a7261]"
              : "text-slate-400"
            : surfaceTheme === "light"
              ? "text-[#3e2f24]"
              : "text-white"
        )}
      >
        {value}
      </span>
    </div>
  );
}

function resolveModelDisplayLabel(
  modelId: string | null | undefined,
  availableModels: Array<{ id: string; name: string; provider: string }>
) {
  if (!modelId?.trim()) {
    return null;
  }

  return resolveSelectedModelLabel(modelId, availableModels) ?? formatModelLabel(modelId);
}

export function LaunchpadStage({
  surfaceTheme,
  workspaceCount,
  defaultModelLabel,
  createProgress,
  createRunState
}: {
  surfaceTheme: SurfaceTheme;
  workspaceCount: number;
  defaultModelLabel: string;
  createProgress: OperationProgressSnapshot | null;
  createRunState: "idle" | "running" | "success" | "error";
}) {
  const hasWorkspaces = workspaceCount > 0;
  const isBuildingWorkspace = createRunState === "running" && Boolean(createProgress);
  const hasWorkspaceCreateError = createRunState === "error" && Boolean(createProgress);
  const showBuildScene = Boolean(createProgress) && (isBuildingWorkspace || hasWorkspaceCreateError);
  const launchSummary = hasWorkspaces
    ? `You already have ${workspaceCount} workspace${workspaceCount === 1 ? "" : "s"} online. Use AgentOS to inspect them or create another workspace for a new mission.`
    : isBuildingWorkspace
      ? "AgentOS Workspace is being provisioned now. The scaffold and starter agent are being built in the background."
      : hasWorkspaceCreateError
        ? "The first workspace creation needs attention. Review the output, then try again."
        : "No workspace exists yet. Create one first so the live system has a place to keep context and deliverables.";
  const modelMetricLabel = hasWorkspaces ? "Default model" : "Detected default";
  const modelMetricDetail = hasWorkspaces
    ? "Usable model route selected"
    : "Detected on this machine, not yet confirmed by a workspace.";

  return (
    <>
      <div
        className={cn(
          "mt-3 rounded-[16px] border px-3 py-3",
          surfaceTheme === "light"
            ? "border-emerald-200/80 bg-[linear-gradient(180deg,rgba(240,250,245,0.95),rgba(248,244,236,0.95))]"
            : "border-emerald-300/15 bg-[linear-gradient(180deg,rgba(9,18,19,0.96),rgba(7,11,18,0.94))]"
        )}
      >
        <div className="flex items-start gap-2.5">
          <span
            className={cn(
              "mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-full border",
              surfaceTheme === "light"
                ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                : "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
            )}
          >
            <Check className="h-3.5 w-3.5" />
          </span>
          <div className="min-w-0">
            <p
              className={cn(
                "text-[7px] uppercase tracking-[0.18em]",
                surfaceTheme === "light" ? "text-emerald-700/75" : "text-emerald-200/75"
              )}
            >
              Launchpad
            </p>
            <h2
              className={cn(
                "mt-1 text-[13px] font-medium",
                surfaceTheme === "light" ? "text-[#2d2118]" : "text-white"
              )}
            >
              OpenClaw is ready.
            </h2>
            <p
              className={cn(
                "mt-1 text-[10px] leading-[0.95rem]",
                surfaceTheme === "light" ? "text-[#5f4b3e]" : "text-slate-300"
              )}
            >
              {launchSummary}
            </p>
          </div>
        </div>

        {!showBuildScene ? (
          <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
            <LaunchpadMetric
              surfaceTheme={surfaceTheme}
              label="System"
              value="Online"
              detail="CLI, gateway, and runtime access verified"
            />
            <LaunchpadMetric
              surfaceTheme={surfaceTheme}
              label={modelMetricLabel}
              value={defaultModelLabel}
              detail={modelMetricDetail}
            />
            <LaunchpadMetric
              surfaceTheme={surfaceTheme}
              label="Runtime"
              value="Smoke test passed"
              detail="A live agent turn was verified"
            />
            <LaunchpadMetric
              surfaceTheme={surfaceTheme}
              label="Workspaces"
              value={String(workspaceCount)}
              detail={hasWorkspaces ? "Ready for mission planning" : "Create one to begin"}
            />
          </div>
        ) : null}
      </div>

      {showBuildScene ? (
        <LaunchpadBuildScene surfaceTheme={surfaceTheme} progress={createProgress!} runState={createRunState} />
      ) : (
        <div
          className={cn(
            "mt-2.5 rounded-[12px] border px-2.5 py-2",
            surfaceTheme === "light" ? "border-[#e5d5c9] bg-[#fffaf6]" : "border-white/8 bg-[rgba(255,255,255,0.02)]"
          )}
        >
          <p
            className={cn(
              "text-[7px] uppercase tracking-[0.16em]",
              surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
            )}
          >
            Next step
          </p>
          <p
            className={cn(
              "mt-1 text-[11px] leading-[1rem]",
              surfaceTheme === "light" ? "text-[#5f4b3e]" : "text-slate-300"
            )}
          >
            {hasWorkspaces
              ? "Open AgentOS to inspect the live graph, or create another workspace if you want a separate mission lane."
              : "Create the first workspace now. That is the shortest path from a ready system to a real mission."}
          </p>
        </div>
      )}
    </>
  );
}

function LaunchpadBuildScene({
  surfaceTheme,
  progress,
  runState
}: {
  surfaceTheme: SurfaceTheme;
  progress: OperationProgressSnapshot;
  runState: "idle" | "running" | "success" | "error";
}) {
  const isLight = surfaceTheme === "light";
  const activeStep = progress.steps.find((step) => step.status === "active") ?? progress.steps[0] ?? null;
  const isError = runState === "error";

  return (
    <div
      className={cn(
        "relative mt-2.5 overflow-hidden rounded-[18px] border px-2.5 py-2.5",
        isLight
          ? isError
            ? "border-rose-200 bg-[linear-gradient(180deg,rgba(255,248,247,0.98),rgba(252,242,242,0.96))]"
            : "border-[#dcc7b8] bg-[linear-gradient(180deg,rgba(255,251,248,0.98),rgba(249,243,236,0.96))]"
          : isError
            ? "border-rose-300/18 bg-[radial-gradient(circle_at_top,rgba(49,18,24,0.95),rgba(12,8,14,0.98)_72%)]"
            : "border-cyan-300/16 bg-[radial-gradient(circle_at_top,rgba(11,21,34,0.98),rgba(5,10,18,0.98)_72%)]"
      )}
    >
      <div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute inset-0",
          isLight
            ? "bg-[radial-gradient(circle_at_20%_0%,rgba(255,255,255,0.95),transparent_28%),radial-gradient(circle_at_84%_18%,rgba(201,148,111,0.14),transparent_22%)]"
            : isError
              ? "bg-[radial-gradient(circle_at_20%_0%,rgba(251,113,133,0.14),transparent_26%),radial-gradient(circle_at_84%_18%,rgba(248,113,113,0.08),transparent_22%)]"
              : "bg-[radial-gradient(circle_at_20%_0%,rgba(34,211,238,0.12),transparent_26%),radial-gradient(circle_at_84%_18%,rgba(59,130,246,0.08),transparent_22%)]"
        )}
      />
      <motion.div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -left-8 top-5 h-24 w-24 rounded-full blur-3xl",
          isLight ? "bg-[#efc6a8]/20" : isError ? "bg-rose-300/10" : "bg-cyan-300/10"
        )}
        animate={{ x: [0, 10, 0], y: [0, -6, 0], opacity: [0.45, 0.75, 0.45] }}
        transition={{ duration: 7.5, repeat: Infinity, ease: "easeInOut" }}
      />
      <motion.div
        aria-hidden="true"
        className={cn(
          "pointer-events-none absolute -right-4 top-8 h-28 w-28 rounded-full blur-3xl",
          isLight ? "bg-[#f6d9c2]/18" : isError ? "bg-rose-300/8" : "bg-sky-300/8"
        )}
        animate={{ x: [0, -12, 0], y: [0, 8, 0], opacity: [0.35, 0.7, 0.35] }}
        transition={{ duration: 9.5, repeat: Infinity, ease: "easeInOut" }}
      />

      <div className="relative z-[1] flex items-start justify-between gap-2">
        <div className="flex min-w-0 items-start gap-2">
          <motion.div
            className={cn(
              "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
              isLight
                ? isError
                  ? "border-rose-300 bg-white text-rose-700"
                  : "border-[#d9b59a] bg-white text-[#8b6d5a]"
                : isError
                  ? "border-rose-300/25 bg-rose-300/10 text-rose-100"
                  : "border-cyan-200/20 bg-cyan-300/10 text-cyan-100"
            )}
            animate={{ scale: [1, 1.06, 1], opacity: [0.82, 1, 0.82] }}
            transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
          >
            {isError ? <AlertTriangle className="h-3.5 w-3.5" /> : <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          </motion.div>

          <div className="min-w-0">
            <p
              className={cn(
                "text-[7px] uppercase tracking-[0.18em]",
                isLight ? (isError ? "text-rose-600/75" : "text-[#977b69]") : isError ? "text-rose-200/75" : "text-cyan-200/70"
              )}
            >
              {isError ? "Needs attention" : "Building"}
            </p>
            <h3
              className={cn(
                "mt-1 text-[13px] font-medium",
                isLight ? (isError ? "text-rose-950" : "text-[#281d17]") : isError ? "text-rose-50" : "text-white"
              )}
            >
              {isError ? "Workspace creation needs attention" : progress.title}
            </h3>
            <p
              className={cn(
                "mt-1 text-[10px] leading-[0.95rem]",
                isLight ? (isError ? "text-rose-700" : "text-[#6f5a4c]") : isError ? "text-rose-100/80" : "text-slate-300"
              )}
            >
              {isError
                ? "Review the captured output and retry when the workspace state is clean."
                : progress.description}
            </p>
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1">
          <span
            className={cn(
              "rounded-full border px-2 py-0.5 text-[8px] uppercase tracking-[0.16em]",
              isLight
                ? isError
                  ? "border-rose-200 bg-white text-rose-700"
                  : "border-[#dcc7b8] bg-white/75 text-[#8b6f5c]"
                : isError
                  ? "border-rose-300/20 bg-rose-300/8 text-rose-100"
                  : "border-cyan-300/16 bg-cyan-300/10 text-cyan-100"
            )}
          >
            {isError ? "Error" : `${progress.percent}%`}
          </span>
          {activeStep ? (
            <span
              className={cn(
                "max-w-[140px] truncate rounded-full border px-2 py-0.5 text-[7px] uppercase tracking-[0.14em]",
                isLight
                  ? isError
                    ? "border-rose-200 bg-white text-rose-700"
                    : "border-[#e9d7ca] bg-white text-[#8b6f5c]"
                  : isError
                    ? "border-rose-300/18 bg-rose-300/8 text-rose-100"
                    : "border-white/10 bg-white/[0.04] text-slate-300"
              )}
            >
              {activeStep.label}
            </span>
          ) : null}
        </div>
      </div>

      <div className="relative z-[1] mt-2.5 h-1.5 overflow-hidden rounded-full bg-white/8">
        <motion.div
          className={cn(
            "h-full rounded-full transition-[width] duration-500 ease-out",
            isLight ? (isError ? "bg-rose-300/85" : "bg-amber-300/85") : isError ? "bg-rose-300/85" : "bg-cyan-300/85"
          )}
          style={{ width: `${progress.percent}%` }}
        />
      </div>

      <div className="relative z-[1] mt-2.5 space-y-1.5">
        {progress.steps.map((step, index) => {
          const isActive = step.status === "active";
          const stepTone =
            step.status === "done"
              ? isLight
                ? "border-emerald-200 bg-emerald-50/75"
                : "border-emerald-400/20 bg-emerald-400/10"
              : isActive
                ? isLight
                  ? "border-[#d9bca5] bg-white"
                  : "border-cyan-300/18 bg-cyan-300/[0.05]"
                : isLight
                  ? "border-[#eadccc] bg-white/70"
                  : "border-white/6 bg-white/[0.03]";
          const iconTone =
            step.status === "done"
              ? isLight
                ? "border-emerald-300 bg-emerald-100 text-emerald-700"
                : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
              : isActive
                ? isLight
                  ? "border-[#d5b9a5] bg-[#f5ebe3] text-[#8b6d5a]"
                  : "border-cyan-200/20 bg-cyan-300/10 text-cyan-100"
                : isLight
                  ? "border-[#e1ccc0] bg-white text-[#9a7f6c]"
                  : "border-white/8 bg-white/[0.03] text-slate-400";

          return (
            <div
              key={step.id}
              className={cn(
                "relative overflow-hidden rounded-[12px] border px-2.5 py-1.5",
                stepTone
              )}
            >
              {isActive ? (
                <motion.div
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute inset-y-0 left-0 w-1/3 blur-[1px]",
                    isLight
                      ? "bg-gradient-to-r from-transparent via-[#d9b08d]/24 to-transparent"
                      : isError
                        ? "bg-gradient-to-r from-transparent via-rose-300/10 to-transparent"
                        : "bg-gradient-to-r from-transparent via-cyan-200/12 to-transparent"
                  )}
                  animate={{ x: ["-25%", "230%"] }}
                  transition={{ duration: 1.7, repeat: Infinity, ease: "linear" }}
                />
              ) : null}

              <div className="relative z-[1] flex items-start gap-1.5">
                <span
                  className={cn(
                    "mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full border text-[9px] font-medium",
                    iconTone
                  )}
                >
                  {step.status === "done" ? (
                    <Check className="h-2.5 w-2.5" />
                  ) : isActive ? (
                    <LoaderCircle className="h-2.5 w-2.5 animate-spin" />
                  ) : (
                    index + 1
                  )}
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex items-start justify-between gap-1">
                    <p className={cn("text-[10px]", isLight ? "text-[#3e2f24]" : "text-white")}>{step.label}</p>
                    <span className={cn("text-[7px] tabular-nums", isLight ? "text-[#8f7664]" : "text-slate-400")}>
                      {step.percent}%
                    </span>
                  </div>
                  <p
                    className={cn(
                      "mt-0.5 text-[8px] leading-[0.82rem]",
                      isLight ? "text-[#8f7664]" : "text-slate-500"
                    )}
                  >
                    {step.detail || step.description}
                  </p>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/8">
                    <motion.div
                      className={cn(
                        "h-full rounded-full transition-[width] duration-500 ease-out",
                        step.status === "done"
                          ? isLight
                            ? "bg-emerald-300/85"
                            : "bg-emerald-300/85"
                          : isActive
                            ? isLight
                              ? isError
                                ? "bg-rose-300/85"
                                : "bg-amber-300/85"
                              : isError
                                ? "bg-rose-300/85"
                                : "bg-cyan-300/85"
                            : "bg-transparent"
                      )}
                      style={{ width: `${Math.max(step.percent, isActive ? 10 : 0)}%` }}
                    />
                  </div>
                  {isActive && step.activities.length > 0 ? (
                    <div className="mt-1 space-y-0.5">
                      {step.activities.slice(-2).map((activity) => (
                        <div
                          key={activity.id}
                          className={cn(
                            "flex items-start gap-1.5 text-[8px] leading-[0.9rem]",
                            isLight ? "text-[#705b4d]" : "text-slate-300"
                          )}
                        >
                          <span
                            className={cn(
                              "mt-[5px] h-1.5 w-1.5 shrink-0 rounded-full",
                              activity.status === "done" && "bg-emerald-300",
                              activity.status === "active" && "bg-cyan-300",
                              activity.status === "error" && "bg-rose-300",
                              activity.status === "pending" && (isLight ? "bg-[#c9b4a2]" : "bg-slate-500")
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

export function LaunchpadMetric({
  surfaceTheme,
  label,
  value,
  detail
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  value: string;
  detail: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border px-2.5 py-2",
        surfaceTheme === "light" ? "border-[#e6d7cb] bg-white" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <p
        className={cn(
          "text-[7px] uppercase tracking-[0.16em]",
          surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
        )}
      >
        {label}
      </p>
      <p
        title={value}
        className={cn(
          "mt-1 truncate text-[10px]",
          surfaceTheme === "light" ? "text-[#33251c]" : "text-white"
        )}
      >
        {value}
      </p>
      <p
        className={cn(
          "mt-0.5 text-[8px] leading-[0.85rem]",
          surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
        )}
      >
        {detail}
      </p>
    </div>
  );
}

function StageConsole({
  surfaceTheme,
  statusCopy,
  showDetails,
  phaseLabel,
  detailsOpen,
  onDetailsOpenChange,
  run
}: {
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
  detailsOpen: boolean;
  onDetailsOpenChange: (value: boolean) => void;
  run: StageRunDetails;
}) {
  const [isOpeningTerminal, setIsOpeningTerminal] = useState(false);
  const canOpenTerminal = Boolean(run.manualCommand?.trim().startsWith("openclaw "));

  const copyCommand = async () => {
    if (!run.manualCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(run.manualCommand);
      toast.success("Command copied.", {
        description: "Open Terminal and paste it."
      });
    } catch (error) {
      toast.error("Could not copy command.", {
        description: error instanceof Error ? error.message : "Clipboard access is unavailable."
      });
    }
  };

  const openTerminal = async () => {
    if (!run.manualCommand || !canOpenTerminal) {
      return;
    }

    setIsOpeningTerminal(true);

    try {
      const response = await fetch("/api/system/open-terminal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          command: run.manualCommand
        })
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Unable to open Terminal.");
      }

      toast.success("Terminal opened.", {
        description: "Finish auth there, then refresh."
      });
    } catch (error) {
      toast.error("Could not open Terminal.", {
        description: error instanceof Error ? error.message : "Open Terminal manually and run the command."
      });
    } finally {
      setIsOpeningTerminal(false);
    }
  };

  return (
    <div
      className={cn(
        "mt-2.5 rounded-[12px] border",
        surfaceTheme === "light"
          ? "border-[#e5d5c9] bg-[#fffaf6]"
          : "border-white/8 bg-[rgba(255,255,255,0.02)]"
      )}
    >
      <div className="px-2.5 py-2">
        <div className="flex items-center justify-between gap-2">
          <p
            className={cn(
              "text-[7px] uppercase tracking-[0.16em]",
              surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
            )}
          >
            Status
          </p>
          {showDetails ? (
            <button
              type="button"
              onClick={() => onDetailsOpenChange(!detailsOpen)}
              className={cn(
                "text-[8px] uppercase tracking-[0.16em] transition-colors",
                surfaceTheme === "light" ? "text-[#8f7664] hover:text-[#6f5949]" : "text-slate-500 hover:text-slate-300"
              )}
            >
              {detailsOpen ? "Hide details" : "Show details"}
            </button>
          ) : null}
        </div>
        <p
          className={cn(
            "mt-1 text-[11px] leading-[1rem]",
            surfaceTheme === "light" ? "text-[#5f4b3e]" : "text-slate-300"
          )}
        >
          {statusCopy}
        </p>
      </div>

      {showDetails && detailsOpen ? (
        <>
          <div
            className={cn(
              "flex items-center justify-between border-y px-2.5 py-1.5",
              surfaceTheme === "light" ? "border-[#ebddd2]" : "border-white/8"
            )}
          >
            <p
              className={cn(
                "text-[8px] uppercase tracking-[0.16em]",
                surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
              )}
            >
              Log
            </p>
            <span className={surfaceTheme === "light" ? "text-[10px] text-[#8c7362]" : "text-[10px] text-slate-400"}>
              {phaseLabel}
            </span>
          </div>
          <pre
            className={cn(
              "max-h-[120px] min-h-[68px] overflow-auto whitespace-pre-wrap break-words px-2.5 py-2 font-mono text-[8px] leading-[0.82rem]",
              surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
            )}
          >
            {run.log || "No output yet.\n\nStart the step to stream logs."}
          </pre>
          {run.manualCommand ? (
            <div
              className={cn(
                "border-t px-2.5 py-2",
                surfaceTheme === "light" ? "border-[#ebddd2]" : "border-white/8"
              )}
            >
              <p
                className={cn(
                  "text-[8px] uppercase tracking-[0.16em]",
                  surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
                )}
              >
                {canOpenTerminal ? "Terminal" : "Manual"}
              </p>
              {canOpenTerminal ? (
                <p
                  className={cn(
                    "mt-1 text-[9px] leading-[0.95rem]",
                    surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400"
                  )}
                >
                  Open Terminal and run this command.
                </p>
              ) : null}
              <p
                className={cn(
                  "mt-1 break-all font-mono text-[9px] leading-[0.92rem]",
                  surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                )}
              >
                {run.manualCommand}
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={copyCommand}
                  className={secondaryActionClassName(surfaceTheme)}
                >
                  <Copy className="mr-1.5 h-3 w-3" />
                  Copy command
                </Button>
                {canOpenTerminal ? (
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={openTerminal}
                    disabled={isOpeningTerminal}
                    className={secondaryActionClassName(surfaceTheme)}
                  >
                    {isOpeningTerminal ? (
                      <>
                        <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                        Opening...
                      </>
                    ) : (
                      <>
                        <SquareTerminal className="mr-1.5 h-3 w-3" />
                        Open Terminal
                      </>
                    )}
                  </Button>
                ) : null}
              </div>
              {run.docsUrl ? (
                <a
                  href={run.docsUrl}
                  target="_blank"
                  rel="noreferrer"
                  className={cn(
                    "mt-2 inline-flex items-center gap-1 text-[9px] underline underline-offset-4",
                    surfaceTheme === "light" ? "text-[#7f6554]" : "text-slate-300"
                  )}
                >
                  Setup docs
                  <ArrowRight className="h-2.5 w-2.5" />
                </a>
              ) : null}
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

type WorkspaceBuildSceneState = {
  stepIndex: number;
  steps: Array<{
    id: string;
    label: string;
    detail: string;
    state: "pending" | "current" | "done";
  }>;
  logLines: string[];
  headline: string;
  summary: string;
  selectedModelLabel: string | null;
};

function WorkspaceBuildScene({
  surfaceTheme,
  statusCopy,
  phaseLabel,
  buildScene
}: {
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  phaseLabel: string;
  buildScene: WorkspaceBuildSceneState;
}) {
  const isLight = surfaceTheme === "light";

  return (
    <div
      className={cn(
        "mt-3 overflow-hidden rounded-[24px] border",
        isLight
          ? "border-[#e1d4c6] bg-[linear-gradient(180deg,rgba(255,251,247,0.96),rgba(248,241,233,0.98))]"
          : "border-cyan-300/18 bg-[radial-gradient(circle_at_top,rgba(12,24,40,0.98),rgba(5,10,18,0.98)_72%)]"
      )}
    >
      <div className="relative isolate min-h-[440px] overflow-hidden px-4 py-4 sm:px-5 sm:py-5">
        <div
          className={cn(
            "pointer-events-none absolute inset-0",
            isLight
              ? "bg-[radial-gradient(circle_at_20%_20%,rgba(255,255,255,0.96),transparent_30%),radial-gradient(circle_at_80%_10%,rgba(221,182,152,0.18),transparent_24%),linear-gradient(135deg,rgba(255,255,255,0.06),transparent_30%,rgba(218,193,176,0.12)_58%,transparent_72%)]"
              : "bg-[radial-gradient(circle_at_20%_20%,rgba(34,211,238,0.16),transparent_24%),radial-gradient(circle_at_82%_12%,rgba(56,189,248,0.11),transparent_20%),linear-gradient(135deg,rgba(255,255,255,0.03),transparent_34%,rgba(34,211,238,0.05)_58%,transparent_74%)]"
          )}
        />
        <motion.div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute -left-12 top-8 h-36 w-36 rounded-full blur-3xl",
            isLight ? "bg-[#f1b27d]/25" : "bg-cyan-300/12"
          )}
          animate={{ x: [0, 16, 0], y: [0, -10, 0], opacity: [0.55, 0.8, 0.55] }}
          transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute right-0 top-24 h-44 w-44 rounded-full blur-3xl",
            isLight ? "bg-[#f9d8b6]/22" : "bg-sky-300/10"
          )}
          animate={{ x: [0, -18, 0], y: [0, 8, 0], opacity: [0.35, 0.7, 0.35] }}
          transition={{ duration: 10, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative z-[1] flex items-center justify-between gap-3">
          <div className="min-w-0">
            <p
              className={cn(
                "text-[9px] uppercase tracking-[0.24em]",
                isLight ? "text-[#8f6f5d]" : "text-cyan-200/70"
              )}
            >
              Building
            </p>
            <h3
              className={cn(
                "mt-1 text-[18px] font-medium tracking-[-0.03em] sm:text-[22px]",
                isLight ? "text-[#231a15]" : "text-white"
              )}
            >
              Creating your demo workspace
            </h3>
            <p
              className={cn(
                "mt-1 max-w-[42rem] text-[11px] leading-[1rem] sm:text-[12px] sm:leading-[1.05rem]",
                isLight ? "text-[#6f5a4c]" : "text-slate-300"
              )}
            >
              {statusCopy}
            </p>
          </div>

          <div className="flex shrink-0 flex-col items-end gap-1.5">
            <span
              className={cn(
                "inline-flex items-center rounded-full border px-2.5 py-1 text-[8px] uppercase tracking-[0.16em]",
                isLight ? "border-[#d9c3b1] bg-white/70 text-[#8b6f5c]" : "border-cyan-300/18 bg-cyan-300/10 text-cyan-100"
              )}
            >
              {phaseLabel}
            </span>
            {buildScene.selectedModelLabel ? (
              <span
                className={cn(
                  "inline-flex max-w-[220px] truncate rounded-full border px-2.5 py-1 text-[9px]",
                  isLight ? "border-[#ead8c8] bg-white text-[#5a4638]" : "border-white/10 bg-white/[0.04] text-slate-200"
                )}
              >
                Default model: {buildScene.selectedModelLabel}
              </span>
            ) : null}
          </div>
        </div>

        <div className="relative z-[1] mt-5 grid gap-4 xl:grid-cols-[minmax(0,1.2fr)_minmax(280px,0.8fr)]">
          <div
            className={cn(
              "relative min-h-[290px] overflow-hidden rounded-[28px] border",
              isLight
                ? "border-[#ead8c8] bg-[linear-gradient(180deg,rgba(255,255,255,0.92),rgba(252,246,239,0.98))] shadow-[0_18px_50px_rgba(165,126,98,0.08)]"
                : "border-white/10 bg-[linear-gradient(180deg,rgba(9,16,28,0.98),rgba(5,10,18,0.98))] shadow-[0_18px_50px_rgba(0,0,0,0.3)]"
            )}
          >
            <div
              className={cn(
                "absolute inset-0 opacity-80",
                isLight
                  ? "bg-[linear-gradient(rgba(116,85,65,0.05)_1px,transparent_1px),linear-gradient(90deg,rgba(116,85,65,0.05)_1px,transparent_1px)] bg-[size:28px_28px]"
                  : "bg-[linear-gradient(rgba(56,189,248,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(56,189,248,0.08)_1px,transparent_1px)] bg-[size:28px_28px]"
              )}
            />
            <motion.div
              aria-hidden="true"
              className={cn(
                "absolute inset-x-0 top-0 h-px",
                isLight ? "bg-gradient-to-r from-transparent via-[#caa789] to-transparent" : "bg-gradient-to-r from-transparent via-cyan-200/70 to-transparent"
              )}
              animate={{ opacity: [0.4, 1, 0.4] }}
              transition={{ duration: 3.2, repeat: Infinity, ease: "easeInOut" }}
            />

            <div className="absolute inset-0 flex items-center justify-center">
              <div className="relative flex flex-col items-center text-center">
                <motion.div
                  className={cn(
                    "absolute h-56 w-56 rounded-full border",
                    isLight ? "border-[#d8bda5]/45" : "border-cyan-200/14"
                  )}
                  animate={{ rotate: 360 }}
                  transition={{ duration: 28, repeat: Infinity, ease: "linear" }}
                />
                <motion.div
                  className={cn(
                    "absolute h-40 w-40 rounded-full border",
                    isLight ? "border-[#e2c4ad]/65" : "border-cyan-200/16"
                  )}
                  animate={{ rotate: -360 }}
                  transition={{ duration: 18, repeat: Infinity, ease: "linear" }}
                />
                <motion.div
                  className={cn(
                    "absolute h-24 w-24 rounded-full border",
                    isLight ? "border-[#f0d8c8] bg-white/90" : "border-cyan-300/18 bg-cyan-300/[0.08]"
                  )}
                  animate={{ scale: [1, 1.04, 1], opacity: [0.75, 1, 0.75] }}
                  transition={{ duration: 3.8, repeat: Infinity, ease: "easeInOut" }}
                />

                <div
                  className={cn(
                    "relative flex h-24 w-24 items-center justify-center rounded-full border shadow-[0_0_0_14px_rgba(255,255,255,0.03)]",
                    isLight
                      ? "border-[#d7b9a0] bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.98),rgba(246,232,219,0.98))] text-[#7c5b46]"
                      : "border-cyan-300/24 bg-[radial-gradient(circle_at_top,rgba(16,30,48,0.96),rgba(7,12,21,0.98))] text-cyan-100"
                  )}
                >
                  <LoaderCircle className="h-10 w-10 animate-spin" />
                </div>

                <p className={cn("mt-5 text-[9px] uppercase tracking-[0.22em]", isLight ? "text-[#9a7d69]" : "text-cyan-200/70")}>
                  Workspace fabric
                </p>
                <p className={cn("mt-1 text-[18px] font-medium tracking-[-0.03em]", isLight ? "text-[#281d17]" : "text-white")}>
                  {buildScene.headline}
                </p>
                <p className={cn("mt-2 max-w-[28rem] text-[11px] leading-[1rem]", isLight ? "text-[#6a5547]" : "text-slate-300")}>
                  {buildScene.summary}
                </p>

                <div className="mt-5 flex flex-wrap items-center justify-center gap-2">
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[9px]",
                      isLight ? "border-[#dec8b8] bg-white text-[#634d3d]" : "border-white/10 bg-white/[0.04] text-slate-200"
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", isLight ? "bg-[#c98a5f]" : "bg-cyan-300")} />
                    Building workspace
                  </span>
                  <span
                    className={cn(
                      "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-[9px]",
                      isLight ? "border-[#dec8b8] bg-white text-[#634d3d]" : "border-white/10 bg-white/[0.04] text-slate-200"
                    )}
                  >
                    <span className={cn("h-1.5 w-1.5 rounded-full", isLight ? "bg-emerald-500" : "bg-emerald-300")} />
                    Default model locked
                  </span>
                </div>
              </div>
            </div>

            <div className="absolute inset-x-5 bottom-5">
              <div
                className={cn(
                  "relative h-2 overflow-hidden rounded-full border",
                  isLight ? "border-[#dec8b8] bg-white/90" : "border-white/10 bg-white/[0.04]"
                )}
              >
                <motion.div
                  className={cn(
                    "absolute inset-y-0 left-0 w-1/3 rounded-full",
                    isLight
                      ? "bg-gradient-to-r from-[#b97b4c] via-[#f1c59b] to-[#e39e69]"
                      : "bg-gradient-to-r from-cyan-400 via-sky-200 to-cyan-500"
                  )}
                  animate={{ x: ["-15%", "125%"] }}
                  transition={{ duration: 2.4, repeat: Infinity, ease: "linear" }}
                />
              </div>
            </div>
          </div>

          <div className="flex min-h-0 flex-col gap-3">
            {buildScene.steps.map((step, index) => (
              <motion.div
                key={step.id}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.35, delay: index * 0.05 }}
                className={cn(
                  "rounded-[18px] border px-3 py-2.5",
                  step.state === "current"
                    ? isLight
                      ? "border-[#d9b79f] bg-white shadow-[0_10px_28px_rgba(185,122,77,0.08)]"
                      : "border-cyan-300/24 bg-white/[0.05] shadow-[0_10px_28px_rgba(0,0,0,0.18)]"
                    : step.state === "done"
                      ? isLight
                        ? "border-[#e7d5c6] bg-[rgba(255,255,255,0.76)]"
                        : "border-white/10 bg-white/[0.03]"
                      : isLight
                        ? "border-[#eadccf] bg-[rgba(255,250,246,0.8)]"
                        : "border-white/8 bg-white/[0.02]"
                )}
              >
                <div className="flex items-start gap-2.5">
                  <div
                    className={cn(
                      "mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-[10px] font-medium",
                      step.state === "current"
                        ? isLight
                          ? "border-[#c78e61] bg-[#f7e6d7] text-[#6b4d39]"
                          : "border-cyan-300/28 bg-cyan-300/12 text-cyan-50"
                        : step.state === "done"
                          ? isLight
                            ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                            : "border-emerald-300/25 bg-emerald-300/12 text-emerald-200"
                          : isLight
                            ? "border-[#e2d4c7] bg-white text-[#9a7f6c]"
                            : "border-white/10 bg-white/[0.03] text-slate-400"
                    )}
                  >
                    {step.state === "done" ? <Check className="h-3.5 w-3.5" /> : index + 1}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className={cn("text-[11px] font-medium", isLight ? "text-[#2b1f18]" : "text-white")}>
                          {step.label}
                        </p>
                        <p
                          className={cn(
                            "mt-0.5 text-[9px] leading-[0.95rem]",
                            isLight ? "text-[#7c6554]" : "text-slate-400"
                          )}
                        >
                          {step.detail}
                        </p>
                      </div>
                      <span
                        className={cn(
                          "rounded-full px-1.5 py-0.5 text-[7px] uppercase tracking-[0.14em]",
                          step.state === "current"
                            ? isLight
                              ? "bg-[#f1dfd0] text-[#835f48]"
                              : "bg-cyan-300/12 text-cyan-100"
                            : step.state === "done"
                              ? isLight
                                ? "bg-emerald-100 text-emerald-700"
                                : "bg-emerald-300/12 text-emerald-200"
                              : isLight
                                ? "bg-[#f6ece3] text-[#a0826e]"
                                : "bg-white/[0.04] text-slate-500"
                        )}
                      >
                        {step.state === "done" ? "Ready" : step.state === "current" ? "Building" : "Queued"}
                      </span>
                    </div>
                  </div>
                </div>
              </motion.div>
            ))}

            <div
              className={cn(
                "mt-auto rounded-[20px] border p-3",
                isLight ? "border-[#ead8c8] bg-white" : "border-white/10 bg-white/[0.03]"
              )}
            >
              <div className="flex items-center justify-between gap-2">
                <p
                  className={cn(
                    "text-[8px] uppercase tracking-[0.18em]",
                    isLight ? "text-[#8f6f5d]" : "text-cyan-200/60"
                  )}
                >
                  Live build feed
                </p>
                <span className={cn("text-[9px]", isLight ? "text-[#8a6f5e]" : "text-slate-400")}>
                  {phaseLabel}
                </span>
              </div>

              <div className="mt-2 space-y-1.5">
                {buildScene.logLines.length > 0 ? (
                  buildScene.logLines.slice(-4).map((line, index) => (
                    <motion.div
                      key={`${line}-${index}`}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ duration: 0.25, delay: index * 0.04 }}
                      className={cn(
                        "flex items-start gap-2 rounded-[14px] border px-2.5 py-2 text-[10px] leading-[0.98rem]",
                        index === buildScene.logLines.length - 1
                          ? isLight
                            ? "border-[#d8b79e] bg-[#fff7f0] text-[#5a4638]"
                            : "border-cyan-300/18 bg-cyan-300/[0.06] text-slate-100"
                          : isLight
                            ? "border-[#eee0d3] bg-[#fffdfb] text-[#735d4e]"
                            : "border-white/8 bg-white/[0.02] text-slate-300"
                      )}
                    >
                      <span
                        className={cn(
                          "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                          index === buildScene.logLines.length - 1
                            ? isLight
                              ? "bg-[#c98758]"
                              : "bg-cyan-300"
                            : isLight
                              ? "bg-[#e3c8b2]"
                              : "bg-slate-500"
                        )}
                      />
                      <span className="min-w-0">{line}</span>
                    </motion.div>
                  ))
                ) : (
                  <div
                    className={cn(
                      "rounded-[14px] border border-dashed px-2.5 py-3 text-[10px]",
                      isLight ? "border-[#e8d7c8] text-[#7e6453]" : "border-white/10 text-slate-400"
                    )}
                  >
                    Waiting for the first build signal...
                  </div>
                )}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function resolveWorkspaceBuildScene({
  statusCopy,
  run,
  selectedModelLabel,
  phase
}: {
  statusCopy: string;
  run: StageRunDetails;
  selectedModelLabel: string | null;
  phase: OpenClawModelOnboardingPhase | null;
}): WorkspaceBuildSceneState | null {
  const combinedText = `${statusCopy}\n${run.log}`.toLowerCase();
  const hasTerminalAuth =
    Boolean(run.manualCommand) || /terminal|sign-in|login|oauth|api key|provider auth/.test(combinedText);
  const isWorkspaceProvisioningPhase = phase === "verifying";
  const hasBuildSignal =
    isWorkspaceProvisioningPhase &&
    (
      /creating a demo workspace/.test(combinedText) ||
      /resolving workspace settings and reserving the target directory/.test(combinedText) ||
      /preparing workspace folder/.test(combinedText) ||
      /checking input and target path/.test(combinedText) ||
      /reserved target directory/.test(combinedText) ||
      /creating a fresh workspace folder/.test(combinedText) ||
      /fresh workspace folder created at/.test(combinedText) ||
      /preparing an empty workspace scaffold/.test(combinedText) ||
      /generating workspace docs/.test(combinedText) ||
      /scaffolding workspace files/.test(combinedText) ||
      /workspace files and starter docs are in place/.test(combinedText) ||
      /workspace bootstrap is wrapping up without a kickoff mission/.test(combinedText) ||
      /creating the first workspace agent/.test(combinedText) ||
      /provisioning the first workspace agent/.test(combinedText) ||
      /creating agent \d+ of \d+/.test(combinedText) ||
      /linked to the workspace/.test(combinedText) ||
      /finalizing workspace bootstrap/.test(combinedText) ||
      /workspace bootstrap finished/.test(combinedText) ||
      /demo workspace is ready/.test(combinedText)
    );

  if (run.runState !== "running" || hasTerminalAuth || !hasBuildSignal) {
    return null;
  }

  const stepIndex = resolveWorkspaceBuildSceneStepIndex(combinedText);
  const steps = [
    {
      id: "model",
      label: "Default model",
      detail: selectedModelLabel
        ? `${selectedModelLabel} is now the route powering the workspace.`
        : "The selected route is being saved locally."
    },
    {
      id: "path",
      label: "Workspace shell",
      detail: "Validating the destination and preparing the workspace folder."
    },
    {
      id: "scaffold",
      label: "Workspace scaffold",
      detail: "Writing docs, memory, and the bootstrap metadata."
    },
    {
      id: "agent",
      label: "Starter agent",
      detail: "Provisioning the first agent and wiring it into the workspace."
    },
    {
      id: "handoff",
      label: "Canvas handoff",
      detail: "Refreshing the graph and selecting the new workspace."
    }
  ].map((step, index) => ({
    ...step,
    state: index < stepIndex ? "done" : index === stepIndex ? "current" : "pending"
  })) as WorkspaceBuildSceneState["steps"];

  return {
    stepIndex,
    steps,
    logLines: extractBuildLogLines(run.log),
    headline: "Building your demo workspace",
    summary: "Workspace files, the first agent, and the initial canvas handoff are being assembled in real time.",
    selectedModelLabel
  };
}

function resolveWorkspaceBuildSceneStepIndex(combinedText: string) {
  if (
    /resolving workspace settings/.test(combinedText) ||
    /checking input and target path/.test(combinedText) ||
    /reserved target directory/.test(combinedText) ||
    /creating a demo workspace/.test(combinedText)
  ) {
    return 1;
  }

  if (
    /preparing workspace folder/.test(combinedText) ||
    /creating a fresh workspace folder/.test(combinedText) ||
    /preparing an empty workspace scaffold/.test(combinedText) ||
    /scaffolding workspace files/.test(combinedText) ||
    /fresh workspace folder created at/.test(combinedText) ||
    /generating workspace docs/.test(combinedText) ||
    /workspace files and starter docs are in place/.test(combinedText)
  ) {
    return 2;
  }

  if (
    /creating the first workspace agent/.test(combinedText) ||
    /provisioning the first workspace agent/.test(combinedText) ||
    /creating agent \d+ of \d+/.test(combinedText) ||
    /linked to the workspace/.test(combinedText)
  ) {
    return 3;
  }

  if (
    /finalizing workspace bootstrap/.test(combinedText) ||
    /workspace bootstrap is wrapping up without a kickoff mission/.test(combinedText) ||
    /workspace bootstrap finished/.test(combinedText) ||
    /demo workspace is ready/.test(combinedText)
  ) {
    return 4;
  }

  return 1;
}

function extractBuildLogLines(log: string) {
  return log
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^>\s*/, ""))
    .filter((line) => Boolean(line))
    .slice(-4);
}
