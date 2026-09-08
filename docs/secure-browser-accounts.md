# Secure Browser Accounts

## Status

AgentOS now includes all five production-path phases of the default,
free, self-hosted browser architecture:

- an isolated headed Chromium worker with one persistent profile per browser
  account;
- authenticated same-origin Live View for manual password, 2FA, and CAPTCHA
  completion;
- one-time capability exchange, short-lived Live View credentials, exclusive
  profile leases, revocation, bounded audit events, and crash supervision.
- a task-bound OpenClaw plugin/adapter that keys policy to the trusted
  `agentId + sessionKey`, forces the dedicated profile on every browser call,
  enforces allowed-domain navigation, requests native OpenClaw approval for
  interactive actions, and releases the session on terminal task paths.
- durable policy heartbeat, fencing-aware stale-binding recovery, editable
  agent/domain ACLs, and operator-visible lease/recovery state.
- conservative provider-specific authentication verification, immediate
  worker-crash fencing, and an executable real-Chromium persistence/restart/
  revoke smoke test.

Agent task dispatch remains fail-closed unless the policy plugin has started
inside the OpenClaw Gateway and native Gateway mission dispatch is advertised.
AgentOS never treats a profile name added to a prompt as enforcement.

## Runtime architecture

```text
Railway HTTPS domain :3000
└── AgentOS public proxy
    ├── HTTP -> Next.js 127.0.0.1:3001
    ├── loopback-only CDP relay for OpenClaw
    └── authorized Live View WebSocket
        └── authenticated Railway private network
            └── dedicated browser-worker service :18794
                └── x11vnc 127.0.0.1:<ephemeral>
                    └── Xvfb + openbox + headed Chromium
                        ├── CDP 127.0.0.1:<ephemeral>
                        └── dedicated volume /data/browser-profiles/<profile-id>

OpenClaw Gateway 127.0.0.1:18789
├── remains the agent runtime and source of truth
└── AgentOS Browser Policy plugin
    ├── validates the trusted OpenClaw session key through a token-authenticated
    │   loopback heartbeat channel
    ├── renews the durable lease and binding TTL
    ├── forces browser profile acct-...
    ├── guards navigation and browser actions
    └── uses plugin.approval for interactive actions
```

The Railway worker exposes a token-authenticated private HTTP control endpoint.
The owner-only Unix socket remains available for local development fallback.
Raw VNC and remote CDP endpoints are never returned by an AgentOS API and have
no Railway public port.

The provider boundary remains
`lib/agentos/browser-accounts/provider.ts`. Secure Browser Accounts are the
AgentOS policy/control abstraction over a browser provider: they own identity,
workspace, agent/domain ACLs, leases, fencing, human login, recovery, and
audit. The provider may be an OpenClaw managed profile, an OpenClaw
`existing-session`, an OpenClaw `extension` relay, or an AgentOS
self-hosted/cloud worker. OpenClaw remains the browser runtime and source of
truth for native profiles and drivers; AgentOS does not copy cookies,
localStorage, CDP credentials, or access tokens into its persistence.

The worker keeps Chromium's raw ephemeral CDP endpoint private. AgentOS rewrites
the worker route to a stable loopback-only CDP relay in the main service and
temporarily configures that route on an `attachOnly`
OpenClaw profile through native Gateway config mutation. Raw Chromium CDP URLs
are not persisted in account, task, or OpenClaw config and are never returned
through AgentOS HTTP.

## Connection flow

1. The authenticated operator selects a workspace and website in Accounts.
2. AgentOS creates an owner/workspace/account-scoped profile and acquires an
   exclusive operator lease.
3. The worker starts Xvfb, openbox, Chromium, and loopback-only x11vnc.
4. AgentOS returns a two-minute, one-time capability in the new window's URL
   fragment. The capability is never sent as a request URL or Referer.
5. The Live View page removes the fragment immediately and exchanges it
   through an authenticated, exact same-origin POST.
6. AgentOS stores only hashes and sets an HttpOnly, SameSite=Strict cookie
   scoped to the exact session WebSocket path. The session expires after 20
   minutes.
7. Every WebSocket upgrade is pre-authorized against Instance Protection,
   exact origin, operator identity, session ownership, expiry, and credential
   hash before the public proxy connects to the private worker.
8. The operator enters passwords and verification codes directly into the
   remote browser pixels/input channel. They are not submitted to an AgentOS
   form, API, prompt, model, transcript, or audit event.
