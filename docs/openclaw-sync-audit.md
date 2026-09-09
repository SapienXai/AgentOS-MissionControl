# OpenClaw Gateway Sync Audit

Date: 2026-05-16

This pass audited AgentOS against the current OpenClaw Gateway-first architecture and kept the compatibility boundary:

`UI -> API routes -> application services -> OpenClaw adapter/client -> OpenClaw Gateway or CLI fallback`

AgentOS remains the human operating layer. OpenClaw remains the source of truth for gateway state, agents, sessions, models, channels, skills, config, approvals, and runtime execution.

## Session And Task Contract

AgentOS must keep these OpenClaw identity boundaries intact:

- Agent card chat is direct OpenClaw session chat. It may use an AgentOS session index to rehydrate the drawer, but OpenClaw session history remains the runtime source of truth.
- Mission and task cards represent OpenClaw task state when a native task id is available. When a native task id is missing, task cards are explicitly `dispatch-derived` or `runtime-derived` UI projections, not replacement OpenClaw tasks.
- Task follow-up means continuing the existing task's resolved OpenClaw session context with a new turn. A follow-up must never silently fall back to an agent default session or create a new session just because a dispatch id exists.
- Follow-up availability requires an agent id and a resolvable `sessionKey` or `sessionId`. `dispatchId` alone is tracking context, not continuation authority.
- Native task identity wins over dispatch/runtime duplicates. Runtime, transcript, artifact, token, and file signals enrich a task card but do not override native task identity.
- CLI fallback remains explicit and observable. It must not hide missing native session/task context or fake a successful OpenClaw-backed follow-up.

## Surfaces Checked

Sources checked:

- OpenClaw docs: `https://docs.openclaw.ai/gateway/protocol`
- OpenClaw repository: `https://github.com/openclaw/openclaw`
- OpenClaw source files from `main`:
  - `docs/gateway/protocol.md`
  - `src/gateway/methods/core-descriptors.ts`
  - `src/gateway/protocol/version.ts`
  - `src/gateway/protocol/schema/config.ts`
  - `src/gateway/protocol/schema/logs-chat.ts`
  - `src/gateway/protocol/schema/sessions.ts`
  - `src/gateway/protocol/schema/agents-models-skills.ts`

Current source expectation:

- Gateway protocol version: `4`
- Gateway discovery source: `hello-ok.features.methods` and `hello-ok.features.events`
- Current method names include `health`, `status`, `models.list`, `models.authStatus`, `agents.list/create/update/delete`, `sessions.list/create/send/abort/subscribe/messages.subscribe`, `chat.history/send/abort`, `channels.status/start/stop/logout`, `skills.status/search/detail/install/update`, `plugins.uiDescriptors`, `config.get/set/schema/schema.lookup/patch/apply`, `exec.approval.*`, `plugin.approval.*`, `update.status`, `update.run`, and `gateway.restart.*`.

Local installed OpenClaw observed during the original audit was a pre-baseline build.

Latest OpenClaw source observed during the original audit was also pre-baseline.

## Gateway-First Now

AgentOS now prefers native Gateway RPC for these operations when the Gateway is reachable and the RPC contract is usable:

- Gateway health/status read: `health` and `status`
- Model status/list: `models.authStatus` and `models.list`
- Agent list/create/update/delete: `agents.list`, `agents.create`, `agents.update`, and `agents.delete`
- Sessions list: `sessions.list`
- Mission dispatch: `chat.send`, with `sessions.send` fallback before CLI fallback
- Mission abort: `sessions.abort`, with `chat.abort` fallback before CLI fallback
- Channel status: `channels.status`
- Skills/plugins catalog reads: `skills.status` and `plugins.uiDescriptors`
- Config reads/schema/mutations: `config.get`, `config.schema.lookup`, `config.schema`, `config.patch`, `config.apply`, and legacy `config.set` only when safe
- Health/logs/approvals/cron diagnostics: `health`, `logs.tail`, `exec.approval.list`, `exec.approval.resolve`, `cron.status`, and `cron.list`
- Persistent runtime events: Gateway WebSocket plus `sessions.subscribe` and `sessions.messages.subscribe`

Capability detection now probes the native Gateway handshake and reads advertised methods/events from `hello-ok.features`. Diagnostics/settings continue to expose the capability matrix, including OpenClaw version, AgentOS' requested protocol range, negotiated protocol version, auth mode, auth role/scopes, supported methods/events, per-operation Gateway/CLI/degraded decisions, config support, chat/event support, channel support, logs support, cron support, skills support, approval support, update support, native mission support, native agent lifecycle support, and fallback diagnostics.

