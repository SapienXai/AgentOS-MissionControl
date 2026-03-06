import "server-only";

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";

interface CommandOptions {
  timeoutMs?: number;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function runOpenClaw(
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  const { stdout, stderr } = await execFileAsync(OPENCLAW_BIN, args, {
    cwd: process.cwd(),
    timeout: options.timeoutMs ?? 45000,
    maxBuffer: 8 * 1024 * 1024
  });

  return {
    stdout: stdout.toString(),
    stderr: stderr.toString()
  };
}

export async function runOpenClawJson<T>(
  args: string[],
  options: CommandOptions = {}
): Promise<T> {
  const result = await runOpenClaw(args, options);

  return parseJsonOutput<T>(result.stdout || result.stderr);
}

export async function detectOpenClaw(): Promise<boolean> {
  try {
    await runOpenClaw(["--version"], { timeoutMs: 5000 });
    return true;
  } catch {
    return false;
  }
}

function parseJsonOutput<T>(text: string): T {
  const trimmed = text.trim();

  if (!trimmed) {
    throw new Error("OpenClaw returned no JSON output.");
  }

  try {
    return JSON.parse(trimmed) as T;
  } catch {}

  const lines = trimmed.split(/\r?\n/);

  for (let start = 0; start < lines.length; start += 1) {
    const line = lines[start].trim();

    if (!line.startsWith("{") && !line.startsWith("[")) {
      continue;
    }

    for (let end = lines.length; end > start; end -= 1) {
      const candidate = lines.slice(start, end).join("\n").trim();

      try {
        return JSON.parse(candidate) as T;
      } catch {}
    }
  }

  throw new Error(`Unable to parse OpenClaw JSON output:\n${trimmed.slice(0, 800)}`);
}
