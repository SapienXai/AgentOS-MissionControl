import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import { createOpenClawRuntimeProviderFixture } from "@/scripts/openclaw-runtime-provider-fixture";
import {
  OPENCLAW_IDENTITY_CONTRACT_BUILD,
  OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT,
  OPENCLAW_IDENTITY_CONTRACT_VERSION
} from "@/lib/openclaw/identity/contract";

type OfficialBackedGatewayClient = ReturnType<typeof createOfficialBackedOpenClawGatewayClient>;

const execFileAsync = promisify(execFile);
const PACKAGE_INPUT = process.env.OPENCLAW_AUTOMATION_E2E_PACKAGE?.trim() || process.env.OPENCLAW_SESSION_TASK_E2E_PACKAGE?.trim();
const OUTPUT_PATH = process.env.OPENCLAW_AUTOMATION_E2E_OUTPUT?.trim() || path.resolve(`docs/evidence/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-automation-cron-alignment.json`);
const REQUEST_TIMEOUT_MS = 10_000;

async function main() {
  if (!PACKAGE_INPUT) throw new Error(`Set OPENCLAW_AUTOMATION_E2E_PACKAGE to an exact OpenClaw ${OPENCLAW_IDENTITY_CONTRACT_VERSION} package root.`);
  const packageRoot = path.resolve(PACKAGE_INPUT);
  const packageIdentity = await readPackageIdentity(packageRoot);
  assert.equal(packageIdentity.version, OPENCLAW_IDENTITY_CONTRACT_VERSION);
  assert.equal(packageIdentity.sourceCommit, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT);
  assert.equal(packageIdentity.buildId, OPENCLAW_IDENTITY_CONTRACT_BUILD);

  const disposableRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-openclaw-automation-"));
  const stateDir = path.join(disposableRoot, "state");
  const workspaceDir = path.join(disposableRoot, "workspace");
  const configPath = path.join(disposableRoot, "openclaw.json");
  const port = await reservePort();
  const token = `agentos-automation-e2e-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const fixture = await createOpenClawRuntimeProviderFixture({ modelId: "agentos-automation-fixture" });
  let gateway: ChildProcess | null = null;
  let client: OfficialBackedGatewayClient | null = null;
  let success = false;
  const evidence = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    provenance: {
      repository: "SapienXai/AgentOS",
      branch: await readGitBranch(),
      codeCommitUnderTest: await readGitHead(),
      evidenceCommit: process.env.OPENCLAW_AUTOMATION_E2E_EVIDENCE_COMMIT?.trim() || null,
      openClawPackageVersion: packageIdentity.version,
      openClawSourceCommit: packageIdentity.sourceCommit,
      openClawBuild: packageIdentity.buildId,
      openClawPackageHash: packageIdentity.packageHash
    },
    openClaw: {
      version: packageIdentity.version,
      sourceCommit: packageIdentity.sourceCommit,
      build: packageIdentity.buildId,
      packageMode: "exact-npm-package-fixture",
      gatewayPortIsDisposable: true,
      noRealProviderCredentials: true
    },
    connection: {
      requestedRole: null as string | null,
      grantedRole: null as string | null,
      requestedScopes: [] as string[],
      grantedScopes: [] as string[],
      connectionIdPresent: false,
      deviceIdentityPresent: false
    },
    cronContract: {
      methods: ["cron.status", "cron.list", "cron.get", "cron.add", "cron.update", "cron.remove", "cron.run", "cron.runs"],
      runSemantics: "cron.run is enqueue-style; cron.runs is terminal history authority",
      canonicalJobField: "id",
      canonicalRunField: "runId",
      sessionIdentity: "exact run sessionKey/sessionId returned by cron.runs; no fabricated fallback"
    },
    sourceOfTruthMatrix: [
      { surface: "automation identity", source: "AgentOS automationId/declarationKey", projection: "AgentOS correlation and convergence metadata", authority: "OpenClaw cron job id" },
      { surface: "cron job", source: "OpenClaw cron.list/get", projection: "operations job card", authority: "OpenClaw" },
      { surface: "cron run", source: "OpenClaw cron.runs", projection: "operation run history", authority: "OpenClaw" },
      { surface: "task", source: "OpenClaw tasks.list/get when present", projection: "task card and cancellation", authority: "OpenClaw; no task id fabricated" },
      { surface: "dispatch", source: "AgentOS request/dispatch metadata", projection: "audit/recovery correlation", authority: "not runtime authority" }
    ],
    automationIdentity: {
      automationId: "agentos:automation:e2e",
      declarationKey: "agentos:automation:e2e",
      cronJobId: null as string | null,
      cronRunIds: [] as string[],
      sessionKeys: [] as string[],
      sessionIds: [] as string[],
      provenance: "pending"
    },
    controls: {
      add: "PENDING", get: "PENDING", update: "PENDING", enableDisable: "PENDING", manualRun: "PENDING", runHistory: "PENDING", remove: "PENDING",
      duplicateDeclarationKey: "PENDING", restartContinuity: "PENDING"
    },
    taskIntegration: {
      taskIds: [] as string[],
      taskGetChecks: [] as Array<Record<string, unknown>>,
      taskCancelChecks: [] as Array<Record<string, unknown>>,
      noTaskIdFabricated: true
    },
    runChecks: [] as Array<Record<string, unknown>>,
    cleanup: { status: "pending", disposableRootRemoved: false, gatewayProcessStopped: false },
    gate: `OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} AUTOMATION/CRON ALIGNMENT GATE: FAIL`,
    success: false
  };

  try {
    gateway = await startGateway({ packageRoot, stateDir, workspaceDir, configPath, port, token, fixtureBaseUrl: fixture.baseUrl, fixtureModelId: fixture.modelId });
    client = createClient(port, token, "0.1.0-agentos-automation-e2e");
    const identity = await client.getOperatorIdentity({ timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(identity.source, "native-handshake");
    assert.equal(identity.authenticated, true);
    evidence.connection = {
      requestedRole: identity.requestedRole,
      grantedRole: identity.role,
      requestedScopes: identity.requestedScopes,
      grantedScopes: identity.grantedScopes,
      connectionIdPresent: Boolean(identity.connectionId),
      deviceIdentityPresent: Boolean(identity.deviceId)
    };

    const status = await client.getCronStatus({ timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(status.enabled, true);
    const declarationKey = evidence.automationIdentity.declarationKey;
    const addParams = {
      name: "AgentOS automation E2E",
      description: "Disposable automation identity contract probe",
      declarationKey,
      agentId: "main",
      enabled: true,
      schedule: { kind: "every" as const, everyMs: 60_000 },
      sessionTarget: "isolated" as const,
      wakeMode: "now" as const,
      payload: { kind: "agentTurn" as const, message: "AGENTOS_SYNTHETIC_CRON_PROMPT", thinking: "medium" },
      delivery: { mode: "none" as const },
      deleteAfterRun: false
    };
    const addedPayload = await client.call<Record<string, unknown>>("cron.add", addParams, { timeoutMs: REQUEST_TIMEOUT_MS });
    const addedJob = record(addedPayload.job);
    const jobId = string(addedJob.id) ?? string(addedPayload.id) ?? string(addedPayload.jobId);
    assert.ok(jobId, "OpenClaw cron.add must return an exact job id");
    evidence.automationIdentity.cronJobId = jobId;
    evidence.automationIdentity.provenance = "authoritative job + run identities; AgentOS key is correlated";
    evidence.controls.add = "PASS";

    const job = await client.getCronJob({ id: jobId }, { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(string(job.id), jobId);
    evidence.controls.get = "PASS";

    const duplicatePayload = await client.call<Record<string, unknown>>("cron.add", addParams, { timeoutMs: REQUEST_TIMEOUT_MS });
    const duplicateJob = record(duplicatePayload.job);
    const duplicateJobId = string(duplicateJob.id) ?? string(duplicatePayload.id) ?? string(duplicatePayload.jobId);
    assert.equal(duplicateJobId, jobId);
    evidence.controls.duplicateDeclarationKey = "PASS: same declarationKey converged to one OpenClaw job";

    await client.call("cron.update", { id: jobId, patch: { name: "AgentOS automation E2E updated" } }, { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(string((await client.getCronJob({ id: jobId }, { timeoutMs: REQUEST_TIMEOUT_MS })).name), "AgentOS automation E2E updated");
    evidence.controls.update = "PASS";

    const firstRun = await runAndObserve(client, jobId, evidence);
    evidence.automationIdentity.cronRunIds.push(firstRun.runId);
    if (firstRun.sessionKey) evidence.automationIdentity.sessionKeys.push(firstRun.sessionKey);
    if (firstRun.sessionId) evidence.automationIdentity.sessionIds.push(firstRun.sessionId);
    const secondRun = await runAndObserve(client, jobId, evidence);
    evidence.automationIdentity.cronRunIds.push(secondRun.runId);
    if (secondRun.sessionKey) evidence.automationIdentity.sessionKeys.push(secondRun.sessionKey);
    if (secondRun.sessionId) evidence.automationIdentity.sessionIds.push(secondRun.sessionId);
    assert.notEqual(firstRun.runId, secondRun.runId);
    evidence.controls.manualRun = "PASS: cron.run returned distinct enqueue runIds";
    evidence.controls.runHistory = "PASS: terminal status observed through cron.runs by exact runId";

    await client.call("cron.update", { id: jobId, patch: { enabled: false } }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const disabledRun = await client.runCronJob({ id: jobId, mode: "if-enabled" }, { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(disabledRun.ran, false);
    assert.equal(disabledRun.reason, "disabled");
    evidence.controls.enableDisable = "PASS: disabled job rejected if-enabled run; owner control can update enabled";
    await client.call("cron.update", { id: jobId, patch: { enabled: true } }, { timeoutMs: REQUEST_TIMEOUT_MS });

    client.close("automation restart continuity");
    client = null;
    await stopProcess(gateway);
    gateway = await startGateway({ packageRoot, stateDir, workspaceDir, configPath, port, token, fixtureBaseUrl: fixture.baseUrl, fixtureModelId: fixture.modelId });
    client = createClient(port, token, "0.1.0-agentos-automation-e2e-reconnect");
    const afterRestart = await client.listCronJobs({ includeDisabled: true }, { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal((afterRestart.jobs ?? []).filter((entry) => string(record(entry).id) === jobId).length, 1);
    const afterRestartRuns = await client.listCronRuns({ id: jobId, limit: 50 }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const persistedRuns = Array.isArray(afterRestartRuns.entries) ? afterRestartRuns.entries.filter((entry) => string(record(entry).runId)) : [];
    assert.ok(persistedRuns.length >= 2);
    evidence.controls.restartContinuity = "PASS: one job and exact run history survived Gateway restart";

    const removed = await client.call<Record<string, unknown>>("cron.remove", { id: jobId }, { timeoutMs: REQUEST_TIMEOUT_MS });
    assert.equal(removed.removed, true);
    evidence.controls.remove = "PASS";
    success = true;
  } finally {
    client?.close("automation cleanup");
    if (gateway) await stopProcess(gateway).catch(() => {});
    await fixture.close().catch(() => {});
    await rm(disposableRoot, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup.status = "complete";
    evidence.cleanup.disposableRootRemoved = !(await pathExists(disposableRoot));
    evidence.cleanup.gatewayProcessStopped = !gateway || gateway.exitCode !== null;
    evidence.gate = success && evidence.cleanup.disposableRootRemoved && evidence.cleanup.gatewayProcessStopped
      ? `OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} AUTOMATION/CRON ALIGNMENT GATE: PASS`
      : `OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} AUTOMATION/CRON ALIGNMENT GATE: FAIL`;
    evidence.success = evidence.gate.endsWith("PASS");
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  }
  if (!evidence.success) throw new Error(`Automation/cron alignment certification failed. Evidence: ${OUTPUT_PATH}`);
  console.log(`OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} AUTOMATION/CRON ALIGNMENT GATE: PASS`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

async function runAndObserve(client: OfficialBackedGatewayClient, jobId: string, evidence: { runChecks: Array<Record<string, unknown>>; taskIntegration: { taskIds: string[]; taskGetChecks: Array<Record<string, unknown>>; taskCancelChecks: Array<Record<string, unknown>>; noTaskIdFabricated: boolean } }) {
  const enqueue = await client.runCronJob({ id: jobId, mode: "force" }, { timeoutMs: REQUEST_TIMEOUT_MS });
  assert.equal(enqueue.ok, true);
  const runId = string(enqueue.runId);
  assert.ok(runId, "cron.run must return an exact runId for an enqueued run");
  let terminal: Record<string, unknown> | null = null;
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    const payload = await client.listCronRuns({ id: jobId, runId, limit: 10 }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const entry = (Array.isArray(payload.entries) ? payload.entries : []).map(record).find((candidate) => string(candidate.runId) === runId) ?? null;
    if (entry && ["ok", "error", "skipped"].includes(string(entry.status) ?? "")) {
      terminal = entry;
      break;
    }
    await wait(250);
  }
  assert.ok(terminal, `cron.runs did not expose terminal run ${runId}`);
  const sessionKey = string(terminal.sessionKey);
  const sessionId = string(terminal.sessionId);
  evidence.runChecks.push({ runId, status: terminal.status, completionStatus: terminal.completionStatus ?? null, sessionKeyPresent: Boolean(sessionKey), sessionIdPresent: Boolean(sessionId), exactRunFilter: true });
  assert.ok(sessionKey || sessionId, "cron.runs must expose an exact session identity when the run creates one");
  if (sessionKey) {
    const tasks = await client.listTasks({ sessionKey }, { timeoutMs: REQUEST_TIMEOUT_MS });
    const taskValues = Array.isArray(tasks.tasks) ? tasks.tasks : [];
    for (const value of taskValues) {
      const taskId = string(record(value).id) ?? string(record(value).taskId);
      if (!taskId) continue;
      evidence.taskIntegration.taskIds.push(taskId);
      const task = await client.getTask({ taskId }, { timeoutMs: REQUEST_TIMEOUT_MS });
      evidence.taskIntegration.taskGetChecks.push({ taskIdPresent: true, taskReturned: Boolean(task.task) });
      evidence.taskIntegration.taskCancelChecks.push({ taskIdPresent: true, result: "SKIPPED-terminal" });
    }
  }
  return { runId, sessionKey, sessionId };
}

function createClient(port: number, token: string, clientVersion: string) {
  return createOfficialBackedOpenClawGatewayClient({ url: `ws://127.0.0.1:${port}`, token, role: "operator", scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.questions", "operator.pairing", "operator.talk"], timeoutMs: REQUEST_TIMEOUT_MS, clientName: "gateway-client", clientVersion, sharedStateMode: "read-only" });
}

