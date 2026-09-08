import { spawn } from "node:child_process";

import { NextResponse } from "next/server";
import { z } from "zod";

import { formatOpenClawCommand, resolveOpenClawBin } from "@/lib/openclaw/cli";
import { buildOpenClawSpawnEnv, resolveOpenClawSpawnInvocation } from "@/lib/openclaw/install";
import {
  isOpenClawMissionReady,
  isOpenClawOnboardingSystemReady
} from "@/lib/openclaw/readiness";
import {
  ensureOpenClawRuntimeSmokeTest,
  getMissionControlSnapshot
} from "@/lib/agentos/control-plane";
import {
  ensureOpenClawOllamaLocalCredential,
  setOpenClawDefaultModel
} from "@/lib/openclaw/application/model-provider-state-service";
import {
  buildGatewayAuthBlockedMessage,
  isGatewayAuthSetupRecoveryError,
  repairGatewayAuthForModelSetupSnapshot,
  resolveGatewayAuthSetupIssueFromSnapshot,
  runWithGatewayAuthSetupRecovery
} from "@/lib/openclaw/model-setup-recovery";
import { resolveOpenAiAuthHandoff } from "@/lib/openclaw/model-auth-errors";
import { connectOpenClawChatGptProvider } from "@/lib/openclaw/application/chatgpt-provider-auth-service";
import { resolveRequiredLoginProvider } from "@/lib/openclaw/model-onboarding";
import {
  isAddModelsProviderId,
  isBuiltInAddModelsProviderId,
  normalizeAddModelsProviderId
} from "@/lib/openclaw/model-provider-registry";
import { readOpenClawCodexPluginReady } from "@/lib/openclaw/application/model-provider-state-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import type {
  DiscoveredModelCandidate,
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawModelOnboardingStreamEvent
} from "@/lib/agentos/contracts";
import type { AddModelsProviderId } from "@/lib/openclaw/types";
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const docsUrl = "https://docs.openclaw.ai/cli/models";
const commandTimeoutMs = 10 * 60 * 1000;

const modelOnboardingSchema = z.discriminatedUnion("intent", [
  z.object({
    intent: z.literal("auto"),
    modelId: z.string().trim().min(1).optional()
  }),
  z.object({
    intent: z.literal("refresh")
  }),
  z.object({
    intent: z.literal("verify")
  }),
  z.object({
    intent: z.literal("discover")
  }),
  z.object({
    intent: z.literal("set-default"),
    modelId: z.string().trim().min(1)
  }),
  z.object({
    intent: z.literal("login-provider"),
    provider: z.string().trim().min(1),
    force: z.boolean().optional()
  })
]);

type ModelOnboardingInput = z.infer<typeof modelOnboardingSchema>;

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorMessage?: string;
};

