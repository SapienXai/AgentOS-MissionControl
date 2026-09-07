import assert from "node:assert/strict";
import { generateKeyPairSync, verify } from "node:crypto";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { test } from "node:test";

import { GATEWAY_CLIENT_MODES, GATEWAY_CLIENT_NAMES } from "@openclaw/gateway-protocol/client-info";
import type { EventFrame } from "@openclaw/gateway-protocol/frame-guards";

import { normalizeOpenClawGatewayEventFrame } from "@/lib/agentos/acl/openclaw";
import {
  normalizeOpenClawGatewayEventToRuntime
} from "@/lib/openclaw/application/runtime-state-service";
import {
  DEFAULT_OPERATOR_SCOPES,
  OfficialOpenClawGatewayTransport,
  createAgentOsGatewayClientHostDeps,
  NativeGatewayError,
  NativeGatewayRequestError
} from "@/lib/openclaw/client/gateway-client";
import { buildDeviceAuthPayloadV3 } from "@/lib/openclaw/client/gateway-device-auth";
import { OfficialGatewayHarness } from "@/tests/helpers/official-gateway-harness";

test("official transport sends the canonical AgentOS handshake and correlates requests", async () => {
  const harness = await OfficialGatewayHarness.create({ methods: ["health"] });
  const hellos: unknown[] = [];
  const transport = new OfficialOpenClawGatewayTransport({
    url: harness.url,
    token: "phase2-explicit-token",
    hostDeps: createAgentOsGatewayClientHostDeps({ sharedStateMode: "read-only" }),
    callbacks: { onHello: (hello) => hellos.push(hello) }
  });

  try {
    transport.start();
    const connect = await harness.waitForRequest("connect");
    await waitFor(() => hellos.length === 1);
    const params = connect.params as Record<string, unknown>;
    assert.equal(params.minProtocol, 4);
    assert.equal(params.maxProtocol, 4);
    assert.deepEqual(params.client, {
      id: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      version: "agentos",
      platform: process.platform,
      mode: GATEWAY_CLIENT_MODES.BACKEND
    });
    assert.equal(params.role, "operator");
    assert.deepEqual(params.scopes, DEFAULT_OPERATOR_SCOPES);
    assert.deepEqual(params.caps, ["agent-kind", "tool-events"]);
    assert.deepEqual(params.auth, { token: "phase2-explicit-token" });
    assert.equal(params.device, undefined);

    const hello = transport.getHandshake();
    assert.equal(hellos.length, 1);
    assert.equal(hello?.protocol, 4);
    assert.equal(hello?.server.version, "2026.9.1");
    assert.equal(transport.getConnectionMetadata().clientName, GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT);
    assert.equal(transport.getConnectionMetadata().mode, GATEWAY_CLIENT_MODES.BACKEND);
    assert.equal(transport.getConnectionMetadata().hasDeviceIdentity, false);
    assert.deepEqual(await transport.request("health"), { method: "health" });
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
  }
});

test("official transport is the sole native transport boundary", async () => {
  const factorySource = await readFile(
    join(process.cwd(), "lib/openclaw/client/gateway-client-factory.ts"),
    "utf8"
  );
  assert.match(factorySource, /createOfficialBackedOpenClawGatewayClient/);
  assert.doesNotMatch(factorySource, /custom transport|PersistentOpenClawGatewayConnection|WebSocketFactory/);
});

test("official transport preserves concurrent out-of-order responses", async () => {
  const harness = await OfficialGatewayHarness.create({
    routes: {
      first: async ({ respond }) => {
        await delay(30);
        respond({ result: "first" });
      },
      second: async ({ respond }) => {
        await delay(5);
        respond({ result: "second" });
      }
    }
  });
  const transport = new OfficialOpenClawGatewayTransport({ url: harness.url, token: "token" });

  try {
    transport.start();
    await harness.waitForRequest("connect");
    const [first, second] = await Promise.all([
      transport.request<{ result: string }>("first"),
      transport.request<{ result: string }>("second")
    ]);
    assert.deepEqual(first, { result: "first" });
    assert.deepEqual(second, { result: "second" });
    assert.deepEqual(harness.requests.filter(({ method }) => method !== "connect").map(({ method }) => method), ["first", "second"]);
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
  }
});

