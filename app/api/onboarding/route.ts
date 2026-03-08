import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { NextResponse } from "next/server";
import { z } from "zod";

import { resetOpenClawBinCache, resolveOpenClawBin } from "@/lib/openclaw/cli";
import { getMissionControlSnapshot } from "@/lib/openclaw/service";
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
const readyTimeoutMs = 90 * 1000;
const readyPollIntervalMs = 2000;
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
          message: "OpenClaw is already online.",
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

      if (!snapshot.diagnostics.loaded) {
        await send({
          type: "status",
          phase: "installing-gateway",
          message: "OpenClaw CLI is ready. Preparing the local gateway service for this machine (one-time setup)..."
        });

        const gatewayInstallResult = await runCommand(
          openClawBin,
          ["gateway", "install", "--force", "--json"],
          send
        );
        appendOutput(gatewayInstallResult);

        if (gatewayInstallResult.errorMessage || gatewayInstallResult.timedOut || gatewayInstallResult.code !== 0) {
          await fail("installing-gateway", "Gateway installation failed.", {
            exitCode: gatewayInstallResult.code,
            manualCommand: "openclaw gateway install --force --json"
          });
          return;
        }

        snapshot = await getMissionControlSnapshot({ force: true });
      }

      if (!snapshot.diagnostics.rpcOk) {
        await send({
          type: "status",
          phase: "starting-gateway",
          message: snapshot.diagnostics.loaded
            ? "Starting the local gateway service..."
            : "Starting the newly prepared local gateway service..."
        });

        const gatewayStartResult = await runCommand(
          openClawBin,
          ["gateway", "start", "--json"],
          send
        );
        appendOutput(gatewayStartResult);

        if (gatewayStartResult.errorMessage || gatewayStartResult.timedOut || gatewayStartResult.code !== 0) {
          await fail("starting-gateway", "Gateway failed to start.", {
            exitCode: gatewayStartResult.code,
            manualCommand: "openclaw gateway start --json"
          });
          return;
        }
      }

      await send({
        type: "status",
        phase: "verifying",
        message: "Waiting for Mission Control to detect a live OpenClaw gateway..."
      });

      try {
        snapshot = await waitForReadySnapshot();
      } catch (error) {
        aggregatedStderr = aggregatedStderr
          ? `${aggregatedStderr}\n${error instanceof Error ? error.message : "Gateway verification failed."}`
          : error instanceof Error
            ? error.message
            : "Gateway verification failed.";

        await fail("verifying", "OpenClaw did not become ready in time.", {
          manualCommand: "openclaw gateway status --json"
        });
        return;
      }

      await send({
        type: "done",
        ok: true,
        phase: "ready",
        message: "OpenClaw is ready. Entering Mission Control...",
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
  return snapshot.diagnostics.installed && snapshot.diagnostics.loaded && snapshot.diagnostics.rpcOk;
}
