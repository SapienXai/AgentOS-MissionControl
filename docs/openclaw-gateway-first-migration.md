# OpenClaw Gateway-First Migration

Date: 2026-05-02

Latest production-readiness validation update: 2026-05-16.

> Historical migration record. The active recommended contract is OpenClaw
> `2026.9.3`; see [`openclaw-2026.9.3-compatibility-audit.md`](./openclaw-2026.9.3-compatibility-audit.md).
> and [`openclaw-official-gateway-transport.md`](./openclaw-official-gateway-transport.md)
> for the current official-client architecture. The dated narrative below is retained for
> migration provenance.

Current Gateway method mapping and source audit details are summarized in
[`openclaw-sync-audit.md`](./openclaw-sync-audit.md).

This pass moves AgentOS closer to the target provider shape:

`AgentOS UI/API -> AgentOS Control Plane Contract -> OpenClawAdapter -> OpenClawGatewayClient -> Gateway-first implementation -> CLI fallback`

The OpenClaw CLI remains the bounded fallback implementation. AgentOS consumes the public
`@openclaw/gateway-protocol@2026.9.3` package for protocol constants and capability names, and
the official `@openclaw/gateway-client@2026.9.3` owns the production transport. AgentOS retains
application-level request policy, normalized payload projections, fallback policy, and diagnostics.

Phase 1 official-protocol authority is documented in
[`openclaw-2026.9.3-compatibility-audit.md`](./openclaw-2026.9.3-compatibility-audit.md). The
package owns wire versions, client ids/modes, capability names, frame guards, and structured error
details. AgentOS retains the native WS transport, normalized payload projections, fallback policy,
and diagnostics.

## Current Import Graph

Primary production flow:

- `app/api/*` routes call AgentOS control-plane helpers or OpenClaw application services.
- `lib/agentos/control-plane.ts` calls `lib/openclaw/application/*`.
- OpenClaw application services use `OpenClawAdapter` for gateway/client behavior.
- `OpenClawAdapter` calls `getOpenClawGatewayClient()`.
- `getOpenClawGatewayClient()` returns `NativeWsOpenClawGatewayClient` with `CliOpenClawGatewayClient` fallback unless CLI is forced by env.

Compatibility flow:

- `lib/openclaw/service.ts` remains a legacy compatibility/delegation entrypoint.
- Production imports from `service.ts` are blocked.
- Compatibility tests still import `service.ts` intentionally.

Low-level/fallback flow:

- `lib/openclaw/client/native-ws-gateway-client.ts` owns raw Gateway WebSocket RPC.
- `lib/openclaw/client/cli-gateway-client.ts` owns CLI fallback command execution.
- `lib/openclaw/cli.ts` owns OpenClaw binary resolution and command helpers.

## CLI Dependency Map

Gateway-first now covers these operations when the Gateway is reachable, native auth is usable, and the Gateway returns valid payloads:

- `health` and `status`
- `models.authStatus`
- `models.list`
- `channels.status`
- `skills.status`
- `plugins.uiDescriptors`
- `agents.list`
- `agents.create`
- `agents.update`
- `agents.delete`
- `sessions.list`
- `sessions.subscribe`
- `sessions.messages.subscribe`
- `sessions.send`
- `sessions.abort`
- `chat.send`
- `chat.abort`
- `config.get` through Gateway config snapshots with AgentOS path extraction
- `config.schema.lookup`
- `config.schema`
- `config.patch` / `config.apply` with `baseHash` concurrency protection
- `logs.tail`
- `exec.approval.list` / `exec.approval.resolve`
- `cron.status` / `cron.list`
- generic `call(method, params)`

The same operations fall back to CLI on Gateway timeout, auth failure, unreachable socket, scope-limited response, malformed response, unavailable native credentials, or other Gateway failure.

CLI remains intentional for operations without a confirmed stable Gateway contract or exact behavior match in this codebase:

