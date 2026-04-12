import { spawn } from "node:child_process";

import { NextResponse } from "next/server";
import { z } from "zod";

import { formatOpenClawCommand, resolveOpenClawBin } from "@/lib/openclaw/cli";
import {
  isOpenClawMissionReady,
  isOpenClawSystemReady
} from "@/lib/openclaw/readiness";
import {
  ensureOpenClawRuntimeSmokeTest,
  getMissionControlSnapshot
} from "@/lib/agentos/control-plane";
import type {
  DiscoveredModelCandidate,
  MissionControlSnapshot,
  OpenClawModelOnboardingPhase,
  OpenClawModelOnboardingStreamEvent
} from "@/lib/agentos/contracts";

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
    intent: z.literal("discover")
  }),
  z.object({
    intent: z.literal("set-default"),
    modelId: z.string().trim().min(1)
  }),
  z.object({
    intent: z.literal("login-provider"),
    provider: z.string().trim().min(1)
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
        error: error instanceof Error ? error.message : "Model onboarding intent is required."
      },
      { status: 400 }
    );
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let writeChain = Promise.resolve();

  const send = (event: OpenClawModelOnboardingStreamEvent) => {
    writeChain = writeChain
      .then(() => writer.write(encoder.encode(`${JSON.stringify(event)}\n`)))
      .catch(() => {});

    return writeChain;
  };

  const closeWriter = async () => {
    await writeChain;
    await writer.close();
  };

  void (async () => {
    let aggregatedStdout = "";
    let aggregatedStderr = "";
    let manualCommandBin = "openclaw";

    const appendOutput = (result: CommandResult) => {
      aggregatedStdout += result.stdout;
      aggregatedStderr += result.stderr;

      if (result.errorMessage) {
        aggregatedStderr = aggregatedStderr
          ? `${aggregatedStderr}\n${result.errorMessage}`
          : result.errorMessage;
      }
    };

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
        const failure = resolveVerificationFailure(snapshot, preferredModelId, manualCommandBin);

        await fail("verifying", failure.message || message, {
          snapshot,
          manualCommand: manualCommand ?? failure.manualCommand ?? buildModelManualCommand(snapshot, preferredModelId, manualCommandBin),
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
            manualCommand: manualCommand ?? buildModelManualCommand(freshSnapshot, preferredModelId, manualCommandBin),
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
            : input.intent === "discover"
              ? "discovering"
              : "detecting",
        message: resolveInitialStatusMessage(input.intent)
      });

      let snapshot = await getMissionControlSnapshot({ force: true });
      manualCommandBin = await resolveOpenClawBin().catch(() => "openclaw");

      if (!isSystemReady(snapshot)) {
        await fail("detecting", "System setup is not complete yet.", {
          snapshot,
          manualCommand: formatOpenClawCommand(manualCommandBin, ["gateway", "status", "--json"])
        });
        return;
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
          manualCommand: buildModelManualCommand(snapshot, undefined, manualCommandBin),
          docsUrl
        });
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
        await send({
          type: "status",
          phase: "configuring-default",
          message: `Setting ${modelId} as the default model...`
        });
        const result = await runCommand(openClawBin, ["models", "set", modelId], send);
        appendOutput(result);

        if (result.errorMessage || result.timedOut || result.code !== 0) {
          await fail("configuring-default", "OpenClaw could not set the default model.", {
            exitCode: result.code,
            manualCommand: formatOpenClawCommand(openClawBin, ["models", "set", modelId]),
            docsUrl
          });
          return false;
        }

        return true;
      };

      const runProviderLogin = async (provider: string) => {
        const authHandoff = resolveProviderAuthHandoff(provider, openClawBin);

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
            manualCommand: authHandoff.command,
            docsUrl
          }
        );
        return false;
      };

      if (input.intent === "set-default") {
        if (!(await runSetDefault(input.modelId))) {
          return;
        }

        snapshot = await getMissionControlSnapshot({ force: true });

        if (!isModelReady(snapshot)) {
          const provider = resolveRequiredLoginProvider(snapshot, input.modelId);

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
          message: "Verifying the selected model..."
        });
        await verifyReady(
          "The selected model was saved, but AgentOS still cannot verify it.",
          input.modelId
        );
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
        ? `${aggregatedStderr}\n${error instanceof Error ? error.message : "Unexpected model onboarding failure."}`
        : error instanceof Error
          ? error.message
          : "Unexpected model onboarding failure.";

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
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env
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
  return isOpenClawSystemReady(snapshot);
}

function isModelReady(snapshot: MissionControlSnapshot) {
  return isSystemReady(snapshot) && snapshot.diagnostics.modelReadiness.ready;
}

function buildModelManualCommand(
  snapshot: MissionControlSnapshot,
  preferredModelId?: string | null,
  commandBin?: string
) {
  const provider = resolveRequiredLoginProvider(snapshot, preferredModelId);

  if (provider) {
    return resolveProviderAuthHandoff(provider, commandBin).command;
  }

  const recommendedModelId =
    preferredModelId?.trim() || snapshot.diagnostics.modelReadiness.recommendedModelId;

  if (recommendedModelId) {
    return formatOpenClawCommand(commandBin || "openclaw", ["models", "set", recommendedModelId]);
  }

  return formatOpenClawCommand(commandBin || "openclaw", ["models", "status", "--json"]);
}

function resolveRequiredLoginProvider(
  snapshot: MissionControlSnapshot,
  preferredModelId?: string | null
) {
  const preferredProvider = resolveModelProvider(preferredModelId);

  if (
    preferredProvider &&
    snapshot.diagnostics.modelReadiness.authProviders.some(
      (provider) =>
        provider.provider === preferredProvider && !provider.connected && provider.canLogin
    )
  ) {
    return preferredProvider;
  }

  return snapshot.diagnostics.modelReadiness.preferredLoginProvider;
}

function resolveVerificationFailure(
  snapshot: MissionControlSnapshot,
  preferredModelId?: string | null,
  commandBin?: string
) {
  const provider = resolveRequiredLoginProvider(snapshot, preferredModelId);

  if (provider) {
    const authHandoff = resolveProviderAuthHandoff(provider, commandBin);

    return {
      message: authHandoff.verificationMessage,
      manualCommand: authHandoff.command
    };
  }

  return {
    message: snapshot.diagnostics.modelReadiness.defaultModel
      ? "The default model is set, but AgentOS still cannot verify it yet."
      : "Choose a default model to finish setup.",
    manualCommand: buildModelManualCommand(snapshot, preferredModelId, commandBin)
  };
}

function resolveInitialStatusMessage(intent: ModelOnboardingInput["intent"]) {
  if (intent === "refresh") {
    return "Refreshing model status...";
  }

  if (intent === "discover") {
    return "Scanning remote model routes...";
  }

  return "Checking available models and provider auth...";
}

function resolveModelProvider(modelId?: string | null) {
  const normalized = modelId?.trim();

  if (!normalized) {
    return null;
  }

  const [provider] = normalized.split("/", 1);
  return provider || null;
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

function resolveProviderAuthHandoff(provider: string, commandBin?: string) {
  const normalized = provider.trim().toLowerCase();
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

  return {
    command: formatOpenClawCommand(bin, ["models", "auth", "login", "--provider", normalized, "--set-default"]),
    statusMessage: `Preparing ${label} auth in terminal...`,
    continueMessage: `Continue in terminal to connect ${label}. After auth completes, return here and refresh setup.`,
    verificationMessage: `The model was saved. Continue in terminal to connect ${label} and finish setup.`
  };
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
