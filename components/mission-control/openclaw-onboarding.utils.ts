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

export type StageRunDetails = {
  runState: RunState;
  statusMessage: string | null;
  resultMessage: string | null;
  log: string;
  manualCommand: string | null;
  docsUrl: string | null;
};

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

export function buildSystemSteps(snapshot: MissionControlSnapshot, phase: OpenClawOnboardingPhase | null) {
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
  const runtimeReady = liveComplete && runtimeStateComplete;

  return [
    {
      id: "cli",
      label: "OpenClaw CLI",
      description: resolveSystemStepDescription("cli", snapshot, phase, cliComplete, gatewayComplete, liveComplete, runtimeReady),
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
        runtimeReady
      ),
      state: resolveStepState(
        gatewayComplete,
        !gatewayComplete && (phase === "installing-gateway" || (cliComplete && phase === "detecting"))
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
        runtimeReady
      ),
      state: resolveStepState(
        runtimeReady,
        !runtimeReady &&
          (phase === "starting-gateway" ||
            phase === "verifying" ||
            (gatewayComplete && phase === "detecting"))
      )
    }
  ] as Array<{ id: string; label: string; description: string; state: StepState }>;
}

function resolveSystemStepDescription(
  stepId: SystemStepId,
  snapshot: MissionControlSnapshot,
  phase: OpenClawOnboardingPhase | null,
  cliComplete: boolean,
  gatewayComplete: boolean,
  liveComplete: boolean,
  runtimeReady: boolean
) {
  if (stepId === "cli") {
    if (snapshot.diagnostics.installed) {
      return `Installed${snapshot.diagnostics.version ? ` · v${snapshot.diagnostics.version}` : ""}`;
    }

    if (phase === "installing-cli") {
      return "Installing the CLI and local wrapper.";
    }

    if (phase === "detecting" || !snapshot.diagnostics.installed) {
      return "Checking whether the CLI is already installed.";
    }

    return "Install the OpenClaw CLI.";
  }

  if (stepId === "gateway") {
    if (snapshot.diagnostics.loaded) {
      return "Gateway is already registered.";
    }

    if (phase === "installing-gateway") {
      return "Registering the gateway service.";
    }

    if (phase === "starting-gateway") {
      return "Starting the gateway service.";
    }

    if (phase === "detecting" && cliComplete) {
      return "Checking gateway registration.";
    }

    if (liveComplete) {
      return "Gateway is up and waiting on RPC.";
    }

    if (phase === "verifying") {
      return "Gateway is up and waiting on RPC.";
    }

    if (snapshot.diagnostics.rpcOk) {
      return "Gateway is running directly.";
    }

    return "Register the gateway service once.";
  }

  if (runtimeReady) {
    return "RPC, state, and session store are ready.";
  }

  if (phase === "verifying") {
    return "Verifying RPC, state writes, and session store access.";
  }

  if (phase === "starting-gateway") {
    return "Starting the gateway and waiting for RPC.";
  }

  if (gatewayComplete) {
    return "Gateway is up; verify RPC and runtime state.";
  }

  if (liveComplete) {
    return "RPC is online; final runtime checks continue.";
  }

  return "Start the gateway and verify RPC.";
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

  if (normalized === "xai") {
    return "xAI";
  }

  if (normalized === "gemini") {
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

export function resolveInitialOnboardingProviderId(
  snapshot: MissionControlSnapshot,
  selectedModelId?: string | null
): AddModelsProviderId {
  const selectedProvider = resolveModelProvider(selectedModelId);

  if (isAddModelsProviderId(selectedProvider)) {
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

export function resolveInitialOnboardingModelId(snapshot: MissionControlSnapshot) {
  const resolvedDefaultModel =
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
    snapshot.diagnostics.modelReadiness.defaultModel ||
    null;

  if (
    snapshot.workspaces.length > 0 &&
    resolvedDefaultModel &&
    snapshot.diagnostics.modelReadiness.defaultModelReady
  ) {
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
