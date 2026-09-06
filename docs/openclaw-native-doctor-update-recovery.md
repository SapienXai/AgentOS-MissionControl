# OpenClaw Native Doctor, Update, and Recovery

AgentOS presents operational OpenClaw state without becoming a second runtime or
repair engine. OpenClaw 2026.9.1 remains authoritative for health, configuration
application, updates, restart coordination, suspension, authorization, and
reconnect behavior. AgentOS normalizes those native facts for the existing
Settings, Diagnostics, Gateway, and Updates surfaces.

## Native contract

The online operational projection uses the official Gateway transport and these
2026.9.1 methods:

| Surface | Native methods | AgentOS use |
| --- | --- | --- |
| Health | `health`, `status` | Runtime reachability and status |
| Diagnostics | `diagnostics.stability` | Bounded stability evidence |
| Configuration | `config.get` | Compare `configRevisionHash` with `appliedConfigHash` |
| Updates | `update.status`, `update.run`, `update.hold` | Native availability and update lifecycle |
| Restart | `gateway.restart.request` | Safe deferred restart request |
| Suspension | `gateway.suspend.prepare`, `gateway.suspend.status`, `gateway.suspend.resume` | Cooperative host-neutral suspension |

The exact native scopes are preserved: health and diagnostics reads use
`operator.read`; `config.get` uses `operator.read`; updates use
`operator.admin`; restart uses `operator.admin`; suspension prepare and resume
use `operator.admin`, while suspension status uses `operator.read`. Gateway
authorization remains final.

### Phase 6.1 — Truthfulness and recovery reconciliation

The exact OpenClaw 2026.9.1 descriptor protects `update.status` with
`operator.admin`, even though the method is read-shaped. AgentOS therefore
keeps the health, status, diagnostics, and config portions of Doctor usable for
read-capable operators while projecting update status as forbidden/unavailable
when the native admin scope is not present. A failed observation is never
treated as proof that the runtime or update is unavailable.

Native `update.run` payload status is authoritative over the outer RPC
transport result: `ok`, `error`, and `skipped` remain distinct, and managed or
external supervisor handoffs remain non-terminal. Restart/update acceptance is
not verification. For disruptive operations AgentOS records the pre-operation
native generation and identity, waits once on the existing official reconnect
owner, then performs bounded fresh native health/status/config/update reads.
Missing reconnect or identity/config evidence remains unknown; AgentOS does not
retry the operation or start another reconnect loop.

The certification harness compares AgentOS expectations with the pinned
OpenClaw source descriptor itself, not only with an AgentOS mirror. The online
Doctor path remains native-only and uses the existing product permission,
native scope preflight, request policy, and Gateway authorization layers.

## Truthful projection

Reachability is not the same as health. A successful health response with
`ok: false` is degraded; a failed read is unknown; an explicitly unsupported
native method is unavailable. A config revision is `applied` only when the two
native revision hashes match. A known mismatch is `restart-required`; missing
hash evidence is unknown. AgentOS never uses the raw `config.get.hash` as the
runtime revision hash.

`update.status` is authoritative for update availability. AgentOS does not query
npm, GitHub, package metadata, or a local installer to fill an online native
status response. Native `update.run` remains OpenClaw's installer, supervisor
handoff, restart, and sentinel workflow. AgentOS sends only bounded, explicitly
confirmed requests and never retries an ambiguous mutation blindly.

## Normal update path

Operations → Updates is the single normal OpenClaw update surface. Its flow is:

```text
Updates page
  → AgentOS native Doctor application service
  → OpenClaw adapter and official Gateway transport
  → update.status / update.run
  → OpenClaw updater or external supervisor
  → existing reconnect owner
  → fresh native health, status, config, and update verification
```

The page displays the installed version, the effective native channel, native
availability, and the AgentOS certification policy separately. A certified
native target exposes one `Update & restart` action. An uncertified target is
shown as available but remains behind advanced compatibility tools. A successful
RPC is not presented as a completed update until the post-reconnect native
verification succeeds; supervisor handoff, skipped, failed, and unknown results
remain distinct.

