# OpenClaw Human Control Inbox

Human Control is AgentOS's operator-facing projection of work that currently needs a human. It is not a second approval, question, task-suggestion, or runtime lifecycle. OpenClaw remains authoritative for each native lifecycle; AgentOS reads, normalizes, orders, explains, and routes safe actions back to the native method.

## Attention projection

The canonical `AttentionItem` projection has one stable identity per current source item:

- `approval:<exec|plugin>:<nativeId>` for native approvals
- `question:<nativeId>` for native questions
- `suggestion:<nativeId>` for OpenClaw task suggestions
- deterministic AgentOS identities for relevant setup, blocked-capability, and runtime projections

The default queue contains pending/current items only. Resolved native items disappear after authoritative reconciliation. AgentOS does not persist native pending, approved, rejected, answered, or dismissed state as a competing source of truth.

## Native sources and actions

Human Control consumes bounded native reads for `exec.approval.list`, `plugin.approval.list`, and `question.list`, and routes approval/question actions through `exec.approval.resolve`, `plugin.approval.resolve`, and `question.resolve`. Existing `taskSuggestions.list`, `taskSuggestions.accept`, and `taskSuggestions.dismiss` services are reused. Native approval/question reads and mutations are Gateway-only; they do not use CLI fallback.

Action requests are product-permission checked, preflighted against the exact OpenClaw method scope, sent once, and reconciled. If a mutation times out after it may have been sent, AgentOS re-reads the native item and returns a reconciled success only when the item is gone. It never blindly retries an ambiguous native mutation.

The source-of-truth split is explicit: approval status, question status, and suggestion status come from OpenClaw; capability status is the OpenClaw fact set projected by AgentOS; runtime status comes from the existing OpenClaw-backed runtime model; queue category, severity, ordering, grouping, and human explanation belong to AgentOS; operator actor/action audit belongs to AgentOS.

## Categories, relevance, and deduplication

The projection categories are approval, question, suggested work, needs setup, blocked, and runtime issue. Severity and ordering are deterministic: critical, high, normal, then low; within a severity, older actionable items come first and stable IDs break ties. No LLM priority scoring is used.

Effective-capability setup/blocker items are only admitted when a bounded caller supplies an operationally relevant worker/session context. Hypothetical organization-wide capability gaps are not dumped into the queue. A matching native approval or question takes precedence over a derived blocked/runtime representation so one underlying intervention does not become duplicate noise.

## Runtime and dashboard behavior

Runtime issues use the existing actionable runtime issue projection and existing task/snapshot data. Human Control is lazy on the Dashboard: the compact launcher does not load the full queue while the root snapshot is rendered. The full inbox performs parallel bulk reads and never performs one RPC per worker, capability, approval, or revision.

## Phase 3.1 hardening

The production Inbox resolves capability attention only for a bounded set of workers and sessions from current running, queued, or stalled work and already surfaced native attention context. It does not scan idle workers. Candidate identities are deduplicated by worker plus session (or task when no session key is known), capped at 16, and resolved with concurrency four. A candidate resolution failure leaves native attention items visible and marks capability evidence unavailable instead of treating the failure as no blocker.

The open Inbox reuses the existing Dashboard stream's attention-only revision signal. It schedules one short, coalesced refresh only while the dialog is open; closed dialogs do not refetch on native events. In-progress actions defer event refreshes until the mutation's explicit native re-read completes. Question drafts remain keyed to their native question IDs and are removed only when the refreshed native list no longer contains them.

Runtime attention carries the exact task session key when the existing task metadata or canonical task key provides it, while retaining the task ID. Deduplication uses stable native source identity, then session or task identity; blocked capability items additionally require the same tool identity. Approval and question items therefore suppress only the matching runtime/blocker representation, while unrelated work for the same worker remains visible. Source completeness distinguishes unavailable capability reads from verified empty results.

The existing Gateway event bridge remains the only subscription/reconnect owner. Approval, question, suggestion, session, tool, and runtime events invalidate the relevant AgentOS read/snapshot caches. Reconnect or sequence-gap reconciliation re-reads the current native inventories rather than resurrecting local items.

## Phase 3.2 hardening

Human Control is narrower than Worker Profile. Active-worker status alone does not promote every setup or policy gap: a capability blocker must have exact current-work tool evidence, such as a native approval, runtime `toolNames`, or another normalized attention record. Contexts without that evidence are left to Worker Profile and do not trigger a capability resolver call. Relevant contexts remain bounded at 16 with resolver concurrency four, and candidate identity is deduplicated by worker plus session (or task fallback).

Derived capability attention IDs include the strongest deterministic work context: `session:<encodedSessionKey>`, then `task:<encodedTaskId>`, then `worker`. This keeps identical blockers in concurrent sessions distinct while preserving stable refresh identity. Semantic approval/question precedence remains separate from identity deduplication.

The open Inbox listens to an attention-only revision event projected by the existing `/api/stream` connection. Generic snapshot changes such as health, heartbeat, usage, or telemetry do not advance that revision, while approval, question, suggestion, task/session, tool, skill, and other actionable attention changes do. Closed dialogs remain lazy; open dialogs perform one short coalesced reload and continue to defer refresh during mutations while preserving pending question drafts.

## Security and trust

Approval details, question content, suggestion text, runtime messages, and skill content are untrusted data. They are never interpreted as AgentOS instructions. Central redaction is applied at API boundaries and sensitive command/detail text is truncated for the primary queue. Credentials, tokens, cookies, and provider secrets are not part of the projection or audit payload. AgentOS records human action provenance in its existing audit system; OpenClaw remains authoritative for native resolution.

## Certification boundary

Exact OpenClaw `2026.9.3` certification uses an isolated disposable runtime and official Gateway methods only. A fixture may seed disposable native state through an official contract for certification, but fixture-only methods are not marked product-integrated. If identity, profile ownership, or runtime prerequisites prevent safe creation of an approval/question fixture, the evidence records `SKIPPED` or `EXPECTED-DENIAL` with the exact reason instead of fabricating a successful proof.
