import "server-only";

import { NextResponse } from "next/server";

import {
  requireAgentOsActorContext,
  type AgentOsActorContext,
  type AgentOsActorResult
} from "@/lib/security/agentos-actor";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";

export type AgentOsProductPermission =
  | "runtime.use"
  | "sessions.use"
  | "sessions.collaborate"
  | "sessions.place"
  | "tasks.use"
  | "automations.manage"
  | "missions.use"
  | "agents.read"
  | "agents.manage"
  | "workspace.manage"
  | "profile.manage"
  | "users.manage"
  | "gateway.manage"
  | "lifecycle.manage"
  | "updates.manage"
  | "migrations.manage"
  | "security.manage"
  | "secrets.manage"
  | "models.manage"
  | "openclaw.roles.manage";

export type AgentOsProductAuthorizationResult =
  | { actor: AgentOsActorContext; permission: AgentOsProductPermission }
  | { response: NextResponse };

const MEMBER_PERMISSIONS = new Set<AgentOsProductPermission>([
  "runtime.use",
  "sessions.use",
  "tasks.use",
  "missions.use",
  "agents.read",
  "profile.manage"
]);

const SERVICE_PERMISSIONS = new Set<AgentOsProductPermission>([
  "runtime.use",
  "sessions.use",
  "tasks.use",
  "missions.use",
  "agents.read",
  "agents.manage",
  "automations.manage",
  "gateway.manage",
  "updates.manage",
  "migrations.manage"
]);

const INTERNAL_SERVICE_PERMISSIONS = new Set<AgentOsProductPermission>([
  "runtime.use",
  "sessions.use",
  "tasks.use",
  "missions.use",
  "agents.read",
  "agents.manage",
  "automations.manage",
  "workspace.manage",
  "gateway.manage",
  "lifecycle.manage",
  "updates.manage",
  "migrations.manage",
  "security.manage",
  "secrets.manage",
  "models.manage",
  "openclaw.roles.manage"
]);

const OWNER_PERMISSIONS = new Set<AgentOsProductPermission>([
  "runtime.use",
  "sessions.use",
  "sessions.collaborate",
  "sessions.place",
  "tasks.use",
  "missions.use",
  "agents.read",
  "agents.manage",
  "workspace.manage",
  "profile.manage",
  "users.manage",
  "automations.manage",
  "gateway.manage",
  "lifecycle.manage",
  "updates.manage",
  "migrations.manage",
  "security.manage",
  "secrets.manage",
  "models.manage",
  "openclaw.roles.manage"
]);

export function getAgentOsProductPermissionMatrix() {
  return {
    owner: [...OWNER_PERMISSIONS],
    member: [...MEMBER_PERMISSIONS],
    service: [...SERVICE_PERMISSIONS],
    internalService: [...INTERNAL_SERVICE_PERMISSIONS]
  } satisfies Record<string, AgentOsProductPermission[]>;
}

export function canAgentOsActorUseProductPermission(
  actor: AgentOsActorContext,
  permission: AgentOsProductPermission
) {
  if (actor.authenticationMethod === "unprotected-local") return true;
  if (actor.kind === "internal-service") return INTERNAL_SERVICE_PERMISSIONS.has(permission);
  if (actor.kind === "desktop-operator") return OWNER_PERMISSIONS.has(permission);
  if (actor.kind === "service") return SERVICE_PERMISSIONS.has(permission);
  if (actor.agentOsRole === "owner") return OWNER_PERMISSIONS.has(permission);
  if (actor.agentOsRole === "member") return MEMBER_PERMISSIONS.has(permission);
  return false;
}

export async function requireAgentOsProductPermission(
  request: Request,
  permission: AgentOsProductPermission
): Promise<AgentOsProductAuthorizationResult> {
  const actorResult: AgentOsActorResult = await requireAgentOsActorContext(request);
  if ("response" in actorResult) return actorResult;
  if (canAgentOsActorUseProductPermission(actorResult.actor, permission)) {
    return { actor: actorResult.actor, permission };
  }

  await recordAgentOsAuditEvent({
    actor: actorResult.actor,
    operation: `product.${permission}`,
    targetKind: "product-permission",
    targetId: permission,
    result: "denied"
  }).catch(() => {});

  return {
    response: NextResponse.json(
      {
        error: "Your AgentOS role does not allow this operation.",
        code: "agentos-permission-denied",
        permission
      },
      {
        status: 403,
        headers: {
          "Cache-Control": "no-store",
          "X-Content-Type-Options": "nosniff"
        }
      }
    )
  };
}

export function requireOwnerProductPermission(
  actor: AgentOsActorContext,
  permission: Extract<AgentOsProductPermission, "users.manage" | "automations.manage" | "gateway.manage" | "lifecycle.manage" | "updates.manage" | "migrations.manage" | "security.manage" | "secrets.manage" | "models.manage" | "openclaw.roles.manage">
) {
  return (actor.kind === "instance-operator" || actor.kind === "desktop-operator") && actor.agentOsRole === "owner" && canAgentOsActorUseProductPermission(actor, permission);
}
