import assert from "node:assert/strict";
import { afterEach, test } from "node:test";

import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { OpenClawLifecycleService, setOpenClawLifecycleServiceForTesting } from "@/lib/openclaw/lifecycle/service";
import {
  GET as modelsProviderGet,
  POST as modelsProviderPost
} from "@/app/api/models/providers/route";
import {
  addOpenClawExplicitProviderModelsToConfig,
  addOpenClawModelsToConfig,
  ensureOpenClawModelRuntimeConfig,
  ensureOpenClawOllamaLocalCredential,
  persistOpenClawProviderToken,
  readOpenClawProviderConfigSummary,
  readOpenClawProviderModelStatus,
  readOpenClawCodexPluginReady,
  removeOpenClawProviderCredential,
  removeOpenClawConfiguredModelFromConfig,
  setOpenClawDefaultModel,
  updateOpenClawProviderSettings
} from "@/lib/openclaw/application/model-provider-state-service";
import { buildModelStatusConnectionStatus } from "@/lib/openclaw/domains/model-provider-connection";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/gateway-client";

const originalFetch = globalThis.fetch;

function fetchRouteGet() {
  return modelsProviderGet(new Request("http://agentos.test/api/models/providers"));
}

afterEach(() => {
  setOpenClawAdapterForTesting(null);
  setOpenClawLifecycleServiceForTesting(null);
  globalThis.fetch = originalFetch;
});

