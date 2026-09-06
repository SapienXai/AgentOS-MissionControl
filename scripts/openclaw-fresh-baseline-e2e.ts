import { createHash, randomBytes } from "node:crypto";
import { execFile, spawn } from "node:child_process";
import { cp, mkdtemp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

import { getOpenClawInstallCommand } from "@/lib/openclaw/install";
import { redactGatewayUrl } from "@/lib/openclaw/compat/targets";
import { OpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";
import { OPENCLAW_RECOMMENDED_VERSION, OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import { OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT } from "@/lib/openclaw/identity/contract";
import { serializeOpenClawRuntimeCertificationArtifact } from "@/lib/openclaw/runtime-certification/serialization";
import { redactSecretText } from "@/lib/security/redaction";

const TARGET_VERSION = OPENCLAW_RECOMMENDED_VERSION;
const TARGET_LABEL = TARGET_VERSION.split(".").slice(1).join(".");
const TARGET_COMMIT = OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT;
const TARGET_PACKAGE_INPUT = process.env.OPENCLAW_FRESH_BASELINE_PACKAGE?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_FRESH_BASELINE_OUTPUT?.trim() ||
  path.resolve(`docs/evidence/openclaw-${TARGET_VERSION}-fresh-baseline.json`);
const RUNTIME_CERTIFICATION_OUTPUT_PATH = process.env.OPENCLAW_FRESH_BASELINE_RUNTIME_OUTPUT?.trim() ||
  path.resolve(`docs/evidence/openclaw-${TARGET_VERSION}-runtime-certification.json`);
const REQUIRED_PROBE_IDS = [
  "gateway-health",
  "sessions-create",
  "chat-history-before",
  "chat-send-model-turn",
  "chat-streaming",
  "session-continuity",
  "agents-create",
  "config-get",
  "config-patch-fixture",
  "cron-add",
  "cron-run",
  "gateway-restart"
] as const;

type ExactPackageIdentity = {
  version: string;
  sourceCommit: string | null;
  buildId: string | null;
  packageHash: string;
};

async function main() {
  if (!TARGET_PACKAGE_INPUT) {
    throw new Error(`Set OPENCLAW_FRESH_BASELINE_PACKAGE to an exact OpenClaw ${TARGET_VERSION} package root.`);
  }

  const inputPackage = path.resolve(TARGET_PACKAGE_INPUT);
  const inputIdentity = await readExactPackageIdentity(inputPackage);
  assertExactTarget(inputIdentity);

  const fixtureRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-fresh-baseline-"));
  const installRoot = path.join(fixtureRoot, "managed-package");
  const stateDir = path.join(fixtureRoot, "fresh-state");
  const configPath = path.join(fixtureRoot, "fresh-config", "openclaw.json");
  const workspacePath = path.join(fixtureRoot, "workspace");
  const certificationWorkspace = path.join(fixtureRoot, "certification-workspace");
  const certificationOutput = path.join(fixtureRoot, "runtime-certification.json");
  const port = await reservePort();
  const token = randomBytes(24).toString("hex");
  const gatewayUrl = `ws://127.0.0.1:${port}`;
  let gateway: FreshGatewayProcess | null = null;
  let runtimeCertification: Record<string, unknown> | null = null;
  let failure: string | null = null;

  try {
    await mkdir(stateDir, { recursive: true, mode: 0o700 });
    await mkdir(workspacePath, { recursive: true, mode: 0o700 });
    await mkdir(certificationWorkspace, { recursive: true, mode: 0o700 });
    const stateEmptyBeforeBootstrap = (await readdir(stateDir)).length === 0;

    await cp(inputPackage, installRoot, { recursive: true, dereference: false });
    await ensurePackageDependencies(installRoot);
    const provisionedIdentity = await readExactPackageIdentity(installRoot);
    assertExactTarget(provisionedIdentity);

    await mkdir(path.dirname(configPath), { recursive: true, mode: 0o700 });
    await writeFile(configPath, `${JSON.stringify({
      gateway: { mode: "local", bind: "loopback" },
      agents: {
        defaults: { workspace: workspacePath },
        list: [{ id: "dev", workspace: workspacePath }]
      },
      cron: { enabled: true }
    }, null, 2)}\n`, { mode: 0o600 });

    gateway = await startFreshGateway({
      binaryPath: path.join(installRoot, "openclaw.mjs"),
      stateDir,
      configPath,
      port,
      token,
      homeDir: path.join(fixtureRoot, "home")
    });

    const lifecycleEnv = {
      ...process.env,
      AGENTOS_DEPLOYMENT_PLATFORM: "local",
      OPENCLAW_SUPERVISOR_MODE: "agentos-managed",
      OPENCLAW_GATEWAY_URL: gatewayUrl,
      OPENCLAW_GATEWAY_TOKEN: token,
      OPENCLAW_GATEWAY_BINARY: path.join(installRoot, "openclaw.mjs"),
      OPENCLAW_STATE_DIR: stateDir,
      OPENCLAW_CONFIG_PATH: configPath
    };
    const lifecycle = new OpenClawLifecycleService({
      env: lifecycleEnv,
      platform: process.platform,
      resolveBinary: async () => path.join(installRoot, "openclaw.mjs")
    });
    const lifecycleReadiness = await lifecycle.inspect();
    const bootstrappedConfig = await readJson(configPath);
    const securityConfig = asRecord(asRecord(bootstrappedConfig)?.tools);
    const sessionsConfig = asRecord(securityConfig?.sessions);
    const agentToAgentConfig = asRecord(securityConfig?.agentToAgent);
    const securityBootstrap = {
      path: "OpenClawLifecycleService.inspect -> native readiness -> AgentOS security bootstrap",
      status: lifecycleReadiness.ready ? "ready" : "blocked",
      gatewayConfigOwnership: "agentos-managed",
      sessionsVisibility: sessionsConfig?.visibility ?? null,
      agentToAgentEnabled: agentToAgentConfig?.enabled ?? null,
      agentToAgentAllow: agentToAgentConfig?.allow ?? null
    };
    if (!lifecycleReadiness.ready || securityBootstrap.sessionsVisibility !== "tree" || securityBootstrap.agentToAgentEnabled !== false || !Array.isArray(securityBootstrap.agentToAgentAllow) || securityBootstrap.agentToAgentAllow.length !== 0) {
      throw new Error("Managed fresh Gateway security bootstrap did not produce the explicit AgentOS policy.");
    }

    const certification = await runRuntimeCertification({
      gatewayUrl,
      token,
      stateDir,
      configPath,
      binaryPath: path.join(installRoot, "openclaw.mjs"),
      workspace: certificationWorkspace,
      outputPath: certificationOutput,
      homeDir: path.join(fixtureRoot, "home")
    });
    runtimeCertification = certification;

    const runtime = asRecord(certification.runtime);
    const persistence = asRecord(runtime?.persistence);
    const readiness = asRecord(runtime?.migrationReadiness);
    const results = Array.isArray(runtime?.results) ? runtime.results.map(asRecord).filter(Boolean) : [];
    const probeStatus = Object.fromEntries(REQUIRED_PROBE_IDS.map((id) => [
      id,
      results.find((result) => result?.id === id)?.status ?? "MISSING"
    ]));
    const requiredProbesPassed = REQUIRED_PROBE_IDS.every((id) => probeStatus[id] === "PASS");
    const sqlite = asRecord(persistence?.sqlite);
    const doctor = asRecord(persistence?.doctor);
    const noMigrationJournalBeforeCleanup = !(await findFileNamed(fixtureRoot, "migration-journal.json"));
    const runtimeChecks = {
      targetVersion: runtime?.targetVersion === TARGET_VERSION,
      installedVersion: runtime?.installedVersion === TARGET_VERSION,
      protocol: readiness?.protocolSupported === true,
      authenticatedOperator: readiness?.handshakeValid === true,
      requiredProbesPassed,
      persistence: persistence?.status === "healthy",
      sqlite: sqlite?.status === "healthy",
      doctor: doctor?.status === "healthy",
      noMigrationEngine: true,
      noSourceStateProvided: true,
      noHistoricalMigrationFixture: true,
      securityBootstrapReady: securityBootstrap.status === "ready",
      securityPolicyExplicit: securityBootstrap.sessionsVisibility === "tree" && securityBootstrap.agentToAgentEnabled === false && Array.isArray(securityBootstrap.agentToAgentAllow) && securityBootstrap.agentToAgentAllow.length === 0,
      noMigrationJournalBeforeCleanup
    };

    if (!Object.values(runtimeChecks).every(Boolean)) {
      throw new Error("Fresh OpenClaw runtime certification did not satisfy every baseline check.");
    }

    await gateway.stop();
    gateway = null;
    const noMigrationJournalAfterGatewayStop = !(await findFileNamed(fixtureRoot, "migration-journal.json"));
    const cleanupRoot = fixtureRoot;
    await rm(fixtureRoot, { recursive: true, force: true });
    const cleanupComplete = !(await pathExists(cleanupRoot));
    const installerCommand = getOpenClawInstallCommand();
    const output = {
      schemaVersion: 1,
      generatedAt: new Date().toISOString(),
      provenance: {
        agentosCommit: await readGitHead(),
        targetVersion: TARGET_VERSION,
        targetCommit: TARGET_COMMIT,
        targetBuildId: provisionedIdentity.buildId,
        targetPackageHash: provisionedIdentity.packageHash
      },
      baselinePolicy: {
        recommendedVersion: OPENCLAW_RECOMMENDED_VERSION,
        supportedBaselineVersion: OPENCLAW_SUPPORTED_BASELINE_VERSION
      },
      install: {
        mode: "exact-package-fixture",
        provisioningContract: "AgentOS recommended installer version contract",
        exactPackageProvisioned: true,
        packageVersion: provisionedIdentity.version,
        installerVersionArgumentPresent: installerCommand.includes(` ${TARGET_VERSION}`),
        installerCommand: redactInstallerCommand(installerCommand)
      },
      freshState: {
        stateEmptyBeforeBootstrap,
        sourceStateProvided: false,
        historicalMigrationFixtureUsed: false,
        migrationEngineInvoked: false,
        migrationJournalAbsentBeforeCleanup: noMigrationJournalBeforeCleanup,
        migrationJournalAbsentAfterGatewayStop: noMigrationJournalAfterGatewayStop,
        configCreatedFromFreshRoot: true
      },
      securityBootstrap,
      gateway: {
        url: redactGatewayUrl(gatewayUrl) ?? "[redacted]",
        protocol: asRecord(runtime)?.protocolVersion ?? null,
        installedVersion: asRecord(runtime)?.installedVersion ?? null,
        buildId: asRecord(runtime)?.buildId ?? null
      },
      runtimeCertification,
      checks: runtimeChecks,
      cleanup: {
        status: cleanupComplete ? "complete" : "failed",
        gatewayStopped: true,
        disposableRootRemoved: cleanupComplete
      },
      success: cleanupComplete && noMigrationJournalAfterGatewayStop && Object.values(runtimeChecks).every(Boolean)
    };
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, serializeOpenClawRuntimeCertificationArtifact(output), { mode: 0o600 });
    await writePrimaryRuntimeCertificationEvidence({
      certification,
      provisionedIdentity,
      runtimeChecks,
      outputPath: RUNTIME_CERTIFICATION_OUTPUT_PATH
    });

    if (!output.success) throw new Error("Fresh OpenClaw baseline gate failed after cleanup.");
    console.log(`OPENCLAW ${TARGET_LABEL} FRESH BASELINE: PASS`);
    console.log(`Evidence: ${OUTPUT_PATH}`);
    return 0;
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
    return 1;
  } finally {
    if (gateway) await gateway.stop().catch(() => {});
    if (failure) await rm(fixtureRoot, { recursive: true, force: true }).catch(() => {});
    if (failure) console.error(`Fresh OpenClaw baseline certification failed: ${failure}`);
  }
}

async function writePrimaryRuntimeCertificationEvidence(input: {
  certification: Record<string, unknown>;
  provisionedIdentity: ExactPackageIdentity;
  runtimeChecks: Record<string, boolean>;
  outputPath: string;
}) {
  const runtime = asRecord(input.certification.runtime);
  const results = Array.isArray(runtime?.results) ? runtime.results.map(asRecord).filter(Boolean) : [];
  const primaryEvidence = {
    schemaVersion: 1,
    artifactType: "openclaw-runtime-certification",
    generatedAt: new Date().toISOString(),
    provenance: {
      agentosCertifiedCodeHead: await readGitHead(),
      openclawRelease: TARGET_VERSION,
      openclawSourceCommit: TARGET_COMMIT,
      openclawBuildId: input.provisionedIdentity.buildId,
      openclawPackageHash: input.provisionedIdentity.packageHash,
      gatewayClient: TARGET_VERSION,
      gatewayProtocolPackage: TARGET_VERSION,
      runtimePathMode: "exact-built-source-package-fixture",
      gatewayPlacement: "disposable-loopback"
    },
    package: {
      gatewayClient: TARGET_VERSION,
      gatewayProtocol: TARGET_VERSION,
      installedOpenClaw: input.provisionedIdentity.version,
      exactPackageHash: input.provisionedIdentity.packageHash
    },
    handshake: {
      protocolVersion: runtime?.protocolVersion ?? null,
      installedVersion: runtime?.installedVersion ?? null,
      buildId: runtime?.buildId ?? null,
      role: runtime?.role ?? null,
      scopes: runtime?.scopes ?? [],
      methodCount: runtime?.methodCount ?? null,
      eventCount: runtime?.eventCount ?? null,
      capabilities: runtime?.capabilities ?? [],
      advertisedMethods: runtime?.advertisedMethods ?? [],
      advertisedEvents: runtime?.advertisedEvents ?? []
    },
    contract: {
      static: input.certification.staticContract ?? null,
      evidenceBridge: input.certification.evidenceBridge ?? null,
      operationMatrix: runtime?.operations ?? [],
      resultMatrix: results
    },
    reconnect: {
      gatewayRestart: results.find((result) => result?.id === "gateway-restart") ?? null,
      sessionContinuity: results.find((result) => result?.id === "session-continuity") ?? null,
      officialReconnectOwner: "OpenClaw official Gateway client"
    },
    requestPolicy: {
      status: "SEPARATE_AGENTOS_VALIDATION",
      evidence: "Native transport, request policy, invalidation, generation fencing, and abort isolation are validated by the AgentOS contract suite."
    },
    skips: results.filter((result) => result?.status === "SKIPPED"),
    expectedDenials: results.filter((result) => result?.status === "EXPECTED-DENIAL"),
    runtime,
    checks: input.runtimeChecks,
    success: runtime?.summary && asRecord(runtime.summary)?.failed === 0 && asRecord(runtime.summary)?.unknown === 0 && Object.values(input.runtimeChecks).every(Boolean)
  };
  await mkdir(path.dirname(input.outputPath), { recursive: true });
  await writeFile(input.outputPath, serializeOpenClawRuntimeCertificationArtifact(primaryEvidence), { mode: 0o600 });
}

async function readExactPackageIdentity(packageRoot: string): Promise<ExactPackageIdentity> {
  const packagePath = path.join(packageRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packagePath, "utf8")) as { version?: unknown };
  const buildInfo = await readJson(path.join(packageRoot, "dist", "build-info.json"));
  const hash = createHash("sha256");
  for (const relativePath of ["package.json", "openclaw.mjs", "dist/build-info.json"]) {
    hash.update(relativePath);
    hash.update(await readFile(path.join(packageRoot, relativePath)));
  }
  return {
    version: typeof packageJson.version === "string" ? packageJson.version : "",
    sourceCommit: typeof buildInfo?.commit === "string" ? buildInfo.commit : null,
    buildId: typeof buildInfo?.buildId === "string" ? buildInfo.buildId : null,
    packageHash: hash.digest("hex")
  };
}

function assertExactTarget(identity: ExactPackageIdentity) {
  if (identity.version !== TARGET_VERSION || identity.sourceCommit !== TARGET_COMMIT) {
    throw new Error(`The package must be OpenClaw ${TARGET_VERSION} at commit ${TARGET_COMMIT}.`);
  }
}

async function ensurePackageDependencies(packageRoot: string) {
  if (await pathExists(path.join(packageRoot, "node_modules", "tslog", "package.json"))) return;
  await runProcess("npm", [
    "install",
    "--prefix",
    packageRoot,
    "--omit=dev",
    "--ignore-scripts",
    "--legacy-peer-deps",
    "--no-audit",
    "--no-fund"
  ], { cwd: packageRoot, timeoutMs: 180_000 });
}

type FreshGatewayProcess = {
  stop: () => Promise<void>;
};

async function startFreshGateway(input: {
  binaryPath: string;
  stateDir: string;
  configPath: string;
  port: number;
  token: string;
  homeDir: string;
}): Promise<FreshGatewayProcess> {
  await mkdir(input.homeDir, { recursive: true, mode: 0o700 });
  const child = spawn(process.execPath, [
    input.binaryPath,
    "gateway",
    "run",
    "--port",
    String(input.port),
    "--bind",
    "loopback",
    "--allow-unconfigured",
    "--ws-log",
    "compact",
    "--no-color"
  ], {
    env: {
      ...process.env,
      HOME: input.homeDir,
      OPENCLAW_STATE_DIR: input.stateDir,
      OPENCLAW_CONFIG_PATH: input.configPath,
      OPENCLAW_GATEWAY_TOKEN: input.token,
      OPENCLAW_GATEWAY_PASSWORD: ""
    },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-4_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-4_000); });
  let exited = false;
  child.once("close", () => { exited = true; });
  try {
    await waitForLoopbackPort(input.port, () => exited, 30_000);
  } catch (error) {
    child.kill("SIGTERM");
    throw new Error(`${error instanceof Error ? error.message : String(error)} ${redactSecretText(output).trim()}`.trim());
  }
  return {
    stop: async () => {
      if (exited || child.exitCode !== null) return;
      child.kill("SIGTERM");
      await waitForChildClose(child, 5_000);
      if (!exited && child.exitCode === null) {
        child.kill("SIGKILL");
        await waitForChildClose(child, 5_000);
      }
      if (!exited && child.exitCode === null) throw new Error("Fresh Gateway process did not exit.");
    }
  };
}

