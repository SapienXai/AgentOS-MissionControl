import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { setOpenClawGatewayClientForTesting } from "@/lib/openclaw/client/gateway-client-factory";
import { NativeWsOpenClawGatewayClient } from "@/lib/openclaw/client/native-ws-gateway-client";
import { isGatewayMutationMethod } from "@/lib/openclaw/client/native-ws-gateway-policy";
import { FakeOpenClawGateway } from "@/tests/helpers/fake-openclaw-gateway";
import {
  buildOpenClawNativeAuthorizationProof,
  isVerifiedNativeAuthorizationProof,
  OpenClawAuthorizationService,
  resolveRequiredScopes
} from "@/lib/openclaw/identity/authorization";
import {
  OPENCLAW_8_2_IDENTITY_INVENTORY,
  OPENCLAW_CAPABILITY_SCOPES,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_VERSION,
  OPENCLAW_STATIC_METHOD_SCOPES
} from "@/lib/openclaw/identity/contract";
import type { OpenClawGatewayClient } from "@/lib/openclaw/client/types";
import type { OpenClawOperatorIdentity } from "@/lib/openclaw/identity/types";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";

function fakeClient(identity: OpenClawOperatorIdentity) {
  return {
    getOperatorIdentity: async () => ({
      ...identity,
      requestedScopes: [...identity.requestedScopes],
      grantedScopes: [...identity.grantedScopes]
    })
  } as unknown as OpenClawGatewayClient;
}

function nativeIdentity(grantedScopes: string[], requestedScopes = grantedScopes): OpenClawOperatorIdentity {
  return {
    requestedRole: "operator",
    role: "operator",
    requestedScopes,
    grantedScopes,
    grantedScopesKnown: true,
    deviceId: "device-1",
    connectionId: "connection-1",
    authenticated: true,
    source: "native-handshake"
  };
}

test("9.1 authorization uses granted scopes, not requested scopes", async () => {
  const service = new OpenClawAuthorizationService(fakeClient(nativeIdentity(
    ["operator.read"],
    ["operator.admin", "operator.read", "operator.write"]
  )));

  assert.equal((await service.authorizeCapability("canRead")).state, "allowed");
  assert.equal((await service.authorizeCapability("canAdmin")).state, "denied");
  assert.equal((await service.authorizeCapability("canWrite")).state, "denied");
  assert.equal((await service.authorizeCapability("canAskQuestions")).state, "denied");
  assert.deepEqual((await service.authorizeCapability("canAdmin")).grantedScopes, ["operator.read"]);
});

test("9.1 dedicated scopes remain distinct and dynamic operations stay runtime-required", async () => {
  const service = new OpenClawAuthorizationService(fakeClient(nativeIdentity([
    "operator.read",
    "operator.write",
    "operator.questions",
    "operator.talk"
  ])));

  assert.equal((await service.authorizeMethod("question.list")).state, "allowed");
  assert.equal((await service.authorizeMethod("device.pair.list")).state, "denied");
  assert.equal((await service.authorizeMethod("talk.client.create")).state, "allowed");
  assert.equal((await service.authorizeMethod("talk.config", { includeSecrets: true })).state, "denied");
  assert.equal((await service.authorizeMethod("sessions.patch", { key: "agent:main:main" })).state, "runtime-required");
  assert.equal((await service.authorizeMethod("chat.send", { sessionKey: "agent:main:main" })).state, "runtime-required");
  assert.equal((await service.authorizeMethod("chat.send", { sessionKey: "agent:main:main" })).state, "runtime-required");
  assert.equal((await service.authorizeMethod("node.invoke", { nodeId: "node-1", command: "system.run" })).state, "runtime-required");
  assert.equal((await service.authorizeMethod("config.patch", { raw: {} })).state, "denied");
});

