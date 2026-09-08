# OpenClaw Native Memory Operations

AgentOS presents OpenClaw memory operations in the Worker Profile without
becoming a memory authority. OpenClaw owns memory storage, indexing, embedding
runtime state, dreaming artifacts, and maintenance results. AgentOS owns the
operator-facing projection, redacted explanations, product permissions, and
audit record.

## Native contract

The product uses the pinned OpenClaw 2026.9.3 Gateway methods only:

| Operation | Native method | Scope | Product use |
| --- | --- | --- | --- |
| Search | `memory.search` | `operator.read` | Worker memory search |
| Health | `doctor.memory.status` | `operator.read` | Worker memory status |
| Diary read | `doctor.memory.dreamDiary` | `operator.read` | Bounded diary inspection |
| Backfill | `doctor.memory.backfillDreamDiary` | `operator.write` | Explicit maintenance action |
| Diary reset | `doctor.memory.resetDreamDiary` | `operator.write` | Explicit destructive action |
| Short-term reset | `doctor.memory.resetGroundedShortTerm` | `operator.write` | Explicit destructive action |
| Artifact repair | `doctor.memory.repairDreamingArtifacts` | `operator.write` | Explicit maintenance action |
| Diary dedupe | `doctor.memory.dedupeDreamDiary` | `operator.write` | Explicit maintenance action |

Search accepts a required query, an optional bounded `maxResults` (1–50), an
optional `minScore`, and an optional native `agentId`. The response preserves
native result order, scores, source, line ranges, and provenance when present.
Health preserves native embedding and dreaming facts. Paths, credentials, and
other sensitive runtime details are not promoted to the primary Worker Profile
surface.

The removed `doctor.memory.remHarness` method is not exposed or reintroduced.
Certification-only use of other native memory methods does not make those
methods product-integrated.

## AgentOS projection

The application service maps native health into `healthy`, `needs-attention`,
`degraded`, `unavailable`, or `unknown` without storing a copy as authority.
Transport failure or an unreadable native response is `unknown`; an explicit
native runtime/method absence is `unavailable`. Search and diary reads use the
same distinction. Native warnings and content are redacted before they reach
the API or UI.

The UI separates these native operations from the existing AgentOS Context
Engine memory-file projection. Context Engine files remain workspace-sidecar
configuration and are not treated as OpenClaw memory search results.

## Actions and safety

React calls AgentOS routes, which enforce AgentOS product permissions and exact
OpenClaw scope preflight before calling the typed native adapter. Mutations are
native-first and are followed by a status reread. The server does not blindly
retry ambiguous mutations. Reset, short-term reset, repair, and dedupe require
explicit operator confirmation; action provenance is recorded in the existing
AgentOS audit system.

Search results, diary content, warnings, and action messages are untrusted
data. They are rendered as data and never interpreted as AgentOS instructions.
Central redaction is used for snippets, citations, triggers, diary content,
errors, warnings, and audit-safe responses. Secret values are never returned.

## Caching, compatibility, and runtime certification

Native memory reads use the existing Gateway request policy through the
official transport. There is no local memory registry, vector database,
polling daemon, second event transport, or new reconnect owner. The
compatibility registry reports `memory.search` and the consumed
`doctor.memory.*` methods at method-level granularity; unsupported runtimes
show an honest unavailable state.

The exact 2026.9.3 contract and deterministic adapter/projection tests are the
primary certification proof. Live memory mutation certification is performed
only with an isolated authenticated disposable runtime. If that fixture is
not safely available, live provider-dependent cases remain explicitly skipped;
the user Gateway and real memory state are never used.

## Phase 5.1 hardening

Worker-bound memory reads and searches are fenced by the current worker identity
and a per-operation request generation. Switching workers clears all projected
health, diary, search, action, loading, and error state; stale read responses
are aborted where possible and cannot repopulate the new worker. Native writes
are intentionally not canceled after dispatch, but their late responses are
discarded when the worker or newer logical operation has changed.

Memory mutation outcomes are `succeeded`, `failed`, or `unknown`. A definite
native rejection is reported as failed. A transport failure after dispatch is
not retried: AgentOS performs one bounded, operation-specific reread only when
OpenClaw exposes a reliable postcondition. Reset diary can be confirmed by an
empty native diary, and grounded short-term reset by a native zero count. Other
ambiguous maintenance writes remain unknown when their final state cannot be
proven. The API and existing audit system preserve that uncertainty, and the
UI asks the operator to refresh diagnostics rather than presenting a failed
mutation or an automatic retry path.
