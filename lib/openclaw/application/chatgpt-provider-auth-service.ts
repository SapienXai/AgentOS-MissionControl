import "server-only";

import { randomUUID } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { join } from "node:path";
import { assertOAuthCallbackAvailable } from "@/lib/openclaw/application/oauth-callback-availability";

import {
  buildOpenClawSpawnEnv,
  resolveOpenClawSpawnInvocation
} from "@/lib/openclaw/install";
import { resolveOpenClawBin, runOpenClaw } from "@/lib/openclaw/cli";
import { readOpenClawCodexPluginReady } from "@/lib/openclaw/application/model-provider-state-service";
import { validateOpenAiAuthorizationUrl } from "@/lib/openclaw/chatgpt-auth-url";
import type {
  ChatGptBrowserAuthSnapshot
} from "@/lib/agentos/contracts";

const chatGptAuthTimeoutMs = 6 * 60_000;
const pluginSetupTimeoutMs = 2 * 60_000;
const chatGptAuthSessionRetentionMs = 10 * 60_000;
const openAiAuthorizationUrlPattern = /https:\/\/auth\.openai\.com\/oauth\/authorize[^\s"'<>]*/ig;
const openClawPtyRunnerPath = join(process.cwd(), "scripts", "openclaw-pty-runner.py");

export type ChatGptProviderAuthDependencies = {
  platform: NodeJS.Platform;
  readPluginReady: () => Promise<boolean>;
  runSetupCommand: (args: string[], timeoutMs: number) => Promise<void>;
  runInteractiveLogin: (input: {
    force: boolean;
    signal?: AbortSignal;
    onBrowserUrl?: (url: string) => void;
    onManualInputRequired?: () => void;
    onChild?: (child: ChildProcess) => void;
  }) => Promise<void>;
};

export type ChatGptProviderAuthResult = {
  pluginInstalled: boolean;
  authMode: "openclaw-cli-interactive";
};

type ChatGptBrowserAuthSession = ChatGptBrowserAuthSnapshot & {
  child: ChildProcess | null;
  abortController: AbortController;
  completion: Promise<void>;
};

export class ChatGptBrowserAuthError extends Error {
  constructor(
    message: string,
    readonly code:
      | "chatgpt-auth-unsupported"
      | "chatgpt-auth-session-not-found"
      | "chatgpt-auth-session-complete"
      | "chatgpt-auth-redirect-invalid"
  ) {
    super(message);
    this.name = "ChatGptBrowserAuthError";
  }
}

const chatGptAuthSessions = new Map<string, ChatGptBrowserAuthSession>();
let authStartQueue: Promise<unknown> = Promise.resolve();

const defaultDependencies: ChatGptProviderAuthDependencies = {
  platform: process.platform,
  readPluginReady: async () => await readOpenClawCodexPluginReady(),
  runSetupCommand: async (args, timeoutMs) => {
    await runOpenClaw(args, { timeoutMs });
  },
  runInteractiveLogin: runOpenClawChatGptInteractiveLogin
};

export async function startOpenClawChatGptBrowserAuth(
  input: { force?: boolean } = {},
  dependencies: ChatGptProviderAuthDependencies = defaultDependencies
) {
  const started = authStartQueue.then(() => startBrowserAuthSession(input, dependencies));
  authStartQueue = started.catch(() => {});
  return started;
}

async function startBrowserAuthSession(
  input: { force?: boolean },
  dependencies: ChatGptProviderAuthDependencies
) {
  if (dependencies.platform !== "darwin") {
    throw new ChatGptBrowserAuthError(
      "Browser ChatGPT sign-in currently requires local AgentOS on macOS.",
      "chatgpt-auth-unsupported"
    );
  }

  const activeSession = [...chatGptAuthSessions.values()].find((session) =>
    !["completed", "error"].includes(session.state)
  );

  if (activeSession && input.force !== true && !activeSession.abortController.signal.aborted) {
    return toChatGptBrowserAuthSnapshot(activeSession);
  }

  if (activeSession) {
    activeSession.abortController.abort();
    await activeSession.completion.catch(() => {});
    if (chatGptAuthSessions.get(activeSession.sessionId) === activeSession) {
      chatGptAuthSessions.delete(activeSession.sessionId);
    }
  }

  const session: ChatGptBrowserAuthSession = {
    sessionId: randomUUID(),
    state: "preparing",
    browserUrl: null,
    message: "Preparing secure ChatGPT sign-in...",
    error: null,
    child: null,
    abortController: new AbortController(),
    completion: Promise.resolve()
  };

  chatGptAuthSessions.set(session.sessionId, session);
  session.completion = runBrowserAuthSession(session, input.force === true, dependencies);
  void session.completion;
  scheduleChatGptAuthSessionCleanup(session.sessionId);

  return toChatGptBrowserAuthSnapshot(session);
}

export function getOpenClawChatGptBrowserAuth(sessionId: string) {
  const session = chatGptAuthSessions.get(sessionId);

  if (!session) {
    throw new ChatGptBrowserAuthError(
      "The ChatGPT sign-in session is no longer available. Start again.",
      "chatgpt-auth-session-not-found"
    );
  }

  return toChatGptBrowserAuthSnapshot(session);
}

export function submitOpenClawChatGptBrowserAuth(input: {
  sessionId: string;
  redirectUrl: string;
}) {
  const session = chatGptAuthSessions.get(input.sessionId);

  if (!session) {
    throw new ChatGptBrowserAuthError(
      "The ChatGPT sign-in session is no longer available. Start again.",
      "chatgpt-auth-session-not-found"
    );
  }

  if (["completed", "error"].includes(session.state) || !session.child?.stdin) {
    throw new ChatGptBrowserAuthError(
      "This ChatGPT sign-in session is no longer waiting for a redirect URL.",
      "chatgpt-auth-session-complete"
    );
  }

  const redirectUrl = validateOpenAiRedirectInput(input.redirectUrl);
  session.state = "completing";
  session.message = "Finishing ChatGPT sign-in...";
  session.error = null;
  session.child.stdin.write(`${redirectUrl}\n`);

  return toChatGptBrowserAuthSnapshot(session);
}

export function cancelOpenClawChatGptBrowserAuth(sessionId: string) {
  const session = chatGptAuthSessions.get(sessionId);

  if (!session) {
    return;
  }

  session.abortController.abort();
  void session.completion.finally(() => chatGptAuthSessions.delete(sessionId));
}

async function runBrowserAuthSession(
  session: ChatGptBrowserAuthSession,
  force: boolean,
  dependencies: ChatGptProviderAuthDependencies
) {
  try {
    await prepareChatGptProviderAuth(dependencies);
    session.abortController.signal.throwIfAborted();
    session.state = "waiting-for-browser";
    session.message = "Open the ChatGPT sign-in page in the new browser tab.";

    await dependencies.runInteractiveLogin({
      force,
      signal: session.abortController.signal,
      onChild: (child) => {
        session.child = child;
      },
      onBrowserUrl: (browserUrl) => {
        session.browserUrl = browserUrl;
        session.state = "waiting-for-redirect";
        session.message = "Complete ChatGPT sign-in. If the callback page cannot load on this device, paste its full URL below.";
      },
      onManualInputRequired: () => {
        session.state = "waiting-for-redirect";
        session.message = "Paste the full redirect URL from the ChatGPT callback page to finish sign-in.";
      }
    });

    session.state = "completed";
    session.message = "ChatGPT sign-in completed. Refreshing model status...";
    session.error = null;
  } catch (error) {
    session.state = "error";
    session.message = "ChatGPT sign-in could not be completed.";
    session.error = error instanceof Error
      ? error.message
      : "OpenClaw did not complete ChatGPT sign-in.";
  } finally {
    session.child = null;
  }
}

export async function prepareChatGptProviderAuth(dependencies: ChatGptProviderAuthDependencies) {
  // An unavailable Gateway is not evidence that a plugin is missing.
  // Let the canonical login command verify provider support in that case.
  const pluginReady = await dependencies.readPluginReady().catch(() => null);

  if (pluginReady === false) {
    await dependencies.runSetupCommand(
      ["plugins", "install", "--force", "--accept-capabilities", "@openclaw/codex"],
      pluginSetupTimeoutMs
    );
    await dependencies.runSetupCommand(["gateway", "restart"], pluginSetupTimeoutMs);
  }

  return pluginReady === false;
}

function toChatGptBrowserAuthSnapshot(session: ChatGptBrowserAuthSession): ChatGptBrowserAuthSnapshot {
  return {
    sessionId: session.sessionId,
    state: session.state,
    browserUrl: session.browserUrl,
    message: session.message,
    error: session.error
  };
}

function scheduleChatGptAuthSessionCleanup(sessionId: string) {
  const timer = setTimeout(() => {
    chatGptAuthSessions.delete(sessionId);
  }, chatGptAuthSessionRetentionMs);
  timer.unref?.();
}

export function extractOpenAiAuthorizationUrl(output: string) {
  const cleanOutput = output.replace(/\u001b\[[0-?]*[ -\/]*[@-~]/g, "");

  for (const match of cleanOutput.matchAll(openAiAuthorizationUrlPattern)) {
    const candidate = match[0].replace(/[\])},.;]+$/g, "");

    const authorizationUrl = validateOpenAiAuthorizationUrl(candidate);
    if (authorizationUrl) {
      return authorizationUrl;
    }
  }

  return null;
}

