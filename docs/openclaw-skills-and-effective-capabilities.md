# OpenClaw Skills and Effective Capabilities

AgentOS answers “what can this worker do right now?” by projecting native
OpenClaw facts. It does not become a second runtime registry.

## Three different concepts

- **Skill**: a reusable behavior and instruction package. OpenClaw owns its
  identity, content, owner, revision, and activation.
- **Tool**: a runtime instrument that an agent session may invoke. OpenClaw
  owns the catalog and the session-effective tool set.
- **Effective capability**: AgentOS’s human-facing projection of what is usable
  after native effective tools, session context, account facts, policy, skills,
  approval state, and runtime availability are considered.

Configured skills, declared tools, and allowlists remain visible as
configuration evidence. None of them is treated as proof of effective use.

## Ownership boundary

OpenClaw is authoritative for:

- Skills Library entries, native skill IDs, revisions, ownership, and activation
- `tools.catalog`, `tools.effective`, and `tools.invoke`
- provider/account/runtime availability
- approval and authorization primitives
- session skill selections and native runtime behavior

AgentOS owns:

- Worker Profile presentation
- a small human-facing capability taxonomy
- deterministic status, reason, evidence, and remediation projection
- bounded audit metadata and operator UX

The effective capability projection is not persisted as mutable authority.

## Native Skills Library integration

The exact OpenClaw 2026.9.2 library contract includes:

| Method | Scope | Phase 2 use |
| --- | --- | --- |
| `skills.library.list` | `operator.read` | Integrated |
| `skills.library.read` | `operator.read` | Integrated |
| `skills.library.save` | `operator.write` | Native contract audited; not exposed in Phase 2 UX |
| `skills.library.mutate` | `operator.write` | Native contract audited; not exposed in Phase 2 UX |
| `skills.library.activate` | `operator.write` | Integrated for next-turn session activation |
| `skills.library.import` | `operator.write` | Native contract audited; not exposed in Phase 2 UX |
| `skills.library.upload` | `operator.write` | Native contract audited; not exposed in Phase 2 UX |

Library identity is preserved as `skillId`. Revision identity is preserved as
the native 64-character revision ID. Display names are never used to identify
a mutation target.

The native entry exposes `shared`, owner profile identity, enabled/removed
state, latest revision, and editability. AgentOS presents `shared` as
**Shared**, a non-shared owner-bound entry as **Personal**, and otherwise shows
ownership as unavailable. It does not invent team or company ownership labels.

Activation is native-first and applies on the next turn. A timeout or malformed
mutation response is reconciled by reading native library/session state once;
AgentOS does not blindly retry an ambiguous activation.

## Revision and session semantics

The Worker Profile keeps latest library revision and session-selected revision
separate. For example, a session may show `Session rev abc123… · newer revision
available`. AgentOS never rewrites an existing session to the latest revision.

When OpenClaw does not expose an ordinary session-row revision field, AgentOS
uses the exact session selection returned by `skills.library.list` with the
native `sessionKey`. It does not infer a historical session revision from the
current worker configuration.

## Effective Capability Resolver

`getWorkerEffectiveCapabilities(workerId)` is the single application service
for the Worker Profile capability projection. It uses a bounded graph:

1. one native agent list and one bounded native session list (unless the caller
   supplies an exact session key);
2. in parallel, one `tools.catalog`, one session-scoped `tools.effective` when
   a real session key exists, one Skills Library list, and one native channel
   account status read.

The catalog is evidence that a tool exists. The effective tool response is the
authority for session use. A catalog-only tool is never marked available. If a
session context is missing, the resolver reports **Unknown** rather than
promoting configured or catalog state.

### Statuses

- **Available**: the native effective tool is present and no additional native
  dependency or approval is required.
- **Requires approval**: native policy says the worker can request the action,
  but execution requires operator approval.
- **Needs setup**: a known required account, credential, provider, or skill
  activation is missing.
- **Blocked**: native effective policy explicitly denies the capability.
- **Unavailable**: the required native tool/runtime is absent or not effective.
- **Unknown**: current native facts are insufficient to decide reliably.

Explicit policy block takes precedence over setup and approval. Runtime
unavailability takes precedence over downstream requirements. Approval is only
shown when an actual approval fact exists; risk labels alone do not create an
approval state.

Reason codes are stable product values such as `tool_effective`,
`tool_not_effective`, `tool_blocked`, `tool_not_available`,
`account_not_connected`, `approval_required`, `runtime_unavailable`,
`effective_state_unavailable`, `session_context_missing`, `skill_not_active`,
`policy_denied`, and `unknown`. A failed `tools.effective` observation is
`Unknown` with `effective_state_unavailable`; it is not evidence that the
runtime is unavailable. `Unavailable` is reserved for a successful native
absence/denial or an explicit native runtime-unavailable fact.
Every row includes structured evidence for tool, account, policy, approval,
skill, and runtime facts when those facts exist.

Unknown OpenClaw tools are not hidden. They are projected under the bounded
**Other** capability and retain their exact native IDs in advanced evidence.

## Worker Profile UX

The existing Worker Profile dialog now contains a compact “What this worker
can do now” surface and a native Skills Library section. The existing editor
remains the configuration/access surface; its declared-tool controls are not
relabelled as effective capability. Each capability shows name, status, one
line explanation, configured/effective evidence where available, and a
remediation explanation only when the state is known.

The only Phase 2 mutation exposed in this surface is native skill activation
for the next turn. Account connection and policy changes remain in their
existing dedicated surfaces; no dead action button or automatic privilege
escalation is rendered.

## Events, freshness, and security

The existing Gateway event bridge remains the only event socket. Exact native
events relevant to this projection include `skills.changed`,
`sessions.changed`, `session.tool`, `session.approval`, execution approval
events, and plugin approval events. Relevant events invalidate the existing
AgentOS Gateway request-policy read cache before the normal snapshot
invalidation path. No capability polling daemon or reconnect owner was added.

Skill content is data. AgentOS does not execute it or treat it as AgentOS
instructions. Capability evidence contains only state such as connected,
missing, blocked, or approval-required. It never contains tokens, API keys,
passwords, cookies, or provider secrets. Responses use the existing central
redaction helpers.

## Compatibility and degradation

Skills Library methods are native-only. If the exact method is unavailable,
the Worker Profile shows an honest unsupported/degraded state. No CLI fallback
is used for `skills.library.*`, `tools.catalog`, or `tools.effective`.

The product integration registry remains granular: only
`skills.library.list`, `skills.library.read`, and `skills.library.activate`
are marked as consumed for this phase. The remaining library methods remain
discovery-only even though their exact 2026.9.2 contracts are audited.

## Phase 2.1 hardening

Session-scoped Skill Detail uses one native `skills.library.read` and one
parallel `skills.library.list({ sessionKey })` read in the AgentOS application
service. The library entry supplies the latest revision; the session
selection, joined only by native `skillId`, supplies the exact revision active
for that session. A successful list with no selection means known inactive;
an unsuccessful selection read leaves activation unknown. The latest revision
never replaces the session revision.

The runtime certification harness may seed one disposable skill through the
official native `skills.library.save` method in an isolated exact 2026.9.2
Gateway. This is certification-only fixture setup; save, mutate, import, and
upload remain discovery-only product methods. The fixture is removed through
the official native mutation contract, and no OpenClaw internal storage is
written directly.
