# OpenClaw Refactor Notes

AgentOS now has a clearer OpenClaw boundary:

- AgentOS UI/API routes call `lib/agentos/control-plane.ts`.
- The control plane calls `lib/openclaw/application/*` services.
- Application services use `OpenClawAdapter` where gateway behavior is needed.
- `OpenClawAdapter` delegates transport work to `OpenClawGatewayClient`.
- `NativeWsOpenClawGatewayClient` can handle confirmed request/response Gateway RPC calls.
- `CliOpenClawGatewayClient` remains the complete fallback implementation.
- `lib/openclaw/service.ts` remains as a compatibility/delegation layer for older imports.

Reference docs inspected during this continuation:

- https://docs.openclaw.ai/cli/gateway
- https://docs.openclaw.ai/reference/rpc

## Moved In This Continuation

`lib/openclaw/client/native-ws-gateway-client.ts` was added:

- Implements the confirmed Gateway frame shape used by the OpenClaw control UI: `type: "req"` requests and `type: "res"` responses.
- Performs a protocol v3 `connect` handshake before method calls.
- Correlates request ids to responses.
- Handles native timeout, abort, close, and error cleanup.
- Normalizes Gateway error payloads before falling back.
- Supports native WS only for generic `call(method, params)`.
- Delegates status, config, agent mutation, model/catalog, gateway control, and streaming methods to the CLI fallback.

`lib/openclaw/client/gateway-client-factory.ts` now creates a native-first client wrapper unless CLI fallback is forced.

CLI fallback can be forced with either:

- `AGENTOS_OPENCLAW_GATEWAY_CLIENT=cli`
- `OPENCLAW_GATEWAY_CLIENT=cli`
- `AGENTOS_OPENCLAW_NATIVE_WS=0|false|off`

Native WS connection settings:

- `AGENTOS_OPENCLAW_GATEWAY_URL` or `OPENCLAW_GATEWAY_URL`
- `AGENTOS_OPENCLAW_GATEWAY_TOKEN`
- `AGENTOS_OPENCLAW_GATEWAY_PASSWORD`
- `AGENTOS_OPENCLAW_NATIVE_WS_TIMEOUT_MS`

`lib/openclaw/adapter/openclaw-adapter.ts` was expanded into the AgentOS-facing boundary for:

- Status: `getStatus`, `getGatewayStatus`, `getModelStatus`
- Gateway control: `controlGateway`, `probeGateway`
- Catalog: `listModels`, `scanModels`, `listSkills`, `listPlugins`
- Config: `getConfig`, `setConfig`, `unsetConfig`
- Agents/runs: `addAgent`, `deleteAgent`, `runAgentTurn`, `streamAgentTurn`
- Generic Gateway RPC: `call`

Application call sites moved from direct gateway-client usage to the adapter:

- `lib/openclaw/application/catalog-service.ts`
- `lib/openclaw/application/agent-service.ts`
- `app/api/agents/[agentId]/chat/route.ts`
- Remaining compatibility code in `lib/openclaw/service.ts` now uses the adapter for gateway-backed config, agent delete, and stream turn calls instead of importing the gateway client directly.

`lib/openclaw/application/runtime-service.ts` now owns:

- `getRuntimeOutput`
- `getTaskDetail`
- `ensureOpenClawRuntimeStateAccess`
- `touchOpenClawRuntimeStateAccess`
- `ensureOpenClawRuntimeSmokeTest`

`lib/openclaw/application/mission-service.ts` now owns:

- `submitMission`
- `abortMissionTask`

`lib/openclaw/application/settings-service.ts` now owns:

- `updateGatewayRemoteUrl`
- `updateWorkspaceRoot`

`lib/openclaw/application/workspace-service.ts` now owns the workspace mutation slice:

- `createWorkspaceProject`
- `updateWorkspaceProject`
- `deleteWorkspaceProject`
- Existing workspace reuse and manifest-agent repair for create.
- Workspace source materialization and scaffold writing for create.
- Bootstrapped workspace agent provisioning for create.
- Workspace kickoff mission dispatch for create.
- Create-time agent policy skill sync, snapshot invalidation, and runtime history clearing.
- Workspace rename/relocation and agent config path rewrite.
- Workspace plan edit application, manifest rewrite, doc override handling, and agent sync.
- Workspace delete cleanup for OpenClaw agents, agent config entries, workspace files, and runtime counts.

`lib/openclaw/service.ts` keeps the workspace compatibility exports but now delegates create/update/delete to `workspace-service`.

