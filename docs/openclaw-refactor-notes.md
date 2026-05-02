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

`lib/openclaw/service.ts` is now an intentionally retained legacy compatibility/delegation entrypoint. Decision: keep the public compatibility surface for now, block new production imports, and require a deliberate compatibility audit before removing any export.

Remaining exports are classified as:

- Compatibility delegates:
  - Mission control: `clearMissionControlCaches`, `getMissionControlSnapshot`
  - Runtime reads/smoke checks: `ensureOpenClawRuntimeStateAccess`, `touchOpenClawRuntimeStateAccess`, `ensureOpenClawRuntimeSmokeTest`, `getRuntimeOutput`, `getTaskDetail`
  - Mission workflows: `submitMission`, `abortMissionTask`
  - Agent workflows: `createAgent`, `updateAgent`, `deleteAgent`
  - Workspace workflows: `createWorkspaceProject`, `updateWorkspaceProject`, `deleteWorkspaceProject`, `readWorkspaceEditSeed`
  - Settings workflows: `updateGatewayRemoteUrl`, `updateWorkspaceRoot`
  - Channel workflows: `upsertWorkspaceChannel`, `disconnectWorkspaceChannel`, `deleteWorkspaceChannelEverywhere`, `setWorkspaceChannelPrimary`, `setWorkspaceChannelGroups`, `bindWorkspaceChannelAgent`, `unbindWorkspaceChannelAgent`
  - Managed provisioning: `createManagedChatChannelAccount`, `createManagedSurfaceAccount`, `createTelegramChannelAccount`
  - Discovery/model/session re-exports: `discoverDiscordRoutes`, `discoverSurfaceRoutes`, `discoverTelegramGroups`, `getChannelRegistry`, `inferSessionKindFromCatalogEntry`, `inferFallbackModelMetadata`
- Legacy workspace document render helper compatibility delegates:
  - `renderAgentsMarkdown`, `renderSoulMarkdown`, `renderIdentityMarkdown`, `renderToolsMarkdown`, `renderHeartbeatMarkdown`, `renderMemoryMarkdown`, `renderBlueprintMarkdown`, `renderDecisionsMarkdown`, `renderBriefMarkdown`, `renderArchitectureMarkdown`, `renderDeliverablesMarkdown`, `renderTemplateSpecificDoc`
- Shared helpers still used by production:
  - None directly implemented in `service.ts`.
- Dead/unused exports:
  - None removed in this pass. The previously local, unused bootstrap-agent-id helper block in `service.ts` was removed because the real production implementation already lives in `lib/openclaw/domains/agent-provisioning.ts` and `workspace-service.ts`.

Legacy workspace document render helper implementation moved to `lib/openclaw/domains/workspace-document-renderers.ts`. `service.ts` still exports the same helper names and delegates to that domain module to preserve compatibility.

Direct production imports from `lib/openclaw/service.ts`: none found. Current imports are compatibility tests only:

- `tests/openclaw-application-service-compat.test.ts`
- `tests/openclaw-agent-service.test.ts`
- `tests/openclaw-channel-service.test.ts`
- `tests/openclaw-import-guard.test.ts` uses a synthetic import string to verify the guard.
- `tests/openclaw-mission-control-service.test.ts`
- `tests/openclaw-service-surface.test.ts`
- `tests/openclaw-workspace-service.test.ts`

Import guard status: `eslint.config.mjs` now blocks production TS/TSX imports of `@/lib/openclaw/service` and relative OpenClaw service imports. Tests remain allowed so compatibility coverage can keep exercising the legacy entrypoint. The guard is covered by tests that verify production imports fail once and compatibility test imports remain allowed.

Production-safety scans:

- No `lib/openclaw` import cycles were detected by a lightweight local import graph scan.
- No production direct imports from `lib/openclaw/service.ts` were found.
- Direct `runOpenClawJson` remains in `lib/openclaw/cli.ts`, which defines the CLI JSON helper.
- Direct `runOpenClawJson` remains in `lib/openclaw/client/cli-gateway-client.ts`, which is the intended CLI fallback layer.
- Direct `runOpenClawJson` also remains in `lib/openclaw/domains/agent-config.ts`, `lib/openclaw/domains/channels.ts`, `lib/openclaw/surface-adapters.ts`, and the legacy planner runtime path in `lib/openclaw/planner.ts`. These are existing config/discovery/planner readers for OpenClaw state or legacy runtime execution paths that have not yet been given stable Gateway RPC equivalents. They are intentionally left unchanged in this stabilization pass to preserve fallback behavior and response shapes.
- Direct `runOpenClaw` remains in `lib/openclaw/client/cli-gateway-client.ts`, `lib/openclaw/application/channel-service.ts`, `lib/openclaw/domains/agent-config.ts`, `lib/openclaw/domains/agent-provisioning.ts`, `lib/openclaw/planner.ts`, and `lib/openclaw/reset.ts`. These are still intentional CLI-backed fallback, provisioning, config sync, planner, and reset workflows until equivalent OpenClaw protocol support is confirmed.
- `hasGatewayRemoteUrlConfig` was removed from `lib/openclaw/domains/control-plane-settings.ts`; gateway remote URL existence checks now go through `OpenClawAdapter.hasConfig`, backed by the CLI fallback client. This moves that direct CLI command out of the domain layer without expanding native WS behavior.

