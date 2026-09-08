import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  BrowserAccountError,
  acquireBrowserAccountLease,
  authorizeBrowserLiveViewWebSocket,
  confirmBrowserAccountLogin,
  createBrowserAccount,
  exchangeBrowserLiveViewCapability,
  getBrowserAccount,
  getBrowserAccountRegistryPathForTesting,
  listBrowserAccounts,
  markBrowserWorkerSessionsInterrupted,
  releaseBrowserAccountLease,
  revokeBrowserAccount,
  startBrowserAccountLiveView,
  stopBrowserAccountLiveView,
  setBrowserAccountRegistryRootForTesting,
  updateBrowserAccountAccess
} from "@/lib/agentos/application/browser-account-service";
import {
  finalizeBrowserTaskBinding,
  expireBrowserTaskBindingsForRecovery,
  heartbeatBrowserTaskBinding,
  prepareBrowserTaskBinding,
  readBrowserTaskBindingsForTesting,
  recoverExpiredBrowserTaskBindings,
  setBrowserTaskBindingRegistryRootForTesting
} from "@/lib/agentos/application/browser-task-binding-service";
import { evaluateBrowserActionPolicy } from "@/lib/agentos/browser-accounts/action-policy";
import { resolveBrowserAuthenticationRule } from "@/lib/agentos/browser-accounts/authentication-rules";
import { setBrowserWorkerTransportForTesting } from "@/lib/agentos/browser-accounts/browser-worker-client";
import type { BrowserProvider } from "@/lib/agentos/browser-accounts/provider";
import { setBrowserProviderForTesting } from "@/lib/agentos/browser-accounts/provider-registry";
import { SelfHostedOpenClawBrowserProvider } from "@/lib/agentos/browser-accounts/self-hosted-openclaw-provider";
import {
  setOpenClawAdapterForTesting,
  type OpenClawAdapter
} from "@/lib/openclaw/adapter/openclaw-adapter";
import { requireBrowserPolicyChannel } from "@/lib/security/browser-policy-channel";

const temporaryRoots: string[] = [];
const revokedProfiles: string[] = [];
const stoppedSessions: string[] = [];

