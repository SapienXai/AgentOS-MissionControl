import "server-only";

import { spawn } from "node:child_process";

import {
  getOpenClawLocalPrefixBinPath,
  getOpenClawUserLocalBinPath
} from "@/lib/openclaw/install";

export const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";
let resolvedOpenClawBin = "";
let resolveOpenClawBinPromise: Promise<string> | null = null;
const shellSafeSegmentPattern = /^[A-Za-z0-9_./:@=+%-]+$/;

interface CommandOptions {
  timeoutMs?: number;
  signal?: AbortSignal;
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
    const child = spawn(/*turbopackIgnore: true*/ openClawBin, args, {
      detached: true,
      env: buildOpenClawEnv()
    });

    let stdout = "";
    let stderr = "";
    let finished = false;
    let timedOut = false;
    let aborted = false;
    let callbackChain = Promise.resolve();
    let killTimer: ReturnType<typeof setTimeout> | null = null;

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

    const terminateChild = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
        } catch {
          child.kill(signal);
        }
      } else {
        child.kill(signal);
      }

      if (signal === "SIGTERM" && !killTimer) {
        killTimer = setTimeout(() => {
          if (!finished) {
            if (child.pid) {
              try {
                process.kill(-child.pid, "SIGKILL");
              } catch {
                child.kill("SIGKILL");
              }
            } else {
              child.kill("SIGKILL");
            }
          }
        }, 2_000);
      }
    };

    const timer = setTimeout(() => {
      timedOut = true;
      terminateChild("SIGTERM");
    }, options.timeoutMs ?? 45000);

    const handleAbort = () => {
      aborted = true;
      terminateChild("SIGTERM");
    };

    if (options.signal) {
      if (options.signal.aborted) {
        handleAbort();
      } else {
        options.signal.addEventListener("abort", handleAbort);
      }
    }

    const cleanup = () => {
      clearTimeout(timer);

      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }

      if (options.signal) {
        options.signal.removeEventListener("abort", handleAbort);
      }
    };

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
      cleanup();
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
      cleanup();
      settle(() => {
        if (aborted) {
          reject(
            createCommandError(
              "OpenClaw command was aborted.",
              stdout,
              stderr || "The command was aborted.",
              code
            )
          );
          return;
        }

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

export async function resolveOpenClawVersion(): Promise<string | null> {
  try {
    const result = await runOpenClaw(["--version"], { timeoutMs: 5_000 });
    return parseOpenClawVersion(result.stdout || result.stderr);
  } catch {
    return null;
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

export function formatOpenClawCommand(command: string, args: string[]) {
  return [command, ...args].map(quoteShellSegment).join(" ");
}

export async function resolveOpenClawBin(): Promise<string> {
  const candidates = getOpenClawBinCandidates();

  if (resolveOpenClawBinPromise) {
    return resolveOpenClawBinPromise;
  }

  resolveOpenClawBinPromise = (async () => {
    if (resolvedOpenClawBin) {
      return resolvedOpenClawBin;
    }

    for (const candidate of candidates) {
      if (await canExecuteOpenClaw(candidate)) {
        resolvedOpenClawBin = candidate;
        process.env.OPENCLAW_BIN = candidate;
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
  resolvedOpenClawBin = "";
  resolveOpenClawBinPromise = null;
}

export function getOpenClawBinCandidates() {
  const candidates = [
    process.env.OPENCLAW_BIN?.trim() || "",
    "openclaw",
    getOpenClawLocalPrefixBinPath(),
    getOpenClawUserLocalBinPath()
  ];

  return Array.from(new Set(candidates.filter((candidate) => Boolean(candidate))));
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

export function parseOpenClawVersion(output: string) {
  const trimmed = output.trim();

  if (!trimmed) {
    return null;
  }

  const versionMatch = trimmed.match(/\b(\d+(?:\.\d+)+)\b/);

  return versionMatch?.[1] ?? null;
}

function createCommandError(message: string, stdout: string, stderr: string, code: number | null) {
  const failureDetail = summarizeCommandFailure(stderr || stdout);
  const resolvedMessage =
    code !== null && /^OpenClaw command failed with exit code \d+\.$/.test(message) && failureDetail
      ? `${message.slice(0, -1)}: ${failureDetail}.`
      : message;

  const error = new Error(resolvedMessage) as Error & {
    stdout: string;
    stderr: string;
    code: number | null;
  };

  error.stdout = stdout;
  error.stderr = stderr;
  error.code = code;

  return error;
}

function summarizeCommandFailure(output: string) {
  const lines = output
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  if (lines.length === 0) {
    return "";
  }

  const priorityPatterns = [
    /Config path not found/i,
    /cannot find module/i,
    /command not found/i,
    /no such file or directory/i,
    /permission denied/i,
    /not writable/i,
    /failed/i,
    /\berror\b/i
  ];

  for (const pattern of priorityPatterns) {
    const matched = lines.find((line) => pattern.test(line));

    if (matched) {
      return matched;
    }
  }

  return lines.at(-1) ?? "";
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

function quoteShellSegment(value: string) {
  if (shellSafeSegmentPattern.test(value)) {
    return value;
  }

  return `'${value.replace(/'/g, "'\\''")}'`;
}

function buildOpenClawEnv() {
  return { ...process.env };
}

async function canExecuteOpenClaw(command: string) {
  return await new Promise<boolean>((resolve) => {
    const child = spawn(/*turbopackIgnore: true*/ command, ["--version"], {
      stdio: "ignore"
    });

    child.once("error", () => {
      resolve(false);
    });

    child.once("exit", (code) => {
      resolve(code === 0);
    });
  });
}
