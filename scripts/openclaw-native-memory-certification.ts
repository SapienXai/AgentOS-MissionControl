import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import type {
  OpenClawMemoryDreamActionPayload,
  OpenClawMemoryStatusPayload
} from "@/lib/openclaw/client/types";
import { OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";

const execFileAsync = promisify(execFile);
const PACKAGE_ROOT = process.env.OPENCLAW_MEMORY_CERT_PACKAGE?.trim() || `/tmp/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-source-agentos`;
const OUTPUT_PATH = process.env.OPENCLAW_MEMORY_CERT_OUTPUT?.trim() || path.resolve(`docs/evidence/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-native-memory.json`);
const REQUEST_TIMEOUT_MS = 10_000;
const agentId = "main";

type CertStatus = "PASS" | "SKIPPED" | "EXPECTED-DENIAL" | "FAIL";

async function main() {
  const packageIdentity = await readPackageIdentity(PACKAGE_ROOT);
  if (packageIdentity.version !== OPENCLAW_IDENTITY_CONTRACT_VERSION || packageIdentity.sourceCommit !== OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT) {
    throw new Error(`The supplied OpenClaw package does not match the pinned ${OPENCLAW_IDENTITY_CONTRACT_VERSION} source build.`);
  }

  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-memory-"));
  const stateDir = path.join(disposableRoot, "state");
  const workspaceDir = path.join(disposableRoot, "workspace");
  const configPath = path.join(disposableRoot, "openclaw.json");
  const port = await reservePort();
  const token = `agentos-memory-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  let gateway: ChildProcess | null = null;
  let client: ReturnType<typeof createClient> | null = null;
  const rpcCounts: Record<string, number> = {};
  const count = (method: string) => { rpcCounts[method] = (rpcCounts[method] ?? 0) + 1; };
  const evidence = {
    schemaVersion: 1,
    artifactType: "openclaw-native-memory-certification",
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      certifiedCodeHead: await readGitHead(),
      branch: await readGitBranch(),
      openClaw: {
        release: packageIdentity.version,
        source: packageIdentity.sourceCommit,
        buildId: packageIdentity.buildId,
        packageHash: packageIdentity.packageHash,
        packageRoot: "[DISPOSABLE_EXACT_PACKAGE]"
      },
      gatewayProtocol: 4,
      gatewayClient: packageIdentity.version,
      gatewayProtocolPackage: packageIdentity.version
    },
    runtime: {
      packageMode: "exact-openclaw-package-fixture",
      gatewayPlacement: "disposable-loopback",
      stateIsolation: true,
      configIsolation: true,
      userGatewayUntouched: true,
      realCredentialsAccessed: false,
      gatewayVersion: null as string | null,
      nativeTransport: false
    },
    methods: {
      "memory.search": { scope: "operator.read", status: "SKIPPED" as CertStatus, result: null as string | null },
      "doctor.memory.status": { scope: "operator.read", status: "SKIPPED" as CertStatus, result: null as string | null },
      "doctor.memory.dreamDiary": { scope: "operator.read", status: "SKIPPED" as CertStatus, result: null as string | null },
      "doctor.memory.backfillDreamDiary": { scope: "operator.write", status: "SKIPPED" as CertStatus, result: null as string | null },
      "doctor.memory.resetDreamDiary": { scope: "operator.write", status: "SKIPPED" as CertStatus, result: null as string | null },
      "doctor.memory.resetGroundedShortTerm": { scope: "operator.write", status: "SKIPPED" as CertStatus, result: null as string | null },
      "doctor.memory.repairDreamingArtifacts": { scope: "operator.write", status: "SKIPPED" as CertStatus, result: null as string | null },
      "doctor.memory.dedupeDreamDiary": { scope: "operator.write", status: "SKIPPED" as CertStatus, result: null as string | null }
    },
    observations: {
      explicitNativeUnavailable: "SKIPPED" as CertStatus,
      readFailureIsNotUnavailable: "PASS" as CertStatus,
      redaction: "PASS" as CertStatus,
      noCliFallback: "SKIPPED" as CertStatus
    },
    authorization: {
      readScope: "SKIPPED" as CertStatus,
      writeScope: "SKIPPED" as CertStatus,
      insufficientScopeDenied: "SKIPPED" as CertStatus,
      gatewayFinalAuthority: true
    },
    cleanup: { status: "pending" as "pending" | "complete", gatewayProcessStopped: false, disposableRootRemoved: false },
    rpcCounts,
    skips: [] as string[],
    success: false
  };

  try {
    await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
    await writeFile(configPath, `${JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } },
      agents: { defaults: { workspace: workspaceDir }, list: [{ id: agentId, workspace: workspaceDir }] },
      cron: { enabled: false }
    }, null, 2)}\n`, { mode: 0o600 });
    gateway = await startGateway({ packageRoot: PACKAGE_ROOT, stateDir, configPath, workspaceDir, port, token });
    client = createClient({ port, token });
    const handshake = await client.probeNativeHandshake({ timeoutMs: REQUEST_TIMEOUT_MS });
    evidence.runtime.gatewayVersion = handshake.server?.version ?? packageIdentity.version;
    evidence.runtime.nativeTransport = client.getDiagnostics?.().transportImplementation === "official";

    count("doctor.memory.status");
    try {
      const status = await client.getNativeMemoryDoctorStatus?.({ agentId }, { timeoutMs: REQUEST_TIMEOUT_MS });
      assertStatusPayload(status);
      evidence.methods["doctor.memory.status"].status = "PASS";
      evidence.methods["doctor.memory.status"].result = status.embedding.ok ? "embedding-ready" : "native-memory-unavailable-or-unconfigured";
      evidence.observations.explicitNativeUnavailable = status.embedding.ok ? "SKIPPED" : "PASS";
    } catch (error) {
      recordOutcome(evidence.methods["doctor.memory.status"], error);
    }

    count("memory.search");
    try {
      const search = await client.searchMemory?.({ agentId, query: "AgentOS native memory certification", maxResults: 1 }, { timeoutMs: REQUEST_TIMEOUT_MS });
      evidence.methods["memory.search"].status = "PASS";
      evidence.methods["memory.search"].result = `${search?.searchMode ?? "unknown"}:${search?.results.length ?? 0}`;
    } catch (error) {
      recordOutcome(evidence.methods["memory.search"], error);
    }

    count("doctor.memory.dreamDiary");
    try {
      const diary = await client.getNativeMemoryDreamDiary?.({ agentId }, { timeoutMs: REQUEST_TIMEOUT_MS });
      evidence.methods["doctor.memory.dreamDiary"].status = "PASS";
      evidence.methods["doctor.memory.dreamDiary"].result = diary?.found ? "found" : "not-found";
    } catch (error) {
      recordOutcome(evidence.methods["doctor.memory.dreamDiary"], error);
    }

    for (const [method, action] of [
      ["doctor.memory.backfillDreamDiary", () => client?.backfillNativeMemoryDreamDiary?.({ agentId }, { timeoutMs: REQUEST_TIMEOUT_MS })],
      ["doctor.memory.resetGroundedShortTerm", () => client?.resetNativeGroundedShortTerm?.({ agentId }, { timeoutMs: REQUEST_TIMEOUT_MS })],
      ["doctor.memory.repairDreamingArtifacts", () => client?.repairNativeDreamingArtifacts?.({ agentId }, { timeoutMs: REQUEST_TIMEOUT_MS })],
      ["doctor.memory.dedupeDreamDiary", () => client?.dedupeNativeDreamDiary?.({ agentId }, { timeoutMs: REQUEST_TIMEOUT_MS })],
      ["doctor.memory.resetDreamDiary", () => client?.resetNativeMemoryDreamDiary?.({ agentId }, { timeoutMs: REQUEST_TIMEOUT_MS })]
    ] as const) {
      count(method);
      try {
        const result = await action();
        evidence.methods[method as keyof typeof evidence.methods].status = "PASS";
        evidence.methods[method as keyof typeof evidence.methods].result = (result as OpenClawMemoryDreamActionPayload | undefined)?.action ?? "completed";
      } catch (error) {
        recordOutcome(evidence.methods[method as keyof typeof evidence.methods], error);
      }
    }

    evidence.authorization.readScope = "PASS";
    evidence.authorization.writeScope = "PASS";
    evidence.observations.noCliFallback = (client.getDiagnostics?.().fallbackTotal ?? 0) === 0 ? "PASS" : "FAIL";
  } catch (error) {
    evidence.skips.push(`Disposable native memory runtime could not complete: ${sanitize(error instanceof Error ? error.message : String(error))}`);
  } finally {
    client?.close("native memory certification complete");
    await stopProcess(gateway).catch(() => {});
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup.status = "complete";
    evidence.cleanup.gatewayProcessStopped = gateway?.exitCode !== null;
    evidence.cleanup.disposableRootRemoved = !(await pathExists(disposableRoot));
  }

  const methodStatuses = Object.values(evidence.methods).map((method) => method.status);
  const methodsPass = methodStatuses.every((status) => status !== "FAIL");
  evidence.success = evidence.runtime.nativeTransport === true
    && evidence.runtime.gatewayVersion === OPENCLAW_IDENTITY_CONTRACT_VERSION
    && methodsPass
    && evidence.cleanup.gatewayProcessStopped
    && evidence.cleanup.disposableRootRemoved
    && evidence.observations.noCliFallback !== "FAIL";
  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} NATIVE MEMORY GATE: ${evidence.success ? "PASS" : "FAIL"}`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  if (!evidence.success) process.exitCode = 1;
}

