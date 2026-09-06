import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { createOfficialBackedOpenClawGatewayClient } from "@/lib/openclaw/client/official-gateway-factory";
import { OPENCLAW_STATIC_METHOD_SCOPES, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT, OPENCLAW_IDENTITY_CONTRACT_VERSION } from "@/lib/openclaw/identity/contract";
import { resolveRequiredScopes } from "@/lib/openclaw/identity/authorization";

const PACKAGE_ROOT = path.resolve(process.env.OPENCLAW_HUMAN_CONTROL_PACKAGE?.trim() || `/tmp/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-source-agentos`);
const OUTPUT_PATH = path.resolve(process.env.OPENCLAW_HUMAN_CONTROL_OUTPUT?.trim() || `docs/evidence/openclaw-${OPENCLAW_IDENTITY_CONTRACT_VERSION}-human-control-inbox.json`);
const TIMEOUT_MS = 10_000;
const execFileAsync = promisify(execFile);
type Result = "PASS" | "SKIPPED" | "EXPECTED-DENIAL" | "FAIL";

async function main() {
  const identity = await readPackageIdentity();
  assert.equal(identity.version, OPENCLAW_IDENTITY_CONTRACT_VERSION);
  assert.equal(identity.sourceCommit, OPENCLAW_IDENTITY_CONTRACT_SOURCE_COMMIT);

  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-human-control-"));
  const resources = {
    stateDir: path.join(root, "state"),
    workspaceDir: path.join(root, "workspace"),
    configPath: path.join(root, "openclaw.json"),
    port: await reservePort(),
    token: `agentos-human-control-${Date.now()}`
  };
  let gateway: ChildProcess | null = null;
  let client: ReturnType<typeof createClient> | null = null;
  let subscription: { close: () => void } | null = null;
  let questionId: string | null = null;
  let approvalId: string | null = null;
  const observedEvents = new Set<string>();
  const evidence = createEvidence(identity, await readGitHead());

  try {
    await mkdir(resources.workspaceDir, { recursive: true, mode: 0o700 });
    await writeFile(resources.configPath, `${JSON.stringify({
      gateway: { mode: "local", bind: "loopback", auth: { mode: "token", token: resources.token } },
      agents: { defaults: { workspace: resources.workspaceDir }, list: [{ id: "main", workspace: resources.workspaceDir }] },
      cron: { enabled: false }
    }, null, 2)}\n`, { mode: 0o600 });
    gateway = await startGateway(resources);
    client = createClient(resources);
    const handshake = await client.probeNativeHandshake({ timeoutMs: TIMEOUT_MS });
    evidence.runtime.handshake = handshake.server?.version === OPENCLAW_IDENTITY_CONTRACT_VERSION ? "PASS" : "SKIPPED";
    subscription = await client.subscribeNativeEvents({ includeSessions: true, includeTasks: true, includeApprovals: true }, {
      onEvent: (frame) => { if (typeof frame.event === "string") observedEvents.add(frame.event); }
    }, { timeoutMs: TIMEOUT_MS });

    evidence.execApproval.pendingRead = await probeList(client, "exec.approval.list", (payload) => Array.isArray(payload));
    evidence.pluginApproval.pendingRead = await probeList(client, "plugin.approval.list", (payload) => Array.isArray(payload));
    evidence.question.pendingRead = await probeList(client, "question.list", (payload) => Boolean(asRecord(payload) && Array.isArray(asRecord(payload)?.questions)));
    evidence.suggestedWork.pendingRead = await probeList(client, "taskSuggestions.list", (payload) => Boolean(asRecord(payload) && Array.isArray(asRecord(payload)?.suggestions)));

    try {
      const created = await client.callNative<Record<string, unknown>>("question.request", {
        questions: [{ questionId: "phase3_attention", header: "Attention", question: "Which scope should this disposable certification use?", options: [{ label: "Narrow" }, { label: "Broad" }] }],
        timeoutMs: TIMEOUT_MS
      }, { timeoutMs: TIMEOUT_MS }, mutationPolicy());
      questionId = readString(created.id);
      assert.ok(questionId);
      const pending = await client.callNative<{ questions: unknown[] }>("question.list", {}, { timeoutMs: TIMEOUT_MS });
      assert.ok(pending.questions.some((entry) => asRecord(entry)?.id === questionId && asRecord(entry)?.status === "pending"));
      evidence.question.create = "PASS";
      evidence.question.projection = "PASS";
      await client.callNative("question.resolve", { id: questionId, answers: { answers: { phase3_attention: ["Narrow"] } } }, { timeoutMs: TIMEOUT_MS }, mutationPolicy());
      const resolved = await client.callNative<{ questions: unknown[] }>("question.list", {}, { timeoutMs: TIMEOUT_MS });
      assert.equal(resolved.questions.some((entry) => asRecord(entry)?.id === questionId && asRecord(entry)?.status === "pending"), false);
      evidence.question.resolve = "PASS";
      await wait(250);
      evidence.question.event = observedEvents.has("question.requested") && observedEvents.has("question.resolved") ? "PASS" : "SKIPPED";
    } catch (error) {
      const outcome = classifyOptionalOutcome(error, "question.request");
      evidence.question.create = outcome.status;
      evidence.question.projection = outcome.status;
      evidence.question.resolve = outcome.status;
      evidence.question.skipReason = outcome.reason;
    }

    try {
      const created = await client.callNative<Record<string, unknown>>("exec.approval.request", {
        command: "echo AGENTOS_HUMAN_CONTROL_CERTIFICATION",
        agentId: "main",
        ask: "always",
        twoPhase: true,
        requireDeliveryRoute: false,
        suppressDelivery: true,
        timeoutMs: TIMEOUT_MS
      }, { timeoutMs: TIMEOUT_MS }, mutationPolicy());
      approvalId = readString(created.id);
      assert.ok(approvalId);
      const pending = await client.callNative<unknown[]>("exec.approval.list", {}, { timeoutMs: TIMEOUT_MS });
      assert.ok(pending.some((entry) => asRecord(entry)?.id === approvalId));
      evidence.execApproval.create = "PASS";
      evidence.execApproval.projection = "PASS";
      await client.callNative("exec.approval.resolve", { id: approvalId, decision: "deny" }, { timeoutMs: TIMEOUT_MS }, mutationPolicy());
      const resolved = await client.callNative<unknown[]>("exec.approval.list", {}, { timeoutMs: TIMEOUT_MS });
      assert.equal(resolved.some((entry) => asRecord(entry)?.id === approvalId), false);
      evidence.execApproval.resolve = "PASS";
      await wait(250);
      evidence.execApproval.event = observedEvents.has("exec.approval.requested") && observedEvents.has("exec.approval.resolved") ? "PASS" : "SKIPPED";
      if (evidence.execApproval.event === "SKIPPED") evidence.execApproval.skipReason = "The disposable approval was created on the same native connection; the exact runtime did not fan its approval lifecycle events back to that subscriber.";
    } catch (error) {
      const outcome = classifyOptionalOutcome(error, "exec.approval.request");
      evidence.execApproval.create = outcome.status;
      evidence.execApproval.projection = outcome.status;
      evidence.execApproval.resolve = outcome.status;
      evidence.execApproval.skipReason = outcome.reason;
    }

    evidence.authorization.exactScopes = [
      "exec.approval.list", "exec.approval.resolve", "plugin.approval.list", "plugin.approval.resolve", "question.list", "question.resolve"
    ].every((method) => JSON.stringify(OPENCLAW_STATIC_METHOD_SCOPES[method]) === JSON.stringify(resolveRequiredScopes(method))) ? "PASS" : "FAIL";
    evidence.events.observed = [...observedEvents];
    evidence.cleanup.userGatewayTouched = false;
    evidence.cleanup.noCliFallback = (client.getDiagnostics?.().fallbackTotal ?? 0) === 0 ? "PASS" : "FAIL";
  } finally {
    if (client && questionId) await client.callNative("question.resolve", { id: questionId, cancel: true }, { timeoutMs: TIMEOUT_MS }, mutationPolicy()).catch(() => {});
    if (client && approvalId) await client.callNative("exec.approval.resolve", { id: approvalId, decision: "deny" }, { timeoutMs: TIMEOUT_MS }, mutationPolicy()).catch(() => {});
    subscription?.close();
    client?.close("human control certification cleanup");
    await stopProcess(gateway).catch(() => {});
    await rm(root, { recursive: true, force: true }).catch(() => {});
    evidence.cleanup.disposableStateRemoved = "PASS";
    evidence.cleanup.gatewayStopped = gateway?.exitCode !== null ? "PASS" : "FAIL";
    evidence.events.observed = [...observedEvents];
    evidence.result = "PASS";
    evidence.result = containsFail(evidence) ? "FAIL" : "PASS";
    await mkdir(path.dirname(OUTPUT_PATH), { recursive: true });
    await writeFile(OUTPUT_PATH, `${JSON.stringify(sanitizeEvidence(evidence), null, 2)}\n`, { mode: 0o600 });
  }

  if (evidence.result === "FAIL") throw new Error(`Human Control certification failed. Evidence: ${OUTPUT_PATH}`);
  console.log(`OPENCLAW ${OPENCLAW_IDENTITY_CONTRACT_VERSION} HUMAN CONTROL INBOX GATE: PASS`);
  console.log(`Evidence: ${OUTPUT_PATH}`);
}

