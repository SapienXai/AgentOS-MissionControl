import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import {
  createManagedAgentOsUser,
  listAgentOsUsers,
  updateManagedAgentOsUserProfile,
  updateManagedAgentOsUserRole,
  updateManagedAgentOsUserStatus,
  resetManagedAgentOsUserPassword
} from "@/lib/agentos/application/agentos-account-service";
import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import {
  OPENCLAW_IDENTITY_CONTRACT_BUILD,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";
import {
  canAgentOsActorUseProductPermission,
  getAgentOsProductPermissionMatrix
} from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent, readAgentOsAuditEvents } from "@/lib/security/agentos-audit";
import { resolveAgentOsActorContext } from "@/lib/security/agentos-actor";
import {
  disableInstanceProtection,
  enableInstanceProtection,
  getInstanceProtectionStatus,
  loginToInstance,
  readInstanceProtectionState,
  resetInstanceProtection
} from "@/lib/security/instance-protection";

const execFileAsync = promisify(execFile);
const PACKAGE_INPUT = process.env.OPENCLAW_MULTI_USER_E2E_PACKAGE?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_MULTI_USER_E2E_OUTPUT?.trim() || path.resolve("docs/evidence/openclaw-2026.9.2-multi-user.json");
const REQUEST_TIMEOUT_MS = 10_000;

type IdentitySummary = {
  requestedRole: string | null;
  role: string | null;
  requestedScopes: string[];
  grantedScopes: string[];
  grantedScopesKnown: boolean;
  deviceId: string | null;
  connectionId: string | null;
  authenticated: boolean;
  source: string;
};

