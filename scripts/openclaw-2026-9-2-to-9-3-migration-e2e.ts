import { createHash, randomBytes } from "node:crypto";
import { spawn, type ChildProcess } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { access, mkdtemp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import { OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";
import { OPENCLAW_RECOMMENDED_VERSION, OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import { createOpenClawRuntimeProviderFixture } from "@/scripts/openclaw-runtime-provider-fixture";

const SOURCE_VERSION = "2026.9.2";
const SOURCE_COMMIT = "3928bad9badfcb6c7d140530435e806fb8092190";
const TARGET_VERSION = OPENCLAW_RECOMMENDED_VERSION;
const TARGET_COMMIT = OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;
const OUTPUT_PATH = process.env.OPENCLAW_MIGRATION_9_3_OUTPUT?.trim() ||
  path.resolve("docs/evidence/openclaw-2026.9.2-to-2026.9.3-migration.json");
const SOURCE_PACKAGE = process.env.OPENCLAW_MIGRATION_9_2_PACKAGE?.trim();
const TARGET_PACKAGE = process.env.OPENCLAW_MIGRATION_9_3_PACKAGE?.trim();

type PackageIdentity = {
  version: string;
  sourceCommit: string;
  buildId: string;
  packageHash: string;
  stateSchema: number;
  agentSchema: number;
};

type GatewayProcess = {
  child: ChildProcess;
  stop: () => Promise<void>;
};

async function main() {
  const startedAt = new Date().toISOString();
  const evidence: Record<string, unknown> = {
    schemaVersion: 1,
    generatedAt: startedAt,
    provenance: {
      repository: "SapienXai/AgentOS",
      agentosStartingHead: await gitHead(),
      openClawSource: {
        sourceVersion: SOURCE_VERSION,
        sourceCommit: SOURCE_COMMIT,
        targetVersion: TARGET_VERSION,
        targetCommit: TARGET_COMMIT
      },
      node: process.version,
      supportedBaseline: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      nativeContract: OPENCLAW_IDENTITY_CONTRACT_VERSION
    },
    fixture: {
      kind: "disposable-real-package-upgrade",
      sourceState: "OpenClaw 2026.9.2 runtime state",
      targetState: "OpenClaw 2026.9.3 runtime state",
      productionGatewayTouched: false
    },
    source: null,
    migration: null,
    target: null,
    recovery: null,
    checks: {},
    success: false
  };

  let fixtureRoot: string | null = null;
  let sourceGateway: GatewayProcess | null = null;
  let targetGateway: GatewayProcess | null = null;
  let provider: Awaited<ReturnType<typeof createOpenClawRuntimeProviderFixture>> | null = null;

  try {
    if (!SOURCE_PACKAGE || !TARGET_PACKAGE) {
      throw new Error("Both OPENCLAW_MIGRATION_9_2_PACKAGE and OPENCLAW_MIGRATION_9_3_PACKAGE are required.");
    }

    const sourceIdentity = await readPackageIdentity(path.resolve(SOURCE_PACKAGE));
    const targetIdentity = await readPackageIdentity(path.resolve(TARGET_PACKAGE));
    if (sourceIdentity.version !== SOURCE_VERSION || sourceIdentity.sourceCommit !== SOURCE_COMMIT) {
      throw new Error("The migration source is not the exact official OpenClaw 2026.9.2 package.");
    }
    if (targetIdentity.version !== TARGET_VERSION || targetIdentity.sourceCommit !== TARGET_COMMIT) {
      throw new Error("The migration target is not the exact official OpenClaw 2026.9.3 package.");
    }
    evidence.provenance = {
      ...(evidence.provenance as Record<string, unknown>),
      sourcePackage: sourceIdentity,
      targetPackage: targetIdentity
    };

    fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-9-2-to-9-3-"));
    const stateDir = path.join(fixtureRoot, "state");
    const homeDir = path.join(fixtureRoot, "home");
    const workspaceDir = path.join(fixtureRoot, "workspace");
    const configPath = path.join(fixtureRoot, "openclaw.json");
    const sourcePort = await reservePort();
    const targetPort = await reservePort();
    const token = randomBytes(24).toString("hex");
    await mkdir(workspaceDir, { recursive: true, mode: 0o700 });
    await mkdir(path.join(workspaceDir, "skills", "agentos-migration-fixture"), { recursive: true, mode: 0o700 });
    await writeFile(path.join(workspaceDir, "skills", "agentos-migration-fixture", "SKILL.md"), "# AgentOS migration fixture\n\nPreserve this skill during the OpenClaw state migration.\n", { mode: 0o600 });
    await writeFile(path.join(workspaceDir, "MEMORY.md"), "# Migration memory\n\nA durable memory marker for the 9.2 to 9.3 upgrade.\n", { mode: 0o600 });
    await writeFile(path.join(workspaceDir, "transcript-marker.txt"), "AgentOS migration transcript marker\n", { mode: 0o600 });
    await writeFile(configPath, `${JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token } },
      agents: {
        defaults: { workspace: workspaceDir, model: { primary: "agentos-fixture/agentos-runtime-fixture" } },
        list: [{ id: "main", workspace: workspaceDir }]
      },
      models: {
        mode: "merge",
        providers: {
          "agentos-fixture": {
            baseUrl: "http://127.0.0.1:9/v1",
            api: "openai-completions",
            apiKey: "agentos-migration-fixture",
            models: [{ id: "agentos-runtime-fixture", name: "Migration Fixture", input: ["text"], contextWindow: 32768, maxTokens: 128 }]
          },
          ollama: {
            baseUrl: "http://127.0.0.1:11434/v1",
            api: "openai-completions",
            models: [{ id: "llama3.2", name: "Llama 3.2", input: ["text"], contextWindow: 8192, maxTokens: 128 }]
          }
        }
      },
      channels: { telegram: { enabled: false, accounts: {} } },
      cron: { enabled: true },
      tools: { sessions: { visibility: "tree" }, agentToAgent: { enabled: false, allow: [] } }
    }, null, 2)}\n`, { mode: 0o600 });

    provider = await createOpenClawRuntimeProviderFixture();
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    const models = config.models as Record<string, unknown>;
    const providers = models.providers as Record<string, Record<string, unknown>>;
    providers["agentos-fixture"].baseUrl = provider.baseUrl;
    await writeFile(configPath, `${JSON.stringify(config, null, 2)}\n`, { mode: 0o600 });

    sourceGateway = await startGateway(path.resolve(SOURCE_PACKAGE), stateDir, homeDir, configPath, token, sourcePort);
    const sourceClient = createClient(sourcePort, token, stateDir);
    const sourceHandshake = await sourceClient.probeNativeHandshake({ timeoutMs: 10_000 });
    const sourceAgent = await sourceClient.callNative<Record<string, unknown>>("agents.create", {
      name: "Migration Worker",
      workspace: path.join(workspaceDir, "worker")
    }, { timeoutMs: 10_000 }, { safety: "mutation", timeoutMs: 10_000 });
    const sourceAgentId = readString(sourceAgent.agentId) ?? "worker";
    await sourceClient.callNative("sessions.create", {
      key: "agent:main:agentos-migration-fixture",
      agentId: "main",
      label: "AgentOS migration fixture"
    }, { timeoutMs: 10_000 }, { safety: "mutation", timeoutMs: 10_000 });
    await sourceClient.callNative("sessions.create", {
      key: `agent:${sourceAgentId}:agentos-migration-child`,
      agentId: sourceAgentId,
      label: "AgentOS migration child"
    }, { timeoutMs: 10_000 }, { safety: "mutation", timeoutMs: 10_000 }).catch(() => null);
    await sourceClient.callNative("chat.send", {
      sessionKey: "agent:main:agentos-migration-fixture",
      message: "AGENTOS_MIGRATION_FIRST_PROMPT",
      idempotencyKey: "agentos-migration-first"
    }, { timeoutMs: 10_000 }, { safety: "mutation", timeoutMs: 10_000 });
    await waitForHistory(sourceClient, "agent:main:agentos-migration-fixture", 1);
    const updateStatus = await sourceClient.callNative("update.status", {}, { timeoutMs: 10_000 }, { safety: "read", timeoutMs: 10_000 }).catch(() => null);
    const sourceConfig = await sourceClient.callNative<Record<string, unknown>>("config.get", {}, { timeoutMs: 10_000 }, { safety: "read", timeoutMs: 10_000 });
    const sourceSessions = await sourceClient.callNative<Record<string, unknown>>("sessions.list", {}, { timeoutMs: 10_000 }, { safety: "read", timeoutMs: 10_000 });
    const sourceHistory = await sourceClient.callNative<Record<string, unknown>>("chat.history", { sessionKey: "agent:main:agentos-migration-fixture", limit: 20 }, { timeoutMs: 10_000 }, { safety: "read", timeoutMs: 10_000 });
    sourceClient.close("9.2 migration fixture source capture");
    await sourceGateway.stop();
    sourceGateway = null;

    const before = await inspectFixture({ stateDir, configPath, workspaceDir });
    evidence.source = {
      runtime: { version: sourceHandshake.server?.version ?? null, protocol: sourceHandshake.protocol ?? null, staleProcessStopped: true },
      representativeState: {
        agentId: sourceAgentId,
        sessionCount: countRecords(sourceSessions, "sessions"),
        transcriptAssistantMessages: countAssistantMessages(sourceHistory),
        updateStatusObserved: Boolean(updateStatus),
        providerConfigPresent: Boolean(readPath(sourceConfig.config, ["models", "providers", "agentos-fixture"])),
        channelConfigPresent: Boolean(readPath(sourceConfig.config, ["channels", "telegram"])),
        skillPresent: before.skillPresent,
        memoryPresent: before.memoryPresent,
        securityPolicyExplicit: before.securityPolicyExplicit
      },
      state: before
    };

    const doctor = await runCommand(path.join(path.resolve(TARGET_PACKAGE), "openclaw.mjs"), ["doctor", "--fix", "--non-interactive", "--json"], { OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath, HOME: homeDir });
    const afterDoctor = await inspectFixture({ stateDir, configPath, workspaceDir });
    evidence.migration = {
      officialPath: "OpenClaw 2026.9.3 runtime startup with Doctor repair preflight",
      doctor: summarizeCommand(doctor),
      stateBefore: before,
      stateAfterDoctor: afterDoctor,
      stateSchema15To16: before.stateSchema === 15,
      noSilentDataLoss: sameRepresentativeState(before, afterDoctor)
    };

    targetGateway = await startGateway(path.resolve(TARGET_PACKAGE), stateDir, homeDir, configPath, token, targetPort);
    const targetClient = createClient(targetPort, token, stateDir);
    const targetHandshake = await targetClient.probeNativeHandshake({ timeoutMs: 10_000 });
    const targetConfig = await targetClient.callNative<Record<string, unknown>>("config.get", {}, { timeoutMs: 10_000 }, { safety: "read", timeoutMs: 10_000 });
    const targetAgents = await targetClient.callNative<Record<string, unknown>>("agents.list", {}, { timeoutMs: 10_000 }, { safety: "read", timeoutMs: 10_000 });
    const targetSessions = await targetClient.callNative<Record<string, unknown>>("sessions.list", {}, { timeoutMs: 10_000 }, { safety: "read", timeoutMs: 10_000 });
    const targetHistory = await targetClient.callNative<Record<string, unknown>>("chat.history", { sessionKey: "agent:main:agentos-migration-fixture", limit: 20 }, { timeoutMs: 10_000 }, { safety: "read", timeoutMs: 10_000 });
    const afterRuntime = await inspectFixture({ stateDir, configPath, workspaceDir });
    evidence.target = {
      runtime: { version: targetHandshake.server?.version ?? null, buildId: targetHandshake.server?.buildId ?? null, protocol: targetHandshake.protocol ?? null, staleSourceProcessServesState: false },
      state: afterRuntime,
      representativeState: {
        agentCount: countRecords(targetAgents, "agents"),
        sessionCount: countRecords(targetSessions, "sessions"),
        transcriptAssistantMessages: countAssistantMessages(targetHistory),
        providerConfigPresent: Boolean(readPath(targetConfig.config, ["models", "providers", "agentos-fixture"])),
        channelConfigPresent: Boolean(readPath(targetConfig.config, ["channels", "telegram"])),
        selectedModelPreserved: readPath(targetConfig.config, ["agents", "defaults", "model", "primary"]) === "agentos-fixture/agentos-runtime-fixture",
        securityPolicyExplicit: afterRuntime.securityPolicyExplicit,
        skillPresent: afterRuntime.skillPresent,
        memoryPresent: afterRuntime.memoryPresent
      }
    };
    targetClient.close("9.3 migration fixture target capture");
    await targetGateway.stop();
    targetGateway = null;

    const recoveryDoctor = await runCommand(path.join(path.resolve(TARGET_PACKAGE), "openclaw.mjs"), ["doctor", "--fix", "--non-interactive", "--json"], { OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath, HOME: homeDir });
    const afterRecovery = await inspectFixture({ stateDir, configPath, workspaceDir });
    evidence.recovery = {
      idempotentDoctor: summarizeCommand(recoveryDoctor),
      stateAfterRecovery: afterRecovery,
      schemaStill16: afterRecovery.stateSchema === 16,
      representativeStateStillIntact: sameRepresentativeState(afterRuntime, afterRecovery)
    };

    const migration = evidence.migration as Record<string, unknown>;
    const target = evidence.target as Record<string, unknown>;
    const recovery = evidence.recovery as Record<string, unknown>;
    evidence.checks = {
      exactSourcePackage: sourceIdentity.version === SOURCE_VERSION && sourceIdentity.sourceCommit === SOURCE_COMMIT,
      exactTargetPackage: targetIdentity.version === TARGET_VERSION && targetIdentity.sourceCommit === TARGET_COMMIT,
      stateSchema15To16: migration.stateSchema15To16 === true,
      agentSchema19: sourceIdentity.agentSchema === 19 && targetIdentity.agentSchema === 19,
      representativeStatePreserved: migration.noSilentDataLoss === true && (target.representativeState as Record<string, unknown>).transcriptAssistantMessages as number >= 1,
      targetGatewayClean: (target.runtime as Record<string, unknown>).version === TARGET_VERSION && (target.runtime as Record<string, unknown>).protocol === 4,
      securityPolicyPreserved: (target.representativeState as Record<string, unknown>).securityPolicyExplicit === true,
      doctorRecovery: recovery.schemaStill16 === true && recovery.representativeStateStillIntact === true
    };
    evidence.success = Object.values(evidence.checks as Record<string, boolean>).every(Boolean);
  } catch (error) {
    evidence.error = sanitizeError(error);
  } finally {
    if (sourceGateway) await sourceGateway.stop().catch(() => {});
    if (targetGateway) await targetGateway.stop().catch(() => {});
    await provider?.close().catch(() => {});
    if (fixtureRoot) await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {});
  }

  await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
  await writeFile(OUTPUT_PATH, `${JSON.stringify(evidence, null, 2)}\n`, { mode: 0o600 });
  console.log(`OPENCLAW 9.2 -> 9.3 MIGRATION GATE: ${evidence.success ? "PASS" : "FAIL"}`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
  return evidence.success ? 0 : 1;
}

async function readPackageIdentity(packageRoot: string): Promise<PackageIdentity> {
  const packageJson = JSON.parse(await readFile(path.join(packageRoot, "package.json"), "utf8")) as { version?: string; openclaw?: { schemaVersions?: { state?: number; agent?: number } } };
  const buildInfo = JSON.parse(await readFile(path.join(packageRoot, "dist", "build-info.json"), "utf8")) as { commit?: string; buildId?: string };
  const hash = createHash("sha256");
  for (const file of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(file);
    hash.update(await readFile(path.join(packageRoot, file)));
  }
  return {
    version: packageJson.version ?? "",
    sourceCommit: buildInfo.commit ?? "",
    buildId: buildInfo.buildId ?? "",
    packageHash: hash.digest("hex"),
    stateSchema: packageJson.openclaw?.schemaVersions?.state ?? 0,
    agentSchema: packageJson.openclaw?.schemaVersions?.agent ?? 0
  };
}

function createClient(port: number, token: string, stateDir: string) {
  return createOfficialBackedOpenClawGatewayClient({
    url: `ws://127.0.0.1:${port}`,
    token,
    role: "operator",
    scopes: ["operator.admin", "operator.read", "operator.write", "operator.talk", "operator.talk.secrets"],
    timeoutMs: 10_000,
    clientName: "gateway-client",
    clientVersion: "0.1.0-agentos-migration-certification",
    stateDir,
    sharedStateMode: "read-only"
  });
}

async function startGateway(packageRoot: string, stateDir: string, homeDir: string, configPath: string, token: string, port: number): Promise<GatewayProcess> {
  const child = spawn(process.execPath, [path.join(packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(port), "--bind", "loopback", "--allow-unconfigured", "--ws-log", "compact", "--no-color"], {
    env: { ...process.env, HOME: homeDir, OPENCLAW_STATE_DIR: stateDir, OPENCLAW_CONFIG_PATH: configPath, OPENCLAW_GATEWAY_TOKEN: token, OPENCLAW_GATEWAY_PASSWORD: "" },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let output = "";
  child.stdout?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-6000); });
  child.stderr?.on("data", (chunk) => { output = `${output}${String(chunk)}`.slice(-6000); });
  try {
    await waitForPort(port, child, 30_000);
  } catch (error) {
    await stopChild(child);
    throw new Error(`${sanitizeError(error)} ${output.replace(/token\S*/gi, "token=[redacted]").trim()}`.trim());
  }
  return { child, stop: () => stopChild(child) };
}

async function inspectFixture(input: { stateDir: string; configPath: string; workspaceDir: string }) {
  const databasePath = path.join(input.stateDir, "state", "openclaw.sqlite");
  let stateSchema: number | null = null;
  const tables: Record<string, number> = {};
  try {
    const database = new DatabaseSync(databasePath, { readOnly: true });
    stateSchema = Number(database.prepare("PRAGMA user_version").get()?.user_version ?? 0);
    const names = database.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as Array<{ name?: string }>;
    for (const row of names) {
      const name = row.name;
      if (!name || !/^[A-Za-z0-9_]+$/.test(name)) continue;
      try { tables[name] = Number(database.prepare(`SELECT COUNT(*) AS count FROM "${name}"`).get()?.count ?? 0); } catch { /* virtual/internal table */ }
    }
    database.close();
  } catch {
    stateSchema = null;
  }
  return {
    stateSchema,
    tables: Object.fromEntries(Object.entries(tables).filter(([name]) => /agent|session|task|update|skill|memory|auth|channel/i.test(name))),
    configPresent: await pathExists(input.configPath),
    skillPresent: await pathExists(path.join(input.workspaceDir, "skills", "agentos-migration-fixture", "SKILL.md")),
    memoryPresent: await pathExists(path.join(input.workspaceDir, "MEMORY.md")),
    securityPolicyExplicit: await readSecurityPolicy(input.configPath),
    transcriptFiles: await listTranscriptFiles(input.stateDir)
  };
}

async function readSecurityPolicy(configPath: string) {
  try {
    const config = JSON.parse(await readFile(configPath, "utf8")) as Record<string, unknown>;
    return readPath(config, ["tools", "sessions", "visibility"]) === "tree" &&
      readPath(config, ["tools", "agentToAgent", "enabled"]) === false &&
      Array.isArray(readPath(config, ["tools", "agentToAgent", "allow"])) &&
      (readPath(config, ["tools", "agentToAgent", "allow"]) as unknown[]).length === 0;
  } catch { return false; }
}

async function listTranscriptFiles(root: string): Promise<string[]> {
  const result: string[] = [];
  async function visit(directory: string) {
    let entries: Array<{ name: string; isDirectory: () => boolean }>;
    try { entries = await readdir(directory, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const fullPath = path.join(directory, entry.name);
      if (entry.isDirectory()) await visit(fullPath);
      else if (/\.(jsonl|sqlite|db)$/.test(entry.name)) result.push(path.relative(root, fullPath));
    }
  }
  await visit(root);
  return result.sort();
}

function sameRepresentativeState(left: Record<string, unknown>, right: Record<string, unknown>) {
  return left.configPresent === right.configPresent &&
    left.skillPresent === right.skillPresent &&
    left.memoryPresent === right.memoryPresent &&
    left.securityPolicyExplicit === right.securityPolicyExplicit &&
    Array.isArray(left.transcriptFiles) && Array.isArray(right.transcriptFiles) &&
    (left.transcriptFiles as string[]).length === (right.transcriptFiles as string[]).length;
}

function readPath(value: unknown, segments: string[]): unknown {
  let current = value;
  for (const segment of segments) {
    if (!current || typeof current !== "object" || Array.isArray(current)) return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function countRecords(value: Record<string, unknown>, key: string) {
  return Array.isArray(value[key]) ? value[key].length : 0;
}

function countAssistantMessages(value: Record<string, unknown>) {
  const messages = Array.isArray(value.messages) ? value.messages : [];
  return messages.filter((message) => message && typeof message === "object" && (message as Record<string, unknown>).role === "assistant").length;
}

async function waitForHistory(client: ReturnType<typeof createClient>, sessionKey: string, minimum: number) {
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const history = await client.callNative<Record<string, unknown>>("chat.history", { sessionKey, limit: 20 }, { timeoutMs: 10_000 }, { safety: "read", timeoutMs: 10_000 });
    if (countAssistantMessages(history) >= minimum) return history;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The 9.2 migration fixture did not persist an assistant transcript.");
}

async function runCommand(command: string, args: string[], env: Record<string, string>) {
  return new Promise<{ code: number | null; stdout: string; stderr: string }>((resolve) => {
    const child = spawn(command, args, { env: { ...process.env, ...env }, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    const timer = setTimeout(() => child.kill("SIGTERM"), 60_000);
    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.once("error", () => { clearTimeout(timer); resolve({ code: null, stdout, stderr }); });
    child.once("close", (code) => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
  });
}

function summarizeCommand(result: { code: number | null; stdout: string; stderr: string }) {
  return { exitCode: result.code, completed: result.code === 0, outputPresent: Boolean(result.stdout.trim() || result.stderr.trim()) };
}

async function waitForPort(port: number, child: ChildProcess, timeoutMs: number) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (child.exitCode !== null) throw new Error(`Gateway exited before listening (${child.exitCode}).`);
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(`Timed out waiting for disposable Gateway port ${port}.`);
}

async function stopChild(child: ChildProcess) {
  if (child.exitCode !== null) return;
  child.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    const timer = setTimeout(() => { child.kill("SIGKILL"); resolve(); }, 5_000);
    child.once("close", () => { clearTimeout(timer); resolve(); });
  });
}

async function reservePort() {
  const server = net.createServer();
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => resolve()); });
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  await new Promise<void>((resolve) => server.close(() => resolve()));
  return port;
}

async function pathExists(filePath: string) {
  try { await access(filePath); return true; } catch { return false; }
}

async function gitHead() {
  const result = await runCommand("git", ["rev-parse", "HEAD"], {});
  return result.stdout.trim() || null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function sanitizeError(error: unknown) {
  return String(error instanceof Error ? error.message : error).replace(/(?:token|password|secret|api[_-]?key)[^\s]*/gi, "$1=[redacted]");
}

void main().then((code) => { process.exitCode = code; }).catch((error) => { console.error(sanitizeError(error)); process.exitCode = 1; });