## CLI Fallback Still Required

The CLI fallback remains intentional for:

- Install, setup, onboarding, recovery, doctor, and invalid-config repair flows.
- Gateway process control: start/stop/restart still uses CLI because the Gateway cannot fully control its own process lifecycle from an unavailable or restarting state.
- `models.scan`, because the current Gateway source does not expose a native `models.scan` method.
- Gateway probe/discovery helpers, because the current supported native read surface is `health`/`status`; CLI `gateway probe` still provides broader reachability diagnostics.
- Agent create/update fallback, when the Gateway does not advertise `agents.create` / `agents.update` or rejects the request. Native create uses only the exact 2026.9.3 fields (`name`, `workspace`, `model`, `emoji`, `avatar`); AgentOS still owns policy skills, worker-profile sidecar metadata, workspace manifests, and local metadata around those Gateway calls.
- Streaming chat transcript fallback where native session events are unavailable or older Gateways do not advertise compatible event subscriptions.
- Channel/provider provisioning and route discovery with side effects across OpenClaw config, channel registries, logs, session stores, and AgentOS managed surface records.
- Legacy planner/runtime compatibility paths that still depend on local OpenClaw state and CLI behavior.

## Config Safety

Config writes now prefer schema-aware Gateway operations:

- Read the current snapshot through `config.get`.
- Preserve `hash` as `baseHash` for concurrency protection.
- Probe `config.schema` when available.
- Prefer `config.patch` with a merge-patch `raw` payload.
- Fall back to `config.apply` with `baseHash` when patch is unavailable.
- Refuse to send full-config writes when the snapshot contains redacted OpenClaw secrets.
- Refuse direct writes of the `__OPENCLAW_REDACTED__` placeholder.
- Keep CLI `config set/unset` as the path-level fallback.

## Obsolete Names Avoided

The latest source does not confirm these older names as primary Gateway contracts for this pass:

- `gateway.status`
- `gateway.probe`
- `models.status`
- `models.scan`
- `skills.list`
- `plugins.list`
- `events.subscribe`
- `sessions.chat.send`
- `approvals.list`
- `approvals.respond`
- `updates.status`
- `updates.apply`

AgentOS now treats the current method names listed above as the native path and keeps CLI fallback for unsupported or older Gateway versions.

## Tests Added Or Updated

- Capability detection against current Gateway method/event names.
- Native Gateway handshake feature discovery.
- Protocol mismatch diagnostics and recovery guidance.
- Gateway-first model auth/list normalization.
- Gateway-first agent create/update with unsupported-method fallback.
- Gateway-first mission dispatch path selection, including unknown capability discovery.
- Gateway-native stream adapter behavior through `chat.send` and session events, plus direct-chat transcript/history recovery when events do not include assistant text.
- Mission abort native path selection.
- Gateway session event subscription without legacy `events.subscribe`.
- Config patch payload shape with `baseHash`.
- Config `patch` to `apply` fallback.
- Native logs, cron, and exec approval adapter/client methods.
- Redacted secret write refusal.
- CLI fallback behavior when native Gateway responses are unsupported or malformed.

## Remaining Risks

- `agents.create` does not accept every AgentOS metadata side effect directly. AgentOS uses the native method first, then applies AgentOS-owned policy skills, worker-profile sidecar metadata, workspace manifests, and local metadata. Unsupported Gateways still use CLI/application fallback.
- Older native-create attempts could leave a duplicate global OpenClaw agent beside the AgentOS workspace-local agent when the Gateway generated its own id/path. AgentOS suppresses that legacy duplicate in snapshots when the workspace and display name match and the workspace-local agent is present.
- Direct streamed chat UI now attempts native Gateway streaming first. Transcript/history polling remains as response recovery because Gateway session events can be status-only and may omit assistant response text.
- Config merge-patch paths cannot represent array-index writes safely; those paths continue through CLI fallback.
- Some Gateway methods are available in source but not yet integrated because AgentOS does not add higher-level operator/workspace value there today, for example low-level `tools.*`, `agent.wait`, `sessions.preview`, device/node pairing APIs, and wizard RPCs.
- Local installed OpenClaw may lag latest source. Capability detection and CLI fallback are the compatibility guard for that skew.