async function startGateway(input: { packageRoot: string; stateDir: string; workspaceDir: string; configPath: string; port: number; token: string; fixtureBaseUrl: string; fixtureModelId: string }) {
  await mkdir(input.workspaceDir, { recursive: true, mode: 0o700 });
  await mkdir(input.stateDir, { recursive: true, mode: 0o700 });
  await writeFile(input.configPath, `${JSON.stringify({
    gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: input.token } },
    agents: { defaults: { workspace: input.workspaceDir, model: { primary: `agentos-fixture/${input.fixtureModelId}` } }, list: [{ id: "main", workspace: input.workspaceDir }] },
    models: { mode: "merge", providers: { "agentos-fixture": { baseUrl: input.fixtureBaseUrl, api: "openai-completions", apiKey: "agentos-automation-fixture", timeoutSeconds: 30, models: [{ id: input.fixtureModelId, name: "AgentOS Automation Fixture", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 32_768, maxTokens: 128 }] } } },
    cron: { enabled: true }
  }, null, 2)}\n`, { mode: 0o600 });
  const child = spawn(process.execPath, [path.join(input.packageRoot, "openclaw.mjs"), "gateway", "run", "--port", String(input.port), "--bind", "loopback", "--allow-unconfigured", "--auth", "token", "--token", input.token, "--ws-log", "compact"], { cwd: input.workspaceDir, env: { ...process.env, OPENCLAW_STATE_DIR: input.stateDir, OPENCLAW_CONFIG_PATH: input.configPath, OPENCLAW_GATEWAY_TOKEN: input.token }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Isolated OpenClaw Gateway exited (${child.exitCode}). ${sanitizeText(output)}`);
    try { if ((await fetch(`http://127.0.0.1:${input.port}/healthz`)).ok) return child; } catch {}
    await wait(250);
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
async function reservePort() { return await new Promise<number>((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : resolve(port)); }); }); }
async function stopProcess(child: ChildProcess) { if (child.exitCode !== null) return; child.kill("SIGTERM"); await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())), wait(10_000)]); if (child.exitCode === null) child.kill("SIGKILL"); }
async function pathExists(candidate: string) { try { await readFile(candidate); return true; } catch (error) { return error instanceof Error && "code" in error && error.code !== "ENOENT"; } }
function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
function record(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function string(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function sanitizeText(value: string) { return value.replace(/agentos-automation-e2e-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]").replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]").slice(0, 320); }
function sanitizeEvidence(value: unknown): unknown { if (typeof value === "string") return sanitizeText(value); if (Array.isArray(value)) return value.map(sanitizeEvidence); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeEvidence(nested)])); return value; }

main().catch((error) => { console.error(error instanceof Error ? error.message : "OpenClaw automation/cron E2E failed."); process.exitCode = 1; });
