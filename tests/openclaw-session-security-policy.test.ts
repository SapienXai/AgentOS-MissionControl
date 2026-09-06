import assert from "node:assert/strict";
import { test } from "node:test";

import {
  AGENTOS_DEFAULT_AGENT_TO_AGENT_ENABLED,
  AGENTOS_DEFAULT_SESSION_TOOLS_VISIBILITY,
  reconcileAgentOsSessionSecurityDefaults,
  resolveAgentOsSessionSecurityPosture
} from "@/lib/openclaw/domains/session-security-policy";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

test("omitted 9.2 session-security values are treated as migration-required, not permissive", () => {
  const posture = resolveAgentOsSessionSecurityPosture({});

  assert.equal(posture.status, "migration-required");
  assert.equal(posture.migrationRequired, true);
  assert.equal(posture.crossAgentAccess, "disabled");
  assert.equal(posture.humanUserIsolation, "not-guaranteed-by-shared-gateway");
});

test("explicit AgentOS-safe defaults disable cross-agent access", () => {
  const posture = resolveAgentOsSessionSecurityPosture({
    sessionsVisibility: AGENTOS_DEFAULT_SESSION_TOOLS_VISIBILITY,
    agentToAgentEnabled: AGENTOS_DEFAULT_AGENT_TO_AGENT_ENABLED,
    allow: []
  });

  assert.equal(posture.status, "safe-explicit");
  assert.equal(posture.crossAgentAccess, "disabled");
  assert.equal(posture.migrationRequired, false);
});

test("explicit broad collaboration is visible as a trusted-team policy", () => {
  const posture = resolveAgentOsSessionSecurityPosture({
    sessionsVisibility: "all",
    agentToAgentEnabled: true,
    allow: ["*"]
  });

  assert.equal(posture.status, "explicit-policy");
  assert.equal(posture.crossAgentAccess, "broad-allow");
  assert.equal(posture.humanUserIsolation, "not-guaranteed-by-shared-gateway");
});

test("AgentOS migrates only omitted security values and preserves explicit operator policy", async () => {
  const writes: Array<[string, unknown]> = [];
  const config: Record<string, unknown> = { tools: { agentToAgent: { enabled: true, allow: ["agent-b"] } } };
  const adapter = {
    async getConfigSnapshot() {
      return { config };
    },
    async setConfig(path: string, value: unknown) {
      writes.push([path, value]);
      const [root, child, leaf] = path.split(".");
      const rootRecord = (config[root] ??= {}) as Record<string, unknown>;
      const childRecord = (rootRecord[child] ??= {}) as Record<string, unknown>;
      childRecord[leaf] = value;
      return { stdout: "" };
    }
  } as unknown as OpenClawAdapter;

  const result = await reconcileAgentOsSessionSecurityDefaults({
    adapter,
    deploymentCapabilities: {
      platform: "local",
      gatewayLifecycle: "agentos-managed",
      terminalAccess: "unavailable",
      browserAutomation: "unknown",
      interactiveBrowserLogin: "unavailable",
      existingBrowserSession: "unavailable",
      hostFileActions: "unavailable"
    }
  });

  assert.equal(result.status, "migrated");
  assert.deepEqual(writes, [["tools.sessions.visibility", "tree"]]);
  assert.equal(result.posture.sessionsVisibility, "tree");
  assert.equal(result.posture.agentToAgentEnabled, true);
  assert.deepEqual(result.posture.allow, ["agent-b"]);
});

test("AgentOS does not patch omitted values on an externally managed Gateway", async () => {
  const writes: string[] = [];
  const adapter = {
    async getConfigSnapshot() {
      return { config: {} };
    },
    async setConfig(path: string) {
      writes.push(path);
      return { stdout: "" };
    }
  } as unknown as OpenClawAdapter;

  const result = await reconcileAgentOsSessionSecurityDefaults({
    adapter,
    deploymentCapabilities: {
      platform: "railway",
      gatewayLifecycle: "external-supervisor",
      terminalAccess: "unavailable",
      browserAutomation: "server-headless",
      interactiveBrowserLogin: "unavailable",
      existingBrowserSession: "unavailable",
      hostFileActions: "unavailable"
    }
  });

  assert.equal(result.status, "blocked-external-runtime");
  assert.deepEqual(writes, []);
  assert.equal(result.posture.migrationBlocked, true);
});

test("AgentOS refuses to guess an omitted allowlist beside explicit broad access", async () => {
  const writes: string[] = [];
  const adapter = {
    async getConfigSnapshot() {
      return { config: { tools: { sessions: { visibility: "all" }, agentToAgent: { enabled: true } } } };
    },
    async setConfig(path: string) {
      writes.push(path);
      return { stdout: "" };
    }
  } as unknown as OpenClawAdapter;

  const result = await reconcileAgentOsSessionSecurityDefaults({
    adapter,
    deploymentCapabilities: {
      platform: "local",
      gatewayLifecycle: "agentos-managed",
      terminalAccess: "unavailable",
      browserAutomation: "unknown",
      interactiveBrowserLogin: "unavailable",
      existingBrowserSession: "unavailable",
      hostFileActions: "unavailable"
    }
  });

  assert.equal(result.status, "blocked-unsafe-policy");
  assert.deepEqual(writes, []);
});

test("AgentOS blocks invalid explicit security values fail-closed", async () => {
  const writes: string[] = [];
  const adapter = {
    async getConfigSnapshot() {
      return { config: { tools: { sessions: { visibility: "invalid" }, agentToAgent: { enabled: false, allow: [] } } } };
    },
    async setConfig(path: string) {
      writes.push(path);
      return { stdout: "" };
    }
  } as unknown as OpenClawAdapter;

  const result = await reconcileAgentOsSessionSecurityDefaults({
    adapter,
    deploymentCapabilities: {
      platform: "local",
      gatewayLifecycle: "agentos-managed",
      terminalAccess: "unavailable",
      browserAutomation: "unknown",
      interactiveBrowserLogin: "unavailable",
      existingBrowserSession: "unavailable",
      hostFileActions: "unavailable"
    }
  });

  assert.equal(result.status, "blocked-unsafe-policy");
  assert.equal(result.posture.status, "unavailable");
  assert.deepEqual(writes, []);
});
