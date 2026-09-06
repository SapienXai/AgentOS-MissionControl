# AgentOS and OpenClaw 2026.9.2 compatibility and security audit

This document records the 2026.9.2 certification decision for AgentOS. The
audit uses the exact npm artifacts and Gateway runtime listed below; it does not
promote a version by string replacement or by community release metadata.

## Provenance

- OpenClaw package: `openclaw@2026.9.2`
- OpenClaw source commit: `3928bad9badfcb6c7d140530435e806fb8092190`
- OpenClaw build: `2026.9.2-release-3928bad9badf-2026-09-05T15-22-41.651Z`
- Gateway protocol/client: `@openclaw/gateway-protocol@2026.9.2`,
  `@openclaw/gateway-client@2026.9.2`
- Gateway protocol: v4, unchanged from the 2026.9.1 AgentOS contract
- Machine-readable diff: [`docs/evidence/openclaw-2026.9.1-to-2026.9.2-contract-diff.json`](evidence/openclaw-2026.9.1-to-2026.9.2-contract-diff.json)
- Runtime evidence: [`docs/evidence/openclaw-2026.9.2-runtime-certification.json`](evidence/openclaw-2026.9.2-runtime-certification.json)
- Multi-user evidence: [`docs/evidence/openclaw-2026.9.2-multi-user.json`](evidence/openclaw-2026.9.2-multi-user.json)

The package and protocol integrity values are recorded in the machine-readable
diff. The runtime evidence was generated against an isolated loopback Gateway;
no user Gateway, production volume, or production credentials were used.

## Contract changes relevant to AgentOS

The 2026.9.2 descriptor keeps the existing update scopes and adds two native
operator-admin methods:

- `update.runs.get`
- `update.runs.list`

`update.status` now reports the durable native update ledger when present:
`activeRun` and `lastRun`. The exact `UpdateRunRecord` includes a UUID-like
`runId`, timestamps, trigger, phase, status, reason, target, before/after
identity, bounded steps, verification, repair attempts, and completion timing.
The native phases are `requested`, `staging`, `validating`, `repairing`,
`activating`, `restarting`, `verifying`, and `finished`; statuses are `running`,
`succeeded`, `failed`, `rolled-back`, and `skipped`.

AgentOS accepts only a bounded projection. It deliberately excludes origin
session identifiers, requester/delivery context, process IDs, ports, raw
stdout/stderr, install paths, and secrets. The normal Updates page therefore
gets durable state from OpenClaw without creating an AgentOS update-job store.

`update.hold` remains an empty-parameter native operation. The 9.2 source shows
that it holds the current native automatic campaign and can refuse when there
is no campaign, the campaign is already applying, or it is already held.
AgentOS exposes it only for an automatic `waiting-for-idle` or `countdown`
campaign that has not already been held. It does not invent a duration or a
permanent pause setting.

The source descriptor also uses the shared `CONTROL_PLANE_WRITE` policy
constant. The AgentOS contract-diff parser now understands that exact upstream
shape rather than treating it as an invalid descriptor.

## Security boundary change

OpenClaw 2026.9.2 changes omitted configuration semantics:

- omitted `tools.sessions.visibility` is effectively `all`;
- omitted `tools.agentToAgent.enabled` is effectively enabled;
- an omitted or empty `tools.agentToAgent.allow` is broad when agent-to-agent
  access is enabled;
- incognito sessions remain hidden from session tools.

AgentOS-managed Gateways now make the security-sensitive values explicit:

```json
{
  "tools": {
    "sessions": { "visibility": "tree" },
    "agentToAgent": { "enabled": false, "allow": [] }
  }
}
```

`tree` preserves requester-owned subagent/task-tree functionality. It is not a
human-tenant boundary. The 9.2 security guidance explicitly treats one shared
Gateway as a trusted operator/team boundary, not hostile multi-tenant
isolation. If mutually untrusted human users must not see each other's
conversations, AgentOS requires separate Gateway cells (or an equivalent
upstream identity/policy boundary); the UI does not claim that a shared token
provides per-human identity.