test("9.1 native work methods use the exact upstream descriptor scopes", async () => {
  const expected: Record<string, string> = {
    "taskSuggestions.list": "operator.read",
    "taskSuggestions.create": "operator.write",
    "taskSuggestions.accept": "operator.admin",
    "taskSuggestions.dismiss": "operator.write",
    "worktrees.list": "operator.read",
    "worktrees.branches": "operator.write",
    "worktrees.create": "operator.write",
    "worktrees.remove": "operator.admin",
    "worktrees.restore": "operator.admin",
    "worktrees.gc": "operator.admin",
    "session.members.list": "operator.read",
    "session.members.listEvidence": "operator.read",
    "session.members.add": "operator.write",
    "session.members.remove": "operator.write",
    "session.visibility.set": "operator.write",
    "sessions.assignOwner": "operator.write"
  };

  assert.deepEqual(
    Object.fromEntries(Object.keys(expected).map((method) => [method, OPENCLAW_STATIC_METHOD_SCOPES[method]])),
    Object.fromEntries(Object.entries(expected).map(([method, scope]) => [method, [scope]]))
  );

  const readService = new OpenClawAuthorizationService(fakeClient(nativeIdentity(["operator.read"])));
  const writeService = new OpenClawAuthorizationService(fakeClient(nativeIdentity(["operator.write"])));
  const adminService = new OpenClawAuthorizationService(fakeClient(nativeIdentity(["operator.admin"])));
  for (const [method, scope] of Object.entries(expected)) {
    assert.deepEqual(resolveRequiredScopes(method), [scope], method);
    const service = scope === "operator.read" ? readService : scope === "operator.write" ? writeService : adminService;
    assert.equal((await service.authorizeMethod(method)).state, "allowed", method);
    if (scope !== "operator.read") {
      assert.equal((await readService.authorizeMethod(method)).state, "denied", method);
    }
    if (scope === "operator.admin") {
      assert.equal((await writeService.authorizeMethod(method)).state, "denied", method);
    }
  }
});

test("9.1 execution topology methods use exact static and dynamic scopes", async () => {
  const expected: Record<string, string> = {
    "node.list": "operator.read",
    "node.describe": "operator.read",
    "environments.list": "operator.read",
    "environments.status": "operator.read",
    "environments.create": "operator.admin",
    "environments.destroy": "operator.admin",
    "sessions.reclaim": "operator.write"
  };
  for (const [method, scope] of Object.entries(expected)) {
    assert.deepEqual(OPENCLAW_STATIC_METHOD_SCOPES[method], [scope], method);
    assert.deepEqual(resolveRequiredScopes(method), [scope], method);
  }

  assert.deepEqual(resolveRequiredScopes("sessions.dispatch", { autoDevice: true }), ["operator.write"]);
  assert.deepEqual(resolveRequiredScopes("sessions.dispatch", { profileId: "profile-1" }), ["operator.admin"]);
  assert.deepEqual(resolveRequiredScopes("sessions.move", { target: { kind: "device", deviceId: "node-1" } }), ["operator.write"]);
  assert.deepEqual(resolveRequiredScopes("sessions.move", { target: { kind: "profile", profileId: "profile-1" } }), ["operator.admin"]);
  assert.deepEqual(resolveRequiredScopes("node.invoke", { nodeId: "node-1", command: "system.run" }), ["operator.write"]);
  assert.deepEqual(resolveRequiredScopes("node.invoke", { nodeId: "node-1", command: "browser.proxy" }), ["operator.admin"]);
});

test("9.1 skills library and tool methods use exact upstream scopes", async () => {
  const expected: Record<string, string> = {
    "skills.library.list": "operator.read",
    "skills.library.read": "operator.read",
    "skills.library.activate": "operator.write",
    "memory.search": "operator.read",
    "doctor.memory.status": "operator.read",
    "doctor.memory.dreamDiary": "operator.read",
    "doctor.memory.backfillDreamDiary": "operator.write",
    "doctor.memory.resetDreamDiary": "operator.write",
    "doctor.memory.resetGroundedShortTerm": "operator.write",
    "doctor.memory.repairDreamingArtifacts": "operator.write",
    "doctor.memory.dedupeDreamDiary": "operator.write",
    "tools.catalog": "operator.read",
    "tools.effective": "operator.read",
    "tools.invoke": "operator.write"
  };

  const readService = new OpenClawAuthorizationService(fakeClient(nativeIdentity(["operator.read"])));
  const writeService = new OpenClawAuthorizationService(fakeClient(nativeIdentity(["operator.write"])));
  for (const [method, scope] of Object.entries(expected)) {
    assert.deepEqual(OPENCLAW_STATIC_METHOD_SCOPES[method], [scope], method);
    assert.deepEqual(resolveRequiredScopes(method), [scope], method);
    const service = scope === "operator.read" ? readService : writeService;
    assert.equal((await service.authorizeMethod(method)).state, "allowed", method);
    if (scope === "operator.write") {
      assert.equal((await readService.authorizeMethod(method)).state, "denied", method);
    }
  }
});

