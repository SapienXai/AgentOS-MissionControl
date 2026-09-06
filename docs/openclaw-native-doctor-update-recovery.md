# OpenClaw Native Doctor, Update, and Recovery

AgentOS presents operational OpenClaw state without becoming a second runtime or
repair engine. OpenClaw 2026.9.2 remains authoritative for health, configuration
application, updates, restart coordination, suspension, authorization, and
reconnect behavior. AgentOS normalizes those native facts for the existing
Settings, Diagnostics, Gateway, and Updates surfaces.

## Native contract

The online operational projection uses the official Gateway transport and these
2026.9.2 methods:

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

The exact OpenClaw 2026.9.2 descriptor protects `update.status` with
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
availability, and the AgentOS certification policy separately. The normal
decision is calculated from the exact native target and exact manifest entry;
version ordering is never used as a substitute for certification. A certified
native target exposes one `Update & restart` action. An uncertified target is
shown as available but remains behind advanced compatibility tools. The server
independently repeats this decision before `update.run`, so hiding a button in
the UI is not the security boundary. A successful RPC is not presented as a
completed update until the post-reconnect native verification succeeds;
supervisor handoff, skipped, failed, and unknown results remain distinct.

The normal policy flow is:

```text
update.status
  → exact native available version
  → exact AgentOS compatibility decision
  → server policy gate
  → update.run
```

`update.hold` is the pinned native contract's empty-parameter operation for
deferring an active automatic update campaign. AgentOS exposes `Hold this
update` only when `update.status` reports an automatic campaign in the native
`waiting-for-idle` or `countdown` state and no hold is already active. Native
campaign or rollout hold state is projected as `Update held`; AgentOS does not
create a parallel hold lifecycle or silently clear an OpenClaw hold. No fixed
duration is shown because the 2026.9.2 contract does not define one in the
request; OpenClaw owns the resulting `holdUntilMs`.

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
| AgentOS certified version | AgentOS compatibility manifest | The exact OpenClaw versions verified by this AgentOS build |
| Community release intelligence | Optional `isitstable.iclaw.digital` advisory snapshot | An external confidence signal only |

Community release intelligence is progressively disclosed on the Updates page
and can fail or become stale without blocking native status or native update
execution. It never supplies installed-version truth, channel truth, update
availability, or an update target.

The pinned 2026.9.2 `update.status` response exposes bounded availability,
channel, automatic schedule, and durable `activeRun`/`lastRun` records. AgentOS
projects only the run ID, phase/status, target/before/after versions, bounded
steps, verification facts, and timing. Origin session identifiers, process
metadata, install paths, and raw output are excluded. The Updates page derives
an active progress state from the native record even when React state is idle,
so page reload, navigation, Gateway restart, and an update started elsewhere
remain recoverable. Final success still requires the existing fresh
health/status/update reconciliation; a native last-run success alone is not
proof that AgentOS observed the expected runtime.

Settings → OpenClaw is a runtime/configuration summary with a `Manage updates`
link. Native Doctor and Diagnostics report update health and recovery evidence,
but link to the canonical Updates page instead of exposing a second normal
update action. Rollback remains a recovery operation for advanced operators.

The pinned OpenClaw 2026.9.2 Gateway contract does not expose an
`update.repair` method, so AgentOS does not invent a Repair button or guess CLI
flags. Unknown or failed native outcomes remain recoverable through the
existing supervisor/reconnect evidence, Runtime Inbox guidance, and advanced
Compatibility Lab rollback tools.

The normal Doctor read uses native `health`, `status`, `diagnostics.stability`,
`config.get`, and `update.status` in parallel. A user-requested refresh sends
`health({ probe: true })` and `update.status({ refreshCheckout: true })`; normal
reads do not force either refresh. Runtime health, native status/version, update
availability, and recovery state remain separate projections. Recovery
recommendations are deterministic and evidence-based; AgentOS does not
diagnose independently or run an automatic repair loop.

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

The 2026.9.2 certification is recorded in
[`openclaw-2026.9.2-compatibility-audit.md`](./openclaw-2026.9.2-compatibility-audit.md).
The disposable npm-package update mutation is intentionally recorded as native
`skipped` (`not-git-install`); no destructive mutation was run against a user
Gateway. Contract tests, runtime certification, multi-user security evidence,
and native-only reconciliation tests cover the supported method boundaries.
