import assert from "node:assert/strict";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import {
  connectOpenClawChatGptProvider,
  extractOpenAiAuthorizationUrl,
  getOpenClawChatGptBrowserAuth,
  prepareChatGptProviderAuth,
  startOpenClawChatGptBrowserAuth
} from "@/lib/openclaw/application/chatgpt-provider-auth-service";

test("ChatGPT provider auth extracts only the canonical OpenAI authorization URL", () => {
  const authorizationUrl = extractOpenAiAuthorizationUrl(
    "\u001b[32mOpen: https://auth.openai.com/oauth/authorize?client_id=test&state=state-123\u001b[0m"
  );

  assert.equal(
    authorizationUrl,
    "https://auth.openai.com/oauth/authorize?client_id=test&state=state-123"
  );
  assert.equal(
    extractOpenAiAuthorizationUrl("Open: https://example.com/oauth/authorize?state=state-123"),
    null
  );
  assert.equal(
    extractOpenAiAuthorizationUrl("Open: https://auth.openai.com.evil.example/oauth/authorize?state=state-123"),
    null
  );
  assert.equal(
    extractOpenAiAuthorizationUrl("Open: https://auth.openai.com/oauth/authorize?state=state-123#fragment"),
    null
  );
});

test("ChatGPT provider auth runs OpenClaw login directly when the Codex plugin is ready", async () => {
  const setupCalls: string[][] = [];
  const loginCalls: Array<{ force: boolean }> = [];

  const result = await connectOpenClawChatGptProvider(
    { force: true },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async (args) => {
        setupCalls.push(args);
      },
      runInteractiveLogin: async (input) => {
        loginCalls.push({ force: input.force });
      }
    }
  );

  assert.deepEqual(setupCalls, []);
  assert.deepEqual(loginCalls, [{ force: true }]);
  assert.deepEqual(result, {
    pluginInstalled: false,
    authMode: "openclaw-cli-interactive"
  });
});

test("ChatGPT provider auth installs the Codex plugin before login without device repair", async () => {
  const calls: string[] = [];

  const result = await connectOpenClawChatGptProvider(
    {},
    {
      platform: "darwin",
      readPluginReady: async () => false,
      runSetupCommand: async (args) => {
        calls.push(args.join(" "));
      },
      runInteractiveLogin: async (input) => {
        calls.push(`login force=${input.force}`);
      }
    }
  );

  assert.deepEqual(calls, [
    "plugins install --force --accept-capabilities @openclaw/codex",
    "gateway restart",
    "login force=false"
  ]);
  assert.equal(result.pluginInstalled, true);
});

test("ChatGPT OAuth preparation reaches the interactive login boundary with shared local auth", async () => {
  const calls: string[] = [];

  const pluginInstalled = await prepareChatGptProviderAuth({
    platform: "darwin",
    readPluginReady: async () => true,
    runSetupCommand: async () => {
      calls.push("setup");
    },
    runInteractiveLogin: async () => {
      calls.push("login");
    }
  });

  assert.equal(pluginInstalled, false);
  assert.deepEqual(calls, []);
});

test("ChatGPT browser auth progresses from preparation to redirect wait and completion", async () => {
  const loginControl: { release?: () => void } = {};
  const authorizationUrl = "https://auth.openai.com/oauth/authorize?client_id=test&state=state-123";

  const started = await startOpenClawChatGptBrowserAuth(
    { force: true },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async () => {},
      runInteractiveLogin: async ({ onBrowserUrl }) => {
        onBrowserUrl?.(authorizationUrl);
        await new Promise<void>((resolve) => {
          loginControl.release = resolve;
        });
      }
    }
  );

  assert.equal(started.state, "preparing");
  await delay(0);
  const waiting = getOpenClawChatGptBrowserAuth(started.sessionId);
  assert.equal(waiting.state, "waiting-for-redirect");
  assert.equal(waiting.browserUrl, authorizationUrl);

  const release = loginControl.release;
  if (!release) {
    throw new Error("The test login session did not reach the redirect wait state.");
  }
  release();
  await delay(0);
  assert.equal(getOpenClawChatGptBrowserAuth(started.sessionId).state, "completed");
});

test("ChatGPT browser auth preserves a recoverable preparation failure", async () => {
  const started = await startOpenClawChatGptBrowserAuth(
    { force: true },
    {
      platform: "darwin",
      readPluginReady: async () => false,
      runSetupCommand: async () => {
        throw new Error("Codex plugin install failed");
      },
      runInteractiveLogin: async () => {
        throw new Error("interactive login should not start");
      }
    }
  );

  await delay(0);
  const failed = getOpenClawChatGptBrowserAuth(started.sessionId);
  assert.equal(failed.state, "error");
  assert.match(failed.error ?? "", /Codex plugin install failed/);
});

test("ChatGPT provider auth fails honestly when in-app OAuth is unavailable", async () => {
  await assert.rejects(
    () => connectOpenClawChatGptProvider(
      {},
      {
        platform: "linux",
        readPluginReady: async () => true,
        runSetupCommand: async () => {},
        runInteractiveLogin: async () => {}
      }
    ),
    /requires local AgentOS on macOS/
  );
});