test("9.1 Human Control methods use dedicated native approval and question scopes", async () => {
  const expected: Record<string, string> = {
    "exec.approval.list": "operator.approvals",
    "exec.approval.resolve": "operator.approvals",
    "plugin.approval.list": "operator.approvals",
    "plugin.approval.resolve": "operator.approvals",
    "question.list": "operator.questions",
    "question.resolve": "operator.questions"
  };
  const approvals = new OpenClawAuthorizationService(fakeClient(nativeIdentity(["operator.approvals"])));
  const questions = new OpenClawAuthorizationService(fakeClient(nativeIdentity(["operator.questions"])));
  for (const [method, scope] of Object.entries(expected)) {
    assert.deepEqual(OPENCLAW_STATIC_METHOD_SCOPES[method], [scope], method);
    assert.deepEqual(resolveRequiredScopes(method), [scope], method);
    const allowed = scope === "operator.approvals" ? approvals : questions;
    const denied = scope === "operator.approvals" ? questions : approvals;
    const authorization = await allowed.authorizeMethod(method);
    assert.equal(authorization.state, method === "question.resolve" ? "runtime-required" : "allowed", method);
    assert.equal((await denied.authorizeMethod(method)).state, "denied", method);
  }
});

test("9.1 mutation policy classifies non-suffix mutation methods for fallback safety", () => {
  for (const method of [
    "channels.pairing.approve",
    "device.pair.approve",
    "device.pair.setupCode",
    "plugins.install",
    "chat.inject",
    "web.login.wait"
  ]) {
    assert.equal(isGatewayMutationMethod(method), true, method);
  }

  assert.equal(isGatewayMutationMethod("device.pair.list"), false);
  assert.equal(isGatewayMutationMethod("talk.config"), false);
});

test("missing native handshake identity is unknown rather than permission", async () => {
  const service = new OpenClawAuthorizationService(fakeClient({
    requestedRole: "operator",
    role: null,
    requestedScopes: ["operator.admin"],
    grantedScopes: [],
    grantedScopesKnown: false,
    deviceId: null,
    connectionId: null,
    authenticated: false,
    source: "unavailable"
  }));

  const result = await service.authorizeCapability("canAdmin");
  assert.equal(result.state, "unknown");
  assert.deepEqual(result.grantedScopes, []);
  assert.match(result.reason, /not exposed|not.*authenticated/i);
});

test("stale native identity cannot authorize a privileged mutation", async () => {
  const previous = {
    runtime: process.env.AGENTOS_RUNTIME_DIR,
    nodeEnv: process.env.NODE_ENV
  };
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.AGENTOS_RUNTIME_DIR = await mkdtemp(path.join(tmpdir(), "agentos-stale-identity-"));
  mutableEnv.NODE_ENV = "development";
  setOpenClawGatewayClientForTesting(fakeClient({
    ...nativeIdentity(["operator.admin"]),
    authenticated: false,
    grantedScopesKnown: true,
    source: "native-handshake"
  }));

  try {
    const result = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/agents", {
        method: "POST",
        headers: { host: "127.0.0.1:3000" }
      }),
      {
        operation: "agent.create",
        method: "agents.create",
        targetKind: "agent",
        securityClass: "privileged-mutation",
        executionPath: "gateway-or-verified-cli"
      }
    );

    assert.equal("response" in result, true);
    if ("response" in result) {
      assert.equal(result.response.status, 503);
      assert.equal((await result.response.json()).code, "openclaw-identity-unavailable");
    }
  } finally {
    setOpenClawGatewayClientForTesting(null);
    if (previous.runtime === undefined) delete mutableEnv.AGENTOS_RUNTIME_DIR;
    else mutableEnv.AGENTOS_RUNTIME_DIR = previous.runtime;
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous.nodeEnv;
  }
});

