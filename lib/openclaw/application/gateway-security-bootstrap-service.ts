import "server-only";

import {
  resolveAgentOsDeploymentCapabilities,
  type AgentOsDeploymentCapabilities
} from "@/lib/agentos/deployment-capabilities";
import {
  createInternalServiceActorContext
} from "@/lib/security/agentos-actor";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import {
  reconcileAgentOsSessionSecurityDefaults,
  type AgentOsSessionSecurityMigrationResult
} from "@/lib/openclaw/domains/session-security-policy";
import { getOpenClawAdapter, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";

export type GatewaySecurityBootstrapResult = AgentOsSessionSecurityMigrationResult & {
  ready: boolean;
  reason: string | null;
  configOwnership: AgentOsDeploymentCapabilities["gatewayConfigOwnership"];
};

/**
 * The only application-level owner of the managed Gateway security bootstrap.
 * It is safe to call from readiness probes: the domain reconciler writes only
 * omitted values, and a second call becomes a read-only verification.
 */
export async function bootstrapAgentOsGatewaySecurity(options: {
  adapter?: OpenClawAdapter;
  env?: Readonly<Record<string, string | undefined>>;
  platform?: NodeJS.Platform;
  deploymentCapabilities?: AgentOsDeploymentCapabilities;
  audit?: boolean;
} = {}): Promise<GatewaySecurityBootstrapResult> {
  const env = options.env ?? process.env;
  const capabilities = options.deploymentCapabilities ?? resolveAgentOsDeploymentCapabilities(env, options.platform ?? process.platform);
  const result = await reconcileAgentOsSessionSecurityDefaults({
    adapter: options.adapter ?? getOpenClawAdapter(),
    deploymentCapabilities: capabilities
  });
  const ready = result.status === "unchanged" || result.status === "migrated";

  if (options.audit !== false && result.status !== "unchanged") {
    await recordAgentOsAuditEvent({
      actor: createInternalServiceActorContext(),
      operation: "openclaw.security.bootstrap",
      targetKind: "openclaw-gateway-security",
      targetId: "agentos-session-security",
      result: result.status === "migrated"
        ? "succeeded"
        : result.status === "failed"
          ? "failed"
          : "denied",
      env: { ...process.env, ...env }
    }).catch(() => {});
  }

  return {
    ...result,
    ready,
    reason: ready ? null : result.posture.explanation,
    configOwnership: capabilities.gatewayConfigOwnership
  };
}
