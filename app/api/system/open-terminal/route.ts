import { execFile } from "node:child_process";
import { promisify } from "node:util";

import { NextResponse } from "next/server";
import { z } from "zod";

import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const openTerminalSchema = z.object({
  command: z.string().trim().min(1)
});

export async function POST(request: Request) {
  try {
    const input = openTerminalSchema.parse(await request.json());
    const command = input.command.trim();

    if (!isOpenClawTerminalCommand(command)) {
      throw new Error("Only OpenClaw commands can be opened from AgentOS.");
    }

    if (process.platform !== "darwin") {
      throw new Error("Open Terminal is currently supported on macOS only.");
    }

    await openMacTerminal(command);

    return NextResponse.json({
      ok: true
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to open Terminal."
      },
      { status: 400 }
    );
  }
}

async function openMacTerminal(command: string) {
  const escapedCommand = escapeAppleScriptString(command);
  const scriptLines = [
    'tell application "Terminal"',
    "activate",
    `do script "${escapedCommand}"`,
    "end tell"
  ];

  const args = scriptLines.flatMap((line) => ["-e", line]);
  await execFileAsync("osascript", args);
}

function escapeAppleScriptString(value: string) {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}