test("provider token persistence writes the OpenClaw runtime env target atomically", async () => {
  const calls: Array<{ path: string; value: unknown }> = [];
  setOpenClawAdapterForTesting({
    async getConfig() {
      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  await persistOpenClawProviderToken("openrouter", "sk-or-test");

  assert.deepEqual(calls, [{
    path: "env.vars.OPENROUTER_API_KEY",
    value: "sk-or-test"
  }]);
});

test("provider credential persistence replaces an invalid empty endpoint and preserves models", async () => {
  const calls: Array<{ kind: "set" | "unset"; path: string; value?: unknown }> = [];
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      return path === "models.providers.openrouter" ? { baseUrl: "", models: [{ id: "auto" }] } : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ kind: "set", path, value });
      return { stdout: "", stderr: "", code: 0 };
    },
    async unsetConfig(path: string) {
      calls.push({ kind: "unset", path });
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  const result = await persistOpenClawProviderToken("openrouter", "sk-or-test");

  assert.deepEqual(calls, [
    { kind: "unset", path: "models.providers.openrouter.baseUrl" },
    { kind: "unset", path: "models.providers.openrouter.baseURL" },
    { kind: "set", path: "env.vars.OPENROUTER_API_KEY", value: "sk-or-test" }
  ]);
  assert.equal(result.repairedBlankEndpoint, true);
});

test("provider credential persistence preserves a non-empty environment-backed endpoint", async () => {
  const calls: Array<{ path: string; value: unknown }> = [];
  setOpenClawAdapterForTesting({
    async getConfig() {
      return { baseUrl: "${OPENROUTER_BASE_URL}" };
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  await persistOpenClawProviderToken("openrouter", "sk-or-test");

  assert.deepEqual(calls, [{
    path: "env.vars.OPENROUTER_API_KEY",
    value: "sk-or-test"
  }]);
});

test("provider credential persistence preserves a concrete custom endpoint", async () => {
  const calls: Array<{ path: string; value: unknown }> = [];
  setOpenClawAdapterForTesting({
    async getConfig() {
      return { baseUrl: "https://gateway.example.test/v1", models: [{ id: "auto" }] };
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  await persistOpenClawProviderToken("openrouter", "sk-or-test");

  assert.deepEqual(calls, [{
    path: "env.vars.OPENROUTER_API_KEY",
    value: "sk-or-test"
  }]);
});

test("provider credential registry resolves Anthropic, Gemini, and xAI config targets", async () => {
  const calls: Array<{ path: string; value: unknown }> = [];
  setOpenClawAdapterForTesting({
    async getConfig() {
      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  await persistOpenClawProviderToken("anthropic", "sk-ant-test");
  await persistOpenClawProviderToken("google", "gemini-test");
  await persistOpenClawProviderToken("xai", "xai-test");

  assert.deepEqual(calls.map(({ path }) => path), [
    "env.vars.ANTHROPIC_API_KEY",
    "env.vars.GEMINI_API_KEY",
    "env.vars.XAI_API_KEY"
  ]);
  assert.deepEqual(calls.map(({ value }) => value), [
    "sk-ant-test",
    "gemini-test",
    "xai-test"
  ]);
});

test("local Ollama credential repair writes the non-secret OpenClaw marker", async () => {
  const calls: Array<{ path: string; value?: unknown }> = [];
  let providerConfig: unknown = {
    models: [{ id: "qwen3.5:9b" }]
  };

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      return path === "models.providers.ollama" ? providerConfig : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      providerConfig = {
        ...(providerConfig as object),
        ...(path.endsWith(".baseUrl") ? { baseUrl: value } : {}),
        ...(path.endsWith(".api") ? { api: value } : {}),
        ...(path.endsWith(".apiKey") ? { apiKey: value } : {})
      };
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  assert.deepEqual(await ensureOpenClawOllamaLocalCredential(), { configured: true });
  assert.deepEqual(await ensureOpenClawOllamaLocalCredential(), { configured: false });
  assert.deepEqual(calls, [
    { path: "models.providers.ollama.baseUrl", value: "http://127.0.0.1:11434" },
    { path: "models.providers.ollama.api", value: "ollama" },
    { path: "models.providers.ollama.apiKey", value: "ollama-local" }
  ]);
});

test("local Ollama credential repair preserves an existing provider credential", async () => {
  let setConfigCalled = false;
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      return path === "models.providers.ollama"
        ? {
            apiKey: "ollama-local",
            baseUrl: "http://127.0.0.1:11434",
            api: "ollama",
            models: [{ id: "qwen3.5:9b" }]
          }
        : null;
    },
    async setConfig() {
      setConfigCalled = true;
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  assert.deepEqual(await ensureOpenClawOllamaLocalCredential(), { configured: false });
  assert.equal(setConfigCalled, false);
});

test("provider credential persistence rejects malformed endpoint overrides before config mutation", async () => {
  let setConfigCalled = false;
  setOpenClawAdapterForTesting({
    async getConfig() {
      return {};
    },
    async setConfig() {
      setConfigCalled = true;
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  await assert.rejects(
    () => persistOpenClawProviderToken("openrouter", "sk-or-test", { endpoint: "not-a-url" }),
    /provider endpoint must be a valid HTTP or HTTPS URL/
  );
  assert.equal(setConfigCalled, false);
});

test("Gateway-stored provider credentials make configured model routes ready without auth profiles", async () => {
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "env.vars.OPENROUTER_API_KEY") {
        return "[redacted]";
      }
      return null;
    },
    async getModelStatus() {
      return { allowed: ["openrouter/openai/gpt-5"] };
    }
  } as unknown as OpenClawAdapter);

  const status = await readOpenClawProviderModelStatus();
  const connection = buildModelStatusConnectionStatus("openrouter", status, ["openrouter/openai/gpt-5"]);

  assert.equal(connection?.connected, true);
  assert.equal(connection?.needsTerminal, false);
});

test("fresh ChatGPT OAuth is verified after an explicit Gateway auth refresh without configured models", async () => {
  let refreshCalls = 0;
  let normalStatusCalls = 0;

  setOpenClawAdapterForTesting({
    async getConfig() {
      return null;
    },
    async refreshModelAuthStatus(options: OpenClawCommandOptions) {
      refreshCalls += 1;
      assert.deepEqual(options, { timeoutMs: 8_000 });
      return {
        providers: [{
          provider: "openai",
          status: "ok",
          profiles: [{
            profileId: "openai:user@example.com",
            type: "oauth",
            status: "ok"
          }]
        }]
      };
    },
    async getModelStatus() {
      normalStatusCalls += 1;
      return {};
    }
  } as unknown as OpenClawAdapter);

  const status = await readOpenClawProviderModelStatus({ refreshAuth: true });
  const connection = buildModelStatusConnectionStatus("openai", status, []);

  assert.equal(refreshCalls, 1);
  assert.equal(normalStatusCalls, 0);
  assert.deepEqual(status?.allowed, []);
  assert.equal(connection?.connected, true);
  assert.equal(connection?.authMethod, "chatgpt-oauth");
  assert.equal(connection?.verification, "credential-stored");
});

test("valid ChatGPT OAuth remains connected when model discovery fails", async () => {
  setOpenClawAdapterForTesting({
    async getConfig() {
      return null;
    },
    async refreshModelAuthStatus() {
      return {
        providers: [{
          provider: "openai",
          status: "ok",
          profiles: [{
            profileId: "openai:user@example.com",
            type: "oauth",
            status: "ok"
          }]
        }]
      };
    },
    async listModels() {
      throw new Error("OpenClaw model catalog temporarily unavailable");
    },
    async scanModels() {
      throw new Error("OpenClaw model catalog temporarily unavailable");
    }
  } as unknown as OpenClawAdapter);

  const response = await modelsProviderPost(
    new Request("http://agentos.test/api/models/providers", {
      method: "POST",
      body: JSON.stringify({
        action: "status",
        provider: "openai",
        refreshAuth: true,
        discover: true,
        includeSnapshot: true
      })
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.connection.connected, true);
  assert.equal(payload.connection.authMethod, "chatgpt-oauth");
  assert.equal(payload.connection.degraded, true);
  assert.equal(payload.discovery.status, "failed");
  assert.equal(payload.discovery.retryable, true);
  assert.match(payload.message, /model discovery failed/i);
});

test("Gateway secret references count as stored provider credentials without exposing values", async () => {
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "env.vars.OPENROUTER_API_KEY") {
        return { source: "env", provider: "default", id: "OPENROUTER_API_KEY" };
      }
      return null;
    },
    async getModelStatus() {
      return { allowed: ["openrouter/auto"] };
    }
  } as unknown as OpenClawAdapter);

  const status = await readOpenClawProviderModelStatus();
  const connection = buildModelStatusConnectionStatus("openrouter", status, ["openrouter/auto"]);

  assert.equal(connection?.connected, true);
  assert.equal(connection?.verification, "credential-stored");
  assert.doesNotMatch(JSON.stringify(status), /OPENROUTER_API_KEY/);
});

test("provider config summary exposes editable metadata without returning credentials", async () => {
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "models.providers.entrim") {
        return {
          baseUrl: "https://api.entrim.test/v1",
          api: "openai-completions",
          apiKey: "secret-value",
          models: [{ id: "qwen" }]
        };
      }
      return null;
    }
  } as unknown as OpenClawAdapter);

  const summary = await readOpenClawProviderConfigSummary("entrim");

  assert.deepEqual(summary, {
    provider: "entrim",
    kind: "custom",
    providerId: "entrim",
    baseUrl: "https://api.entrim.test/v1",
    api: "openai-completions",
    modelCount: 1,
    credentialConfigured: true,
    endpointOverride: true,
    editable: true
  });
  assert.doesNotMatch(JSON.stringify(summary), /secret-value/);
});

test("provider settings update resets bundled endpoints and edits custom provider paths", async () => {
  const calls: Array<{ kind: "set" | "unset"; path: string; value?: unknown }> = [];
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "models.providers.openrouter") {
        return { baseUrl: "https://proxy.example/v1", apiKey: "[redacted]" };
      }
      if (path === "models.providers.entrim") {
        return {
          baseUrl: "https://old.example/v1",
          api: "openai-completions",
          apiKey: "[redacted]",
          models: [{ id: "qwen" }]
        };
      }
      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ kind: "set", path, value });
      return { stdout: "", stderr: "", code: 0 };
    },
    async unsetConfig(path: string) {
      calls.push({ kind: "unset", path });
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  await updateOpenClawProviderSettings("openrouter", { endpoint: null });
  await updateOpenClawProviderSettings("entrim", {
    endpoint: "https://new.example/v1",
    api: "openai-responses"
  });

  assert.deepEqual(calls, [
    { kind: "unset", path: "models.providers.openrouter.baseUrl" },
    { kind: "set", path: "models.providers.entrim.baseUrl", value: "https://new.example/v1" },
    { kind: "unset", path: "models.providers.entrim.baseURL" },
    { kind: "set", path: "models.providers.entrim.api", value: "openai-responses" }
  ]);
});