9. **I’m signed in** records user confirmation. When a stable provider rule
   exists, verification runs inside the private worker and returns only a
   marker result and hostname. Only a provider-verified result becomes
   `connected`; an unavailable or unknown result remains
   `needs_verification`. Stop Live View separately to revoke the Live View
   session and release its lease while preserving the profile volume.
10. A later Live View starts Chromium with the same `user-data-dir`.
11. Revoke invalidates Live View credentials and removes the scoped profile.

## Agent task flow

1. The operator selects a verified Secure Browser Account, an explicitly
   allowed browser-capable agent, and a task.
2. AgentOS authenticates the operator and checks owner, workspace, account,
   agent, verification, revocation, provider capability, and lease state.
3. AgentOS creates the mission dispatch and uses its explicit OpenClaw session
   ID to derive the exact session key expected by the OpenClaw `2026.9.3` recommended contract.
4. A ten-minute durable lease and fencing token are acquired. The worker starts
   the persistent Chromium profile and returns its stable loopback Browser
   Gateway route over the authenticated private control channel.
5. AgentOS adds a temporary `attachOnly` OpenClaw browser profile through
   Gateway config mutation and writes a secret-free task binding.
6. The OpenClaw plugin matches `ctx.agentId` and `ctx.sessionKey`, overwrites
   the browser tool's `profile` and `target`, then calls the AgentOS loopback
   policy endpoint with a supervisor-generated process secret. AgentOS
   validates the durable binding and fencing token and renews both the account
   lease and binding expiry. The endpoint returns only policy metadata; it
   never returns cookies, browser credentials, or CDP transport details.
   Unmanaged use of `acct-*` profiles and unavailable/fenced policy channels
   fail closed.
7. Read actions are allowed. Navigation must remain on the account allowlist.
   Arbitrary page evaluation and file transfer are blocked. Click, type, fill,
   press, and dialog actions require a native OpenClaw one-time approval.
8. On completion, cancellation, dispatch failure, or reconciled terminal
   runtime state, AgentOS removes the binding and temporary OpenClaw profile,
   stops Chromium, persists its user-data directory, and releases the lease.
9. A crash, missing heartbeat, or incomplete cleanup expires safely and marks
   the account/task `recovery_required`; failed cleanup bindings are retained
   as expired recovery records so the operator can retry cleanup.
10. Account owners can edit allowed agents and allowed domains between
    sessions. The server refuses policy changes while an unexpired profile
    lease exists, and always retains the account's primary domain.

`user_confirmed` is not independent provider verification. GitHub is the first
built-in provider rule: an allowed `github.com` page must expose GitHub's
authenticated `meta[name="user-login"]` marker; the login form marker produces
`needs_user_action`. No cookie value, DOM text, URL path, storage value, or
credential leaves the worker. Domains without a stable rule remain
`unknown/user_confirmed`, never `connected`.

Before an agent task uses a provider with a rule, AgentOS starts the isolated
profile and revalidates the marker. An expired marker changes the account to
`expired`; an unknown, unverified, or user-action-required result changes it
to `needs_verification`. In either case dispatch is blocked, the session is
cleaned up, and the operator is instructed to reconnect through Live View.

## Storage and isolation

- Profiles: the dedicated worker volume at
  `/data/browser-profiles/<profile-id>`, owner-only mode `0700`.
- AgentOS policy, leases, capability hashes, and audit:
  `/data/agentos/mission-control/browser-accounts.json`.
- Active secret-free task bindings:
  `/data/agentos/mission-control/browser-task-bindings.json`.
- Browser action approval/block audit:
  `/data/agentos/mission-control/browser-policy-audit.jsonl`.
- OpenClaw state: `/data/openclaw` and `/data/openclaw-config`.
- Workspaces: `/data/workspaces`.

Profile IDs are derived from owner, workspace, and account identity. A durable
lease permits one writer and uses a monotonically increasing fencing token so
an expired holder cannot release a newer lease. The filesystem registry lock
assumes one AgentOS replica. The private worker also rejects a second active
session for the same profile. This is not a distributed multi-replica lock.

Cookies, localStorage, service tokens, and session state exist inside the
Chromium profile. They are intentionally not copied into the AgentOS database.
Railway volume snapshots must therefore be treated as credential-bearing
backups. The volume is not application-level encrypted in this phase; use
Railway access controls and backup controls, and prefer a customer-managed
encrypted browser worker for stricter enterprise requirements.

