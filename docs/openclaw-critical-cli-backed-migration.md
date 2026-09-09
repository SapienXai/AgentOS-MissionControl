# OpenClaw Critical CLI-Backed Migration Review

Date: 2026-05-03

Gateway-first update: 2026-05-16.

The May 2026 Gateway-first pass migrated agent create/update/delete, mission dispatch/abort, config schema lookup/patch/apply, logs, approvals, cron reads, and native stream adapter support behind capability detection. CLI fallback is still retained for unsupported Gateway versions, recovery, gateway process control, transcript compatibility, and side-effect-heavy provisioning flows.

Scope:

- Agent create/update/delete
- Agent run/streaming/transcript behavior
- Channel/provider provisioning and discovery

The original 2026-05-03 pass did not migrate unsupported or behaviorally ambiguous OpenClaw operations. The 2026-05-15 pass keeps the compatibility guidance below, but changes several rows from "CLI only" to "Gateway-first with CLI fallback."

## Gateway Method Evidence

Evidence sources:

- AgentOS client and adapter code.
- Latest OpenClaw Gateway protocol docs and OpenClaw source checked during the original migration pass.
- Existing AgentOS tests and runtime smoke behavior.
- Local `openclaw gateway call` probes against a pre-baseline OpenClaw install.

Confirmed Gateway methods relevant to this pass:

- `agents.list`: already Gateway-first.
- `agents.create`: method exists. AgentOS maps its requested identity to the native `name` field and sends the exact 2026.9.1 payload; `id` and `agentDir` are not sent because they are not accepted by the native schema. AgentOS still owns bindings, skills, and workspace metadata side effects.
- `agents.update`: method exists, but only accepts `agentId`, optional `name`, optional `workspace`, optional `model`, and optional `avatar`.
- `agents.delete`: method exists, accepts `agentId` and optional `deleteFiles`.
- `chat.send`, `sessions.send`, `sessions.abort`, and `chat.abort` exist for native mission dispatch and abort.
- `agent.wait`: method exists.
- `sessions.create`, `sessions.send`, `sessions.abort`, and related session methods exist.
- `channels.status`: method exists with stable read/status schema.
- `channels.logout`: method exists.

## Operation Matrix

