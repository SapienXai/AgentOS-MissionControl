import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { NextResponse } from "next/server";
import { z } from "zod";

import { resetOpenClawBinCache, resolveOpenClawBin } from "@/lib/openclaw/cli";
import { isOpenClawSystemReady } from "@/lib/openclaw/readiness";
import { ensureOpenClawRuntimeStateAccess, getMissionControlSnapshot } from "@/lib/openclaw/service";
import type {
  MissionControlSnapshot,
  OpenClawOnboardingPhase,
  OpenClawOnboardingStreamEvent
} from "@/lib/openclaw/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const onboardingSchema = z.object({
  intent: z.literal("auto")
});

const docsUrl = "https://docs.openclaw.ai/cli/install";
const commandTimeoutMs = 10 * 60 * 1000;
const readyTimeoutMs = 35 * 1000;
const readyPollIntervalMs = 700;
type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorMessage?: string;
};

type InstallSpec = {
  command: string;
  args: string[];
  manualCommand: string;
};

export async function POST(request: Request) {
  try {
    onboardingSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Onboarding intent is required."
      },
      { status: 400 }
    );
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let writeChain = Promise.resolve();

  const send = (event: OpenClawOnboardingStreamEvent) => {
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
      phase: OpenClawOnboardingPhase,
      message: string,
      options: {
        exitCode?: number | null;
        snapshot?: MissionControlSnapshot;
        manualCommand?: string;
        docsUrl?: string;
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
        docsUrl: options.docsUrl
      });
      await closeWriter();
    };

    try {
      await send({
        type: "status",
        phase: "detecting",
        message: "Checking local OpenClaw status..."
      });

      let snapshot = await getMissionControlSnapshot({ force: true });

      if (isOpenClawReady(snapshot)) {
        await send({
          type: "done",
          ok: true,
          phase: "ready",
          message: "OpenClaw system setup is already complete.",
          exitCode: 0,
          stdout: aggregatedStdout,
          stderr: aggregatedStderr,
          snapshot
        });
        await closeWriter();
        return;
      }

      if (!snapshot.diagnostics.installed) {
        const installSpec = resolveInstallSpec();

        if (!installSpec) {
          await fail("installing-cli", "One-click OpenClaw install is not available on this platform.", {
            snapshot,
            docsUrl
          });
          return;
        }

        await send({
          type: "status",
          phase: "installing-cli",
          message: "Installing OpenClaw CLI..."
        });

        const installResult = await runCommand(installSpec.command, installSpec.args, send);
        appendOutput(installResult);

        if (installResult.errorMessage || installResult.timedOut || installResult.code !== 0) {
          await fail("installing-cli", "OpenClaw CLI installation failed.", {
            exitCode: installResult.code,
            manualCommand: installSpec.manualCommand,
            docsUrl
          });
          return;
        }

        resetOpenClawBinCache();

        try {
          await resolveOpenClawBin();
        } catch (error) {
          aggregatedStderr = aggregatedStderr
            ? `${aggregatedStderr}\n${error instanceof Error ? error.message : "OpenClaw binary could not be resolved after install."}`
            : error instanceof Error
              ? error.message
              : "OpenClaw binary could not be resolved after install.";

          await fail("installing-cli", "OpenClaw installed, but Mission Control could not resolve the new CLI yet.", {
            manualCommand: installSpec.manualCommand,
            docsUrl
          });
          return;
        }

        snapshot = await getMissionControlSnapshot({ force: true });
      }

      const openClawBin = await resolveOpenClawBin();

      if (!snapshot.diagnostics.rpcOk) {
        await send({
          type: "status",
          phase: "starting-gateway",
          message: "Starting the local gateway service..."
        });

        let gatewayStartResult = await runCommand(openClawBin, ["gateway", "start", "--json"], send);
        appendOutput(gatewayStartResult);
        const gatewayStartPayload = parseGatewayCommandPayload(gatewayStartResult.stdout);
        const gatewayReportedNotLoaded = gatewayStartPayload?.result === "not-loaded";

        if (
          gatewayStartResult.errorMessage ||
          gatewayStartResult.timedOut ||
          gatewayStartResult.code !== 0 ||
          gatewayReportedNotLoaded
        ) {
          if (!snapshot.diagnostics.loaded || gatewayReportedNotLoaded) {
            await send({
              type: "status",
              phase: "installing-gateway",
              message: "Gateway service is not loaded. Installing it, then retrying start..."
            });

            const gatewayInstallResult = await runCommand(
              openClawBin,
              ["gateway", "install", "--json"],
              send
            );
            appendOutput(gatewayInstallResult);

            if (gatewayInstallResult.errorMessage || gatewayInstallResult.timedOut || gatewayInstallResult.code !== 0) {
              await fail("installing-gateway", "Gateway installation failed.", {
                exitCode: gatewayInstallResult.code,
                manualCommand: "openclaw gateway install --json"
              });
              return;
            }

            await send({
              type: "status",
              phase: "starting-gateway",
              message: "Starting the local gateway service after installation..."
            });

            gatewayStartResult = await runCommand(openClawBin, ["gateway", "start", "--json"], send);
            appendOutput(gatewayStartResult);
          }

          if (gatewayStartResult.errorMessage || gatewayStartResult.timedOut || gatewayStartResult.code !== 0) {
            await fail("starting-gateway", "Gateway failed to start.", {
              exitCode: gatewayStartResult.code,
              manualCommand: "openclaw gateway start --json"
            });
            return;
          }
        }

        // Re-check right after start; most successful starts become ready immediately.
        snapshot = await getMissionControlSnapshot({ force: true });
      }

      if (!isOpenClawReady(snapshot)) {
        const repairedGatewayMode = await repairGatewayModeIfNeeded(openClawBin, send, appendOutput);

        if (repairedGatewayMode) {
          snapshot = await getMissionControlSnapshot({ force: true });
        }
      }

      if (!isOpenClawReady(snapshot)) {
        await send({
          type: "status",
          phase: "verifying",
          message: "Waiting for Mission Control to detect a live OpenClaw gateway..."
        });

        try {
          snapshot = await waitForReadySnapshot();
        } catch (error) {
          const gatewayStatus = await readGatewayStatus(openClawBin);
          const gatewayModeBlocked = needsGatewayModeLocalRepair(gatewayStatus);
          aggregatedStderr = aggregatedStderr
            ? `${aggregatedStderr}\n${error instanceof Error ? error.message : "Gateway verification failed."}`
            : error instanceof Error
              ? error.message
              : "Gateway verification failed.";

          if (gatewayStatus?.rpc?.error) {
            aggregatedStderr = aggregatedStderr
              ? `${aggregatedStderr}\n${gatewayStatus.rpc.error}`
              : gatewayStatus.rpc.error;
          }

          await fail(
            "verifying",
            gatewayModeBlocked
              ? "OpenClaw gateway needs local mode enabled before Mission Control can connect."
              : "OpenClaw did not become ready in time.",
            {
              manualCommand: gatewayModeBlocked
                ? "openclaw config set gateway.mode local && openclaw gateway restart --json"
                : "openclaw gateway status --json"
            }
          );
          return;
        }
      }

      try {
        const runtimeAgentId = snapshot.agents.find((agent) => agent.isDefault)?.id || snapshot.agents[0]?.id || null;
        snapshot = await ensureOpenClawRuntimeStateAccess({
          agentId: runtimeAgentId
        });
      } catch (error) {
        aggregatedStderr = aggregatedStderr
          ? `${aggregatedStderr}\n${error instanceof Error ? error.message : "Runtime state verification failed."}`
          : error instanceof Error
            ? error.message
            : "Runtime state verification failed.";

        await fail(
          "verifying",
          "OpenClaw is online, but Mission Control cannot write to the OpenClaw runtime state yet.",
          {
            snapshot: await getMissionControlSnapshot({ force: true })
          }
        );
        return;
      }

      await send({
        type: "done",
        ok: true,
        phase: "ready",
        message: "OpenClaw system setup is ready. Continue to model setup.",
        exitCode: 0,
        stdout: aggregatedStdout,
        stderr: aggregatedStderr,
        snapshot
      });
      await closeWriter();
    } catch (error) {
      aggregatedStderr = aggregatedStderr
        ? `${aggregatedStderr}\n${error instanceof Error ? error.message : "Unexpected onboarding failure."}`
        : error instanceof Error
          ? error.message
          : "Unexpected onboarding failure.";

      await fail("detecting", "OpenClaw onboarding failed unexpectedly.");
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

function resolveInstallSpec(): InstallSpec | null {
  if (process.platform === "win32") {
    return {
      command: "powershell.exe",
      args: [
        "-NoProfile",
        "-ExecutionPolicy",
        "Bypass",
        "-Command",
        "& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard"
      ],
      manualCommand:
        "powershell.exe -NoProfile -ExecutionPolicy Bypass -Command \"& ([scriptblock]::Create((iwr -useb https://openclaw.ai/install.ps1))) -NoOnboard\""
    };
  }

  if (process.platform === "darwin" || process.platform === "linux") {
    return {
      command: "/bin/bash",
      args: [
        "-lc",
        "curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh | bash -s -- --no-onboard"
      ],
      manualCommand:
        "curl -fsSL --proto '=https' --tlsv1.2 https://openclaw.ai/install-cli.sh | bash -s -- --no-onboard"
    };
  }

  return null;
}

async function runCommand(
  command: string,
  args: string[],
  send: (event: OpenClawOnboardingStreamEvent) => Promise<unknown>
): Promise<CommandResult> {
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
      void send({
        type: "log",
        stream: "stdout",
        text
      });
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      void send({
        type: "log",
        stream: "stderr",
        text
      });
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

async function waitForReadySnapshot() {
  const startedAt = Date.now();

  const immediateSnapshot = await getMissionControlSnapshot({ force: true });

  if (isOpenClawReady(immediateSnapshot)) {
    return immediateSnapshot;
  }

  while (Date.now() - startedAt < readyTimeoutMs) {
    await delay(readyPollIntervalMs);

    const snapshot = await getMissionControlSnapshot({ force: true });

    if (isOpenClawReady(snapshot)) {
      return snapshot;
    }
  }

  throw new Error(`Readiness check exceeded ${Math.round(readyTimeoutMs / 1000)} seconds.`);
}

function isOpenClawReady(snapshot: MissionControlSnapshot) {
  return isOpenClawSystemReady(snapshot);
}

async function repairGatewayModeIfNeeded(
  openClawBin: string,
  send: (event: OpenClawOnboardingStreamEvent) => Promise<unknown>,
  appendOutput: (result: CommandResult) => void
) {
  const gatewayStatus = await readGatewayStatus(openClawBin);

  if (!needsGatewayModeLocalRepair(gatewayStatus)) {
    return false;
  }

  await send({
    type: "status",
    phase: "starting-gateway",
    message: "Configuring OpenClaw gateway for local Mission Control access..."
  });

  const setModeResult = await runCommand(openClawBin, ["config", "set", "gateway.mode", "local"], send);
  appendOutput(setModeResult);

  if (setModeResult.errorMessage || setModeResult.timedOut || setModeResult.code !== 0) {
    throw new Error("Mission Control could not set gateway.mode=local automatically.");
  }

  await send({
    type: "status",
    phase: "starting-gateway",
    message: "Restarting the local gateway service with gateway.mode=local..."
  });

  const restartResult = await runCommand(openClawBin, ["gateway", "restart", "--json"], send);
  appendOutput(restartResult);

  if (restartResult.errorMessage || restartResult.timedOut || restartResult.code !== 0) {
    throw new Error("Mission Control updated gateway.mode, but the gateway restart failed.");
  }

  return true;
}

async function readGatewayStatus(openClawBin: string) {
  const result = await runCommand(openClawBin, ["gateway", "status", "--json"], async () => {});

  if (result.errorMessage || result.timedOut || result.code !== 0) {
    return null;
  }

  return parseGatewayStatusPayload(result.stdout || result.stderr);
}

function needsGatewayModeLocalRepair(payload: GatewayStatusPayload | null) {
  if (!payload || payload.rpc?.ok) {
    return false;
  }

  const diagnosticText = [payload.lastError, payload.rpc?.error].filter(Boolean).join("\n");
  return /gateway\.mode=local|current:\s*unset|allow-unconfigured/i.test(diagnosticText);
}

type GatewayCommandPayload = {
  result?: string;
  ok?: boolean;
  message?: string;
};

type GatewayStatusPayload = {
  lastError?: string;
  service?: {
    loaded?: boolean;
  };
  rpc?: {
    ok?: boolean;
    error?: string;
  };
};

function parseGatewayCommandPayload(stdout: string): GatewayCommandPayload | null {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as GatewayCommandPayload;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as GatewayCommandPayload;
    } catch {
      return null;
    }
  }
}

function parseGatewayStatusPayload(stdout: string): GatewayStatusPayload | null {
  const trimmed = stdout.trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed) as GatewayStatusPayload;
  } catch {
    const firstBrace = trimmed.indexOf("{");
    const lastBrace = trimmed.lastIndexOf("}");

    if (firstBrace === -1 || lastBrace === -1 || lastBrace <= firstBrace) {
      return null;
    }

    try {
      return JSON.parse(trimmed.slice(firstBrace, lastBrace + 1)) as GatewayStatusPayload;
    } catch {
      return null;
    }
  }
}
