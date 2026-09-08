import { formatModelLabel } from "@/lib/openclaw/presenters";
import {
  isOpenClawOnboardingModelReady,
  isOpenClawSystemReady
} from "@/lib/openclaw/readiness";
import { isAddModelsProviderId } from "@/lib/openclaw/model-provider-registry";
import type {
  AddModelsProviderId,
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawOnboardingPhase
} from "@/lib/agentos/contracts";

export type SurfaceTheme = "dark" | "light";
export type RunState = "idle" | "running" | "success" | "error";
export type WizardStage = "system" | "models";
export type StepState = "complete" | "current" | "pending";
type SystemStepId = "cli" | "gateway" | "runtime";

export const OPENAI_ONBOARDING_DEFAULT_MODEL_ID = "openai/gpt-5.6-luna";
export const ONBOARDING_DEFAULT_THINKING = "xhigh" as const;

export type StageRunDetails = {
  runState: RunState;
  statusMessage: string | null;
  resultMessage: string | null;
  log: string;
  manualCommand: string | null;
  docsUrl: string | null;
};

export type ChatGptOnboardingState = "idle" | "connecting" | "verifying" | "ready" | "needs-model" | "error";

export function resolveChatGptOnboardingState(params: {
  runState: RunState;
  phase: OpenClawModelOnboardingPhase | null;
  modelReady: boolean;
  chatGptConnected?: boolean;
}): ChatGptOnboardingState {
  if (params.runState === "error") {
    return "error";
  }

  if (params.runState === "running") {
    return params.phase === "authenticating" ? "connecting" : "verifying";
  }

  if (params.modelReady) {
    return "ready";
  }

  if (params.runState === "success" || params.chatGptConnected) {
    return "needs-model";
  }

  return "idle";
}

export function resolveChatGptProgressCopy(
  phase: OpenClawModelOnboardingPhase | null,
  statusMessage?: string | null
) {
  if (phase === "authenticating") {
    return "Waiting for ChatGPT sign-in to finish.";
  }

  if (phase === "verifying") {
    return "Verifying the account and a usable AI route in OpenClaw.";
  }

  if (phase === "refreshing" || phase === "detecting" || phase === "discovering") {
    return "Preparing your AI connection.";
  }

  return statusMessage?.trim() || "Connecting your AI through OpenClaw.";
}

export function resolveChatGptRecoveryMessage(message?: string | null) {
  const normalized = message?.trim().toLowerCase() || "";

  if (/capability consent|requires capability|codex.*plugin|plugin.*codex|agent harness/.test(normalized)) {
    return "OpenClaw needs the official Codex plugin enabled with its required capability consent before ChatGPT sign-in can continue. Retry to repair the local OpenClaw setup.";
  }

  if (/macos|local agentos|oauth.*gateway|not available in this environment/.test(normalized)) {
    return "ChatGPT sign-in is available from the local AgentOS machine. Use another provider here, or sign in locally first.";
  }

  if (/operator\.(?:admin|read|write|pairing)|device access|pending.*device/.test(normalized)) {
    return "OpenClaw's local device access needs operator scope. Repair Gateway device access in Settings, then retry ChatGPT sign-in.";
  }

  if (/auth refresh failed|could not refresh .* authentication|gateway auth refresh/i.test(normalized)) {
    return message?.trim() || "OpenClaw could not refresh the local ChatGPT authentication state. Try again when the Gateway is ready.";
  }

  if (/cancel|interrupted/.test(normalized)) {
    return "ChatGPT sign-in was cancelled before OpenClaw could save the account.";
  }

  if (/timed out|timeout/.test(normalized)) {
    return "ChatGPT sign-in took too long. Close any stale sign-in tab and try again.";
  }

  if (/model status|model catalog|active account|still refreshing|models\.list|gateway-native operation failed/.test(normalized)) {
    return "ChatGPT sign-in completed, but OpenClaw could not refresh the model catalog yet. Try again in a moment.";
  }

  if (/expired|reconnect|stale|account.*again|sign-in.*again|reauthor/.test(normalized)) {
    return "ChatGPT needs to be connected again. Reconnect to continue.";
  }

  return "We couldn't finish connecting ChatGPT. Try again or use another provider.";
}

export function isChatGptConnectionReady(snapshot: MissionControlSnapshot) {
  return isChatGptProviderConnected(snapshot) && isOpenClawOnboardingModelReady(snapshot);
}