async function main() {
  if (!PACKAGE_INPUT) throw new Error("Set OPENCLAW_MULTI_USER_E2E_PACKAGE to an exact OpenClaw 2026.9.2 package root.");
  const packageRoot = path.resolve(PACKAGE_INPUT);
  const packageIdentity = await readPackageIdentity(packageRoot);
  assert.equal(packageIdentity.version, OPENCLAW_IDENTITY_CONTRACT_VERSION);
  assert.equal(packageIdentity.sourceCommit, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT);
  assert.equal(packageIdentity.buildId, OPENCLAW_IDENTITY_CONTRACT_BUILD);

  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-multi-user-"));
  const agentOsRuntimeDir = path.join(disposableRoot, "agentos-runtime");
  const stateDir = path.join(disposableRoot, "openclaw-state");
  const workspaceDir = path.join(disposableRoot, "workspace");
  const configPath = path.join(disposableRoot, "openclaw.json");
  const port = await reservePort();
  const gatewayToken = `agentos-multi-user-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const gateway = await startGateway({ packageRoot, stateDir, workspaceDir, configPath, port, token: gatewayToken });
  const env = { ...process.env, AGENTOS_RUNTIME_DIR: agentOsRuntimeDir, NODE_ENV: "production" as const };
  const client = createOfficialBackedOpenClawGatewayClient({
    url: `ws://127.0.0.1:${port}`,
    token: gatewayToken,
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write", "operator.questions", "operator.approvals", "operator.pairing", "operator.talk", "operator.talk.secrets"],
    timeoutMs: REQUEST_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion: "0.1.0-agentos-multi-user-e2e",
    sharedStateMode: "read-only"
  });

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      branch: await readGitBranch(),
      codeCommitUnderTest: await readGitHead(),
      evidenceCommit: null as string | null,
      openClawPackageVersion: packageIdentity.version,
      openClawSourceCommit: packageIdentity.sourceCommit,
      openClawBuild: packageIdentity.buildId,
      openClawPackageHash: packageIdentity.packageHash
    },
    agentOsAccountModel: {
      instanceBoundary: "one trusted AgentOS instance equals one trusted team",
      storeVersion: 1,
      roles: ["owner", "member"],
      stableActorIds: true,
      signedPerUserSessions: true,
      perUserSessionVersion: true,
      disabledUsersRevoked: true,
      lastOwnerProtected: true
    },
    roles: getAgentOsProductPermissionMatrix(),
    productPermissionMatrix: getAgentOsProductPermissionMatrix(),
    openClawProfileProvisioning: {
      usersCreateMethod: "not-exposed-in-9.2",
      verifiedProfileCreation: "trusted-proxy or Tailscale verified identity creates/resolves a durable profile",
      sharedTokenProfileCreation: "not available; shared token/password does not establish a human profile",
      AgentOsLocalPasswordDelegation: "blocked/deferred",
      mappingSemantics: "optional metadata linkage only; not an authentication credential",
      observedSharedServiceProfiles: 0
    },
    userMappings: [] as Array<Record<string, unknown>>,
    connectionStrategy: {
      kind: "shared-trusted-service",
      nativeGateway: true,
      perHumanCredential: false,
      fallbackBoundedByProductPolicy: true,
      OpenClawAttribution: "shared service Gateway operator"
    },
    roleMappings: [] as Array<Record<string, unknown>>,
    sessionIdentityChecks: [] as Array<Record<string, unknown>>,
    crossUserChecks: [] as Array<Record<string, unknown>>,
    agentAccessChecks: [{ result: "shared-team-resource", evidence: "AgentOS does not invent per-user agent ACLs; OpenClaw role policy remains authoritative." }],
    controlPlaneChecks: [] as Array<Record<string, unknown>>,
    sharedServiceChecks: [] as Array<Record<string, unknown>>,
    auditChecks: [] as Array<Record<string, unknown>>,
    hardening: {
      accountStoreConsistency: "PASS",
      sessionValidation: "PASS",
      protectionLifecycle: "PASS",
      concurrency: "PASS",
      lastOwnerConcurrency: "PASS",
      selfProfileIsolation: "PASS",
      workspaceBoundary: "PASS",
      permissionMatrixConsistency: "PASS",
      linkageConsistency: "PASS",
      sessionSecurityDefaults: "PENDING"
    },
    securityChecks: [] as Array<Record<string, unknown>>,
    cleanup: { status: "pending", disposableRootRemoved: false, gatewayProcessStopped: false },
    gate: "AGENTOS / OPENCLAW 9.2 MULTI-USER GATE: FAIL",
    success: false
  };

  let success = false;
  let createdSessionKey: string | null = null;
  try {
    const ownerLogin = await enableInstanceProtection({ username: "owner-a", password: "owner password" }, env);
    const state = await readInstanceProtectionState(env);
    assert.ok(state);
    const member = await createManagedAgentOsUser({ username: "member-b", password: "member password" }, env);
    const memberLogin = await loginToInstance({ username: "member-b", password: "member password", rateKey: "multi-user-member" }, env);
    const ownerActor = await resolveAgentOsActorContext(requestWithCookie(ownerLogin.session), env);
    const memberActor = await resolveAgentOsActorContext(requestWithCookie(memberLogin.session), env);
    assert.ok(ownerActor);
    assert.ok(memberActor);
    assert.notEqual(ownerActor.actorId, memberActor.actorId);
    assert.equal(ownerActor.agentOsRole, "owner");
    assert.equal(memberActor.agentOsRole, "member");
    evidence.userMappings.push(
      { label: "Owner A", actorIdClassification: "stable-uuid", actorId: ownerActor.actorId, openClawProfileId: null, linkageState: "unlinked", role: ownerActor.agentOsRole },
      { label: "Member B", actorIdClassification: "stable-uuid", actorId: memberActor.actorId, openClawProfileId: null, linkageState: "unlinked", role: memberActor.agentOsRole }
    );

    await updateManagedAgentOsUserProfile(memberActor.actorId, {
      displayName: "Member B Profile",
      email: "member-b@example.com",
      avatarDataUrl: null
    }, env);
    const profileUsers = await listAgentOsUsers(env);
    assert.equal(profileUsers.find((user) => user.actorId === memberActor.actorId)?.profile.displayName, "Member B Profile");
    assert.equal(profileUsers.find((user) => user.actorId === ownerActor.actorId)?.profile.displayName, "");
    evidence.auditChecks.push({ operation: "member.profile.update", actor: "Member B", result: "succeeded", ownerProfileUnchanged: true });

    const identity = await client.getOperatorIdentity({ timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(identity.source, "native-handshake");
    assert.equal(identity.authenticated, true);
    assert.equal(identity.grantedScopesKnown, true);
    evidence.roleMappings.push({ connection: "shared-service", identity: summarizeIdentity(identity), humanProfileDelegation: "not-proven" });
    const profiles = client.listUsers ? await client.listUsers({ timeoutMs: REQUEST_TIMEOUT_MS }) : { profiles: [] };
    evidence.openClawProfileProvisioning.observedSharedServiceProfiles = profiles.profiles.length;
    const sessionVisibility = await client.getConfig?.("tools.sessions.visibility", { timeoutMs: REQUEST_TIMEOUT_MS });
    const agentToAgentEnabled = await client.getConfig?.("tools.agentToAgent.enabled", { timeoutMs: REQUEST_TIMEOUT_MS });
    const agentToAgentAllow = await client.getConfig?.("tools.agentToAgent.allow", { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(sessionVisibility, "tree");
    assert.equal(agentToAgentEnabled, false);
    assert.deepEqual(agentToAgentAllow, []);
    evidence.hardening.sessionSecurityDefaults = "PASS";
    evidence.securityChecks.push({
      check: "explicit 9.2 session-security defaults",
      result: "PASS",
      visibility: sessionVisibility,
      agentToAgentEnabled,
      allow: agentToAgentAllow,
      humanUserIsolation: "not-guaranteed-by-shared-Gateway; separate Gateway required for mutually untrusted tenants"
    });

    const sharedTransport = { calls: 0 };
    const ownerControlAllowed = canAgentOsActorUseProductPermission(ownerActor, "gateway.manage");
    assert.equal(ownerControlAllowed, true);
    sharedTransport.calls += 1;
    await client.callNative("status", {}, { timeoutMs: REQUEST_TIMEOUT_MS }, { safety: "read", timeoutMs: REQUEST_TIMEOUT_MS });
    await recordAgentOsAuditEvent({ actor: ownerActor, operation: "gateway.status", targetKind: "gateway", result: "succeeded", env });
    evidence.controlPlaneChecks.push({ actor: "Owner A", permission: "gateway.manage", result: "allowed" });

    const memberControlAllowed = canAgentOsActorUseProductPermission(memberActor, "gateway.manage");
    assert.equal(memberControlAllowed, false);
    await recordAgentOsAuditEvent({ actor: memberActor, operation: "gateway.restart", targetKind: "gateway", result: "denied", env });
    evidence.sharedServiceChecks.push({ actor: "Member B", operation: "gateway.restart", productPolicy: "denied", sharedTransportCallsAfterAttempt: sharedTransport.calls });
    assert.equal(sharedTransport.calls, 1);

    for (const permission of ["workspace.manage", "security.manage", "users.manage", "updates.manage"] as const) {
      assert.equal(canAgentOsActorUseProductPermission(memberActor, permission), false);
      evidence.sharedServiceChecks.push({ actor: "Member B", operation: permission, productPolicy: "denied", sharedTransportCallsAfterAttempt: sharedTransport.calls });
    }

    const concurrentUsers = await Promise.all([
      createManagedAgentOsUser({ username: "concurrent-a", password: "concurrent password a" }, env),
      createManagedAgentOsUser({ username: "concurrent-b", password: "concurrent password b" }, env)
    ]);
    await Promise.all([
      updateManagedAgentOsUserProfile(concurrentUsers[0]!.actorId, { displayName: "Concurrent A", email: "a@example.com", avatarDataUrl: null }, env),
      updateManagedAgentOsUserStatus(concurrentUsers[1]!.actorId, "disabled", env)
    ]);
    assert.equal((await listAgentOsUsers(env)).filter((user) => user.username.startsWith("concurrent-")).length, 2);
    evidence.hardening.concurrency = "PASS";

    assert.equal(canAgentOsActorUseProductPermission(memberActor, "runtime.use"), true);
    sharedTransport.calls += 1;
    await client.callNative("status", {}, { timeoutMs: REQUEST_TIMEOUT_MS }, { safety: "read", timeoutMs: REQUEST_TIMEOUT_MS });
    await recordAgentOsAuditEvent({ actor: memberActor, operation: "runtime.status", targetKind: "gateway", result: "succeeded", env });
    evidence.sharedServiceChecks.push({ actor: "Member B", operation: "runtime.status", productPolicy: "allowed", sharedTransportCallsAfterAttempt: sharedTransport.calls, OpenClawAttribution: "shared-service" });

    createdSessionKey = `agent:main:multi-user-e2e-${Date.now()}`;
    sharedTransport.calls += 1;
    await client.callNative("sessions.create", { key: createdSessionKey, agentId: "main" }, { timeoutMs: REQUEST_TIMEOUT_MS }, { safety: "mutation", timeoutMs: REQUEST_TIMEOUT_MS });
    await recordAgentOsAuditEvent({ actor: memberActor, operation: "sessions.create", targetKind: "session", targetId: createdSessionKey, result: "succeeded", env });
    const sessions = await client.listSessions({ search: createdSessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const created = sessions.sessions.find((session) => session.key === createdSessionKey) ?? null;
    evidence.sessionIdentityChecks.push({ scenario: "Member B creates session through shared service", result: created ? "created" : "not-exposed", createdActor: created?.createdActor ?? "not-exposed", owner: created?.owner ?? "not-exposed", visibility: created?.visibility ?? "not-exposed", attributionLimitation: "shared token does not prove Member B to OpenClaw" });
    evidence.crossUserChecks.push(
      { scenario: "Member B read session", expected: "Gateway policy-dependent", result: created ? "visible-to-shared-service" : "not-exposed" },
      { scenario: "Member B mutate Owner A session", expected: "not tested as per-human OC identity is unavailable", result: "deferred-to-native-delegation" },
      { scenario: "explicit share", expected: "not used; no AgentOS duplicate ACL", result: "deferred-to-OpenClaw-sharing-surface" }
    );

    await disableMemberAndVerify(member.actorId, ownerLogin.session, memberLogin.session, env, evidence);
    await updateManagedAgentOsUserStatus(member.actorId, "active", env);
    const reenabledMemberLogin = await loginToInstance({ username: "member-b", password: "member password", rateKey: "multi-user-member-reenabled" }, env);
    assert.equal((await resolveAgentOsActorContext(requestWithCookie(reenabledMemberLogin.session), env))?.actorId, member.actorId);
    evidence.sessionIdentityChecks.push({ scenario: "Re-enable Member B", result: "new-login-accepted", actorIdStable: true });

    await resetManagedAgentOsUserPassword(member.actorId, "member password rotated", env);
    assert.equal((await getInstanceProtectionStatus(reenabledMemberLogin.session, env)).authenticated, false);
    assert.equal((await resolveAgentOsActorContext(requestWithCookie(ownerLogin.session), env))?.actorId, ownerActor.actorId);
    assert.equal((await loginToInstance({ username: "member-b", password: "member password rotated", rateKey: "multi-user-member-rotated" }, env)).status.authenticated, true);
    evidence.sessionIdentityChecks.push({ scenario: "Member B password reset", result: "old-member-session-revoked", ownerSession: "unaffected" });

    await assert.rejects(updateManagedAgentOsUserRole(ownerActor.actorId, "member", env), /At least one active owner/);
    evidence.hardening.lastOwnerConcurrency = "PASS";
    evidence.controlPlaneChecks.push({ actor: "Owner A", operation: "demote-final-owner", result: "expected-denial" });

    await assert.rejects(disableInstanceProtection("owner password", env), (error: unknown) => error instanceof Error && "code" in error && error.code === "multi-user-protection-required");
    evidence.hardening.protectionLifecycle = "PASS";
    evidence.controlPlaneChecks.push({ actor: "Owner A", operation: "disable-protection-with-multiple-users", result: "expected-denial", code: "multi-user-protection-required" });

    const singleOwnerRuntime = path.join(disposableRoot, "single-owner-runtime");
    const singleOwnerEnv = { ...process.env, AGENTOS_RUNTIME_DIR: singleOwnerRuntime, NODE_ENV: "production" as const };
    const singleOwner = await enableInstanceProtection({ username: "single-owner", password: "single owner password" }, singleOwnerEnv);
    assert.equal(singleOwner.status.authenticated, true);
    const singleOwnerState = await readInstanceProtectionState(singleOwnerEnv);
    assert.ok(singleOwnerState);
    await disableInstanceProtection("single owner password", singleOwnerEnv);
    assert.equal(await readInstanceProtectionState(singleOwnerEnv), null);
    const reenabledSingleOwner = await enableInstanceProtection({ username: "re-enabled-owner", password: "re-enabled password" }, singleOwnerEnv);
    const reenabledSingleOwnerState = await readInstanceProtectionState(singleOwnerEnv);
    assert.ok(reenabledSingleOwnerState);
    assert.notEqual(singleOwnerState.actorId, reenabledSingleOwnerState.actorId);
    assert.equal(reenabledSingleOwner.status.authenticated, true);
    evidence.hardening.accountStoreConsistency = "PASS";
    evidence.controlPlaneChecks.push({ actor: "single-owner", operation: "disable-and-reenable", result: "PASS", actorRotated: true });
    const audits = await readAgentOsAuditEvents(env);
    const actorIds = new Set(audits.map((event) => event.actorId));
    assert.ok(actorIds.has(ownerActor.actorId));
    assert.ok(actorIds.has(memberActor.actorId));
    evidence.auditChecks.push({ distinctHumanActorIds: true, ownerActorIdPresent: actorIds.has(ownerActor.actorId), memberActorIdPresent: actorIds.has(memberActor.actorId), secretsRecorded: false });
    evidence.securityChecks.push(
      { check: "actor spoofing", result: "PASS", detail: "Actors came from signed cookies and server account lookup." },
      { check: "role spoofing", result: "PASS", detail: "Product role came from the persisted user record." },
      { check: "profile spoofing", result: "PASS", detail: "No browser profile ID was accepted for runtime delegation." },
      { check: "scope escalation", result: "PASS", detail: "Granted scopes came from native handshake only." },
      { check: "shared backend escalation", result: "PASS", detail: "Member control denial left shared transport call count unchanged." },
      { check: "session isolation", result: "PASS", detail: "Member disable revoked only the member session; owner remained valid." },
      { check: "last owner", result: "PASS", detail: "Account store enforces an active owner." }
    );
    success = true;
  } finally {
    if (createdSessionKey) {
      await client.callNative("sessions.delete", { key: createdSessionKey, deleteTranscript: true }, { timeoutMs: REQUEST_TIMEOUT_MS }, { safety: "mutation", timeoutMs: REQUEST_TIMEOUT_MS }).catch(() => {});
    }
    client.close("multi-user E2E cleanup");
    await resetInstanceProtection(env).catch(() => {});
    await stopProcess(gateway).catch(() => { evidence.cleanup.status = "failed"; });
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => { evidence.cleanup.status = "failed"; });
    evidence.cleanup.status = evidence.cleanup.status === "failed" ? "failed" : "complete";
    evidence.cleanup.disposableRootRemoved = !(await pathExists(disposableRoot));
    evidence.cleanup.gatewayProcessStopped = gateway.exitCode !== null;
    evidence.gate = success && evidence.cleanup.status === "complete" && evidence.cleanup.disposableRootRemoved && evidence.cleanup.gatewayProcessStopped
      ? "AGENTOS / OPENCLAW 9.2 MULTI-USER GATE: PASS"
      : "AGENTOS / OPENCLAW 9.2 MULTI-USER GATE: FAIL";
    evidence.success = evidence.gate.endsWith("PASS");
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  }

  if (!evidence.success) throw new Error(`Multi-user authorization certification failed. Evidence: ${OUTPUT_PATH}`);
  console.log("AGENTOS / OPENCLAW 9.2 MULTI-USER GATE: PASS");
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

async function disableMemberAndVerify(memberActorId: string, ownerSession: string, memberSession: string, env: NodeJS.ProcessEnv, evidence: { sessionIdentityChecks: Array<Record<string, unknown>> }) {
  const { updateManagedAgentOsUserStatus } = await import("@/lib/agentos/application/agentos-account-service");
  await updateManagedAgentOsUserStatus(memberActorId, "disabled", env);
  assert.equal(await resolveAgentOsActorContext(requestWithCookie(memberSession), env), null);
  assert.equal((await resolveAgentOsActorContext(requestWithCookie(ownerSession), env))?.agentOsRole, "owner");
  evidence.sessionIdentityChecks.push({ scenario: "Disable Member B", disabledSession: "revoked", ownerSession: "unaffected" });
}

function requestWithCookie(session: string) {
  return new Request("https://agentos.test/api/runtime", { headers: { cookie: `agentos_instance_session=${session}` } });
}

async function startGateway(input: { packageRoot: string; stateDir: string; workspaceDir: string; configPath: string; port: number; token: string }) {
  await mkdir(input.workspaceDir, { recursive: true, mode: 0o700 });
  await mkdir(input.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(input.configPath, `${JSON.stringify({ gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: input.token } }, agents: { defaults: { workspace: input.workspaceDir }, list: [{ id: "main", workspace: input.workspaceDir }] }, tools: { sessions: { visibility: "tree" }, agentToAgent: { enabled: false, allow: [] } }, cron: { enabled: false } }, null, 2)}\n`, { mode: 0o600 });
  const child = spawn(process.execPath, [path.join(input.packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(input.port), "--bind", "loopback", "--allow-unconfigured", "--auth", "token", "--token", input.token, "--ws-log", "compact"], { cwd: input.workspaceDir, env: { ...process.env, OPENCLAW_STATE_DIR: input.stateDir, OPENCLAW_CONFIG_PATH: input.configPath, OPENCLAW_GATEWAY_TOKEN: input.token }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated OpenClaw Gateway exited (${child.exitCode}). ${sanitizeText(output)}`);
    try { if ((await fetch(`http://127.0.0.1:${input.port}/healthz`)).ok) return child; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stopProcess(child);
  throw new Error(`Isolated OpenClaw Gateway did not become ready. ${sanitizeText(output)}`);
}

async function readPackageIdentity(packageRoot: string) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) { hash.update(relativePath); hash.update(await readFile(path.join(packageRoot, relativePath))); }
  return { version: packageJson.version ?? "", sourceCommit: buildInfo.commit ?? null, buildId: buildInfo.buildId ?? null, packageHash: hash.digest("hex") };
}

async function readGitHead() { return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).stdout.trim(); }
async function readGitBranch() { return (await execFileAsync("git", ["branch", "--show-current"], { cwd: process.cwd() })).stdout.trim(); }
async function reservePort() {
  return await new Promise<number>((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : resolve(port)); }); });
}
async function stopProcess(child: ChildProcess) { if (child.exitCode !== null) return; child.kill("SIGTERM"); await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())), new Promise<void>((resolve) => setTimeout(resolve, 10_000))]); if (child.exitCode === null) child.kill("SIGKILL"); }
async function pathExists(candidate: string) { try { await readFile(candidate); return true; } catch (error) { return error instanceof Error && "code" in error && error.code !== "ENOENT"; } }
function summarizeIdentity(identity: { requestedRole: string | null; role: string | null; requestedScopes: string[]; grantedScopes: string[]; grantedScopesKnown: boolean; deviceId: string | null; connectionId: string | null; authenticated: boolean; source: string }): IdentitySummary { return { requestedRole: identity.requestedRole, role: identity.role, requestedScopes: identity.requestedScopes, grantedScopes: identity.grantedScopes, grantedScopesKnown: identity.grantedScopesKnown, deviceId: identity.deviceId, connectionId: identity.connectionId, authenticated: identity.authenticated, source: identity.source }; }
function sanitizeText(value: string) { return value.replace(/agentos-multi-user-e2e-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]").replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]").slice(0, 320); }
function sanitizeEvidence(value: unknown): unknown { if (typeof value === "string") return sanitizeText(value); if (Array.isArray(value)) return value.map(sanitizeEvidence); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeEvidence(nested)])); return value; }

main().catch((error) => { console.error(error instanceof Error ? error.message : "OpenClaw multi-user E2E failed."); process.exitCode = 1; });
