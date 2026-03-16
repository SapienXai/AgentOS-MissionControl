import "server-only";

import { execFile, spawn } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";
const isWindows = process.platform === "win32";
let resolvedOpenClawBin = process.env.OPENCLAW_BIN || "";
let resolveOpenClawBinPromise: Promise<string> | null = null;
let npmGlobalPrefixPromise: Promise<string> | null = null;

interface CommandOptions {
  timeoutMs?: number;
}

interface StreamingCommandOptions extends CommandOptions {
  onStdout?: (text: string) => Promise<void> | void;
  onStderr?: (text: string) => Promise<void> | void;
}

export interface CommandResult {
  stdout: string;
  stderr: string;
}

export async function runOpenClaw(
  args: string[],
  options: CommandOptions = {}
): Promise<CommandResult> {
  return runOpenClawStream(args, options);
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

export async function runOpenClawStream(
  args: string[],
  options: StreamingCommandOptions = {}
): Promise<CommandResult> {
  const openClawBin = await resolveOpenClawBin();

  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(openClawBin, args, {
      cwd: process.cwd(),
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    let callbackChain = Promise.resolve();

    const queueCallback = (
      callback: ((text: string) => Promise<void> | void) | undefined,
      text: string
    ) => {
      if (!callback || !text) {
        return;
      }

      callbackChain = callbackChain.then(() => callback(text)).catch(() => {});
    };

    const settle = (handler: () => void) => {
      if (finished) {
        return;
      }

      finished = true;
      void callbackChain.finally(handler);
    };

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, options.timeoutMs ?? 45000);

    child.stdout.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stdout += text;
      queueCallback(options.onStdout, text);
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      const text = chunk.toString();
      stderr += text;
      queueCallback(options.onStderr, text);
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      settle(() => {
        reject(
          createCommandError(
            `OpenClaw command failed to start: ${error.message}`,
            stdout,
            stderr ? `${stderr}\n${error.message}` : error.message,
            null
          )
        );
      });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      settle(() => {
        if (timedOut) {
          reject(
            createCommandError(
              `OpenClaw command timed out after ${Math.round((options.timeoutMs ?? 45000) / 1000)} seconds.`,
              stdout,
              stderr || "The command exceeded its timeout window.",
              code
            )
          );
          return;
        }

        if (code !== 0) {
          reject(
            createCommandError(
              `OpenClaw command failed with exit code ${code}.`,
              stdout,
              stderr,
              code
            )
          );
          return;
        }

        resolve({
          stdout,
          stderr
        });
      });
    });
  });
}

export async function runOpenClawJsonStream<T>(
  args: string[],
  options: StreamingCommandOptions = {}
): Promise<T> {
  try {
    const result = await runOpenClawStream(args, options);
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
  if (resolvedOpenClawBin) {
    return resolvedOpenClawBin;
  }

  if (resolveOpenClawBinPromise) {
    return resolveOpenClawBinPromise;
  }

  resolveOpenClawBinPromise = (async () => {
    const candidates = await collectOpenClawCandidates();

    for (const candidate of candidates) {
      if (await canExecuteOpenClaw(candidate)) {
        resolvedOpenClawBin = candidate;
        return candidate;
      }
    }

    throw new Error("OpenClaw CLI is not installed or could not be resolved.");
  })();

  try {
    return await resolveOpenClawBinPromise;
  } finally {
    resolveOpenClawBinPromise = null;
  }
}

export function resetOpenClawBinCache() {
  resolvedOpenClawBin = process.env.OPENCLAW_BIN || "";
  resolveOpenClawBinPromise = null;
  npmGlobalPrefixPromise = null;
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

function createCommandError(message: string, stdout: string, stderr: string, code: number | null) {
  const error = new Error(message) as Error & {
    stdout: string;
    stderr: string;
    code: number | null;
  };

  error.stdout = stdout;
  error.stderr = stderr;
  error.code = code;

  return error;
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
  if (!npmGlobalPrefixPromise) {
    npmGlobalPrefixPromise = (async () => {
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
    })();
  }

  return npmGlobalPrefixPromise;
}

function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value);
}
