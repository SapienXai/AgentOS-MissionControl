# OpenClaw Critical CLI-Backed Migration Review

Date: 2026-05-03

Scope:

- Agent create/update/delete
- Agent run/streaming/transcript behavior
- Channel/provider provisioning and discovery

This pass did not add product features and did not migrate unsupported or behaviorally ambiguous OpenClaw operations.

## Gateway Method Evidence

Evidence sources:

- AgentOS client and adapter code.
- Installed OpenClaw `2026.4.2` protocol schema in `/opt/homebrew/lib/node_modules/openclaw/dist/method-scopes-DNlWj6m4.js`.
- Existing AgentOS tests and runtime smoke behavior.
- Local `openclaw gateway call` probes, which were blocked by pairing requirements in this environment.

Confirmed Gateway methods relevant to this pass:

- `agents.list`: already Gateway-first.
- `agents.create`: method exists, but the request schema only accepts `name`, `workspace`, optional `emoji`, and optional `avatar`.
- `agents.update`: method exists, but only accepts `agentId`, optional `name`, optional `workspace`, optional `model`, and optional `avatar`.
- `agents.delete`: method exists, accepts `agentId` and optional `deleteFiles`.
- `agent`: method exists and accepts message/session/channel fields plus required `idempotencyKey`.
- `agent.wait`: method exists.
- `sessions.create`, `sessions.send`, `sessions.abort`, and related session methods exist.
- `channels.status`: method exists with stable read/status schema.
- `channels.logout`: method exists.

## Operation Matrix

| Area | Current file/path | Current CLI command/helper | Current AgentOS behavior | Side effects | Gateway candidate | Confirmed? | Shape confidence | Migrated now? | CLI fallback required? | Risk if migrated incorrectly | Required tests |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Agent create | `lib/openclaw/application/agent-service.ts`, `lib/openclaw/client/cli-gateway-client.ts` | `openclaw agents add <id> --workspace --agent-dir --model --non-interactive --json` | Creates the OpenClaw agent, then writes AgentOS policy skill files, workspace skill markdown, config list entry, identity files, bootstrap files, workspace manifest metadata, and syncs policy skills. | Agent directory, OpenClaw config, AgentOS config, identity/bootstrap files, manifest metadata, cache invalidation. | `agents.create` | Yes | Low for AgentOS needs | No | Yes | Gateway schema does not accept AgentOS `id`, `agentDir`, or `model`; using it would change agent ids, directory layout, model assignment, and snapshot shape. | Regression test keeps `addAgent` on CLI fallback. |
| Agent update | `lib/openclaw/application/agent-service.ts`, `lib/openclaw/domains/agent-config.ts` | Config file writes plus identity/bootstrap helpers | Updates model-only fast path or full identity/policy/tool/skill/manifest metadata path. | OpenClaw config list, identity file, policy skill files, workspace manifest metadata, cache invalidation. | `agents.update` | Yes | Medium for model/name only, low for full AgentOS update | No | Yes | Partial Gateway update would diverge from AgentOS manifest/config side effects and could leave snapshots inconsistent. | Existing agent-service validation tests plus fallback-required test. |
| Agent delete | `lib/openclaw/application/agent-service.ts`, `lib/openclaw/client/cli-gateway-client.ts` | `openclaw agents delete <id> --force --json` | Deletes OpenClaw agent, prunes config entry, removes workspace manifest metadata, removes policy skill folder, clears runtime history. | OpenClaw config/files, AgentOS config/manifest cleanup, skill cleanup, runtime cache clear. | `agents.delete` | Yes | Medium | No | Yes | Gateway delete response only confirms agent removal and removed bindings; AgentOS still needs exact cleanup semantics and delete-file behavior parity. | Regression test keeps `deleteAgent` on CLI fallback. |
| Agent non-streaming turn | `lib/openclaw/client/cli-gateway-client.ts`, `app/api/agents/[agentId]/chat/route.ts`, mission dispatch domains | `openclaw agent --agent --session-id --message --thinking --timeout --json` | Runs an agent turn, records transcript/session side effects used by AgentOS polling and runtime cards, returns existing payload shape. | Session transcript files, session store, runtime metadata, model usage, possible delivery side effects. | `agent`, `agent.wait`, `sessions.send` | Yes | Low for end-to-end AgentOS parity | No | Yes | Gateway method exists, but local runtime could not confirm final payload, transcript write timing, session visibility, timeout, cancellation, and metadata parity without valid Gateway auth. | Regression test keeps `runAgentTurn` on CLI fallback; real chat stream smoke validates current behavior. |
| Agent streaming turn | `lib/openclaw/client/cli-gateway-client.ts`, chat route polling | `runOpenClawJsonStream(openclaw agent ... --json)` | UI streams status/assistant/done events and polls transcript files for partial/final text. | JSON stream ordering, transcript polling, abort handling, timeout behavior, final payload normalization. | `agent`, session subscribe/send methods | Partial | Low | No | Yes | Streaming event contract is not proven equivalent. Incorrect migration would break visible chat streaming, partial output, abort, and session/runtime visibility. | Regression test keeps `streamAgentTurn` on CLI fallback. |
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