- gateway start/stop/restart
- agent creation/update fallback when `agents.create` or `agents.update` is unavailable; AgentOS still applies policy skills, worker-profile sidecar metadata, workspace metadata, and local config side effects around the native calls
- mission dispatch only when native Gateway methods are unsupported or fail
- agent stream transcript behavior when native event subscription is unavailable
- agent config read/write/sync helpers
- channel discovery, registry side effects, and provider provisioning
- surface adapter reads
- legacy planner execution paths
- reset/update/onboarding command helpers

Direct CLI usage is guarded by boundary tests. Current allowed files are fallback, provisioning, discovery, planner, reset, onboarding, and update paths where CLI behavior is still the source of compatibility.

## Operation Migration Matrix

| Area | Previous CLI path | Gateway contract found | Current primary path | CLI fallback required | Risk |
| --- | --- | --- | --- | --- | --- |
| status / health | `openclaw status --json` | `status` | Gateway-first typed RPC | Yes, for auth/unreachable/malformed failures | Low |
| gateway readiness / probe | `openclaw gateway status/probe --json` | `health`, `status` | Gateway-first typed RPC for reads; CLI `gateway probe` remains for broader reachability diagnostics | Yes; gateway process control cannot call itself | Low |
| gateway start/stop/restart | `openclaw gateway start/stop/restart --json` | Not applicable for controlling the process | CLI | Yes | Low |
| models status/list/scan | `openclaw models ... --json` | `models.authStatus`, `models.list`; no confirmed `models.scan` Gateway method | Gateway-first typed RPC for status/list; scan remains CLI | Yes | Low |
| plugins / skills list | `openclaw plugins/skills list --json` | `plugins.uiDescriptors`, `skills.status` | Gateway-first typed RPC | Yes | Low |
| agents list | `openclaw agents list --json` | `agents.list` | Gateway-first typed RPC, merged with local config for AgentOS fields | Yes | Medium |
| agents create/update/delete | `openclaw agents add/delete` plus AgentOS config writes | `agents.create`, `agents.update`, `agents.delete` | Gateway-first lifecycle calls; AgentOS-owned metadata side effects remain in application services | Yes, for unsupported older Gateway versions and local metadata side effects | Medium |
| agent turn / stream | `openclaw agent --json` / JSON stream | `chat.send`, `sessions.send`, `sessions.abort`, `chat.abort`, `sessions.subscribe`, `sessions.messages.subscribe` | Gateway-first mission dispatch/abort and native stream adapter support; direct chat now attempts native Gateway streaming and uses transcript/history polling only as response recovery | Yes; event subscription can be absent or status-only on older/current Gateway versions | High |
| sessions / recent activity | filesystem catalog plus status/session data | `sessions.list` | Gateway-first typed RPC with filesystem catalog fallback | Yes, for unavailable Gateway or CLI gateway-call failure | Medium |
| config reads | `openclaw config get <path> --json` | `config.get` snapshot | Gateway-first snapshot read with AgentOS path extraction | Yes | Medium |
| config set/unset | `openclaw config set/unset <path>` | `config.schema`, `config.patch`, `config.apply`, legacy `config.set` | Gateway-first path patch with base hash | Yes; CLI path-level set/unset is preferred over full overwrite when snapshots contain redacted secrets | Medium |
| channel/provider status | OpenClaw config/discovery helpers | `channels.status` | Not migrated in UI flows | Yes; current provisioning/registry side effects need existing compatibility paths | Medium |
| channel/surface provisioning | `openclaw channels ...`, Gmail setup, managed routing writes | Partial/side-effectful | CLI/application service compatibility paths | Yes | High |
| planner/reset/update/onboarding | direct OpenClaw command workflows | Not a stable AgentOS Gateway contract | CLI/transitional routes | Yes | High |

## Gateway-First Changes

