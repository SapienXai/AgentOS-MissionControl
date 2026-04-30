import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { NextResponse } from "next/server";
import { z } from "zod";

import { formatOpenClawCommand, resetOpenClawBinCache, resolveOpenClawBin } from "@/lib/openclaw/cli";
import {
  clearMissionControlCaches,
  ensureOpenClawRuntimeSmokeTest,
  getMissionControlSnapshot
} from "@/lib/agentos/control-plane";
import type { OpenClawUpdateStreamEvent } from "@/lib/agentos/contracts";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  buildOpenClawUpdateRecoveryManualCommand,
  isOpenClawGatewayReadyOutput,
  shouldAttemptOpenClawUpdateRecovery
} from "@/lib/openclaw/update-recovery";
import {
  buildOpenClawRuntimeSmokeTestRecoveryCommand,
  classifyOpenClawRuntimeSmokeTestFailure
} from "@/lib/openclaw/runtime-compatibility";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  confirmed: z.literal(true)
});

const updateTimeoutMs = 10 * 60 * 1000;
const gatewayReadyTimeoutMs = 3 * 60 * 1000;
const gatewayReadyProbeTimeoutMs = 20 * 1000;
const gatewayReadyInitialDelayMs = 5 * 1000;
const gatewayReadyProbeIntervalMs = 3 * 1000;
const runtimeSmokeTestSkippedMessage =
  "OpenClaw updated, but no agent was available for a live turn smoke test. Skipping compatibility gate.";

type UpdateVerification = {
  ok: boolean;
  message: string;
};

type CommandResult = {
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
  errorMessage?: string;
};

