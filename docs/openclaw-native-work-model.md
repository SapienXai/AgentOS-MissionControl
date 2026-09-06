# AgentOS × OpenClaw Native Work Model

## Phase 1

Phase 1 establishes the operator-facing projection for OpenClaw-managed worktrees, task suggestions, and session ownership. The implementation is intentionally additive: Mission remains AgentOS product intent, while OpenClaw remains authoritative for sessions, task suggestions, worktrees, runtime state, ownership, visibility, and collaboration evidence.

The active recommended contract is OpenClaw `2026.9.2`; existing `2026.9.1` deployments remain the supported minimum when the explicit AgentOS security settings are present. The exact AgentOS package versions are pinned in `package.json`. This phase does not publish packages, deploy, or push a branch.

## Phase 1.1 hardening

The existing Gateway event bridge invalidates the single Mission Control
snapshot cache before the stream's existing 300 ms debounced refresh. Event
delivery remains the trigger and refreshed OpenClaw list responses remain the
source of truth; no second polling loop, reconnect owner, or refresh loop is
introduced.

Root Native Work snapshots now project only the summary fields already carried
by `sessions.list`. Membership and evidence are marked `not-loaded` in the
root projection and are hydrated only for the selected session through the
existing ownership route using one `session.members.list` call and one
`session.members.listEvidence` call. Failures remain `unavailable` and never
become local ownership state.

The AgentOS authorization preflight maps the integrated Native Work methods to
the exact OpenClaw 2026.9.2 descriptor scopes. OpenClaw remains the final
authorization authority for method and target policy.

## Ownership matrix

| Concern | Owner | AgentOS responsibility | Transport |
| --- | --- | --- | --- |
| Mission intent | AgentOS | Validate, route, audit, and select the requested execution mode | AgentOS API → adapter |
| Standard execution | OpenClaw | Project the native session and runtime result | `chat.send` through the existing native path |
| Isolated execution | OpenClaw | Request the mode only after eligibility is proven; never downgrade silently | `worktrees.branches` + `sessions.create` |
| Worktree lifecycle | OpenClaw | Project records and cleanup outcome | `worktrees.list`, `worktrees.branches` |
| Suggested Work | OpenClaw | List, review, and forward accept/dismiss actions | `taskSuggestions.list`, `.accept`, `.dismiss` |
| Session identity | OpenClaw | Normalize exact native session fields for the UI | `sessions.list` |
| Ownership and participants | OpenClaw | Project owner, created actor, participants, visibility, role, and evidence | `session.members.list`, `.listEvidence`, `sessions.assignOwner` |
| UI policy and authorization | AgentOS | Product permission, actor context, audit, capability gating, and recovery text | AgentOS request policy |

AgentOS does not create a parallel worktree registry, task suggestion store, session owner table, or second event socket.

## Managed worktrees

The typed client preserves the 2026.9.2 `WorktreeRecord` contract: `id`, bounded `name`, `repoFingerprint`, `repoRoot`, `path`, `branch`, `baseRef`, `ownerKind`, optional `ownerId`, timestamps, and run-end cleanup outcome. The transport-independent projection is `ManagedWorktreeProjection` and is marked `sourceOfTruth: "openclaw"`.

The mission execution mode `isolated-worktree` first calls `worktrees.branches` with the selected workspace path and `includeRepositoryStatus: true`. It is eligible only when:

1. OpenClaw advertises the managed-worktree operation and native Gateway transport is usable.
2. A workspace repository path exists.
3. OpenClaw reports `repositoryStatus: "git"`.

The subsequent `sessions.create` request carries `worktree: true`, `cwd`, the routed mission as `task`, and the dispatch id as `idempotencyKey`. OpenClaw owns worktree creation, branch naming, session identity, and cleanup. AgentOS does not shell out to Git for lifecycle management.

If any eligibility condition fails, the requested isolated mode fails with an explicit recovery message. It does not fall back to standard execution or the CLI.

## Task Suggestions

Suggested Work is a separate projection from active `TaskRecord` items. The source is the native `TaskSuggestion` shape: `id`, `title`, `prompt`, `tldr`, `cwd`, `sessionKey`, optional `agentId`, and `createdAt`. It is not inserted into AgentOS tasks until OpenClaw accepts it.

Operations exposes a compact review surface on the existing Operations page. Review shows the native prompt and repository context. Accept and Dismiss are real API mutations and invalidate the Mission Control snapshot. Acceptance modes are capability-derived: `worktree` is available for the base contract; `local` and `session` are shown only when OpenClaw advertises `taskSuggestions.acceptModes`. Cloud mode is not shown without a live cloud-profile projection.

The UI is hidden behind the live `taskSuggestions` capability state and shows an honest unavailable/unknown explanation when the Gateway does not advertise the operation.