test("the application preflight blocks a known Gateway denial and derives actor server-side", async () => {
  const previous = {
    runtime: process.env.AGENTOS_RUNTIME_DIR,
    nodeEnv: process.env.NODE_ENV
  };
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.AGENTOS_RUNTIME_DIR = await mkdtemp(path.join(tmpdir(), "agentos-preflight-"));
  mutableEnv.NODE_ENV = "development";
  setOpenClawGatewayClientForTesting(fakeClient(nativeIdentity(["operator.read"])));

  try {
    const denied = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/agents", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          "x-agentos-actor-id": "forged",
          "x-agentos-role": "admin",
          "x-agentos-scopes": "operator.admin"
        }
      }),
      {
        operation: "agent.create",
        method: "agents.create",
        targetKind: "agent",
        securityClass: "privileged-mutation",
        executionPath: "gateway-or-verified-cli"
      }
    );
    assert.equal("response" in denied, true);
    if ("response" in denied) {
      assert.equal(denied.response.status, 403);
      assert.equal((await denied.response.json()).code, "openclaw-capability-denied");
    }

    setOpenClawGatewayClientForTesting(fakeClient(nativeIdentity(["operator.admin", "operator.read"])));
    const allowed = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/agents", { method: "POST", headers: { host: "127.0.0.1:3000" } }),
      {
        operation: "agent.create",
        method: "agents.create",
        targetKind: "agent",
        securityClass: "privileged-mutation",
        executionPath: "gateway-or-verified-cli"
      }
    );
    assert.equal("actor" in allowed, true);
    if ("actor" in allowed) {
      assert.equal(allowed.actor.actorId, "unprotected-local");
      assert.equal(allowed.actor.agentOsRole, null);
      assert.equal(allowed.authorization.state, "allowed");
      assert.equal(allowed.context.actorId, allowed.actor.actorId);
      assert.equal(allowed.context.operation, "agent.create");
      assert.equal(allowed.context.openClaw.connectionId, "connection-1");
    }
  } finally {
    setOpenClawGatewayClientForTesting(null);
    if (previous.runtime === undefined) delete mutableEnv.AGENTOS_RUNTIME_DIR;
    else mutableEnv.AGENTOS_RUNTIME_DIR = previous.runtime;
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous.nodeEnv;
  }
});

test("regression: unknown preflight blocks the explicit agentDir CLI mutation fallback", async () => {
  const previous = {
    runtime: process.env.AGENTOS_RUNTIME_DIR,
    nodeEnv: process.env.NODE_ENV
  };
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.AGENTOS_RUNTIME_DIR = await mkdtemp(path.join(tmpdir(), "agentos-preflight-bypass-"));
  mutableEnv.NODE_ENV = "development";
  const fallbackCalls: string[] = [];
  const fallback = {
    addAgent: async (input: { id: string }) => {
      fallbackCalls.push(input.id);
      return { stdout: "", stderr: "", code: 0 };
    }
  } as unknown as OpenClawGatewayClient;
  const gateway = new FakeOpenClawGateway();
  const client = new NativeWsOpenClawGatewayClient({ fallback, forceCli: true, transport: gateway.transport });
  setOpenClawGatewayClientForTesting(fakeClient({
    requestedRole: "operator",
    role: null,
    requestedScopes: ["operator.admin"],
    grantedScopes: [],
    grantedScopesKnown: false,
    deviceId: null,
    connectionId: null,
    authenticated: false,
    source: "cli-fallback"
  }));

  try {
    const preflight = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/agents", {
        method: "POST",
        headers: { host: "127.0.0.1:3000" }
      }),
      {
        operation: "agent.create",
        method: "agents.create",
        targetKind: "agent",
        securityClass: "privileged-mutation",
        executionPath: "gateway-or-verified-cli"
      }
    );

    assert.equal("response" in preflight, true);
    if ("response" in preflight) {
      assert.equal(preflight.response.status, 503);
      assert.equal((await preflight.response.json()).code, "openclaw-identity-unavailable");
    }
    assert.deepEqual(fallbackCalls, []);
  } finally {
    client.close();
    setOpenClawGatewayClientForTesting(null);
    if (previous.runtime === undefined) delete mutableEnv.AGENTOS_RUNTIME_DIR;
    else mutableEnv.AGENTOS_RUNTIME_DIR = previous.runtime;
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous.nodeEnv;
  }
});