export async function POST(request: Request) {
  try {
    updateSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Update confirmation is required."
      },
      { status: 400 }
    );
  }

  const snapshot = await getMissionControlSnapshot({ force: true });

  if (!snapshot.diagnostics.installed) {
    return NextResponse.json(
      {
        error: snapshot.diagnostics.issues[0] || "OpenClaw is unavailable."
      },
      { status: 400 }
    );
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let writeChain = Promise.resolve();

  const send = (event: OpenClawUpdateStreamEvent) => {
    writeChain = writeChain
      .then(() => writer.write(encoder.encode(`${JSON.stringify(event)}\n`)))
      .catch(() => {});

    return writeChain;
  };

  void (async () => {
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let finished = false;

    const closeWriter = async () => {
      if (finished) {
        return;
      }

      finished = true;
      await writeChain;
      await writer.close();
    };

    let openClawBin: string;

    try {
      openClawBin = await resolveOpenClawBin();
    } catch (error) {
      await send({
        type: "done",
        ok: false,
        message: error instanceof Error ? error.message : "OpenClaw CLI could not be resolved.",
        exitCode: null,
        stdout,
        stderr
      });
      await closeWriter();
      return;
    }

    const child = spawn(openClawBin, ["update"], {
      cwd: process.cwd(),
      env: process.env
    });

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, updateTimeoutMs);

    await send({
      type: "status",
      phase: "starting",
      message: "Running openclaw update..."
    });

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
      clearTimeout(timer);
      void (async () => {
        await send({
          type: "done",
          ok: false,
          message: `OpenClaw update failed to start: ${error.message}`,
          exitCode: null,
          stdout,
          stderr: stderr ? `${stderr}\n${error.message}` : error.message
        });
        await closeWriter();
      })();
    });

    child.on("close", (code) => {
      clearTimeout(timer);

      void (async () => {
        if (finished) {
          return;
        }

        if (timedOut) {
          await send({
            type: "done",
            ok: false,
            message: "OpenClaw update timed out.",
            exitCode: code,
            stdout,
            stderr: stderr || `Update exceeded ${Math.round(updateTimeoutMs / 1000)} seconds.`
          });
          await closeWriter();
          return;
        }

        if (code !== 0) {
          const failureCommand = formatOpenClawCommand(openClawBin, ["update"]);
          const failureOutput = [stdout, stderr].filter(Boolean).join("\n");
          const needsInteractiveTty =
            /downgrade confirmation required/i.test(failureOutput) ||
            /interactive tty/i.test(failureOutput) ||
            /re-?run in a tty/i.test(failureOutput) ||
            /confirm the downgrade/i.test(failureOutput);

          if (needsInteractiveTty) {
            await send({
              type: "done",
              ok: false,
              message: "OpenClaw update needs to be confirmed in a terminal.",
              exitCode: code,
              stdout,
              stderr: stderr || "Downgrade confirmation required.",
              manualCommand: failureCommand
            });
            await closeWriter();
            return;
          }

          if (!shouldAttemptOpenClawUpdateRecovery(failureOutput)) {
            await send({
              type: "done",
              ok: false,
              message: "OpenClaw update failed.",
              exitCode: code,
              stdout,
              stderr
            });
            await closeWriter();
            return;
          }

          await send({
            type: "status",
            phase: "refreshing",
            message: "OpenClaw updated, but post-update setup needs repair. Running setup checks..."
          });

          const recovery = await recoverOpenClawPostUpdate(openClawBin, send);
          stdout += recovery.stdout;
          stderr += recovery.stderr;

          if (!recovery.ok) {
            await send({
              type: "done",
              ok: false,
              message: recovery.message,
              exitCode: recovery.exitCode ?? code,
              stdout,
              stderr,
              manualCommand: buildOpenClawUpdateRecoveryManualCommand(formatOpenClawCommand(openClawBin, []))
            });
            await closeWriter();
            return;
          }
        }

        await send({
          type: "status",
          phase: "refreshing",
          message: "Verifying installed OpenClaw version..."
        });

        try {
          resetOpenClawBinCache();
          clearMissionControlCaches();
          const nextSnapshot = await getMissionControlSnapshot({ force: true });
          const verifiedSnapshot = preserveKnownUpdateTarget(snapshot, nextSnapshot);
          const verification = verifyOpenClawUpdate(snapshot, verifiedSnapshot);

          if (!verification.ok) {
            await send({
              type: "done",
              ok: false,
              message: verification.message,
              exitCode: code,
              stdout,
              stderr,
              snapshot: verifiedSnapshot,
              manualCommand: formatOpenClawCommand(openClawBin, ["update"])
            });
            await closeWriter();
            return;
          }

          await send({
            type: "status",
            phase: "refreshing",
            message: "Running a live runtime smoke test..."
          });

          const smokeTest = await ensureOpenClawRuntimeSmokeTest({ force: true });
          const finalSnapshot = await getMissionControlSnapshot({ force: true });
          const smokeTestOutput = smokeTest.error || smokeTest.summary || "";

          if (smokeTest.status === "failed") {
            const classification = classifyOpenClawRuntimeSmokeTestFailure(smokeTestOutput);

            await send({
              type: "done",
              ok: false,
              message: classification
                ? `OpenClaw updated, but ${classification.detail}`
                : `OpenClaw updated, but the live runtime smoke test failed. ${smokeTestOutput}`.trim(),
              exitCode: code,
              stdout,
              stderr: stderr
                ? `${stderr}\n${smokeTestOutput || "Runtime smoke test failed."}`
                : smokeTestOutput || "Runtime smoke test failed.",
              snapshot: finalSnapshot,
              manualCommand: buildOpenClawRuntimeSmokeTestRecoveryCommand(formatOpenClawCommand(openClawBin, []), smokeTestOutput)
            });
            await closeWriter();
            return;
          }

          stdout = stdout
            ? `${stdout}\n${smokeTest.status === "not-run" ? runtimeSmokeTestSkippedMessage : smokeTest.summary || "Runtime smoke test passed."}`
            : smokeTest.status === "not-run"
              ? runtimeSmokeTestSkippedMessage
              : smokeTest.summary || "Runtime smoke test passed.";

          await send({
            type: "done",
            ok: true,
            message: verification.message,
            exitCode: code,
            stdout,
            stderr,
            snapshot: finalSnapshot
          });
        } catch (error) {
          await send({
            type: "done",
            ok: false,
            message: "OpenClaw update command finished, but AgentOS could not verify the installed version.",
            exitCode: code,
            stdout,
            stderr: stderr
              ? `${stderr}\n${error instanceof Error ? error.message : "Status refresh failed."}`
              : error instanceof Error
                ? error.message
                : "Status refresh failed."
          });
        }

        await closeWriter();
      })();
    });
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}