export function isChatGptProviderConnected(snapshot: MissionControlSnapshot) {
  return snapshot.diagnostics.modelReadiness.authProviders.some(
    (provider) => provider.connected && provider.provider === "openai" && provider.authMethod === "chatgpt-oauth"
  );
}

export function isOnboardingModelStepComplete(params: {
  chatGptConnectionReady: boolean;
  explicitSetupComplete: boolean;
}) {
  return params.chatGptConnectionReady || params.explicitSetupComplete;
}

export function buildWizardSteps(stage: WizardStage, systemReady: boolean, modelReady: boolean) {
  return [
    {
      id: "system",
      order: 1,
      label: "System setup",
      description: "CLI, gateway, RPC",
      state: resolveStepState(systemReady, stage === "system" && !systemReady)
    },
    {
      id: "models",
      order: 2,
      label: "Model setup",
      description: "Default model, auth",
      state: resolveStepState(modelReady, stage === "models" && !modelReady)
    }
  ] as Array<{ id: string; order: number; label: string; description: string; state: StepState }>;
}

export function resolveEffectiveWizardStage(stage: WizardStage, systemReady: boolean): WizardStage {
  return systemReady ? stage : "system";
}

export function buildSystemSteps(
  snapshot: MissionControlSnapshot,
  phase: OpenClawOnboardingPhase | null,
  options: {
    forcePending?: boolean;
    cliInstalled?: boolean | null;
    gatewayReachable?: boolean | null;
    gatewayRegistered?: boolean | null;
    gatewayReady?: boolean | null;
    runtimeWritable?: boolean | null;
    suppressGatewaySnapshot?: boolean;
  } = {}
) {
  const forcePending = options.forcePending === true;
  const gatewayProbeResolved = options.gatewayReachable != null;
  const installedFromStatus =
    options.cliInstalled === undefined
      ? snapshot.diagnostics.installed
      : options.cliInstalled === true;
  const directGatewayRun =
    options.gatewayReachable !== false &&
    !forcePending &&
    snapshot.diagnostics.rpcOk &&
    !snapshot.diagnostics.loaded;
  const cliComplete = phase === "installing-cli"
    ? false
    : (!forcePending && installedFromStatus) ||
      phase === "installing-gateway" ||
      phase === "starting-gateway" ||
      phase === "verifying" ||
      phase === "ready";
  const hasConfirmedGatewayRegistration = !forcePending && cliComplete && options.gatewayRegistered === true;
  const gatewayComplete =
    hasConfirmedGatewayRegistration ||
    options.gatewayReachable === true ||
    (!gatewayProbeResolved && !options.suppressGatewaySnapshot && !forcePending && snapshot.diagnostics.loaded) ||
    directGatewayRun ||
    phase === "verifying" ||
    phase === "ready";
  const liveComplete =
    options.gatewayReady === true ||
    (!forcePending && snapshot.diagnostics.rpcOk) ||
    phase === "ready";
  const runtimeStateComplete =
    options.runtimeWritable === true ||
    (!forcePending && snapshot.diagnostics.runtime.stateWritable && snapshot.diagnostics.runtime.sessionStoreWritable) ||
    phase === "ready";
  const runtimeReady = liveComplete && runtimeStateComplete;

  return [
    {
      id: "cli",
      label: "OpenClaw CLI",
      description: resolveSystemStepDescription(
        "cli",
        snapshot,
        phase,
        cliComplete,
        gatewayComplete,
        liveComplete,
        runtimeReady,
        forcePending,
        hasConfirmedGatewayRegistration
      ),
      state: resolveStepState(cliComplete, !cliComplete && (phase === "detecting" || phase === "installing-cli"))
    },
    {
      id: "gateway",
      label: "Gateway service",
      description: resolveSystemStepDescription(
        "gateway",
        snapshot,
        phase,
        cliComplete,
        gatewayComplete,
        liveComplete,
        runtimeReady,
        forcePending,
        hasConfirmedGatewayRegistration
      ),
      state: resolveStepState(
        gatewayComplete,
        !gatewayComplete && (
          phase === "installing-gateway" ||
          phase === "starting-gateway" ||
          (cliComplete && phase === "detecting")
        )
      )
    },
    {
      id: "runtime",
      label: "Runtime ready",
      description: resolveSystemStepDescription(
        "runtime",
        snapshot,
        phase,
        cliComplete,
        gatewayComplete,
        liveComplete,
        runtimeReady,
        forcePending,
        hasConfirmedGatewayRegistration
      ),
      state: resolveStepState(
        runtimeReady,
        !runtimeReady &&
          (phase === "verifying" ||
            (gatewayComplete && phase === "detecting") ||
            gatewayComplete ||
            liveComplete)
      )
    }
  ] as Array<{ id: string; label: string; description: string; state: StepState }>;
}