export async function POST(request: Request) {
  let input: ModelOnboardingInput;

  try {
    input = modelOnboardingSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Model onboarding intent is required.")
      },
      { status: 400 }
    );
  }

  if (input.intent === "login-provider") {
    const provider = normalizeAddModelsProviderId(input.provider);

    if (!provider || !isBuiltInAddModelsProviderId(provider)) {
      return NextResponse.json(
        { error: "Provider login must target a supported bundled OpenClaw provider." },
        { status: 400 }
      );
    }

    const permission = await requireAgentOsProductPermission(request, "secrets.manage");
    if ("response" in permission) return permission.response;

    input = { ...input, provider };
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let writeChain = Promise.resolve();
  let streamClosed = false;

  const send = (event: OpenClawModelOnboardingStreamEvent) => {
    const safeEvent = redactSecrets(event);
    if (streamClosed) {
      return Promise.resolve();
    }

    writeChain = writeChain
      .then(() => {
        if (streamClosed) {
          return;
        }

        return writer.write(encoder.encode(`${JSON.stringify(safeEvent)}\n`));
      })
      .catch(() => {});

    return writeChain;
  };

  const closeWriter = async () => {
    if (streamClosed) {
      return;
    }

    streamClosed = true;

    try {
      await writeChain;
    } catch {
      // Ignore late stream errors during shutdown.
    }

    try {
      await writer.close();
    } catch {
      // Ignore duplicate close attempts or a closed writer.
    }
  };

  void (async () => {
    let aggregatedStdout = "";
    let aggregatedStderr = "";
    let manualCommandBin = "openclaw";
    let codexPluginReady = false;

    const fail = async (
      phase: OpenClawModelOnboardingPhase,
      message: string,
      options: {
        exitCode?: number | null;
        snapshot?: MissionControlSnapshot;
        manualCommand?: string;
        docsUrl?: string;
        discoveredModels?: DiscoveredModelCandidate[];
      } = {}
    ) => {
      await send({
        type: "done",
        ok: false,
        phase,
        message,
        exitCode: options.exitCode ?? null,
        stdout: aggregatedStdout,
        stderr: aggregatedStderr,
        snapshot: options.snapshot,
        manualCommand: options.manualCommand,
        docsUrl: options.docsUrl,
        discoveredModels: options.discoveredModels
      });
      await closeWriter();
    };

    const verifyReady = async (
      message: string,
      preferredModelId?: string | null,
      manualCommand?: string | null
    ) => {
      const snapshot = await getMissionControlSnapshot({ force: true });

      if (!isModelReady(snapshot)) {
        const failure = resolveVerificationFailure(snapshot, preferredModelId, manualCommandBin, {
          codexPluginReady
        });

        await fail("verifying", failure.message || message, {
          snapshot,
            manualCommand:
              manualCommand ??
              failure.manualCommand ??
              buildModelManualCommand(snapshot, preferredModelId, manualCommandBin, {
                codexPluginReady
              }) ?? undefined,
          docsUrl
        });
        return null;
      }

      await send({
        type: "status",
        phase: "verifying",
        message: "Running a live runtime smoke test..."
      });

      const smokeTest = await ensureOpenClawRuntimeSmokeTest({ force: true });

      if (smokeTest.status !== "passed") {
        const freshSnapshot = await getMissionControlSnapshot({ force: true });
        aggregatedStderr = aggregatedStderr
          ? `${aggregatedStderr}\n${smokeTest.error || "Runtime smoke test failed."}`
          : smokeTest.error || "Runtime smoke test failed.";

        await fail(
          "verifying",
          smokeTest.error
            ? `AgentOS could not verify a real agent turn. ${smokeTest.error}`
            : "AgentOS could not verify a real agent turn yet.",
          {
            snapshot: freshSnapshot,
            manualCommand:
              manualCommand ??
              buildModelManualCommand(freshSnapshot, preferredModelId, manualCommandBin, {
                codexPluginReady
              }) ?? undefined,
            docsUrl
          }
        );
        return null;
      }

      aggregatedStdout = aggregatedStdout
        ? `${aggregatedStdout}\n${smokeTest.summary || "Runtime smoke test passed."}`
        : smokeTest.summary || "Runtime smoke test passed.";
      const readySnapshot = await getMissionControlSnapshot({ force: true });

      await send({
        type: "done",
        ok: true,
        phase: "ready",
        message: "A usable default model is ready. Choose your next step.",
        exitCode: 0,
        stdout: aggregatedStdout,
        stderr: aggregatedStderr,
        snapshot: readySnapshot
      });
      await closeWriter();
      return readySnapshot;
    };

    try {
      await send({
        type: "status",
        phase:
          input.intent === "refresh"
            ? "refreshing"
            : input.intent === "verify"
              ? "verifying"
            : input.intent === "discover"
              ? "discovering"
              : "detecting",
        message: resolveInitialStatusMessage(input.intent)
      });

      let snapshot = await getMissionControlSnapshot({ force: true });
      manualCommandBin = await resolveOpenClawBin().catch(() => "openclaw");
      codexPluginReady = await readOpenClawCodexPluginReady().catch(() => false);

      if (!isSystemReady(snapshot)) {
        try {
          const repaired = await repairGatewayAuthForModelSetupSnapshot(snapshot, {
            operationLabel: "model setup",
            onStatus: (message) => send({
              type: "status",
              phase: "detecting",
              message
            })
          });

          if (repaired) {
            aggregatedStdout = appendLine(
              aggregatedStdout,
              repaired.kind === "gateway-token"
                ? "AgentOS repaired local Gateway token auth for model setup."
                : "AgentOS repaired local Gateway device access for model setup."
            );
            snapshot = await getMissionControlSnapshot({ force: true });
          }
        } catch (error) {
          const recoveryMessage = error instanceof Error
            ? error.message
            : "Gateway auth repair failed during model setup.";
          aggregatedStderr = appendLine(aggregatedStderr, recoveryMessage);
          await fail("detecting", recoveryMessage, {
            snapshot,
            manualCommand: formatOpenClawCommand(manualCommandBin, ["gateway", "status", "--json"])
          });
          return;
        }

        if (!isSystemReady(snapshot)) {
          const gatewayIssue = resolveGatewayAuthSetupIssueFromSnapshot(snapshot);

          await fail(
            "detecting",
            gatewayIssue
              ? buildGatewayAuthBlockedMessage(gatewayIssue, "model setup")
              : "OpenClaw system setup is not ready yet. Start or repair the Gateway, run agentos doctor, then retry model setup.",
            {
              snapshot,
              manualCommand: formatOpenClawCommand(manualCommandBin, ["gateway", "status", "--json"])
            }
          );
          return;
        }
      }

      if (input.intent === "refresh") {
        if (isOpenClawMissionReady(snapshot)) {
          await send({
            type: "done",
            ok: true,
            phase: "ready",
            message: "A usable default model and runtime preflight are already configured.",
            exitCode: 0,
            stdout: aggregatedStdout,
            stderr: aggregatedStderr,
            snapshot
          });
          await closeWriter();
          return;
        }

        await fail("refreshing", "Model setup still needs attention.", {
          snapshot,
          manualCommand: buildModelManualCommand(snapshot, undefined, manualCommandBin, {
            codexPluginReady
          }) ?? undefined,
          docsUrl
        });
        return;
      }

      if (input.intent === "verify") {
        await verifyReady("ChatGPT connected, but no usable default model was verified yet.");
        return;
      }

      const openClawBin = await resolveOpenClawBin();

      if (input.intent === "discover") {
        await send({
          type: "status",
          phase: "discovering",
          message: "Scanning remote model routes..."
        });
        const result = await runCommand(
          openClawBin,
          ["models", "scan", "--json", "--yes", "--no-input", "--no-probe"],
          send,
          { streamStdout: false }
        );
        aggregatedStderr += result.stderr;

        if (result.errorMessage || result.timedOut || result.code !== 0) {
          await fail("discovering", "OpenClaw could not discover remote models.", {
            exitCode: result.code,
            manualCommand: formatOpenClawCommand(openClawBin, [
              "models",
              "scan",
              "--json",
              "--yes",
              "--no-input",
              "--no-probe"
            ]),
            docsUrl
          });
          return;
        }

        const discoveredModels = resolveDiscoveredModels(result.stdout, snapshot);
        aggregatedStdout = discoveredModels.length
          ? `Discovered ${discoveredModels.length} remote model candidate${discoveredModels.length === 1 ? "" : "s"}.`
          : "No new remote model candidates were discovered.";

        const freshSnapshot = await getMissionControlSnapshot({ force: true });

        await send({
          type: "done",
          ok: true,
          phase: "discovering",
          message: discoveredModels.length
            ? `Discovered ${discoveredModels.length} remote model candidate${discoveredModels.length === 1 ? "" : "s"}. Pick one to use as the default route.`
            : "No new remote model candidates were found. Refresh setup or connect another provider to expand the list.",
          exitCode: 0,
          stdout: aggregatedStdout,
          stderr: aggregatedStderr,
          snapshot: freshSnapshot,
          discoveredModels
        });
        await closeWriter();
        return;
      }

      const runSetDefault = async (modelId: string) => {
        const currentDefaultModelId =
          snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
          snapshot.diagnostics.modelReadiness.defaultModel ||
          null;

        if (currentDefaultModelId && modelId.trim() === currentDefaultModelId.trim()) {
          await send({
            type: "status",
            phase: "ready",
            message: "The selected default model is already active."
          });
          return true;
        }

        await send({
          type: "status",
          phase: "configuring-default",
          message: `Saving model route for ${modelId}...`
        });
        await send({
          type: "status",
          phase: "configuring-default",
          message: "Refreshing OpenClaw config..."
        });
        try {
          const result = await runWithGatewayAuthSetupRecovery(() => setOpenClawDefaultModel(modelId, {
            provider: resolveSetDefaultProvider(snapshot, modelId)
          }), {
            operationLabel: "setting the default model",
            onStatus: (message) => send({
              type: "status",
              phase: "configuring-default",
              message
            })
          });
          if (result.repaired) {
            aggregatedStdout = appendLine(
              aggregatedStdout,
              result.repaired.kind === "gateway-token"
                ? "AgentOS repaired local Gateway token auth before saving the default model."
                : "AgentOS repaired local Gateway device access before saving the default model."
            );
          }
          aggregatedStdout = appendLine(
            aggregatedStdout,
            result.value.modelId === modelId
              ? `Default model saved via OpenClaw Gateway config: ${result.value.modelId}.`
              : `Default model saved via OpenClaw Gateway config: ${result.value.modelId} (${modelId}).`
          );
          return true;
        } catch (error) {
          if (isGatewayAuthSetupRecoveryError(error)) {
            aggregatedStderr = appendLine(aggregatedStderr, error.message);
            await fail("configuring-default", error.message, {
              manualCommand: formatOpenClawCommand(openClawBin, ["gateway", "status", "--json"]),
              docsUrl
            });
            return false;
          }

          const gatewayError = readErrorMessage(error);
          if (isLikelyDelayedGatewaySettleError(gatewayError)) {
            await send({
              type: "status",
              phase: "configuring-default",
              message: "Gateway response timed out. Checking whether OpenClaw applied the default model..."
            });

            const delayedSnapshot = await waitForDefaultModelAfterGatewaySettle(modelId);

            if (delayedSnapshot) {
              snapshot = delayedSnapshot;
              aggregatedStdout = appendLine(
                aggregatedStdout,
                `Default model verified after a delayed OpenClaw Gateway response: ${modelId}.`
              );
              return true;
            }
          }

          aggregatedStderr = appendLine(aggregatedStderr, gatewayError);
          await send({
            type: "log",
            stream: "stderr",
            text: `${gatewayError}\n`
          });
          await fail("configuring-default", gatewayError, {
            manualCommand: formatOpenClawCommand(openClawBin, ["gateway", "diagnostics"]),
            docsUrl
          });
          return false;
        }
      };

      const runProviderLogin = async (provider: string) => {
        if (provider.trim().toLowerCase() === "ollama") {
          await ensureOpenClawOllamaLocalCredential();
          await send({
            type: "status",
            phase: "verifying",
            message: "Ollama is local. No provider auth is required."
          });
          return true;
        }

        const normalizedProvider = normalizeOpenClawAuthProvider(provider);

        if (normalizedProvider === "openai") {
          await send({
            type: "status",
            phase: "authenticating",
            message: "Opening ChatGPT authorization in your browser..."
          });

          try {
            await connectOpenClawChatGptProvider({
              force: input.intent === "login-provider" && input.force === true
            });
            snapshot = await getMissionControlSnapshot({ force: true });
            return true;
          } catch (error) {
            await fail("authenticating", readErrorMessage(error), {
              exitCode: null,
              docsUrl
            });
            return false;
          }
        }

        const authHandoff = resolveProviderAuthHandoff(provider, openClawBin, {
          codexPluginReady,
          force: input.intent === "login-provider" ? input.force === true : false
        });

        await send({
          type: "status",
          phase: "authenticating",
          message: authHandoff.statusMessage
        });

        aggregatedStderr = aggregatedStderr
          ? `${aggregatedStderr}\nOpenClaw provider auth requires an interactive TTY session.`
          : "OpenClaw provider auth requires an interactive TTY session.";

        await fail(
          "authenticating",
          authHandoff.continueMessage,
          {
            exitCode: null,
            manualCommand: authHandoff.command ?? undefined,
            docsUrl
          }
        );
        return false;
      };

      if (input.intent === "set-default") {
        const currentDefaultModelId =
          snapshot.diagnostics.modelReadiness.resolvedDefaultModel ||
          snapshot.diagnostics.modelReadiness.defaultModel ||
          null;

        if (currentDefaultModelId && input.modelId.trim() === currentDefaultModelId.trim()) {
          await send({
            type: "done",
            ok: true,
            phase: "ready",
            message: "The selected default model is already active.",
            exitCode: 0,
            stdout: aggregatedStdout,
            stderr: aggregatedStderr,
            snapshot
          });
          await closeWriter();
          return;
        }

        if (!(await runSetDefault(input.modelId))) {
          return;
        }

        await send({
          type: "status",
          phase: "verifying",
          message: "Verifying selected provider..."
        });
        await send({
          type: "status",
          phase: "refreshing",
          message: "Updating AgentOS snapshot..."
        });
        snapshot = await getMissionControlSnapshot({ force: true });
        await send({
          type: "done",
          ok: true,
          phase: "ready",
          message:
            snapshot.workspaces.length === 0
              ? "Default model saved. Launchpad is ready."
              : "Default model saved. Onboarding is complete.",
          exitCode: 0,
          stdout: aggregatedStdout,
          stderr: aggregatedStderr,
          snapshot
        });
        await closeWriter();
        return;
      }

      if (input.intent === "login-provider") {
        if (!(await runProviderLogin(input.provider))) {
          return;
        }

        await send({
          type: "status",
          phase: "verifying",
          message: "Verifying the connected provider..."
        });
        await verifyReady("The provider connected, but no usable default model was verified yet.");
        return;
      }

      if (isOpenClawMissionReady(snapshot)) {
        await send({
          type: "done",
          ok: true,
          phase: "ready",
          message: "A usable default model and runtime preflight are already configured.",
          exitCode: 0,
          stdout: aggregatedStdout,
          stderr: aggregatedStderr,
          snapshot
        });
        await closeWriter();
        return;
      }

      const preferredModelId =
        input.modelId?.trim() || snapshot.diagnostics.modelReadiness.recommendedModelId;

      if (preferredModelId) {
        if (!(await runSetDefault(preferredModelId))) {
          return;
        }

        await send({
          type: "status",
          phase: "refreshing",
          message: "Updating AgentOS snapshot..."
        });
        snapshot = await getMissionControlSnapshot({ force: true });
      }

      if (!isModelReady(snapshot)) {
        const provider = resolveRequiredLoginProvider(snapshot, preferredModelId);

        if (provider) {
          if (!(await runProviderLogin(provider))) {
            return;
          }

          snapshot = await getMissionControlSnapshot({ force: true });
        }
      }

      await send({
        type: "status",
        phase: "verifying",
        message: "Verifying model readiness..."
      });
      await verifyReady("Model setup still needs attention after the automatic pass.", preferredModelId);
    } catch (error) {
      aggregatedStderr = aggregatedStderr
        ? `${aggregatedStderr}\n${redactErrorMessage(error, "Unexpected model onboarding failure.")}`
        : redactErrorMessage(error, "Unexpected model onboarding failure.");

      await fail("detecting", "Model onboarding failed unexpectedly.", {
        docsUrl
      });
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function runCommand(
  command: string,
  args: string[],
  send: (event: OpenClawModelOnboardingStreamEvent) => Promise<unknown>,
  options?: {
    streamStdout?: boolean;
    streamStderr?: boolean;
  }
): Promise<CommandResult> {
  const streamStdout = options?.streamStdout ?? true;
  const streamStderr = options?.streamStderr ?? true;
  const invocation = resolveOpenClawSpawnInvocation(command, args);
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: buildOpenClawSpawnEnv(),
    windowsHide: true
  });

  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let resolved = false;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, commandTimeoutMs);

    const finish = (result: CommandResult) => {
      if (resolved) {
        return;
      }

      resolved = true;
      clearTimeout(timer);
      resolve(result);
    };

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      if (streamStdout) {
        void send({
          type: "log",
          stream: "stdout",
          text
        });
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      if (streamStderr) {
        void send({
          type: "log",
          stream: "stderr",
          text
        });
      }
    });

    child.on("error", (error) => {
      finish({
        code: null,
        stdout,
        stderr,
        timedOut,
        errorMessage: error.message
      });
    });

    child.on("close", (code) => {
      finish({
        code,
        stdout,
        stderr,
        timedOut,
        errorMessage: timedOut ? `Command exceeded ${Math.round(commandTimeoutMs / 1000)} seconds.` : undefined
      });
    });
  });
}

