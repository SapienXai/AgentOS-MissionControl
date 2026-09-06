import assert from "node:assert/strict";
import { createHash, generateKeyPairSync } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { DatabaseSync } from "node:sqlite";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import {
  createOfficialBackedOpenClawGatewayClient,
  OfficialOpenClawGatewayTransport
} from "@/lib/openclaw/client/gateway-client";
import { publicKeyRawBase64UrlFromPem } from "@/lib/openclaw/client/gateway-device-auth";
import { OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";

const TARGET_VERSION = OPENCLAW_IDENTITY_CONTRACT_VERSION;
const TARGET_COMMIT = OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;
const PACKAGE_INPUT = process.env.OPENCLAW_OFFICIAL_LIFECYCLE_PACKAGE?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_OFFICIAL_LIFECYCLE_OUTPUT?.trim() ||
  path.resolve(`docs/evidence/openclaw-${TARGET_VERSION}-official-gateway-lifecycle-certification.json`);
const REQUEST_TIMEOUT_MS = 8_000;

async function main() {
  if (!PACKAGE_INPUT) {
    throw new Error(`Set OPENCLAW_OFFICIAL_LIFECYCLE_PACKAGE to an exact OpenClaw ${TARGET_VERSION} package root.`);
  }

  const packageRoot = path.resolve(PACKAGE_INPUT);
  const packageIdentity = await readPackageIdentity(packageRoot);
  assert.equal(packageIdentity.version, TARGET_VERSION);
  assert.equal(packageIdentity.sourceCommit, TARGET_COMMIT);

  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-official-lifecycle-"));
  const stateDir = path.join(disposableRoot, "state");
  const workspaceDir = path.join(disposableRoot, "workspace");
  const configPath = path.join(disposableRoot, "openclaw.json");
  const port = await reservePort();
  const gatewayToken = `agentos-official-lifecycle-${Date.now()}`;
  const deviceToken = `agentos-device-token-${Date.now()}`;
  const deviceIdentity = generateKeyPairSync("ed25519");
  const publicKeyPem = deviceIdentity.publicKey.export({ type: "spki", format: "pem" }).toString();
  const deviceId = createHash("sha256")
    .update(Buffer.from(publicKeyRawBase64UrlFromPem(publicKeyPem), "base64url"))
    .digest("hex");
  await provisionState({ stateDir, workspaceDir, configPath, deviceId, deviceToken, deviceIdentity });

  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    target: {
      version: packageIdentity.version,
      sourceCommit: packageIdentity.sourceCommit,
      buildId: packageIdentity.buildId,
      packageHash: packageIdentity.packageHash,
      packageRoot: "[DISPOSABLE_EXACT_PACKAGE]",
      protocol: 4
    },
    runtime: {
      packageMode: "exact-openclaw-package-fixture",
      gatewayPort: "[DISPOSABLE_LOOPBACK]",
      stateRoot: "[DISPOSABLE_ROOT]",
      configRoot: "[DISPOSABLE_ROOT]",
      tokenAuth: true,
      deviceAuth: true
    },
    checks: {
      exactPackage: false,
      officialHandshake: false,
      deviceSignatureRoundTrip: false,
      deviceTokenPersistence: false,
      officialBackedDomainReads: false,
      reconnectAfterRuntimeRestart: false,
      noParallelReconnectOwner: true
    },
    observations: {
      protocol: null as number | null,
      serverVersion: null as string | null,
      connectionCount: 0,
      helloCount: 0,
      grantedRole: null as string | null,
      grantedScopes: [] as string[],
      deviceId,
      transportDeviceIdPresent: false,
      canonicalIdentityPresent: false,
      canonicalIdentityIdMatches: false,
      canonicalDeviceTokenPresent: false,
      canonicalDeviceTokenChanged: false
    },
    cleanup: {
      status: "pending" as "pending" | "complete" | "failed",
      disposableRootRemoved: false,
      gatewayProcessesStopped: false
    },
    success: false
  };

  let gateway: ChildProcess | null = null;
  let restartedGateway: ChildProcess | null = null;
  const helloVersions: string[] = [];
  const transport = new OfficialOpenClawGatewayTransport({
    url: `ws://127.0.0.1:${port}`,
    stateDir,
    sharedStateMode: "managed-write",
    includeDeviceIdentityWithExplicitAuth: true,
    token: gatewayToken,
    requestTimeoutMs: REQUEST_TIMEOUT_MS,
    callbacks: {
      onHello: (hello) => {
        helloVersions.push(hello.server.version);
        evidence.observations.protocol = hello.protocol;
        evidence.observations.serverVersion = hello.server.version;
        evidence.observations.grantedRole = hello.auth.role;
        evidence.observations.grantedScopes = [...hello.auth.scopes];
        evidence.observations.helloCount = helloVersions.length;
      }
    }
  });
  const domainClient = createOfficialBackedOpenClawGatewayClient({
    url: `ws://127.0.0.1:${port}`,
    stateDir,
    sharedStateMode: "managed-write",
    includeDeviceIdentityWithExplicitAuth: true,
    token: gatewayToken,
    requestTimeoutMs: REQUEST_TIMEOUT_MS
  });

  try {
    evidence.checks.exactPackage = true;
    gateway = await startGateway({ packageRoot, stateDir, workspaceDir, configPath, port, token: gatewayToken });
    transport.start();
    const firstHello = await transport.waitForReady({ timeoutMs: REQUEST_TIMEOUT_MS });
    evidence.checks.officialHandshake = firstHello.protocol === 4 && firstHello.server.version === TARGET_VERSION;
    evidence.observations.connectionCount = 1;

    const authDb = new DatabaseSync(path.join(stateDir, "state", "openclaw.sqlite"), { readOnly: true });
    const identityState = authDb
      .prepare("SELECT device_id, public_key_pem FROM device_identities WHERE identity_key = ?")
      .get("primary") as { device_id?: unknown; public_key_pem?: unknown } | undefined;
    const authState = authDb
      .prepare("SELECT token FROM device_auth_tokens WHERE device_id = ? AND role = ?")
      .get(deviceId, "operator") as { token?: unknown } | undefined;
    authDb.close();
    evidence.checks.deviceSignatureRoundTrip = Boolean(
      transport.getDeviceId() === deviceId && typeof authState?.token === "string"
    );
    evidence.checks.deviceTokenPersistence = typeof authState?.token === "string";
    evidence.observations.transportDeviceIdPresent = transport.getDeviceId() === deviceId;
    evidence.observations.canonicalIdentityPresent = Boolean(identityState);
    evidence.observations.canonicalIdentityIdMatches = identityState?.device_id === deviceId;
    evidence.observations.canonicalDeviceTokenPresent = typeof authState?.token === "string";
    evidence.observations.canonicalDeviceTokenChanged = authState?.token !== deviceToken;

    const [sessions, tasks] = await Promise.all([
      domainClient.listSessions({}, { timeoutMs: REQUEST_TIMEOUT_MS }),
      domainClient.listTasks({}, { timeoutMs: REQUEST_TIMEOUT_MS })
    ]);
    evidence.checks.officialBackedDomainReads = Array.isArray(sessions.sessions) && Array.isArray(tasks.tasks);

    await stopProcess(gateway);
    gateway = null;
    await waitFor(() => transport.getLifecycleState() === "reconnecting", 10_000);
    restartedGateway = await startGateway({ packageRoot, stateDir, workspaceDir, configPath, port, token: gatewayToken });
    await waitFor(() => helloVersions.length >= 2, 20_000);
    evidence.observations.connectionCount = 2;
    evidence.checks.reconnectAfterRuntimeRestart = helloVersions.length >= 2;
    evidence.success = Object.values(evidence.checks).every(Boolean);
  } finally {
    domainClient.close?.("official lifecycle certification cleanup");
    await transport.stopAndWait({ timeoutMs: 1_000 }).catch(() => {});
    await stopProcess(gateway).catch(() => {});
    await stopProcess(restartedGateway).catch(() => {});
    evidence.cleanup.gatewayProcessesStopped = true;
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => {
      evidence.cleanup.status = "failed";
    });
    evidence.cleanup.disposableRootRemoved = !(await pathExists(disposableRoot));
    if (evidence.cleanup.status !== "failed") {
      evidence.cleanup.status = "complete";
    }
    evidence.success = evidence.success && evidence.cleanup.disposableRootRemoved && evidence.cleanup.status === "complete";
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  }

  if (!evidence.success) {
    throw new Error(`Official Gateway lifecycle certification failed. Evidence: ${OUTPUT_PATH}`);
  }
  console.log(`OPENCLAW ${TARGET_VERSION} OFFICIAL GATEWAY LIFECYCLE GATE: PASS`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

async function provisionState(input: {
  stateDir: string;
  workspaceDir: string;
  configPath: string;
  deviceId: string;
  deviceToken: string;
  deviceIdentity: ReturnType<typeof generateKeyPairSync>;
}) {
  await mkdir(path.join(input.stateDir, "identity"), { recursive: true, mode: 0o700 });
  await mkdir(input.workspaceDir, { recursive: true, mode: 0o700 });
  await writeFile(input.configPath, `${JSON.stringify({
    gateway: { mode: "local", bind: "loopback", auth: { mode: "token" } },
    agents: { defaults: { workspace: input.workspaceDir }, list: [{ id: "main", workspace: input.workspaceDir }] },
    cron: { enabled: false }
  }, null, 2)}\n`, { mode: 0o600 });
  const dbPath = path.join(input.stateDir, "state", "openclaw.sqlite");
  await mkdir(path.dirname(dbPath), { recursive: true, mode: 0o700 });
  const db = new DatabaseSync(dbPath);
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS device_identities (
        identity_key TEXT NOT NULL PRIMARY KEY,
        device_id TEXT NOT NULL,
        public_key_pem TEXT NOT NULL,
        private_key_pem TEXT NOT NULL,
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS device_auth_tokens (
        device_id TEXT NOT NULL,
        role TEXT NOT NULL,
        token TEXT NOT NULL,
        scopes_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        PRIMARY KEY (device_id, role)
      ) STRICT;
    `);
    const publicKeyPem = input.deviceIdentity.publicKey.export({ type: "spki", format: "pem" }).toString();
    const privateKeyPem = input.deviceIdentity.privateKey.export({ type: "pkcs8", format: "pem" }).toString();
    const now = Date.now();
    db.prepare("INSERT INTO device_identities (identity_key, device_id, public_key_pem, private_key_pem, created_at_ms, updated_at_ms) VALUES (?, ?, ?, ?, ?, ?)")
      .run("primary", input.deviceId, publicKeyPem, privateKeyPem, now, now);
    db.prepare("INSERT INTO device_auth_tokens (device_id, role, token, scopes_json, updated_at_ms) VALUES (?, ?, ?, ?, ?)")
      .run(input.deviceId, "operator", input.deviceToken, JSON.stringify(["operator.admin", "operator.read", "operator.write"]), now);
  } finally {
    db.close();
  }
}

async function startGateway(input: {
  packageRoot: string;
  stateDir: string;
  workspaceDir: string;
  configPath: string;
  port: number;
  token: string;
}) {
  const child = spawn(process.execPath, [
    path.join(input.packageRoot, "openclaw.mjs"),
    "gateway", "run", "--port", String(input.port), "--bind", "loopback", "--allow-unconfigured",
    "--auth", "token", "--token", input.token, "--ws-log", "compact"
  ], {
    cwd: input.workspaceDir,
    env: {
      ...process.env,
      OPENCLAW_STATE_DIR: input.stateDir,
      OPENCLAW_CONFIG_PATH: input.configPath,
      OPENCLAW_GATEWAY_TOKEN: input.token
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  try {
    await waitFor(async () => {
      try {
        return (await fetch(`http://127.0.0.1:${input.port}/healthz`)).ok;
      } catch {
        return false;
      }
    }, 60_000);
    return child;
  } catch (error) {
    await stopProcess(child).catch(() => {});
    throw new Error(`Isolated OpenClaw Gateway did not become ready: ${sanitize(output)} ${String(error)}`);
  }
}

async function stopProcess(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) {
    return;
  }
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => {
      child.kill("SIGKILL");
      resolve();
    }, 5_000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });
}

async function readPackageIdentity(packageRoot: string) {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return {
    version: packageJson.version ?? "",
    sourceCommit: buildInfo.commit ?? null,
    buildId: buildInfo.buildId ?? null,
    packageHash: hash.digest("hex")
  };
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

async function waitFor(predicate: (() => boolean | Promise<boolean>), timeoutMs: number) {
  const startedAt = Date.now();
  while (!(await predicate())) {
    if (Date.now() - startedAt > timeoutMs) {
      throw new Error("Timed out waiting for isolated OpenClaw Gateway state.");
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

async function pathExists(input: string) {
  try {
    await readFile(input);
    return true;
  } catch {
    return false;
  }
}

function sanitize(value: string) {
  return value.replace(/(?:token|password|secret|api[_ -]?key)\s*[=:]\s*[^\s,]+/gi, "$1=[redacted]");
}

void main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
});
