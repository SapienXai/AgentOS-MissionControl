import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, test } from "node:test";

import {
  getOpenClawGatewayClient,
  resetOpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client-factory";
import { saveAgentOsGatewayAuthCredential } from "@/lib/agentos/runtime-auth";
import { OfficialGatewayHarness } from "@/tests/helpers/official-gateway-harness";
import { normalizeModelStatusPayload } from "@/lib/openclaw/client/native-ws-gateway-payloads";
import { buildModelStatusConnectionStatus } from "@/lib/openclaw/domains/model-provider-connection";

const ENVIRONMENT_KEYS = [
  "AGENTOS_OPENCLAW_GATEWAY_CLIENT",
  "OPENCLAW_GATEWAY_CLIENT",
  "AGENTOS_OPENCLAW_NATIVE_WS",
  "AGENTOS_OPENCLAW_GATEWAY_URL",
  "OPENCLAW_GATEWAY_URL",
  "AGENTOS_OPENCLAW_GATEWAY_TOKEN",
  "OPENCLAW_GATEWAY_TOKEN",
  "AGENTOS_OPENCLAW_GATEWAY_PASSWORD",
  "OPENCLAW_GATEWAY_PASSWORD",
  "OPENCLAW_STATE_DIR",
  "AGENTOS_RUNTIME_DIR"
] as const;

const originalEnvironment = new Map(
  ENVIRONMENT_KEYS.map((key) => [key, process.env[key]])
);

afterEach(() => {
  resetOpenClawGatewayClient("factory test cleanup");
  for (const key of ENVIRONMENT_KEYS) {
    const value = originalEnvironment.get(key);
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("default factory selects the official-backed domain path", () => {
  delete process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT;
  delete process.env.OPENCLAW_GATEWAY_CLIENT;
  delete process.env.AGENTOS_OPENCLAW_NATIVE_WS;

  const client = getOpenClawGatewayClient();
  const diagnostics = client.getDiagnostics?.();
  assert.equal(diagnostics?.transportImplementation, "official");
  assert.equal("transportSelectionWarning" in (diagnostics ?? {}), false);
});

test("forced CLI is the only alternate factory path", () => {
  process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT = "cli";
  const diagnostics = getOpenClawGatewayClient().getDiagnostics?.();
  assert.equal(diagnostics?.transportImplementation, "cli");
  assert.equal(diagnostics?.mode, "cli");
});

test("default factory reaches the official Gateway through the real domain client", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-factory-official-state-"));
  const harness = await OfficialGatewayHarness.create({
    routes: {
      health: ({ respond }) => respond({ ok: true, source: "official-harness" })
    }
  });

  try {
    delete process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT;
    delete process.env.OPENCLAW_GATEWAY_CLIENT;
    delete process.env.AGENTOS_OPENCLAW_NATIVE_WS;
    process.env.AGENTOS_OPENCLAW_GATEWAY_URL = harness.url;
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = "factory-test-token";
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const client = getOpenClawGatewayClient();
    const health = await client.getHealth({ timeoutMs: 2_000 });
    assert.deepEqual(health, { ok: true, source: "official-harness" });
    assert.equal(client.getDiagnostics?.().transportImplementation, "official");
    assert.equal(harness.connectionCount, 1);
    assert.deepEqual(harness.requests.map(({ method }) => method), ["connect", "health"]);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await harness.close();
  }
});

test("packaged factory loads the persisted shared Gateway credential after restart", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-factory-persisted-state-"));
  const runtimeDir = await mkdtemp(join(tmpdir(), "agentos-factory-persisted-runtime-"));
  const harness = await OfficialGatewayHarness.create({
    routes: {
      health: ({ respond }) => respond({ ok: true, source: "persisted-credential" })
    }
  });

  try {
    delete process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT;
    delete process.env.OPENCLAW_GATEWAY_CLIENT;
    delete process.env.AGENTOS_OPENCLAW_NATIVE_WS;
    delete process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN;
    delete process.env.OPENCLAW_GATEWAY_TOKEN;
    delete process.env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD;
    delete process.env.OPENCLAW_GATEWAY_PASSWORD;
    process.env.AGENTOS_OPENCLAW_GATEWAY_URL = harness.url;
    process.env.AGENTOS_RUNTIME_DIR = runtimeDir;
    process.env.OPENCLAW_STATE_DIR = stateDir;
    await saveAgentOsGatewayAuthCredential({ kind: "token", value: "persisted-factory-token" });

    const client = getOpenClawGatewayClient();
    const health = await client.getHealth({ timeoutMs: 2_000 });
    assert.deepEqual(health, { ok: true, source: "persisted-credential" });
    const connectParams = harness.requests[0]?.params as { auth?: unknown } | undefined;
    assert.deepEqual(connectParams?.auth, { token: "persisted-factory-token" });
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await rm(runtimeDir, { recursive: true, force: true });
    await harness.close();
  }
});

test("official Gateway auth refresh exposes post-OAuth ChatGPT models to AgentOS", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-factory-oauth-refresh-state-"));
  let authRefreshed = false;
  const harness = await OfficialGatewayHarness.create({
    routes: {
      "models.authStatus": ({ request, respond }) => {
        const params = request.params as { refresh?: boolean } | undefined;
        if (params?.refresh === true) {
          authRefreshed = true;
          respond({
            providers: [{
              provider: "openai",
              status: "ok",
              profiles: [{
                profileId: "openai:user@example.com",
                type: "oauth",
                status: "ok"
              }]
            }]
          });
          return;
        }

        respond({ providers: [] });
      },
      "models.list": ({ request, respond }) => {
        const params = request.params as { refresh?: boolean } | undefined;
        respond({
          models: authRefreshed && params?.refresh === true
            ? [{
                key: "openai/gpt-5.5",
                name: "gpt-5.5",
                provider: "openai",
                available: true,
                tags: []
              }]
            : []
        });
      }
    }
  });

  try {
    delete process.env.AGENTOS_OPENCLAW_GATEWAY_CLIENT;
    delete process.env.OPENCLAW_GATEWAY_CLIENT;
    delete process.env.AGENTOS_OPENCLAW_NATIVE_WS;
    process.env.AGENTOS_OPENCLAW_GATEWAY_URL = harness.url;
    process.env.AGENTOS_OPENCLAW_GATEWAY_TOKEN = "factory-oauth-refresh-token";
    process.env.OPENCLAW_STATE_DIR = stateDir;

    const client = getOpenClawGatewayClient();
    const staleAuth = await client.call<{ providers: unknown[] }>("models.authStatus", {});
    const refreshedAuth = await client.call<{ providers: unknown[] }>("models.authStatus", { refresh: true });
    const models = await client.listModels({ all: true, provider: "openai", refresh: true });
    const status = normalizeModelStatusPayload(refreshedAuth, models);
    const connection = buildModelStatusConnectionStatus("openai", status, []);

    assert.deepEqual(staleAuth, { providers: [] });
    assert.equal(authRefreshed, true);
    assert.equal(refreshedAuth.providers?.[0]?.provider, "openai");
    assert.deepEqual(models.models.map((model) => model.key), ["openai/gpt-5.5"]);
    assert.equal(connection?.connected, true);
    assert.equal(connection?.authMethod, "chatgpt-oauth");
    assert.deepEqual(
      harness.requests.map(({ method }) => method),
      ["connect", "models.authStatus", "models.authStatus", "models.list"]
    );
    assert.deepEqual((harness.requests[2]?.params), { refresh: true });
  } finally {
    await rm(stateDir, { recursive: true, force: true });
    await harness.close();
  }
});

test("factory and policy contain no legacy native selector or custom branch", async () => {
  const factory = await readFile(join(process.cwd(), "lib/openclaw/client/gateway-client-factory.ts"), "utf8");
  const policy = await readFile(join(process.cwd(), "lib/openclaw/client/native-ws-gateway-policy.ts"), "utf8");
  assert.doesNotMatch(factory, /transport selector|custom transport|PersistentOpenClawGatewayConnection/);
  assert.doesNotMatch(factory, /WebSocketFactory|webSocketFactory/);
  assert.doesNotMatch(policy, /AGENTOS_OPENCLAW_TRANSPORT|resolveOpenClawTransportSelection/);
  assert.match(factory, /createOfficialBackedOpenClawGatewayClient/);
  assert.match(factory, /isCliGatewayClientForcedByEnv/);
});