test("official transport maps post-send timeouts with requestSent ambiguity", async () => {
  const harness = await OfficialGatewayHarness.create({
    routes: { slow: ({ leaveOpen }) => leaveOpen() }
  });
  const transport = new OfficialOpenClawGatewayTransport({ url: harness.url, token: "token" });

  try {
    transport.start();
    await harness.waitForRequest("connect");
    await assert.rejects(
      transport.request("slow", undefined, { timeoutMs: 20 }),
      (error: unknown) => {
        assert.ok(error instanceof NativeGatewayRequestError);
        assert.equal(error.method, "slow");
        assert.equal(error.sent, true);
        assert.equal(error.kind, "timeout");
        assert.equal((error.cause as { requestSent?: boolean }).requestSent, true);
        return true;
      }
    );
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
  }
});

test("official transport maps abort-before-send without claiming the request was sent", async () => {
  const harness = await OfficialGatewayHarness.create();
  const transport = new OfficialOpenClawGatewayTransport({ url: harness.url, token: "token" });
  const controller = new AbortController();
  controller.abort();

  try {
    transport.start();
    await harness.waitForRequest("connect");
    await assert.rejects(
      transport.request("never", undefined, { signal: controller.signal }),
      (error: unknown) => {
        assert.ok(error instanceof NativeGatewayRequestError);
        assert.equal(error.method, "never");
        assert.equal(error.sent, false);
        assert.equal(harness.requests.some((request) => request.method === "never"), false);
        return true;
      }
    );
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
  }
});

test("official transport preserves structured Gateway errors and AgentOS classification", async () => {
  const harness = await OfficialGatewayHarness.create({
    routes: {
      deny: ({ fail }) => fail({
        code: "FORBIDDEN",
        message: "missing scope: operator.admin",
        details: { missingScope: "operator.admin" }
      }),
      unknown: ({ fail }) => fail({ code: "INVALID_REQUEST", message: "unknown method unknown" })
    }
  });
  const transport = new OfficialOpenClawGatewayTransport({ url: harness.url, token: "token" });

  try {
    transport.start();
    await harness.waitForRequest("connect");
    await assert.rejects(transport.request("deny"), (error: unknown) => {
      assert.ok(error instanceof NativeGatewayRequestError);
      assert.equal(error.kind, "scope-limited");
      assert.equal(error.sent, true);
      return true;
    });
    await assert.rejects(transport.request("unknown"), (error: unknown) => {
      assert.ok(error instanceof NativeGatewayRequestError);
      assert.equal(error.kind, "unsupported");
      assert.equal(error.sent, true);
      return true;
    });
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
  }
});

test("official transport forwards raw task/session events and reports sequence gaps", async () => {
  const harness = await OfficialGatewayHarness.create();
  const events: Array<{ event: string; seq?: number }> = [];
  const gaps: Array<{ expected: number; received: number }> = [];
  const transport = new OfficialOpenClawGatewayTransport({
    url: harness.url,
    token: "token",
    callbacks: {
      onEvent: (event) => events.push({ event: event.event, seq: event.seq }),
      onGap: (gap) => gaps.push(gap)
    }
  });

  try {
    transport.start();
    await harness.waitForRequest("connect");
    harness.emitEvent("task", {
      task: { id: "task-1", agentId: "agent-1", status: "running" }
    }, 1);
    harness.emitEvent("sessions.changed", { sessionId: "session-1" }, 2);
    harness.emitEvent("session.message", { sessionId: "session-1", text: "hello" }, 4);
    await waitFor(() => events.length === 3);
    await waitFor(() => gaps.length === 1);
    assert.deepEqual(events, [
      { event: "task", seq: 1 },
      { event: "sessions.changed", seq: 2 },
      { event: "session.message", seq: 4 }
    ]);
    assert.deepEqual(gaps, [{ expected: 3, received: 4 }]);
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
  }
});

test("official transport reconnects after a socket close and can be explicitly stopped", async () => {
  const harness = await OfficialGatewayHarness.create();
  let helloCount = 0;
  const closes: number[] = [];
  const transport = new OfficialOpenClawGatewayTransport({
    url: harness.url,
    token: "token",
    callbacks: {
      onHello: () => { helloCount += 1; },
      onClose: (code) => closes.push(code)
    }
  });

  try {
    transport.start();
    await harness.waitForRequest("connect");
    await waitFor(() => helloCount === 1);
    harness.closeSockets(1012, "restart");
    await waitFor(() => helloCount >= 2, 5_000);
    assert.ok(closes.includes(1012));
    assert.deepEqual(await transport.request("health"), { method: "health" });

    const connectionsBeforeStop = harness.connectionCount;
    await transport.stopAndWait({ timeoutMs: 1_000 });
    await delay(1_200);
    assert.equal(harness.connectionCount, connectionsBeforeStop);
  } finally {
    transport.stop();
    await harness.close();
  }
});

