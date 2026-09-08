import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import {
  buildModelSelectionProjection,
  isSelectableModel,
  MODEL_SELECTION_CATALOG_VIEW,
  modelManagementModelToCatalogModel,
  presentModelProviderSetupHint,
  resolveModelAvailability
} from "@/lib/openclaw/domains/model-management";
import { normalizeModelsPayload } from "@/lib/openclaw/client/native-ws-gateway-payloads";
import { formatModelProviderLabel, modelProviderPresentationRegistry } from "@/lib/openclaw/model-provider-registry";

const rootDir = process.cwd();

test("native model management preserves aliases, roles, and unavailable state without provider hardcoding", () => {
  assert.equal(modelProviderPresentationRegistry["new-provider"], undefined);
  assert.equal(formatModelProviderLabel("new-provider"), "New Provider");

  const model = modelManagementModelToCatalogModel({
    id: "new-provider/new-model",
    name: "New Model",
    provider: "new-provider",
    providerName: "New Provider",
    input: "text,image",
    contextWindow: 128000,
    available: false,
    availability: "needs-auth",
    unavailableReason: "missing-auth",
    reasoning: true,
    supportsTools: true,
    tags: ["configured", "recommended"],
    alias: "new",
    role: "fallback",
    fallbackPosition: 1,
    linkedAgents: 2,
    advanced: {
      rawId: "new-provider/new-model",
      providerId: "new-provider",
      deprecated: false,
      disabled: false
    }
  });

  assert.equal(model.provider, "new-provider");
  assert.equal(model.alreadyAdded, true);
  assert.equal(model.recommended, true);
  assert.equal(model.missing, true);
  assert.equal(model.available, false);
  assert.equal(model.supportsTools, true);
});

test("model projection preserves unknown native availability and capabilities", () => {
  const model = modelManagementModelToCatalogModel({
    id: "new-provider/opaque-model",
    name: "Opaque Model",
    provider: "new-provider",
    providerName: "New Provider",
    input: "text",
    contextWindow: null,
    available: null,
    availability: "unknown",
    reasoning: undefined,
    supportsTools: undefined,
    tags: ["catalog"],
    role: "available",
    linkedAgents: 0,
    advanced: {
      rawId: "new-provider/opaque-model",
      providerId: "new-provider",
      deprecated: false,
      disabled: false
    }
  });

  assert.equal(model.available, null);
  assert.equal(model.supportsTools, null);
  assert.equal(model.recommended, false);
});

test("provider setup hints do not expose terminal commands in normal connection UI", () => {
  assert.equal(
    presentModelProviderSetupHint("Token created by running 'claude setup-token' in your terminal"),
    "Requires a provider credential prepared outside AgentOS."
  );
  assert.equal(
    presentModelProviderSetupHint("Stored and validated by OpenClaw"),
    "Stored and validated by OpenClaw"
  );
});

test("model availability maps exact native evidence without treating catalog presence as readiness", () => {
  const cases = [
    [{ available: true }, "ready"],
    [{ available: false, unavailableReason: "missing-auth" }, "needs-auth"],
    [{ available: false, unavailableReason: "auth-failed" }, "auth-failed"],
    [{ available: false, unavailableReason: "cooldown" }, "cooldown"],
    [{ available: false }, "unavailable"],
    [{ available: null }, "unknown"],
    [{ available: null, missing: true }, "unavailable"],
    [{ available: null, disabled: true }, "unavailable"],
    [{ available: null, deprecated: true }, "unavailable"]
  ] as const;

  for (const [nativeModel, expected] of cases) {
    assert.equal(resolveModelAvailability(nativeModel), expected);
  }
});

test("models.list keeps the 9.1 provider and capability metadata", () => {
  const payload = normalizeModelsPayload({
    models: [{
      id: "reasoner",
      provider: "new-provider",
      name: "Reasoner",
      input: ["text", "image"],
      contextWindow: 200000,
      contextWindows: [{ id: "large", label: "Large", contextWindow: 200000 }],
      reasoning: true,
      supportsTools: true,
      unavailableReason: "cooldown",
      tags: ["featured"]
    }],
    providerOutcomes: [{ provider: "new-provider", status: "unavailable" }]
  });

  assert.deepEqual(payload.providerOutcomes, [{ provider: "new-provider", status: "unavailable" }]);
  assert.deepEqual(payload.models[0], {
    key: "new-provider/reasoner",
    name: "Reasoner",
    provider: "new-provider",
    input: "text,image",
    contextWindow: 200000,
    contextWindows: [{ id: "large", label: "Large", contextWindow: 200000 }],
    local: null,
    available: null,
    unavailableReason: "cooldown",
    reasoning: true,
    supportsTools: true,
    tags: ["featured"],
    missing: false
  });
});

