import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { join } from "node:path";
import { test } from "node:test";

import { OPENCLAW_GATEWAY_PROTOCOL_RANGE } from "@/lib/openclaw/client/openclaw-protocol";

const root = process.cwd();

async function source(relativePath: string) {
  return readFile(join(root, relativePath), "utf8");
}

async function exists(relativePath: string) {
  try {
    await access(join(root, relativePath));
    return true;
  } catch {
    return false;
  }
}

test("final architecture locks the official native dependency boundary", async () => {
  const factory = await source("lib/openclaw/client/gateway-client-factory.ts");
  const domainClient = await source("lib/openclaw/client/native-ws-gateway-client.ts");
  const officialFiles = await Promise.all([
    source("lib/openclaw/client/official-gateway-transport.ts"),
    source("lib/openclaw/client/official-gateway-host.ts"),
    source("lib/openclaw/client/official-gateway-coordinator.ts"),
    source("lib/openclaw/client/official-gateway-factory.ts")
  ]);

  assert.match(factory, /createOfficialBackedOpenClawGatewayClient/);
  assert.match(factory, /isCliGatewayClientForcedByEnv/);
  assert.doesNotMatch(factory, /AGENTOS_OPENCLAW_TRANSPORT|resolveOpenClawTransportSelection/);
  assert.doesNotMatch(factory, /PersistentOpenClawGatewayConnection|WebSocketFactory|webSocketFactory/);
  assert.match(domainClient, /AgentOS domain\/policy client/);
  assert.match(domainClient, /this\.connection = options\.transport/);
  assert.doesNotMatch(domainClient, /PersistentOpenClawGatewayConnection|WebSocketFactory|webSocketFactory/);

  for (const officialSource of officialFiles) {
    assert.doesNotMatch(
      officialSource,
      /native-ws-gateway-(wire|connection|auth)|PersistentOpenClawGatewayConnection|WebSocketFactory/,
      "official production files must not depend on deleted custom transport modules"
    );
  }

  assert.match(officialFiles[0], /from "@openclaw\/gateway-client"/);
  assert.match(officialFiles[0], /onReconnectPaused/);
  assert.match(officialFiles[3], /AgentOsGatewayRequestPolicy/);
  assert.match(officialFiles[3], /transport: coordinator/);
});

test("final architecture deletes the legacy transport modules and selector", async () => {
  for (const relativePath of [
    "lib/openclaw/client/native-ws-gateway-connection.ts",
    "lib/openclaw/client/native-ws-gateway-wire.ts",
    "lib/openclaw/client/native-ws-gateway-auth.ts"
  ]) {
    assert.equal(await exists(relativePath), false, `${relativePath} must be deleted`);
  }

  const policy = await source("lib/openclaw/client/native-ws-gateway-policy.ts");
  const types = await source("lib/openclaw/client/native-ws-gateway-types.ts");
  const diagnostics = await source("lib/openclaw/client/types.ts");
  assert.doesNotMatch(policy, /AGENTOS_OPENCLAW_TRANSPORT|resolveOpenClawTransportSelection|custom/);
  assert.doesNotMatch(types, /WebSocketFactory|WebSocketLike/);
  assert.doesNotMatch(diagnostics, /transportSelectionWarning|"custom"/);
});

test("AgentOS policy and event layers remain above the official transport", async () => {
  const [domainClient, policy, coordinator, bridge, runtime] = await Promise.all([
    source("lib/openclaw/client/native-ws-gateway-client.ts"),
    source("lib/openclaw/client/gateway-request-policy.ts"),
    source("lib/openclaw/client/official-gateway-coordinator.ts"),
    source("lib/openclaw/application/event-bridge-service.ts"),
    source("lib/openclaw/application/runtime-state-service.ts")
  ]);

  assert.match(domainClient, /this\.requestPolicy\.request/);
  assert.match(policy, /invalidateReadCache/);
  assert.doesNotMatch([policy, coordinator, bridge].join("\n"), /tasks\.subscribe/);
  assert.match(coordinator, /replayForGeneration/);
  assert.match(bridge, /notifyBridgeEventSubscribers\(frame\)/);
  assert.match(bridge, /persistGatewayEvent\(frame\)/);
  assert.match(runtime, /eventName === "task"/);
  assert.match(runtime, /taskId/);
  assert.doesNotMatch(bridge, /scheduleEventBridgeReconnect|reconnectBase|reconnectMax/);
  assert.match(bridge, /onConnectionStateChange/);
});

test("the exact OpenClaw 2026.9.3 package and protocol remain authoritative", async () => {
  const packageJson = JSON.parse(await source("package.json")) as { dependencies?: Record<string, string> };
  const lockfile = await source("pnpm-lock.yaml");

  assert.equal(packageJson.dependencies?.["@openclaw/gateway-client"], "2026.9.3");
  assert.equal(packageJson.dependencies?.["@openclaw/gateway-protocol"], "2026.9.3");
  assert.match(lockfile, /'@openclaw\/gateway-client':\n\s+specifier: 2026\.9\.3\n\s+version: 2026\.9\.3/);
  assert.match(lockfile, /'@openclaw\/gateway-protocol':\n\s+specifier: 2026\.9\.3\n\s+version: 2026\.9\.3/);
  assert.deepEqual(OPENCLAW_GATEWAY_PROTOCOL_RANGE, { min: 4, max: 4 });
});

test("current entrypoints use the factory and keep CLI fallback separate", async () => {
  const currentEntryPoints = await Promise.all([
    "scripts/openclaw-runtime-certification.ts",
    "scripts/openclaw-automation-e2e.ts",
    "scripts/openclaw-lifecycle-e2e.ts",
    "scripts/openclaw-identity-e2e.ts",
    "scripts/openclaw-multi-user-e2e.ts",
    "scripts/openclaw-multi-user-collaboration-certification.ts",
    "scripts/openclaw-session-task-e2e.ts",
    "scripts/openclaw-compat.ts",
    "scripts/openclaw-migration-e2e.ts",
    "lib/openclaw/lifecycle/service.ts",
    "lib/openclaw/application/compatibility-smoke-service.ts",
    "lib/openclaw/application/capability-matrix-service.ts",
    "lib/openclaw/application/settings-service.ts"
  ].map((relativePath) => source(relativePath)));

  for (const entryPoint of currentEntryPoints) {
    assert.doesNotMatch(entryPoint, /new NativeWsOpenClawGatewayClient/);
    assert.doesNotMatch(entryPoint, /WebSocketFactory|webSocketFactory/);
  }
});