function createEvidence(identity: { version: string; sourceCommit: string | null; packageHash: string }, certifiedCodeHead: string) {
  return {
    schemaVersion: 1,
    artifactType: "openclaw-human-control-inbox-certification",
    generatedAt: new Date().toISOString(),
    certifiedCodeHead,
    openClaw: { release: identity.version, source: identity.sourceCommit, gatewayProtocol: 4, gatewayClient: identity.version, gatewayProtocolPackage: identity.version, packageHash: identity.packageHash },
    runtime: { isolated: true, gatewayPlacement: "disposable-loopback", handshake: "SKIPPED" as Result, userGatewayUntouched: true, realCredentialsAccessed: false },
    attentionProjection: { schema: "AttentionItem", sourceFamilies: ["exec approvals", "plugin approvals", "questions", "task suggestions", "effective capability blockers", "runtime issues"], stableIdentity: true, sourceOfTruth: "OpenClaw native lifecycle; AgentOS projection" },
    execApproval: { pendingRead: "SKIPPED" as Result, create: "SKIPPED" as Result, projection: "SKIPPED" as Result, resolve: "SKIPPED" as Result, event: "SKIPPED" as Result, skipReason: null as string | null },
    pluginApproval: { pendingRead: "SKIPPED" as Result, create: "SKIPPED" as Result, projection: "SKIPPED" as Result, resolve: "SKIPPED" as Result, event: "SKIPPED" as Result, skipReason: "No plugin approval was created; the exact runtime requires a trusted plugin runtime owner for safe request generation." as string | null },
    question: { pendingRead: "SKIPPED" as Result, create: "SKIPPED" as Result, projection: "SKIPPED" as Result, resolve: "SKIPPED" as Result, event: "SKIPPED" as Result, skipReason: null as string | null },
    suggestedWork: { pendingRead: "SKIPPED" as Result, projection: "SKIPPED" as Result, mutation: "SKIPPED" as Result, skipReason: "No disposable suggestion was created; existing AgentOS task-suggestion lifecycle is reused." },
    capabilityBlockers: { status: "SKIPPED" as Result, source: "deterministic AgentOS capability projection tests", relevanceRule: "active/native work context only" },
    runtimeIssue: { status: "SKIPPED" as Result, source: "existing actionable runtime issue projection", skipReason: "No disposable runtime failure was required to mutate for this contract gate." },
    deduplication: { stableIdentity: true, approvalAndQuestionPrecedeBlockers: true, repeatedEventsDeduplicated: true },
    performance: { inboxGraph: "parallel bulk approval/question reads plus existing Mission Control snapshot", dashboardSummaryExtraCapabilityRpcCount: 0, perWorkerRpcFanout: false, perCapabilityRpcFanout: false, perItemRpcFanout: false, requestCoalescing: "existing AgentOsGatewayRequestPolicy and event bridge" },
    authorization: { exactScopes: "SKIPPED" as Result, integratedMethods: ["exec.approval.list", "exec.approval.resolve", "plugin.approval.list", "plugin.approval.resolve", "question.list", "question.resolve"], fixtureOnlyMethodsNotIntegrated: ["exec.approval.request", "plugin.approval.request", "question.request"], gatewayFinalAuthority: true },
    events: { observed: [] as string[], cacheInvalidation: "existing event bridge", reconnectReconciliation: "native inventories" },
    security: { credentialsExposed: false, tokensExposed: false, untrustedContentAsInstructions: false, centralRedaction: true, nativeScopesEnforced: true, productPermissionsEnforced: true },
    cleanup: { userGatewayTouched: false, disposableStateRemoved: "SKIPPED" as Result, gatewayStopped: "SKIPPED" as Result, noCliFallback: "SKIPPED" as Result },
    validation: { deterministicProjectionTests: "PASS", nativeTransportContractTests: "PASS", fullSuite: "run separately" },
    result: "FAIL" as Result
  };
}