test("provider credential replacement stays Gateway-native and never returns the secret", async () => {
  const calls: Array<{ path: string; value: unknown }> = [];
  let storedCredential: unknown = "[redacted]";
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "env.vars.OPENROUTER_API_KEY") {
        return storedCredential;
      }
      if (path === "agents.defaults") {
        return { model: { primary: "" }, models: {} };
      }
      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      if (path === "env.vars.OPENROUTER_API_KEY") {
        storedCredential = "[redacted]";
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    async getModelStatus() {
      return { allowed: [] };
    }
  } as unknown as OpenClawAdapter);

  const response = await modelsProviderPost(
    new Request("http://agentos.test/api/models/providers", {
      method: "POST",
      body: JSON.stringify({
        action: "replace-credential",
        provider: "openrouter",
        apiKey: "sk-or-replacement-secret"
      })
    })
  );
  const payload = await response.json();

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.providerConfig.credentialConfigured, true);
  assert.deepEqual(calls, [{
    path: "env.vars.OPENROUTER_API_KEY",
    value: "sk-or-replacement-secret"
  }]);
  assert.doesNotMatch(JSON.stringify(payload), /sk-or-replacement-secret/);
});

test("credential disconnect removes only the Gateway credential path", async () => {
  const calls: string[] = [];
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      return path === "env.vars.OPENROUTER_API_KEY" ? "[redacted]" : null;
    },
    async unsetConfig(path: string) {
      calls.push(path);
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  const result = await removeOpenClawProviderCredential("openrouter");

  assert.deepEqual(calls, ["env.vars.OPENROUTER_API_KEY"]);
  assert.deepEqual(result, { removed: true, credentialCleanup: "removed" });
});

