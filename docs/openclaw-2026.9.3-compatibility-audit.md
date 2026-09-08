# AgentOS and OpenClaw 2026.9.3 compatibility audit

This is the promoted 2026.9.3 audit. It is based on the exact official
`v2026.9.3` source/tag and npm artifacts, not on an AgentOS version-string
replacement. Promotion was allowed only after the certification evidence
listed below passed.

## Upstream identity

- OpenClaw tag: `v2026.9.3`
- peeled source commit: `1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`
- signed tag object: `a69d657b4b74556017f2d0ef98b0c64aeabb3643`
- build identity: `2026.9.3-release-1391f7cd2d40-2026-09-08T07-46-00.264Z`
- Gateway protocol: v4
- state schema: 16
- agent schema: 19
- Node requirement: `>=24.16.0 <25 || >=26.1.0`
- package and npm integrity evidence: [`openclaw-2026.9.2-to-2026.9.3-contract-diff.json`](evidence/openclaw-2026.9.2-to-2026.9.3-contract-diff.json)

The exact comparison from the certified 9.2 baseline is recorded in the
[machine-readable contract diff](evidence/openclaw-2026.9.2-to-2026.9.3-contract-diff.json).

## AgentOS decisions

AgentOS remains Gateway-first. Protocol v4 and the typed gateway client are
unchanged; no REST proxy, CLI replacement, duplicate runtime state machine,
or AgentOS update ledger was added. OpenClaw remains authoritative for
configuration, lifecycle, sessions, tasks, agents, models, providers,
channels, skills, plugins, and native updates.

The only compatibility adapter change is bounded propagation of the native
9.3 `config.patch` `changedPaths` result. Paths contain no values or secrets;
an authoritative empty list is treated as a no-op. Older Gateway responses
without the field retain the existing compatibility fallback, base-hash
concurrency protection, conflict handling, schema lookup, and reload logic.

AgentOS-managed Gateways continue to reconcile the security-sensitive policy
explicitly:

```json
{
  "tools": {
    "sessions": { "visibility": "tree" },
    "agentToAgent": { "enabled": false, "allow": [] }
  }
}
```

Explicit operator values remain authoritative. Externally owned Gateways are
not silently mutated. New public/revocable transcript links are not enabled
or exposed as part of this compatibility release.

## Migration gate

The isolated real-package fixture starts OpenClaw 2026.9.2 with agents,
sessions, an assistant transcript, provider/auth-shaped configuration,
channel configuration, a workspace skill, memory, update status, and the
explicit AgentOS security policy. It stops the 9.2 process, runs the official
9.3 Doctor repair preflight and runtime startup path, then reconnects through
the AgentOS Gateway client. The runtime migration reaches state schema 16,
keeps agent schema 19, preserves representative state, verifies the 9.3
build identity and protocol v4, and passes idempotent Doctor recovery.

Evidence: [`openclaw-2026.9.2-to-2026.9.3-migration.json`](evidence/openclaw-2026.9.2-to-2026.9.3-migration.json).

## Native updater and lifecycle

The AgentOS update path remains:

```text
OpenClaw update.status
  -> AgentOS compatibility/security policy
  -> OpenClaw update.run
  -> native updater/supervisor and durable ledger
  -> reconnect
  -> independent AgentOS verification
```

AgentOS presents native phases and terminal statuses without converting
failure, rollback, or skip into success. The disposable certification path
does not run `update.run` against a user Gateway. Where a real service owner is
not available, evidence is recorded as an environmental limitation rather
than fabricated as a successful activation.

## Models, sessions, skills, and plugin

The 9.3 model/session catalog accepts native CLI-agent entries without
pretending they are provider models or claiming unsupported operations.
Provider account ordering, fallback, OAuth recovery, and local-model
discovery remain OpenClaw-owned. Recursive delegation, persistent spawned
sessions, session visibility, and actor ownership remain native semantics.

The AgentOS browser-policy plugin is validated against the exact 9.3 host and
uses the native `openclaw/plugin-sdk/plugin-entry` path. Its build metadata is
9.3; its compatibility range is not narrowed without evidence. Workshop
ownership migration remains Doctor/runtime-owned; AgentOS does not implement a
parallel collection.

## Promotion and baseline

The recommended/native contract target is `2026.9.3`. The supported baseline
remains `2026.9.1` until the final matrix proves otherwise; the upgrade does
not raise the minimum merely because the recommended version advanced.

The final certification evidence records zero unknown outcomes and no required
failures. Historical 9.1 and 9.2 audit documents and evidence are immutable
and are not rewritten by this upgrade.