export function resolveSystemStepActionLabel(
  steps: Array<{ id: string; state: StepState }>,
  fallback: string
) {
  const activeStep = steps.find((step) => step.state === "current")
    ?? steps.find((step) => step.state === "pending");

  if (activeStep?.id === "cli") {
    return "Install OpenClaw";
  }

  if (activeStep?.id === "gateway") {
    return "Prepare local gateway";
  }

  if (activeStep?.id === "runtime") {
    return "Start OpenClaw";
  }

  return fallback;
}

function resolveSystemStepDescription(
  stepId: SystemStepId,
  snapshot: MissionControlSnapshot,
  phase: OpenClawOnboardingPhase | null,
  cliComplete: boolean,
  gatewayComplete: boolean,
  liveComplete: boolean,
  runtimeReady: boolean,
  forcePending: boolean,
  gatewayRegistered?: boolean | null
) {
  if (stepId === "cli") {
    if (!forcePending && cliComplete) {
      return `Ready${snapshot.diagnostics.version ? ` · v${snapshot.diagnostics.version}` : ""}`;
    }

    if (phase === "installing-cli") {
      return "Installing OpenClaw CLI.";
    }

    if (phase === "detecting" || forcePending || !snapshot.diagnostics.installed) {
      return "Checking CLI installation.";
    }

    return "Install OpenClaw CLI.";
  }

  if (stepId === "gateway") {
    if (gatewayRegistered === true || (!forcePending && snapshot.diagnostics.loaded)) {
      return "Registered and configured.";
    }

    if (phase === "installing-gateway") {
      return "Applying local Gateway configuration.";
    }

    if (phase === "starting-gateway") {
      return "Starting the Gateway service.";
    }

    if (phase === "detecting" && cliComplete) {
      return "Checking Gateway configuration.";
    }

    if (liveComplete) {
      return "Gateway started; waiting for RPC.";
    }

    if (phase === "verifying") {
      return "Gateway is up and waiting on RPC.";
    }

    if (!forcePending && snapshot.diagnostics.rpcOk) {
      return "Gateway is running directly.";
    }

    if (gatewayComplete) {
      return "Gateway is reachable.";
    }

    return "Register and configure the local Gateway.";
  }

  if (runtimeReady) {
    return "RPC and runtime storage are ready.";
  }

  if (phase === "verifying") {
    return "Verifying RPC and runtime storage.";
  }

  if (phase === "starting-gateway") {
    return "Starting Gateway and waiting for RPC.";
  }

  if (gatewayComplete) {
    return "Gateway is ready for runtime checks.";
  }

  if (liveComplete) {
    return "RPC is online; checking runtime storage.";
  }

  return "Start Gateway and verify runtime readiness.";
}

export function resolvePrimaryAction(params: {
  stage: WizardStage;
  systemReady: boolean;
  modelReady: boolean;
  systemActionLabel: string;
  selectedModelId: string;
  defaultModelId?: string | null;
}) {
  if (params.stage === "system") {
    if (params.systemReady && params.modelReady) {
      return { kind: "dismiss" as const, label: "Enter AgentOS" };
    }

    if (params.systemReady) {
      return { kind: "continue" as const, label: "Continue to model setup" };
    }

    return { kind: "system" as const, label: params.systemActionLabel };
  }

  const selectedModelId = params.selectedModelId.trim();
  const defaultModelId = params.defaultModelId?.trim() ?? "";

  if (selectedModelId) {
    if (params.modelReady && selectedModelId === defaultModelId) {
      return { kind: "dismiss" as const, label: "Enter AgentOS" };
    }

    if (selectedModelId === defaultModelId) {
      return { kind: "set-default" as const, label: "Verify model setup" };
    }

    return { kind: "set-default" as const, label: "Set as default" };
  }

  if (params.modelReady) {
    return { kind: "dismiss" as const, label: "Enter AgentOS" };
  }

  return { kind: "select-model" as const, label: "Select a model" };
}