test("model removal rewrites Gateway config without config.unset fallbacks", async () => {
  const calls: string[] = [];
  const defaults: {
    model: { primary: string };
    models: Record<string, Record<string, unknown>>;
  } = {
    model: {
      primary: "openai/gpt-5.5"
    },
    models: {
      "openai/gpt-5.5": {},
      "anthropic/claude-sonnet-4-6": {
        alias: "sonnet"
      },
      "openai/o4-mini": {}
    }
  };

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "agents.defaults") {
        return structuredClone(defaults) as never;
      }

      if (path === "agents.defaults.models") {
        return structuredClone(defaults.models) as never;
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      if (path === "agents.defaults") {
        Object.assign(defaults, value);
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    async unsetConfig(path: string) {
      calls.push(`unset:${path}`);
      if (path === 'agents.defaults.models["anthropic/claude-sonnet-4-6"]') {
        delete defaults.models["anthropic/claude-sonnet-4-6"];
      }
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  await removeOpenClawConfiguredModelFromConfig("anthropic/claude-sonnet-4-6", {
    provider: "anthropic"
  });

  assert.deepEqual(calls, [
    "set:agents.defaults"
  ]);
  assert.equal("anthropic/claude-sonnet-4-6" in defaults.models, false);
  assert.equal("openai/o4-mini" in defaults.models, true);
});

test("Ollama model removal updates only the provider models array and defaults", async () => {
  const calls: Array<{ path: string; value?: unknown }> = [];
  const replacePaths: string[][] = [];
  const providerConfig = {
    apiKey: "ollama-local",
    baseUrl: "http://127.0.0.1:11434/v1",
    models: [
      { id: "jonathan-qwen38-q4:latest", name: "jonathan-qwen38-q4:latest" },
      { id: "llama3:8b", name: "llama3:8b" }
    ]
  };
  const defaults = {
    model: { primary: "ollama/jonathan-qwen38-q4:latest" },
    models: {
      "ollama/jonathan-qwen38-q4:latest": {},
      "ollama/llama3:8b": {}
    }
  };

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "models.providers.ollama") {
        return structuredClone(providerConfig) as never;
      }

      if (path === "agents.defaults") {
        return structuredClone(defaults) as never;
      }

      if (path === "agents.defaults.models") {
        return structuredClone(defaults.models) as never;
      }

      return null;
    },
    async setConfig(path: string, value: unknown, options?: { replacePaths?: string[] }) {
      calls.push({ path, value });
      if (options?.replacePaths) {
        replacePaths.push(options.replacePaths);
      }

      if (path === "models.providers.ollama.models") {
        providerConfig.models = value as typeof providerConfig.models;
      }

      if (path === "agents.defaults") {
        Object.assign(defaults, value);
      }

      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawAdapter);

  await removeOpenClawConfiguredModelFromConfig("ollama/jonathan-qwen38-q4:latest", {
    provider: "ollama"
  });

  assert.deepEqual(calls, [
    {
      path: "models.providers.ollama.models",
      value: [{ id: "llama3:8b", name: "llama3:8b" }]
    },
    {
      path: "agents.defaults",
      value: {
        model: { primary: "ollama/llama3:8b" },
        models: {
          "ollama/llama3:8b": {}
        }
      }
    }
  ]);
  assert.deepEqual(replacePaths, [["models.providers.ollama.models"]]);
  assert.deepEqual(providerConfig.models, [{ id: "llama3:8b", name: "llama3:8b" }]);
  assert.equal("ollama/jonathan-qwen38-q4:latest" in defaults.models, false);
});

test("custom provider connect writes an explicit OpenClaw provider and namespaces discovered models", async () => {
  const calls: Array<{ path: string; value: unknown }> = [];
  const configs = new Map<string, unknown>([
    [
      "agents.defaults.models",
      {
        "openai/gpt-5.4": {}
      }
    ]
  ]);
  let fetchUrl = "";
  let authHeader = "";

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      return configs.has(path) ? configs.get(path) as never : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      configs.set(path, value);
      return { stdout: "", stderr: "", code: 0 };
    },
    async getModelStatus() {
      return {
        allowed: [],
        auth: {
          providers: [],
          oauth: {
            providers: []
          }
        }
      };
    }
  } as unknown as OpenClawAdapter);

  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const requestUrl = String(input);

    if (requestUrl === "http://127.0.0.1:18789/readyz") {
      return new Response("ok", { status: 200 });
    }

    fetchUrl = requestUrl;
    authHeader = String(init?.headers instanceof Headers
      ? init.headers.get("Authorization")
      : (init?.headers as Record<string, string> | undefined)?.Authorization ?? "");

    return new Response(
      JSON.stringify({
        data: [
          { id: "gpt-oss-120b" },
          { id: "gpt-5.4" }
        ]
      }),
      {
        status: 200,
        headers: {
          "content-type": "application/json"
        }
      }
    );
  }) as typeof fetch;

  const response = await modelsProviderPost(
    new Request("http://agentos.test/api/models/providers", {
      method: "POST",
      body: JSON.stringify({
        action: "connect",
        provider: "entrim",
        providerName: "Entrim",
        endpoint: "https://api.entrim.ai/v1",
        apiKey: "sk-entrim-test"
      })
    })
  );
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.provider, "entrim");
  assert.equal(payload.connection.connected, true);
  assert.match(payload.connection.detail, /Endpoint: https:\/\/api\.entrim\.ai\/v1/);
  assert.equal(fetchUrl, "https://api.entrim.ai/v1/models");
  assert.equal(authHeader, "Bearer sk-entrim-test");
  assert.doesNotMatch(serialized, /sk-entrim-test/);
  assert.deepEqual(
    payload.models.map((model: { id: string; alreadyAdded?: boolean }) => ({
      id: model.id,
      alreadyAdded: model.alreadyAdded
    })),
    [
      {
        id: "entrim/gpt-oss-120b",
        alreadyAdded: false
      },
      {
        id: "entrim/gpt-5.4",
        alreadyAdded: false
      }
    ]
  );
  assert.deepEqual(calls, [
    {
      path: "models.providers.entrim",
      value: {
        baseUrl: "https://api.entrim.ai/v1",
        apiKey: "sk-entrim-test",
        api: "openai-completions",
        models: [
          {
            id: "gpt-oss-120b",
            name: "gpt-oss-120b"
          },
          {
            id: "gpt-5.4",
            name: "gpt-5.4"
          }
        ]
      }
    }
  ]);
});

