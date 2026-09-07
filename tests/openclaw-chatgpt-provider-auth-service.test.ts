import assert from "node:assert/strict";
import { test } from "node:test";

import {
  connectOpenClawChatGptProvider,
  extractOpenAiAuthorizationUrl
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
});

test("ChatGPT provider auth runs OpenClaw login directly when the Codex plugin is ready", async () => {
  const setupCalls: string[][] = [];
  const repairCalls: string[] = [];
  const loginCalls: Array<{ force: boolean }> = [];

  const result = await connectOpenClawChatGptProvider(
    { force: true },
    {
      platform: "darwin",
      readPluginReady: async () => true,
      runSetupCommand: async (args) => {
        setupCalls.push(args);
      },
      repairGatewayAccess: async () => {
        repairCalls.push("repair");
      },
      runInteractiveLogin: async (input) => {
        loginCalls.push({ force: input.force });
      }
    }
  );

  assert.deepEqual(setupCalls, []);
  assert.deepEqual(repairCalls, ["repair"]);
  assert.deepEqual(loginCalls, [{ force: true }]);
  assert.deepEqual(result, {
    pluginInstalled: false,
    authMode: "openclaw-cli-interactive"
  });
});

test("ChatGPT provider auth installs and repairs the Codex plugin before login", async () => {
  const calls: string[] = [];

  const result = await connectOpenClawChatGptProvider(
    {},
    {
      platform: "darwin",
      readPluginReady: async () => false,
      runSetupCommand: async (args) => {
        calls.push(args.join(" "));
      },
      repairGatewayAccess: async () => {
        calls.push("repair gateway access");
      },
      runInteractiveLogin: async (input) => {
        calls.push(`login force=${input.force}`);
      }
    }
  );

  assert.deepEqual(calls, [
    "plugins install --force --accept-capabilities @openclaw/codex",
    "gateway restart",
    "repair gateway access",
    "login force=false"
  ]);
  assert.equal(result.pluginInstalled, true);
});

test("ChatGPT provider auth fails honestly when in-app OAuth is unavailable", async () => {
  await assert.rejects(
    () => connectOpenClawChatGptProvider(
      {},
      {
        platform: "linux",
        readPluginReady: async () => true,
        runSetupCommand: async () => {},
        repairGatewayAccess: async () => {},
        runInteractiveLogin: async () => {}
      }
    ),
    /requires local AgentOS on macOS/
  );
});