export function resolveSelectedModelLabel(
  selectedModelId: string,
  availableModels: Array<{ id: string; name: string; provider: string }>
) {
  if (!selectedModelId.trim()) {
    return null;
  }

  const selectedModel = availableModels.find((model) => model.id === selectedModelId);
  return selectedModel?.name || formatModelLabel(selectedModelId);
}

export function resolveStageDescription(
  stage: WizardStage,
  systemActionDescription: string,
  selectedModelLabel?: string | null
) {
  if (stage === "system") {
    return systemActionDescription;
  }

  if (selectedModelLabel) {
    return `Selected model: ${selectedModelLabel}.`;
  }

  return "Choose a provider, connect it, and then pick a model.";
}

export function resolveStepState(complete: boolean, current: boolean): StepState {
  if (complete) {
    return "complete";
  }

  if (current) {
    return "current";
  }

  return "pending";
}

export function resolveStageBadgeLabel(runState: RunState, stage: WizardStage, modelReady: boolean) {
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

export function stageBadgeClassName(runState: RunState, modelReady: boolean, surfaceTheme: SurfaceTheme) {
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

export function secondaryActionClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border-[#b89374] bg-[#ecd4c1] text-[#4a3426] shadow-[inset_0_1px_0_rgba(255,255,255,0.55)] hover:bg-[#e4c6af] hover:text-[#38261b]"
    : "border-white/10 bg-white/[0.05] text-slate-200 hover:bg-white/[0.1]";
}

export function ghostActionClassName(surfaceTheme: SurfaceTheme) {
  return surfaceTheme === "light"
    ? "border border-[#d7bca7] bg-[#f8ede4] text-[#5a4131] hover:bg-[#eedbcc] hover:text-[#3f2d21]"
    : "text-slate-500 hover:bg-white/[0.08] hover:text-slate-200";
}

export function resolveSystemPhaseLabel(
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

export function resolveModelPhaseLabel(
  phase: OpenClawModelOnboardingPhase | null,
  snapshot: MissionControlSnapshot
) {
  if (isOpenClawOnboardingModelReady(snapshot)) {
    return "ready";
  }

  if (snapshot.diagnostics.modelReadiness.ready && snapshot.diagnostics.runtime.smokeTest.status !== "passed") {
    return "smoke test";
  }

  return phase ? phase.replace("-", " ") : "waiting";
}

export function formatProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openrouter") {
    return "OpenRouter";
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

  if (normalized === "xai") {
    return "xAI";
  }

  if (normalized === "google" || normalized === "gemini") {
    return "Gemini";
  }

  if (normalized === "deepseek") {
    return "DeepSeek";
  }

  if (normalized === "mistral") {
    return "Mistral";
  }

  return provider
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1) : part))
    .join(" ");
}

export function resolveModelProvider(modelId?: string | null) {
  const normalized = modelId?.trim();

  if (!normalized) {
    return null;
  }

  const [provider] = normalized.split("/", 1);
  return provider || null;
}

export function resolveOnboardingModelProviderId(
  snapshot: MissionControlSnapshot,
  modelId?: string | null
): AddModelsProviderId | null {
  const modelProvider = resolveModelProvider(modelId);

  if (!modelProvider) {
    return null;
  }

  return isAddModelsProviderId(modelProvider) ? modelProvider : null;
}

export function resolveSelectedOnboardingProviderId(
  snapshot: MissionControlSnapshot,
  modelId?: string | null,
  catalogModels: Array<{ id: string; provider: string }> = []
): AddModelsProviderId | null {
  const normalizedModelId = modelId?.trim();

  if (!normalizedModelId) {
    return null;
  }

  const catalogProvider = catalogModels.find(
    (model) => model.id === normalizedModelId && isAddModelsProviderId(model.provider)
  )?.provider;

  if (isAddModelsProviderId(catalogProvider)) {
    return catalogProvider;
  }

  const snapshotProvider = snapshot.models.find(
    (model) => model.id === normalizedModelId && isAddModelsProviderId(model.provider)
  )?.provider;

  if (isAddModelsProviderId(snapshotProvider)) {
    return snapshotProvider;
  }

  return resolveOnboardingModelProviderId(snapshot, normalizedModelId);
}