test("adding custom provider models writes explicit provider metadata without an AgentOS allowlist", async () => {
  const calls: string[] = [];
  const configs = new Map<string, unknown>([
    [
      "models.providers.entrim",
      {
        name: "Legacy Entrim",
        label: "Legacy Entrim",
        models: [
          {
            id: "gpt-oss-120b",
            name: "GPT OSS 120B"
          }
        ],
        apiKey: "[redacted]",
        baseUrl: "https://api.entrim.ai/v1"
      }
    ],
    [
      "agents.defaults",
      {}
    ]
  ]);

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return configs.has(path) ? configs.get(path) as never : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      configs.set(path, value);
      return { stdout: "", stderr: "", code: 0 };
    },
  } as unknown as OpenClawAdapter);

  await addOpenClawExplicitProviderModelsToConfig(
    "entrim",
    ["entrim/gpt-oss-120b"],
    [
      {
        id: "gpt-oss-120b",
        name: "GPT OSS 120B",
        input: "text",
        contextWindow: null,
        maxTokens: null
      }
    ]
  );

  assert.deepEqual(calls, [
    "get:models.providers.entrim",
    "set:models.providers.entrim.models"
  ]);
  assert.deepEqual(configs.get("models.providers.entrim.models"), [
    {
      id: "gpt-oss-120b",
      name: "GPT OSS 120B",
      input: ["text"]
    }
  ]);
  assert.deepEqual(configs.get("models.providers.entrim"), {
    name: "Legacy Entrim",
    label: "Legacy Entrim",
    models: [
      {
        id: "gpt-oss-120b",
        name: "GPT OSS 120B"
      }
    ],
    apiKey: "[redacted]",
    baseUrl: "https://api.entrim.ai/v1"
  });
  assert.deepEqual(configs.get("agents.defaults"), {});
});

test("custom provider list returns explicit providers without exposing secrets", async () => {
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "models.providers") {
        return {
          openai: {
            apiKey: "[redacted]",
            models: [{ id: "gpt-5.4" }]
          },
          entrim: {
            apiKey: "[redacted]",
            baseUrl: "https://api.entrim.ai/v1",
            models: [
              {
                id: "gpt-oss-120b",
                name: "GPT OSS 120B"
              }
            ]
          }
        };
      }

      return null;
    }
  } as unknown as OpenClawAdapter);

  const response = await fetchRouteGet();
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.deepEqual(payload.providers, [
    {
      id: "entrim",
      baseUrl: "https://api.entrim.ai/v1",
      modelCount: 1
    }
  ]);
  assert.doesNotMatch(serialized, /apiKey|redacted/);
});

test("OpenRouter connect persists through Gateway and returns no terminal handoff", async () => {
  const calls: Array<{ path: string; value: unknown }> = [];
  let storedOpenRouterCredential: unknown = null;
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      return path === "env.vars.OPENROUTER_API_KEY" ? storedOpenRouterCredential : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      if (path === "env.vars.OPENROUTER_API_KEY") {
        storedOpenRouterCredential = "[redacted]";
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    async listModels() {
      return { models: [] };
    },
    async scanModels() {
      return [];
    },
    async getModelStatus() {
      return {
        allowed: [],
        auth: {
          providers: [],
          oauth: {
            providers: []
          }
        }
      };
    }
  } as unknown as OpenClawAdapter);

  const response = await modelsProviderPost(
    new Request("http://agentos.test/api/models/providers", {
      method: "POST",
      body: JSON.stringify({
        action: "connect",
        provider: "openrouter",
        apiKey: "sk-or-test-secret"
      })
    })
  );
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.manualCommand, null);
  assert.deepEqual(calls, [{
    path: "env.vars.OPENROUTER_API_KEY",
    value: "sk-or-test-secret"
  }]);
  assert.equal(payload.connection.verification, "verified");
  assert.doesNotMatch(serialized, /sk-or-test-secret/);
});