function isSystemReady(snapshot: MissionControlSnapshot) {
  return isOpenClawOnboardingSystemReady(snapshot);
}

function isModelReady(snapshot: MissionControlSnapshot) {
  return isSystemReady(snapshot) && snapshot.diagnostics.modelReadiness.ready;
}

async function waitForDefaultModelAfterGatewaySettle(modelId: string) {
  for (const delayMs of [500, 1_500, 3_000, 5_000]) {
    await new Promise((resolve) => {
      setTimeout(resolve, delayMs);
    });

    const snapshot = await getMissionControlSnapshot({ force: true });

    if (isDefaultModelSelected(snapshot, modelId)) {
      return snapshot;
    }
  }

  return null;
}

function isDefaultModelSelected(snapshot: MissionControlSnapshot, modelId: string) {
  const expected = modelId.trim();
  const readiness = snapshot.diagnostics.modelReadiness;
  const selected = [
    readiness.resolvedDefaultModel,
    readiness.defaultModel
  ].filter((value): value is string => typeof value === "string" && Boolean(value.trim()));

  return selected.some((value) => value.trim() === expected);
}

function isLikelyDelayedGatewaySettleError(message: string) {
  return /gateway was not reachable|gateway response timed out|timed out connecting|timed out waiting|gateway starting|retry shortly|failed to connect|ECONNREFUSED|ECONNRESET|socket hang up|connection closed|service restart/i.test(message);
}

