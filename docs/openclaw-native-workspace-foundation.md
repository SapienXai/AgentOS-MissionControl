# OpenClaw-Native Workspace Foundation

Status: Phase 0 complete

This document is the canonical AgentOS workspace-foundation decision record. It
covers only alignment with the OpenClaw workspace contract; website ingestion,
workspace architecture planning, source synchronization, and Context Engine V2
remain outside Phase 0.

## Compatibility provenance

- Recommended and installed OpenClaw: `2026.9.3`.
- AgentOS compatibility audit: `docs/openclaw-2026.9.3-compatibility-audit.md`.
- Local OpenClaw build identity: `2026.9.3-release-1391f7cd2d40-2026-09-08T07-46-00.264Z`.
- Repository package dependencies are pinned to `@openclaw/gateway-client` and
  `@openclaw/gateway-protocol` `2026.9.3`.
- The latest stable release checked for this pass is OpenClaw
  [v2026.9.3](https://github.com/openclaw/openclaw/releases). Upstream `main`
  was inspected for drift, but no unreleased behavior is promoted into the
  AgentOS contract.

Primary upstream references:

- [Agent workspace](https://raw.githubusercontent.com/openclaw/openclaw/v2026.9.3/docs/concepts/agent-workspace.md)
- [Workspace and bootstrap configuration](https://raw.githubusercontent.com/openclaw/openclaw/v2026.9.3/docs/gateway/config-agents/workspace-and-bootstrap.md)
- [Heartbeat](https://raw.githubusercontent.com/openclaw/openclaw/v2026.9.3/docs/gateway/heartbeat.md)
- [Memory](https://raw.githubusercontent.com/openclaw/openclaw/v2026.9.3/docs/concepts/memory.md)
- [Workspace implementation](https://raw.githubusercontent.com/openclaw/openclaw/v2026.9.3/src/agents/workspace.ts)

## Ownership decision

| Concern | Owner | AgentOS responsibility |
| --- | --- | --- |
| Workspace bootstrap loading and lifecycle | OpenClaw | Follow the native file set and expose accurate status |
| Heartbeat cadence, monitor rows, and scratch state | OpenClaw native config/automation | Read and write supported agent heartbeat config; do not invent a Markdown scheduler |
| Agent identity, model, tools, sandbox, memory search, skills | OpenClaw config/runtime | Use Gateway/config boundaries and normalize for the UI |
| Worker role, mission, behavior instructions, labels | AgentOS sidecar | Store in `.openclaw/project.json` and compile behavior into the assigned policy skill |
| Tool command examples | AgentOS workspace guidance | Render under `AGENTS.md` `## Tools`; notes never grant permissions |
| Project brief, architecture, deliverables, and decision notes | AgentOS project documents | Keep them separate from native bootstrap files |
| Runtime token and context reporting | OpenClaw report when available | Preserve exact vs estimated/degraded provenance; sidecar preferences remain projections |

## Native workspace file registry

The single registry is `lib/openclaw/workspace-bootstrap-files.ts`.

Current persistent context is:

- `AGENTS.md`
- `SOUL.md`
- `IDENTITY.md`
- optional `USER.md`
- optional curated `MEMORY.md`

`BOOTSTRAP.md` is a first-run lifecycle artifact owned by OpenClaw. AgentOS
does not generate it, recreate it after removal, or treat it as a permanent
workspace document. `BOOT.md` remains an optional hook surface and is not part
of the generated AgentOS scaffold.

AgentOS-generated project documents remain explicit sidecars:

- `docs/brief.md`
- `docs/architecture.md`
- `deliverables/README.md`
- `memory/blueprint.md`
- `memory/decisions.md`
- template-specific files under `docs/`
- workspace-local `skills/*/SKILL.md`

## Phase 0 implementation

- New workspaces no longer generate `TOOLS.md` or `HEARTBEAT.md`.
- Repository package-manager, script, Makefile, and Python detection is
  preserved; its output is rendered in `AGENTS.md` under `## Tools`.
- New `AGENTS.md` files contain workspace-level rules and a team roster only.
  Agent-specific behavior is represented by the AgentOS worker-profile sidecar
  and the assigned `agent-policy-*` skill.
- The virtual Agent Profile editor now reads and writes the worker-profile
  sidecar instead of mutating shared `AGENTS.md` role sections.
- Heartbeat settings continue through native `agents.entries.<agentId>.heartbeat`
  config. No AgentOS fallback timer or heartbeat Markdown generation was added.
- Context Engine lists legacy root `TOOLS.md` and `HEARTBEAT.md` only when they
  already exist. They are marked as preserved legacy files, excluded from
  default inclusion and budget calculations, and cannot be enabled as current
  context.
- Existing agent-directory Markdown is never removed by create/update flows.
  This is intentionally conservative: AgentOS does not attempt to merge
  user-authored legacy content without reliable provenance. OpenClaw Doctor
  remains the migration authority where its supported migration is available.
- Existing shared `AGENTS.md` role sections are preserved for compatibility and
  are not regenerated or expanded by AgentOS synchronization.

## Memory policy

`MEMORY.md` is optional and curated. It is a compact durable summary, not an
unbounded import target. Focused notes belong in `memory/*.md`, and stable
decisions belong in `memory/decisions.md`. Phase 0 does not ingest websites,
repositories, folders, or external knowledge sources into memory.

## Preserved behavior and migration notes

- Workspace creation remains idempotent for existing files: scaffold writes
  only when a target file is missing, while AgentOS metadata and policy skills
  continue to synchronize through their existing application services.
- Agent creation/update still uses native OpenClaw lifecycle/config surfaces
  first and retains explicit fallback behavior for unsupported Gateways.
- Worker profile behavior continues to affect the normalized AgentOS profile
  and policy skill; it is no longer placed into shared project context.
- The workspace file editor can read and edit an existing legacy file for
  recovery or manual migration, but cannot create a new one.
- `BOOTSTRAP.md` is visible as an OpenClaw lifecycle file but is not createable
  from AgentOS.

## Validation scope

Focused coverage includes fresh scaffold contents, tool guidance placement,
native heartbeat config preservation, legacy-file listing and non-destructive
editing, worker-profile sidecar editing, Context Engine legacy exclusion,
policy/memory context isolation, and idempotent workspace synchronization.

Run the full repository validation before release or deployment:

```bash
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```
