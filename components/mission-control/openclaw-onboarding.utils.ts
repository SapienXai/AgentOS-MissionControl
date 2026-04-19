import { formatModelLabel } from "@/lib/openclaw/presenters";
import {
  isOpenClawMissionReady,
  isOpenClawSystemReady
} from "@/lib/openclaw/readiness";
import type {
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawOnboardingPhase
} from "@/lib/agentos/contracts";

export type SurfaceTheme = "dark" | "light";
export type RunState = "idle" | "running" | "success" | "error";
export type WizardStage = "system" | "models";
export type StepState = "complete" | "current" | "pending";

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
      description: snapshot.diagnostics.installed
        ? `Installed${snapshot.diagnostics.version ? ` · v${snapshot.diagnostics.version}` : ""}`
        : "Install the OpenClaw CLI.",
      state: resolveStepState(cliComplete, !cliComplete && (phase === "detecting" || phase === "installing-cli"))
    },
    {
      id: "gateway",
      label: "Gateway service",
      description: snapshot.diagnostics.loaded
        ? "Gateway is already registered."
        : directGatewayRun
          ? "Gateway is running directly."
          : "Register the gateway service once.",
      state: resolveStepState(
        gatewayComplete,
        !gatewayComplete && (phase === "installing-gateway" || (cliComplete && phase === "detecting"))
      )
    },
    {
      id: "runtime",
      label: "Runtime ready",
      description: runtimeReady
        ? "RPC and state are ready."
        : phase === "installing-node"
          ? "Installing the node host service."
        : liveComplete
          ? "RPC is online; state checks continue in the background."
          : gatewayComplete
            ? "Gateway is up; verify RPC."
            : "Start the gateway and verify RPC.",
      state: resolveStepState(
        runtimeReady,
        !runtimeReady &&
          (phase === "starting-gateway" ||
            phase === "installing-node" ||
            phase === "verifying" ||
            (gatewayComplete && phase === "detecting"))
      )
    }
  ] as Array<{ id: string; label: string; description: string; state: StepState }>;
}

export function resolvePrimaryAction(params: {
  stage: WizardStage;
  systemReady: boolean;
  modelReady: boolean;
  systemActionLabel: string;
  selectedModelId: string;
  availableModelIds: string[];
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

  if (params.modelReady) {
    return { kind: "dismiss" as const, label: "Enter AgentOS" };
  }

  if (params.selectedModelId && params.availableModelIds.includes(params.selectedModelId)) {
    return { kind: "set-default" as const, label: "Use selected model" };
  }

  if (params.selectedModelId) {
    return { kind: "set-default" as const, label: "Use selected model" };
  }

  return { kind: "auto" as const, label: "Auto configure models" };
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

  return "Choose or connect a usable model route.";
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
  if (isOpenClawMissionReady(snapshot)) {
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