function validateOpenAiRedirectInput(value: string) {
  const redirectUrl = value.trim();

  try {
    const url = new URL(redirectUrl);
    const allowedHosts = new Set(["localhost", "127.0.0.1", "[::1]"]);

    if (
      url.protocol !== "http:" ||
      !allowedHosts.has(url.hostname) ||
      url.port !== "1455" ||
      url.pathname !== "/auth/callback" ||
      !url.searchParams.get("code") ||
      !url.searchParams.get("state")
    ) {
      throw new Error("The redirect URL must be the complete OpenAI localhost callback URL.");
    }

    return redirectUrl;
  } catch (error) {
    throw new ChatGptBrowserAuthError(
      error instanceof Error && error.message
        ? error.message
        : "Paste the complete OpenAI localhost callback URL.",
      "chatgpt-auth-redirect-invalid"
    );
  }
}

/**
 * Runs OpenClaw's official provider-auth flow without handing a shell command to
 * the operator. The current OpenClaw Gateway contract does not expose OAuth
 * start through Gateway, so this remains an explicit, isolated CLI fallback at
 * the application boundary.
 */
export async function connectOpenClawChatGptProvider(
  input: {
    force?: boolean;
    signal?: AbortSignal;
  } = {},
  dependencies: ChatGptProviderAuthDependencies = defaultDependencies
): Promise<ChatGptProviderAuthResult> {
  if (dependencies.platform !== "darwin") {
    throw new Error(
      "In-app ChatGPT sign-in currently requires local AgentOS on macOS. OpenClaw does not expose provider OAuth through Gateway yet."
    );
  }

  const pluginInstalled = await prepareChatGptProviderAuth(dependencies);

  await dependencies.runInteractiveLogin({
    force: input.force === true,
    signal: input.signal
  });

  return {
    pluginInstalled,
    authMode: "openclaw-cli-interactive"
  };
}