`lib/openclaw/application/channel-service.ts` now owns the channel registry mutation slice:

- `upsertWorkspaceChannel`
- `disconnectWorkspaceChannel`
- `deleteWorkspaceChannelEverywhere`
- `setWorkspaceChannelPrimary`
- `setWorkspaceChannelGroups`
- `bindWorkspaceChannelAgent`
- `unbindWorkspaceChannelAgent`
- Managed routing sync for bindings, Telegram group config, Discord guild config, Telegram session store reconciliation, and Telegram coordination policy skill sync.
- Managed channel/surface account provisioning for Telegram, Discord, Slack, Google Chat, Gmail, webhook, cron, and email surfaces.
- Telegram account resolution helpers, managed surface config normalization, Gmail setup argument building, and CLI fallback provisioning calls.

`lib/openclaw/service.ts` keeps the channel compatibility exports but now delegates channel registry mutation and managed provisioning workflows to `channel-service`.

`lib/openclaw/service.ts` delegates those moved functions to application services and remains the compatibility layer.

## Native WS Support Status

Native WS is intentionally narrow.

Supported natively:

- Handshake with the Gateway `connect` RPC.
- Generic request/response RPC calls through `call(method, params)`.
- Request id correlation.
- Timeout and abort cleanup.
- Error normalization and fallback to CLI.

Still CLI-backed by design:

- `status`
- `gateway status`
- `models status`
- `skills/plugins/models` catalog commands
- `config get/set/unset`
- `agents add/delete`
- `agent` turn execution
- streamed agent turns
- gateway start/stop/restart
- gateway probe

Reason: the local OpenClaw CLI and installed control UI confirmed the request/response RPC envelope, but AgentOS does not yet have a stable, tested mapping from every existing CLI command to equivalent Gateway RPC methods. Streaming was not moved because the current AgentOS stream behavior depends on CLI transcript compatibility and there is no safe tested native stream contract in this codebase.

## Fallback Behavior

Fallback is preserved at every layer:

- The factory returns `NativeWsOpenClawGatewayClient` with `CliOpenClawGatewayClient` as fallback.
- If native WS is disabled, unavailable, times out, fails handshake, closes, or returns an error, generic `call` falls back to CLI.
- Unsupported typed methods on the native client delegate directly to CLI.
- Settings/config still use the existing CLI/file-backed paths unless a safe Gateway RPC mapping is confirmed later.

## Still In `service.ts`

`lib/openclaw/service.ts` is smaller and now mostly owns compatibility exports plus legacy workspace document render helpers:

- Legacy workspace document render helper exports.
- Compatibility exports for older imports.

The remaining cleanup should focus on replacing or relocating legacy render helper exports, then adding an import guard once compatibility imports are limited to tests and known transitional modules.

## Prompt And Codebase Conflicts

- The prompt asked for native WS first. The codebase and local OpenClaw artifacts confirmed only the generic request/response Gateway RPC envelope, not a complete replacement for all CLI workflows. Decision: add native WS only for confirmed generic RPC calls and keep CLI fallback for typed workflows.
- Workspace mutation and channel/provisioning were moved incrementally with compatibility tests and CLI fallback preserved.
- A no-restricted-imports rule was not added yet because current compatibility tests and transitional modules still intentionally import `lib/openclaw/service.ts`. Adding it now would create noisy exceptions instead of a useful guard.

## Tests

Latest verification:

- `pnpm typecheck` passed.
- `pnpm lint` passed with 0 warnings.
- `pnpm test` passed: 78 tests.

Added/updated coverage:

- Native WS handshake success.
- Native WS handshake failure fallback to CLI.
- Native WS timeout fallback to CLI.
- Expanded adapter methods through `setOpenClawGatewayClientForTesting`.
- Runtime-service compatibility for missing runtime and missing task shapes.
- Mission-service compatibility for submit validation and missing-task abort shape.
- Settings-service compatibility for gateway URL and workspace root validation shapes.
- Workspace-service compatibility for workspace create/update/delete validation shapes.
- Channel-service compatibility for registry mutation validation and missing-channel shapes.
- Channel-service compatibility for managed provisioning validation shapes across chat and surface providers.

## Next Safe Migrations

Recommended next order:

1. Move or remove legacy workspace document render helper exports from `service.ts` after confirming no production callers depend on them.
2. Continue reducing `service.ts` until it is only compatibility exports.
3. Add an import guard once compatibility imports are limited to known allowlisted files.