test("Gemini connect persists through its native provider config path", async () => {
  const calls: Array<{ path: string; value: unknown }> = [];
  let storedGeminiCredential: unknown = null;
  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      return path === "env.vars.GEMINI_API_KEY" ? storedGeminiCredential : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push({ path, value });
      if (path === "env.vars.GEMINI_API_KEY") {
        storedGeminiCredential = "[redacted]";
      }
      return { stdout: "", stderr: "", code: 0 };
    },
    async listModels() {
      return { models: [] };
    },
    async scanModels() {
      return [];
    },
    async getModelStatus() {
      return {
        allowed: [],
        auth: {
          providers: [],
          oauth: {
            providers: []
          }
        }
      };
    }
  } as unknown as OpenClawAdapter);

  const response = await modelsProviderPost(
    new Request("http://agentos.test/api/models/providers", {
      method: "POST",
      body: JSON.stringify({
        action: "connect",
        provider: "google",
        apiKey: "gemini-test-secret"
      })
    })
  );
  const payload = await response.json();
  const serialized = JSON.stringify(payload);

  assert.equal(response.status, 200, JSON.stringify(payload));
  assert.equal(payload.ok, true);
  assert.equal(payload.manualCommand, null);
  assert.deepEqual(calls, [{
    path: "env.vars.GEMINI_API_KEY",
    value: "gemini-test-secret"
  }]);
  assert.doesNotMatch(serialized, /gemini-test-secret/);
});

test("Codex plugin readiness requires the plugin registry entry", async () => {
  setOpenClawAdapterForTesting({
    async listPlugins() {
      return {
        plugins: [
          {
            id: "codex",
            name: "@openclaw/codex",
            status: "enabled"
          }
        ]
      };
    }
  } as unknown as OpenClawAdapter);

  assert.equal(await readOpenClawCodexPluginReady(), true);
});

test("Codex plugin readiness rejects missing or failed registry entries", async () => {
  setOpenClawAdapterForTesting({
    async listPlugins() {
      return {
        plugins: [
          {
            id: "other",
            name: "Other"
          },
          {
            id: "@openclaw/codex",
            name: "@openclaw/codex",
            status: "error"
          }
        ]
      };
    }
  } as unknown as OpenClawAdapter);

  assert.equal(await readOpenClawCodexPluginReady(), false);
});

test("adding provider models does not silently fall back to OpenClaw file writes after Gateway failure", async () => {
  const calls: string[] = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return null;
    },
    async setConfig(path: string) {
      calls.push(`set:${path}`);
      throw new Error("Gateway config update failed");
    }
  } as unknown as OpenClawAdapter);

  await assert.rejects(
    () => addOpenClawModelsToConfig("openai", ["openai/gpt-4.1"]),
    /AgentOS did not edit OpenClaw state files/
  );
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
});

test("adding provider models retries transient Gateway restart during config update", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();
  let modelSetCalls = 0;

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "agents.defaults") {
        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      if (path === "agents.defaults") {
        modelSetCalls += 1;
      }

      if (path === "agents.defaults" && modelSetCalls === 1) {
        throw new Error("OpenClaw Gateway connection closed (1012: service restart).");
      }

      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await addOpenClawModelsToConfig("openai", ["openai/gpt-5.5"]);

  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "openai/gpt-5.5": {}
    },
    model: {
      primary: "openai/gpt-5.5"
    }
  });
});