async function runRuntimeCertification(input: {
  gatewayUrl: string;
  token: string;
  stateDir: string;
  configPath: string;
  binaryPath: string;
  workspace: string;
  outputPath: string;
  homeDir: string;
}) {
  const scriptPath = path.resolve("scripts/openclaw-runtime-certification.ts");
  const result = await runProcess(process.execPath, [
    "-r",
    path.resolve("tests/register-paths.cjs"),
    "-r",
    "jiti/register.js",
    scriptPath
  ], {
    cwd: process.cwd(),
    timeoutMs: 180_000,
    env: {
      HOME: input.homeDir,
      OPENCLAW_CONFIG_PATH: input.configPath,
      OPENCLAW_GATEWAY_TOKEN: input.token,
      OPENCLAW_RUNTIME_CERT_GATEWAY_URL: input.gatewayUrl,
      OPENCLAW_RUNTIME_CERT_TOKEN: input.token,
      OPENCLAW_RUNTIME_CERT_TARGET: TARGET_VERSION,
      OPENCLAW_RUNTIME_CERT_TARGET_COMMIT: TARGET_COMMIT,
      OPENCLAW_RUNTIME_CERT_STATIC_CURRENT_VERSION: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      OPENCLAW_RUNTIME_CERT_STATE_DIR: input.stateDir,
      OPENCLAW_RUNTIME_CERT_CLI: input.binaryPath,
      OPENCLAW_RUNTIME_CERT_WORKSPACE: input.workspace,
      OPENCLAW_RUNTIME_CERT_OUTPUT: input.outputPath,
      OPENCLAW_RUNTIME_CERT_QUIET: "1"
    }
  });
  const certification = JSON.parse(await readFile(input.outputPath, "utf8")) as Record<string, unknown>;
  if (result.exitCode !== 0) {
    const runtime = asRecord(certification.runtime);
    const failures = Array.isArray(runtime?.results)
      ? runtime.results
        .map(asRecord)
        .filter((entry) => entry?.status === "FAIL")
        .map((entry) => `${String(entry?.id)}: ${String(entry?.errorMessage ?? "failed")}`)
        .slice(0, 8)
        .join("; ")
      : "";
    const detail = redactSecretText(`${failures}\n${result.stderr}\n${result.stdout}`).trim().slice(-4_000);
    throw new Error(`The real ${TARGET_LABEL} Gateway certification child process failed.${detail ? ` ${detail}` : ""}`);
  }
  return certification;
}