| Area | Current file/path | Current CLI command/helper | Current AgentOS behavior | Side effects | Gateway candidate | Confirmed? | Shape confidence | Migrated now? | CLI fallback required? | Risk if migrated incorrectly | Required tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Agent create | `lib/openclaw/application/agent-service.ts`, `lib/openclaw/client/native-ws-gateway-client.ts`, `lib/openclaw/client/cli-gateway-client.ts` | `openclaw agents add <id> --workspace --agent-dir --model --non-interactive --json` | Uses `agents.create` first, then writes AgentOS policy skill files, workspace skill markdown, config list entry, identity files, worker-profile sidecar metadata, workspace manifest metadata, and syncs policy skills. | Agent directory, OpenClaw config, AgentOS config, worker-profile/identity metadata, manifest metadata, cache invalidation. | `agents.create` | Yes | Medium for native lifecycle, low for AgentOS custom provisioning | Yes, Gateway-first | Yes | AgentOS metadata side effects must stay application-owned around the native call. | Gateway-first plus CLI fallback lifecycle tests and application service validation tests. |
| Agent update | `lib/openclaw/application/agent-service.ts`, `lib/openclaw/domains/agent-config.ts` | Config file writes plus identity/bootstrap helpers | Uses `agents.update` first for native lifecycle fields, then updates model-only or full identity/policy/tool/skill/manifest metadata paths. | OpenClaw config list, identity file, policy skill files, workspace manifest metadata, cache invalidation. | `agents.update` | Yes | Medium for native lifecycle, low for full AgentOS metadata | Yes, Gateway-first | Yes | Gateway update alone cannot replace AgentOS manifest/config side effects. | Existing agent-service validation tests plus native/fallback tests. |
| Agent delete | `lib/openclaw/application/agent-service.ts`, `lib/openclaw/client/native-ws-gateway-client.ts`, `lib/openclaw/client/cli-gateway-client.ts` | `openclaw agents delete <id> --force --json` | Deletes OpenClaw agent, prunes config entry, removes workspace manifest metadata, removes policy skill folder, clears runtime history. | OpenClaw config/files, AgentOS config/manifest cleanup, skill cleanup, runtime cache clear. | `agents.delete` | Yes | Medium | Yes, Gateway-first | Yes | Gateway delete removes the OpenClaw agent; AgentOS cleanup remains application-owned. | Gateway-first lifecycle tests plus application service validation tests. |
| Agent non-streaming turn | `lib/openclaw/client/native-ws-gateway-client.ts`, `lib/openclaw/domains/mission-dispatch-workflow.ts`, `app/api/agents/[agentId]/chat/route.ts` | `openclaw agent --agent --session-id --message --thinking --timeout --json` | Mission dispatch uses native `chat.send` first when capabilities are supported or unknown, with `sessions.send` and CLI fallbacks. | Session transcript files, session store, runtime metadata, model usage, possible delivery side effects. | `chat.send`, `sessions.send`, `sessions.abort`, `chat.abort` | Yes | Medium | Yes, Gateway-first for mission dispatch/abort | Yes | Older Gateways still need the CLI runner/transcript path to preserve snapshot behavior. | Native-vs-fallback mission dispatch tests and existing chat/runtime tests. |
| Agent streaming turn | `lib/openclaw/client/native-ws-gateway-client.ts`, `lib/openclaw/application/event-bridge-service.ts`, chat route polling | `runOpenClawJsonStream(openclaw agent ... --json)` | The adapter supports Gateway session subscriptions and `chat.send`; the direct chat route now attempts native Gateway streaming first and uses transcript/history polling to recover assistant text when events are status-only. | Event ordering, transcript polling fallback, abort handling, timeout behavior, final payload normalization. | `sessions.subscribe`, `sessions.messages.subscribe`, `chat.send`, `sessions.send` | Partial | Medium | Adapter yes; direct chat UI no longer forces CLI streaming | Yes | Gateway session events can be status-only, so direct chat keeps transcript/history recovery to avoid empty assistant replies. | Event normalization, native stream tests, and existing chat/runtime tests. |
| Transcript/session reads | `mission-control-service.ts`, `domains/session-catalog.ts`, `domains/runtime-transcript.ts` | `sessions.list` through Gateway-first plus filesystem fallback | Builds runtime/task/session cards from session catalogs and transcript files. | Reads OpenClaw state files and transcript JSONL. | `sessions.list`, `sessions.preview`, `sessions.resolve`, `sessions.get` | Yes | Medium | Already partially Gateway-first for list | Yes for transcript file parsing | AgentOS runtime cards depend on local transcript normalization and mission metadata merging. | Existing mission-control/runtime tests. |
| Channel status/read | `lib/openclaw/client/native-ws-gateway-client.ts` | Previously no typed adapter method; status could only be reached through raw/generic gateway call or CLI channel command. | Read-only channel/provider health/status. | None beyond Gateway read/probe. | `channels.status` | Yes | High for read/status | Yes | Yes on Gateway auth/pairing failure | Low, because it is read-only and normalized at the client boundary. | Added native WS channel status success and malformed fallback tests. |
| Telegram discovery | `lib/openclaw/domains/channels.ts` | `openclaw channels logs --channel telegram --json --lines`, `openclaw config get channels.telegram.groups --json`, local state reads | Discovers recent/configured groups, merges allowlist/config state, avoids crashes without credentials. | Reads gateway logs, config, local pairing/account files. | `channels.status` only for account status; no confirmed route-log equivalent | Partial | Low | No | Yes | Replacing log/config parsing with status would remove group route discovery and change UI choices. | Existing channel-service/provider validation tests. |
| Discord discovery | `lib/openclaw/domains/channels.ts` | `openclaw channels logs --channel discord --json --lines`, `openclaw config get channels.discord.guilds --json` | Discovers configured guild/channel/thread routes and recent routes. | Reads logs/config, parses Discord route ids. | `channels.status` only for account status; no confirmed route-log equivalent | Partial | Low | No | Yes | Would lose configured route and thread discovery behavior. | Existing channel-service/provider validation tests. |
| Slack/Google Chat provisioning | `lib/openclaw/application/channel-service.ts` | `openclaw channels add --channel slack/googlechat ...` | Validates required fields, provisions OpenClaw channel account, writes AgentOS registry/routing metadata. | OpenClaw config, AgentOS registry, routing sync. | No confirmed side-effect-equivalent setup method | No | Low | No | Yes | Incorrect migration could write incomplete credentials or skip registry/routing sync. | Existing validation tests. |
| Gmail surface provisioning | `lib/openclaw/application/channel-service.ts` | `openclaw webhooks gmail setup --account ...`, config reads/writes | Runs Gmail setup, updates hook presets and hooks.gmail config, then writes AgentOS managed surface account. | Webhook/Gmail config, hooks presets, AgentOS registry. | No confirmed Gateway setup method | No | Low | No | Yes | Gateway replacement not proven and would risk credential/setup persistence. | Existing validation tests. |
| Webhook/cron/email surface provisioning | `lib/openclaw/application/channel-service.ts` | Adapter config get/set plus provider-specific validation | Writes OpenClaw config paths and AgentOS managed surface records. | Config mutation and registry metadata. | `config.get/set` already Gateway-first where safe | Partial | Medium for config, low for full provisioning | Already uses Gateway-first config path indirectly | Yes for provisioning orchestration | The orchestration includes AgentOS registry semantics beyond raw config mutation. | Existing validation tests. |
| Routing sync | `lib/openclaw/application/channel-service.ts` | Adapter `setConfig` plus local session store rewrites | Syncs Telegram/Discord routing config, session stores, account defaults. | Config, session store files, agent policy skill sync. | `config.set` already Gateway-first where safe | Partial | Medium | Already partially via config adapter | Yes for local session store and coordination writes | Gateway config write alone cannot replace local session-store/policy side effects. | Existing channel-service tests. |
| Planner/runtime paths | `lib/openclaw/planner.ts`, runtime domains | Direct CLI and local state helpers | Legacy planner execution and runtime/task normalization. | Runtime execution, local state reads/writes. | Not confirmed as stable Gateway control-plane contract | No | Low | No | Yes | High; planner/runtime behavior is broad and user-visible. | Existing planner/runtime tests. |

