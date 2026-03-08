import "server-only";

import { execFile } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";
const isWindows = process.platform === "win32";
let resolvedOpenClawBin = process.env.OPENCLAW_BIN || "";

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
  const openClawBin = await resolveOpenClawBin();
  const { stdout, stderr } = await execFileAsync(openClawBin, args, {
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
  try {
    const result = await runOpenClaw(args, options);
    return parseJsonOutput<T>(result.stdout || result.stderr);
  } catch (error) {
    const failedResult = extractFailedCommandResult(error);

    if (failedResult) {
      try {
        return parseJsonOutput<T>(failedResult.stdout || failedResult.stderr);
      } catch {}
    }

    throw error;
  }
}

export async function detectOpenClaw(): Promise<boolean> {
  try {
    await resolveOpenClawBin();
    return true;
  } catch {
    return false;
  }
}

export async function resolveOpenClawBin(): Promise<string> {
  const candidates = await collectOpenClawCandidates();

  for (const candidate of candidates) {
    if (await canExecuteOpenClaw(candidate)) {
      resolvedOpenClawBin = candidate;
      return candidate;
    }
  }

  throw new Error("OpenClaw CLI is not installed or could not be resolved.");
}

export function resetOpenClawBinCache() {
  resolvedOpenClawBin = process.env.OPENCLAW_BIN || "";
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

function extractFailedCommandResult(error: unknown): CommandResult | null {
  if (!error || typeof error !== "object") {
    return null;
  }

  const stdout = "stdout" in error ? stringifyStream(error.stdout) : "";
  const stderr = "stderr" in error ? stringifyStream(error.stderr) : "";

  if (!stdout && !stderr) {
    return null;
  }

  return { stdout, stderr };
}

function stringifyStream(value: unknown) {
  if (typeof value === "string") {
    return value;
  }

  if (value instanceof Uint8Array) {
    return Buffer.from(value).toString();
  }

  return "";
}

async function collectOpenClawCandidates() {
  const home = os.homedir();
  const npmPrefix = await resolveNpmGlobalPrefix();
  const homebrewPrefix = process.arch === "arm64" ? "/opt/homebrew" : "/usr/local";
  const pathCandidates = isWindows
    ? [
        path.join(home, ".openclaw", "bin", "openclaw.cmd"),
        path.join(home, ".openclaw", "bin", "openclaw.exe"),
        path.join(home, "AppData", "Roaming", "npm", "openclaw.cmd"),
        path.join(home, "AppData", "Roaming", "npm", "openclaw.exe"),
        npmPrefix ? path.join(npmPrefix, "openclaw.cmd") : null,
        npmPrefix ? path.join(npmPrefix, "openclaw.exe") : null
      ]
    : [
        path.join(home, ".openclaw", "bin", "openclaw"),
        path.join(home, ".local", "bin", "openclaw"),
        path.join(home, ".npm-global", "bin", "openclaw"),
        path.join(home, ".volta", "bin", "openclaw"),
        path.join(home, "Library", "pnpm", "openclaw"),
        path.join("/usr/local", "bin", "openclaw"),
        path.join(homebrewPrefix, "bin", "openclaw"),
        npmPrefix ? path.join(npmPrefix, "bin", "openclaw") : null,
        npmPrefix ? path.join(npmPrefix, "openclaw") : null
      ];

  return [...new Set([resolvedOpenClawBin, OPENCLAW_BIN, "openclaw", ...pathCandidates].filter(isNonEmptyString))];
}

async function canExecuteOpenClaw(command: string) {
  try {
    await execFileAsync(command, ["--version"], {
      cwd: process.cwd(),
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveNpmGlobalPrefix() {
  try {
    const { stdout } = await execFileAsync(isWindows ? "npm.cmd" : "npm", ["prefix", "-g"], {
      cwd: process.cwd(),
      timeout: 5000,
      maxBuffer: 1024 * 1024
    });

    return stdout.toString().trim();
  } catch {
    return "";
  }
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value);
}
