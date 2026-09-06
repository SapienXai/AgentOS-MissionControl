# AgentOS Workforce Operations v1

This document records the ownership and projection boundary for the Workforce
vertical slice. It is intentionally concise; OpenClaw remains the runtime
source of truth.

## Authority and linkage

- A **Mission** is an AgentOS product object: a human goal, title, workspace
  context, initial worker intent, and immutable link to a dispatch.
- The durable AgentOS dispatch sidecar stores submission intent and the native
  runtime identity once OpenClaw returns it. It does not mirror task/session
  lifecycle fields.
- OpenClaw owns sessions, tasks, child-task relationships, execution state,
  outputs, created files, retries supported by the Gateway, and cancellation.
- `getWorkforceMissionList` and `getWorkforceMissionDetail` are the bounded
  application projection boundary. The UI never calls Gateway methods directly.
- Mission creation uses the existing `POST /api/mission` mutation and its
  OpenClaw preflight/idempotency path. Workforce reads use `/api/missions` and
  `/api/missions/:id`.
- A repeated client request id converges to the existing dispatch record before
  a new sidecar or native turn is created. The dispatch id is never silently
  relinked to another runtime.

## Presentation state

`resolveWorkforceMissionState` is the single state resolver. List and detail
build the same state-critical context from one visible Mission Control
snapshot. Human Control capability resolution is bounded to 16 relevant
contexts with four concurrent Gateway reads; advisory suggested work is not a
mission blocker. Its precedence is:

1. authoritative cancellation;
2. unresolved approval/question → `waiting-human`;
3. explicit blocker/runtime issue → `blocked`;
4. authoritative failure/stalled task → `failed`;
5. authoritative root completion → `completed`;
6. Gateway/snapshot loss without terminal evidence → `reconnecting`;
7. active child with an idle parent → `waiting-worker`;
8. active root/runtime → `running`;
9. accepted dispatch without observed runtime → `starting`;
10. otherwise → `queued`.

A child completing never completes its parent by itself. Long-running work is
not inferred to be blocked from elapsed time.

Native root `completed` and `cancelled` evidence wins over stale sidecar,
attention, or reconnecting evidence. Child runtime statuses are never fed into
the root-active slot: `activeRuntimeStatuses` is root-only and child activity
comes from exact `parentTaskId`/owner/session linkage.

## Delegation and handoff

The work tree only renders delegation when OpenClaw provides a native parent
task, parent/session owner, or equivalent exact child identity. A different
agent name alone is not delegation evidence. Child status and parent status
remain separate.

There is no invented handoff protocol. A future handoff projection must use the
native OpenClaw ownership operation (`sessions.assignOwner`) and retain the
original owner, new owner, and timestamp. AgentOS does not fabricate
cross-session continuity.

## Human Control

The Human Control Inbox normalizes native OpenClaw approvals/questions and
AgentOS runtime blockers into the existing `AttentionItem` contract. Task-linked
items carry the mission id (`dispatchId`, or a scoped `task:<id>` fallback), so
the same queue can be viewed globally or from a mission.

Gateway-wide approval/question inventories are filtered against the visible
snapshot before they can be rendered or mutated; pending status and expiry are
required for an item to remain actionable.

Resolution calls the existing native approval/question mutation and records a
minimal AgentOS audit event with actor, timestamp, operation, target, and
result. The UI clears or refreshes only after the mutation response; it never
optimistically marks a mission resumed. Runtime state must confirm continuation.

## Timeline and result

Timeline entries are derived from dispatch timestamps, OpenClaw task lifecycle,
native child-task evidence, Human Control requests, and bounded user-facing
task-feed events. Internal tool-call noise is excluded. Ordering uses event
timestamps with stable ids as a tie-breaker.

Results come from the saved OpenClaw runtime output or the existing dispatch
result. Artifacts are only files returned by the runtime output/task detail;
plain text does not become an invented artifact record. Absolute artifact paths
are reduced to a safe path relative to the mission output/workspace root, and
paths outside those roots or containing traversal are omitted.

## Reconnect, reload, and actions

The shared Mission Control event stream invalidates/reloads the projection.
Mission pages have no local lifecycle authority and no per-mission polling loop.
Reloading the browser or restarting AgentOS reconstructs the mission from the
dispatch sidecar plus the current OpenClaw snapshot. A temporary Gateway loss
is presented as `reconnecting` when terminal evidence is absent. The exact
disposable OpenClaw 2026.9.2 Workforce harness is
`pnpm openclaw:workforce-e2e` with `OPENCLAW_WORKFORCE_PACKAGE` set; it uses a
loopback Gateway, isolated state, and the deterministic provider fixture.

The v1 action surface exposes only the existing exact task/dispatch abort path.
Generic retry/reassign controls are not shown without a native, idempotent
operation. Resume is exposed only when the runtime task explicitly reports a
continuation capability; the actual continuation mutation remains bounded by
the existing task-control API.

## Security boundary

Mission and Human Control reads are server-authorized with AgentOS product
permissions and visible workspace scope. Dispatch sidecar records are filtered
by that same visible snapshot and a raw mission id fails closed if it is not
present in the scoped projection. Mutations retain OpenClaw preflight, actor
identity, and exact target validation. The OpenClaw 2026.9.2 session
security boundary is unchanged: tree visibility remains in force and
`tools.agentToAgent.enabled=false` with an empty allow-list. The shared Gateway
is a trusted-team boundary, not an invented hostile-tenant isolation layer.

The legacy `/tasks` surface remains available as advanced runtime/task
diagnostics. Workforce/Missions is the canonical human-level operations home;
Dashboard and Agent pages may link into it but do not create parallel mission
queues.