async function recoverOpenClawPostUpdate(
  openClawBin: string,
  send: (event: OpenClawUpdateStreamEvent) => Promise<unknown>
) {
  let stdout = "";
  let stderr = "";
  const appendOutput = (result: CommandResult) => {
    stdout += result.stdout;
    stderr += result.stderr;

    if (result.errorMessage) {
      stderr = stderr ? `${stderr}\n${result.errorMessage}` : result.errorMessage;
    }
  };

  const doctorResult = await runRecoveryCommand(openClawBin, ["doctor", "--fix"], send, {
    timeoutMs: 4 * 60 * 1000
  });
  appendOutput(doctorResult);

  if (doctorResult.errorMessage || doctorResult.timedOut || doctorResult.code !== 0) {
    return {
      ok: false,
      message: "OpenClaw update applied, but AgentOS could not repair post-update setup.",
      exitCode: doctorResult.code,
      stdout,
      stderr
    };
  }

  const restartResult = await runRecoveryCommand(openClawBin, ["gateway", "restart"], send, {
    timeoutMs: 90_000
  });
  appendOutput(restartResult);

  if (restartResult.errorMessage || restartResult.timedOut || restartResult.code !== 0) {
    return {
      ok: false,
      message: "OpenClaw update applied, but the gateway restart failed after setup repair.",
      exitCode: restartResult.code,
      stdout,
      stderr
    };
  }

  await send({
    type: "status",
    phase: "refreshing",
    message: "Waiting for the OpenClaw gateway to become ready..."
  });

  const healthResult = await waitForGatewayReady(openClawBin);
  appendOutput(healthResult);

  if (healthResult.errorMessage || healthResult.timedOut || healthResult.code !== 0) {
    return {
      ok: false,
      message: "OpenClaw update applied, but the gateway did not become healthy after setup repair.",
      exitCode: healthResult.code,
      stdout,
      stderr
    };
  }

  return {
    ok: true,
    message: "OpenClaw post-update setup repaired.",
    exitCode: 0,
    stdout,
    stderr
  };
}

async function waitForGatewayReady(openClawBin: string) {
  const startedAt = Date.now();
  let latestResult: CommandResult = {
    code: null,
    stdout: "",
    stderr: "",
    timedOut: false,
    errorMessage: "Gateway health check did not run."
  };

  await delay(gatewayReadyInitialDelayMs);

  while (Date.now() - startedAt < gatewayReadyTimeoutMs) {
    latestResult = await runRecoveryCommand(openClawBin, ["gateway", "status", "--deep"], async () => {}, {
      timeoutMs: gatewayReadyProbeTimeoutMs,
      streamOutput: false
    });

    if (
      !latestResult.errorMessage &&
      !latestResult.timedOut &&
      latestResult.code === 0 &&
      isOpenClawGatewayReadyOutput([latestResult.stdout, latestResult.stderr].filter(Boolean).join("\n"))
    ) {
      return latestResult;
    }

    await delay(gatewayReadyProbeIntervalMs);
  }

  return {
    ...latestResult,
    timedOut: latestResult.timedOut || latestResult.code !== 0,
    errorMessage: latestResult.errorMessage || "Gateway readiness check exceeded 180 seconds."
  };
}

async function runRecoveryCommand(
  command: string,
  args: string[],
  send: (event: OpenClawUpdateStreamEvent) => Promise<unknown>,
  options: {
    timeoutMs: number;
    streamOutput?: boolean;
  }
): Promise<CommandResult> {
  const child = spawn(command, args, {
    cwd: process.cwd(),
    env: process.env
  });
  const streamOutput = options.streamOutput ?? true;
  let stdout = "";
  let stderr = "";
  let timedOut = false;
  let resolved = false;

  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs);

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

      if (streamOutput) {
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

      if (streamOutput) {
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
        errorMessage: timedOut ? `Command exceeded ${Math.round(options.timeoutMs / 1000)} seconds.` : undefined
      });
    });
  });
}