test("adding an Ollama model preserves redacted provider credentials", async () => {
  const calls: Array<{ path: string; value: unknown; replacePaths?: string[] }> = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      if (path === "models.providers.ollama") {
        return {
          apiKey: "__OPENCLAW_REDACTED__",
          baseUrl: "http://127.0.0.1:11434",
          api: "ollama",
          models: [{ id: "llama3:8b", name: "llama3:8b" }]
        };
      }

      if (path === "agents.defaults") {
        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown, options?: { replacePaths?: string[] }) {
      calls.push({ path, value, replacePaths: options?.replacePaths });
      assert.doesNotMatch(JSON.stringify(value), /__OPENCLAW_REDACTED__/);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await addOpenClawModelsToConfig("ollama", ["ollama/qwen3.5:9b"]);

  assert.deepEqual(calls, [
    {
      path: "models.providers.ollama.models",
      value: [
        { id: "llama3:8b", name: "llama3:8b" },
        { id: "qwen3.5:9b", name: "qwen3.5:9b" }
      ],
      replacePaths: ["models.providers.ollama.models"]
    },
    {
      path: "agents.defaults",
      value: {
        models: {
          "ollama/qwen3.5:9b": {}
        },
        model: {
          primary: "ollama/qwen3.5:9b"
        }
      },
      replacePaths: undefined
    }
  ]);
});

test("setting the default model retries and starts Gateway after transient connect failures", async () => {
  const calls: string[] = [];
  let defaultsReads = 0;

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "agents.defaults") {
        defaultsReads += 1;

        if (defaultsReads === 1) {
          throw new Error("Failed to connect to OpenClaw Gateway.");
        }

        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    },
    async controlGateway(action: "start") {
      calls.push(`gateway:${action}`);
      return { ok: true, action };
    }
  } as unknown as OpenClawAdapter);
  setOpenClawLifecycleServiceForTesting(createTestLifecycleService());

  const result = await setOpenClawDefaultModel("openai/gpt-5.4-mini", {
    provider: "openai"
  });

  assert.equal(result.modelId, "openai/gpt-5.4-mini");
  assert.equal(result.via, "gateway");
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "gateway:start",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
});

test("setting the default model retries while Gateway is still starting", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();
  let defaultsWrites = 0;

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "agents.defaults") {
        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      if (path === "agents.defaults") {
        defaultsWrites += 1;
      }

      if (path === "agents.defaults" && defaultsWrites === 1) {
        throw new Error("UNAVAILABLE: gateway starting; retry shortly");
      }

      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    },
    async controlGateway(action: "start") {
      calls.push(`gateway:${action}`);
      return { ok: true, action };
    }
  } as unknown as OpenClawAdapter);
  setOpenClawLifecycleServiceForTesting(createTestLifecycleService());

  const result = await setOpenClawDefaultModel("openai/gpt-5.4-mini", {
    provider: "openai"
  });

  assert.equal(result.modelId, "openai/gpt-5.4-mini");
  assert.equal(result.via, "gateway");
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults",
    "gateway:start",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "openai/gpt-5.4-mini": {}
    },
    model: {
      primary: "openai/gpt-5.4-mini"
    }
  });
});

function createTestLifecycleService() {
  return new OpenClawLifecycleService({
    env: {
      OPENCLAW_GATEWAY_BINARY: "/tmp/agentos-openclaw",
      OPENCLAW_STATE_DIR: "/tmp/agentos-model-provider-state",
      OPENCLAW_CONFIG_PATH: "/tmp/agentos-model-provider-state/openclaw.json"
    },
    resolveBinary: async () => "/tmp/agentos-openclaw",
    readinessProbe: async () => ({
      ready: true,
      authenticated: true,
      health: "live",
      protocolVersion: 4,
      version: "2026.9.1",
      sourceCommit: null,
      checkedAt: new Date().toISOString(),
      reason: null
    })
  });
}

test("setting the default model writes OpenClaw Gateway config", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return path === "agents.defaults"
        ? { models: { "openrouter/old": {} } }
        : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await setOpenClawDefaultModel("openrouter/google/gemma-4-31b-it:free", {
    provider: "openrouter"
  });

  assert.deepEqual(result, {
    modelId: "openrouter/google/gemma-4-31b-it:free",
    provider: "openrouter",
    via: "gateway"
  });
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "openrouter/old": {},
      "openrouter/google/gemma-4-31b-it:free": {}
    },
    model: {
      primary: "openrouter/google/gemma-4-31b-it:free"
    }
  });
});

test("setting an Ollama default model registers the provider model before changing the default", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "models.providers.ollama") {
        return {
          models: [
            {
              id: "llama3:8b",
              name: "llama3:8b"
            }
          ]
        };
      }

      if (path === "agents.defaults") {
        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await setOpenClawDefaultModel("ollama/qwen3.5:9b", {
    provider: "ollama"
  });

  assert.deepEqual(result, {
    modelId: "ollama/qwen3.5:9b",
    provider: "ollama",
    via: "gateway"
  });
  assert.deepEqual(calls, [
    "get:models.providers.ollama",
    "set:models.providers.ollama",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("models.providers.ollama"), {
    apiKey: "ollama-local",
    models: [
      {
        id: "llama3:8b",
        name: "llama3:8b"
      },
      {
        id: "qwen3.5:9b",
        name: "qwen3.5:9b"
      }
    ]
  });
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "ollama/qwen3.5:9b": {}
    },
    model: {
      primary: "ollama/qwen3.5:9b"
    }
  });
});