function buildModelManualCommand(
  snapshot: MissionControlSnapshot,
  preferredModelId?: string | null,
  commandBin?: string,
  options?: {
    codexPluginReady?: boolean;
  }
) {
  const provider = resolveRequiredLoginProvider(snapshot, preferredModelId);

  if (provider) {
    return resolveProviderAuthHandoff(provider, commandBin, options).command;
  }

  const recommendedModelId =
    preferredModelId?.trim() || snapshot.diagnostics.modelReadiness.recommendedModelId;

  if (recommendedModelId) {
    return formatOpenClawCommand(commandBin || "openclaw", ["models", "set", recommendedModelId]);
  }

  return formatOpenClawCommand(commandBin || "openclaw", ["models", "status", "--json"]);
}

function resolveSetDefaultProvider(
  snapshot: MissionControlSnapshot,
  modelId: string
): AddModelsProviderId | null {
  const normalizedModelId = modelId.trim();
  const snapshotProvider = snapshot.models.find(
    (model) => model.id === normalizedModelId && isAddModelsProviderId(model.provider)
  )?.provider;

  if (isAddModelsProviderId(snapshotProvider)) {
    return snapshotProvider;
  }

  const modelProvider = normalizedModelId.split("/", 1)[0] || null;

  return isAddModelsProviderId(modelProvider) ? modelProvider : null;
}

