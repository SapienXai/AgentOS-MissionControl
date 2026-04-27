import { spawn } from "node:child_process";
import { access } from "node:fs/promises";
import { setTimeout as delay } from "node:timers/promises";

import { NextResponse } from "next/server";
import { z } from "zod";

import { formatOpenClawCommand, resetOpenClawBinCache, resolveOpenClawBin } from "@/lib/openclaw/cli";
import { createDefaultOpenClawBinarySelection, writeOpenClawBinarySelection } from "@/lib/openclaw/binary-selection";
import { isOpenClawSystemReady } from "@/lib/openclaw/readiness";
import {
  OPENCLAW_INSTALL_DOCS_URL,
  getOpenClawInstallCommand,
  getOpenClawLocalPrefix,
  getOpenClawLocalPrefixBinPath
} from "@/lib/openclaw/install";
import {
  getMissionControlSnapshot,
  touchOpenClawRuntimeStateAccess
} from "@/lib/agentos/control-plane";
import type {
  MissionControlSnapshot,
  OpenClawOnboardingPhase,
  OpenClawOnboardingStreamEvent
} from "@/lib/agentos/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const onboardingSchema = z.object({
  intent: z.literal("auto")
});

const docsUrl = OPENCLAW_INSTALL_DOCS_URL;
const commandTimeoutMs = 10 * 60 * 1000;
const gatewayStatusTimeoutMs = 8_000;
const readyTimeoutMs = 12_000;
const readyPollIntervalMs = 500;
type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorMessage?: string;
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
  let streamClosed = false;

  const send = (event: OpenClawOnboardingStreamEvent) => {
    if (streamClosed) {
      return Promise.resolve();
    }

    writeChain = writeChain
      .then(() => {
        if (streamClosed) {
          return;
        }

        return writer.write(encoder.encode(`${JSON.stringify(event)}\n`));
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
    let snapshot: MissionControlSnapshot | null = null;

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

    const loadSnapshot = async (force = false): Promise<MissionControlSnapshot> => {
      if (force || !snapshot) {
        snapshot = force ? await getMissionControlSnapshot({ force: true }) : await getMissionControlSnapshot();
      }

      return snapshot as MissionControlSnapshot;
    };

    try {
      await send({
        type: "status",
        phase: "detecting",
        message: "Checking local OpenClaw status..."
      });

      let resolveErrorMessage: string | null = null;
      let openClawBin = await resolveOpenClawBin().catch((error) => {
        resolveErrorMessage = error instanceof Error ? error.message : "OpenClaw CLI could not be resolved.";
        return null;
      });

      if (!openClawBin) {
        const installCommand = getOpenClawInstallCommand();

        if (process.platform === "win32") {
          const currentSnapshot = await loadSnapshot();

          aggregatedStderr = resolveErrorMessage || "OpenClaw CLI could not be resolved.";

          await fail("installing-cli", "OpenClaw CLI could not be resolved.", {
            snapshot: currentSnapshot,
            manualCommand: installCommand,
            docsUrl
          });
          return;
        }

        const installedOpenClawBin = await installOpenClawCli(send, appendOutput, installCommand);

        if (!installedOpenClawBin) {
          const currentSnapshot = await loadSnapshot();

          aggregatedStderr = resolveErrorMessage
            ? aggregatedStderr
              ? `${resolveErrorMessage}\n${aggregatedStderr}`
              : resolveErrorMessage
            : aggregatedStderr;

          await fail("installing-cli", "OpenClaw CLI installation failed.", {
            snapshot: currentSnapshot,
            manualCommand: installCommand,
            docsUrl
          });
          return;
        }

        openClawBin = installedOpenClawBin;
      }

      const gatewayStatus = await readGatewayStatus(openClawBin);

      if (gatewayStatus?.rpc?.ok) {
        const readySnapshot = await loadSnapshot(true);

        if (isOpenClawReady(readySnapshot)) {
          await send({
            type: "done",
            ok: true,
            phase: "ready",
            message: "OpenClaw system setup is already complete.",
            exitCode: 0,
            stdout: aggregatedStdout,
            stderr: aggregatedStderr,
            snapshot: readySnapshot
          });
          await closeWriter();
          return;
        }

        snapshot = readySnapshot;
      }

      if (gatewayStatus && (await needsGatewayRegistrationRepair(gatewayStatus))) {
        await send({
          type: "status",
          phase: "installing-gateway",
          message: "Repairing the gateway registration..."
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
            manualCommand: formatOpenClawCommand(openClawBin, ["gateway", "install", "--force", "--json"])
          });
          return;
        }
      }

      if (!gatewayStatus?.rpc?.ok) {
        const readySnapshot = await loadSnapshot(true);

        if (isOpenClawReady(readySnapshot)) {
          await send({
            type: "done",
            ok: true,
            phase: "ready",
            message: "OpenClaw system setup is already complete.",
            exitCode: 0,
            stdout: aggregatedStdout,
            stderr: aggregatedStderr,
            snapshot: readySnapshot
          });
          await closeWriter();
          return;
        }
      }

      if (!gatewayStatus?.rpc?.ok) {
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
          if (!gatewayStatus?.service?.loaded || gatewayReportedNotLoaded) {
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
                manualCommand: formatOpenClawCommand(openClawBin, ["gateway", "install", "--json"])
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
              manualCommand: formatOpenClawCommand(openClawBin, ["gateway", "start", "--json"])
            });
            return;
          }
        }

        snapshot = await loadSnapshot(true);

        if (!isOpenClawReady(snapshot)) {
          const repairedGatewayMode = await repairGatewayModeIfNeeded(openClawBin, send, appendOutput);

          if (repairedGatewayMode) {
            snapshot = await loadSnapshot(true);
          }
        }

        if (!isOpenClawReady(snapshot)) {
          await send({
            type: "status",
            phase: "verifying",
            message: "Waiting for AgentOS to detect a live OpenClaw gateway..."
          });

          try {
            snapshot = await waitForReadySnapshot();
          } catch (error) {
            const gatewayStatusRetry = await readGatewayStatus(openClawBin);
            const gatewayModeBlocked = needsGatewayModeLocalRepair(gatewayStatusRetry);
            aggregatedStderr = aggregatedStderr
              ? `${aggregatedStderr}\n${error instanceof Error ? error.message : "Gateway verification failed."}`
              : error instanceof Error
                ? error.message
                : "Gateway verification failed.";

            if (gatewayStatusRetry?.rpc?.error) {
              aggregatedStderr = aggregatedStderr
                ? `${aggregatedStderr}\n${gatewayStatusRetry.rpc.error}`
                : gatewayStatusRetry.rpc.error;
            }

            await fail(
              "verifying",
              gatewayModeBlocked
                ? "OpenClaw gateway needs local mode enabled before AgentOS can connect."
                : "OpenClaw did not become ready in time.",
              {
                manualCommand: gatewayModeBlocked
                  ? `${formatOpenClawCommand(openClawBin, ["config", "set", "gateway.mode", "local"])} && ${formatOpenClawCommand(openClawBin, ["gateway", "restart", "--json"])}`
                  : formatOpenClawCommand(openClawBin, ["gateway", "status", "--json"])
              }
            );
            return;
          }
        }
      }

      snapshot = await loadSnapshot(true);

      try {
        const runtimeSnapshot = await loadSnapshot(true);
        snapshot = runtimeSnapshot;
        const runtimeAgentId = runtimeSnapshot.agents.find((agent) => agent.isDefault)?.id || runtimeSnapshot.agents[0]?.id || null;
        await touchOpenClawRuntimeStateAccess({
          agentId: runtimeAgentId
        });

        snapshot = await loadSnapshot(true);
      } catch (error) {
        aggregatedStderr = aggregatedStderr
          ? `${aggregatedStderr}\n${error instanceof Error ? error.message : "Runtime state verification failed."}`
          : error instanceof Error
            ? error.message
            : "Runtime state verification failed.";

        await fail(
          "verifying",
          "OpenClaw is online, but AgentOS cannot write to the OpenClaw runtime state yet.",
          {
            snapshot: snapshot ?? (await loadSnapshot())
          }
        );
        return;
      }

      snapshot = await loadSnapshot(true);

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

