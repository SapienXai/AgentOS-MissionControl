import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  readOperatorProfileRecord,
  saveOperatorProfile
} from "@/lib/agentos/application/operator-profile-service";
import {
  createInternalServiceActorContext,
  resolveAgentOsActorContext
} from "@/lib/security/agentos-actor";
import {
  enableInstanceProtection,
  loginToInstance,
  readInstanceProtectionState,
  resolveInstanceProtectionPath,
  updateInstanceCredentials
} from "@/lib/security/instance-protection";
import { recordAgentOsAuditEvent, readAgentOsAuditEvents } from "@/lib/security/agentos-audit";

test("stable actor identity survives password, username, and profile changes", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-actor-identity-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir, NODE_ENV: "production" as const };
  const enabled = await enableInstanceProtection({ username: "operator", password: "correct horse" }, env);
  const initialState = await readInstanceProtectionState(env);
  assert.ok(initialState);

  const initialActor = await resolveAgentOsActorContext(new Request("https://agentos.example.com/api/profile", {
    headers: { cookie: `agentos_instance_session=${enabled.session}` }
  }), env);
  assert.equal(initialActor?.actorId, initialState.actorId);
  assert.equal(initialActor?.kind, "instance-operator");
  assert.equal(initialActor?.authenticationMethod, "instance-session");
  assert.equal(initialActor?.agentOsRole, "owner");

  await saveOperatorProfile({
    fullName: "Operator One",
    username: "operator.one",
    email: "one@example.com",
    avatarDataUrl: null
  }, env, initialState.actorId);
  const profileRecord = await readOperatorProfileRecord(env);
  assert.equal(profileRecord.actorId, initialState.actorId);

  const updated = await updateInstanceCredentials({
    username: "renamed-operator",
    currentPassword: "correct horse",
    newPassword: "new secure password"
  }, env);
  assert.equal((await resolveAgentOsActorContext(new Request("https://agentos.example.com/api/profile", {
    headers: { cookie: `agentos_instance_session=${updated.session}` }
  }), env))?.actorId, initialState.actorId);

  await saveOperatorProfile({
    fullName: "Operator Updated",
    username: "renamed.profile",
    email: "updated@example.com",
    avatarDataUrl: "data:image/png;base64,YQ=="
  }, env, initialState.actorId);
  assert.equal((await readOperatorProfileRecord(env)).actorId, initialState.actorId);
  assert.equal((await loginToInstance({
    username: "renamed-operator",
    password: "new secure password",
    rateKey: "actor-identity-login"
  }, env)).status.authenticated, true);
  await assert.rejects(
    loginToInstance({
      username: "renamed-operator",
      password: "correct horse",
      rateKey: "actor-identity-old-password"
    }, env),
    /Invalid username or password/
  );
});

test("v1 Instance Protection state migrates to a stable actor without locking out the owner", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-actor-migration-"));
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: runtimeDir, NODE_ENV: "production" as const };
  await enableInstanceProtection({ username: "legacy-owner", password: "legacy password" }, env);
  const before = await readInstanceProtectionState(env);
  assert.ok(before);
  const legacy = { ...before, version: 1 } as Record<string, unknown>;
  delete legacy.actorId;
  await writeFile(resolveInstanceProtectionPath(env), `${JSON.stringify(legacy)}\n`, { mode: 0o600 });

  const migrated = await readInstanceProtectionState(env);
  assert.ok(migrated);
  assert.match(migrated.actorId, /^[0-9a-f-]{36}$/i);
  assert.equal(migrated.username, "legacy-owner");
  assert.equal((await loginToInstance({
    username: "legacy-owner",
    password: "legacy password",
    rateKey: "actor-migration-login"
  }, env)).status.authenticated, true);
  const stored = JSON.parse(await readFile(resolveInstanceProtectionPath(env), "utf8")) as Record<string, unknown>;
  assert.equal(stored.version, 2);
  assert.equal(stored.actorId, migrated.actorId);
});

test("API-token and internal actors are explicit and cannot be browser-forged", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-actor-service-"));
  const env = {
    ...process.env,
    AGENTOS_RUNTIME_DIR: runtimeDir,
    AGENTOS_API_TOKEN: "service-secret",
    NODE_ENV: "production" as const
  };
  const service = await resolveAgentOsActorContext(new Request("https://agentos.example.com/api/agents", {
    headers: {
      authorization: "Bearer service-secret",
      "x-agentos-actor-id": "attacker",
      "x-agentos-role": "admin",
      "x-agentos-scopes": "operator.admin"
    }
  }), env);
  assert.deepEqual(service, {
    actorId: "service:agentos-api-token",
    kind: "service",
    username: null,
    displayName: null,
    authenticationMethod: "api-token",
    authenticated: true,
    agentOsRole: "owner"
  });

  const internal = createInternalServiceActorContext();
  assert.equal(internal.kind, "internal-service");
  assert.equal(internal.authenticationMethod, "internal-service");
  assert.notEqual(service?.actorId, internal.actorId);

  await recordAgentOsAuditEvent({
    actor: internal,
    operation: "identity.test",
    targetKind: "test",
    result: "succeeded",
    env
  });
  const events = await readAgentOsAuditEvents(env);
  assert.deepEqual(events[0], {
    schemaVersion: 1,
    actorId: "service:agentos-internal",
    authenticationMethod: "internal-service",
    operation: "identity.test",
    targetKind: "test",
    result: "succeeded",
    timestamp: events[0]?.timestamp
  });
  assert.equal(typeof events[0]?.timestamp, "string");
});

test("packaged desktop API tokens resolve to a local owner operator", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-actor-desktop-"));
  const env = {
    ...process.env,
    AGENTOS_RUNTIME_DIR: runtimeDir,
    AGENTOS_API_TOKEN: "desktop-secret",
    AGENTOS_DESKTOP: "1",
    AGENTOS_PACKAGE_RUNTIME: "1",
    NODE_ENV: "production" as const
  };

  const actor = await resolveAgentOsActorContext(new Request("http://127.0.0.1/api/onboarding", {
    headers: { authorization: "Bearer desktop-secret" }
  }), env);

  assert.deepEqual(actor, {
    actorId: "operator:agentos-desktop",
    kind: "desktop-operator",
    username: null,
    displayName: null,
    authenticationMethod: "desktop-token",
    authenticated: true,
    agentOsRole: "owner"
  });
});

test("protected instances never let an API token bypass the browser session boundary", async () => {
  const runtimeDir = await mkdtemp(path.join(tmpdir(), "agentos-actor-precedence-"));
  const env = {
    ...process.env,
    AGENTOS_RUNTIME_DIR: runtimeDir,
    AGENTOS_API_TOKEN: "service-secret",
    NODE_ENV: "production" as const
  };
  const enabled = await enableInstanceProtection({ username: "operator", password: "secure password" }, env);
  const baseRequest = "https://agentos.example.com/api/agents";

  assert.equal(await resolveAgentOsActorContext(new Request(baseRequest, {
    headers: { authorization: "Bearer service-secret" }
  }), env), null);
  assert.equal((await resolveAgentOsActorContext(new Request(baseRequest, {
    headers: {
      authorization: "Bearer service-secret",
      cookie: `agentos_instance_session=${enabled.session}`
    }
  }), env))?.actorId, (await readInstanceProtectionState(env))?.actorId);
  assert.equal(await resolveAgentOsActorContext(new Request(baseRequest, {
    headers: {
      authorization: "Bearer service-secret",
      cookie: "agentos_instance_session=invalid"
    }
  }), env), null);
});