async function runProcess(command: string, args: string[], input: { cwd?: string; env?: Record<string, string>; timeoutMs: number }) {
  return await new Promise<{ exitCode: number | null; stdout: string; stderr: string }>((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: input.cwd,
      env: { ...process.env, ...input.env },
      stdio: ["ignore", "pipe", "pipe"],
      windowsHide: true
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      child.kill("SIGTERM");
      setTimeout(() => { if (!settled) child.kill("SIGKILL"); }, 2_000).unref();
    }, input.timeoutMs);
    child.stdout.on("data", (chunk: Buffer | string) => { stdout = `${stdout}${chunk.toString()}`.slice(-16_000); });
    child.stderr.on("data", (chunk: Buffer | string) => { stderr = `${stderr}${chunk.toString()}`.slice(-16_000); });
    child.once("error", (error) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(error);
    });
    child.once("close", (exitCode) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ exitCode, stdout, stderr });
    });
  });
}

async function waitForLoopbackPort(port: number, hasExited: () => boolean, timeoutMs: number) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (hasExited()) throw new Error(`Fresh Gateway exited before listening on port ${port}.`);
    const connected = await new Promise<boolean>((resolve) => {
      const socket = net.createConnection({ host: "127.0.0.1", port });
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("error", () => { socket.destroy(); resolve(false); });
    });
    if (connected) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error(`Fresh Gateway did not listen on loopback port ${port}.`);
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