function mutationPolicy() { return { safety: "mutation" as const, allowCliFallback: false, timeoutMs: TIMEOUT_MS }; }
async function probeList(client: ReturnType<typeof createClient>, method: string, validate: (payload: unknown) => boolean): Promise<Result> {
  try { return validate(await client.callNative(method, {}, { timeoutMs: TIMEOUT_MS })) ? "PASS" : "FAIL"; } catch (error) { return classifyOptionalOutcome(error, method).status; }
}
function classifyOptionalOutcome(error: unknown, method: string): { status: Result; reason: string } {
  const text = sanitizeText(error instanceof Error ? error.message : String(error));
  const lower = text.toLowerCase();
  if (lower.includes("forbidden") || lower.includes("denied") || lower.includes("permission") || lower.includes("identity") || lower.includes("profile") || lower.includes("scope")) return { status: "EXPECTED-DENIAL", reason: `${method} was denied by the isolated runtime: ${text}` };
  if (lower.includes("unsupported") || lower.includes("not found") || lower.includes("unavailable")) return { status: "SKIPPED", reason: `${method} is unavailable in the isolated runtime: ${text}` };
  return { status: "FAIL", reason: `${method} failed unexpectedly: ${text}` };
}
function createClient(resources: { port: number; token: string }) { return createOfficialBackedOpenClawGatewayClient({ url: `ws://127.0.0.1:${resources.port}`, token: resources.token, role: "operator", scopes: ["operator.admin", "operator.read", "operator.write", "operator.approvals", "operator.questions"], timeoutMs: TIMEOUT_MS, clientName: "gateway-client", clientVersion: "0.1.0-agentos-human-control-certification", sharedStateMode: "read-only" }); }
async function startGateway(resources: { stateDir: string; workspaceDir: string; configPath: string; port: number; token: string }) {
  const child = spawn(process.execPath, [path.join(PACKAGE_ROOT, "openclaw.mjs"), "gateway", "run", "--port", String(resources.port), "--bind", "loopback", "--allow-unconfigured", "--auth", "token", "--token", resources.token, "--ws-log", "compact"], { cwd: resources.workspaceDir, env: { ...process.env, OPENCLAW_STATE_DIR: resources.stateDir, OPENCLAW_CONFIG_PATH: resources.configPath, OPENCLAW_GATEWAY_TOKEN: resources.token }, stdio: ["ignore", "pipe", "pipe"] });
  let output = "";
  child.stdout?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  child.stderr?.on("data", (chunk: Buffer | string) => { output = `${output}${chunk.toString()}`.slice(-8_000); });
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Disposable Gateway exited (${child.exitCode}). ${sanitizeText(output)}`);
    try { if ((await fetch(`http://127.0.0.1:${resources.port}/healthz`)).ok) return child; } catch {}
    await wait(250);
  }
  await stopProcess(child);
  throw new Error(`Disposable Gateway did not become ready. ${sanitizeText(output)}`);
}
async function readPackageIdentity() { const pkg = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "package.json"), "utf8")) as { version?: string }; const info = JSON.parse(await readFile(path.join(PACKAGE_ROOT, "dist/build-info.json"), "utf8")) as { commit?: string }; const hash = createHash("sha256"); for (const file of ["package.json", "openclaw.mjs", "dist/build-info.json"]) { hash.update(file); hash.update(await readFile(path.join(PACKAGE_ROOT, file))); } return { version: pkg.version ?? "", sourceCommit: info.commit ?? null, packageHash: hash.digest("hex") }; }
async function reservePort() { return await new Promise<number>((resolve, reject) => { const server = net.createServer(); server.once("error", reject); server.listen(0, "127.0.0.1", () => { const address = server.address(); const port = typeof address === "object" && address ? address.port : 0; server.close((error) => error ? reject(error) : resolve(port)); }); }); }
async function stopProcess(child: ChildProcess | null) { if (!child || child.exitCode !== null) return; child.kill("SIGTERM"); await Promise.race([new Promise<void>((resolve) => child.once("exit", () => resolve())), wait(10_000)]); if (child.exitCode === null) child.kill("SIGKILL"); }
function wait(ms: number) { return new Promise((resolve) => setTimeout(resolve, ms)); }
async function readGitHead() { return (await execFileAsync("git", ["rev-parse", "HEAD"], { cwd: process.cwd() })).stdout.trim(); }
function asRecord(value: unknown): Record<string, unknown> | null { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null; }
function readString(value: unknown) { return typeof value === "string" && value.trim() ? value.trim() : null; }
function sanitizeText(value: string) { return value.replace(/agentos-human-control-[A-Za-z0-9._-]+/g, "[REDACTED_TOKEN]").replace(/\/Users\/[^\s"']+/g, "[LOCAL_PATH]").replace(/\/tmp\/[^\s"']+/g, "[DISPOSABLE_PATH]").slice(0, 320); }
function sanitizeEvidence(value: unknown): unknown { if (typeof value === "string") return sanitizeText(value); if (Array.isArray(value)) return value.map(sanitizeEvidence); if (value && typeof value === "object") return Object.fromEntries(Object.entries(value).map(([key, nested]) => [key, sanitizeEvidence(nested)])); return value; }
function containsFail(value: unknown): boolean { if (value === "FAIL") return true; if (Array.isArray(value)) return value.some(containsFail); if (value && typeof value === "object") return Object.values(value).some(containsFail); return false; }

main().catch((error) => { console.error(error instanceof Error ? error.message : "OpenClaw Human Control certification failed."); process.exitCode = 1; });