`channels.status` is now available as a typed Gateway-first operation behind `OpenClawGatewayClient` and `OpenClawAdapter`.

Files changed:

- `lib/openclaw/client/types.ts`
- `lib/openclaw/client/gateway-client.ts`
- `lib/openclaw/client/cli-gateway-client.ts`
- `lib/openclaw/client/native-ws-gateway-client.ts`
- `lib/openclaw/adapter/openclaw-adapter.ts`
- `tests/openclaw-native-ws-gateway-client.test.ts`
- `tests/openclaw-adapter.test.ts`
- `scripts/openclaw-runtime-smoke.mjs`

Behavior:

- Native WS calls `channels.status` first.
- The response is schema-validated and unknown fields are tolerated.
- Malformed Gateway responses fall back to the CLI fallback client and record diagnostics.
- If native Gateway auth is unavailable, existing CLI fallback behavior remains.
- No channel provisioning, route discovery, or UI behavior was changed.

## CLI Fallback Required

These operations intentionally remain CLI-backed:

- `addAgent`
- `deleteAgent`
- `runAgentTurn`
- `streamAgentTurn`
- Agent config read/write/sync helpers in `domains/agent-config.ts`
- Channel log/config route discovery in `domains/channels.ts`
- Channel and surface provisioning orchestration in `application/channel-service.ts`
- Planner/runtime legacy execution paths

Reasons:

- Gateway mutation schemas do not match AgentOS' existing create/update inputs and side effects.
- Agent run/streaming method names exist, but transcript/session side effects and streaming event semantics were not proven equivalent in this environment.
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
- `pnpm test`: passed, 108 tests.
- `pnpm build`: sandboxed run failed with the known Turbopack worker/port `Operation not permitted` error; rerun outside the sandbox passed.
- `node scripts/openclaw-runtime-smoke.mjs`: sandboxed localhost fetch failed; rerun outside the sandbox passed all non-blocked checks and reported channel/provider status as blocked by Gateway pairing/auth.

## SDK Replacement Point

When the public OpenClaw SDK is available, the replacement point remains:

- `lib/openclaw/client/gateway-client-factory.ts`

A future SDK-backed client should implement the existing `OpenClawGatewayClient` interface. Application services, API routes, and UI components should not change.

## Remaining Risks

- Agent run/streaming is still the highest-risk migration area because AgentOS depends on transcript polling, session runtime cards, partial output, final payload shape, timeout behavior, and abort behavior.
- Agent create/update/delete remain fragile against OpenClaw CLI changes because the confirmed Gateway schemas do not support AgentOS' current `id`/`agentDir`/model creation contract.
- Channel/provider provisioning remains CLI/application-service backed because it spans credentials, OpenClaw config, AgentOS registry metadata, managed route sync, and local session-store updates.
- Native WS successful-auth runtime validation still requires a real Gateway token/password or a supported device-auth path.
