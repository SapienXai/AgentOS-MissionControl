/**
 * The OpenClaw 2026.9.x workspace contract as used by AgentOS.
 *
 * This registry is intentionally small. It describes the native workspace
 * files and their lifecycle; AgentOS project documents and skills are
 * separate application-owned context layered on top of it.
 */
export const OPENCLAW_NATIVE_WORKSPACE_BOOTSTRAP_FILES = [
  {
    path: "AGENTS.md",
    kind: "context",
    requirement: "required",
    lifecycle: "persistent",
    generatedByAgentOS: true
  },
  {
    path: "SOUL.md",
    kind: "context",
    requirement: "optional",
    lifecycle: "persistent",
    generatedByAgentOS: true
  },
  {
    path: "IDENTITY.md",
    kind: "context",
    requirement: "optional",
    lifecycle: "persistent",
    generatedByAgentOS: true
  },
  {
    path: "USER.md",
    kind: "context",
    requirement: "optional",
    lifecycle: "persistent",
    generatedByAgentOS: true
  },
  {
    path: "BOOT.md",
    kind: "hook",
    requirement: "optional",
    lifecycle: "hook",
    generatedByAgentOS: false
  },
  {
    path: "BOOTSTRAP.md",
    kind: "first-run",
    requirement: "first-run-required",
    lifecycle: "first-run",
    generatedByAgentOS: false
  },
  {
    path: "MEMORY.md",
    kind: "memory",
    requirement: "optional",
    lifecycle: "persistent",
    generatedByAgentOS: true
  }
] as const;

export const OPENCLAW_NATIVE_WORKSPACE_CONTEXT_PATHS =
  OPENCLAW_NATIVE_WORKSPACE_BOOTSTRAP_FILES
    .filter((file) => file.kind === "context")
    .map((file) => file.path);

export const OPENCLAW_NATIVE_WORKSPACE_MEMORY_PATHS =
  OPENCLAW_NATIVE_WORKSPACE_BOOTSTRAP_FILES
    .filter((file) => file.kind === "memory")
    .map((file) => file.path);

/** Files recognized by older OpenClaw generations but not loaded as current bootstrap context. */
export const OPENCLAW_LEGACY_WORKSPACE_FILES = [
  {
    path: "TOOLS.md",
    replacement: "AGENTS.md#tools",
    runtime: "OpenClaw 2026.9.3 does not include TOOLS.md in the canonical workspace bootstrap."
  },
  {
    path: "HEARTBEAT.md",
    replacement: "agents.entries.<agentId>.heartbeat",
    runtime: "OpenClaw 2026.9.3 stores heartbeat cadence in native config and scratch state, not HEARTBEAT.md."
  }
] as const;

export type OpenClawNativeWorkspacePath =
  (typeof OPENCLAW_NATIVE_WORKSPACE_BOOTSTRAP_FILES)[number]["path"];

export function isLegacyOpenClawWorkspaceFile(relativePath: string) {
  return OPENCLAW_LEGACY_WORKSPACE_FILES.some((file) => file.path === relativePath);
}
