"use client";

import { ArrowLeft, ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import { isOpenClawOnboardingSystemReady } from "@/lib/openclaw/readiness";
import type {
  DiscoveredModelCandidate,
  AddModelsProviderId,
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawOnboardingPhase
} from "@/lib/agentos/contracts";
import { cn } from "@/lib/utils";
import {
  buildSystemSteps,
  buildWizardSteps,
  ghostActionClassName,
  secondaryActionClassName,
  resolveModelPhaseLabel,
  resolvePrimaryAction,
  resolveSelectedModelLabel,
  resolveStageBadgeLabel,
  resolveStageDescription,
  resolveSystemPhaseLabel,
  stageBadgeClassName,
  stepBadgeClassName,
  stepContainerClassName,
  stepIconClassName,
  type StageRunDetails,
  type SurfaceTheme,
  type WizardStage
} from "@/components/mission-control/openclaw-onboarding.utils";
import {
  LaunchpadStage,
  ModelStage,
  SystemStage,
  type ModelSwitchFeedback
} from "@/components/mission-control/openclaw-onboarding.stages";

export function OpenClawOnboarding({
  snapshot,
  surfaceTheme,
  stage,
  showReadyState,
  systemActionLabel,
  systemActionDescription,
  systemPhase,
  modelPhase,
  systemRun,
  modelRun,
  modelSwitchFeedback,
  selectedModelId,
  discoveredModels,
  onSelectedModelIdChange,
  onClearModelSwitchFeedback,
  onRunSystemSetup,
  onRunModelSetDefault,
  onOpenAddModels,
  onOpenWorkspaceCreate,
  onEnterAgentOS,
  onContinueToModels,
  onBackToSystem,
  onSelectStage,
  onDismiss,
  canDismiss
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  stage: WizardStage;
  showReadyState: boolean;
  systemActionLabel: string;
  systemActionDescription: string;
  systemPhase: OpenClawOnboardingPhase | null;
  modelPhase: OpenClawModelOnboardingPhase | null;
  systemRun: StageRunDetails;
  modelRun: StageRunDetails;
  modelSwitchFeedback: ModelSwitchFeedback;
  selectedModelId: string;
  discoveredModels: DiscoveredModelCandidate[];
  onSelectedModelIdChange: (value: string) => void;
  onClearModelSwitchFeedback: () => void;
  onRunSystemSetup: () => void;
  onRunModelSetDefault: (modelId?: string) => void;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
  onOpenWorkspaceCreate: () => void;
  onEnterAgentOS: () => void;
  onContinueToModels: () => void;
  onBackToSystem: () => void;
  onSelectStage: (stage: WizardStage) => void;
  onDismiss: () => void;
  canDismiss: boolean;
  }) {
  const onboardingSystemReady = systemRun.runState === "success" || isOpenClawOnboardingSystemReady(snapshot);
  const modelReady = modelSwitchFeedback.phase === "success" || showReadyState;
  const showLaunchpad = modelReady && showReadyState;
  const workspaceCount = snapshot.workspaces.length;
  const hasWorkspaces = workspaceCount > 0;
  const defaultModelLabel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    "Ready";
  const defaultModelId =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    null;
  const systemPhaseForSteps = onboardingSystemReady ? "ready" : systemPhase;
  const wizardSteps = buildWizardSteps(stage, onboardingSystemReady, modelReady);
  const systemSteps = buildSystemSteps(snapshot, systemPhaseForSteps);
  const availableModels = snapshot.models.filter((model) => model.available !== false && !model.missing);
  const selectedModelLabel = resolveSelectedModelLabel(selectedModelId, availableModels);
  const stageRun = stage === "system" ? systemRun : modelRun;
  const heroLine = showLaunchpad
    ? "AGENTOS : OpenClaw is ready. Choose your first action below."
    : "AGENTOS : Bring your local OpenClaw online.";
  const openSurfaceLabel = hasWorkspaces ? "Open demo surface" : "Create workspace";
  const topBadgeLabel = showLaunchpad ? "Launchpad" : "Welcome";
  const stageStatusCopy =
    stageRun.statusMessage ||
    stageRun.resultMessage ||
    resolveStageDescription(stage, systemActionDescription, selectedModelLabel);
  const phaseLabel =
    stage === "system"
      ? onboardingSystemReady
        ? "ready"
        : resolveSystemPhaseLabel(systemPhase, snapshot)
      : resolveModelPhaseLabel(modelPhase, snapshot);
  const showDetails =
    stageRun.runState !== "idle" ||
    Boolean(stageRun.manualCommand) ||
    stageRun.log.trim().length > 0 ||
    (stage === "models" && discoveredModels.length > 0);
  const stageBadgeLabel = resolveStageBadgeLabel(stageRun.runState, stage, modelReady);

  const primaryAction = resolvePrimaryAction({
    stage,
    systemReady: onboardingSystemReady,
    modelReady,
    systemActionLabel,
    selectedModelId,
    defaultModelId
  });

  return (
    <motion.div
      initial={{ opacity: 0, backdropFilter: "blur(0px)" }}
      animate={{ opacity: 1, backdropFilter: "blur(12px)" }}
      exit={{ opacity: 0, backdropFilter: "blur(0px)" }}
      className={cn(
        "absolute inset-0 z-[80] pointer-events-auto flex items-center justify-center overflow-y-auto px-3 py-4 sm:px-4 sm:py-6",
        surfaceTheme === "light"
          ? "bg-[radial-gradient(circle_at_top,rgba(255,255,255,0.94),rgba(247,239,232,0.88)_46%,rgba(242,230,220,0.92))]"
          : "bg-[radial-gradient(circle_at_top,rgba(17,24,39,0.9),rgba(3,7,18,0.92)_48%,rgba(2,6,23,0.96))]"
      )}
    >
      <motion.div
        initial={{ opacity: 0, y: 18, scale: 0.985 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className={cn(
          "my-auto flex w-full max-w-[420px] flex-col overflow-hidden rounded-[16px] border shadow-[0_18px_46px_rgba(0,0,0,0.18)] backdrop-blur-2xl max-h-[min(80vh,560px)]",
          surfaceTheme === "light"
            ? "border-[#dccabd]/90 bg-[rgba(255,250,246,0.92)] text-[#47362b] shadow-[0_18px_50px_rgba(161,125,101,0.15)]"
            : "border-white/10 bg-[rgba(6,10,18,0.84)] text-slate-100"
        )}
      >
        <div className="overflow-y-auto px-2.5 py-2.5 sm:px-3 sm:py-3">
        <div className="flex items-center justify-between gap-2">
          <span
            className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[8px] uppercase tracking-[0.18em]",
              surfaceTheme === "light"
                ? "border-[#d8c0b0] bg-[#f3e7dc] text-[#8d725f]"
                : "border-white/10 bg-white/[0.06] text-slate-300"
            )}
          >
            <Sparkles className="h-2 w-2" />
            {topBadgeLabel}
          </span>
          <span
            className={cn(
              "rounded-full border px-1.5 py-0.5 text-[8px] uppercase tracking-[0.16em]",
              stageBadgeClassName(stageRun.runState, modelReady, surfaceTheme)
            )}
          >
            {stageBadgeLabel}
          </span>
        </div>

        <div className="mt-3">
          <p
            className={cn(
              "whitespace-nowrap text-[9px] leading-[1rem] tracking-[0.08em]",
              surfaceTheme === "light" ? "text-[#33251c]" : "text-slate-100"
            )}
          >
            {heroLine}
          </p>
        </div>

        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {wizardSteps.map((step) => (
            <button
              type="button"
              key={step.id}
              onClick={() => onSelectStage(step.id as WizardStage)}
              className={cn(
                "rounded-[14px] border px-2.5 py-2 text-left transition-colors hover:opacity-95 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2",
                surfaceTheme === "light"
                  ? "focus-visible:ring-[#c8946f] focus-visible:ring-offset-[#fff7f1]"
                  : "focus-visible:ring-white/70 focus-visible:ring-offset-[#060a12]",
                stepContainerClassName(step.state, surfaceTheme)
              )}
              aria-pressed={stage === step.id}
            >
              <div className="flex items-center justify-between gap-1.5">
                <div className="flex items-center gap-1.5">
                  <span
                    className={cn(
                      "inline-flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-medium",
                      stepIconClassName(step.state, surfaceTheme)
                    )}
                  >
                    {step.state === "complete" ? <Check className="h-2.5 w-2.5" /> : step.order}
                  </span>
                  <div>
                    <p className={cn("text-[11px]", surfaceTheme === "light" ? "text-[#3e2f24]" : "text-white")}>
                      {step.label}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-[8px] leading-[0.85rem]",
                        surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
                      )}
                    >
                      {step.description}
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "rounded-full px-1.5 py-0.5 text-[6px] uppercase tracking-[0.14em]",
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
            </button>
          ))}
        </div>

        {showLaunchpad ? (
          <LaunchpadStage
            surfaceTheme={surfaceTheme}
            workspaceCount={workspaceCount}
            defaultModelLabel={defaultModelLabel}
          />
        ) : stage === "system" ? (
          <SystemStage
            steps={systemSteps}
            surfaceTheme={surfaceTheme}
            statusCopy={stageStatusCopy}
            showDetails={showDetails}
            phaseLabel={phaseLabel}
            run={stageRun}
          />
        ) : (
          <ModelStage
            snapshot={snapshot}
            surfaceTheme={surfaceTheme}
            statusCopy={stageStatusCopy}
            showDetails={showDetails}
            phaseLabel={phaseLabel}
            run={stageRun}
            modelPhase={modelPhase}
            selectedModelId={selectedModelId}
            modelSwitchFeedback={modelSwitchFeedback}
            onSelectedModelIdChange={onSelectedModelIdChange}
            onClearModelSwitchFeedback={onClearModelSwitchFeedback}
            onOpenAddModels={onOpenAddModels}
          />
        )}

        </div>

        <div
          className={cn(
            "mt-auto flex flex-wrap items-center justify-between gap-1.5 border-t px-2.5 py-2 sm:px-3",
            surfaceTheme === "light" ? "border-[#ebddd2]" : "border-white/8"
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            {showLaunchpad ? (
              <span
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[8px] uppercase tracking-[0.16em]",
                  surfaceTheme === "light"
                    ? "border-emerald-300 bg-emerald-50 text-emerald-700"
                    : "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                )}
              >
                Setup complete
              </span>
            ) : stage === "models" ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={onBackToSystem}
                disabled={stageRun.runState === "running"}
                className={ghostActionClassName(surfaceTheme)}
              >
                <ArrowLeft className="mr-1.5 h-3.5 w-3.5" />
                Back
              </Button>
            ) : null}

            {canDismiss && !showLaunchpad ? (
              <button
                type="button"
                onClick={hasWorkspaces ? onDismiss : onOpenWorkspaceCreate}
                className={cn(
                  "text-[9px] uppercase tracking-[0.16em] transition-colors",
                  surfaceTheme === "light" ? "text-[#8f7664] hover:text-[#6f5949]" : "text-slate-500 hover:text-slate-300"
                )}
              >
                {openSurfaceLabel}
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {showLaunchpad ? (
              <>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={hasWorkspaces ? onOpenWorkspaceCreate : onDismiss}
                  className={secondaryActionClassName(surfaceTheme)}
                >
                  {hasWorkspaces ? "Create workspace" : "Skip to dashboard"}
                </Button>
                <Button
                  type="button"
                  onClick={hasWorkspaces ? onEnterAgentOS : onOpenWorkspaceCreate}
                  className={cn(
                    "h-8 min-w-[156px] rounded-full px-3 text-[11px]",
                    surfaceTheme === "light"
                      ? "bg-[#c8946f] text-white shadow-[0_14px_34px_rgba(200,148,111,0.24)] hover:bg-[#b88461]"
                      : "bg-white text-slate-950 hover:bg-white/92"
                  )}
                >
                  {hasWorkspaces ? "Enter AgentOS" : "Create first workspace"}
                  <ArrowRight className="ml-1.5 h-3 w-3" />
                </Button>
              </>
            ) : (
              <>
                {stage === "models" && !modelReady ? (
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => onOpenAddModels()}
                    className={secondaryActionClassName(surfaceTheme)}
                  >
                    Open full Add Models
                  </Button>
                ) : null}

                <Button
                  type="button"
                  onClick={() => {
                    if (stage === "system") {
                      if (primaryAction.kind === "dismiss") {
                        onEnterAgentOS();
                        return;
                      }

                      if (onboardingSystemReady) {
                        onContinueToModels();
                        return;
                      }

                      onRunSystemSetup();
                      return;
                    }

                    if (primaryAction.kind === "dismiss") {
                      onEnterAgentOS();
                      return;
                    }

                    if (primaryAction.kind === "set-default") {
                      onRunModelSetDefault(selectedModelId || undefined);
                      return;
                    }

                    return;
                  }}
                  disabled={stageRun.runState === "running" || primaryAction.kind === "select-model"}
                  className={cn(
                    "h-8 min-w-[156px] rounded-full px-3 text-[11px]",
                    surfaceTheme === "light"
                      ? "bg-[#c8946f] text-white shadow-[0_14px_34px_rgba(200,148,111,0.24)] hover:bg-[#b88461]"
                      : "bg-white text-slate-950 hover:bg-white/92"
                  )}
                >
                  {stageRun.runState === "running" ? (
                    <>
                      <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                      Working...
                    </>
                  ) : (
                    <>
                      {primaryAction.label}
                      <ArrowRight className="ml-1.5 h-3 w-3" />
                    </>
                  )}
                </Button>
              </>
            )}
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}