`update.hold` remains part of the native Doctor contract. Native campaign or
rollout hold state is projected as `Update held` on the Updates page; AgentOS
does not create a parallel hold lifecycle or silently clear an OpenClaw hold.

## Advanced compatibility path

Settings → Advanced → Compatibility Lab retains the existing AgentOS-owned
exact-version and certification capabilities. That surface may use the legacy
`/api/update` orchestration for preflight, shadow probes, exact target
installation, rollback snapshots, smoke tests, scorecards, certification
promotion, and streamed diagnostics. It is an internal/advanced compatibility
path, not the normal consumer updater. Its bounded operation timeout and manual
rollback policy therefore do not govern native `update.run`.

## Update authorities

These version concepts are intentionally separate:

| Concept | Authority | Meaning |
| --- | --- | --- |
| OpenClaw available update and effective channel | Native `update.status` | What the installed OpenClaw channel reports as available |
| AgentOS certified version | AgentOS compatibility manifest | The highest OpenClaw version verified by this AgentOS build |
| Community release intelligence | Optional `isitstable.iclaw.digital` advisory snapshot | An external confidence signal only |

Community release intelligence is progressively disclosed on the Updates page
and can fail or become stale without blocking native status or native update
execution. It never supplies installed-version truth, channel truth, update
availability, or an update target.

Settings → OpenClaw is a runtime/configuration summary with a `Manage updates`
link. Native Doctor and Diagnostics report update health and recovery evidence,
but link to the canonical Updates page instead of exposing a second normal
update action. Rollback remains a recovery operation for advanced operators.

The pinned OpenClaw 2026.9.1 Gateway contract does not expose an
`update.repair` method, so AgentOS does not invent a Repair button or guess CLI
flags. Unknown or failed native outcomes remain recoverable through the
existing supervisor/reconnect evidence, Runtime Inbox guidance, and advanced
Compatibility Lab rollback tools.

The normal Doctor read uses native `health`, `status`, `diagnostics.stability`,
`config.get`, and `update.status` in parallel. A user-requested refresh sends
`health({ probe: true })`; normal reads do not force a probe. Runtime health,
native status/version, update availability, and recovery state remain separate
projections. Recovery recommendations are deterministic and evidence-based;
AgentOS does not diagnose independently or run an automatic repair loop.

## Recovery actions

The existing Gateway controls remain in Settings. The online diagnostic action
now reads native evidence; it does not silently run `openclaw doctor --fix`.
Native restart requests preserve OpenClaw's safe deferral default. Suspension
uses the native prepare/status/resume handshake and preserves the native
`requestId`, `terminalPolicy`, `drain`, blockers, retry, and expiry semantics.

The existing lifecycle/supervisor boundary remains responsible for explicit
offline process control where a native Gateway is not serving. That compatibility
path is not an online fallback for native operational reads or mutations.

## Security and freshness

The projection returns only bounded status, revision, channel, timing, and
recovery fields. It omits config contents, commands, install roots, tokens,
credentials, and private paths. Existing AgentOS product permissions,
`AgentOsGatewayRequestPolicy`, centralized redaction, event invalidation, and
the official transport/reconnect owner remain in force.

Doctor/update/recovery reads are lazy operational-detail work. The root
Dashboard gains no new fan-out. Native events invalidate existing caches, and
the next detail read obtains current authoritative state. A rejected or
ambiguous mutation is reported honestly; AgentOS does not synthesize progress or
claim verification that the reconnecting Gateway has not provided.

## Phase 6 certification note

Phase 6 was certified against the exact OpenClaw 2026.9.1 source contract pinned
by AgentOS. Disposable live mutation proof remains explicitly marked skipped or
expected-denial when an isolated authenticated Gateway cannot safely provide the
required fixture. Contract tests and native-only transport tests cover the same
method boundaries without touching user Gateway state.