function verifyOpenClawUpdate(
  beforeSnapshot: MissionControlSnapshot,
  afterSnapshot: MissionControlSnapshot
): UpdateVerification {
  const beforeVersion = normalizeVersion(beforeSnapshot.diagnostics.version);
  const afterVersion = normalizeVersion(afterSnapshot.diagnostics.version);
  const expectedLatestVersion = normalizeVersion(
    beforeSnapshot.diagnostics.latestVersion || afterSnapshot.diagnostics.latestVersion
  );
  const latestKnownBeforeUpdate =
    expectedLatestVersion !== null &&
    beforeVersion !== null &&
    compareVersionStrings(expectedLatestVersion, beforeVersion) > 0;

  if (afterSnapshot.diagnostics.updateAvailable === true) {
    return {
      ok: false,
      message: [
        "OpenClaw update command finished, but a newer release is still reported.",
        `Installed: ${formatVersion(afterVersion)}.`,
        afterSnapshot.diagnostics.latestVersion || expectedLatestVersion
          ? `Latest: ${formatVersion(afterSnapshot.diagnostics.latestVersion || expectedLatestVersion)}.`
          : null
      ]
        .filter(Boolean)
        .join(" ")
    };
  }

  if (latestKnownBeforeUpdate && afterVersion && expectedLatestVersion) {
    const stillBehindLatest = compareVersionStrings(afterVersion, expectedLatestVersion) < 0;

    if (stillBehindLatest) {
      return {
        ok: false,
        message: `OpenClaw update command finished, but the installed version is still ${formatVersion(afterVersion)}. Expected ${formatVersion(expectedLatestVersion)}.`
      };
    }
  }

  if (latestKnownBeforeUpdate && beforeVersion && afterVersion) {
    const versionDidNotAdvance = compareVersionStrings(afterVersion, beforeVersion) <= 0;

    if (versionDidNotAdvance) {
      return {
        ok: false,
        message: `OpenClaw update command finished, but the installed version did not change from ${formatVersion(beforeVersion)}.`
      };
    }
  }

  return {
    ok: true,
    message: afterVersion
      ? `OpenClaw update completed. Installed version: ${formatVersion(afterVersion)}.`
      : "OpenClaw update completed."
  };
}

function preserveKnownUpdateTarget(
  beforeSnapshot: MissionControlSnapshot,
  afterSnapshot: MissionControlSnapshot
): MissionControlSnapshot {
  const beforeLatestVersion = normalizeVersion(beforeSnapshot.diagnostics.latestVersion);
  const afterLatestVersion = normalizeVersion(afterSnapshot.diagnostics.latestVersion);
  const afterVersion = normalizeVersion(afterSnapshot.diagnostics.version);

  if (!beforeLatestVersion || !afterVersion) {
    return afterSnapshot;
  }

  const latestStillNewerThanInstalled = compareVersionStrings(beforeLatestVersion, afterVersion) > 0;
  const afterLostKnownLatest =
    !afterLatestVersion || compareVersionStrings(beforeLatestVersion, afterLatestVersion) > 0;

  if (!latestStillNewerThanInstalled || !afterLostKnownLatest) {
    return afterSnapshot;
  }

  return {
    ...afterSnapshot,
    diagnostics: {
      ...afterSnapshot.diagnostics,
      latestVersion: beforeLatestVersion,
      updateAvailable: true,
      updateInfo: `Update available: v${beforeLatestVersion} is ready. Current version: v${afterVersion}.`
    }
  };
}

function normalizeVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}

function formatVersion(value: string | null | undefined) {
  const normalized = normalizeVersion(value);
  return normalized ? `v${normalized}` : "unknown";
}
