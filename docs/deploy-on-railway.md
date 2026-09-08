# Deploy AgentOS on Railway

The Railway deployment runs AgentOS and OpenClaw `2026.9.3` in the public
application service and runs interactive Chromium in a separate private browser
worker service. OpenClaw remains the runtime and source of truth; AgentOS
connects to its native Gateway over `ws://127.0.0.1:18789`. Only AgentOS is
exposed through Railway's HTTPS domain.

## What the template creates

- One public GitHub-backed AgentOS service built with `Dockerfile.railway`.
- One private GitHub-backed browser worker built from the same repository and
  started in browser-worker mode by `AGENTOS_SERVICE_ROLE=browser-worker`.
- One public Railway HTTPS domain for AgentOS.
- One persistent AgentOS/OpenClaw volume mounted at `/data` on AgentOS.
- One separate persistent browser-profile volume mounted at `/data` on the
  browser worker.
- One generated AgentOS machine API token.
- One generated OpenClaw Gateway token.
- One initial administrator username and user-supplied password.
- A `/api/health` deployment healthcheck.

Both volume-backed services must use one replica. AgentOS and OpenClaw remain
co-located, while browser credentials and the explicit Railway Chromium sandbox
exception stay inside the dedicated worker container. Horizontal replicas must
not share one writable OpenClaw runtime or Chromium profile volume.

The entrypoint explicitly starts AgentOS on port `3000`, matching the generated Railway domain target. Do not override the service `PORT` value or change the generated domain target port unless both values change together; a mismatch produces Railway `502` responses even when the container is healthy.

## Template composer specification

Create the template from the `https://github.com/SapienXai/AgentOS` repository and use the default branch. Configure the service as follows.

### AgentOS service