## Security controls

- Instance Protection is authentication; Origin, Referer, Host, loopback, and
  private-network checks are defense in depth only.
- Account APIs enforce operator, workspace, account, and agent ACLs.
- ACL changes are owner/workspace scoped and blocked while a task or Live View
  holds the exclusive profile lease.
- Capability tokens and session credentials are 256-bit random values. Only
  domain-separated SHA-256 hashes are persisted.
- Exchange capabilities expire after two minutes and are consumed once.
- Live View credentials expire after 20 minutes and are bound to one owner and
  provider session.
- Live View responses are `no-store` with `no-referrer`, restrictive CSP,
  frame, MIME, and Permissions Policy headers.
- The embedded noVNC Lite surface provides no AgentOS clipboard, upload,
  download, file-transfer, or recording controls.
- Local/main-container fallback keeps Chromium's sandbox. Railway's dedicated
  worker explicitly uses `--no-sandbox` because the Railway container runtime
  rejects Chromium's credential sandbox setup. The exception is confined to a
  private, single-purpose, non-root container that receives no AgentOS,
  OpenClaw, provider, or model secrets.
- Chromium, Xvfb, openbox, and x11vnc receive a minimal allowlisted child
  environment. The worker token and inherited application secrets are not
  passed to browser child processes.
- Xvfb disables TCP listening. CDP and x11vnc bind to loopback and use
  ephemeral ports.
- Worker health reveals only readiness.
- Provider verification uses a bounded private CDP evaluation containing only
  versioned CSS selectors. Results are reduced to marker state and hostname.
- Logs and audits omit URLs, passwords, cookies, tokens, process arguments,
  profile paths, CDP endpoints, and VNC endpoints.
- Authenticated web content is untrusted and cannot expand account scope,
  allowed domains, agent ACLs, or approval policy.
- Agent tasks cannot address an `acct-*` profile without an unexpired
  AgentOS binding for the exact trusted OpenClaw session key.
- The plugin-to-AgentOS heartbeat endpoint is exempt from browser-session
  middleware only because it has its own 256-bit, timing-safe bearer
  authentication. The secret is generated at supervisor startup, shared only
  with the Gateway and AgentOS processes, and never persisted or returned.
- CLI mission fallback is disabled for account-bound tasks. Native Gateway
  mission dispatch and the loaded policy plugin are mandatory.

x11vnc runs without its own password because it accepts only loopback
connections inside the dedicated worker and is reached through two
authenticated WebSocket hops. The remaining same-worker namespace risk is
limited to that browser worker. Use a worker and volume per tenant, or replace
the display transport with KasmVNC, for hostile multi-tenant isolation.

The noVNC client is trusted static code served by AgentOS. It needs scripts and
same-origin access to load its modules and open the authorized WebSocket. A
dedicated browser subdomain would provide a stronger document-origin boundary
for a future multi-tenant SaaS deployment.

## Account states

- `needs_verification`: manual login was confirmed or verification is pending.
- `connected`: reserved for independent provider verification.
- `expired`: authentication is no longer valid.
- `recovery_required`: process cleanup failed and operator recovery is needed.
- `unsupported`: required runtime capability is missing.
- `revoked`: profile and account use are denied.

## Native OpenClaw browser drivers

OpenClaw reports these native drivers without collapsing them into one
category:

- `openclaw`: Managed Browser, an isolated OpenClaw-managed profile.
- `existing-session`: Existing Session, an already available host browser
  session attached through OpenClaw.
- `extension`: Chrome Extension, an authenticated browser extension relay.

AgentOS shows the driver and capability labels but never exposes raw CDP
credentials, relay secrets, cookies, or browser storage. A Secure Browser
Account remains bound to its exact provider/profile; an existing session or
extension profile cannot silently replace that binding.

## Operations

### Health and recovery

- `/api/health` covers the public application and OpenClaw Gateway.
- The AgentOS supervisor independently probes the private browser worker,
  fences active bindings when it becomes unavailable, and keeps AgentOS online
  while Railway restarts the worker service.
- Worker restart stops active display processes; persistent profiles remain.
- Before restarting an unhealthy worker, the supervisor sends a
  token-authenticated loopback event to AgentOS. Active account leases and task
  bindings are immediately expired, Live View credentials are revoked, and
  affected accounts become `recovery_required`; the system does not wait for
  the rolling TTL.
