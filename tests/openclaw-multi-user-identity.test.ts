import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";

import {
  assertPinnedMethodAbsent,
  comparePinnedMethodScopes,
  parsePinnedCoreDescriptorScopes,
  PHASE_7_NATIVE_METHODS
} from "@/lib/openclaw/certification/upstream-scope";
import { projectAgentOsOpenClawIdentity } from "@/lib/openclaw/domains/native-human-identity";
import {
  reconcileNativeSessionMemberMutation,
  reconcileNativeSessionVisibilityMutation
} from "@/lib/openclaw/application/session-collaboration-service";
import { OPENCLAW_STATIC_METHOD_SCOPES } from "@/lib/openclaw/identity/contract";
import type { OpenClawUserProfile } from "@/lib/openclaw/client/types";
import type { OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { createNativeGatewayTestClient } from "@/tests/helpers/fake-openclaw-gateway";

const profile = (profileId: string, role = "operator"): OpenClawUserProfile => ({
  profileId,
  displayName: "Native operator",
  emails: ["native@example.test"],
  avatarMime: null,
  hasAvatar: false,
  mergedInto: null,
  createdAt: 1,
  updatedAt: 2,
  githubIdentity: null,
  role
});

test("the exact 9.3 user and collaboration descriptor scopes are independently verified", () => {
  const descriptors = `
    ["users.list", "users", "operator.read", "<=2026.7"],
    ["users.self", "users", "operator.read", "<=2026.7"],
    ["users.setDisplayName", "users", "operator.write", "<=2026.7"],
    ["users.setAvatar", "users", "operator.write", "<=2026.7"],
    ["users.linkEmail", "users", "operator.admin", "<=2026.7"],
    ["users.setRole", "users", "operator.admin", "2026.8"],
    ["session.visibility.set", "sessions-sharing", "operator.write", "2026.7"],
    ["session.members.list", "sessions-sharing", "operator.read", "2026.7"],
    ["session.members.listEvidence", "sessions-sharing", "operator.read", "2026.8"],
    ["session.members.add", "sessions-sharing", "operator.write", "2026.7"],
    ["session.members.remove", "sessions-sharing", "operator.write", "2026.7"],
    ["sessions.assignOwner", "sessions-mutations", "operator.write", "2026.8"],
  `;
  const upstream = parsePinnedCoreDescriptorScopes(descriptors, PHASE_7_NATIVE_METHODS);
  assert.equal(comparePinnedMethodScopes(OPENCLAW_STATIC_METHOD_SCOPES, upstream, PHASE_7_NATIVE_METHODS), true);
  assertPinnedMethodAbsent(descriptors, "users.create");
});

test("native profile data is a directory projection, not AgentOS authentication", () => {
  const identity = projectAgentOsOpenClawIdentity({
    linkage: { profileId: "profile-a", role: "admin", linkageState: "linked", lastVerifiedAt: null },
    profiles: [profile("profile-a", "operator")]
  });
  assert.equal(identity.connectionAttribution, "shared-service");
  assert.equal(identity.nativeHumanIdentityVerified, false);
  assert.equal(identity.state, "METADATA_ASSOCIATED");
  assert.equal(identity.nativeRole, "operator");
});

test("missing native profile is stale and is never remapped by presentation fields", () => {
  const identity = projectAgentOsOpenClawIdentity({
    linkage: { profileId: "profile-gone", role: "admin", linkageState: "linked", lastVerifiedAt: null },
    profiles: [profile("different-profile")]
  });
  assert.equal(identity.state, "STALE");
  assert.equal(identity.associatedProfile, null);
  assert.equal(projectAgentOsOpenClawIdentity({
    linkage: { profileId: null, role: null, linkageState: "unlinked", lastVerifiedAt: null },
    profiles: [profile("different-profile")]
  }).state, "UNLINKED");
});

test("identity routes keep native role operations separate from AgentOS role changes", async () => {
  const route = await readFile("app/api/users/openclaw/route.ts", "utf8");
  const agentOsRoute = await readFile("app/api/users/route.ts", "utf8");
  assert.match(route, /state: input\.action === "link" \? "metadata-associated"/);
  assert.match(route, /nativeHumanIdentityVerified: false/);
  assert.match(route, /users\.setRole/);
  assert.doesNotMatch(agentOsRoute, /users\.setRole/);
  assert.doesNotMatch(route, /owner: \{ type: "human", id: input\.actorId \}/);
});

test("collaboration mutations have an explicit AgentOS permission boundary", async () => {
  const product = await readFile("lib/security/agentos-product-authorization.ts", "utf8");
  const route = await readFile("app/api/sessions/ownership/route.ts", "utf8");
  assert.match(product, /"sessions\.collaborate"/);
  assert.match(route, /requireAgentOsProductPermission\(request, "sessions\.collaborate"\)/);
  assert.match(route, /productPermission: "sessions\.collaborate"/);
  assert.match(route, /ownerType: z\.literal\("human"\)/);
  assert.match(route, /listOpenClawUserProfiles/);
  assert.match(route, /session\.visibility\.set/);
  assert.match(route, /session\.members\.add/);
  assert.match(route, /session\.members\.remove/);
  assert.match(route, /reconcileNativeSessionMemberMutation/);
  assert.match(route, /reconcileNativeSessionVisibilityMutation/);
});

test("new identity and collaboration integrations remain native-only", async () => {
  const route = await readFile("app/api/sessions/ownership/route.ts", "utf8");
  const client = await readFile("lib/openclaw/client/native-ws-gateway-client.ts", "utf8");
  assert.match(route, /adapter\.assignSessionOwner/);
  assert.match(route, /reconcileNativeSessionOwnerMutation/);
  assert.doesNotMatch(route, /execFile|spawn|child_process/);
  assert.doesNotMatch(client, /"users\.create"/);
});

test("native user adapter preserves the exact 9.1 user payloads", async () => {
  const { client, gateway } = createNativeGatewayTestClient({
    gatewayOptions: { methods: ["users.list", "users.setDisplayName", "users.setAvatar", "users.linkEmail"] }
  });
  const nativeProfile = {
    id: "profile-a",
    displayName: "Native operator",
    avatarMime: null,
    mergedInto: null,
    createdAt: 1,
    updatedAt: 2,
    emails: ["native@example.test"],
    githubIdentity: null,
    hasAvatar: false,
    role: "operator"
  };
  gateway.route("users.list", (_frame, context) => context.respond({ profiles: [nativeProfile] }));
  gateway.route("users.setDisplayName", (_frame, context) => context.respond({ profile: nativeProfile }));
  gateway.route("users.setAvatar", (_frame, context) => context.respond({ profile: nativeProfile, avatarRevision: "avatar-1" }));
  gateway.route("users.linkEmail", (_frame, context) => context.respond({ profile: nativeProfile }));

  assert.deepEqual((await client.listUsers()).profiles[0], profile("profile-a"));
  await client.setUserDisplayName("profile-a", null);
  await client.setUserAvatar("profile-a", { mime: "image/png", avatarBase64: "AAAA" });
  await client.linkUserEmail("profile-a", "linked@example.test");
  assert.deepEqual(gateway.sentFrames.slice(1).map((frame) => ({ method: frame.method, params: frame.params })), [
    { method: "users.list", params: {} },
    { method: "users.setDisplayName", params: { profileId: "profile-a", displayName: null } },
    { method: "users.setAvatar", params: { profileId: "profile-a", mime: "image/png", avatarBase64: "AAAA" } },
    { method: "users.linkEmail", params: { email: "linked@example.test", targetProfileId: "profile-a" } }
  ]);
});

test("native collaboration adapter preserves exact sharing payloads", async () => {
  const { client, gateway } = createNativeGatewayTestClient({
    gatewayOptions: {
      methods: ["session.visibility.set", "session.members.add", "session.members.remove"]
    }
  });
  gateway.route("session.visibility.set", (_frame, context) => context.respond({ ok: true, sessionKey: "agent:main:shared", visibility: "read-only" }));
  gateway.route("session.members.add", (_frame, context) => context.respond({ ok: true, sessionKey: "agent:main:shared", identityId: "profile-a" }));
  gateway.route("session.members.remove", (_frame, context) => context.respond({ ok: true, sessionKey: "agent:main:shared", identityId: "profile-a" }));

  await client.setSessionVisibility({ sessionKey: "agent:main:shared", visibility: "read-only" });
  await client.addSessionMember({ sessionKey: "agent:main:shared", identityId: "profile-a" });
  await client.removeSessionMember({ sessionKey: "agent:main:shared", identityId: "profile-a" });
  assert.deepEqual(gateway.sentFrames.slice(1).map((frame) => ({ method: frame.method, params: frame.params })), [
    { method: "session.visibility.set", params: { sessionKey: "agent:main:shared", visibility: "read-only" } },
    { method: "session.members.add", params: { sessionKey: "agent:main:shared", identityId: "profile-a" } },
    { method: "session.members.remove", params: { sessionKey: "agent:main:shared", identityId: "profile-a" } }
  ]);
});

test("collaboration mutation reconciliation reads native postconditions without retrying", async () => {
  let memberReads = 0;
  let visibilityReads = 0;
  const adapter = {
    listSessionMembers: async () => {
      memberReads += 1;
      return { sessionKey: "agent:main:shared", members: [{ identityId: "profile-a", addedBy: "service", addedAt: 1 }], identities: [], role: "owner", allowedVisibilities: [] };
    },
    describeSession: async () => {
      visibilityReads += 1;
      return { session: { visibility: "read-only" } };
    }
  } as unknown as OpenClawAdapter;

  assert.equal((await reconcileNativeSessionMemberMutation({ adapter, sessionKey: "agent:main:shared", identityId: "profile-a", expectedPresent: true, timeoutMs: 100 })).verified, true);
  assert.equal((await reconcileNativeSessionVisibilityMutation({ adapter, sessionKey: "agent:main:shared", expectedVisibility: "read-only", timeoutMs: 100 })).verified, true);
  assert.equal(memberReads, 1);
  assert.equal(visibilityReads, 1);
});
