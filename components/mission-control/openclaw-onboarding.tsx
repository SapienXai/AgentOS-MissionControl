"use client";

import { ArrowLeft, ArrowRight, Check, Copy, LoaderCircle, RefreshCw, Sparkles, SquareTerminal } from "lucide-react";
import { motion } from "motion/react";
import { useState } from "react";

import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import {
  isOpenClawMissionReady,
  isOpenClawSystemReady
} from "@/lib/openclaw/readiness";
import type {
  DiscoveredModelCandidate,
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawOnboardingPhase
} from "@/lib/openclaw/types";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type RunState = "idle" | "running" | "success" | "error";
type WizardStage = "system" | "models";
type StepState = "complete" | "current" | "pending";

type StageRunDetails = {
  runState: RunState;
  statusMessage: string | null;
  resultMessage: string | null;
  log: string;
  manualCommand: string | null;
  docsUrl: string | null;
};

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
  onContinueToModels: () => void;
  onBackToSystem: () => void;
  onDismiss: () => void;
  canDismiss: boolean;
}) {
  const systemReady = isOpenClawSystemReady(snapshot);
  const modelReady = isOpenClawMissionReady(snapshot);
  const wizardSteps = buildWizardSteps(stage, systemReady, modelReady);
  const systemSteps = buildSystemSteps(snapshot, systemPhase);
  const availableModels = snapshot.models.filter((model) => model.available !== false && !model.missing);
  const selectableDiscoveredModels = discoveredModels.filter(
    (model) => !availableModels.some((availableModel) => availableModel.id === model.modelId)
  );
  const stageRun = stage === "system" ? systemRun : modelRun;
  const stageStatusCopy = stageRun.statusMessage || stageRun.resultMessage || resolveStageDescription(stage, systemActionDescription);
  const phaseLabel = stage === "system" ? resolveSystemPhaseLabel(systemPhase, snapshot) : resolveModelPhaseLabel(modelPhase, snapshot);
  const showDetails =
    stageRun.runState !== "idle" || Boolean(stageRun.manualCommand) || stageRun.log.trim().length > 0;
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
            Welcome
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
            OpenClaw Mission Control
          </p>
          <h1
            className={cn(
              "mt-1 font-display text-[1.12rem] leading-[1.25rem]",
              surfaceTheme === "light" ? "text-[#33251c]" : "text-white"
            )}
          >
            Bring your local OpenClaw online.
          </h1>
          <p
            className={cn(
              "mt-1.5 text-[11px] leading-[1.05rem]",
              surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-300"
            )}
          >
            Finish the system layer first, then lock a usable default model so the product is ready
            for real work.
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

        {stage === "system" ? (
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
            {stage === "models" ? (
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

            {canDismiss ? (
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
          </div>
        </div>
      </motion.div>
    </motion.div>
  );
}

function SystemStage({
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
          Install the CLI if needed, make sure the gateway service exists, and verify a live RPC
          connection.
        </p>
      </div>

      <div className="mt-2.5 space-y-1.5">
        {steps.map((step, index) => (
          <div
            key={step.id}
            className={cn(
              "flex items-center gap-1.5 rounded-[12px] border px-2 py-1.5",
              stepContainerClassName(step.state, surfaceTheme)
            )}
          >
            <span
              className={cn(
                "mt-0.5 inline-flex h-5 w-5 items-center justify-center rounded-full border text-[9px] font-medium",
                stepIconClassName(step.state, surfaceTheme)
              )}
            >
              {step.state === "complete" ? <Check className="h-2.5 w-2.5" /> : index + 1}
            </span>
            <div className="min-w-0 flex-1">
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
                  {step.state === "complete"
                    ? "Ready"
                    : step.state === "current"
                      ? "Active"
                      : "Pending"}
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
        ))}
      </div>

      <StageConsole
        surfaceTheme={surfaceTheme}
        statusCopy={statusCopy}
        showDetails={showDetails}
        phaseLabel={phaseLabel}
        run={run}
      />
    </>
  );
}

function ModelStage({
  snapshot,
  surfaceTheme,
  statusCopy,
  showDetails,
  phaseLabel,
  run,
  selectedModelId,
  availableModels,
  discoveredModels,
  onSelectedModelIdChange,
  onRunModelDiscover,
  onRunModelRefresh,
  onRunModelSetDefault
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
  run: StageRunDetails;
  selectedModelId: string;
  availableModels: Array<{ id: string; name: string; provider: string }>;
  discoveredModels: DiscoveredModelCandidate[];
  onSelectedModelIdChange: (value: string) => void;
  onRunModelDiscover: () => void;
  onRunModelRefresh: () => void;
  onRunModelSetDefault: (modelId?: string) => void;
}) {
  const modelReadiness = snapshot.diagnostics.modelReadiness;

  return (
    <>
      <div className="mt-3">
        <div className="flex items-center justify-between gap-2">
          <div>
            <p
              className={cn(
                "text-[7px] uppercase tracking-[0.18em]",
                surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
              )}
            >
              Step 2
            </p>
            <h2 className={cn("mt-1 text-[13px] font-medium", surfaceTheme === "light" ? "text-[#33251c]" : "text-white")}>
              Model setup
            </h2>
          </div>

          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRunModelRefresh}
            disabled={run.runState === "running"}
            className={secondaryActionClassName(surfaceTheme)}
          >
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
            Refresh
          </Button>
        </div>

        <p
          className={cn(
            "mt-1 text-[10px] leading-[0.95rem]",
            surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400"
          )}
        >
          Lock a usable default model before handing the user into the live product.
        </p>
      </div>

      <div className="mt-2.5 grid gap-1.5 sm:grid-cols-3">
        <MetricCard
          surfaceTheme={surfaceTheme}
          label="Default model"
          value={modelReadiness.resolvedDefaultModel || modelReadiness.defaultModel || "Not set"}
        />
        <MetricCard
          surfaceTheme={surfaceTheme}
          label="Available routes"
          value={`${modelReadiness.availableModelCount}/${modelReadiness.totalModelCount}`}
        />
        <MetricCard
          surfaceTheme={surfaceTheme}
          label="Connected providers"
          value={String(modelReadiness.authProviders.filter((provider) => provider.connected).length)}
        />
      </div>

      <div
        className={cn(
          "mt-2.5 rounded-[12px] border px-2.5 py-2.5",
          surfaceTheme === "light"
            ? "border-[#e5d5c9] bg-[#fffaf6]"
            : "border-white/8 bg-[rgba(255,255,255,0.02)]"
        )}
      >
        <div className="grid gap-2.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
          <label className="block">
            <span
              className={cn(
                "text-[7px] uppercase tracking-[0.16em]",
                surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
              )}
            >
              Default model
            </span>
            <select
              value={selectedModelId}
              onChange={(event) => onSelectedModelIdChange(event.target.value)}
              className={cn(
                "mt-1.5 h-9 w-full rounded-[12px] border px-2.5 text-[11px] outline-none",
                surfaceTheme === "light"
                  ? "border-[#dccabd] bg-white text-[#33251c]"
                  : "border-white/10 bg-white/[0.04] text-slate-100"
              )}
            >
              <option value="">Auto choose</option>
              {availableModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.name} · {model.provider}
                </option>
              ))}
            </select>
          </label>

          <div
            className={cn(
              "rounded-[12px] border px-2.5 py-1.5 text-[10px]",
              surfaceTheme === "light"
                ? "border-[#eadcd0] bg-[#fff7f2] text-[#705b4d]"
                : "border-white/10 bg-white/[0.03] text-slate-400"
            )}
          >
            {modelReadiness.localModelCount} local · {modelReadiness.remoteModelCount} remote
          </div>
        </div>

        <div className="mt-2 flex flex-wrap gap-1.5">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onRunModelDiscover}
            disabled={run.runState === "running"}
            className={secondaryActionClassName(surfaceTheme)}
          >
            {discoveredModels.length > 0 ? "Scan again" : "Discover models"}
          </Button>
        </div>

        {modelReadiness.issues.length > 0 ? (
          <div className="mt-2.5 space-y-1">
            {modelReadiness.issues.map((issue) => (
              <p
                key={issue}
                className={cn(
                  "rounded-[10px] border px-2 py-1.5 text-[9px] leading-[0.85rem]",
                  surfaceTheme === "light"
                    ? "border-amber-200 bg-amber-50 text-amber-800"
                    : "border-amber-300/20 bg-amber-300/10 text-amber-100"
                )}
              >
                {issue}
              </p>
            ))}
          </div>
        ) : null}

        {snapshot.diagnostics.modelReadiness.authProviders.length > 0 ? (
          <div className="mt-2.5 flex flex-wrap gap-1.5">
            {snapshot.diagnostics.modelReadiness.authProviders.map((provider) => (
              <span
                key={provider.provider}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[9px]",
                  provider.connected
                    ? surfaceTheme === "light"
                      ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                      : "border-emerald-300/20 bg-emerald-300/10 text-emerald-200"
                    : surfaceTheme === "light"
                      ? "border-[#dccabd] bg-white text-[#705b4d]"
                      : "border-white/10 bg-white/[0.04] text-slate-300"
                )}
              >
                {formatProviderLabel(provider.provider)}
                {provider.detail ? ` · ${provider.detail}` : ""}
              </span>
            ))}
          </div>
        ) : null}

        {discoveredModels.length > 0 ? (
          <div className="mt-2.5 space-y-1.5">
            <p
              className={cn(
                "text-[7px] uppercase tracking-[0.16em]",
                surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
              )}
            >
              Discovered routes
            </p>
            <div className="space-y-1.5">
              {discoveredModels.slice(0, 3).map((model) => (
                <div
                  key={model.modelId}
                  className={cn(
                    "flex items-center justify-between gap-2 rounded-[12px] border px-2 py-1.5",
                    surfaceTheme === "light"
                      ? "border-[#eadcd0] bg-[#fff7f2]"
                      : "border-white/10 bg-white/[0.03]"
                  )}
                >
                  <div className="min-w-0">
                    <p
                      className={cn(
                        "truncate text-[10px]",
                        surfaceTheme === "light" ? "text-[#3e2f24]" : "text-white"
                      )}
                    >
                      {model.name}
                    </p>
                    <p
                      className={cn(
                        "mt-0.5 text-[8px] leading-[0.85rem]",
                        surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
                      )}
                    >
                      {formatProviderLabel(model.provider)}
                      {model.isFree ? " · free" : ""}
                      {model.supportsTools ? " · tools" : ""}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={() => onRunModelSetDefault(model.modelId)}
                    disabled={run.runState === "running"}
                    className={secondaryActionClassName(surfaceTheme)}
                  >
                    Use
                  </Button>
                </div>
              ))}
            </div>
            <p
              className={cn(
                "text-[9px] leading-[0.95rem]",
                surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-500"
              )}
            >
              The dropdown only shows routes that are already configured. Use a discovered route
              here to add it first; if credentials are missing, Mission Control will hand you off
              to OpenClaw.
            </p>
          </div>
        ) : null}
      </div>

      <StageConsole
        surfaceTheme={surfaceTheme}
        statusCopy={statusCopy}
        showDetails={showDetails}
        phaseLabel={phaseLabel}
        run={run}
      />
    </>
  );
}