## Session ownership and collaboration

The normalized execution projection preserves:

- `createdActor` and `owner` actor identity;
- `participants` and `participantCount`;
- `visibility` (`shared`, `read-only`, `suggest`, or `draft`);
- `sharingRole` (`admin`, `owner`, `member`, or `viewer`);
- membership evidence, including `addedByState: "unknown"` when the native evidence intentionally has no principal.

The root snapshot is bounded to the first 32 session rows and uses only the
summary fields in each row. Membership detail is not loaded in that pass;
evidence is never replaced with a guessed principal.

The existing task inspector renders the native execution card. Its handoff control calls `sessions.assignOwner` only when the native method is advertised and an AgentOS agent is a valid target. It does not mutate AgentOS task ownership. Visibility/member writes are not exposed without a meaningful existing operator flow.

## Mission mapping

`standard` keeps the current `chat.send`-backed mission flow. `isolated-worktree` is explicit in the mission request and is authorized against `sessions.create`; it uses the native session creation contract and records the returned session/worktree identity in the dispatch record and response metadata.

The route and workflow both enforce the execution mode. Browser-account missions remain standard-only in this phase because their secure browser binding is tied to the existing session identity flow. The response reports `executionMode` and the native session key where available.

## Events and reconciliation

AgentOS continues to use the existing official Gateway event bridge. `task.suggestion`, `session.sharing`, and `session.sharing.evidence` events trigger the existing debounced snapshot refresh path; no `tasks.subscribe` method or duplicate reconnect owner is introduced. On reconnect or sequence gap, the existing bounded reconciliation coalesces `sessions.list` and `tasks.list` with native suggestion/worktree refreshes when those methods are available.

The live stream remains the trigger, while refreshed native list responses remain the source of truth after an event, reconnect, or ambiguity.

## Request policy and authorization

All native-only methods use `AgentOsGatewayRequestPolicy` with CLI fallback disabled. Read projections are capability-gated. Mutations use `requireAgentOsOpenClawPreflight`, AgentOS product permissions, the server-created native authorization proof, and the native method's OpenClaw scope:

| Method | OpenClaw scope | AgentOS product permission |
| --- | --- | --- |
| `worktrees.list` | `operator.read` | `sessions.use` / runtime projection |
| `worktrees.branches` | `operator.write` | `missions.use` |
| `worktrees.create` | `operator.write` | `missions.use` |
| `worktrees.remove` / `.restore` / `.gc` | `operator.admin` | not exposed in this phase |
| `sessions.create` | native mutation scope | `missions.use` |
| `taskSuggestions.list` | `operator.read` | `tasks.use` |
| `taskSuggestions.create` | `operator.write` | not exposed in this phase |
| `taskSuggestions.accept` | `operator.admin` | `tasks.use` |
| `taskSuggestions.dismiss` | `operator.write` | `tasks.use` |
| `session.members.list` / `.listEvidence` | `operator.read` | `sessions.use` / selected-session detail |
| `session.members.add` / `.remove` | `operator.write` | not exposed in this phase |
| `session.visibility.set` | `operator.write` | not exposed in this phase |
| `sessions.assignOwner` | `operator.write` | `sessions.use` |

Mutation ambiguity is resolved by the existing native request policy and a refreshed snapshot; AgentOS does not blindly retry a sent mutation. Audit entries contain only non-sensitive operation and target metadata.

## Compatibility truth

The compatibility registry now records granular product integration for the supported subset:

- session collaboration: membership/evidence projection and owner handoff;
- task suggestions: list, accept, and dismiss;
- managed worktrees: list, repository inspection, and worktree-backed session creation.

Other OpenClaw methods remain discovery-only or unsupported as defined by the compatibility registry. `tasks.assign` remains fail-closed because the certified Gateway does not expose it.

## Validation and certification record

The contract tests cover the current 2026.9.2-shaped worktree, task suggestion, session ownership, evidence, and isolated eligibility payloads. Runtime certification must use the disposable OpenClaw `2026.9.2` source/runtime and an isolated temporary repository. It must prove native method dispatch, expected scope denial, worktree-backed session creation, suggestion lifecycle, ownership projection, and event refresh behavior without touching the user's Gateway checkout.

The historical Phase 1 evidence remains at
`docs/evidence/openclaw-2026.9.1-native-work-hardening.json`. The 2026.9.2
runtime certification record and contract diff are the current promotion
evidence; the documented event-name typo `session.evidence` remains historical,
and the correct current event is `session.sharing.evidence`.

No production readiness claim is made until that evidence records a clean implementation commit and the required certification gates pass.

## Future phases

Human Inbox, Skills Library UX, richer collaboration discussion/typing surfaces, cloud worker profile selection, and broader worktree lifecycle controls remain out of scope for Phase 1.