## Prompt And Codebase Conflicts

- The prompt asked for native WS first. The codebase and local OpenClaw artifacts confirmed only the generic request/response Gateway RPC envelope, not a complete replacement for all CLI workflows. Decision: add native WS only for confirmed generic RPC calls and keep CLI fallback for typed workflows.
- Workspace mutation and channel/provisioning were moved incrementally with compatibility tests and CLI fallback preserved.
- A no-restricted-imports guard is now active for production code. Compatibility tests still intentionally import `lib/openclaw/service.ts`.

## Tests

Latest verification:

- `pnpm typecheck` passed.
- `pnpm lint` passed with 0 warnings.
- `pnpm test` passed: 91 tests.

Runtime production-readiness follow-up:

- Workspace creation now returns the same path-derived slug id used by mission-control snapshots and `/api/workspaces`.
- Workspace update/delete and agent workspace resolution still accept the previous `workspace:<hash>` id as a legacy alias so older compatibility callers do not fail immediately.
- Runtime session normalization now uses the same workspace id helper, keeping task/runtime workspace links aligned with snapshot workspace ids.
- This fixes the observed create flow where a newly created workspace selected an id that did not exist in the refreshed snapshot, leaving the canvas empty until a page reload.

Added/updated coverage:

- Native WS handshake success.
- Native WS handshake failure fallback to CLI.
- Native WS timeout fallback to CLI.
- Expanded adapter methods through `setOpenClawGatewayClientForTesting`.
- Adapter/client coverage for `hasConfig`, used by settings-service to avoid direct CLI config existence checks in the domain layer.
- Runtime-service compatibility for missing runtime and missing task shapes.
- Mission-service compatibility for submit validation and missing-task abort shape.
- Settings-service compatibility for gateway URL and workspace root validation shapes.
- Workspace-service compatibility for workspace create/update/delete validation shapes.
- Workspace id compatibility for current snapshot ids and legacy hash aliases.
- Workspace document render helper compatibility delegates.
- Channel-service compatibility for registry mutation validation and missing-channel shapes.
- Channel-service compatibility for managed provisioning validation shapes across chat and surface providers.
- Additional channel-service compatibility for direct managed chat provisioning validation shapes across Telegram, Discord, Slack, and Google Chat.
- Import guard coverage for blocking production `service.ts` imports without duplicate lint noise while allowing compatibility tests.
- Boundary safety coverage for production `service.ts` imports, allowlisted direct `runOpenClawJson` usage, allowlisted direct `runOpenClaw` usage, and `lib/openclaw` import cycles.
- Compatibility surface coverage that keeps the explicit `service.ts` export list from changing accidentally.

Native WS status is unchanged from the previous continuation: narrow generic RPC support only, with typed workflows still CLI-backed. CLI fallback status is unchanged and remains required for production safety.

Current risks:

- `service.ts` is still part of the public compatibility surface, so removing any export requires a separate caller audit and migration.
- Workspace document rendering now has a dedicated legacy renderer module for compatibility, while `workspace-docs.ts` continues to own richer scaffold rendering used by production workspace creation. These are intentionally not merged in this pass to avoid changing scaffold output.
- Some domain/application workflows still call the OpenClaw CLI directly because no stable native Gateway method mapping is confirmed for those operations.
- Channel-service remains broad. No additional split was made because the current helper groups are coupled to routing sync, account discovery, and provisioning side effects.

## Next Safe Migrations

Recommended next order:

1. Keep the import guard in place and migrate any future production caller to the owning application/domain module instead of `service.ts`.
2. If the compatibility render helpers are still needed by external callers, keep them delegated through `service.ts`; otherwise remove them in a separate breaking-surface audit.
3. When OpenClaw exposes confirmed Gateway RPC equivalents for channel/config discovery and provisioning, move those remaining direct CLI-backed domain/application calls behind the adapter/client boundary.
