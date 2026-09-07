import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_PLATFORM_CAPABILITIES,
  WEB_PLATFORM_CAPABILITIES,
  getPlatformCapabilities
} from "@/lib/agentos/platform";
import type { AgentRuntime, RuntimeStatus } from "@/lib/agentos/runtime-contract";
import { RuntimeRegistry } from "@/lib/agentos/runtime-registry";
import type { DesktopProductSnapshot } from "@/lib/agentos/product-contract";

test("platform capabilities keep native authority out of the web surface", () => {
  assert.equal(getPlatformCapabilities("web"), WEB_PLATFORM_CAPABILITIES);
  assert.equal(getPlatformCapabilities("desktop"), DESKTOP_PLATFORM_CAPABILITIES);
  assert.equal(WEB_PLATFORM_CAPABILITIES.nativeFilesystem, false);
  assert.equal(DESKTOP_PLATFORM_CAPABILITIES.localRuntimeControl, true);
});

test("runtime contract models real lifecycle state without provider-specific payloads", async () => {
  const status: RuntimeStatus = {
    runtimeId: "openclaw-local",
    kind: "openclaw",
    displayName: "OpenClaw",
    connection: "local",
    installed: true,
    running: false,
    ready: false,
    health: "offline",
    version: "2026.9.1",
    pid: null,
    reason: "Gateway is stopped.",
    checkedAt: new Date().toISOString()
  };
  const runtime = {
    id: "openclaw-local",
    kind: "openclaw" as const,
    getCapabilities: async () => ({ ...DESKTOP_PLATFORM_CAPABILITIES, browser: true, memory: true, skills: true, multiAgent: true, taskExecution: true }),
    getStatus: async () => status,
    start: async () => status,
    stop: async () => status,
    restart: async () => status,
    doctor: async () => ({ runtimeId: "openclaw-local", status: "offline" as const, summary: "Gateway is stopped.", issues: [], checkedAt: status.checkedAt }),
    getLogs: async () => [],
    subscribe: () => ({ unsubscribe() {} })
  } satisfies AgentRuntime;

  assert.equal((await runtime.getStatus()).runtimeId, "openclaw-local");
  assert.equal((await runtime.getCapabilities()).taskExecution, true);
});

test("runtime registry only exposes explicitly registered providers", () => {
  const runtime = {
    id: "openclaw-local",
    kind: "openclaw" as const,
    getCapabilities: async () => ({ ...DESKTOP_PLATFORM_CAPABILITIES, browser: true, memory: true, skills: true, multiAgent: true, taskExecution: true }),
    getStatus: async () => ({
      runtimeId: "openclaw-local",
      kind: "openclaw" as const,
      displayName: "OpenClaw",
      connection: "local" as const,
      installed: false,
      running: false,
      ready: false,
      health: "unknown" as const,
      version: null,
      pid: null,
      reason: null,
      checkedAt: new Date().toISOString()
    }),
    start: async () => { throw new Error("unsupported in contract fixture"); },
    stop: async () => { throw new Error("unsupported in contract fixture"); },
    restart: async () => { throw new Error("unsupported in contract fixture"); },
    doctor: async () => { throw new Error("unsupported in contract fixture"); },
    getLogs: async () => [],
    subscribe: () => ({ unsubscribe() {} })
  } satisfies AgentRuntime;
  const registry = new RuntimeRegistry([runtime]);

  assert.deepEqual(registry.list().map((item) => item.id), ["openclaw-local"]);
  assert.equal(registry.get("hermes-local"), undefined);
  assert.throws(() => registry.register(runtime), /already registered/);
});

test("desktop product contract requires an explicit local OpenClaw target", () => {
  const snapshot: DesktopProductSnapshot = {
    generatedAt: "0",
    source: "openclaw-cli",
    mode: "degraded",
    reason: "Gateway readiness is not verified.",
    issues: [],
    agents: [],
    missions: [],
    approvals: [],
    activity: [],
    models: [],
    skills: [],
    memory: { available: false, indexedFiles: 0, dirty: false, reason: null },
    executionTargets: [{
      id: "this-computer-openclaw",
      label: "This Computer · OpenClaw",
      runtimeId: "openclaw-local",
      location: "local",
      status: "degraded",
      capabilities: { filesystem: true, terminal: true, browser: false, memory: false, skills: false, multiAgent: false }
    }],
    connections: [],
    connectivity: { cliInstalled: true, gatewayReachable: true, gatewayReady: false, reason: "Gateway is not ready." }
  };

  assert.equal(snapshot.source, "openclaw-cli");
  assert.equal(snapshot.executionTargets[0]?.label, "This Computer · OpenClaw");
  assert.equal(snapshot.executionTargets[0]?.capabilities.browser, false);
});
