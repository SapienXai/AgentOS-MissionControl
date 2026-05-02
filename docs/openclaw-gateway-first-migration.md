# OpenClaw Gateway-First Migration

Date: 2026-05-02

This pass moves AgentOS closer to the target provider shape:

`AgentOS UI/API -> AgentOS Control Plane Contract -> OpenClawAdapter -> OpenClawGatewayClient -> Gateway-first implementation -> CLI fallback`

The OpenClaw CLI remains the complete fallback implementation. No OpenClaw SDK import was added because the App SDK is not public/stable.

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

- `status`
- `gateway.status`
- `gateway.probe`
- `models.status`
- `models.list`
- `models.scan`
- `skills.list`
- `plugins.list`
- `agents.list`
- `sessions.list`
- `config.get` through Gateway config snapshots with AgentOS path extraction
- `config.set` and `config.unset` through Gateway config snapshot mutation when a current base hash is available
- generic `call(method, params)`

The same operations fall back to CLI on Gateway timeout, auth failure, unreachable socket, scope-limited response, malformed response, unavailable native credentials, or other Gateway failure.

CLI remains intentional for operations without a confirmed stable Gateway contract or exact behavior match in this codebase:

- gateway start/stop/restart
- agents add/update/delete
- agent turn execution and stream transcript behavior
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
| gateway readiness / probe | `openclaw gateway status/probe --json` | `gateway.status`, `gateway.probe` | Gateway-first typed RPC for reads | Yes; gateway process control cannot call itself | Low |
| gateway start/stop/restart | `openclaw gateway start/stop/restart --json` | Not applicable for controlling the process | CLI | Yes | Low |
| models status/list/scan | `openclaw models ... --json` | `models.status`, `models.list`, `models.scan` | Gateway-first typed RPC | Yes | Low |
| plugins / skills list | `openclaw plugins/skills list --json` | `plugins.list`, `skills.list` | Gateway-first typed RPC | Yes | Low |
| agents list | `openclaw agents list --json` | `agents.list` | Gateway-first typed RPC, merged with local config for AgentOS fields | Yes | Medium |
| agents create/update/delete | `openclaw agents add/delete` plus AgentOS config writes | `agents.create`, `agents.update`, `agents.delete` | CLI | Yes; confirmed Gateway create schema does not match current `agentDir`/model behavior | Medium |
| agent turn / stream | `openclaw agent --json` / JSON stream | `agent` exists but stream semantics are not migrated | CLI | Yes; UI transcript behavior depends on current CLI stream | High |
| sessions / recent activity | filesystem catalog plus status/session data | `sessions.list` | Gateway-first typed RPC with filesystem catalog fallback | Yes, for unavailable Gateway or CLI gateway-call failure | Medium |
| config reads | `openclaw config get <path> --json` | `config.get` snapshot | Gateway-first snapshot read with AgentOS path extraction | Yes | Medium |
| config set/unset | `openclaw config set/unset <path>` | `config.set` full snapshot with base hash | Gateway-first snapshot mutation where base hash is usable | Yes | Medium |
| channel/provider status | OpenClaw config/discovery helpers | `channels.status` | Not migrated in UI flows | Yes; current provisioning/registry side effects need existing compatibility paths | Medium |
| channel/surface provisioning | `openclaw channels ...`, Gmail setup, managed routing writes | Partial/side-effectful | CLI/application service compatibility paths | Yes | High |
| planner/reset/update/onboarding | direct OpenClaw command workflows | Not a stable AgentOS Gateway contract | CLI/transitional routes | Yes | High |

## Gateway-First Changes

`NativeWsOpenClawGatewayClient` now attempts Gateway RPC first for the supported typed read/probe operations and safe config mutations listed above. Payloads are normalized at the client boundary with Zod schemas:

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

Native WS credential discovery is intentionally conservative:

- explicit client options and `AGENTOS_OPENCLAW_GATEWAY_TOKEN/PASSWORD` or `OPENCLAW_GATEWAY_TOKEN/PASSWORD` can be used directly;
- local Gateway URLs prefer `gateway.auth.*` before `gateway.remote.*`;
- remote Gateway URLs prefer `gateway.remote.*` before `gateway.auth.*`;
- OpenClaw-redacted config values such as `__OPENCLAW_REDACTED__` are never sent as credentials;
- when only a redacted config secret is available, AgentOS records an auth diagnostic and uses CLI fallback.

## Provider Factory And SDK Extension Point

`lib/openclaw/client/gateway-client-factory.ts` is the SDK replacement point.

It now exposes `setOpenClawGatewayClientProvider(provider)`, which allows a future `SdkOpenClawGatewayClient` to be installed without changing application services, API routes, or UI components. The future SDK client only needs to implement the existing `OpenClawGatewayClient` interface from `lib/openclaw/client/types.ts`.

No SDK placeholder import or fake implementation was added.

## Fragility Map

Current fragile areas:

- Gateway RPC method names for typed catalog/status/config reads are assumed from the local protocol shape and are protected by graceful fallback. If OpenClaw changes method names, AgentOS should degrade to CLI and show diagnostics.
- Native WS cannot use secrets that OpenClaw only returns in redacted form. Set an env token/password or use a future stable SDK/device-auth path to avoid CLI fallback in those environments.
- Gateway start/stop/restart still cannot be Gateway-first because it controls the Gateway process itself.
- Agent create/update/delete still require CLI-backed compatibility. OpenClaw Gateway has agent mutation methods, but the currently confirmed Gateway create schema does not accept AgentOS' existing `agentDir` and model inputs, so migrating it would risk changing workspace/agent config behavior.
- Streaming is still CLI-backed because AgentOS UI behavior depends on current CLI transcript semantics and no stable native stream contract is confirmed here.
- Channel/provider provisioning remains CLI-backed because it has side effects across OpenClaw config, channel registries, discovery, and managed routing.
- Some API routes still import CLI formatting/binary helpers for onboarding/update/binary-selection flows. These are documented transitional routes and are covered by boundary tests.
- Real provider success paths require external credentials and were not converted or faked.

## Tests Added Or Updated

- Gateway available uses native Gateway for typed status requests.
- Gateway malformed response falls back to CLI.
- Gateway failure followed by CLI failure returns the actionable CLI failure while recording Gateway diagnostics.
- Gateway auth discovery prefers local auth for local URLs and remote auth for remote URLs.
- Redacted OpenClaw secrets are not transmitted as native WS credentials.
- Recovered Gateway operations clear stale fallback diagnostics for that operation.
- Agent list, session list, config path reads, and config path mutations use Gateway first where the Gateway contract is usable.
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
- `pnpm test`: passed, 105 tests.
- `pnpm build`: passed when rerun outside the sandbox. The first sandboxed attempt failed with Turbopack `Operation not permitted` while trying to create a worker/bind a port during CSS processing.
- `node scripts/openclaw-runtime-smoke.mjs`: passed when rerun outside the sandbox. The sandboxed attempt failed because Node fetch to localhost was blocked.

## Remaining Risks

- Successful real agent/mission completion still depends on available model/provider quota.
- External provider success flows still require real credentials.
- Temporary runtime smoke artifacts from the earlier smoke pass are still pending explicit delete confirmation.
- A future OpenClaw SDK should replace only the factory-installed client implementation, not the application service graph.