test("official transport honors a terminal reconnect pause", async () => {
  const harness = await OfficialGatewayHarness.create({
    connectFailure: {
      code: "FORBIDDEN",
      message: "gateway token rejected",
      details: { code: "AUTH_TOKEN_MISMATCH" }
    }
  });
  let pausedInfo: { reason: string; detailCode: string | null } | null = null;
  const states: string[] = [];
  const transport = new OfficialOpenClawGatewayTransport({
    url: harness.url,
    token: "rejected-token",
    callbacks: {
      onReconnectPaused: (info) => { pausedInfo = { reason: info.reason, detailCode: info.detailCode }; },
      onConnectionStateChange: (state) => { states.push(state); }
    }
  });

  try {
    transport.start();
    await delay(300);
    assert.equal(transport.getLifecycleState(), "reconnect-paused", JSON.stringify({ pausedInfo, states, connections: harness.connectionCount }));
    assert.deepEqual(pausedInfo, { reason: "connect failed", detailCode: "AUTH_TOKEN_MISMATCH" });
    const connectionsAtPause = harness.connectionCount;
    await delay(1_200);
    assert.equal(harness.connectionCount, connectionsAtPause);
    assert.equal(transport.getLifecycleState(), "reconnect-paused");
    await assert.rejects(
      transport.request("health", undefined, { timeoutMs: 5_000 }),
      (error: unknown) => {
        assert.ok(error instanceof NativeGatewayRequestError || error instanceof NativeGatewayError);
        assert.equal((error as { kind?: string }).kind, "auth");
        return true;
      }
    );
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
  }
});

test("official events remain consumable by the existing AgentOS runtime normalizers", async () => {
  const harness = await OfficialGatewayHarness.create();
  let received: EventFrame | null = null;
  const transport = new OfficialOpenClawGatewayTransport({
    url: harness.url,
    token: "token",
    callbacks: { onEvent: (event) => { if (event.event === "task") received = event; } }
  });

  try {
    transport.start();
    await harness.waitForRequest("connect");
    harness.emitEvent("task", {
      action: "upserted",
      task: {
        id: "task-1",
        agentId: "agent-1",
        sessionKey: "agent:agent-1:main",
        status: "running",
        summary: "Task is running"
      }
    });
    await waitFor(() => received !== null);
    const eventFrame = received as unknown as EventFrame;
    const runtime = normalizeOpenClawGatewayEventToRuntime(eventFrame);
    const event = normalizeOpenClawGatewayEventFrame(eventFrame);
    assert.equal(runtime?.taskId, "task-1");
    assert.equal(runtime?.status, "running");
    assert.equal(event.taskId, "task-1");
    assert.equal(event.kind, "task");
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
  }
});

test("read-only official host dependencies read shared identity/auth without mutating them", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-official-host-"));
  const identityPath = join(stateDir, "identity");
  const identityFile = join(identityPath, "device.json");
  const authFile = join(identityPath, "device-auth.json");
  const { mkdir } = await import("node:fs/promises");
  await mkdir(identityPath, { recursive: true });
  await writeFile(identityFile, JSON.stringify({
    deviceId: "device-1",
    privateKeyPem: "private-key",
    publicKeyPem: "public-key"
  }));
  await writeFile(authFile, JSON.stringify({
    deviceId: "device-1",
    tokens: { operator: { token: "stored-token", scopes: ["operator.read"] } }
  }));
  const beforeIdentity = await readFile(identityFile, "utf8");
  const beforeAuth = await readFile(authFile, "utf8");
  const deps = createAgentOsGatewayClientHostDeps({ stateDir, sharedStateMode: "read-only" });

  assert.deepEqual(deps.loadOrCreateDeviceIdentity?.(), {
    deviceId: "device-1",
    privateKeyPem: "private-key",
    publicKeyPem: "public-key"
  });
  assert.deepEqual(deps.loadDeviceAuthToken?.({ deviceId: "device-1", role: "operator" }), {
    token: "stored-token",
    scopes: ["operator.read"]
  });
  deps.storeDeviceAuthToken?.({
    deviceId: "device-1",
    role: "operator",
    token: "replacement-token",
    scopes: ["operator.write"]
  });
  deps.clearDeviceAuthToken?.({ deviceId: "device-1", role: "operator" });
  assert.equal(await readFile(identityFile, "utf8"), beforeIdentity);
  assert.equal(await readFile(authFile, "utf8"), beforeAuth);
});