- Name: `AgentOS`
- Source: `https://github.com/SapienXai/AgentOS`
- Builder: Dockerfile (the repository's `railway.json` selects `Dockerfile.railway`)
- Public networking: enabled, generate a domain
- Public domain target port: `3000`
- Healthcheck path: `/api/health`
- Healthcheck timeout: `300` seconds
- Restart policy: `ON_FAILURE`, maximum `10` retries
- Replicas: `1`

### Browser worker service

- Name: `browser-worker`
- Source: the same AgentOS repository and revision
- Builder: Dockerfile (the repository's `railway.json` still selects
  `Dockerfile.railway`)
- Public networking: disabled; do not generate a domain
- Private networking: enabled
- Healthcheck path: `/healthz` when you can set a service-specific value. The
  published one-click template may inherit `/api/health`, so the worker serves
  both endpoints.
- Healthcheck timeout: `300` seconds
- Restart policy: `ON_FAILURE`, maximum `10` retries
- Replicas: `1`

Set `PORT=18794` explicitly on this service. Railway private networking requires
the caller to include that port. The worker listens on IPv6 `::`, which is the
Railway-recommended bind address for private networking.

### Volumes

Attach one volume to each service with mount path:

```text
/data
```

Do not share the same volume between services. The AgentOS volume contains:

- `/data/agentos`: Instance Protection and AgentOS operator state;
- `/data/openclaw` and `/data/openclaw-config`: OpenClaw configuration, device identity, credentials, sessions, and logs;
- `/data/workspaces`: AgentOS-created workspaces.

The browser worker volume contains only
`/data/browser-profiles/<scoped-profile-id>` directories. Treat it as
credential-bearing data because Chromium cookies and localStorage live there.

Do not use a pre-deploy command for initialization. Railway mounts volumes only when the service starts, and the container entrypoint performs first-run initialization safely at runtime.

### Shared private worker variables

Generate one 64-character secret and set the same value as
`AGENTOS_BROWSER_WORKER_TOKEN` on both services. Never place it in a public URL.

On the browser worker:

| Variable | Value | Purpose |
| --- | --- | --- |
| `AGENTOS_SERVICE_ROLE` | `browser-worker` | Switches the shared Railway image into dedicated browser-worker mode for one-click template deploys. |
| `PORT` | `18794` | Explicit private HTTP/WebSocket listener port. |
| `AGENTOS_BROWSER_WORKER_TOKEN` | `${{secret(64)}}` | Authenticates control, Live View, and CDP relay traffic. |
| `AGENTOS_BROWSER_DISABLE_CHROMIUM_SANDBOX` | `1` | Keeps Chromium bootable inside Railway's private worker container. |
| `RAILWAY_RUN_UID` | `0` | Lets the entrypoint prepare its dedicated volume. |

On AgentOS:

| Variable | Value | Purpose |
| --- | --- | --- |
| `AGENTOS_BROWSER_WORKER_URL` | `http://${{browser-worker.RAILWAY_PRIVATE_DOMAIN}}:18794` | Private worker origin. Use the exact service reference Railway offers in the project. |
| `AGENTOS_BROWSER_WORKER_TOKEN` | reference to the same worker secret | Authenticates private worker traffic. |

Do not set `AGENTOS_BROWSER_CDP_RELAY_URL`; the supervisor creates the
loopback-only relay URL. Do not expose ports `18794`, `5900`, `6080`, or `9222`
through a Railway public domain or TCP proxy.

The repository still includes `Dockerfile.browser-worker` plus
`/railway.browser-worker.json` for manual or self-hosted Railway setups where
you explicitly choose a dedicated worker Dockerfile and custom config-as-code
path. The published one-click marketplace template does not rely on that
per-service config-file override because Railway's template composer reliably
preserves service variables, healthchecks, and volumes, but not custom
config-as-code file selection.

### AgentOS variables

| Variable | Template value | User-facing | Purpose |
| --- | --- | --- | --- |
| `AGENTOS_INITIAL_ADMIN_USERNAME` | `admin` | Editable | Initial Instance Protection username. |
| `AGENTOS_INITIAL_ADMIN_PASSWORD` | No default; required input | Required | Initial Instance Protection password. Use at least 12 characters. |
| `AGENTOS_API_TOKEN` | `${{secret(64)}}` | Hidden/generated | Internal machine API authentication and recovery boundary. |
| `OPENCLAW_GATEWAY_TOKEN` | `${{secret(64)}}` | Hidden/generated | Authentication for the loopback OpenClaw Gateway. |
| `RAILWAY_RUN_UID` | `0` | Hidden | Lets the entrypoint repair volume ownership before dropping to the non-root `node` user. |
| `RAILWAY_SHM_SIZE_BYTES` | `268435456` | Hidden | Provides Chromium with a larger shared-memory area. |

Do not add `AGENTOS_TRUSTED_OPERATOR_ORIGINS` for the generated Railway domain. AgentOS derives the exact HTTPS origin from `RAILWAY_PUBLIC_DOMAIN`. If a custom domain is added later, set `AGENTOS_TRUSTED_OPERATOR_ORIGINS=https://agentos.example.com` as an additional exact origin.

## First deployment

1. Enter the initial administrator username and password in the template form.
2. Deploy the template.
3. Wait until the private worker healthcheck (`/healthz` or `/api/health`,
   depending on how Railway rendered the template) and the AgentOS `/api/health`
   check pass. The AgentOS supervisor verifies the private worker and OpenClaw
   before starting the application.
4. Open the generated HTTPS domain and sign in.
5. Remove `AGENTOS_INITIAL_ADMIN_PASSWORD` from the Railway service variables after confirming the first sign-in. The account remains on the persistent volume.
6. Connect a real model/provider in Setup Center, then explicitly choose its default model.
7. Create a workspace and run the compatibility diagnostics before assigning production work.

The bootstrap password is used only when `/data/agentos/instance-protection.json` does not exist. It is removed from the long-running AgentOS process after bootstrap and is never passed to OpenClaw, but Railway retains the service variable until the operator removes it. Redeploying or changing the variable does not replace the account. Change credentials from AgentOS. If recovery is required, use a Railway shell to run the documented Instance Protection reset deliberately; deleting the volume is not an account-reset mechanism because it also destroys OpenClaw and workspace state.

On a new volume, AgentOS creates only the durable OpenClaw Gateway baseline (`gateway.mode=local` with token auth). It intentionally creates no provider, auth profile, model catalog entry, default model, agent, or demo task. Until the operator connects a provider and chooses a default model, AgentOS blocks chat, mission dispatch, and runtime smoke tests before any provider request is sent.

## Runtime and security behavior

- Each container starts as root only long enough to prepare its own root-owned
  Railway volume, then drops to the non-root `node` user.
- The initial admin password is removed from the long-running AgentOS process after bootstrap and is never passed to the OpenClaw process.
- OpenClaw listens only on container loopback. It has no Railway public port or domain.
- The Railway supervisor owns the OpenClaw Gateway process lifecycle. AgentOS onboarding only verifies that managed Gateway and configures providers, authentication, and models; it never invokes the host-service `gateway install`, `gateway start`, or `gateway restart` CLI lifecycle inside Railway.
- An authenticated operator can request **Restart managed gateway** from AgentOS. AgentOS sends the fixed restart request over a container-private, owner-only supervisor socket; the supervisor restarts only the Gateway and waits for `/healthz` liveness before reporting success.
- The supervisor checks Gateway liveness continuously in addition to watching the process. If the managed Gateway exits or repeatedly fails liveness probes, the supervisor restarts it while keeping AgentOS available. Stricter `/readyz` channel/plugin readiness remains an AgentOS diagnostic instead of blocking the deployment. After three failed Gateway restart attempts, the container exits so Railway can apply its service restart policy.
- Browser sessions authenticate with the same username and password on every trusted browser; session cookies remain browser-specific.
- Login is rate-limited. Mutation requests require an authenticated session and an exact same-origin HTTPS request.
- Interactive Chromium runs in the dedicated private worker with Xvfb, openbox,
  and x11vnc. AgentOS exposes only an authenticated same-origin noVNC Live View.
  Raw VNC is loopback-only inside the worker. Raw remote CDP is never returned
  to OpenClaw; the main service presents a loopback-only authenticated relay.
- Railway's container runtime rejects Chromium's normal credential sandbox
  setup in this worker image. `--no-sandbox` is enabled only by the explicit
  `AGENTOS_BROWSER_DISABLE_CHROMIUM_SANDBOX=1` policy baked into the dedicated
  worker image. The worker must therefore stay private, single-purpose,
  non-root, and isolated from AgentOS/OpenClaw secrets. Local/main-container
  fallback does not disable Chromium's sandbox.
- Secure Browser profiles persist under `/data/browser-profiles` on the
  dedicated worker volume. A user can complete password, 2FA, or CAPTCHA input
  directly in Live View and reuse the resulting profile after the process
  stops. AgentOS stores only hashed, short-lived Live View credentials and
  never requests the website password.
- Secure Browser Account dispatch is enabled only when the AgentOS Browser Policy plugin has started inside OpenClaw, its supervisor-generated loopback heartbeat token is available, and native Gateway mission dispatch is advertised. The adapter binds the trusted task session key, forces the temporary `attachOnly` profile, renews the durable lease through the private AgentOS policy endpoint, enforces domain/action policy, and releases the browser session on terminal paths. CLI fallback and prompt-only profile selection remain blocked.
- A browser worker crash is reported through the same authenticated loopback policy channel. AgentOS immediately fences active profile leases, expires task bindings, revokes Live View credentials, and shows `recovery_required` instead of waiting for TTL expiry.
- Stable provider authentication rules are conservative. GitHub currently supports independent marker verification; other websites remain explicitly user-confirmed until a reviewed rule exists.
- The health endpoint intentionally reveals no version, token, path, account, or Gateway detail.

## Persistence and operations

Back up both Railway volumes before risky upgrades. A service with an attached
volume has brief redeploy downtime. Monitor both volumes because a full profile
volume can prevent Chromium from preserving authentication state.

Secure Browser Account metadata uses the existing AgentOS mission-control state
on the AgentOS volume; the private worker keeps authenticated Chromium profile
state on its dedicated `/data/browser-profiles` volume. AgentOS does not export cookies,
localStorage, raw CDP URLs, or raw Live View credentials. No VNC or CDP port is
public. See
[Secure Browser Accounts](./secure-browser-accounts.md) for storage, trust
boundaries, backup, revoke, recovery, and upgrade procedures.

The browser policy heartbeat secret is generated in memory on every supervisor
start and passed only to the loopback AgentOS and OpenClaw processes. Do not
configure or expose it as a Railway template variable. Stale task bindings are
fenced after their rolling TTL and can be retried from **Accounts → Retry
cleanup**. This two-service topology remains a single-operator deployment.
Hostile multi-tenant workloads require a separate worker service and volume per
tenant or an equivalent tenant-level isolation boundary.

After building the Railway image, run the credential-free browser lifecycle
smoke in a disposable container:

```bash
docker run --rm --shm-size=256m --user node:node --entrypoint node agentos-railway \
  /agentos/scripts/secure-browser-integration-smoke.mjs
```

This verifies real Chromium cookie/localStorage persistence, worker
process-group crash recovery, profile reuse, and revoke cleanup. It does not
prove compatibility with a third-party website and does not use real login
credentials.

OpenClaw is pinned in `Dockerfile.railway`. Upgrade it only together with AgentOS compatibility checks and update the pin, recommended version, and deployment documentation in the same change.

## Published one-click template

The official AgentOS template is published in the Railway marketplace:

- Template page: [railway.com/deploy/agentos-1](https://railway.com/deploy/agentos-1)
- Direct deployment: [railway.com/new/template/agentos-1](https://railway.com/new/template/agentos-1)

The README uses Railway's official button:

```md
[![Deploy on Railway](https://railway.com/button.svg)](https://railway.com/new/template/agentos-1?utm_medium=integration&utm_source=button&utm_campaign=agentos)
```

## Updating the public template

Railway templates deploy directly from the published template repository by
default. When AgentOS' Railway runtime contract changes, update the existing
public template instead of creating an ad hoc second template unless the new
template code is intentional and documented.

Use this update sequence:

1. Land the repo changes for `Dockerfile.railway`,
   `Dockerfile.browser-worker`, both Railway config files, and this guide.
2. Rebuild and verify the template locally where practical:
   `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm build`.
3. In Railway, open the existing AgentOS template, refresh it from the current
   repository revision, and confirm both services still point at the same repo
   and branch.
4. Re-check generated secrets, the private `browser-worker` service reference,
   both `/data` volumes, the AgentOS `/api/health` healthcheck, and the worker
   `/healthz` healthcheck before publishing.
5. Publish the updated template and verify the marketplace page plus direct
   deploy link still resolve to the intended template code.

When the runtime contract changes, update the Railway template and this guide together. Verify the public template page, deploy form, required password field, generated secrets, `/data` volume, and healthcheck before publishing an update.

## Railway references

- [Private networking](https://docs.railway.com/private-networking)
- [Healthchecks](https://docs.railway.com/deployments/healthchecks)
- [Deployment best practices](https://docs.railway.com/overview/best-practices)