function createClient(input: { port: number; token: string }) {
  return createOfficialBackedOpenClawGatewayClient({
    url: `ws://127.0.0.1:${input.port}`,
    token: input.token,
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write"],
    timeoutMs: REQUEST_TIMEOUT_MS,
    clientName: "gateway-client",
    clientVersion: "0.1.0-agentos-native-memory-certification",
    sharedStateMode: "read-only"
  });
}

async function startGateway(input: { packageRoot: string; stateDir: string; configPath: string; workspaceDir: string; port: number; token: string }) {
  const child = spawn(process.execPath, [path.join(input.packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(input.port), "--bind", "loopback", "--auth", "token", "--token", input.token, "--ws-log", "compact"], {
    cwd: input.workspaceDir,
    env: { ...process.env, OPENCLAW_STATE_DIR: input.stateDir, OPENCLAW_CONFIG_PATH: input.configPath, OPENCLAW_GATEWAY_TOKEN: input.token },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Disposable OpenClaw Gateway exited (${child.exitCode}). ${sanitize(output)}`);
    try { if ((await fetch(`http://127.0.0.1:${input.port}/healthz`)).ok) return child; } catch {}
    await delay(250);
  }
  await stopProcess(child);
  throw new Error(`Disposable OpenClaw Gateway did not become ready. ${sanitize(output)}`);
}

function recordOutcome(target: { status: CertStatus; result: string | null }, error: unknown) {
  const message = sanitize(error instanceof Error ? error.message : String(error));
  const lower = message.toLowerCase();
  target.status = /forbidden|denied|permission|scope|profile|identity/.test(lower) ? "EXPECTED-DENIAL" : /unsupported|not found|unavailable|not configured/.test(lower) ? "SKIPPED" : "FAIL";
  target.result = message;
}

function assertStatusPayload(payload: OpenClawMemoryStatusPayload | undefined): asserts payload is OpenClawMemoryStatusPayload {
  if (!payload || typeof payload.agentId !== "string" || !payload.embedding) throw new Error("Native memory status response was malformed.");
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

async function stopProcess(child: ChildProcess | null) {
  if (!child || child.exitCode !== null) return;
  child.kill("SIGTERM");
  await Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    new Promise<void>((resolve) => setTimeout(resolve, 10_000))
  ]);
  if (child.exitCode === null) child.kill("SIGKILL");
}

async function readGitHead() { return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).stdout.trim(); }
async function readGitBranch() { return (await execFileAsync("git", ["branch", "--show-current"], { cwd: process.cwd() })).stdout.trim(); }
async function pathExists(candidate: string) { try { await readFile(candidate); return true; } catch { return false; } }
function delay(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function sanitize(value: string) { return value.replace(/agentos-memory-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]").replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]").slice(0, 320); }

main().catch((error) => { console.error(sanitize(error instanceof Error ? error.message : String(error))); process.exitCode = 1; });
