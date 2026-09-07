import assert from "node:assert/strict";
import { test } from "node:test";

import {
  canAgentOsActorUseProductPermission,
  getAgentOsProductPermissionMatrix
} from "@/lib/security/agentos-product-authorization";
import type { AgentOsActorContext } from "@/lib/security/agentos-actor";

const owner: AgentOsActorContext = {
  actorId: "00000000-0000-4000-8000-000000000001",
  kind: "instance-operator",
  username: "owner",
  displayName: "Owner",
  authenticationMethod: "instance-session",
  authenticated: true,
  agentOsRole: "owner"
};
const member: AgentOsActorContext = { ...owner, actorId: "00000000-0000-4000-8000-000000000002", username: "member", agentOsRole: "member" };
const service: AgentOsActorContext = { ...owner, actorId: "service:agentos-api-token", kind: "service", username: null, displayName: null, authenticationMethod: "api-token" };
const desktop: AgentOsActorContext = { ...owner, actorId: "operator:agentos-desktop", kind: "desktop-operator", username: null, displayName: null, authenticationMethod: "desktop-token" };

test("central product policy separates owner controls from member runtime access", () => {
  assert.equal(canAgentOsActorUseProductPermission(owner, "users.manage"), true);
  assert.equal(canAgentOsActorUseProductPermission(owner, "gateway.manage"), true);
  assert.equal(canAgentOsActorUseProductPermission(owner, "automations.manage"), true);
  assert.equal(canAgentOsActorUseProductPermission(member, "runtime.use"), true);
  assert.equal(canAgentOsActorUseProductPermission(member, "sessions.use"), true);
  assert.equal(canAgentOsActorUseProductPermission(owner, "sessions.collaborate"), true);
  assert.equal(canAgentOsActorUseProductPermission(owner, "sessions.place"), true);
  assert.equal(canAgentOsActorUseProductPermission(member, "sessions.collaborate"), false);
  assert.equal(canAgentOsActorUseProductPermission(member, "sessions.place"), false);
  assert.equal(canAgentOsActorUseProductPermission(service, "sessions.collaborate"), false);
  assert.equal(canAgentOsActorUseProductPermission(service, "sessions.place"), false);
  assert.equal(canAgentOsActorUseProductPermission(member, "users.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(member, "gateway.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(member, "secrets.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(member, "models.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(member, "automations.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(service, "users.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(service, "gateway.manage"), true);
  assert.equal(canAgentOsActorUseProductPermission(service, "lifecycle.manage"), false);
  assert.equal(canAgentOsActorUseProductPermission(desktop, "lifecycle.manage"), true);
  assert.equal(canAgentOsActorUseProductPermission(desktop, "users.manage"), true);
});

test("permission matrix is bounded and explicit for service/internal actors", () => {
  const matrix = getAgentOsProductPermissionMatrix();
  assert.ok(matrix.owner.includes("users.manage"));
  assert.ok(matrix.owner.includes("sessions.collaborate"));
  assert.ok(matrix.owner.includes("sessions.place"));
  assert.ok(matrix.owner.includes("models.manage"));
  assert.ok(matrix.member.includes("runtime.use"));
  assert.ok(!matrix.member.includes("sessions.collaborate"));
  assert.ok(!matrix.member.includes("sessions.place"));
  assert.ok(!matrix.member.includes("lifecycle.manage"));
  assert.ok(!matrix.service.includes("users.manage"));
});

test("reported permission matrix matches effective enforcement", () => {
  const matrix = getAgentOsProductPermissionMatrix();
  const actors = { owner, member, service, internalService: { ...owner, kind: "internal-service" as const, agentOsRole: null, authenticationMethod: "internal-service" as const, actorId: "service:agentos-internal" } };
  const permissions = new Set(Object.values(matrix).flat());
  for (const permission of permissions) {
    for (const [actorName, actor] of Object.entries(actors)) {
      assert.equal(
        canAgentOsActorUseProductPermission(actor, permission),
        matrix[actorName as keyof typeof matrix].includes(permission),
        `${actorName} / ${permission}`
      );
    }
  }
});