test("models.list keeps CLI-agent runtime metadata distinct from provider readiness", () => {
  const payload = normalizeModelsPayload({
    models: [{
      id: "claude-sonnet",
      provider: "claude-cli",
      name: "Claude Sonnet CLI",
      input: ["text"],
      available: null,
      agentRuntime: { id: "claude-cli", source: "cli", fallback: "none" },
      tags: ["cli-agent"]
    }]
  });

  assert.equal(payload.models[0]?.provider, "claude-cli");
  assert.equal(payload.models[0]?.available, null);
  assert.deepEqual(payload.models[0]?.agentRuntime, { id: "claude-cli", source: "cli", fallback: "none" });
  assert.deepEqual(payload.models[0]?.tags, ["cli-agent"]);
});

test("post-onboarding management reads OpenClaw provider and auth metadata", () => {
  const serviceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-management-service.ts"),
    "utf8"
  );
  const projectionSource = readFileSync(
    path.join(rootDir, "lib/openclaw/domains/model-management.ts"),
    "utf8"
  );
  const routeSource = readFileSync(
    path.join(rootDir, "app/api/models/management/route.ts"),
    "utf8"
  );
  const wizardServiceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-setup-wizard-service.ts"),
    "utf8"
  );

  assert.match(serviceSource, /listOpenClawModels\(/);
  assert.match(serviceSource, /models\.authStatus/);
  assert.match(serviceSource, /openclaw\.setup\.detect/);
  assert.match(serviceSource, /providerOutcomes/);
  assert.doesNotMatch(serviceSource, /modelProviderRegistry/);
  assert.match(wizardServiceSource, /wizard\.next/);
  assert.match(routeSource, /openclaw\.setup\.activate\.start/);
  assert.match(routeSource, /openclaw\.setup\.prepare\.start/);
  assert.match(serviceSource, /models\.authLogout/);
  assert.match(serviceSource, /agentId/);
  assert.match(serviceSource, /adapter\.listSessions/);
  assert.match(projectionSource, /native-session/);
  assert.match(routeSource, /models\.manage/);
  assert.match(routeSource, /secrets\.manage/);
  assert.match(routeSource, /wizard-status[\s\S]*runtime\.use/);
  assert.match(routeSource, /sessionKey/);
});

function projectionModels() {
  return [
    { id: "openai/model-a", provider: "openai", availability: "ready" as const },
    { id: "openai/model-b", provider: "openai", availability: "unavailable" as const }
  ];
}

test("configured and ready worker/default models are not projected as effective runtime models", () => {
  const models = projectionModels();
  const defaults = { model: { primary: "openai/model-a", fallbacks: ["openai/model-b"] } };

  const worker = buildModelSelectionProjection({
    agentId: "worker-1",
    defaults,
    agents: [{ id: "worker-1", model: { primary: "openai/model-a", fallbacks: ["openai/model-b"] } }],
    sessions: [],
    sessionReadOk: true,
    models
  });
  const globalDefault = buildModelSelectionProjection({
    defaults,
    agents: [],
    sessions: [],
    sessionReadOk: true,
    models
  });

  assert.equal(worker.configuredModelId, "openai/model-a");
  assert.equal(worker.configuredStatus, "ready");
  assert.equal(worker.effectiveModelId, null);
  assert.equal(worker.effectiveStatus, "unknown");
  assert.equal(worker.source, "unknown");
  assert.equal(globalDefault.configuredStatus, "ready");
  assert.equal(globalDefault.effectiveModelId, null);
  assert.equal(globalDefault.effectiveStatus, "unknown");
});

test("native session model evidence is the only scoped effective runtime model", () => {
  const selection = buildModelSelectionProjection({
    agentId: "worker-1",
    sessionKey: "session-1",
    defaults: { model: { primary: "openai/model-a", fallbacks: [] } },
    agents: [{ id: "worker-1", model: { primary: "openai/model-a" } }],
    sessions: [{
      key: "session-1",
      model: "model-a",
      modelProvider: "openai",
      modelOverrideSource: "user"
    }],
    sessionReadOk: true,
    models: projectionModels()
  });

  assert.equal(selection.configuredModelId, "openai/model-a");
  assert.equal(selection.effectiveModelId, "openai/model-a");
  assert.equal(selection.effectiveProvider, "openai");
  assert.equal(selection.effectiveStatus, "known");
  assert.equal(selection.source, "native-session");
  assert.equal(selection.inherited, false);
});

