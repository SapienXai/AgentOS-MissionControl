import "server-only";

import { resolveAgentOsDeploymentCapabilities, type AgentOsDeploymentCapabilities } from "@/lib/agentos/deployment-capabilities";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import type { OpenClawCommandOptions } from "@/lib/openclaw/client/types";

export const AGENTOS_DEFAULT_SESSION_TOOLS_VISIBILITY = "tree" as const;
export const AGENTOS_DEFAULT_AGENT_TO_AGENT_ENABLED = false as const;
export const AGENTOS_DEFAULT_AGENT_TO_AGENT_ALLOW = [] as const;

export const OPENCLAW_SESSION_SECURITY_CONFIG_PATHS = {
  sessionsVisibility: "tools.sessions.visibility",
  agentToAgentEnabled: "tools.agentToAgent.enabled",
  agentToAgentAllow: "tools.agentToAgent.allow"
} as const;

export type OpenClawSessionToolsVisibility = "self" | "tree" | "agent" | "all";

export type AgentOsSessionSecurityPosture = {
  source: "openclaw-config";
  sessionsVisibility: OpenClawSessionToolsVisibility | null;
  agentToAgentEnabled: boolean | null;
  allow: string[];
  configured: {
    sessionsVisibility: boolean;
    agentToAgentEnabled: boolean;
    allow: boolean;
  };
  migrationRequired: boolean;
  migrationBlocked: boolean;
  status: "safe-explicit" | "explicit-policy" | "migration-required" | "invalid-explicit" | "unavailable";
  crossAgentAccess: "disabled" | "explicit-allowlist" | "broad-allow" | "unknown";
  humanUserIsolation: "not-guaranteed-by-shared-gateway";
  explanation: string;
};

export type AgentOsSessionSecurityMigrationResult = {
  posture: AgentOsSessionSecurityPosture;
  changedPaths: string[];
  status: "unchanged" | "migrated" | "blocked-external-runtime" | "blocked-unsafe-policy" | "failed";
};

export function resolveAgentOsSessionSecurityPosture(input: {
  sessionsVisibility?: unknown;
  agentToAgentEnabled?: unknown;
  allow?: unknown;
  configured?: Partial<AgentOsSessionSecurityPosture["configured"]>;
}): AgentOsSessionSecurityPosture {
  const configured = {
    sessionsVisibility: input.configured?.sessionsVisibility ?? input.sessionsVisibility !== undefined,
    agentToAgentEnabled: input.configured?.agentToAgentEnabled ?? input.agentToAgentEnabled !== undefined,
    allow: input.configured?.allow ?? input.allow !== undefined
  };
  const sessionsVisibility = normalizeVisibility(input.sessionsVisibility);
  const agentToAgentEnabled = typeof input.agentToAgentEnabled === "boolean" ? input.agentToAgentEnabled : null;
  const allow = normalizeAllow(input.allow);
  const invalidExplicit = (configured.sessionsVisibility && sessionsVisibility === null && input.sessionsVisibility !== undefined)
    || (configured.agentToAgentEnabled && agentToAgentEnabled === null && input.agentToAgentEnabled !== undefined)
    || (configured.allow && !Array.isArray(input.allow) && input.allow !== undefined);
  const migrationRequired = !configured.sessionsVisibility || !configured.agentToAgentEnabled || !configured.allow;
  const crossAgentAccess = sessionsVisibility !== "all" || agentToAgentEnabled !== true
    ? agentToAgentEnabled === false || sessionsVisibility !== "all" ? "disabled" : "unknown"
    : allow.length > 0 ? (allow.includes("*") ? "broad-allow" : "explicit-allowlist") : "broad-allow";
  const safeExplicit = configured.sessionsVisibility && configured.agentToAgentEnabled && configured.allow
    && !invalidExplicit
    && sessionsVisibility !== "all"
    && agentToAgentEnabled === false;

  let status: AgentOsSessionSecurityPosture["status"];
  let explanation: string;
  if (invalidExplicit) {
    status = "invalid-explicit";
    explanation = "OpenClaw contains an explicit session-security value that AgentOS cannot safely interpret.";
  } else if (migrationRequired) {
    status = "migration-required";
    explanation = "OpenClaw session-security settings are omitted and must be made explicit before AgentOS treats this Gateway as hardened.";
  } else if (safeExplicit) {
    status = "safe-explicit";
    explanation = "Session tools are explicitly bounded and cross-agent access is disabled by default.";
  } else {
    status = "explicit-policy";
    explanation = crossAgentAccess === "broad-allow"
      ? "OpenClaw explicitly permits broad cross-agent session access. This requires a trusted-team Gateway deployment."
      : "OpenClaw is using an explicit operator session-security policy.";
  }

  return {
    source: "openclaw-config",
    sessionsVisibility,
    agentToAgentEnabled,
    allow,
    configured,
    migrationRequired,
    migrationBlocked: false,
    status,
    crossAgentAccess,
    humanUserIsolation: "not-guaranteed-by-shared-gateway",
    explanation
  };
}