async function runCommand(
  command: string,
  args: string[],
  send: (event: OpenClawOnboardingStreamEvent) => Promise<unknown>,
  options: {
    timeoutMs?: number;
  } = {}
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
    }, options.timeoutMs ?? commandTimeoutMs);

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

async function installOpenClawCli(
  send: (event: OpenClawOnboardingStreamEvent) => Promise<unknown>,
  appendOutput: (result: CommandResult) => void,
  installCommand: string
) {
  await send({
    type: "status",
    phase: "installing-cli",
    message: `Installing OpenClaw into ${getOpenClawLocalPrefix()}...`
  });

  const installResult = await runCommand("bash", ["-lc", installCommand], send);
  appendOutput(installResult);

  if (installResult.errorMessage || installResult.timedOut || installResult.code !== 0) {
    return null;
  }

  await writeOpenClawBinarySelection({
    ...createDefaultOpenClawBinarySelection(),
    mode: "local-prefix",
    path: getOpenClawLocalPrefixBinPath(),
    resolvedPath: getOpenClawLocalPrefixBinPath(),
    label: "Local prefix",
    detail: getOpenClawLocalPrefixBinPath()
  });
  resetOpenClawBinCache();

  try {
    return await resolveOpenClawBin();
  } catch {
    return null;
  }
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
    message: "Configuring OpenClaw gateway for local AgentOS access..."
  });

  const setModeResult = await runCommand(openClawBin, ["config", "set", "gateway.mode", "local"], send);
  appendOutput(setModeResult);

  if (setModeResult.errorMessage || setModeResult.timedOut || setModeResult.code !== 0) {
    throw new Error("AgentOS could not set gateway.mode=local automatically.");
  }

  await send({
    type: "status",
    phase: "starting-gateway",
    message: "Restarting the local gateway service with gateway.mode=local..."
  });

  const restartResult = await runCommand(openClawBin, ["gateway", "restart", "--json"], send);
  appendOutput(restartResult);

  if (restartResult.errorMessage || restartResult.timedOut || restartResult.code !== 0) {
    throw new Error("AgentOS updated gateway.mode, but the gateway restart failed.");
  }

  return true;
}

async function readGatewayStatus(openClawBin: string) {
  const result = await runCommand(openClawBin, ["gateway", "status", "--json"], async () => {}, {
    timeoutMs: gatewayStatusTimeoutMs
  });

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

async function needsGatewayRegistrationRepair(payload: GatewayStatusPayload | null) {
  if (!payload?.service?.loaded) {
    return false;
  }

  const programArguments = payload.service.command?.programArguments;

  if (!Array.isArray(programArguments) || programArguments.length < 2) {
    return true;
  }

  const pathArguments = programArguments
    .slice(0, 2)
    .filter((value): value is string => typeof value === "string" && value.includes("/"));

  if (pathArguments.length === 0) {
    return false;
  }

  for (const candidate of pathArguments) {
    if (!(await pathExists(candidate))) {
      return true;
    }
  }

  const diagnosticText = [payload.lastError, payload.rpc?.error].filter(Boolean).join("\n");

  return (
    payload.service.runtime?.status !== "running" &&
    /cannot find module|command not found|explicit credentials|no such file or directory/i.test(diagnosticText)
  );
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
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
    command?: {
      programArguments?: string[];
    };
    runtime?: {
      status?: string;
    };
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