test("setting an already registered Ollama default model avoids duplicate provider config writes", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      if (path === "models.providers.ollama") {
        return {
          models: [
            {
              id: "qwen3.5:9b",
              name: "qwen3.5:9b"
            }
          ]
        };
      }

      if (path === "agents.defaults") {
        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await setOpenClawDefaultModel("ollama/qwen3.5:9b", {
    provider: "ollama"
  });

  assert.deepEqual(calls, [
    "get:models.providers.ollama",
    "set:models.providers.ollama",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("models.providers.ollama"), {
    apiKey: "ollama-local",
    models: [
      {
        id: "qwen3.5:9b",
        name: "qwen3.5:9b"
      }
    ]
  });
});

test("adding a Gemini model registers the Google provider model before AgentOS defaults", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);

      if (path === "models.providers.google") {
        return null;
      }

      if (path === "agents.defaults") {
        return { models: {} };
      }

      return null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await addOpenClawModelsToConfig("google", ["google/gemini-3.5-flash"]);

  assert.deepEqual(calls, [
    "get:models.providers.google",
    "set:models.providers.google",
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("models.providers.google"), {
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    api: "google-generative-ai",
    models: [{
      id: "gemini-3.5-flash",
      name: "gemini-3.5-flash"
    }]
  });
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "google/gemini-3.5-flash": {}
    },
    model: {
      primary: "google/gemini-3.5-flash"
    }
  });
});

test("setting an OpenAI default model preserves OpenClaw runtime ownership", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return path === "agents.defaults" ? { models: {}, agentRuntime: { id: "pi" } } : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await setOpenClawDefaultModel("openai/gpt-5.5", {
    provider: "openai"
  });

  assert.deepEqual(result, {
    modelId: "openai/gpt-5.5",
    provider: "openai",
    via: "gateway"
  });
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
  assert.deepEqual(values.get("agents.defaults"), {
    models: {
      "openai/gpt-5.5": {}
    },
    agentRuntime: {
      id: "pi"
    },
    model: {
      primary: "openai/gpt-5.5"
    }
  });
});

test("preparing an OpenAI agent model leaves runtime config to OpenClaw", async () => {
  const calls: string[] = [];
  const values = new Map<string, unknown>();

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return path === "agents.defaults"
        ? {
            models: {
              "openrouter/old": {}
            },
            model: {
              primary: "openrouter/old"
            },
            agentRuntime: {
              id: "legacy"
            }
          }
        : null;
    },
    async setConfig(path: string, value: unknown) {
      calls.push(`set:${path}`);
      values.set(path, value);
      return { stdout: JSON.stringify({ ok: true, value }), stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  const result = await ensureOpenClawModelRuntimeConfig("openai/gpt-5.5", {
    provider: "openai"
  });

  assert.deepEqual(result, {
    modelId: "openai/gpt-5.5",
    provider: "openai",
    via: "gateway"
  });
  assert.deepEqual(calls, [
    "get:agents.defaults"
  ]);
  assert.equal(values.size, 0);
});

test("preparing an already configured Codex agent model does not write Gateway config", async () => {
  const calls: string[] = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return path === "agents.defaults"
        ? {
            models: {
              "openai/gpt-5.5": {
                agentRuntime: {
                  id: "codex"
                }
              }
            },
            model: {
              primary: "openai/gpt-5.4-mini"
            },
            maxConcurrent: 4
          }
        : null;
    },
    async setConfig(path: string) {
      calls.push(`set:${path}`);
      throw new Error("setConfig should not be called for an already prepared model runtime");
    }
  } as unknown as OpenClawAdapter);

  const result = await ensureOpenClawModelRuntimeConfig("openai/gpt-5.5", {
    provider: "openai"
  });

  assert.deepEqual(result, {
    modelId: "openai/gpt-5.5",
    provider: "openai",
    via: "gateway"
  });
  assert.deepEqual(calls, ["get:agents.defaults"]);
});

test("setting the default model does not silently fall back to OpenClaw file writes after Gateway failure", async () => {
  const calls: string[] = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return {};
    },
    async setConfig(path: string) {
      calls.push(`set:${path}`);
      throw new Error("Gateway config update failed");
    }
  } as unknown as OpenClawAdapter);

  await assert.rejects(
    () => setOpenClawDefaultModel("openrouter/test", { provider: "openrouter" }),
    /AgentOS did not edit OpenClaw state files/
  );
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
});

test("setting the default model surfaces Gateway config rate limits without fallback", async () => {
  const calls: string[] = [];

  setOpenClawAdapterForTesting({
    async getConfig(path: string) {
      calls.push(`get:${path}`);
      return { models: {} };
    },
    async setConfig(path: string) {
      calls.push(`set:${path}`);
      throw new Error("UNAVAILABLE: rate limit exceeded for config.patch; retry after 60s");
    }
  } as unknown as OpenClawAdapter);

  await assert.rejects(
    () => setOpenClawDefaultModel("openai/gpt-5.4-mini", { provider: "openai" }),
    /rate limiting config updates.*Wait about 1 minute.*did not use CLI or legacy file fallback/
  );
  assert.deepEqual(calls, [
    "get:agents.defaults",
    "set:agents.defaults"
  ]);
});