test("unknown native identity remains usable for reads but blocks privileged mutations", async () => {
  const previous = {
    runtime: process.env.AGENTOS_RUNTIME_DIR,
    nodeEnv: process.env.NODE_ENV
  };
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.AGENTOS_RUNTIME_DIR = await mkdtemp(path.join(tmpdir(), "agentos-preflight-state-"));
  mutableEnv.NODE_ENV = "development";
  const identity = {
    requestedRole: "operator",
    role: null,
    requestedScopes: ["operator.admin"],
    grantedScopes: [],
    grantedScopesKnown: false,
    deviceId: null,
    connectionId: null,
    authenticated: false,
    source: "unavailable"
  } satisfies OpenClawOperatorIdentity;
  setOpenClawGatewayClientForTesting(fakeClient(identity));

  try {
    const read = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/agents", { method: "GET", headers: { host: "127.0.0.1:3000" } }),
      {
        operation: "agent.list",
        method: "agents.list",
        targetKind: "agent",
        securityClass: "read"
      }
    );
    assert.equal("response" in read, false);
    if (!("response" in read)) {
      assert.equal(read.authorization.state, "unknown");
      assert.deepEqual(read.commandOptions, {});
    }

    const mutation = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/agents", { method: "POST", headers: { host: "127.0.0.1:3000" } }),
      {
        operation: "agent.create",
        method: "agents.create",
        targetKind: "agent",
        securityClass: "privileged-mutation",
        executionPath: "gateway-or-verified-cli"
      }
    );
    assert.equal("response" in mutation, true);
    if ("response" in mutation) {
      assert.equal(mutation.response.status, 503);
      assert.deepEqual(await mutation.response.json(), {
        error: "OpenClaw authorization could not be proven for this operation.",
        code: "openclaw-identity-unavailable",
        method: "agents.create",
        state: "unknown",
        requiredScopes: ["operator.admin"],
        grantedScopes: [],
        reason: "OpenClaw has not exposed an authenticated native handshake identity.",
        retryable: true
      });
    }
  } finally {
    setOpenClawGatewayClientForTesting(null);
    if (previous.runtime === undefined) delete mutableEnv.AGENTOS_RUNTIME_DIR;
    else mutableEnv.AGENTOS_RUNTIME_DIR = previous.runtime;
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous.nodeEnv;
  }
});

test("a proven native admin identity creates a CLI fallback proof without trusting browser fields", async () => {
  const previous = {
    runtime: process.env.AGENTOS_RUNTIME_DIR,
    nodeEnv: process.env.NODE_ENV
  };
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.AGENTOS_RUNTIME_DIR = await mkdtemp(path.join(tmpdir(), "agentos-preflight-proof-"));
  mutableEnv.NODE_ENV = "development";
  setOpenClawGatewayClientForTesting(fakeClient(nativeIdentity(["operator.admin"])));

  try {
    const result = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/agents", {
        method: "POST",
        headers: {
          host: "127.0.0.1:3000",
          "x-agentos-actor-id": "forged",
          "x-agentos-scopes": "operator.admin"
        }
      }),
      {
        operation: "agent.create",
        method: "agents.create",
        targetKind: "agent",
        securityClass: "privileged-mutation",
        executionPath: "gateway-or-verified-cli"
      }
    );
    assert.equal("response" in result, false);
    if (!("response" in result)) {
      assert.equal(result.authorization.identity.grantedScopesKnown, true);
      assert.equal(result.commandOptions.authorizationProof?.source, "native-handshake");
      assert.equal(result.commandOptions.authorizationProof?.cliFallbackAllowed, true);
      assert.deepEqual(result.commandOptions.authorizationProof?.grantedScopes, ["operator.admin"]);
      assert.equal(result.commandOptions.authorizationProof?.connectionId, "connection-1");
    }
  } finally {
    setOpenClawGatewayClientForTesting(null);
    if (previous.runtime === undefined) delete mutableEnv.AGENTOS_RUNTIME_DIR;
    else mutableEnv.AGENTOS_RUNTIME_DIR = previous.runtime;
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous.nodeEnv;
  }
});

test("a native CLI proof must match the current connection identity exactly", () => {
  const previousIdentity = nativeIdentity(["operator.admin"], ["operator.admin"]);
  const authorization = {
    state: "allowed" as const,
    capability: null,
    method: "agents.create",
    identity: previousIdentity,
    requiredScopes: ["operator.admin"],
    grantedScopes: ["operator.admin"],
    reason: "test"
  };
  const proof = buildOpenClawNativeAuthorizationProof(authorization, true);
  assert.ok(proof);

  const reconnectedIdentity = nativeIdentity(["operator.admin"], ["operator.admin"]);
  reconnectedIdentity.connectionId = "connection-2";
  assert.equal(
    isVerifiedNativeAuthorizationProof(proof, reconnectedIdentity, "agents.create", { agentDir: "/tmp/agent" }),
    false
  );

  const identityWithoutConnectionId = nativeIdentity(["operator.admin"], ["operator.admin"]);
  identityWithoutConnectionId.connectionId = null;
  const proofWithoutConnectionId = buildOpenClawNativeAuthorizationProof({
    ...authorization,
    identity: identityWithoutConnectionId
  }, true);
  assert.ok(proofWithoutConnectionId);
  assert.equal(
    isVerifiedNativeAuthorizationProof(proofWithoutConnectionId, reconnectedIdentity, "agents.create", { agentDir: "/tmp/agent" }),
    false
  );
});