afterEach(async () => {
  setBrowserProviderForTesting(null);
  setBrowserAccountRegistryRootForTesting(null);
  setBrowserTaskBindingRegistryRootForTesting(null);
  setBrowserWorkerTransportForTesting(null);
  setOpenClawAdapterForTesting(null);
  revokedProfiles.length = 0;
  stoppedSessions.length = 0;
  await Promise.all(temporaryRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("self-hosted provider capability contract remains provider-agnostic and fails Live View closed", async () => {
  const provider = fakeProvider({
    liveView: "unsupported",
    humanTakeover: "unsupported",
    typedTaskDispatch: "unsupported"
  });
  const capabilities = await provider.getCapabilities();

  assert.equal(capabilities.provider, "self-hosted-openclaw");
  assert.equal(capabilities.persistentProfiles, "supported");
  assert.equal(capabilities.liveView, "unsupported");
  assert.equal(capabilities.typedTaskDispatch, "unsupported");
  await assert.rejects(
    () => provider.getLiveView({ sessionId: "session-1" }),
    /Live View is unsupported/
  );
});

test("browser account metadata is durable, isolated, redacted, and revocable", async () => {
  await useTemporaryRegistry();
  setBrowserProviderForTesting(fakeProvider());
  const created = await createBrowserAccount({
    actor: { userId: "owner-a" },
    workspaceId: "workspace-a",
    serviceName: "Example",
    primaryDomain: "example.com",
    allowedAgentIds: ["agent-a"],
    allowedDomains: ["example.com"]
  });

  assert.match(created.account.browserProfileId, /^acct-[a-f0-9]{24}$/);
  assert.equal(created.account.ownerUserId, "owner-a");
  assert.equal(created.account.workspaceId, "workspace-a");
  assert.equal(created.account.secretReference, null);
  assert.equal((await listBrowserAccounts({
    actor: { userId: "owner-a" },
    workspaceId: "workspace-a"
  })).length, 1);

  await assert.rejects(
    () => getBrowserAccount({
      actor: { userId: "owner-b" },
      accountId: created.account.id,
      workspaceId: "workspace-a"
    }),
    accessDenied
  );
  await assert.rejects(
    () => getBrowserAccount({
      actor: { userId: "owner-a" },
      accountId: created.account.id,
      workspaceId: "workspace-b"
    }),
    accessDenied
  );

  const serialized = await readFile(getBrowserAccountRegistryPathForTesting(), "utf8");
  assert.doesNotMatch(serialized, /password|cookie|rawCdp|cdpUrl|liveViewToken|otp/i);
  assert.doesNotMatch(serialized, /https?:\/\//);

  const revoked = await revokeBrowserAccount({
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a"
  });
  assert.equal(revoked.connectionStatus, "revoked");
  assert.deepEqual(revokedProfiles, [created.account.browserProfileId]);

  await assert.rejects(
    () => acquireBrowserAccountLease({
      actor: { userId: "owner-a" },
      accountId: created.account.id,
      workspaceId: "workspace-a",
      agentId: "agent-a",
      taskId: "task-after-revoke"
    }),
    (error) => error instanceof BrowserAccountError && error.code === "account-revoked"
  );
});

test("browser profile ids are isolated even for the same owner and workspace", async () => {
  await useTemporaryRegistry();
  setBrowserProviderForTesting(fakeProvider());
  const first = await createBrowserAccount(baseCreateInput());
  const second = await createBrowserAccount(baseCreateInput());

  assert.notEqual(first.account.id, second.account.id);
  assert.notEqual(first.account.browserProfileId, second.account.browserProfileId);
});

test("durable leases enforce agent ACL, single writer, stale recovery, and fencing", async () => {
  await useTemporaryRegistry();
  setBrowserProviderForTesting(fakeProvider({}, "verified"));
  const created = await createBrowserAccount(baseCreateInput());
  const account = {
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a"
  };
  await markAccountProviderVerified(created.account.id);
  const start = new Date("2026-07-23T10:00:00.000Z");

  await assert.rejects(
    () => acquireBrowserAccountLease({
      ...account,
      agentId: "agent-denied",
      taskId: "task-denied",
      now: start
    }),
    (error) => error instanceof BrowserAccountError && error.code === "agent-access-denied"
  );
  const first = await acquireBrowserAccountLease({
    ...account,
    agentId: "agent-a",
    taskId: "task-a",
    ttlMs: 15_000,
    now: start
  });
  await assert.rejects(
    () => acquireBrowserAccountLease({
      ...account,
      agentId: "agent-a",
      taskId: "task-b",
      ttlMs: 15_000,
      now: new Date(start.getTime() + 1_000)
    }),
    (error) => error instanceof BrowserAccountError && error.code === "profile-lease-conflict"
  );

  const second = await acquireBrowserAccountLease({
    ...account,
    agentId: "agent-a",
    taskId: "task-b",
    ttlMs: 15_000,
    now: new Date(start.getTime() + 16_000)
  });
  assert.ok(second.fencingToken > first.fencingToken);

  await assert.rejects(
    () => releaseBrowserAccountLease({
      ...account,
      leaseId: first.leaseId,
      fencingToken: first.fencingToken,
      now: new Date(start.getTime() + 17_000)
    }),
    (error) => error instanceof BrowserAccountError && error.code === "lease-fenced"
  );
  await releaseBrowserAccountLease({
    ...account,
    leaseId: second.leaseId,
    fencingToken: second.fencingToken,
    now: new Date(start.getTime() + 17_000)
  });

  const persisted = await getBrowserAccount(account);
  assert.equal(persisted.concurrencyLease, null);
  assert.equal(persisted.sessionState, "idle");
});

test("browser account ACL updates remain owner/workspace scoped and lock during active leases", async () => {
  await useTemporaryRegistry();
  setBrowserProviderForTesting(fakeProvider({}, "verified"));
  const created = await createBrowserAccount(baseCreateInput());
  const account = {
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a"
  };

  await assert.rejects(
    () => updateBrowserAccountAccess({
      ...account,
      actor: { userId: "owner-b" },
      allowedAgentIds: ["agent-b"],
      allowedDomains: ["admin.example.com"]
    }),
    accessDenied
  );
  await assert.rejects(
    () => updateBrowserAccountAccess({
      ...account,
      workspaceId: "workspace-b",
      allowedAgentIds: ["agent-b"],
      allowedDomains: ["admin.example.com"]
    }),
    accessDenied
  );
  await markAccountProviderVerified(created.account.id);

  const lease = await acquireBrowserAccountLease({
    ...account,
    agentId: "agent-a",
    taskId: "task-a",
    ttlMs: 60_000
  });
  await assert.rejects(
    () => updateBrowserAccountAccess({
      ...account,
      allowedAgentIds: ["agent-b"],
      allowedDomains: ["admin.example.com"]
    }),
    (error) =>
      error instanceof BrowserAccountError &&
      error.code === "access-policy-lease-conflict"
  );
  await releaseBrowserAccountLease({
    ...account,
    leaseId: lease.leaseId,
    fencingToken: lease.fencingToken
  });

  const updated = await updateBrowserAccountAccess({
    ...account,
    allowedAgentIds: ["agent-b", "agent-b"],
    allowedDomains: ["admin.example.com"]
  });
  assert.deepEqual(updated.allowedAgentIds, ["agent-b"]);
  assert.deepEqual(updated.allowedDomains, ["admin.example.com", "example.com"]);
  await assert.rejects(
    () => acquireBrowserAccountLease({
      ...account,
      agentId: "agent-a",
      taskId: "task-old-agent"
    }),
    (error) =>
      error instanceof BrowserAccountError &&
      error.code === "agent-access-denied"
  );
  const nextLease = await acquireBrowserAccountLease({
    ...account,
    agentId: "agent-b",
    taskId: "task-new-agent"
  });
  assert.equal(nextLease.holderAgentId, "agent-b");
});

test("sensitive authenticated-browser actions require approval or fail closed", () => {
  assert.equal(evaluateBrowserActionPolicy({
    actionDescription: "Read the current dashboard",
    approvalInfrastructureAvailable: false
  }).decision, "allow");
  assert.equal(evaluateBrowserActionPolicy({
    actionDescription: "Disable 2FA for the account",
    approvalInfrastructureAvailable: true
  }).decision, "require_approval");
  assert.equal(evaluateBrowserActionPolicy({
    actionDescription: "Generate an API key",
    approvalInfrastructureAvailable: false
  }).decision, "block");
});

test("authentication verification uses explicit provider rules and leaves unknown domains unverified", () => {
  const github = resolveBrowserAuthenticationRule(["github.com"]);
  assert.equal(github?.id, "github-session");
  assert.match(github?.authenticatedSelector ?? "", /user-login/);
  assert.equal(resolveBrowserAuthenticationRule(["example.com"]), null);
});

test("self-hosted provider maps a private worker marker without returning page data", async () => {
  const requests: Array<Record<string, unknown>> = [];
  setBrowserWorkerTransportForTesting(async (value) => {
    requests.push(value as unknown as Record<string, unknown>);
    return { state: "matched", hostname: "github.com" };
  });
  const verification = await new SelfHostedOpenClawBrowserProvider().verifyAuthentication({
    sessionId: "2a0f35f7-9824-4d7a-b05d-77a05f887847",
    allowedDomains: ["github.com"]
  });
  assert.equal(verification.status, "verified");
  const request = requests[0] ?? {};
  assert.equal(request?.action, "inspect-authentication");
  assert.equal("cookie" in request, false);
  assert.equal("url" in request, false);
});

test("provider-verified Live View confirmation promotes only a matched session to connected", async () => {
  await useTemporaryRegistry();
  setBrowserProviderForTesting(fakeProvider({}, "verified"));
  const created = await createBrowserAccount({
    ...baseCreateInput(),
    primaryDomain: "github.com",
    allowedDomains: ["github.com"]
  });
  const live = await startBrowserAccountLiveView({
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a"
  });
  const exchange = await exchangeBrowserLiveViewCapability({
    actor: { userId: "owner-a" },
    capability: decodeURIComponent(live.launchUrl.split("capability=")[1])
  });
  const confirmed = await confirmBrowserAccountLogin({
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a",
    providerSessionId: exchange.providerSessionId
  });
  assert.equal(confirmed.authenticationStatus, "verified");
  assert.equal(confirmed.connectionStatus, "connected");
  assert.equal(confirmed.verificationSource, "provider_verified");
});

test("user-confirmed Live View confirmation stays pending when provider verification is unavailable", async () => {
  await useTemporaryRegistry();
  setBrowserProviderForTesting(fakeProvider({}, "unknown"));
  const created = await createBrowserAccount(baseCreateInput());
  const live = await startBrowserAccountLiveView({
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a"
  });
  const exchange = await exchangeBrowserLiveViewCapability({
    actor: { userId: "owner-a" },
    capability: decodeURIComponent(live.launchUrl.split("capability=")[1])
  });
  const confirmed = await confirmBrowserAccountLogin({
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a",
    providerSessionId: exchange.providerSessionId
  });
  assert.equal(confirmed.authenticationStatus, "unknown");
  assert.equal(confirmed.connectionStatus, "needs_verification");
  assert.equal(confirmed.verificationSource, "user_confirmed");
  assert.equal(confirmed.lastVerifiedAt, null);
});

test("browser authentication verification cannot inspect another account session", async () => {
  await useTemporaryRegistry();
  setBrowserProviderForTesting(fakeProvider({}, "verified"));
  const first = await createBrowserAccount(baseCreateInput());
  const second = await createBrowserAccount({
    ...baseCreateInput(),
    serviceName: "Second"
  });
  const live = await startBrowserAccountLiveView({
    actor: { userId: "owner-a" },
    accountId: first.account.id,
    workspaceId: "workspace-a"
  });
  const exchange = await exchangeBrowserLiveViewCapability({
    actor: { userId: "owner-a" },
    capability: decodeURIComponent(live.launchUrl.split("capability=")[1])
  });
  await assert.rejects(
    () => confirmBrowserAccountLogin({
      actor: { userId: "owner-a" },
      accountId: second.account.id,
      workspaceId: "workspace-a",
      providerSessionId: exchange.providerSessionId
    }),
    (error) =>
      error instanceof BrowserAccountError &&
      error.code === "browser-verification-session-invalid"
  );
});

test("Live View capability is one-time, owner-bound, short-lived, and revocable", async () => {
  await useTemporaryRegistry();
  setBrowserProviderForTesting(fakeProvider());
  const created = await createBrowserAccount(baseCreateInput());
  const actor = { userId: "owner-a" };
  const live = await startBrowserAccountLiveView({
    actor,
    accountId: created.account.id,
    workspaceId: "workspace-a"
  });
  assert.match(live.launchUrl, /^\/accounts\/browser-live#capability=/);
  assert.ok(Date.parse(live.exchangeExpiresAt) - Date.now() <= 2 * 60_000);
  assert.ok(Date.parse(live.sessionExpiresAt) - Date.now() <= 20 * 60_000);

  const capability = decodeURIComponent(live.launchUrl.split("capability=")[1]);
  const serializedBeforeExchange = await readFile(getBrowserAccountRegistryPathForTesting(), "utf8");
  assert.doesNotMatch(serializedBeforeExchange, new RegExp(escapeRegExp(capability.split(".")[1])));

  await assert.rejects(
    () => exchangeBrowserLiveViewCapability({
      actor: { userId: "owner-b" },
      capability
    }),
    (error) => error instanceof BrowserAccountError && error.code === "live-view-invalid"
  );

  const exchange = await exchangeBrowserLiveViewCapability({ actor, capability });
  assert.match(exchange.viewerPath, /^\/secure-browser-client\.html/);
  assert.match(exchange.cookieName, /^agentos_browser_live_[a-f0-9]{32}$/);
  await assert.rejects(
    () => exchangeBrowserLiveViewCapability({ actor, capability }),
    (error) => error instanceof BrowserAccountError && error.code === "live-view-invalid"
  );
  await assert.rejects(
    () => authorizeBrowserLiveViewWebSocket({
      actor,
      providerSessionId: exchange.providerSessionId,
      credential: "x".repeat(43)
    }),
    (error) => error instanceof BrowserAccountError && error.code === "live-view-denied"
  );
  assert.deepEqual(
    await authorizeBrowserLiveViewWebSocket({
      actor,
      providerSessionId: exchange.providerSessionId,
      credential: exchange.credential
    }),
    { authorized: true }
  );

  await stopBrowserAccountLiveView({
    actor,
    accountId: created.account.id,
    workspaceId: "workspace-a",
    providerSessionId: exchange.providerSessionId
  });
  assert.deepEqual(stoppedSessions, ["2a0f35f7-9824-4d7a-b05d-77a05f887847"]);
  await assert.rejects(
    () => authorizeBrowserLiveViewWebSocket({
      actor,
      providerSessionId: exchange.providerSessionId,
      credential: exchange.credential
    }),
    (error) => error instanceof BrowserAccountError && error.code === "live-view-denied"
  );
});

test("browser account API and every account modal expose explicit Secure Live View controls", async () => {
  const root = process.cwd();
  const [route, routeSecurity, policyRoute, workerEventRoute, policySecurity, proxy, supervisor, ui, workspaceActions, missionShell, mission, workflow] = await Promise.all([
    readFile(path.join(root, "app/api/accounts/browser-accounts/route.ts"), "utf8"),
    readFile(path.join(root, "lib/security/browser-account-route.ts"), "utf8"),
    readFile(path.join(root, "app/api/internal/browser-policy/heartbeat/route.ts"), "utf8"),
    readFile(path.join(root, "app/api/internal/browser-policy/worker-event/route.ts"), "utf8"),
    readFile(path.join(root, "lib/security/browser-policy-channel.ts"), "utf8"),
    readFile(path.join(root, "proxy.ts"), "utf8"),
    readFile(path.join(root, "scripts/railway-supervisor.mjs"), "utf8"),
    readFile(path.join(root, "components/operations/accounts/accounts-page-content.tsx"), "utf8"),
    readFile(path.join(root, "components/mission-control/use-mission-control-workspace-actions.ts"), "utf8"),
    readFile(path.join(root, "components/mission-control/mission-control-shell.tsx"), "utf8"),
    readFile(path.join(root, "lib/agentos/application/account-target-mission-context-service.ts"), "utf8"),
    readFile(path.join(root, "lib/openclaw/domains/mission-dispatch-workflow.ts"), "utf8")
  ]);

  assert.match(route, /requireBrowserAccountActor/);
  assert.match(route, /redactSecrets/);
  assert.match(routeSecurity, /Cache-Control": "no-store"/);
  assert.match(routeSecurity, /requireSameOriginMutation/);
  assert.match(routeSecurity, /rate-limited/);
  assert.match(policyRoute, /requireBrowserPolicyChannel/);
  assert.match(workerEventRoute, /markBrowserWorkerSessionsInterrupted/);
  assert.match(workerEventRoute, /expireBrowserTaskBindingsForRecovery/);
  assert.match(policySecurity, /timingSafeEqual/);
  assert.match(policySecurity, /browser-policy-channel-denied/);
  assert.match(proxy, /api\/internal\/browser-policy\/heartbeat/);
  assert.match(proxy, /api\/internal\/browser-policy\/worker-event/);
  assert.match(supervisor, /randomBytes\(32\).*base64url/);
  assert.match(supervisor, /AGENTOS_BROWSER_POLICY_HEARTBEAT_URL/);
  assert.match(supervisor, /notifyBrowserWorkerRestart/);
  assert.match(ui, /Secure Self-hosted Browser/);
  assert.match(ui, /Default · Ready/);
  assert.match(ui, /Start Secure Browser/);
  assert.match(ui, /Open Live View/);
  assert.match(ui, /Unavailable in this runtime/);
  assert.match(workspaceActions, /loadAccountSecureBrowserCapabilities/);
  assert.match(workspaceActions, /connectSecureBrowserAccount/);
  assert.match(workspaceActions, /startSecureLiveView/);
  assert.match(missionShell, /onSecureSubmit=\{connectSecureBrowserAccount\}/);
  assert.match(missionShell, /secureBrowserCapabilities=\{accountSecureBrowserCapabilities\}/);
  assert.doesNotMatch(mission, /prompt-only profile selection/);
  assert.match(mission, /BrowserTaskBindingRequest/);
  assert.match(ui, /Task-bound policy/);
  assert.match(ui, /Manage Secure Browser Access/);
  assert.match(route, /update-access/);
  assert.match(route, /recover/);
  assert.match(workflow, /selected agent must belong to the browser account workspace/i);
});

test("internal browser policy channel denies missing tokens and accepts only the configured token", () => {
  const originalToken = process.env.AGENTOS_BROWSER_POLICY_TOKEN;
  const configuredToken = "a".repeat(43);
  process.env.AGENTOS_BROWSER_POLICY_TOKEN = configuredToken;
  try {
    const denied = requireBrowserPolicyChannel(new Request("http://127.0.0.1/api/internal/browser-policy/heartbeat", {
      method: "POST"
    }));
    assert.ok(denied);
    assert.equal(denied.status, 401);
    const accepted = requireBrowserPolicyChannel(new Request("http://127.0.0.1/api/internal/browser-policy/heartbeat", {
      method: "POST",
      headers: {
        "X-AgentOS-Browser-Policy-Token": configuredToken
      }
    }));
    assert.equal(accepted, null);
  } finally {
    if (originalToken === undefined) {
      delete process.env.AGENTOS_BROWSER_POLICY_TOKEN;
    } else {
      process.env.AGENTOS_BROWSER_POLICY_TOKEN = originalToken;
    }
  }
});

test("task binding forces a private OpenClaw profile and releases it without persisting CDP", async () => {
  const root = await useTemporaryRegistry();
  setBrowserTaskBindingRegistryRootForTesting(root);
  setBrowserProviderForTesting(fakeProvider({}, "verified"));
  const mutations: Array<{ operation: string; path: string; value?: unknown }> = [];
  setOpenClawAdapterForTesting({
    async setConfig(path: string, value: unknown) {
      mutations.push({ operation: "set", path, value });
      return { stdout: "{}", stderr: "", exitCode: 0 };
    },
    async unsetConfig(path: string) {
      mutations.push({ operation: "unset", path });
      return { stdout: "{}", stderr: "", exitCode: 0 };
    }
  } as unknown as OpenClawAdapter);

  const created = await createBrowserAccount(baseCreateInput());
  await markAccountProviderVerified(created.account.id);
  const binding = await prepareBrowserTaskBinding({
    request: {
      accountId: created.account.id,
      actorUserId: "owner-a"
    },
    workspaceId: "workspace-a",
    agentId: "agent-a",
    dispatchId: "dispatch-123",
    openClawSessionId: "3a5d04a8-c305-4e9c-85b8-f4e4f14d6881"
  });

  assert.equal(binding.sessionKey, "agent:agent-a:explicit:3a5d04a8-c305-4e9c-85b8-f4e4f14d6881");
  assert.equal((await readBrowserTaskBindingsForTesting()).length, 1);
  assert.match(mutations[0].path, /^browser\.profiles\["acct-/);
  assert.deepEqual(mutations[0].value, {
    cdpUrl: "http://127.0.0.1:19222",
    attachOnly: true,
    color: "#7C3AED"
  });

  const serialized = await readFile(path.join(root, "browser-task-bindings.json"), "utf8");
  assert.doesNotMatch(serialized, /cdpUrl|127\.0\.0\.1|19222/);
  assert.match(serialized, /openClawSessionKey/);

  const cleanup = await finalizeBrowserTaskBinding("dispatch-123");
  assert.deepEqual(cleanup, { finalized: true, cleanupFailed: false });
  assert.equal((await readBrowserTaskBindingsForTesting()).length, 0);
  assert.deepEqual(stoppedSessions, ["2a0f35f7-9824-4d7a-b05d-77a05f887847"]);
  assert.equal(mutations.at(-1)?.operation, "unset");
  const account = await getBrowserAccount({
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a"
  });
  assert.equal(account.sessionState, "idle");
  assert.equal(account.concurrencyLease, null);
});

test("policy heartbeat renews the durable lease and rejects a mismatched agent", async () => {
  const root = await useTemporaryRegistry();
  setBrowserTaskBindingRegistryRootForTesting(root);
  setBrowserProviderForTesting(fakeProvider({}, "verified"));
  setOpenClawAdapterForTesting({
    async setConfig() {
      return { stdout: "{}", stderr: "", exitCode: 0 };
    },
    async unsetConfig() {
      return { stdout: "{}", stderr: "", exitCode: 0 };
    }
  } as unknown as OpenClawAdapter);
  const created = await createBrowserAccount(baseCreateInput());
  await markAccountProviderVerified(created.account.id);
  const binding = await prepareBrowserTaskBinding({
    request: { accountId: created.account.id, actorUserId: "owner-a" },
    workspaceId: "workspace-a",
    agentId: "agent-a",
    dispatchId: "dispatch-heartbeat",
    openClawSessionId: "3a5d04a8-c305-4e9c-85b8-f4e4f14d6881"
  });
  const heartbeatAt = new Date(Date.now() + 60_000);
  const heartbeat = await heartbeatBrowserTaskBinding({
    openClawSessionKey: binding.sessionKey,
    agentId: "agent-a",
    now: heartbeatAt
  });
  assert.equal(heartbeat.agentId, "agent-a");
  assert.equal(heartbeat.heartbeatAt, heartbeatAt.toISOString());
  assert.equal(
    (await getBrowserAccount({
      actor: { userId: "owner-a" },
      accountId: created.account.id,
      workspaceId: "workspace-a"
    })).concurrencyLease?.heartbeatAt,
    heartbeatAt.toISOString()
  );
  await assert.rejects(
    () => heartbeatBrowserTaskBinding({
      openClawSessionKey: binding.sessionKey,
      agentId: "agent-b",
      now: heartbeatAt
    }),
    (error: unknown) =>
      error instanceof Error &&
      "code" in error &&
      error.code === "browser-binding-not-found"
  );
});

test("task dispatch revalidates supported providers and requires action for a missing login marker", async () => {
  const root = await useTemporaryRegistry();
  setBrowserTaskBindingRegistryRootForTesting(root);
  setBrowserProviderForTesting(fakeProvider({}, "needs_user_action"));
  setOpenClawAdapterForTesting({
    async setConfig() {
      return { stdout: "{}", stderr: "", exitCode: 0 };
    },
    async unsetConfig() {
      return { stdout: "{}", stderr: "", exitCode: 0 };
    }
  } as unknown as OpenClawAdapter);
  const created = await createBrowserAccount(baseCreateInput());
  await markAccountProviderVerified(created.account.id);
  await assert.rejects(
    () => prepareBrowserTaskBinding({
      request: { accountId: created.account.id, actorUserId: "owner-a" },
      workspaceId: "workspace-a",
      agentId: "agent-a",
      dispatchId: "dispatch-expired-auth",
      openClawSessionId: "3a5d04a8-c305-4e9c-85b8-f4e4f14d6881"
    }),
    /Open Live View and sign in again/
  );
  const account = await getBrowserAccount({
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a"
  });
  assert.equal(account.connectionStatus, "needs_verification");
  assert.equal(account.concurrencyLease, null);
});

test("expired task bindings are recovered and failed cleanup remains retryable", async () => {
  const root = await useTemporaryRegistry();
  setBrowserTaskBindingRegistryRootForTesting(root);
  setBrowserProviderForTesting(fakeProvider({}, "verified"));
  let failCleanup = true;
  setOpenClawAdapterForTesting({
    async setConfig() {
      return { stdout: "{}", stderr: "", exitCode: 0 };
    },
    async unsetConfig() {
      if (failCleanup) throw new Error("cleanup unavailable");
      return { stdout: "{}", stderr: "", exitCode: 0 };
    }
  } as unknown as OpenClawAdapter);
  const created = await createBrowserAccount(baseCreateInput());
  await markAccountProviderVerified(created.account.id);
  await prepareBrowserTaskBinding({
    request: { accountId: created.account.id, actorUserId: "owner-a" },
    workspaceId: "workspace-a",
    agentId: "agent-a",
    dispatchId: "dispatch-recovery",
    openClawSessionId: "3a5d04a8-c305-4e9c-85b8-f4e4f14d6881"
  });

  const first = await recoverExpiredBrowserTaskBindings({
    ownerUserId: "owner-a",
    workspaceId: "workspace-a",
    now: new Date(Date.now() + 11 * 60_000)
  });
  assert.equal(first.recoveredCount, 1);
  assert.equal(first.cleanupFailedCount, 1);
  assert.equal((await readBrowserTaskBindingsForTesting())[0]?.recoveryRequiredAt !== undefined, true);

  failCleanup = false;
  const second = await recoverExpiredBrowserTaskBindings({
    ownerUserId: "owner-a",
    workspaceId: "workspace-a",
    now: new Date(Date.now() + 12 * 60_000)
  });
  assert.equal(second.recoveredCount, 1);
  assert.equal(second.cleanupFailedCount, 0);
  assert.equal((await readBrowserTaskBindingsForTesting()).length, 0);
});

test("browser worker restart immediately fences active accounts and task bindings", async () => {
  const root = await useTemporaryRegistry();
  setBrowserTaskBindingRegistryRootForTesting(root);
  setBrowserProviderForTesting(fakeProvider({}, "verified"));
  setOpenClawAdapterForTesting({
    async setConfig() {
      return { stdout: "{}", stderr: "", exitCode: 0 };
    },
    async unsetConfig() {
      return { stdout: "{}", stderr: "", exitCode: 0 };
    }
  } as unknown as OpenClawAdapter);
  const created = await createBrowserAccount(baseCreateInput());
  await markAccountProviderVerified(created.account.id);
  await prepareBrowserTaskBinding({
    request: { accountId: created.account.id, actorUserId: "owner-a" },
    workspaceId: "workspace-a",
    agentId: "agent-a",
    dispatchId: "dispatch-worker-crash",
    openClawSessionId: "3a5d04a8-c305-4e9c-85b8-f4e4f14d6881"
  });
  const crashAt = new Date(Date.now() + 1_000);
  const [accounts, bindings] = await Promise.all([
    markBrowserWorkerSessionsInterrupted({ now: crashAt }),
    expireBrowserTaskBindingsForRecovery({ now: crashAt })
  ]);
  assert.equal(accounts.affectedAccounts, 1);
  assert.equal(bindings.affectedBindings, 1);
  const account = await getBrowserAccount({
    actor: { userId: "owner-a" },
    accountId: created.account.id,
    workspaceId: "workspace-a"
  });
  assert.equal(account.sessionState, "recovery_required");
  assert.equal(account.concurrencyLease?.expiresAt, crashAt.toISOString());
  assert.equal(
    (await readBrowserTaskBindingsForTesting())[0]?.recoveryRequiredAt,
    crashAt.toISOString()
  );
});

test("OpenClaw policy plugin binds by trusted session key and fails managed profiles closed", async () => {
  const [source, packageJson] = await Promise.all([
    readFile(path.join(process.cwd(), "openclaw-plugins/agentos-browser-policy/index.js"), "utf8"),
    readFile(path.join(process.cwd(), "openclaw-plugins/agentos-browser-policy/package.json"), "utf8")
  ]);
  const metadata = JSON.parse(packageJson) as {
    openclaw?: { build?: { openclawVersion?: string; pluginSdkVersion?: string }; compat?: { pluginApi?: string; minGatewayVersion?: string } }
  };
  assert.equal(metadata.openclaw?.build?.openclawVersion, "2026.9.3");
  assert.equal(metadata.openclaw?.build?.pluginSdkVersion, "2026.9.3");
  assert.equal(metadata.openclaw?.compat?.pluginApi, ">=2026.9.1");
  assert.equal(metadata.openclaw?.compat?.minGatewayVersion, "2026.9.1");
  assert.equal((source.match(/definePluginEntry\(/g) ?? []).length, 1);
  assert.equal((source.match(/register\(api\)/g) ?? []).length, 1);
  assert.match(source, /openclaw\/plugin-sdk\/plugin-entry/);
  assert.match(source, /entry\?\.openClawSessionKey === sessionKey/);
  assert.match(source, /profile: binding\.openClawProfileName/);
  assert.match(source, /isAllowedUrl\(targetUrl, binding\.allowedDomains\)/);
  assert.match(source, /requireApproval/);
  assert.match(source, /managed browser profiles require an active task binding/i);
  assert.match(source, /Arbitrary page evaluation is disabled/);
  assert.match(source, /AGENTOS_BROWSER_POLICY_TOKEN/);
  assert.match(source, /heartbeatBinding/);
  assert.match(source, /policy channel is unavailable/i);
});

test("Secure Browser production smoke covers persistence, worker crash restart, and revoke", async () => {
  const [script, packageJson, worker] = await Promise.all([
    readFile(path.join(process.cwd(), "scripts/secure-browser-integration-smoke.mjs"), "utf8"),
    readFile(path.join(process.cwd(), "package.json"), "utf8"),
    readFile(path.join(process.cwd(), "scripts/secure-browser-worker.mjs"), "utf8")
  ]);
  assert.match(packageJson, /smoke:secure-browser/);
  assert.match(script, /localStorage\.setItem/);
  assert.match(script, /document\.cookie/);
  assert.match(script, /stopWorkerProcessGroup/);
  assert.match(script, /revoke-profile/);
  assert.match(worker, /inspect-authentication/);
  assert.match(worker, /Runtime\.evaluate/);
  assert.doesNotMatch(worker, /document\.cookie|localStorage\.getItem/);
});

test("Secure Browser startup uses a Railway-safe timeout and visible progress state", async () => {
  const [client, worker, accountsUi, connectClient] = await Promise.all([
    readFile(
      path.join(process.cwd(), "lib/agentos/browser-accounts/browser-worker-client.ts"),
      "utf8"
    ),
    readFile(path.join(process.cwd(), "scripts/secure-browser-worker.mjs"), "utf8"),
    readFile(
      path.join(process.cwd(), "components/operations/accounts/accounts-page-content.tsx"),
      "utf8"
    ),
    readFile(
      path.join(process.cwd(), "components/operations/accounts/secure-browser-connect-client.ts"),
      "utf8"
    )
  ]);

  assert.match(client, /"start-session": 90_000/);
  assert.match(client, /health: 5_000/);
  assert.match(client, /Secure browser startup did not finish within 90 seconds/);
  assert.match(worker, /--disable-dev-shm-usage/);
  assert.match(worker, /waitForManagedCondition/);
  assert.match(worker, /child\.signalCode !== null/);
  assert.match(worker, /Secure browser session startup failed during/);
  assert.match(connectClient, /Starting secure browser…/);
  assert.match(accountsUi, /Profiles \$\{/);
  assert.match(accountsUi, /Task dispatch \$\{/);
});

async function useTemporaryRegistry() {
  const root = await mkdtemp(path.join(os.tmpdir(), "agentos-browser-accounts-"));
  temporaryRoots.push(root);
  setBrowserAccountRegistryRootForTesting(root);
  return root;
}

async function markAccountProviderVerified(accountId: string) {
  const registryPath = getBrowserAccountRegistryPathForTesting();
  const registry = JSON.parse(await readFile(registryPath, "utf8")) as {
    accounts: Array<Record<string, unknown>>;
  };
  const account = registry.accounts.find((entry) => entry.id === accountId);
  assert.ok(account);
  account.connectionStatus = "connected";
  account.verificationSource = "provider_verified";
  account.lastVerifiedAt = new Date().toISOString();
  await writeFile(registryPath, `${JSON.stringify(registry)}\n`, "utf8");
}

function baseCreateInput() {
  return {
    actor: { userId: "owner-a" },
    workspaceId: "workspace-a",
    serviceName: "Example",
    primaryDomain: "example.com",
    allowedAgentIds: ["agent-a"],
    allowedDomains: ["example.com"]
  };
}

function fakeProvider(
  overrides: Partial<Awaited<ReturnType<BrowserProvider["getCapabilities"]>>> = {},
  authenticationStatus: Awaited<ReturnType<BrowserProvider["verifyAuthentication"]>>["status"] = "unknown"
): BrowserProvider {
  return {
    async getCapabilities() {
      return {
        provider: "self-hosted-openclaw",
        source: "native-openclaw",
        profileCreation: "supported",
        persistentProfiles: "supported",
        liveView: "supported",
        humanTakeover: "supported",
        typedTaskDispatch: "supported",
        cdpExposure: "private",
        reason: null,
        ...overrides
      };
    },
    async createProfile(input) {
      return {
        provider: "self-hosted-openclaw",
        externalProfileId: null,
        browserProfileId: input.browserProfileId,
        persistent: true,
        source: "native-openclaw"
      };
    },
    async startSession(input) {
      return {
        sessionId: "2a0f35f7-9824-4d7a-b05d-77a05f887847",
        browserProfileId: input.browserProfileId,
        state: "active",
        runtimeConnection: {
          kind: "loopback-cdp",
          cdpUrl: "http://127.0.0.1:19222"
        }
      };
    },
    async getLiveView() {
      if (overrides.liveView === "unsupported") {
        throw new Error("Live View is unsupported.");
      }
      return {
        capabilityId: "opaque-capability",
        expiresAt: new Date(Date.now() + 60_000).toISOString(),
        oneTime: true
      };
    },
    async getCdpEndpoint() {
      return {
        capabilityId: "opaque-cdp-capability",
        expiresAt: new Date(Date.now() + 60_000).toISOString()
      };
    },
    async verifyAuthentication() {
      return {
        status: authenticationStatus,
        verifiedAt: authenticationStatus === "verified" ? new Date().toISOString() : null
      };
    },
    async persistProfile(input) {
      return {
        provider: "self-hosted-openclaw",
        externalProfileId: null,
        browserProfileId: input.browserProfileId,
        persistent: true,
        source: "native-openclaw"
      };
    },
    async stopSession(input) {
      stoppedSessions.push(input.sessionId);
    },
    async revokeProfile(input) {
      revokedProfiles.push(input.browserProfileId);
    }
  };
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function accessDenied(error: unknown) {
  return error instanceof BrowserAccountError && error.code === "account-access-denied";
}
