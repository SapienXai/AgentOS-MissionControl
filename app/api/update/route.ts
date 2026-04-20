import { spawn } from "node:child_process";

import { NextResponse } from "next/server";
import { z } from "zod";

import { formatOpenClawCommand, resolveOpenClawBin } from "@/lib/openclaw/cli";
import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import type { OpenClawUpdateStreamEvent } from "@/lib/agentos/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const updateSchema = z.object({
  confirmed: z.literal(true)
});

const updateTimeoutMs = 10 * 60 * 1000;

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
          message: "Refreshing OpenClaw status..."
        });

        try {
          const nextSnapshot = await getMissionControlSnapshot({ force: true });

          await send({
            type: "done",
            ok: true,
            message: "OpenClaw update completed.",
            exitCode: code,
            stdout,
            stderr,
            snapshot: nextSnapshot
          });
        } catch (error) {
          await send({
            type: "done",
            ok: true,
            message: "OpenClaw update completed, but AgentOS could not refresh status immediately.",
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