- An abandoned worker session and its Live View authorization expire after 20
  minutes. Unexpected worker exits trigger process-group cleanup before restart
  so display and Chromium children cannot retain a profile lock.
- Agent task bindings and leases use a rolling ten-minute TTL. Each authorized
  OpenClaw browser tool call validates and renews them through the private
  policy channel. A task that stops making browser calls eventually expires
  without holding the profile indefinitely.
- Account reads and the explicit **Retry cleanup** action recover expired
  bindings. Recovery removes the temporary OpenClaw profile, stops the worker
  session, releases only the matching fenced lease, and retains failed cleanup
  records for another retry.
- If an account remains `recovery_required`, do not dispatch work. Retry
  cleanup or revoke it before reconnecting.
- A new headed Chromium session can take up to 90 seconds to become ready on a
  cold or resource-constrained Railway container. The popup shows an explicit
  startup state during this interval. Health checks and other worker actions
  retain shorter, action-specific timeouts.
- If startup fails, the worker records only the failed startup phase
  (`virtual display`, `window manager`, `Chromium`, or `private display
  channel`) and returns a bounded sanitized error. It never logs the account
  URL, profile id, cookie, token, or browser contents.
- Repeated Chromium startup failures should be investigated through Railway
  memory usage and the worker phase diagnostic. Chromium uses
  `--disable-dev-shm-usage` in the container to avoid depending on a small
  default `/dev/shm`; do not work around failures by exposing CDP or VNC.

### Multi-user boundary

The durable model isolates profiles by `ownerUserId + workspaceId + accountId`
and every account mutation rechecks that scope. The current Railway Instance
Protection deployment is still a single-operator installation, not a
multi-tenant identity provider. A future SaaS deployment must replace that
authentication boundary with real per-user sessions and should run browser
workers in separate tenant security boundaries; the profile identifiers and
ACL checks implemented here are necessary but not sufficient container
isolation for hostile tenants.

### Backup and revoke

- Stop active browser sessions before a consistent volume backup.
- Treat backups as authenticated credentials.
- Revoke through AgentOS first. Revoke invalidates all capabilities, stops
  matching sessions, clears the lease, and deletes only the scoped profile.
- Never paste profile files, cookies, CDP endpoints, or credentials into logs
  or diagnostics.

### Real Chromium production smoke

The Railway image contains a credential-free lifecycle smoke:

```bash
node /agentos/scripts/secure-browser-integration-smoke.mjs
```

The smoke starts a loopback fixture, creates a temporary profile, writes a
synthetic cookie and localStorage value through private CDP, stops and reopens
Chromium, kills and restarts the worker process group, verifies persistence
again, revokes the profile, and confirms its directory was removed. It never
uses a real website account or credential. Run it in a disposable container or
maintenance deployment, not while production browser sessions are active.

## OpenClaw compatibility

AgentOS Railway is pinned to OpenClaw `2026.9.3`. Native OpenClaw
documentation describes managed profiles, `profile` selection, `cdpUrl`,
`attachOnly`, browser-node proxying, manual login, and the native
`openclaw`/`existing-session`/`extension` driver boundary:

- [Managed browser](https://docs.openclaw.ai/browser)
- [Browser login](https://docs.openclaw.ai/tools/browser-login)
- [Browser control](https://docs.openclaw.ai/tools/browser-control)
- [Browser CLI](https://docs.openclaw.ai/cli/browser)

The self-hosted worker is an adapter beside OpenClaw, not a core patch. The
AgentOS policy plugin is loaded through `plugins.load.paths`; it uses the
documented `before_tool_call`, `gateway_start`, and `gateway_stop` hooks and
does not modify OpenClaw core. OpenClaw's built-in browser tool remains the
execution engine.

- [Tool plugins](https://docs.openclaw.ai/plugins/tool-plugins)
- [Plugin hooks](https://docs.openclaw.ai/plugins/hooks)
- [Plugin permission requests](https://docs.openclaw.ai/plugins/plugin-permission-requests)

Upgrade OpenClaw only after running `pnpm openclaw:compat` and repeating
profile persistence, task session-key matching, forced-profile policy,
one-time exchange, WebSocket authorization, approval, revoke, terminal cleanup,
provider verification, worker-event fencing, and crash-recovery tests.