test("internal recovery is not selectable by a browser actor", async () => {
  const previous = {
    runtime: process.env.AGENTOS_RUNTIME_DIR,
    nodeEnv: process.env.NODE_ENV
  };
  const mutableEnv = process.env as Record<string, string | undefined>;
  mutableEnv.AGENTOS_RUNTIME_DIR = await mkdtemp(path.join(tmpdir(), "agentos-preflight-internal-"));
  mutableEnv.NODE_ENV = "development";
  setOpenClawGatewayClientForTesting(fakeClient(nativeIdentity(["operator.admin"])));

  try {
    const result = await requireAgentOsOpenClawPreflight(
      new Request("http://127.0.0.1:3000/api/internal", { method: "POST", headers: { host: "127.0.0.1:3000" } }),
      {
        operation: "internal.recovery",
        method: "config.patch",
        targetKind: "runtime",
        securityClass: "internal-recovery",
        executionPath: "gateway-native"
      }
    );
    assert.equal("response" in result, true);
    if ("response" in result) {
      assert.equal(result.response.status, 403);
      assert.equal((await result.response.json()).code, "agentos-internal-service-required");
    }
  } finally {
    setOpenClawGatewayClientForTesting(null);
    if (previous.runtime === undefined) delete mutableEnv.AGENTOS_RUNTIME_DIR;
    else mutableEnv.AGENTOS_RUNTIME_DIR = previous.runtime;
    if (previous.nodeEnv === undefined) delete mutableEnv.NODE_ENV;
    else mutableEnv.NODE_ENV = previous.nodeEnv;
  }
});

test("selected public OpenClaw mutation routes require preflight and pass server proof", () => {
  const routeExpectations = [
    ["app/api/agents/route.ts", "agents.create", "agents.update", "agents.delete"],
    ["app/api/agents/[agentId]/chat/route.ts", "chat.send"],
    ["app/api/mission/route.ts", "chat.send"],
    ["app/api/tasks/[taskId]/control/route.ts", "chat.send", "chat.inject"],
    ["app/api/tasks/[taskId]/abort/route.ts", "sessions.abort"],
    ["app/api/operations/route.ts", "cron.add", "cron.update", "cron.remove"],
    ["app/api/settings/gateway/route.ts", "config.patch", "device.pair.approve"],
    ["app/api/runtime/issues/route.ts", "device.pair.approve"],
    ["app/api/openclaw/channels/connect/route.ts", "plugins.install", "channels.pairing.approve"],
    ["app/api/openclaw/mobile-pairing/route.ts", "device.pair.setup"]
  ] as const;

  for (const [route, ...methods] of routeExpectations) {
    const source = readFileSync(path.join(process.cwd(), route), "utf8");
    assert.match(source, /requireAgentOsOpenClawPreflight/);
    assert.match(source, /securityClass:\s*"privileged-mutation"/);
    assert.match(source, /commandOptions/);
    for (const method of methods) {
      assert.match(source, new RegExp(method.replaceAll(".", "\\.")), `${route} must preflight ${method}`);
    }
  }

  const mobilePairingSource = readFileSync(path.join(process.cwd(), "app/api/openclaw/mobile-pairing/route.ts"), "utf8");
  assert.match(mobilePairingSource, /device\.pair\.setup"\s*\+\s*"Code/);
});

test("identity inventory pins the 9.3 contract and current AgentOS use", () => {
  assert.equal(OPENCLAW_IDENTITY_CONTRACT_VERSION, "2026.9.3");
  assert.equal(OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, "1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7");
  assert.deepEqual(OPENCLAW_CAPABILITY_SCOPES.canUseTalkSecrets, ["operator.talk.secrets"]);
  assert.ok(OPENCLAW_8_2_IDENTITY_INVENTORY.some((entry) => entry.methodOrField === "users.list"));
  assert.ok(OPENCLAW_8_2_IDENTITY_INVENTORY.some((entry) => entry.methodOrField === "sessions.create/patch/delete/dispatch" && entry.dynamicAuthorization));
});