export function resolveInitialOnboardingProviderId(
  snapshot: MissionControlSnapshot,
  selectedModelId?: string | null
): AddModelsProviderId {
  const selectedProvider = resolveOnboardingModelProviderId(snapshot, selectedModelId);

  if (selectedProvider) {
    return selectedProvider;
  }

  const connectedProvider = snapshot.diagnostics.modelReadiness.authProviders.find(
    (provider): provider is (typeof snapshot.diagnostics.modelReadiness.authProviders)[number] & {
      provider: AddModelsProviderId;
    } => provider.connected && isAddModelsProviderId(provider.provider)
  )?.provider;

  if (connectedProvider) {
    return connectedProvider;
  }

  const preferredLoginProvider = snapshot.diagnostics.modelReadiness.preferredLoginProvider;

  if (isAddModelsProviderId(preferredLoginProvider)) {
    return preferredLoginProvider;
  }

  const recommendedProvider = resolveModelProvider(snapshot.diagnostics.modelReadiness.recommendedModelId);

  if (isAddModelsProviderId(recommendedProvider)) {
    return recommendedProvider;
  }

  return "openrouter";
}

export function resolveOnboardingModelSelection(
  modelReadiness: Pick<
    MissionControlSnapshot["diagnostics"]["modelReadiness"],
    "resolvedDefaultModel" | "recommendedModelId" | "defaultModel"
  >,
  models: Array<{ id: string }>
) {
  const normalizedModelIds = new Map(
    models.map((model) => [model.id.trim().toLowerCase(), model.id])
  );
  const candidates = [
    modelReadiness.resolvedDefaultModel,
    modelReadiness.recommendedModelId,
    modelReadiness.defaultModel
  ];

  const localCandidate = candidates.find((candidate) => {
    const normalizedCandidate = candidate?.trim().toLowerCase();
    return normalizedCandidate?.startsWith("ollama/") && normalizedModelIds.has(normalizedCandidate);
  });

  if (localCandidate) {
    return normalizedModelIds.get(localCandidate.trim().toLowerCase()) ?? null;
  }

  const preferredModelId = normalizedModelIds.get(OPENAI_ONBOARDING_DEFAULT_MODEL_ID);

  if (preferredModelId) {
    return preferredModelId;
  }

  for (const candidate of candidates) {
    const normalizedCandidate = candidate?.trim().toLowerCase();
    const discoveredModelId = normalizedCandidate ? normalizedModelIds.get(normalizedCandidate) : undefined;

    if (discoveredModelId) {
      return discoveredModelId;
    }
  }

  return models[0]?.id || null;
}

export function resolveInitialOnboardingModelId(snapshot: MissionControlSnapshot) {
  const configuredDefaultModelId =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    null;
  const configuredDefaultModel = configuredDefaultModelId
    ? (snapshot.models ?? []).find((model) => model.id.trim().toLowerCase() === configuredDefaultModelId.trim().toLowerCase())
    : null;

  if (
    configuredDefaultModel &&
    (configuredDefaultModel.provider === "ollama" || configuredDefaultModel.local === true)
  ) {
    return configuredDefaultModel.id;
  }

  const preferredModel = (snapshot.models ?? []).find(
    (model) =>
      model.id.trim().toLowerCase() === OPENAI_ONBOARDING_DEFAULT_MODEL_ID &&
      model.available !== false &&
      !model.missing
  );

  if (preferredModel) {
    return preferredModel.id;
  }

  const resolvedDefaultModel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    null;

  if (resolvedDefaultModel && snapshot.diagnostics.modelReadiness.defaultModelReady) {
    return resolvedDefaultModel;
  }

  const recommendedModelId = snapshot.diagnostics.modelReadiness.recommendedModelId || null;

  if (!recommendedModelId) {
    return null;
  }

  if (snapshot.workspaces.length > 0) {
    return recommendedModelId;
  }

  return null;
}

export function stepContainerClassName(state: StepState, surfaceTheme: SurfaceTheme) {
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

export function stepIconClassName(state: StepState, surfaceTheme: SurfaceTheme) {
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

export function stepBadgeClassName(state: StepState, surfaceTheme: SurfaceTheme) {
  if (state === "complete") {
    return surfaceTheme === "light" ? "bg-emerald-100 text-emerald-700" : "bg-emerald-300/10 text-emerald-200";
  }

  if (state === "current") {
    return surfaceTheme === "light" ? "bg-[#efe1d4] text-[#876c5a]" : "bg-white/[0.06] text-slate-300";
  }

  return surfaceTheme === "light" ? "bg-[#f6ece4] text-[#a08471]" : "bg-white/[0.04] text-slate-500";
}
