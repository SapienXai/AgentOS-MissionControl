import "server-only";

import { spawn } from "node:child_process";

export const OPENCLAW_BIN = process.env.OPENCLAW_BIN || "openclaw";
let resolvedOpenClawBin = process.env.OPENCLAW_BIN || "";
let resolveOpenClawBinPromise: Promise<string> | null = null;
const shellSafeSegmentPattern = /^[A-Za-z0-9_./:@=+%-]+$/;

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
    const child = spawn(/*turbopackIgnore: true*/ openClawBin, args, {
      env: buildOpenClawEnv()
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

export function formatOpenClawCommand(command: string, args: string[]) {
  return [command, ...args].map(quoteShellSegment).join(" ");
}

export async function resolveOpenClawBin(): Promise<string> {
  if (resolvedOpenClawBin) {
    return resolvedOpenClawBin;
  }

  if (resolveOpenClawBinPromise) {
    return resolveOpenClawBinPromise;
  }

  resolveOpenClawBinPromise = (async () => {
    const candidate = process.env.OPENCLAW_BIN?.trim() || OPENCLAW_BIN;

    if (await canExecuteOpenClaw(candidate)) {
      resolvedOpenClawBin = candidate;
      return candidate;
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