async function runOpenClawChatGptInteractiveLogin(input: {
  force: boolean;
  signal?: AbortSignal;
  onBrowserUrl?: (url: string) => void;
  onManualInputRequired?: () => void;
  onChild?: (child: ChildProcess) => void;
}) {
  const openClawBin = await resolveOpenClawBin();
  input.signal?.throwIfAborted();
  await assertOAuthCallbackAvailable();
  input.signal?.throwIfAborted();
  const args = [
    "models",
    "auth",
    "login",
    "--provider",
    "openai",
    ...(input.force ? ["--force"] : []),
    "--set-default"
  ];
  const invocation = resolveOpenClawSpawnInvocation(openClawBin, args);

  await new Promise<void>((resolve, reject) => {
    const child = spawn(
      process.platform === "darwin" ? "/usr/bin/python3" : "/usr/bin/script",
      process.platform === "darwin"
        ? [openClawPtyRunnerPath, invocation.command, ...invocation.args]
        : ["-q", "/dev/null", invocation.command, ...invocation.args],
      {
        detached: true,
        env: buildOpenClawSpawnEnv(),
        stdio: ["pipe", "pipe", "pipe"],
        windowsHide: true
      }
    );
    input.onChild?.(child);
    let outputBuffer = "";
    let browserUrlReported: string | null = null;
    const handleOutput = (chunk: Buffer | string) => {
      outputBuffer = `${outputBuffer}${String(chunk)}`.slice(-16_384);
      const browserUrl = extractOpenAiAuthorizationUrl(outputBuffer);

      if (browserUrl && browserUrl !== browserUrlReported) {
        browserUrlReported = browserUrl;
        input.onBrowserUrl?.(browserUrl);
      }

      if (/Paste the authorization code|Paste the redirect URL/i.test(outputBuffer)) {
        input.onManualInputRequired?.();
      }
    };
    child.stdout?.on("data", handleOutput);
    child.stderr?.on("data", handleOutput);
    let settled = false;
    let stopError: Error | null = null;
    let killTimer: ReturnType<typeof setTimeout> | null = null;

    const terminate = (signal: NodeJS.Signals) => {
      if (child.pid) {
        try {
          process.kill(-child.pid, signal);
          return;
        } catch {}
      }
      child.kill(signal);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      input.signal?.removeEventListener("abort", handleAbort);
    };
    const finish = (handler: () => void) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      handler();
    };
    const stop = () => {
      terminate("SIGTERM");
      killTimer = setTimeout(() => terminate("SIGKILL"), 2_000);
      killTimer.unref();
    };
    const handleAbort = () => {
      if (stopError) return;
      stopError = new Error("ChatGPT sign-in was cancelled.");
      stop();
    };
    const timeout = setTimeout(() => {
      if (stopError) return;
      stopError = new Error("ChatGPT sign-in timed out. Close any stale authorization tab and try again.");
      stop();
    }, chatGptAuthTimeoutMs);

    if (input.signal?.aborted) {
      handleAbort();
    }
    input.signal?.addEventListener("abort", handleAbort, { once: true });

    child.once("error", () => {
      finish(() => reject(new Error("OpenClaw could not start the in-app ChatGPT sign-in flow.")));
    });
    child.once("close", (code, signal) => {
      if (killTimer) {
        clearTimeout(killTimer);
        killTimer = null;
      }
      if (settled) {
        return;
      }
      if (stopError) {
        finish(() => reject(stopError));
        return;
      }
      if (code === 0) {
        finish(resolve);
        return;
      }
      finish(() => reject(new Error(
        signal
          ? "ChatGPT sign-in was interrupted before OpenClaw saved the account."
          : "OpenClaw did not complete ChatGPT sign-in. Close any stale authorization tab and try again."
      )));
    });
  });
}
