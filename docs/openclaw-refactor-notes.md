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

`lib/openclaw/service.ts` is smaller but still owns workflows that are riskier to move in one pass:

- Workspace create, update, delete, scaffold, reuse, repair, and delete cleanup.
- Workspace kickoff mission orchestration.
- Channel registry mutation and Telegram/Discord/surface provisioning.
- Channel bind/unbind, primary/group assignment, managed account setup, and registry sync.
- Agent/config provisioning helpers still shared by workspace/channel workflows.
- OpenClaw config mutation calls used by channel provisioning, now routed through the adapter but still owned by compatibility workflow code.
- Compatibility exports for older imports.

These should move only with focused characterization tests because they combine filesystem mutation, OpenClaw CLI/config mutation, cache invalidation, registry updates, and onboarding behavior.

## Prompt And Codebase Conflicts

- The prompt asked for native WS first. The codebase and local OpenClaw artifacts confirmed only the generic request/response Gateway RPC envelope, not a complete replacement for all CLI workflows. Decision: add native WS only for confirmed generic RPC calls and keep CLI fallback for typed workflows.
- The prompt asked to move all remaining slices if possible. Workspace mutation and channel/provisioning are still too interwoven with filesystem and registry mutation to move safely in the same pass without broader characterization coverage. Decision: move runtime, mission, settings, and adapter usage now; document workspace/channel as the next high-risk slices.
- A no-restricted-imports rule was not added yet because current compatibility tests and transitional modules still intentionally import `lib/openclaw/service.ts`. Adding it now would create noisy exceptions instead of a useful guard.

## Tests

Latest verification:

- `pnpm typecheck` passed.
- `pnpm lint` passed with 0 warnings.
- `pnpm test` passed: 63 tests.

Added/updated coverage:

- Native WS handshake success.
- Native WS handshake failure fallback to CLI.
- Native WS timeout fallback to CLI.
- Expanded adapter methods through `setOpenClawGatewayClientForTesting`.
- Runtime-service compatibility for missing runtime and missing task shapes.
- Mission-service compatibility for submit validation and missing-task abort shape.
- Settings-service compatibility for gateway URL and workspace root validation shapes.

## Next Safe Migrations

Recommended next order:

1. Expand workspace mutation characterization around scaffold contents, reuse, repair, config cleanup, runtime cleanup, and delete behavior.
2. Move workspace create/update/delete implementations into `workspace-service`.
3. Add channel registry mutation tests for bind/unbind, primary/group assignments, managed account creation, and registry cleanup.
4. Move channel/provisioning implementations into `channel-service`.
5. Continue reducing `service.ts` until only compatibility exports and shared legacy helpers remain.
6. Add an import guard once compatibility imports are limited to known allowlisted files.