test("session selection read failure is unknown rather than known inheritance", () => {
  const selection = buildModelSelectionProjection({
    agentId: "worker-1",
    sessionKey: "session-1",
    defaults: { model: { primary: "openai/model-a", fallbacks: [] } },
    agents: [{ id: "worker-1", model: { primary: "openai/model-a" } }],
    sessions: [],
    sessionReadOk: false,
    models: projectionModels()
  });

  assert.equal(selection.effectiveModelId, null);
  assert.equal(selection.effectiveStatus, "unknown");
  assert.equal(selection.inherited, null);
});

test("model picker and session mutation share the native default catalog view and readiness rule", () => {
  assert.equal(MODEL_SELECTION_CATALOG_VIEW, "default");
  assert.equal(isSelectableModel({ available: true, missing: false }), true);
  assert.equal(isSelectableModel({ available: null, missing: false }), false);
  assert.equal(isSelectableModel({ available: false, unavailableReason: "missing-auth" }), false);
  assert.equal(isSelectableModel({ available: true, disabled: true }), true);
  assert.equal(isSelectableModel({ available: false, disabled: true }), false);
  assert.equal(isSelectableModel({ available: false, deprecated: true }), false);

  const sessionServiceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/session-model-service.ts"),
    "utf8"
  );
  const pickerHookSource = readFileSync(path.join(rootDir, "hooks/use-model-catalog.ts"), "utf8");
  assert.match(sessionServiceSource, /MODEL_SELECTION_CATALOG_VIEW/);
  assert.match(pickerHookSource, /MODEL_SELECTION_CATALOG_VIEW/);
  assert.doesNotMatch(sessionServiceSource, /view: "configured"/);
});

test("scoped model surfaces preserve native identity and keep unsupported scopes out of the product", () => {
  const agentRouteSource = readFileSync(path.join(rootDir, "app/api/agents/route.ts"), "utf8");
  const sessionRouteSource = readFileSync(path.join(rootDir, "app/api/sessions/model/route.ts"), "utf8");
  const sessionServiceSource = readFileSync(path.join(rootDir, "lib/openclaw/application/session-model-service.ts"), "utf8");
  const clientSource = readFileSync(path.join(rootDir, "lib/openclaw/client/native-ws-gateway-client.ts"), "utf8");

  assert.match(agentRouteSource, /modelId: z\.string\(\)\.nullable\(\)\.optional\(\)/);
  assert.match(sessionRouteSource, /action: z\.literal\("set"\)/);
  assert.match(sessionRouteSource, /action: z\.literal\("inherit"\)/);
  assert.match(sessionServiceSource, /patchSessionModel/);
  assert.match(sessionServiceSource, /listSessions/);
  assert.match(sessionServiceSource, /buildSessionModelOverrides/);
  assert.match(sessionServiceSource, /model: null/);
  assert.match(sessionServiceSource, /remainingOverrides/);
  assert.doesNotMatch(sessionServiceSource, /view: "configured"/);
  assert.doesNotMatch(sessionServiceSource, /setModelAuthOrder/);
  assert.match(clientSource, /models\.list[\s\S]*agentId/);
});

test("model compatibility keeps discovery-only auth-order and scan methods out of product integration", () => {
  const compatibilitySource = readFileSync(
    path.join(rootDir, "lib/openclaw/client/gateway-compatibility.ts"),
    "utf8"
  );

  const authOrder = compatibilitySource.match(/id: "modelAuthOrder"[\s\S]*?productIntegratedMethods: \[\]/);
  const scan = compatibilitySource.match(/id: "modelScan"[\s\S]*?productIntegratedMethods: \[\]/);
  assert.ok(authOrder);
  assert.ok(scan);
  assert.match(authOrder[0], /productIntegration: "discovery-only"/);
  assert.match(scan[0], /productIntegration: "discovery-only"/);
});

test("the global Models UX does not use agents.defaults.models as an allowlist", () => {
  const serviceSource = readFileSync(
    path.join(rootDir, "lib/openclaw/application/model-provider-state-service.ts"),
    "utf8"
  );
  const pageSource = readFileSync(
    path.join(rootDir, "components/operations/models/models-page-content.tsx"),
    "utf8"
  );

  assert.match(serviceSource, /reserved for the native[\s\S]*OpenClaw alias\/settings surface/);
  assert.match(pageSource, /Connect Provider/);
  assert.match(pageSource, /Fallbacks/);
  assert.match(pageSource, /Model access policy/);
  assert.doesNotMatch(pageSource, /Session Model Overrides/);
  assert.doesNotMatch(pageSource, /Add Model/);
});