function resolveVerificationFailure(
  snapshot: MissionControlSnapshot,
  preferredModelId?: string | null,
  commandBin?: string,
  options?: {
    codexPluginReady?: boolean;
  }
) {
  const provider = resolveRequiredLoginProvider(snapshot, preferredModelId);

  if (provider) {
    const authHandoff = resolveProviderAuthHandoff(provider, commandBin, options);

    return {
      message: authHandoff.verificationMessage,
      manualCommand: authHandoff.command ?? undefined
    };
  }

  return {
    message: snapshot.diagnostics.modelReadiness.defaultModel
      ? "The default model is set, but AgentOS still cannot verify it yet."
      : "Choose a default model to finish setup.",
    manualCommand: buildModelManualCommand(snapshot, preferredModelId, commandBin, options)
  };
}

function resolveInitialStatusMessage(intent: ModelOnboardingInput["intent"]) {
  if (intent === "refresh") {
    return "Refreshing model status...";
  }

  if (intent === "discover") {
    return "Scanning remote model routes...";
  }

  if (intent === "verify") {
    return "Verifying model readiness...";
  }

  return "Checking available models and provider auth...";
}

function formatProviderLabel(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "openrouter") {
    return "OpenRouter";
  }

  if (normalized === "openai") {
    return "OpenAI / ChatGPT";
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

function resolveProviderAuthHandoff(
  provider: string,
  commandBin?: string,
  options?: {
    codexPluginReady?: boolean;
    force?: boolean;
  }
) {
  const normalized = normalizeOpenClawAuthProvider(provider);
  const label = formatProviderLabel(provider);
  const bin = commandBin || "openclaw";

  if (normalized === "openrouter") {
    return {
      command: formatOpenClawCommand(bin, ["models", "auth", "paste-token", "--provider", "openrouter"]),
      statusMessage: `Preparing ${label} API key setup in terminal...`,
      continueMessage: `Continue in terminal to paste your ${label} API key. After auth completes, return here and refresh setup.`,
      verificationMessage: `The model was saved. Continue in terminal to paste your ${label} API key and finish setup.`
    };
  }

  if (normalized === "openai") {
    return resolveOpenAiAuthHandoff(bin, options?.codexPluginReady ?? true, {
      force: options?.force,
      intent: options?.force ? "refresh" : undefined
    });
  }

  return {
    command: formatOpenClawCommand(bin, ["models", "auth", "login", "--provider", normalized, "--set-default"]),
    statusMessage: `Preparing ${label} auth in terminal...`,
    continueMessage: `Continue in terminal to connect ${label}. After auth completes, return here and refresh setup.`,
    verificationMessage: `The model was saved. Continue in terminal to connect ${label} and finish setup.`
  };
}

function normalizeOpenClawAuthProvider(provider: string) {
  const normalized = provider.trim().toLowerCase();

  if (normalized === "gemini") {
    return "google";
  }

  return normalized;
}

function appendLine(current: string, line: string) {
  return current ? `${current}\n${line}` : line;
}

function readErrorMessage(error: unknown) {
  return redactErrorMessage(error, "Unknown Gateway error.");
}

function resolveDiscoveredModels(stdout: string, snapshot: MissionControlSnapshot) {
  const parsed = discoverModelsSchema.parse(JSON.parse(stdout));
  const knownModelIds = new Set(snapshot.models.map((model) => model.id));
  const discoveredModels = new Map<string, DiscoveredModelCandidate>();

  for (const candidate of parsed) {
    const modelId = resolveDiscoveredModelId(candidate);

    if (!modelId || knownModelIds.has(modelId) || discoveredModels.has(modelId)) {
      continue;
    }

    discoveredModels.set(modelId, {
      id: candidate.id.trim(),
      modelId,
      name: candidate.name.trim(),
      provider: candidate.provider.trim(),
      contextWindow: candidate.contextLength ?? null,
      supportsTools: candidate.supportsToolsMeta === true,
      isFree: candidate.isFree === true,
      input: null
    });
  }

  return Array.from(discoveredModels.values())
    .sort(compareDiscoveredModels)
    .slice(0, 6);
}

function resolveDiscoveredModelId(candidate: DiscoverModelPayload[number]) {
  const modelRef = candidate.modelRef?.trim();

  if (modelRef) {
    return modelRef;
  }

  const provider = candidate.provider.trim();
  const id = candidate.id.trim();

  if (!provider || !id) {
    return null;
  }

  return `${provider}/${id}`;
}

function compareDiscoveredModels(
  left: DiscoveredModelCandidate,
  right: DiscoveredModelCandidate
) {
  const scoreDifference = scoreDiscoveredModel(right) - scoreDiscoveredModel(left);

  if (scoreDifference !== 0) {
    return scoreDifference;
  }

  return left.name.localeCompare(right.name);
}

function scoreDiscoveredModel(candidate: DiscoveredModelCandidate) {
  return (
    (candidate.supportsTools ? 1000 : 0) +
    (candidate.isFree ? 200 : 0) +
    Math.min(candidate.contextWindow ?? 0, 256000) / 1000
  );
}

const discoverModelSchema = z.object({
  id: z.string().trim().min(1),
  name: z.string().trim().min(1),
  provider: z.string().trim().min(1),
  modelRef: z.string().trim().min(1).optional(),
  contextLength: z.number().nullable().optional(),
  supportsToolsMeta: z.boolean().optional(),
  isFree: z.boolean().optional()
});

const discoverModelsSchema = z.array(discoverModelSchema);

type DiscoverModelPayload = z.infer<typeof discoverModelsSchema>;