`NativeWsOpenClawGatewayClient` now attempts Gateway RPC first for the supported typed read/probe operations, native mission dispatch, agent lifecycle operations, event subscription, and safe config mutations listed above. Payloads are normalized at the client boundary with Zod schemas:

- unknown fields are ignored by AgentOS callers but preserved by passthrough parsing where harmless;
- optional missing fields use existing fallback defaults;
- invalid required fields are treated as malformed Gateway responses and trigger CLI fallback;
- fallback diagnostics are recorded for mission-control diagnostics.

Gateway errors are classified into typed client categories:

- `auth`
- `malformed-response`
- `scope-limited`
- `timeout`
- `unreachable`
- `unknown`

Mission-control diagnostics now exposes recent Gateway-first fallback issues as diagnostic issue strings so operators can see when AgentOS had to use CLI fallback.

Capability detection:

- `OpenClawCapabilityMatrix` probes the native Gateway `connect` handshake and reads `hello-ok.features.methods` / `hello-ok.features.events`. Test hooks still support older discovery-shaped payloads.
- Diagnostics and Settings expose OpenClaw version, AgentOS' requested protocol range, negotiated Gateway protocol version, auth mode, auth role/scopes, advertised RPC methods/events, per-operation Gateway/CLI/degraded decisions, native mission dispatch support, config schema/lookup/patch support, event bridge support, logs support, cron support, channel support, skills support, approval support, and update support.
- `hello-ok.features.methods` and `features.events` are conservative discovery hints. An omitted
  method is reported as `unknown` / `not-advertised`, not as proven unsupported; AgentOS attempts
  the native request and uses CLI fallback only after an authoritative unsupported response or an
  allowed transport/shape failure.

Persistent event bridge:

- AgentOS starts a sidecar Gateway WebSocket subscription through `sessions.subscribe` and optional `sessions.messages.subscribe` when supported.
- OpenClaw task lifecycle changes arrive as the authenticated raw `task` broadcast; `includeTasks` remains AgentOS product intent and does not derive a task subscription RPC. Task snapshots continue to use `tasks.list` and `tasks.get`.
- Chat, tool, log, session, and approval events are normalized into `RuntimeRecord` entries under AgentOS mission-control state.
- Existing snapshot, SSE, task, and runtime rendering remains unchanged; the bridge records are merged with session and mission-dispatch runtimes.

Config writes:

- `setConfig` and `unsetConfig` now read the current Gateway config snapshot, probe `config.schema.lookup` with `config.schema` fallback, then prefer `config.patch` or `config.apply` with the snapshot `baseHash`.
- If patch/apply is unavailable, AgentOS only attempts legacy full `config.set` when the snapshot does not contain redacted OpenClaw secrets.
- Redacted secrets such as `__OPENCLAW_REDACTED__` are never written back through a full Gateway overwrite; AgentOS falls back to CLI path-level `config set/unset` instead.

Native WS credential discovery is intentionally conservative:

- explicit client options can be used directly; environment credentials remain the first choice for remote/test transports, while a real loopback connection reads the current local OpenClaw config before environment credentials so a stale development process cannot override a repaired token;
- local Gateway URLs prefer `gateway.auth.*` before `gateway.remote.*`;
- remote Gateway URLs prefer `gateway.remote.*` before `gateway.auth.*`;
- OpenClaw-redacted config values such as `__OPENCLAW_REDACTED__` are never sent as credentials;
- when only a redacted config secret is available, AgentOS records an auth diagnostic and uses CLI fallback.

The 2026-05-03 validation pass fixed a diagnostic ordering bug in this path: AgentOS now resolves and validates native WS connect params before opening the socket, so redacted secrets are reported as `auth` fallback diagnostics instead of being masked by an early Gateway close.