export async function readAgentOsSessionSecurityPosture(options: {
  adapter?: OpenClawAdapter;
  commandOptions?: OpenClawCommandOptions;
} = {}): Promise<AgentOsSessionSecurityPosture> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const snapshot = await adapter.getConfigSnapshot?.(options.commandOptions ?? {});
  if (!snapshot || !isRecord(snapshot.config)) {
    const [sessionsVisibility, agentToAgentEnabled, allow] = await Promise.all([
      adapter.getConfig<unknown>(OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.sessionsVisibility, options.commandOptions),
      adapter.getConfig<unknown>(OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentEnabled, options.commandOptions),
      adapter.getConfig<unknown>(OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentAllow, options.commandOptions)
    ]);
    return resolveAgentOsSessionSecurityPosture({ sessionsVisibility, agentToAgentEnabled, allow });
  }

  const config = snapshot.config;
  const sessionsVisibility = readConfigPath(config, OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.sessionsVisibility);
  const agentToAgentEnabled = readConfigPath(config, OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentEnabled);
  const allow = readConfigPath(config, OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentAllow);

  return resolveAgentOsSessionSecurityPosture({
    sessionsVisibility,
    agentToAgentEnabled,
    allow,
    configured: {
      sessionsVisibility: sessionsVisibility !== undefined,
      agentToAgentEnabled: agentToAgentEnabled !== undefined,
      allow: allow !== undefined
    }
  });
}

export async function reconcileAgentOsSessionSecurityDefaults(options: {
  adapter?: OpenClawAdapter;
  commandOptions?: OpenClawCommandOptions;
  deploymentCapabilities?: AgentOsDeploymentCapabilities;
} = {}): Promise<AgentOsSessionSecurityMigrationResult> {
  const adapter = options.adapter ?? getOpenClawAdapter();
  const before = await readAgentOsSessionSecurityPosture(options);
  if (before.status === "invalid-explicit") {
    return {
      posture: {
        ...before,
        migrationBlocked: true,
        status: "unavailable",
        explanation: "OpenClaw contains an invalid explicit session-security value. AgentOS will not guess a replacement policy."
      },
      changedPaths: [],
      status: "blocked-unsafe-policy"
    };
  }
  if (!before.migrationRequired) {
    return { posture: before, changedPaths: [], status: "unchanged" };
  }

  if (!before.configured.allow && before.sessionsVisibility === "all" && before.agentToAgentEnabled === true) {
    return {
      posture: {
        ...before,
        migrationBlocked: true,
        status: "unavailable",
        explanation: "OpenClaw explicitly enables cross-agent access but omits its allowlist. AgentOS will not guess whether that means every agent; configure an explicit allowlist before updating."
      },
      changedPaths: [],
      status: "blocked-unsafe-policy"
    };
  }

  const capabilities = options.deploymentCapabilities ?? resolveAgentOsDeploymentCapabilities();
  const configOwnership = capabilities.gatewayConfigOwnership ?? (capabilities.gatewayLifecycle === "agentos-managed" ? "agentos-managed" : "unknown");
  if (configOwnership !== "agentos-managed") {
    return {
      posture: {
        ...before,
        migrationBlocked: true,
        status: "unavailable",
        explanation: configOwnership === "external"
          ? "OpenClaw session-security settings are omitted, but this Gateway config is externally owned. The deployment operator must configure them explicitly."
          : "OpenClaw session-security settings are omitted, but config ownership is unknown. AgentOS will not patch an ambiguous Gateway."
      },
      changedPaths: [],
      status: "blocked-external-runtime"
    };
  }

  const changedPaths: string[] = [];
  try {
    if (!before.configured.sessionsVisibility) {
      await adapter.setConfig(OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.sessionsVisibility, AGENTOS_DEFAULT_SESSION_TOOLS_VISIBILITY, options.commandOptions);
      changedPaths.push(OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.sessionsVisibility);
    }
    if (!before.configured.agentToAgentEnabled) {
      await adapter.setConfig(OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentEnabled, AGENTOS_DEFAULT_AGENT_TO_AGENT_ENABLED, { ...options.commandOptions, strictJson: true });
      changedPaths.push(OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentEnabled);
    }
    if (!before.configured.allow) {
      await adapter.setConfig(OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentAllow, AGENTOS_DEFAULT_AGENT_TO_AGENT_ALLOW, { ...options.commandOptions, strictJson: true });
      changedPaths.push(OPENCLAW_SESSION_SECURITY_CONFIG_PATHS.agentToAgentAllow);
    }

    const posture = await readAgentOsSessionSecurityPosture(options);
    return { posture, changedPaths, status: changedPaths.length > 0 ? "migrated" : "unchanged" };
  } catch {
    return { posture: before, changedPaths, status: "failed" };
  }
}

export function normalizeSessionToolsVisibility(value: unknown): OpenClawSessionToolsVisibility | null {
  return value === "self" || value === "tree" || value === "agent" || value === "all" ? value : null;
}

export function normalizeAgentToAgentAllow(value: unknown): string[] {
  return Array.isArray(value)
    ? Array.from(new Set(value.filter((entry): entry is string => typeof entry === "string" && entry.trim().length > 0).map((entry) => entry.trim()))).slice(0, 128)
    : [];
}

function normalizeVisibility(value: unknown) {
  return normalizeSessionToolsVisibility(value);
}

function normalizeAllow(value: unknown) {
  return normalizeAgentToAgentAllow(value);
}

function readConfigPath(config: Record<string, unknown>, path: string) {
  let current: unknown = config;
  for (const segment of path.split(".")) {
    if (!isRecord(current) || !(segment in current)) return undefined;
    current = current[segment];
  }
  return current;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
