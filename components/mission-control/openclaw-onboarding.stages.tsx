"use client";

import { AlertTriangle, ArrowRight, Check, Copy, Info, LoaderCircle, SquareTerminal } from "lucide-react";
import { motion } from "motion/react";
import { useMemo, useState } from "react";

import { Button } from "@/components/ui/button";
import { PikoLoader } from "@/components/ui/piko-loader";
import { ProviderLogo } from "@/components/mission-control/provider-logo";
import { toast } from "@/components/ui/sonner";
import type {
  AddModelsProviderId,
  ChatGptBrowserAuthSnapshot,
  MissionControlSnapshot,
  OpenClawThinkingLevel
} from "@/lib/agentos/contracts";
import type { OpenClawModelOnboardingPhase, OperationProgressSnapshot } from "@/lib/agentos/contracts";
import {
  secondaryActionClassName,
  stepBadgeClassName,
  stepContainerClassName,
  stepIconClassName,
  resolveSelectedModelLabel,
  isChatGptConnectionReady,
  isChatGptProviderConnected,
  resolveChatGptOnboardingState,
  resolveChatGptProgressCopy,
  resolveChatGptRecoveryMessage,
  type StageRunDetails,
  type SurfaceTheme,
  type StepState
} from "@/components/mission-control/openclaw-onboarding.utils";
import { OpenClawOnboardingProviderFlow } from "@/components/mission-control/openclaw-onboarding-provider-flow";
import { formatModelLabel } from "@/lib/openclaw/presenters";
import { isOpenClawOnboardingModelReady } from "@/lib/openclaw/readiness";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import { openExternalAuthUrl } from "@/lib/desktop/open-external-auth-url";
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
  run,
  gatewayAuthNeedsSetup,
  onOpenGatewayAuthSettings
}: {
  steps: Array<{ id: string; label: string; description: string; state: StepState }>;
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
  run: StageRunDetails;
  gatewayAuthNeedsSetup: boolean;
  onOpenGatewayAuthSettings: () => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);

  return (
    <>
      <PikoLoader
        open={run.runState === "running"}
        title="Setting up OpenClaw"
        description={statusCopy || "Installing, starting, and verifying the local OpenClaw runtime."}
      />
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
          const isRuntimeStep = step.id === "runtime";
          const isChecking = step.state === "current" && run.runState === "running";
          const badgeLabel =
            step.state === "complete"
              ? "Ready"
              : step.state === "current"
                ? isChecking
                  ? "Checking"
                  : isRuntimeStep
                    ? "Needs verification"
                    : "Pending"
                : "Pending";

          return (
            <div
              key={step.id}
              className={cn(
                "relative flex items-center gap-1.5 overflow-hidden rounded-[12px] border px-2 py-1.5",
                isChecking
                  ? surfaceTheme === "light"
                    ? "shadow-[inset_0_1px_0_rgba(255,255,255,0.55),0_0_0_1px_rgba(215,178,154,0.18)]"
                    : "shadow-[inset_0_1px_0_rgba(255,255,255,0.03),0_0_0_1px_rgba(103,232,249,0.08)]"
                  : "",
                stepContainerClassName(step.state, surfaceTheme)
              )}
            >
              {isChecking ? (
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
                {isChecking ? (
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
                  ) : isChecking ? (
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
                    {badgeLabel}
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

      {gatewayAuthNeedsSetup ? (
        <div
          className={cn(
            "mt-2.5 rounded-[14px] border px-2.5 py-2",
            surfaceTheme === "light"
              ? "border-amber-300 bg-amber-50 text-amber-950"
              : "border-amber-300/22 bg-amber-300/10 text-amber-100"
          )}
        >
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <div className="min-w-0">
              <p className="text-[10px] font-medium">Native Gateway auth needs an env credential</p>
              <p
                className={cn(
                  "mt-1 text-[9px] leading-[0.95rem]",
                  surfaceTheme === "light" ? "text-amber-900/78" : "text-amber-100/78"
                )}
              >
                OpenClaw reports the Gateway secret as redacted. Generate a local token in Settings so AgentOS can use native WS instead of CLI fallback.
              </p>
              <Button
                type="button"
                size="sm"
                variant="secondary"
                onClick={onOpenGatewayAuthSettings}
                className={cn("mt-2", secondaryActionClassName(surfaceTheme))}
              >
                Configure Gateway auth
              </Button>
            </div>
          </div>
        </div>
      ) : null}
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
  selectedThinking,
  modelSwitchFeedback,
  localModelStatus,
  onSelectedModelIdChange,
  onSelectedThinkingChange,
  onClearModelSwitchFeedback,
  onOpenAddModels,
  onSnapshotChange,
  advancedProviderFlowOpen,
  onAdvancedProviderFlowOpenChange,
  onConnectChatGPT,
  chatGptBrowserAuth,
  onSubmitChatGptRedirect,
  onContinueFromAi,
  onRunModelSetDefault
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  statusCopy: string;
  showDetails: boolean;
  phaseLabel: string;
  run: StageRunDetails;
  modelPhase: OpenClawModelOnboardingPhase | null;
  selectedModelId: string;
  selectedThinking: OpenClawThinkingLevel;
  modelSwitchFeedback: ModelSwitchFeedback;
  localModelStatus?: { checked: boolean; defaultModelId: string | null; modelIds: string[] };
  onSelectedModelIdChange: (value: string) => void;
  onSelectedThinkingChange: (value: OpenClawThinkingLevel) => void;
  onClearModelSwitchFeedback: () => void;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  advancedProviderFlowOpen: boolean;
  onAdvancedProviderFlowOpenChange: (open: boolean) => void;
  onConnectChatGPT: (force?: boolean) => void;
  chatGptBrowserAuth: ChatGptBrowserAuthSnapshot | null;
  onSubmitChatGptRedirect: (redirectUrl: string) => void;
  onContinueFromAi: (thinking?: OpenClawThinkingLevel) => void;
  onRunModelSetDefault: (modelId?: string, thinking?: OpenClawThinkingLevel) => void;
}) {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [chatGptAttempted, setChatGptAttempted] = useState(false);
  const effectiveSnapshot = useMemo(() => {
    if (!localModelStatus?.checked || localModelStatus.modelIds.length === 0) {
      return snapshot;
    }

    const existingIds = new Set(snapshot.models.map((model) => model.id));
    const localModels = localModelStatus.modelIds
      .filter((modelId) => !existingIds.has(modelId))
      .map((modelId) => ({
        id: modelId,
        name: modelId.split("/").at(-1) || modelId,
        provider: modelId.includes("/") ? modelId.split("/")[0] : "unknown",
        input: "text",
        contextWindow: null,
        local: null,
        available: true,
        missing: false,
        tags: [] as string[],
        usageCount: 0
      }));

    return localModels.length > 0 ? { ...snapshot, models: [...snapshot.models, ...localModels] } : snapshot;
  }, [localModelStatus, snapshot]);
  const availableModels = useMemo(
    () => effectiveSnapshot.models.filter((model) => model.available !== false && !model.missing),
    [effectiveSnapshot.models]
  );
  const selectedModelLabel = useMemo(
    () => resolveSelectedModelLabel(selectedModelId, availableModels),
    [availableModels, selectedModelId]
  );
  const defaultModelId = localModelStatus?.checked
    ? localModelStatus.defaultModelId
    : snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
      snapshot.diagnostics.modelReadiness.defaultModel ||
      null;
  const selectedProvider = (selectedModelId.trim() || defaultModelId || "").split("/", 1)[0]?.toLowerCase() || null;
  const isLocalOllamaSelected = selectedProvider === "ollama";
  const modelReady = isOpenClawOnboardingModelReady(snapshot);
  const chatGptState = resolveChatGptOnboardingState({
    runState: run.runState,
    phase: modelPhase,
    modelReady: isOpenClawOnboardingModelReady(snapshot),
    chatGptConnected: isChatGptProviderConnected(snapshot)
  });
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
  const isChatGptBrowserPreparation = chatGptBrowserAuth?.state === "preparing" || chatGptBrowserAuth?.state === "waiting-for-browser";
  const isChatGptPostAuthSync = chatGptBrowserAuth?.state === "completed" && run.runState === "running";
  const isChatGptPreparation = isChatGptBrowserPreparation || isChatGptPostAuthSync;

  return (
    <>
      <PikoLoader
        open={run.runState === "running" && modelSwitchFeedback.phase === "idle" && (!chatGptBrowserAuth || isChatGptPreparation)}
        title={isChatGptBrowserPreparation
          ? "Preparing ChatGPT sign-in"
          : isChatGptPostAuthSync
            ? "Refreshing ChatGPT models"
          : modelSwitchFeedback.phase === "saving"
          ? "Switching default model"
          : advancedProviderFlowOpen
            ? "Preparing model setup"
            : "Connecting your AI"}
        description={isChatGptBrowserPreparation
          ? "Starting secure authentication with OpenClaw."
          : isChatGptPostAuthSync
            ? statusCopy || "Refreshing authentication and discovering models through OpenClaw."
          : modelSwitchFeedback.phase === "saving"
          ? statusCopy || "Saving the selected model in OpenClaw."
          : advancedProviderFlowOpen
            ? statusCopy || "Connecting the model route and verifying it in OpenClaw."
            : resolveChatGptProgressCopy(modelPhase === "verifying" ? "verifying" : "authenticating", statusCopy)}
      />
      {!advancedProviderFlowOpen && modelSwitchFeedback.phase === "idle" && !buildScene ? (
        <ConnectAiStage
          surfaceTheme={surfaceTheme}
          state={chatGptState}
          chatGptReady={isChatGptConnectionReady(snapshot)}
          chatGptAttempted={chatGptAttempted}
          chatGptBrowserAuth={chatGptBrowserAuth}
          defaultModelId={defaultModelId}
          statusMessage={run.statusMessage || run.resultMessage}
          onConnectChatGPT={(force) => {
            setChatGptAttempted(true);
            onConnectChatGPT(force);
          }}
          onSubmitChatGptRedirect={onSubmitChatGptRedirect}
          onContinueFromAi={onContinueFromAi}
          onRunModelSetDefault={onRunModelSetDefault}
          snapshot={effectiveSnapshot}
          selectedModelId={selectedModelId}
          selectedThinking={selectedThinking}
          onSelectedModelIdChange={onSelectedModelIdChange}
          onSelectedThinkingChange={onSelectedThinkingChange}
          onOpenAddModels={onOpenAddModels}
          onSnapshotChange={onSnapshotChange}
          onUseAnotherProvider={() => onAdvancedProviderFlowOpenChange(true)}
          isLocalOllamaSelected={isLocalOllamaSelected}
        />
      ) : (
        <>
          {modelSwitchFeedback.phase === "idle" ? (
            <div className="mt-3 flex items-center justify-between gap-3">
              <p className={cn("text-[11px] font-medium", surfaceTheme === "light" ? "text-[#33251c]" : "text-white")}>
                Step 2: Advanced model setup
              </p>
              {advancedProviderFlowOpen ? (
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => onAdvancedProviderFlowOpenChange(false)}
                  className={cn("h-8 rounded-full px-3 text-[11px]", secondaryActionClassName(surfaceTheme))}
                >
                  Back to Connect AI
                </Button>
              ) : null}
            </div>
          ) : null}

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
                nextModelLabel={resolveModelDisplayLabel(modelSwitchFeedback.nextModelId, availableModels)}
                onChangeAgain={onClearModelSwitchFeedback}
              />

              {modelSwitchFeedback.phase === "error" ? (
                <StageConsole
                  surfaceTheme={surfaceTheme}
                  statusCopy={statusCopy}
                  showDetails={showDetails}
                  phaseLabel={phaseLabel}
                  detailsOpen={detailsOpen}
                  onDetailsOpenChange={setDetailsOpen}
                  run={run}
                />
              ) : null}
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
                snapshot={effectiveSnapshot}
                surfaceTheme={surfaceTheme}
                selectedModelId={selectedModelId}
                onSelectedModelIdChange={onSelectedModelIdChange}
                onOpenAddModels={onOpenAddModels}
                onSnapshotChange={onSnapshotChange}
                autoDiscover={!modelReady}
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
      )}
    </>
  );
}

function ConnectAiStage({
  surfaceTheme,
  state,
  chatGptReady,
  chatGptAttempted,
  chatGptBrowserAuth,
  defaultModelId,
  statusMessage,
  onConnectChatGPT,
  onSubmitChatGptRedirect,
  onContinueFromAi,
  onRunModelSetDefault,
  snapshot,
  selectedModelId,
  selectedThinking,
  onSelectedModelIdChange,
  onSelectedThinkingChange,
  onOpenAddModels,
  onSnapshotChange,
  onUseAnotherProvider,
  isLocalOllamaSelected
}: {
  surfaceTheme: SurfaceTheme;
  state: ReturnType<typeof resolveChatGptOnboardingState>;
  chatGptReady: boolean;
  chatGptAttempted: boolean;
  chatGptBrowserAuth: ChatGptBrowserAuthSnapshot | null;
  defaultModelId: string | null;
  statusMessage: string | null;
  onConnectChatGPT: (force?: boolean) => void;
  onSubmitChatGptRedirect: (redirectUrl: string) => void;
  onContinueFromAi: (thinking?: OpenClawThinkingLevel) => void;
  onRunModelSetDefault: (modelId?: string, thinking?: OpenClawThinkingLevel) => void;
  snapshot: MissionControlSnapshot;
  selectedModelId: string;
  selectedThinking: OpenClawThinkingLevel;
  onSelectedModelIdChange: (value: string) => void;
  onSelectedThinkingChange: (value: OpenClawThinkingLevel) => void;
  onOpenAddModels: (provider?: AddModelsProviderId | null) => void;
  onSnapshotChange?: (snapshot: MissionControlSnapshot) => void;
  onUseAnotherProvider: () => void;
  isLocalOllamaSelected: boolean;
}) {
  const isBusy = state === "connecting" || state === "verifying";
  const isReady = state === "ready";
  const needsModelSelection = state === "needs-model";
  const showModelSelection = isReady || needsModelSelection;
  const isError = state === "error";
  const browserAuthBusy = Boolean(chatGptBrowserAuth && !["completed", "error"].includes(chatGptBrowserAuth.state));
  const browserAuthError = chatGptBrowserAuth?.state === "error";
  const connectedTitle = isLocalOllamaSelected
    ? "Ollama connected"
    : chatGptReady || chatGptAttempted || needsModelSelection
      ? "ChatGPT connected"
      : "AI connected";
  const [redirectUrl, setRedirectUrl] = useState("");
  const handleModelContinue = () => {
    const targetModelId = selectedModelId.trim();

    if (!targetModelId) {
      return;
    }

    if (isReady && targetModelId === (defaultModelId?.trim() ?? "")) {
      onContinueFromAi(selectedThinking);
      return;
    }

    onRunModelSetDefault(targetModelId, selectedThinking);
  };

  return (
    <div
      className={cn(
        "mx-auto flex max-w-[640px] flex-col items-center justify-center text-center",
        chatGptBrowserAuth ? "min-h-[220px] py-5 sm:min-h-[250px] sm:py-6" : "min-h-[320px] py-8"
      )}
    >
      <p
        className={cn(
          "text-[8px] uppercase tracking-[0.2em]",
          surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500"
        )}
      >
        {chatGptBrowserAuth ? "ChatGPT sign-in" : "Step 2"}
      </p>
      <h2 className={cn("mt-2 text-[22px] font-medium tracking-[-0.02em]", surfaceTheme === "light" ? "text-[#33251c]" : "text-white")}>
        {showModelSelection ? connectedTitle : chatGptBrowserAuth ? "Sign in to continue" : "Connect your AI"}
      </h2>
      <p className={cn("mt-2 max-w-[420px] text-[12px] leading-5", surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400")}>
        {showModelSelection
          ? isLocalOllamaSelected
            ? "Your local Ollama runtime is connected. Select a model or continue with the current default."
            : "Your ChatGPT account is connected. Select a model or continue with the current default."
          : chatGptBrowserAuth
            ? "Complete sign-in in the browser, then return here."
            : isLocalOllamaSelected
              ? "Use the Ollama model detected on this machine to power your agents locally."
              : "Connect your ChatGPT account to power your agents and start using AgentOS."}
      </p>

      {chatGptBrowserAuth ? (
        <div
          aria-busy={browserAuthBusy}
          aria-live="polite"
          role={browserAuthError ? "alert" : "status"}
          className={cn(
            "mt-5 w-full max-w-[380px] rounded-[12px] border px-3 py-2.5 text-left",
            surfaceTheme === "light"
              ? "border-sky-200 bg-sky-50/70 text-sky-950"
              : "border-sky-300/20 bg-sky-300/10 text-sky-100"
          )}
        >
          <div className="flex items-start gap-2">
            {browserAuthBusy ? <LoaderCircle className="mt-0.5 h-3.5 w-3.5 shrink-0 animate-spin" /> : <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />}
            <div className="min-w-0">
              <p className="text-[11px] font-semibold">{browserAuthError ? "ChatGPT sign-in needs attention" : "Waiting for ChatGPT"}</p>
              <p className="mt-0.5 text-[10px] leading-4 opacity-75">{chatGptBrowserAuth.message}</p>
            </div>
          </div>

          {chatGptBrowserAuth.browserUrl && chatGptBrowserAuth.state !== "completed" ? (
            <button
              type="button"
              onClick={() => {
                void openExternalAuthUrl(chatGptBrowserAuth.browserUrl!).catch((error) => {
                  toast.error("ChatGPT sign-in could not be opened.", {
                    description: error instanceof Error && error.message.includes("invalid OpenAI authorization URL")
                      ? error.message
                      : "The sign-in page could not be opened. Try Open sign-in again."
                  });
                });
              }}
              className={cn(
                "mt-2.5 inline-flex h-8 items-center rounded-md border px-2.5 text-[10px] font-semibold transition-colors",
                surfaceTheme === "light"
                  ? "border-sky-300 bg-white text-sky-800 hover:bg-sky-100"
                  : "border-sky-200/30 bg-white/10 text-sky-100 hover:bg-white/15"
              )}
            >
              Open sign-in
              <ArrowRight className="ml-1 h-3 w-3" />
            </button>
          ) : null}

          {chatGptBrowserAuth.state === "waiting-for-redirect" ? (
            <details className="mt-2.5 text-[10px]">
              <summary className={cn("cursor-pointer font-medium", surfaceTheme === "light" ? "text-sky-900/75" : "text-sky-100/75")}>
                Use callback URL manually
              </summary>
              <div className="mt-2">
                <p className="leading-4 opacity-70">If the browser does not return automatically, paste its full address.</p>
                <label className="sr-only" htmlFor="chatgpt-redirect-url">
                  ChatGPT callback URL
                </label>
                <input
                  id="chatgpt-redirect-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={redirectUrl}
                  onChange={(event) => setRedirectUrl(event.target.value)}
                  placeholder="http://localhost:1455/auth/callback?..."
                  className={cn(
                    "mt-2 h-8 w-full rounded-md border bg-transparent px-2.5 text-[10px] outline-none",
                    surfaceTheme === "light"
                      ? "border-sky-300 bg-white placeholder:text-sky-900/35 focus:border-sky-500"
                      : "border-sky-200/25 placeholder:text-sky-100/35 focus:border-sky-200/60"
                  )}
                />
                <Button
                  type="button"
                  onClick={() => {
                    onSubmitChatGptRedirect(redirectUrl);
                    setRedirectUrl("");
                  }}
                  disabled={!redirectUrl.trim()}
                  className="mt-2 h-8 w-full rounded-md text-[10px]"
                >
                  Finish sign-in
                </Button>
              </div>
            </details>
          ) : null}

          {chatGptBrowserAuth.state === "error" && chatGptBrowserAuth.error ? (
            <p className="mt-2 text-[10px] leading-4 text-rose-300">{resolveChatGptRecoveryMessage(chatGptBrowserAuth.error)}</p>
          ) : null}
        </div>
      ) : null}

      {showModelSelection ? (
        <div className="mt-5 w-full max-w-[420px] text-left">
          <OpenClawOnboardingProviderFlow
            snapshot={snapshot}
            surfaceTheme={surfaceTheme}
            selectedModelId={selectedModelId}
            selectedThinking={selectedThinking}
            onSelectedModelIdChange={onSelectedModelIdChange}
            onSelectedThinkingChange={onSelectedThinkingChange}
            onOpenAddModels={onOpenAddModels}
            onSnapshotChange={onSnapshotChange}
            autoDiscover
            compactSelection
            onContinue={handleModelContinue}
          />
          <button
            type="button"
            onClick={onUseAnotherProvider}
            className={cn(
              "mt-3 w-full rounded-full px-3 py-1.5 text-[11px] underline underline-offset-4",
              surfaceTheme === "light" ? "text-[#765845]" : "text-slate-300"
            )}
          >
            Use another provider
          </button>
        </div>
      ) : (
        <>
          {isError ? (
            <div className={cn("mt-5 w-full max-w-[420px] rounded-[14px] border px-3 py-2.5 text-left", surfaceTheme === "light" ? "border-rose-200 bg-rose-50 text-rose-900" : "border-rose-300/20 bg-rose-300/10 text-rose-100")}>
              <p className="text-[11px] font-semibold">ChatGPT needs attention</p>
              <p className="mt-1 text-[11px] leading-4 opacity-80">{resolveChatGptRecoveryMessage(statusMessage)}</p>
            </div>
          ) : null}
          {isBusy ? (
            <div className={cn("mt-5 flex items-center gap-2 text-[11px]", surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-300")}>
              <LoaderCircle className="h-3.5 w-3.5 animate-spin" />
              {resolveChatGptProgressCopy(state === "connecting" ? "authenticating" : "verifying", statusMessage)}
            </div>
          ) : null}
          {!isLocalOllamaSelected && (!chatGptBrowserAuth || browserAuthError) ? (
            <Button
              type="button"
              onClick={() => onConnectChatGPT(isError)}
              disabled={isBusy}
              className="chatgpt-connect-button group relative mt-6 h-10 min-w-[220px] overflow-hidden rounded-md border border-slate-200/90 !bg-white !px-4 text-[12px] font-semibold !text-slate-900 !shadow-[0_2px_0_rgba(15,23,42,0.12),0_8px_18px_rgba(15,23,42,0.12),inset_0_1px_0_rgba(255,255,255,0.96),inset_0_-1px_0_rgba(15,23,42,0.08)] transition-transform hover:-translate-y-0.5 hover:!bg-white hover:!shadow-[0_3px_0_rgba(15,23,42,0.12),0_10px_22px_rgba(15,23,42,0.16),inset_0_1px_0_rgba(255,255,255,0.96),inset_0_-1px_0_rgba(15,23,42,0.08)] active:translate-y-[1px] focus-visible:ring-slate-400/70 focus-visible:ring-offset-2 disabled:hover:translate-y-0"
            >
              <span className="relative z-10 inline-flex items-center gap-2">
                <ProviderLogo provider="openai" className="h-5 w-5 rounded-md border-slate-200/80 bg-white" />
                <span>{isError ? "Reconnect ChatGPT" : "Continue with ChatGPT"}</span>
              </span>
            </Button>
          ) : null}
          {isLocalOllamaSelected ? (
            <Button
              type="button"
              onClick={onUseAnotherProvider}
              disabled={isBusy}
              className={cn(
                "group relative mt-6 h-10 min-w-[220px] rounded-md border px-4 text-[12px] font-semibold",
                surfaceTheme === "light"
                  ? "border-violet-200 bg-violet-50 text-violet-900 hover:bg-violet-100"
                  : "border-violet-300/25 bg-violet-300/10 text-violet-100 hover:bg-violet-300/15"
              )}
            >
              <span className="inline-flex items-center gap-2">
                <ProviderLogo provider="ollama" className="h-5 w-5 rounded-md" />
                Configure Ollama
              </span>
            </Button>
          ) : null}
          {!browserAuthBusy ? (
            <button
              type="button"
              onClick={onUseAnotherProvider}
              disabled={isBusy}
              className={cn("mt-3 rounded-md px-3 py-1.5 text-[11px] underline underline-offset-4 disabled:cursor-not-allowed disabled:opacity-50", surfaceTheme === "light" ? "text-[#765845]" : "text-slate-300")}
            >
              Use another provider
            </button>
          ) : null}
        </>
      )}
    </div>
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
  nextModelLabel,
  onChangeAgain
}: {
  surfaceTheme: SurfaceTheme;
  feedback: ModelSwitchFeedback;
  nextModelLabel: string | null;
  onChangeAgain: () => void;
}) {
  const isLight = surfaceTheme === "light";
  const isRunning = feedback.phase === "saving";
  const isSuccess = feedback.phase === "success";
  const isError = feedback.phase === "error";
  const statusLabel = isSuccess ? "Saved" : isError ? "Error" : "Saving";
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
  return (
    <div
      className={cn(
        "mx-auto mt-4 w-full max-w-[560px] rounded-[14px] border px-3 py-3 sm:px-4",
        isLight
          ? isError
            ? "border-rose-200 bg-rose-50/70"
            : isSuccess
              ? "border-emerald-200 bg-emerald-50/70"
              : "border-[#e6d7cb] bg-white/80"
          : isError
            ? "border-rose-300/20 bg-rose-300/[0.07]"
            : isSuccess
              ? "border-emerald-300/18 bg-emerald-300/[0.06]"
              : "border-white/10 bg-white/[0.03]"
      )}
      role="status"
      aria-live="polite"
    >
      <div className="flex min-w-0 items-center gap-2.5">
          <span
            className={cn(
              "inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border",
              isSuccess
                ? isLight
                  ? "border-emerald-300 bg-white text-emerald-700"
                  : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                : isError
                  ? isLight
                    ? "border-rose-300 bg-white text-rose-700"
                    : "border-rose-300/25 bg-rose-300/10 text-rose-200"
                  : isLight
                    ? "border-[#d9b59a] bg-white text-[#8b6d5a]"
                    : "border-cyan-200/20 bg-cyan-300/10 text-cyan-100"
            )}
          >
            {isSuccess ? <Check className="h-3.5 w-3.5" /> : isError ? <AlertTriangle className="h-3.5 w-3.5" /> : <LoaderCircle className="h-3.5 w-3.5 animate-spin" />}
          </span>

          <div className="min-w-0 flex-1">
            <div className="flex items-center justify-between gap-2">
              <h3 className={cn("truncate text-[12px] font-medium", isLight ? "text-[#33251c]" : "text-white")}>
                {title}
              </h3>
              <span
                className={cn(
                  "shrink-0 text-[8px] uppercase tracking-[0.16em]",
                  isSuccess
                    ? isLight
                      ? "text-emerald-700"
                      : "text-emerald-200"
                    : isError
                      ? isLight
                        ? "text-rose-700"
                        : "text-rose-200"
                      : isLight
                        ? "text-[#977b69]"
                        : "text-slate-400"
                )}
              >
                {statusLabel}
              </span>
            </div>
            <p className={cn("mt-0.5 line-clamp-2 text-[10px] leading-4", isLight ? "text-[#705b4d]" : "text-slate-400")}>
              {detail}
            </p>
            {nextModelLabel ? (
              <p className={cn("mt-1 truncate text-[9px]", isLight ? "text-[#8f7664]" : "text-slate-500")} title={nextModelLabel}>
                Selected: {nextModelLabel}
              </p>
            ) : null}
          </div>

          {!isRunning ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={onChangeAgain}
              className={cn("h-7 shrink-0 rounded-md px-2.5 text-[10px]", secondaryActionClassName(surfaceTheme))}
            >
              Change again
            </Button>
          ) : null}
      </div>
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
  agentCount,
  workspaceSetupReady,
  operationalReady,
  canEnterAgentOS,
  runtimeSmokeStatus,
  runtimeSmokeDetail,
  defaultModelLabel,
  createProgress,
  createRunState
}: {
  surfaceTheme: SurfaceTheme;
  workspaceCount: number;
  agentCount: number;
  workspaceSetupReady: boolean;
  operationalReady: boolean;
  canEnterAgentOS: boolean;
  runtimeSmokeStatus: MissionControlSnapshot["diagnostics"]["runtime"]["smokeTest"]["status"];
  runtimeSmokeDetail: string | null | undefined;
  defaultModelLabel: string;
  createProgress: OperationProgressSnapshot | null;
  createRunState: "idle" | "running" | "success" | "error";
}) {
  const hasWorkspaces = workspaceCount > 0;
  const isBuildingWorkspace = createRunState === "running" && Boolean(createProgress);
  const hasWorkspaceCreateError = createRunState === "error" && Boolean(createProgress);
  const showBuildScene = Boolean(createProgress) && (isBuildingWorkspace || hasWorkspaceCreateError);
  const modelMetricLabel = workspaceSetupReady ? "Model" : "Detected model";
  const runtimeSmokeMetric = resolveRuntimeSmokeMetric(runtimeSmokeStatus, runtimeSmokeDetail);
  const nextStep = hasWorkspaces
    ? canEnterAgentOS
      ? "Enter AgentOS"
      : operationalReady
        ? "Finish setup"
        : "Verify runtime"
    : "Create workspace";

  return (
    <>
      <div
        className={cn(
          "mt-3 rounded-[14px] border px-3 py-3",
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
            <h2
              className={cn(
                "text-[16px] font-semibold leading-5 tracking-[-0.01em]",
                surfaceTheme === "light" ? "text-[#2d2118]" : "text-white"
              )}
            >
              OpenClaw is ready.
            </h2>
          </div>
        </div>

        {!showBuildScene ? (
          <div className="mt-3 grid grid-cols-2 gap-2">
            <LaunchpadMetric
              surfaceTheme={surfaceTheme}
              label="System"
              value="Online"
            />
            <LaunchpadMetric
              surfaceTheme={surfaceTheme}
              label={modelMetricLabel}
              value={defaultModelLabel}
            />
            <LaunchpadMetric
              surfaceTheme={surfaceTheme}
              label="Runtime"
              value={runtimeSmokeMetric.value}
            />
            <LaunchpadMetric
              surfaceTheme={surfaceTheme}
              label="Workspace"
              value={hasWorkspaces ? (agentCount > 0 ? "Visible" : "Pending") : String(workspaceCount)}
            />
          </div>
        ) : null}
      </div>

      {showBuildScene ? (
        <LaunchpadBuildScene surfaceTheme={surfaceTheme} progress={createProgress!} runState={createRunState} />
      ) : (
        <div
          className={cn(
            "mt-2.5 rounded-[12px] border px-3 py-2.5",
            surfaceTheme === "light" ? "border-[#e5d5c9] bg-[#fffaf6]" : "border-white/8 bg-[rgba(255,255,255,0.02)]"
          )}
        >
          <div className="flex min-w-0 items-center gap-2">
            <Info className={cn("h-3.5 w-3.5 shrink-0", surfaceTheme === "light" ? "text-[#977b69]" : "text-slate-500")} />
            <p className={cn("truncate text-[12px] font-medium", surfaceTheme === "light" ? "text-[#5f4b3e]" : "text-slate-300")}>
              Next: {nextStep}
            </p>
          </div>
        </div>
      )}
    </>
  );
}

function resolveRuntimeSmokeMetric(
  status: MissionControlSnapshot["diagnostics"]["runtime"]["smokeTest"]["status"],
  detail: string | null | undefined
) {
  switch (status) {
    case "passed":
      return {
        value: "Passed",
        detail: detail?.trim() || "A live agent turn was verified"
      };
    case "failed":
      return {
        value: "Failed",
        detail: detail?.trim() || "A real OpenClaw agent turn could not be verified"
      };
    case "not-run":
      return {
        value: "Pending",
        detail: "Run model setup to verify a real OpenClaw agent turn"
      };
    default:
      return {
        value: status,
        detail: detail?.trim() || "Runtime smoke status is reported by OpenClaw diagnostics"
      };
  }
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

      <div
        className={cn(
          "relative z-[1] mt-2.5 overflow-hidden rounded-[14px] border px-2.5 py-2",
          isLight ? "border-[#ead8c8] bg-white/70" : "border-white/8 bg-white/[0.04]"
        )}
      >
        <div
          aria-hidden="true"
          className={cn(
            "absolute inset-0 opacity-60",
            isLight
              ? "bg-[linear-gradient(90deg,transparent,rgba(216,180,254,0.12),transparent)]"
              : "bg-[linear-gradient(90deg,transparent,rgba(34,211,238,0.08),transparent)]"
          )}
        />
        <div className="relative z-[1] flex items-center gap-2">
          {["Workspace", "Starter agent", "Canvas"].map((label, index) => {
            const stepReady =
              index === 0
                ? progress.percent >= 28
                : index === 1
                  ? progress.percent >= 62
                  : progress.percent >= 88;
            const isCurrent = !isError && !stepReady && (
              index === 0 ||
              (index === 1 && progress.percent >= 28) ||
              (index === 2 && progress.percent >= 62)
            );

            return (
              <div key={label} className="flex min-w-0 flex-1 items-center gap-2">
                <div
                  className={cn(
                    "relative flex min-h-[52px] min-w-0 flex-1 flex-col justify-between rounded-[12px] border px-2 py-1.5",
                    stepReady
                      ? isLight
                        ? "border-emerald-200 bg-emerald-50/80"
                        : "border-emerald-300/20 bg-emerald-300/10"
                      : isCurrent
                        ? isLight
                          ? "border-[#d8b69b] bg-[#fff8f1]"
                          : "border-cyan-300/18 bg-cyan-300/[0.06]"
                        : isLight
                          ? "border-[#ead8c8] bg-white/65"
                          : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  {isCurrent ? (
                    <motion.div
                      aria-hidden="true"
                      className={cn(
                        "absolute inset-y-0 left-0 w-1/2",
                        isLight
                          ? "bg-gradient-to-r from-transparent via-[#d9b08d]/20 to-transparent"
                          : "bg-gradient-to-r from-transparent via-cyan-200/10 to-transparent"
                      )}
                      animate={{ x: ["-50%", "220%"] }}
                      transition={{ duration: 1.8, repeat: Infinity, ease: "linear" }}
                    />
                  ) : null}
                  <span
                    className={cn(
                      "relative z-[1] inline-flex h-5 w-5 items-center justify-center rounded-full border text-[8px]",
                      stepReady
                        ? isLight
                          ? "border-emerald-300 bg-white text-emerald-700"
                          : "border-emerald-300/25 bg-emerald-300/10 text-emerald-200"
                        : isLight
                          ? "border-[#dcc7b8] bg-white text-[#8b6f5c]"
                          : "border-white/10 bg-white/[0.05] text-slate-300"
                    )}
                  >
                    {stepReady ? <Check className="h-2.5 w-2.5" /> : isCurrent ? <LoaderCircle className="h-2.5 w-2.5 animate-spin" /> : index + 1}
                  </span>
                  <span
                    className={cn(
                      "relative z-[1] truncate text-[8px] leading-[0.9rem]",
                      isLight ? "text-[#5f4b3e]" : "text-slate-300"
                    )}
                  >
                    {label}
                  </span>
                </div>
                {index < 2 ? (
                  <span
                    className={cn(
                      "hidden h-px w-4 shrink-0 sm:block",
                      stepReady
                        ? isLight
                          ? "bg-emerald-300/70"
                          : "bg-emerald-300/45"
                        : isLight
                          ? "bg-[#dfcabb]"
                          : "bg-white/12"
                    )}
                  />
                ) : null}
              </div>
            );
          })}
        </div>
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
  value
}: {
  surfaceTheme: SurfaceTheme;
  label: string;
  value: string;
}) {
  return (
    <div
      className={cn(
        "flex min-h-[58px] min-w-0 items-center justify-between gap-3 rounded-[12px] border px-4 py-3",
        surfaceTheme === "light" ? "border-[#e6d7cb] bg-white" : "border-white/10 bg-white/[0.03]"
      )}
    >
      <p
        className={cn(
          "min-w-0 truncate text-[16px] font-semibold leading-5 tracking-[-0.01em]",
          surfaceTheme === "light" ? "text-[#33251c]" : "text-white"
        )}
      >
        {label}
      </p>
      <p
        title={value}
        className={cn(
          "min-w-0 shrink-0 truncate text-right text-[11px] font-semibold uppercase tracking-[0.08em]",
          surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-300"
        )}
      >
        {value}
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
  const canOpenTerminal = isOpenClawTerminalCommand(run.manualCommand);

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