The same validation pass also found that a local Gateway can be healthy while the AgentOS device entry is still scope-limited. In that case OpenClaw returns errors such as `INVALID_REQUEST: missing scope: operator.read`; this is not solved by asking the user to paste an unknown token. Settings now exposes a native auth repair action that runs the official `openclaw devices approve --latest --json` path, and the native WS client uses OpenClaw local device auth for loopback Gateway connections. Manual token/password paste remains only for externally managed Gateway credentials.

Status update registry backfill:

- `status` remains Gateway-first for the live RPC, but if the native Gateway payload omits `update.registry.latestVersion` and `update.registry.error`, AgentOS backfills only that update registry slice from the CLI `status` payload.
- Once a registry value is found, the native client reuses that cached update registry slice for later Gateway status payloads that omit it, avoiding repeated CLI status backfills and preventing the Settings update banner from disappearing between snapshots.
- This keeps `latestVersion` and `updateAvailable` visible in Settings and update toasts when the Gateway does not yet expose the registry fields, without changing the primary Gateway-first control flow for the rest of the snapshot.

## Provider Factory And SDK Extension Point

`lib/openclaw/client/gateway-client-factory.ts` is the SDK replacement point.

It now exposes `setOpenClawGatewayClientProvider(provider)`, which allows a future `SdkOpenClawGatewayClient` to be installed without changing application services, API routes, or UI components. The future SDK client only needs to implement the existing `OpenClawGatewayClient` interface from `lib/openclaw/client/types.ts`.

No SDK placeholder import or fake implementation was added.

## Fragility Map

Current fragile areas:

- Gateway RPC method candidates remain an AgentOS compatibility registry, while the official package
  owns the wire envelope and structured errors. If OpenClaw authoritatively rejects a method,
  AgentOS records that evidence and may degrade to CLI according to the operation policy.
- Native WS cannot use secrets that OpenClaw only returns in redacted form. Set an env token/password or use a future stable SDK/device-auth path to avoid CLI fallback in those environments.
- AgentOS Settings now exposes native Gateway auth status, a secure credential form, and a server-side auth test. It reports redacted config secrets, env credential presence, disabled native WS flags, and the current recovery recommendation without returning raw token/password values. Saved credentials are written only to local `.env.local`, which is gitignored, and are applied to the current server session.
- Gateway start/stop/restart still cannot be Gateway-first because it controls the Gateway process itself.
- Agent create/update/delete are Gateway-first when the Gateway advertises the lifecycle methods. Native `agents.create` receives only the 2026.9.3 fields it accepts (`name`, `workspace`, `model`, `emoji`, and `avatar`); AgentOS keeps its product-owned id/path, identity, policy skill, worker-profile sidecar, and workspace-manifest side effects outside that native payload.
- Agent snapshots collapse legacy duplicate native-create records when OpenClaw has both a global generated agent and the AgentOS workspace-local agent with the same workspace/display name.
- Mission dispatch and abort are Gateway-first when `chat.send`/`sessions.send` and `sessions.abort`/`chat.abort` are available. CLI runner fallback remains for older or unsupported Gateway versions.
- Native streaming is represented through the persistent Gateway event bridge when `sessions.subscribe` / `sessions.messages.subscribe` is available; CLI/session transcript fallback remains for current snapshot compatibility.
- Channel/provider provisioning remains CLI-backed because it has side effects across OpenClaw config, channel registries, discovery, and managed routing.
- Some API routes still import CLI formatting/binary helpers for onboarding/update/binary-selection flows. These are documented transitional routes and are covered by boundary tests.
- Real provider success paths require external credentials and were not converted or faked.

## Tests Added Or Updated