## Migrated In This Pass

`channels.status`, agent delete, mission dispatch/abort, config patch/apply, and Gateway session event subscription are now available as Gateway-first operations behind `OpenClawGatewayClient` and `OpenClawAdapter`.

Files changed:

- `lib/openclaw/client/types.ts`
- `lib/openclaw/client/gateway-client.ts`
- `lib/openclaw/client/cli-gateway-client.ts`
- `lib/openclaw/client/native-ws-gateway-client.ts`
- `lib/openclaw/adapter/openclaw-adapter.ts`
- `lib/openclaw/application/capability-matrix-service.ts`
- `lib/openclaw/application/event-bridge-service.ts`
- `lib/openclaw/domains/mission-dispatch-workflow.ts`
- `tests/openclaw-native-ws-gateway-client.test.ts`
- `tests/openclaw-adapter.test.ts`
- `tests/openclaw-gateway-first-contract.test.ts`
- `scripts/openclaw-runtime-smoke.mjs`

Behavior:

- Native WS calls Gateway mission, event, channel, catalog, status, agent delete, and config methods first when available.
- The response is schema-validated and unknown fields are tolerated.
- Malformed Gateway responses fall back to the CLI fallback client and record diagnostics.
- If native Gateway auth is unavailable, existing CLI fallback behavior remains.
- No channel provisioning, route discovery, or UI behavior was changed.

## CLI Fallback Required

These operations intentionally retain CLI fallback:

- `streamAgentTurn` when Gateway event subscriptions or dispatch methods are unavailable
- agent creation/update and mission dispatch when Gateway methods are unsupported, unreachable, malformed, or scope-limited
- Agent config read/write/sync helpers in `domains/agent-config.ts`
- Channel log/config route discovery in `domains/channels.ts`
- Channel and surface provisioning orchestration in `application/channel-service.ts`
- Planner/runtime legacy execution paths

Reasons:

- AgentOS owns workspace metadata, policy skills, worker-profile sidecar metadata, local session-store coordination, and registry side effects around Gateway calls.
- Direct streaming still depends on transcript/session behavior when `sessions.subscribe` or `sessions.messages.subscribe` is unavailable or incomplete.
- Channel/provider provisioning has AgentOS registry, routing, session-store, and credential/setup side effects that are not represented by a single confirmed Gateway method.
- Local `openclaw gateway call` probes are blocked by pairing in this environment, so runtime confirmation is limited without a valid Gateway token/device auth path.

## Runtime Smoke Additions

`scripts/openclaw-runtime-smoke.mjs` now also checks:

- Gateway fallback diagnostics are visible in the snapshot when fallback occurs.
- Channel/provider status through the adapter. If the local Gateway auth path is blocked by pairing/auth requirements, the check is reported as `BLOCKED` rather than a false success.

Latest runtime smoke result:

- Gateway health/status: PASS.
- Model status: PASS.
- Agents list: PASS.
- Sessions/recent activity: PASS.
- Gateway fallback diagnostics: PASS.
- Agent preflight: PASS.
- Channel/provider status: BLOCKED in this environment because native Gateway auth is unavailable and the CLI `gateway call channels.status` fallback requires pairing.
- Forced CLI fallback snapshot: PASS.

## Verification

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 128 tests.
- `pnpm build`: passed.
- `node scripts/openclaw-runtime-smoke.mjs`: sandboxed localhost fetch failed; rerun outside the sandbox passed all non-blocked checks and reported channel/provider status as blocked by Gateway pairing/auth.

## SDK Replacement Point

When the public OpenClaw SDK is available, the replacement point remains:

- `lib/openclaw/client/gateway-client-factory.ts`

A future SDK-backed client should implement the existing `OpenClawGatewayClient` interface. Application services, API routes, and UI components should not change.

## Remaining Risks

- Direct chat streaming remains a compatibility-sensitive area because Gateway session events can omit assistant text. AgentOS now attempts native Gateway streaming first and keeps transcript/history recovery for Gateway versions or runs that emit status-only events.
- Agent create/update still require AgentOS-owned metadata/config side effects around the native lifecycle calls.
- Agent list snapshots suppress legacy native-create duplicates when a global OpenClaw agent and an AgentOS workspace-local agent have the same workspace/display name. This is a compatibility guard for records produced before native create carried AgentOS `id` and `agentDir`.
- Channel/provider provisioning remains CLI/application-service backed because it spans credentials, OpenClaw config, AgentOS registry metadata, managed route sync, and local session-store updates.
- Native WS successful-auth runtime validation still requires a real Gateway token/password or a supported device-auth path.