function StageConsole({
  surfaceTheme,
  statusCopy,
  showDetails,
  phaseLabel,
  run
}: {
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
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
        description: "Open Terminal and paste the command to continue setup."
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
        description: "Finish the OpenClaw auth flow there, then return and refresh setup."
      });
    } catch (error) {
      toast.error("Could not open Terminal.", {
        description: error instanceof Error ? error.message : "Open Terminal manually and run the command below."
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
        <p
          className={cn(
            "text-[7px] uppercase tracking-[0.16em]",
            surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
          )}
        >
          Current status
        </p>
        <p
          className={cn(
            "mt-1 text-[11px] leading-[1rem]",
            surfaceTheme === "light" ? "text-[#5f4b3e]" : "text-slate-300"
          )}
        >
          {statusCopy}
        </p>
      </div>

      {showDetails ? (
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
              Setup log
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
            {run.log || "No command output yet.\n\nStart this step and Mission Control will stream each action here."}
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
                {canOpenTerminal ? "Run in terminal" : "Manual fallback"}
              </p>
              {canOpenTerminal ? (
                <p
                  className={cn(
                    "mt-1 text-[9px] leading-[0.95rem]",
                    surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400"
                  )}
                >
                  Open Terminal and run this command to continue setup.
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

function MetricCard({
  surfaceTheme,
  label,
  value
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  value: string;
}) {
  return (
    <div
      className={cn(
        "rounded-[12px] border px-2.5 py-2",
        surfaceTheme === "light"
          ? "border-[#e5d5c9] bg-[#fffaf6]"
          : "border-white/8 bg-[rgba(255,255,255,0.02)]"
      )}
    >
      <p className={cn("text-[7px] uppercase tracking-[0.16em]", surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500")}>
        {label}
      </p>
      <p className={cn("mt-1 text-[11px] leading-[0.92rem]", surfaceTheme === "light" ? "text-[#3e2f24]" : "text-white")}>
        {value}
      </p>
    </div>
  );
}

function buildWizardSteps(stage: WizardStage, systemReady: boolean, modelReady: boolean) {
  return [
    {
      id: "system",
      order: 1,
      label: "System setup",
      description: "CLI, gateway service, live RPC, runtime state",
      state: resolveStepState(systemReady, stage === "system" && !systemReady)
    },
    {
      id: "models",
      order: 2,
      label: "Model setup",
      description: "Default model, provider auth, live smoke test",
      state: resolveStepState(modelReady, stage === "models" && !modelReady)
    }
  ] as Array<{ id: string; order: number; label: string; description: string; state: StepState }>;
}

function buildSystemSteps(snapshot: MissionControlSnapshot, phase: OpenClawOnboardingPhase | null) {
  const directGatewayRun = snapshot.diagnostics.rpcOk && !snapshot.diagnostics.loaded;
  const cliComplete =
    snapshot.diagnostics.installed ||
    phase === "installing-gateway" ||
    phase === "starting-gateway" ||
    phase === "verifying" ||
    phase === "ready";
  const gatewayComplete =
    snapshot.diagnostics.loaded ||
    directGatewayRun ||
    phase === "starting-gateway" ||
    phase === "verifying" ||
    phase === "ready";
  const liveComplete = snapshot.diagnostics.rpcOk || phase === "ready";
  const runtimeStateComplete =
    (snapshot.diagnostics.runtime.stateWritable && snapshot.diagnostics.runtime.sessionStoreWritable) ||
    phase === "ready";

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
        : directGatewayRun
          ? "Gateway is live via direct run."
          : "Register the gateway service once so Mission Control can start it reliably.",
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
    },
    {
      id: "state",
      label: "Runtime state",
      description:
        snapshot.diagnostics.runtime.stateWritable && snapshot.diagnostics.runtime.sessionStoreWritable
          ? "Mission Control can write to the OpenClaw state root and agent session stores."
          : "Verify write access to the OpenClaw runtime state before live work begins.",
      state: resolveStepState(
        runtimeStateComplete,
        !runtimeStateComplete && (phase === "verifying" || liveComplete)
      )
    }
  ] as Array<{ id: string; label: string; description: string; state: StepState }>;
}

function resolvePrimaryAction(params: {
  stage: WizardStage;
  systemReady: boolean;
  modelReady: boolean;
  systemActionLabel: string;
  selectedModelId: string;
  availableModelIds: string[];
}) {
  if (params.stage === "system") {
    if (params.systemReady && params.modelReady) {
      return { kind: "dismiss" as const, label: "Enter Mission Control" };
    }

    if (params.systemReady) {
      return { kind: "continue" as const, label: "Continue to model setup" };
    }

    return { kind: "system" as const, label: params.systemActionLabel };
  }

  if (params.modelReady) {
    return { kind: "dismiss" as const, label: "Enter Mission Control" };
  }

  if (params.selectedModelId && params.availableModelIds.includes(params.selectedModelId)) {
    return { kind: "set-default" as const, label: "Use selected model" };
  }

  if (params.selectedModelId) {
    return { kind: "set-default" as const, label: "Use selected model" };
  }

  return { kind: "auto" as const, label: "Auto configure models" };
}

function resolveStageDescription(stage: WizardStage, systemActionDescription: string) {
  if (stage === "system") {
    return systemActionDescription;
  }

  return "Choose or connect a usable model route so the product is actually ready.";
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

function resolveStageBadgeLabel(runState: RunState, stage: WizardStage, modelReady: boolean) {
  if (runState === "running") {
    return "Running";
  }

  if (modelReady) {
    return "Ready";
  }

  if (runState === "success") {
    return stage === "models" ? "Updated" : "Step complete";
  }

  if (runState === "error") {
    return "Needs attention";
  }

  return stage === "system" ? "Step 1" : "Step 2";
}

function stageBadgeClassName(runState: RunState, modelReady: boolean, surfaceTheme: SurfaceTheme) {
  if (runState === "error") {
    return surfaceTheme === "light"
      ? "border-rose-300 bg-rose-50 text-rose-700"
      : "border-rose-300/25 bg-rose-300/10 text-rose-200";
  }

  if (runState === "success" || modelReady) {
    return surfaceTheme === "light"
      ? "border-emerald-300 bg-emerald-50 text-emerald-700"
      : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200";
  }

  if (runState === "running") {
    return surfaceTheme === "light"
      ? "border-[#d8c0b0] bg-white/80 text-[#8d725f]"
      : "border-white/10 bg-white/[0.04] text-slate-300";
  }

  return surfaceTheme === "light"
    ? "border-[#d8c0b0] bg-white/80 text-[#8d725f]"
    : "border-white/10 bg-white/[0.04] text-slate-400";
}

function secondaryActionClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-[#b89374] bg-[#ecd4c1] text-[#4a3426] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[#e4c6af] hover:text-[#38261b]"
    : "border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/[0.1]";
}

function ghostActionClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border border-[#d7bca7] bg-[#f8ede4] text-[#5a4131] hover:bg-[#eedbcc] hover:text-[#3f2d21]"
    : "text-slate-500 hover:bg-white/[0.08] hover:text-slate-200";
}

function resolveSystemPhaseLabel(
  phase: OpenClawOnboardingPhase | null,
  snapshot: MissionControlSnapshot
) {
  if (isOpenClawSystemReady(snapshot)) {
    return "ready";
  }

  if (snapshot.diagnostics.rpcOk) {
    return "verifying access";
  }

  if (snapshot.diagnostics.loaded && !snapshot.diagnostics.rpcOk) {
    return phase === "verifying" ? "connecting" : "starting gateway";
  }

  return phase ? phase.replace("-", " ") : "waiting";
}

function resolveModelPhaseLabel(
  phase: OpenClawModelOnboardingPhase | null,
  snapshot: MissionControlSnapshot
) {
  if (isOpenClawMissionReady(snapshot)) {
    return "ready";
  }

  if (snapshot.diagnostics.modelReadiness.ready && snapshot.diagnostics.runtime.smokeTest.status !== "passed") {
    return "smoke test";
  }

  return phase ? phase.replace("-", " ") : "waiting";
}

function formatProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openrouter") {
    return "OpenRouter";
  }

  if (normalized === "openai-codex") {
    return "OpenAI Codex";
  }

  if (normalized === "openai") {
    return "OpenAI";
  }

  if (normalized === "anthropic") {
    return "Anthropic";
  }

  if (normalized === "ollama") {
    return "Ollama";
  }

  return provider
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
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