Cross-agent access is denied by default. The existing AgentOS collaboration
flow writes an explicit target allowlist and never creates a wildcard through
the normal UI. An explicit operator wildcard is preserved and classified as a
trusted-team policy. Empty, omitted, stale, deleted, and recreated members do
not widen an AgentOS-generated list.

`memory_search` remains agent-scoped, while `sessions_search` follows the
native permitted session scope. AgentOS does not merge those authorities.

## Existing-installation migration

Before the normal native `update.run` route can execute, AgentOS reads a fresh
native config snapshot and reconciles omitted security fields. Explicit
operator values are preserved. On an AgentOS-managed Gateway, only missing
fields are written, followed by a fresh read. A configuration that explicitly
enables cross-agent access while omitting its allowlist is blocked rather than
interpreted as allow-all.

If the Gateway is externally supervised or otherwise not owned by AgentOS,
AgentOS does not silently modify configuration. Normal update is blocked with
an actionable security-policy response until the deployment operator makes the
policy explicit. A failed reconciliation also blocks the mutation. Config
revision, native authorization, restart/hot-reload, redaction, and audit
boundaries remain owned by the existing adapter/application services.

## Normal update architecture

```text
OpenClaw update.status
  -> exact native available version and effective channel
  -> exact AgentOS manifest decision
  -> server-side permission, security, identity/channel/target confirmation
  -> OpenClaw update.run
  -> OpenClaw updater/supervisor and durable ledger
  -> existing reconnect owner
  -> fresh AgentOS health/status/config/update verification
```

The client is not the security boundary. A direct POST to
`/api/openclaw/native-doctor` with `action: "update.run"` independently reads
native status, applies exact compatibility policy, checks explicit security
posture, and rejects unknown/candidate/blocked targets. Community stability
data cannot affect this decision. `/api/update` remains the advanced
Compatibility Lab exact-version/recovery path.

When `activeRun.status` is `running`, AgentOS presents the update as running
even if the availability probe is temporarily empty during Gateway restart.
The state is therefore recoverable after page reload, navigation, reconnect,
or an update started outside AgentOS. Native `lastRun` is shown as a compact,
non-dominant report. Native success is still not enough for AgentOS to claim
full success: independent reconnect, identity, health, and expected-version
verification remain required.

## Certification evidence and decision

The exact 9.2 runtime certification passed **60 checks**, with **0 failures**,
12 environmental skips, 13 expected authorization denials, and 0 unknown
results. The disposable AgentOS multi-user gate passed and verified the
explicit session-security defaults plus product actor/permission boundaries.
The native ledger smoke test verified:

- `update.status` returns effective channel and schedule;
- `update.runs.list` and `update.runs.get` are available under
  `operator.admin`;
- a disposable package-install `update.run` records a durable `skipped`
  `lastRun` with reason `not-git-install`, rather than falsely claiming a
  successful upgrade.

The last point is an intentional environment limitation: the disposable npm
package is not a git installation, so the official updater correctly refused
to perform a real 2026.9.1-to-2026.9.2 replacement. No destructive update was
run against a user or production Gateway. The native update contract, no-op
outcome, reconnect/lifecycle checks, bounded reconciliation tests, and runtime
certification provide the safe evidence available in this environment; an
authenticated disposable git-install upgrade remains the final optional live
proof when such a fixture is provisioned.

The compatibility manifest now contains an exact `2026.9.2` certified entry
and AgentOS recommends 2026.9.2 after the repository validation and
certification evidence completed. AgentOS retains 2026.9.1 as the supported
minimum for existing installations whose security policy is explicit. The
native update mutation proof was intentionally limited to a disposable npm
package, where OpenClaw recorded the official `not-git-install` skipped
outcome; no destructive upgrade was attempted without a disposable git
installation.

## Remaining upstream limitation

OpenClaw 2026.9.2 does not provide mutually untrusted human-user transcript
isolation inside one shared Gateway merely through `tools.sessions.visibility`.
AgentOS therefore classifies a shared Gateway as a trusted-team deployment and
requires Gateway separation for stronger tenant isolation. AgentOS cannot
repair that upstream trust model with a frontend filter.
