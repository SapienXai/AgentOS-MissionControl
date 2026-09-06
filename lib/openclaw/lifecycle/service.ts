import "server-only";

import { spawn } from "node:child_process";
import { setTimeout as delay } from "node:timers/promises";

import { GatewayBackedOpenClawAdapter, getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { bootstrapAgentOsGatewaySecurity } from "@/lib/openclaw/application/gateway-security-bootstrap-service";
import {
  createOpenClawGatewayClient,
  resetOpenClawGatewayClient
} from "@/lib/openclaw/client/gateway-client-factory";
import { resolveOpenClawSpawnInvocation, buildOpenClawSpawnEnv } from "@/lib/openclaw/install";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import { OPENCLAW_SUPPORTED_BASELINE_VERSION } from "@/lib/openclaw/versions";
import { redactErrorMessage, redactSecretText } from "@/lib/security/redaction";
import { discoverGatewayRuntime } from "./runtime-discovery";
import {
  mergeSupervisorResponse,
  requestSupervisorCommand,
  SupervisorIpcError
} from "./supervisor-ipc";
import type {
  GatewayLifecycleChild,
  GatewayLifecycleOperation,
  GatewayLifecycleResult,
  GatewayLifecycleErrorCode,
  GatewayLifecycleService,
  GatewayLifecycleServiceOptions,
  GatewayReadinessResult,
  GatewayRuntimeDescriptor
} from "./types";
import { GatewayLifecycleError } from "./types";

const DEFAULT_READY_TIMEOUT_MS = 180_000;
const READY_POLL_INTERVAL_MS = 500;
const gatewayChildOutput = new WeakMap<import("node:child_process").ChildProcess, string>();

let defaultLifecycleService: OpenClawLifecycleService | null = null;

export class OpenClawLifecycleService implements GatewayLifecycleService {
  private readonly options: GatewayLifecycleServiceOptions;
  private child: GatewayLifecycleChild | null = null;
  private mutationTail = Promise.resolve();
  private maintenanceWasRunning = false;
  private crashRecoveryAttempts = 0;

  constructor(options: GatewayLifecycleServiceOptions = {}) {
    this.options = options;
  }

  async inspect() {
    const base = await this.discover();
    if (base.ownership === "unknown" || base.ownership === "unavailable") return base;

    if (base.ownership === "external-supervisor") {
      try {
        const response = await this.requestExternal("status", base);
        const current = mergeSupervisorResponse(base, response);
        if (!current.ready) return current;
        const readiness = await this.probeReadiness(current).catch(() => null);
        return readiness ? mergeReadiness(current, readiness) : current;
      } catch (error) {
        return {
          ...base,
          state: "degraded" as const,
          reason: redactErrorMessage(error, "External Gateway supervisor is unavailable.")
        };
      }
    }

    const readiness = await this.probeReadiness(base).catch(() => null);
    return readiness ? this.withManagedChildIdentity(mergeReadiness(base, readiness)) : this.withManagedChildIdentity(base);
  }

  getStatus() {
    return this.inspect();
  }

  start() {
    return this.mutate("start", async () => {
      const descriptor = await this.discover();
      this.assertMutationOwnership(descriptor, "start");
      if (descriptor.ownership === "external-supervisor") {
        const response = await this.requestExternal("start", descriptor);
        const current = mergeSupervisorResponse(descriptor, response);
        if (current.state !== "ready") return this.result("start", current, true, "External Gateway start accepted.");
        resetOpenClawGatewayClient("External Gateway started");
        const ready = await this.waitForReadiness(current);
        this.crashRecoveryAttempts = 0;
        return this.result("start", mergeReadiness(current, ready), response.message !== "Gateway supervisor status.", "External Gateway is ready.");
      }

      if (this.env().OPENCLAW_GATEWAY_PROCESS_MODE?.trim().toLowerCase() === "child") {
        const existing = await this.probeReadiness(descriptor).catch(() => null);
        if (existing?.ready) return this.result("start", this.withManagedChildIdentity(mergeReadiness(descriptor, existing)), false, "OpenClaw Gateway is already ready.");
        if (existing?.health === "live") {
          throw this.error("start", "gateway-already-running", "OpenClaw Gateway is running but not ready; AgentOS will not spawn a duplicate.", true);
        }
        this.child = await this.spawnChild(descriptor);
        const ready = await this.waitForReadiness(descriptor);
        this.crashRecoveryAttempts = 0;
        return this.result("start", this.withManagedChildIdentity(mergeReadiness(descriptor, ready)), true, "OpenClaw Gateway started and is ready.");
      }

      await getOpenClawAdapter().controlGateway("start");
      resetOpenClawGatewayClient("Gateway started");
      const ready = await this.waitForReadiness(descriptor);
      return this.result("start", mergeReadiness(descriptor, ready), true, "OpenClaw Gateway started and is ready.");
    });
  }

  stop() {
    return this.mutate("stop", async () => {
      const descriptor = await this.discover();
      this.assertMutationOwnership(descriptor, "stop");
      if (descriptor.ownership === "external-supervisor") {
        const response = await this.requestExternal("stop", descriptor);
        resetOpenClawGatewayClient("External Gateway stopped");
        return this.result("stop", mergeSupervisorResponse(descriptor, response), true, "External Gateway stopped.");
      }
      if (this.child) {
        const child = this.child;
        this.child = null;
        await this.stopChild(child);
      } else if (descriptor.state === "stopped" || descriptor.health === "not-live") {
        return this.result("stop", { ...descriptor, state: "stopped", ready: false, authenticated: false }, false, "OpenClaw Gateway was already stopped.");
      } else {
        await getOpenClawAdapter().controlGateway("stop");
      }
      resetOpenClawGatewayClient("Gateway stopped");
      return this.result("stop", { ...descriptor, state: "stopped", ready: false, authenticated: false, reason: "OpenClaw Gateway stop completed." }, true, "OpenClaw Gateway stopped.");
    });
  }

  restart() {
    return this.mutate("restart", async () => this.restartInternal(await this.discover()));
  }

  waitForReady(timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
    return this.mutate("waitForReady", async () => {
      let descriptor = await this.discover();
      this.assertReadOwnership(descriptor, "waitForReady");
      if (descriptor.ownership === "external-supervisor") {
        const response = await this.requestExternal("status", descriptor);
        descriptor = mergeSupervisorResponse(descriptor, response);
      }
      const ready = await this.waitForReadiness(descriptor, timeoutMs);
      return this.result("waitForReady", this.withManagedChildIdentity(mergeReadiness(descriptor, ready)), false, "OpenClaw Gateway is ready.");
    });
  }

  recover() {
    return this.mutate("recover", async () => {
      if (this.crashRecoveryAttempts >= (this.options.crashRecoveryLimit ?? 3)) {
        const descriptor = await this.discover();
        throw this.error("recover", "gateway-crash-loop", "OpenClaw Gateway recovery is blocked after bounded crash-loop protection.", false, { attempts: this.crashRecoveryAttempts, descriptor: descriptor.state });
      }
      this.crashRecoveryAttempts += 1;
      return this.restartInternal(await this.discover(), "recover");
    });
  }

  prepareForMaintenance() {
    return this.mutate("prepareForMaintenance", async () => {
      const descriptor = await this.discover();
      this.assertMutationOwnership(descriptor, "prepareForMaintenance");
      this.maintenanceWasRunning = descriptor.state === "ready" || descriptor.state === "running";
      if (!this.maintenanceWasRunning) return this.result("prepareForMaintenance", descriptor, false, "Gateway maintenance boundary prepared; Gateway was already stopped.");
      const result = await this.stopInternal(descriptor);
      return { ...result, operation: "prepareForMaintenance", message: "Gateway stopped at the maintenance boundary." };
    });
  }

  resumeAfterMaintenance() {
    return this.mutate("resumeAfterMaintenance", async () => {
      if (!this.maintenanceWasRunning) {
        const descriptor = await this.discover();
        return this.result("resumeAfterMaintenance", descriptor, false, "Gateway was not running before maintenance.");
      }
      this.maintenanceWasRunning = false;
      const result = await this.startInternal(await this.discover());
      return { ...result, operation: "resumeAfterMaintenance", message: "Gateway resumed after maintenance." };
    });
  }

  private async startInternal(descriptor: GatewayRuntimeDescriptor) {
    if (descriptor.ownership === "external-supervisor") {
      const response = await this.requestExternal("start", descriptor);
      resetOpenClawGatewayClient("External Gateway resumed after maintenance");
      this.crashRecoveryAttempts = 0;
      return this.result("start", mergeSupervisorResponse(descriptor, response), true, "External Gateway started.");
    }
    if (this.env().OPENCLAW_GATEWAY_PROCESS_MODE?.trim().toLowerCase() === "child") {
      this.child = await this.spawnChild(descriptor);
      const ready = await this.waitForReadiness(descriptor);
      this.crashRecoveryAttempts = 0;
      return this.result("start", this.withManagedChildIdentity(mergeReadiness(descriptor, ready)), true, "OpenClaw Gateway resumed.");
    }
    await getOpenClawAdapter().controlGateway("start");
    resetOpenClawGatewayClient("Gateway resumed after maintenance");
    this.crashRecoveryAttempts = 0;
    const ready = await this.waitForReadiness(descriptor);
    return this.result("start", mergeReadiness(descriptor, ready), true, "OpenClaw Gateway resumed and is ready.");
  }

  private async restartInternal(descriptor: GatewayRuntimeDescriptor, operation: "restart" | "recover" = "restart") {
    this.assertMutationOwnership(descriptor, operation);
    if (descriptor.ownership === "external-supervisor") {
      const response = await this.requestExternal("restart", descriptor);
      const current = mergeSupervisorResponse(descriptor, response);
      resetOpenClawGatewayClient("External Gateway restarted");
      const ready = await this.waitForReadiness(current);
      if (operation === "restart") this.crashRecoveryAttempts = 0;
      return this.result(operation, mergeReadiness(current, ready), true, "External Gateway restarted and is ready.");
    }
    if (this.env().OPENCLAW_GATEWAY_PROCESS_MODE?.trim().toLowerCase() === "child") {
      if (this.child) {
        const child = this.child;
        this.child = null;
        await this.stopChild(child);
      }
      this.child = await this.spawnChild(descriptor);
      const ready = await this.waitForReadiness(descriptor);
      if (operation === "restart") this.crashRecoveryAttempts = 0;
      return this.result(operation, this.withManagedChildIdentity(mergeReadiness(descriptor, ready)), true, "OpenClaw Gateway restarted and is ready.");
    }
    await getOpenClawAdapter().controlGateway("restart", { force: true });
    resetOpenClawGatewayClient("Gateway restarted");
    const ready = await this.waitForReadiness(descriptor);
    return this.result(operation, mergeReadiness(descriptor, ready), true, "OpenClaw Gateway restarted and is ready.");
  }

  private async stopInternal(descriptor: GatewayRuntimeDescriptor) {
    if (descriptor.ownership === "external-supervisor") {
      const response = await this.requestExternal("stop", descriptor);
      resetOpenClawGatewayClient("External Gateway stopped for maintenance");
      return this.result("stop", mergeSupervisorResponse(descriptor, response), true, "External Gateway stopped.");
    }
      if (this.child) {
        const child = this.child;
        this.child = null;
        await this.stopChild(child);
    } else {
      await getOpenClawAdapter().controlGateway("stop");
    }
    resetOpenClawGatewayClient("Gateway stopped for maintenance");
    return this.result("stop", { ...descriptor, state: "stopped", ready: false, authenticated: false }, true, "Gateway stopped for maintenance.");
  }

  private async discover() {
    return discoverGatewayRuntime({
      env: this.options.env,
      platform: this.options.platform,
      now: this.options.now,
      resolveBinary: this.options.resolveBinary
    });
  }

  private async probeReadiness(descriptor: GatewayRuntimeDescriptor) {
    return this.options.readinessProbe
      ? this.options.readinessProbe(descriptor)
      : probeNativeGatewayReadiness(descriptor, this.options.env, this.options.platform);
  }

  private async waitForReadiness(descriptor: GatewayRuntimeDescriptor, timeoutMs = DEFAULT_READY_TIMEOUT_MS) {
    const startedAt = Date.now();
    const expectedChild = this.child;
    let last: GatewayReadinessResult | null = null;
    while (Date.now() - startedAt < timeoutMs) {
      last = await this.probeReadiness(descriptor).catch((error) => ({
        ready: false,
        authenticated: false,
        health: "unknown" as const,
        protocolVersion: null,
        version: null,
        sourceCommit: null,
        checkedAt: new Date().toISOString(),
        reason: redactErrorMessage(error, "Gateway readiness probe failed.")
      }));
      if (last.ready) return last;
      if (expectedChild && expectedChild.process.exitCode !== null) {
        const output = gatewayChildOutput.get(expectedChild.process)?.trim();
        throw this.error("waitForReady", "gateway-crashed", `OpenClaw Gateway exited during readiness (code ${expectedChild.process.exitCode ?? "unknown"}).${output ? ` ${redactSecretText(output).slice(-2_000)}` : ""}`, false);
      }
      await delay(READY_POLL_INTERVAL_MS);
    }
    throw this.error("waitForReady", "gateway-not-ready", last?.reason || "OpenClaw Gateway did not become ready in time.", true);
  }

  private async spawnChild(descriptor: GatewayRuntimeDescriptor) {
    if (!descriptor.binaryPath) throw this.error("start", "gateway-binary-unavailable", "OpenClaw Gateway binary could not be resolved.", false);
    const child = this.options.spawnGateway
      ? await this.options.spawnGateway(descriptor)
      : await spawnGatewayChild(descriptor, this.options.env ? { ...this.options.env } : process.env);
    this.child = child;
    child.process.once("exit", () => {
      if (this.child?.process === child.process) {
        this.child = null;
        void this.recover().catch(() => {});
      }
    });
    return child;
  }

  private async stopChild(child: GatewayLifecycleChild) {
    if (this.options.stopGateway) {
      await this.options.stopGateway(child);
      return;
    }
    if (child.process.exitCode !== null) return;
    child.process.kill("SIGTERM");
    await waitForChildExit(child.process, 5_000);
    if (child.process.exitCode === null) {
      child.process.kill("SIGKILL");
      await waitForChildExit(child.process, 5_000);
    }
  }

  private async requestExternal(command: "status" | "start" | "stop" | "restart", descriptor: GatewayRuntimeDescriptor) {
    const operation = command === "status" ? "inspect" : command;
    if (!descriptor.supervisorEndpoint) throw this.error(operation, "external-supervisor-unavailable", "External Gateway supervisor endpoint is not configured.", true);
    try {
      return await (this.options.externalSupervisor
        ? this.options.externalSupervisor.request(command)
        : requestSupervisorCommand(descriptor.supervisorEndpoint, command, { timeoutMs: command === "status" ? 5_000 : 150_000 }));
    } catch (error) {
      if (error instanceof SupervisorIpcError) {
        throw this.error(command === "status" ? "inspect" : command, error.code === "external-supervisor-unavailable" ? "external-supervisor-unavailable" : "external-supervisor-rejected", error.message, error.retryable);
      }
      throw this.error(command === "status" ? "inspect" : command, "external-supervisor-protocol", redactErrorMessage(error, "External Gateway supervisor request failed."), false);
    }
  }

  private withManagedChildIdentity(descriptor: GatewayRuntimeDescriptor) {
    if (descriptor.ownership !== "agentos-managed" || !this.child) return descriptor;
    return {
      ...descriptor,
      pid: this.child.pid > 1 ? this.child.pid : null,
      generation: this.child.generation
    };
  }

  private assertMutationOwnership(descriptor: GatewayRuntimeDescriptor, operation: GatewayLifecycleOperation) {
    if (descriptor.ownership === "unknown") throw this.error(operation, "ownership-unknown", "Gateway lifecycle ownership is unknown; mutation is blocked.", false);
    if (descriptor.ownership === "unavailable") throw this.error(operation, "ownership-unavailable", "Gateway lifecycle is unavailable in this deployment.", false);
  }

  private assertReadOwnership(descriptor: GatewayRuntimeDescriptor, operation: GatewayLifecycleOperation) {
    if (descriptor.ownership === "unknown") throw this.error(operation, "ownership-unknown", "Gateway lifecycle ownership is unknown; readiness is blocked.", false);
    if (descriptor.ownership === "unavailable") throw this.error(operation, "ownership-unavailable", "Gateway lifecycle is unavailable in this deployment.", false);
  }

  private mutate<T extends GatewayLifecycleResult>(operation: GatewayLifecycleOperation, task: () => Promise<T>): Promise<T> {
    const next = this.mutationTail.then(task, task);
    this.mutationTail = next.then(() => undefined, () => undefined);
    return next;
  }

  private result(operation: GatewayLifecycleOperation, descriptor: GatewayRuntimeDescriptor, changed: boolean, message: string): GatewayLifecycleResult {
    return { operation, descriptor, changed, message };
  }

  private error(operation: GatewayLifecycleOperation, code: GatewayLifecycleErrorCode, message: string, retryable: boolean, details?: Record<string, unknown>) {
    return new GatewayLifecycleError({ code, message, retryable, operation, details });
  }

  private env() {
    return this.options.env ?? process.env;
  }
}

export function getOpenClawLifecycleService() {
  if (!defaultLifecycleService) defaultLifecycleService = new OpenClawLifecycleService();
  return defaultLifecycleService;
}

export function setOpenClawLifecycleServiceForTesting(service: OpenClawLifecycleService | null) {
  defaultLifecycleService = service;
}

async function probeNativeGatewayReadiness(
  descriptor: GatewayRuntimeDescriptor,
  env: Readonly<Record<string, string | undefined>> = process.env,
  platform: NodeJS.Platform = process.platform
): Promise<GatewayReadinessResult> {
  const checkedAt = new Date().toISOString();
  const httpOrigin = descriptor.gatewayUrl.replace(/^ws/, "http");
  const health = await fetchGatewayEndpoint(`${httpOrigin}/healthz`).catch(() => false);
  const readyEndpoint = await fetchGatewayEndpoint(`${httpOrigin}/readyz`).catch(() => false);
  if (!health && !readyEndpoint) {
    return { ready: false, authenticated: false, health: "not-live", protocolVersion: null, version: null, sourceCommit: null, checkedAt, reason: "Gateway liveness endpoint is not available." };
  }

  const client = createOpenClawGatewayClient({
    url: descriptor.gatewayUrl,
    token: env.AGENTOS_OPENCLAW_GATEWAY_TOKEN?.trim() || env.OPENCLAW_GATEWAY_TOKEN?.trim(),
    password: env.AGENTOS_OPENCLAW_GATEWAY_PASSWORD?.trim() || env.OPENCLAW_GATEWAY_PASSWORD?.trim(),
    timeoutMs: 5_000,
    clientName: "gateway-client",
    clientVersion: "0.1.0-agentos-lifecycle",
    ...(env.OPENCLAW_STATE_DIR?.trim() ? { stateDir: env.OPENCLAW_STATE_DIR.trim() } : {}),
    sharedStateMode: "read-only"
  });
  try {
    const hello = await client.probeNativeHandshake({ timeoutMs: 5_000 });
    const status = await client.callNative<Record<string, unknown>>("status", {}, { timeoutMs: 5_000 });
    const version = readGatewayVersion(hello.server?.version, status);
    const protocolVersion = typeof hello.protocol === "number" ? hello.protocol : null;
    const versionReady = Boolean(version && compareVersionStrings(version, OPENCLAW_SUPPORTED_BASELINE_VERSION) >= 0);
    if (health && readyEndpoint && versionReady) {
      const security = await bootstrapAgentOsGatewaySecurity({
        adapter: new GatewayBackedOpenClawAdapter(() => client),
        env,
        platform
      });
      if (!security.ready) {
        return {
          ready: false,
          authenticated: true,
          health: health ? "live" : "not-live",
          protocolVersion,
          version,
          sourceCommit: descriptor.sourceCommit,
          checkedAt,
          reason: security.reason || "AgentOS Gateway session-security bootstrap did not complete."
        };
      }
    }

    return {
      ready: health && readyEndpoint && versionReady,
      authenticated: true,
      health: health ? "live" : "not-live",
      protocolVersion,
      version,
      sourceCommit: descriptor.sourceCommit,
      checkedAt,
      reason: !readyEndpoint
        ? "Gateway liveness is available but /readyz is not ready."
        : !versionReady
          ? `Gateway version ${version || "unknown"} is below the AgentOS baseline ${OPENCLAW_SUPPORTED_BASELINE_VERSION}.`
          : null
    };
  } catch (error) {
    return {
      ready: false,
      authenticated: false,
      health: health ? "live" : "unknown",
      protocolVersion: null,
      version: null,
      sourceCommit: null,
      checkedAt,
      reason: redactErrorMessage(error, "Native authenticated Gateway handshake failed.")
    };
  } finally {
    client.close("lifecycle readiness probe");
  }
}

async function spawnGatewayChild(
  descriptor: GatewayRuntimeDescriptor,
  env: Readonly<Record<string, string | undefined>> = process.env
): Promise<GatewayLifecycleChild> {
  const args = ["gateway", "run", "--port", String(descriptor.gatewayPort), "--bind", "loopback", "--allow-unconfigured", "--ws-log", "compact", "--no-color"];
  const invocation = resolveOpenClawSpawnInvocation(descriptor.binaryPath as string, args);
  const childEnvironment: NodeJS.ProcessEnv = {
    ...process.env,
    ...env,
    OPENCLAW_STATE_DIR: descriptor.stateDir,
    OPENCLAW_CONFIG_PATH: descriptor.configPath
  };
  const child = spawn(invocation.command, invocation.args, {
    cwd: process.cwd(),
    env: buildOpenClawSpawnEnv(childEnvironment),
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true
  });
  gatewayChildOutput.set(child, "");
  const appendOutput = (chunk: Buffer | string) => {
    const current = gatewayChildOutput.get(child) ?? "";
    gatewayChildOutput.set(child, `${current}${chunk.toString()}`.slice(-4_000));
  };
  child.stdout?.on("data", appendOutput);
  child.stderr?.on("data", appendOutput);
  return { process: child, pid: child.pid ?? -1, generation: Date.now() };
}

async function fetchGatewayEndpoint(url: string) {
  const response = await fetch(url, { signal: AbortSignal.timeout(1_500), cache: "no-store" });
  return response.ok;
}

function mergeReadiness(descriptor: GatewayRuntimeDescriptor, readiness: GatewayReadinessResult): GatewayRuntimeDescriptor {
  return {
    ...descriptor,
    state: readiness.ready ? "ready" : readiness.health === "live" ? "running" : "stopped",
    health: readiness.health,
    ready: readiness.ready,
    authenticated: readiness.authenticated,
    protocolVersion: readiness.protocolVersion,
    version: readiness.version ?? descriptor.version,
    sourceCommit: readiness.sourceCommit ?? descriptor.sourceCommit,
    checkedAt: readiness.checkedAt,
    reason: readiness.reason
  };
}

function readGatewayVersion(handshakeVersion: string | undefined, status: Record<string, unknown>) {
  const candidate = handshakeVersion || status.runtimeVersion || status.version || (status.overview as { version?: unknown } | undefined)?.version;
  return typeof candidate === "string" ? candidate.trim().replace(/^v/i, "") || null : null;
}

function waitForChildExit(child: import("node:child_process").ChildProcess, timeoutMs: number) {
  if (child.exitCode !== null) return Promise.resolve();
  return Promise.race([
    new Promise<void>((resolve) => child.once("exit", () => resolve())),
    delay(timeoutMs).then(() => undefined)
  ]);
}