- Gateway available uses native Gateway for typed status requests.
- Capability matrix detection maps advertised methods into feature support flags and unsupported-method diagnostics.
- Protocol mismatch diagnostics include the negotiated protocol, AgentOS' supported range, and recovery guidance.
- Native mission dispatch uses `chat.send` when the capability matrix advertises it.
- Direct agent chat covers native stream adapter support and per-request recovery fallback. The agent-card chat route no longer forces CLI streaming; it relies on Gateway events first and keeps transcript/history polling to recover assistant text when session events are status-only.
- Gateway event bridge frames normalize into AgentOS runtime records.
- Gateway malformed response falls back to CLI.
- Gateway failure followed by CLI failure returns the actionable CLI failure while recording Gateway diagnostics.
- Gateway auth discovery prefers local auth for local URLs and remote auth for remote URLs.
- Redacted OpenClaw secrets are not transmitted as native WS credentials.
- Settings auth status explains redacted secrets, env credential readiness, force-disabled native WS, and local `.env.local` credential saves without leaking secrets.
- Recovered Gateway operations clear stale fallback diagnostics for that operation.
- Agent list/lifecycle, session list, config path reads, config path mutations, mission dispatch, and mission abort use Gateway first where the Gateway contract is usable.
- Native `logs.tail`, `exec.approval.*`, `cron.status`, and `cron.list` adapter methods are wired for diagnostics/integration use.
- The provider factory accepts a replacement client provider for a future SDK-backed implementation.
- Components, hooks, and non-transitional app routes cannot import low-level CLI/raw Gateway clients.
- Existing boundary tests continue to block production imports from `lib/openclaw/service.ts`, direct undocumented CLI JSON usage, direct undocumented CLI command usage, and OpenClaw import cycles.

## Runtime Smoke

`scripts/openclaw-runtime-smoke.mjs` checks:

- gateway health/status through `/api/snapshot`
- model status through `/api/models/providers`
- agents list and recent runtime/task surfaces through `/api/snapshot`
- basic agent preflight from the current snapshot
- forced CLI fallback snapshot with `AGENTOS_OPENCLAW_GATEWAY_CLIENT=cli`, `OPENCLAW_GATEWAY_CLIENT=cli`, and `AGENTOS_OPENCLAW_NATIVE_WS=0`

The script requires a running AgentOS dev server and does not provision real external provider credentials.

## Verification

Latest verification:

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 111 tests.
- `pnpm build`: passed when rerun outside the sandbox. The first sandboxed attempt failed with Turbopack `Operation not permitted` while trying to create a worker/bind a port during CSS processing.
- `node scripts/openclaw-runtime-smoke.mjs`: passed when rerun outside the sandbox. The sandboxed attempt failed because Node fetch to localhost was blocked.

2026-05-03 validation:

- Native WS redacted-secret auth diagnostics were verified against both unit tests and a real local Gateway.
- Invalid env token behavior was verified against the real local Gateway and correctly produced an `auth` fallback diagnostic.
- Settings now verifies the same redacted-secret auth condition through `/api/settings/gateway` and shows the env-token recovery path in the Settings menu.
- Fresh-install/no-gateway behavior was verified by temporarily stopping the local Gateway and running a snapshot load with temporary `HOME` and restricted `PATH`; the snapshot returned offline fallback state.
- Real agent chat stream completed successfully through the AgentOS API and was visible in the refreshed runtime/session snapshot.
- `pnpm typecheck`, `pnpm lint`, `pnpm test`, and sandbox-external `pnpm build` passed.

Critical CLI-backed migration review:

- See `docs/openclaw-critical-cli-backed-migration.md` for the detailed agent mutation, agent run/streaming, and channel/provider provisioning matrix.
- `channels.status` is now Gateway-first behind `OpenClawGatewayClient` and `OpenClawAdapter`.
- Agent create/update/delete and agent run/streaming are Gateway-first where advertised. CLI/application fallback remains required for unsupported older Gateway versions, Gateway failures, and AgentOS-owned local metadata/transcript compatibility side effects.

## Remaining Risks

- Successful real agent/mission completion still depends on available model/provider quota.
- External provider success flows still require real credentials.
- Temporary runtime smoke artifacts from the earlier smoke pass are still pending explicit delete confirmation.
- A future OpenClaw SDK should replace only the factory-installed client implementation, not the application service graph.
