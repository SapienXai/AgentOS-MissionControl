import type { MissionControlSnapshot } from "@/lib/openclaw/types";

type SmokeTestFailureKind = "model-route" | "plugin-runtime";

type SmokeTestFailureClassification = {
  kind: SmokeTestFailureKind;
  detail: string;
};

export function resolveOpenClawRuntimePreflightError(snapshot: Pick<MissionControlSnapshot, "diagnostics">) {
  const combinedIssues = [
    ...(snapshot.diagnostics.issues ?? []),
    ...(snapshot.diagnostics.runtime.issues ?? [])
  ]
    .filter((issue): issue is string => typeof issue === "string")
    .join("\n");

  if (
    /failed to load bundled channel/i.test(combinedIssues) ||
    /plugin-runtime-deps/i.test(combinedIssues) ||
    /\bENOENT\b/i.test(combinedIssues)
  ) {
    return "OpenClaw runtime is missing bundled channel files after the update. Run `openclaw doctor --fix` and restart the gateway.";
  }

  return null;
}

export function classifyOpenClawRuntimeSmokeTestFailure(output: string): SmokeTestFailureClassification | null {
  const normalized = output.trim();

  if (!normalized) {
    return null;
  }

  if (
    /Unknown model:\s*openai-codex\/gpt-5\.4-mini/i.test(normalized) ||
    /not supported by the OpenAI Codex OAuth route/i.test(normalized)
  ) {
    return {
      kind: "model-route",
      detail:
        "OpenClaw rejected the active Codex model route. The model can exist in Codex, but this OpenClaw provider path could not run it. Try `openai-codex/gpt-5.5`, or use `openai/gpt-5.4-mini` with an OpenAI API key."
    };
  }

  if (
    /failed to load bundled channel/i.test(normalized) ||
    /plugin-runtime-deps/i.test(normalized) ||
    /\bENOENT\b/i.test(normalized)
  ) {
    return {
      kind: "plugin-runtime",
      detail:
        "bundled channel loading failed after the update. Run `openclaw doctor --fix` and restart the gateway."
    };
  }

  return null;
}

export function buildOpenClawRuntimeSmokeTestRecoveryCommand(command: string, output: string) {
  const classification = classifyOpenClawRuntimeSmokeTestFailure(output);

  if (classification?.kind === "model-route") {
    return `${command} models set openai-codex/gpt-5.5`;
  }

  return `${command} doctor --fix && ${command} gateway restart && ${command} gateway status --deep`;
}

export function resolveOpenClawRuntimeFailureMessage(output: string) {
  const classification = classifyOpenClawRuntimeSmokeTestFailure(output);

  if (!classification) {
    return null;
  }

  return classification.detail;
}
