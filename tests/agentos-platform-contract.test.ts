import assert from "node:assert/strict";
import test from "node:test";

import {
  DESKTOP_PLATFORM_CAPABILITIES,
  WEB_PLATFORM_CAPABILITIES,
  getPlatformCapabilities
} from "@/lib/agentos/platform";
import type { AgentRuntime, RuntimeStatus } from "@/lib/agentos/runtime-contract";

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
    subscribe: () => ({ unsubscribe() {} })
  } satisfies AgentRuntime;

  assert.equal((await runtime.getStatus()).runtimeId, "openclaw-local");
  assert.equal((await runtime.getCapabilities()).taskExecution, true);
});
