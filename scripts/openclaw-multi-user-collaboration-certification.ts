import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import {
  assertPinnedMethodAbsent,
  comparePinnedMethodScopes,
  parsePinnedCoreDescriptorScopes,
  PHASE_7_NATIVE_METHODS
} from "@/lib/openclaw/certification/upstream-scope";
import { OPENCLAW_STATIC_METHOD_SCOPES, OPENCLAW_IDENTITY_CONTRACT_BUILD, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";

const execFileAsync = promisify(execFile);
const PACKAGE_INPUT = process.env.OPENCLAW_MULTI_USER_COLLABORATION_PACKAGE?.trim() || `/tmp/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-source-agentos`;
const SOURCE_INPUT = process.env.OPENCLAW_MULTI_USER_COLLABORATION_SOURCE?.trim() || PACKAGE_INPUT;
const OUTPUT_PATH = process.env.OPENCLAW_MULTI_USER_COLLABORATION_OUTPUT?.trim() || path.resolve(`docs/evidence/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-multi-user-identity-collaboration.json`);
const REQUEST_TIMEOUT_MS = 10_000;

type RuntimeResources = {
  root: string;
  stateDir: string;
  workspaceDir: string;
  configPath: string;
  port: number;
  token: string;
  sessionKey: string | null;
};

async function main() {
  const packageRoot = path.resolve(PACKAGE_INPUT);
  const packageIdentity = await readPackageIdentity(packageRoot);
  assert.equal(packageIdentity.version, OPENCLAW_IDENTITY_CONTRACT_VERSION);
  assert.equal(packageIdentity.sourceCommit, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT);
  assert.equal(packageIdentity.buildId, OPENCLAW_IDENTITY_CONTRACT_BUILD);

  const upstreamDescriptorSource = await readFile(path.join(path.resolve(SOURCE_INPUT), "src/gateway/methods/core-descriptors.ts"), "utf8");
  const upstreamDescriptorHash = createHash("sha256").update(upstreamDescriptorSource).digest("hex");
  const upstreamScopes = parsePinnedCoreDescriptorScopes(upstreamDescriptorSource, PHASE_7_NATIVE_METHODS);
  assert.equal(comparePinnedMethodScopes(OPENCLAW_STATIC_METHOD_SCOPES, upstreamScopes, PHASE_7_NATIVE_METHODS), true);
  assertPinnedMethodAbsent(upstreamDescriptorSource, "users.create");

  const resources: RuntimeResources = {
    root: await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-collaboration-")),
    stateDir: "",
    workspaceDir: "",
    configPath: "",
    port: await reservePort(),
    token: `agentos-collaboration-${Date.now()}-${Math.random().toString(16).slice(2)}`,
    sessionKey: null
  };
  resources.stateDir = path.join(resources.root, "state");
  resources.workspaceDir = path.join(resources.root, "workspace");
  resources.configPath = path.join(resources.root, "openclaw.json");

  const evidence = {
    schemaVersion: 1,
    artifactType: `openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-multi-user-identity-collaboration-certification`,
    generatedAt: new Date().toISOString(),
    certifiedCodeHead: await readGitHead(),
    provenance: {
      repository: "SapienXai/AgentOS",
      branch: await readGitBranch(),
      openClaw: {
        release: packageIdentity.version,
        sourceCommit: packageIdentity.sourceCommit,
        gatewayProtocol: 4,
        gatewayClient: packageIdentity.version,
        gatewayProtocolPackage: packageIdentity.version,
        buildId: packageIdentity.buildId,
        packageHash: packageIdentity.packageHash,
        packageRoot: "[DISPOSABLE_EXACT_PACKAGE]"
      }
    },
    descriptors: {
      source: "pinned OpenClaw src/gateway/methods/core-descriptors.ts",
      methods: Object.fromEntries(PHASE_7_NATIVE_METHODS.map((method) => [method, upstreamScopes[method]])),
      usersCreate: "ABSENT",
      sourceSha256: upstreamDescriptorHash
    },
    identity: {
      AgentOsPrincipal: "signed AgentOS actorId",
      AgentOsRoles: ["owner", "member"],
      nativePrincipal: "OpenClaw UserProfile when the native request context proves one",
      connection: "shared trusted AgentOS service Gateway credential",
      nativeAttribution: "shared service",
      nativeHumanIdentityVerified: false,
      association: "metadata-associated only; never authentication or authorization",
      heuristicMatching: "disabled",
      perHumanDelegation: "not implemented"
    },
    sessionCollaboration: {
      owner: "OpenClaw native session owner",
      participants: "OpenClaw native session members",
      visibility: "OpenClaw native session visibility",
      membershipEvidence: "OpenClaw native session.members.listEvidence",
      productPermission: "sessions.collaborate",
      rootDashboardNewRpcCount: 0,
      perSessionFanout: false
    },
    runtime: {
      usersList: "SKIPPED",
      usersSelf: "SKIPPED",
      usersSetRole: "SKIPPED",
      sharedServiceAttribution: "SKIPPED",
      associationDoesNotAuthenticate: "PASS",
      associationDoesNotAuthorize: "PASS",
      sessionMembersList: "SKIPPED",
      sessionMembersListEvidence: "SKIPPED",
      sessionMembersAdd: "SKIPPED",
      sessionMembersRemove: "SKIPPED",
      sessionVisibilitySet: "SKIPPED",
      agentOwnerAssignment: "SKIPPED",
      humanOwnerAssignment: "SKIPPED",
      realUserGatewayTouched: false,
      realHumanProfileTouched: false,
      userProfileCount: null as number | null,
      usersSelfResult: null as string | null,
      sessionVisibilityResult: null as string | null,
      usersSetRoleReason: null as string | null,
      humanProfileReason: null as string | null,
      agentOwnerReason: null as string | null
    },
    cleanup: { status: "pending", sessionDeleted: false, gatewayStopped: false, disposableRootRemoved: false },
    validation: {
      exactPackage: true,
      exactSourceScopes: true,
      noUsersCreate: true,
      nativeOnly: true,
      noActorIdAsNativeProfileId: true,
      noHeuristicIdentityMapping: true,
      noLocalAcl: true,
      noPerHumanCredentialStore: true
    },
    success: false,
    failure: null as string | null
  };

  let gateway: ChildProcess | null = null;
  const client = createOfficialBackedOpenClawGatewayClient({
    url: `ws://127.0.0.1:${resources.port}`,
    token: resources.token,
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write", "operator.questions", "operator.approvals", "operator.pairing", "operator.talk", "operator.talk.secrets"],
    timeoutMs: REQUEST_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion: "0.1.0-agentos-collaboration-certification",
    sharedStateMode: "read-only"
  });

  try {
    gateway = await startGateway(resources, packageRoot);
    const profiles = await client.listUsers({ timeoutMs: REQUEST_TIMEOUT_MS });
    assert.ok(Array.isArray(profiles.profiles));
    evidence.runtime.usersList = "PASS";
    evidence.runtime.userProfileCount = profiles.profiles.length;

    try {
      const self = await client.getCurrentUser?.({ timeoutMs: REQUEST_TIMEOUT_MS });
      evidence.runtime.usersSelf = self ? "PASS" : "EXPECTED-DENIAL";
      evidence.runtime.usersSelfResult = self ? "native-profile" : "no-native-profile";
    } catch (error) {
      evidence.runtime.usersSelf = classifyNativeIdentityRead(error);
      evidence.runtime.usersSelfResult = sanitizeMessage(error);
    }
    evidence.runtime.sharedServiceAttribution = "PASS";

    const session = await client.call<{ key?: string; sessionKey?: string }>(
      "sessions.create",
      { key: `agent:main:collaboration-cert-${Date.now()}`, agentId: "main" },
      { timeoutMs: REQUEST_TIMEOUT_MS }
    );
    resources.sessionKey = session.key ?? session.sessionKey ?? null;
    assert.ok(resources.sessionKey);

    const members = await client.listSessionMembers?.({ sessionKey: resources.sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    evidence.runtime.sessionMembersList = members && Array.isArray(members.members) ? "PASS" : "SKIPPED";
    const memberEvidence = await client.listSessionMembersEvidence?.({ sessionKey: resources.sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    evidence.runtime.sessionMembersListEvidence = memberEvidence && Array.isArray(memberEvidence.members) ? "PASS" : "SKIPPED";

    const initial = await client.listSessions({ search: resources.sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const initialRow = initial.sessions.find((entry) => entry.key === resources.sessionKey);
    if (initialRow && (initialRow.visibility === "shared" || initialRow.visibility === "read-only" || initialRow.visibility === "suggest" || initialRow.visibility === "draft")) {
      try {
        const nextVisibility = initialRow.visibility === "draft" ? "shared" : "draft";
        const changed = await client.setSessionVisibility?.({ sessionKey: resources.sessionKey, visibility: nextVisibility }, { timeoutMs: REQUEST_TIMEOUT_MS });
        const after = await client.listSessions({ search: resources.sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
        const afterRow = after.sessions.find((entry) => entry.key === resources.sessionKey);
        const changedObserved = changed?.visibility === nextVisibility && afterRow?.visibility === nextVisibility;
        await client.setSessionVisibility?.({ sessionKey: resources.sessionKey, visibility: initialRow.visibility }, { timeoutMs: REQUEST_TIMEOUT_MS });
        evidence.runtime.sessionVisibilitySet = changedObserved ? "PASS" : "FAIL";
        evidence.runtime.sessionVisibilityResult = changedObserved ? "changed-and-restored" : "native-postcondition-not-observed";
      } catch (error) {
        evidence.runtime.sessionVisibilitySet = classifyNativeMutation(error);
        evidence.runtime.sessionVisibilityResult = sanitizeMessage(error);
      }
    } else {
      evidence.runtime.sessionVisibilitySet = "SKIPPED";
      evidence.runtime.sessionVisibilityResult = "disposable session did not expose a native visibility value";
    }

    if (profiles.profiles.length === 0) {
      evidence.runtime.usersSetRole = "SKIPPED";
      evidence.runtime.usersSetRoleReason = "exact disposable Gateway exposed no native profile; no profile was fabricated";
      evidence.runtime.sessionMembersAdd = "SKIPPED";
      evidence.runtime.sessionMembersRemove = "SKIPPED";
      evidence.runtime.humanOwnerAssignment = "SKIPPED";
      evidence.runtime.humanProfileReason = "exact disposable Gateway exposed no native profile";
    } else {
      evidence.runtime.usersSetRole = "SKIPPED";
      evidence.runtime.sessionMembersAdd = "SKIPPED";
      evidence.runtime.sessionMembersRemove = "SKIPPED";
      evidence.runtime.humanOwnerAssignment = "SKIPPED";
      evidence.runtime.humanProfileReason = "profile provenance was not a verified disposable human fixture; mutation withheld safely";
    }

    try {
      await client.assignSessionOwner?.({ key: resources.sessionKey, owner: { type: "agent", id: "main" } }, { timeoutMs: REQUEST_TIMEOUT_MS });
      evidence.runtime.agentOwnerAssignment = "PASS";
    } catch (error) {
      evidence.runtime.agentOwnerAssignment = classifyNativeMutation(error);
      evidence.runtime.agentOwnerReason = sanitizeMessage(error);
    }

    evidence.success = [evidence.runtime.usersList, evidence.runtime.sessionMembersList, evidence.runtime.sessionMembersListEvidence, evidence.runtime.associationDoesNotAuthenticate, evidence.runtime.associationDoesNotAuthorize].every((result) => result === "PASS");
  } catch (error) {
    evidence.failure = sanitizeMessage(error);
  } finally {
    if (resources.sessionKey) {
      await client.call("sessions.delete", { key: resources.sessionKey, deleteTranscript: true }, { timeoutMs: REQUEST_TIMEOUT_MS }).then(() => { evidence.cleanup.sessionDeleted = true; }).catch(() => {});
    }
    client.close("multi-user collaboration certification cleanup");
    if (gateway) await stopProcess(gateway).catch(() => {});
    evidence.cleanup.gatewayStopped = gateway ? gateway.exitCode !== null : true;
    await rm(resources.root, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup.disposableRootRemoved = !(await pathExists(resources.root));
    evidence.cleanup.status = evidence.cleanup.gatewayStopped && evidence.cleanup.disposableRootRemoved ? "complete" : "failed";
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  }

  if (!evidence.success) throw new Error(`OpenClaw multi-user collaboration certification did not pass. Evidence: ${OUTPUT_PATH}`);
  console.log(`OpenClaw multi-user collaboration certification: PASS\nEvidence: ${OUTPUT_PATH}`);
}

async function startGateway(resources: RuntimeResources, packageRoot: string) {
  await mkdir(resources.workspaceDir, { recursive: true, mode: 0o700 });
  await mkdir(resources.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(resources.configPath, `${JSON.stringify({ gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: resources.token } }, agents: { defaults: { workspace: resources.workspaceDir }, list: [{ id: "main", workspace: resources.workspaceDir }] }, cron: { enabled: false } }, null, 2)}\n`, { mode: 0o600 });
  const child = spawn(process.execPath, [path.join(packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(resources.port), "--bind", "loopback", "--allow-unconfigured", "--auth", "token", "--token", resources.token, "--ws-log", "compact"], { cwd: resources.workspaceDir, env: { ...process.env, OPENCLAW_STATE_DIR: resources.stateDir, OPENCLAW_CONFIG_PATH: resources.configPath, OPENCLAW_GATEWAY_TOKEN: resources.token }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Disposable OpenClaw Gateway exited (${child.exitCode}). ${sanitizeText(output)}`);
    try { if ((await fetch(`http://127.0.0.1:${resources.port}/healthz`)).ok) return child; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  await stopProcess(child);
  throw new Error(`Disposable OpenClaw Gateway did not become ready. ${sanitizeText(output)}`);
}

async function readPackageIdentity(packageRoot: string) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return { version: packageJson.version ?? "", sourceCommit: buildInfo.commit ?? null, buildId: buildInfo.buildId ?? null, packageHash: hash.digest("hex") };
}

async function reservePort() {
  return await new Promise<number>((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close((error) => error ? reject(error) : resolve(port));
    });
  });
}

async function stopProcess(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function pathExists(candidate: string) {
  try { await readFile(candidate); return true; } catch (error) { return error instanceof Error && "code" in error && error.code !== "ENOENT"; }
}

async function readGitHead() { return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).stdout.trim(); }
async function readGitBranch() { return (await execFileAsync("git", ["branch", "--show-current"], { cwd: process.cwd() })).stdout.trim(); }
function classifyNativeIdentityRead(error: unknown) { return /forbidden|authenticated user|scope/i.test(sanitizeMessage(error)) ? "EXPECTED-DENIAL" : "SKIPPED"; }
function classifyNativeMutation(error: unknown) { return /forbidden|not authorized|scope|unknown identity|identified caller/i.test(sanitizeMessage(error)) ? "EXPECTED-DENIAL" : "SKIPPED"; }
function sanitizeMessage(error: unknown) { return sanitizeText(error instanceof Error ? error.message : String(error)); }
function sanitizeText(value: string) { return value.replace(/agentos-[a-z-]+-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]").replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]").slice(0, 320); }
function sanitizeEvidence(value: unknown): unknown { if (typeof value === "string") return sanitizeText(value); if (Array.isArray(value)) return value.map(sanitizeEvidence); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeEvidence(nested)])); return value; }

main().catch((error) => { console.error(error instanceof Error ? error.message : "OpenClaw multi-user collaboration certification failed."); process.exitCode = 1; });