test("repair host dependencies create and reuse OpenClaw device identity state", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-official-host-create-"));

  try {
    const deps = createAgentOsGatewayClientHostDeps({
      stateDir,
      sharedStateMode: "read-only",
      ensureDeviceIdentity: true
    });
    const first = deps.loadOrCreateDeviceIdentity?.();
    assert.ok(first);
    assert.match(first.deviceId, /^[a-f0-9]{64}$/);
    assert.match(first.publicKeyPem, /BEGIN PUBLIC KEY/);
    assert.match(first.privateKeyPem, /BEGIN PRIVATE KEY/);

    const persisted = JSON.parse(await readFile(join(stateDir, "identity", "device.json"), "utf8")) as {
      deviceId?: string;
      createdAtMs?: number;
    };
    assert.equal(persisted.deviceId, first.deviceId);
    assert.equal(typeof persisted.createdAtMs, "number");
    assert.deepEqual(deps.loadOrCreateDeviceIdentity?.(), first);
  } finally {
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("official device auth verifies the v3 challenge signature and persists rotated tokens only in managed-write mode", async () => {
  const stateDir = await mkdtemp(join(tmpdir(), "agentos-official-device-auth-"));
  const identityDir = join(stateDir, "identity");
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const publicKeyPem = publicKey.export({ type: "spki", format: "pem" }).toString();
  const privateKeyPem = privateKey.export({ type: "pkcs8", format: "pem" }).toString();
  const challengeTimestamp = 1_700_000_000_000;
  await mkdir(identityDir, { recursive: true });
  await writeFile(join(identityDir, "device.json"), JSON.stringify({
    deviceId: "device-phase3",
    publicKeyPem,
    privateKeyPem
  }));
  await writeFile(join(identityDir, "device-auth.json"), JSON.stringify({
    deviceId: "device-phase3",
    tokens: { operator: { token: "old-device-token", scopes: ["operator.read"] } }
  }));

  const harness = await OfficialGatewayHarness.create({
    challengeNonce: "phase3-challenge",
    challengeTimestamp,
    deviceToken: "rotated-device-token"
  });
  const transport = new OfficialOpenClawGatewayTransport({
    url: harness.url,
    stateDir,
    sharedStateMode: "managed-write"
  });

  try {
    transport.start();
    const connect = await harness.waitForRequest("connect");
    await waitFor(() => transport.getHandshake() !== null);
    const params = connect.params as Record<string, unknown>;
    const device = params.device as Record<string, unknown>;
    const expectedPayload = buildDeviceAuthPayloadV3({
      deviceId: "device-phase3",
      clientId: GATEWAY_CLIENT_NAMES.GATEWAY_CLIENT,
      clientMode: GATEWAY_CLIENT_MODES.BACKEND,
      role: "operator",
      scopes: [...DEFAULT_OPERATOR_SCOPES],
      signedAtMs: challengeTimestamp,
      token: "old-device-token",
      nonce: "phase3-challenge-1",
      platform: process.platform,
      deviceFamily: null
    });

    assert.deepEqual(params.auth, { deviceToken: "old-device-token" });
    assert.equal(device.id, "device-phase3");
    assert.equal(device.signedAt, challengeTimestamp);
    assert.equal(device.nonce, "phase3-challenge-1");
    assert.equal(
      verify(null, Buffer.from(expectedPayload, "utf8"), publicKeyPem, decodeBase64Url(String(device.signature))),
      true
    );

    const rotated = JSON.parse(await readFile(join(identityDir, "device-auth.json"), "utf8")) as {
      tokens?: { operator?: { token?: string; scopes?: string[] } };
    };
    assert.equal(rotated.tokens?.operator?.token, "rotated-device-token");
    assert.deepEqual(rotated.tokens?.operator?.scopes, ["operator.admin", "operator.read", "operator.write"]);
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
    await rm(stateDir, { recursive: true, force: true });
  }
});

test("password auth remains an explicit official-client mode", async () => {
  const harness = await OfficialGatewayHarness.create();
  const transport = new OfficialOpenClawGatewayTransport({ url: harness.url, password: "phase2-password" });

  try {
    transport.start();
    const connect = await harness.waitForRequest("connect");
    assert.deepEqual((connect.params as Record<string, unknown>).auth, { password: "phase2-password" });
  } finally {
    await transport.stopAndWait({ timeoutMs: 500 });
    await harness.close();
  }
});

async function waitFor(predicate: () => boolean, timeoutMs = 2_000) {
  const startedAt = Date.now();
  while (!predicate()) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for official Gateway harness state.");
    }
    await delay(10);
  }
}

function decodeBase64Url(value: string) {
  return Buffer.from(value.replaceAll("-", "+").replaceAll("_", "/").padEnd(Math.ceil(value.length / 4) * 4, "="), "base64");
}