function waitForChildClose(child: ReturnType<typeof spawn>, timeoutMs: number) {
  if (child.exitCode !== null) return Promise.resolve();
  return new Promise<void>((resolve) => {
    const timer = setTimeout(resolve, timeoutMs);
    child.once("close", () => { clearTimeout(timer); resolve(); });
  });
}

async function findFileNamed(root: string, name: string): Promise<string | null> {
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  for (const entry of entries) {
    const candidate = path.join(root, entry.name);
    if (entry.isFile() && entry.name === name) return candidate;
    if (entry.isDirectory() && entry.name !== "node_modules") {
      const nested = await findFileNamed(candidate, name);
      if (nested) return nested;
    }
  }
  return null;
}

async function pathExists(filePath: string) {
  return stat(filePath).then(() => true).catch(() => false);
}

async function readJson(filePath: string) {
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function readGitHead() {
  const result = await execFileAsync("git", ["rev-parse", "HEAD"]);
  return result.trim();
}

function execFileAsync(command: string, args: string[]) {
  return new Promise<string>((resolve, reject) => {
    execFile(command, args, { encoding: "utf8" }, (error, stdout) => error ? reject(error) : resolve(stdout));
  });
}

function redactInstallerCommand(command: string) {
  return command.replace(/(token|secret|api[_-]?key|password)\s*[:=]\s*[^\s]+/gi, "$1=[REDACTED]");
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

void main().then((exitCode) => {
  process.exitCode = exitCode;
});
