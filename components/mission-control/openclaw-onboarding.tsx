"use client";

import { ArrowLeft, ArrowRight, Check, LoaderCircle, Sparkles } from "lucide-react";
import { motion } from "motion/react";

import { Button } from "@/components/ui/button";
import {
  isOpenClawMissionReady,
  isOpenClawSystemReady
} from "@/lib/openclaw/readiness";
import type {
  DiscoveredModelCandidate,
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
  SystemStage
} from "@/components/mission-control/openclaw-onboarding.stages";

export function OpenClawOnboarding({
  snapshot,
  surfaceTheme,
  stage,
  systemActionLabel,
  systemActionDescription,
  systemPhase,
  modelPhase,
  systemRun,
  modelRun,
  selectedModelId,
  discoveredModels,
  onSelectedModelIdChange,
  onRunSystemSetup,
  onRunModelAutoSetup,
  onRunModelDiscover,
  onRunModelRefresh,
  onRunModelSetDefault,
  onOpenAddModels,
  onOpenWorkspaceCreate,
  onContinueToModels,
  onBackToSystem,
  onDismiss,
  canDismiss
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  stage: WizardStage;
  systemActionLabel: string;
  systemActionDescription: string;
  systemPhase: OpenClawOnboardingPhase | null;
  modelPhase: OpenClawModelOnboardingPhase | null;
  systemRun: StageRunDetails;
  modelRun: StageRunDetails;
  selectedModelId: string;
  discoveredModels: DiscoveredModelCandidate[];
  onSelectedModelIdChange: (value: string) => void;
  onRunSystemSetup: () => void;
  onRunModelAutoSetup: () => void;
  onRunModelDiscover: () => void;
  onRunModelRefresh: () => void;
  onRunModelSetDefault: (modelId?: string) => void;
  onOpenAddModels: () => void;
  onOpenWorkspaceCreate: () => void;
  onContinueToModels: () => void;
  onBackToSystem: () => void;
  onDismiss: () => void;
  canDismiss: boolean;
}) {
  const systemReady = isOpenClawSystemReady(snapshot);
  const modelReady = isOpenClawMissionReady(snapshot);
  const workspaceCount = snapshot.workspaces.length;
  const hasWorkspaces = workspaceCount > 0;
  const defaultModelLabel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    "Ready";
  const wizardSteps = buildWizardSteps(stage, systemReady, modelReady);
  const systemSteps = buildSystemSteps(snapshot, systemPhase);
  const availableModels = snapshot.models.filter((model) => model.available !== false && !model.missing);
  const selectableDiscoveredModels = discoveredModels.filter(
    (model) => !availableModels.some((availableModel) => availableModel.id === model.modelId)
  );
  const selectedModelLabel = resolveSelectedModelLabel(selectedModelId, availableModels);
  const stageRun = stage === "system" ? systemRun : modelRun;
  const heroTitle = modelReady ? "OpenClaw is ready." : "Bring your local OpenClaw online.";
  const heroDescription = modelReady
    ? "Choose your first action below."
    : stage === "system"
      ? "Set up the system, then pick a default model."
      : "Pick the default model and verify readiness.";
  const topBadgeLabel = modelReady ? "Launchpad" : "Welcome";
  const stageStatusCopy =
    stageRun.statusMessage ||
    stageRun.resultMessage ||
    resolveStageDescription(stage, systemActionDescription, selectedModelLabel);
  const phaseLabel = stage === "system" ? resolveSystemPhaseLabel(systemPhase, snapshot) : resolveModelPhaseLabel(modelPhase, snapshot);
  const showDetails =
    stageRun.runState !== "idle" ||
    Boolean(stageRun.manualCommand) ||
    stageRun.log.trim().length > 0 ||
    (stage === "models" && discoveredModels.length > 0);
  const stageBadgeLabel = resolveStageBadgeLabel(stageRun.runState, stage, modelReady);

  const primaryAction = resolvePrimaryAction({
    stage,
    systemReady,
    modelReady,
    systemActionLabel,
    selectedModelId,
    availableModelIds: availableModels.map((model) => model.id)
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
              "text-[7px] uppercase tracking-[0.18em]",
              surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
            )}
          >
            AgentOS
          </p>
          <h1
            className={cn(
              "mt-1 font-display text-[1.12rem] leading-[1.25rem]",
              surfaceTheme === "light" ? "text-[#33251c]" : "text-white"
            )}
          >
            {heroTitle}
          </h1>
          <p
            className={cn(
              "mt-1.5 text-[11px] leading-[1.05rem]",
              surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-300"
            )}
          >
            {heroDescription}
          </p>
        </div>

        <div className="mt-3 grid gap-1.5 sm:grid-cols-2">
          {wizardSteps.map((step) => (
            <div
              key={step.id}
              className={cn(
                "rounded-[14px] border px-2.5 py-2",
                stepContainerClassName(step.state, surfaceTheme)
              )}
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
            </div>
          ))}
        </div>

        {modelReady ? (
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
            selectedModelId={selectedModelId}
            availableModels={availableModels.map((model) => ({
              id: model.id,
              name: model.name,
              provider: model.provider
            }))}
            discoveredModels={selectableDiscoveredModels}
            onSelectedModelIdChange={onSelectedModelIdChange}
            onRunModelDiscover={onRunModelDiscover}
            onRunModelRefresh={onRunModelRefresh}
            onRunModelSetDefault={onRunModelSetDefault}
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
            {modelReady ? (
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

            {canDismiss && !modelReady ? (
              <button
                type="button"
                onClick={onDismiss}
                className={cn(
                  "text-[9px] uppercase tracking-[0.16em] transition-colors",
                  surfaceTheme === "light" ? "text-[#8f7664] hover:text-[#6f5949]" : "text-slate-500 hover:text-slate-300"
                )}
              >
                Open demo surface
              </button>
            ) : null}
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {modelReady ? (
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
                  onClick={hasWorkspaces ? onDismiss : onOpenWorkspaceCreate}
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
                    onClick={onRunModelAutoSetup}
                    disabled={modelRun.runState === "running"}
                    className={secondaryActionClassName(surfaceTheme)}
                  >
                    {modelRun.runState === "running" ? (
                      <>
                        <LoaderCircle className="mr-1.5 h-3.5 w-3.5 animate-spin" />
                        Working...
                      </>
                    ) : (
                      "Auto configure"
                    )}
                  </Button>
                ) : null}

                <Button
                  type="button"
                  onClick={() => {
                    if (stage === "system") {
                      if (systemReady && modelReady) {
                        onDismiss();
                        return;
                      }

                      if (systemReady) {
                        onContinueToModels();
                        return;
                      }

                      onRunSystemSetup();
                      return;
                    }

                    if (modelReady) {
                      onDismiss();
                      return;
                    }

                    if (primaryAction.kind === "set-default") {
                      onRunModelSetDefault();
                      return;
                    }

                    onRunModelAutoSetup();
                  }}
                  disabled={stageRun.runState === "running"}
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
