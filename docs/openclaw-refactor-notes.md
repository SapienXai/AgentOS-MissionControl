# OpenClaw Refactor Notes

AgentOS now has an explicit OpenClaw boundary for the first safe vertical slice:

- `OpenClawGatewayClient` remains the transport-facing interface.
- `CliOpenClawGatewayClient` remains the default implementation and CLI fallback.
- `OpenClawAdapter` is the AgentOS-facing interface for gateway/status behavior.
- Application code should call the adapter layer instead of importing the gateway client directly.

## Migrated Slice

The adapter currently owns:

- OpenClaw status loading.
- Gateway status loading.
- Model status loading.
- Gateway lifecycle control for `start`, `stop`, and `restart`.

These calls still execute through the CLI-backed gateway client by default. No native WebSocket gateway client has been introduced.

`lib/openclaw/application/mission-control-service.ts` now owns the read-only mission control snapshot orchestration:

- Snapshot cache lifecycle and payload cache coordination.
- OpenClaw/gateway/model status settlement through the adapter-backed payload helpers.
- Runtime diagnostics state reads.
- Agent, workspace, task, runtime, channel account, and diagnostics assembly for the snapshot response.
- Visible/full snapshot selection.

`lib/openclaw/service.ts` keeps compatibility exports for `getMissionControlSnapshot` and `clearMissionControlCaches`, but delegates those calls to the application service.

`lib/openclaw/application/agent-service.ts` now owns the first mutation slice:

- Agent create, update, and delete workflows.
- Agent policy skill synchronization for those workflows.
- Agent config updates.
- Agent identity/bootstrap file writes.
- Workspace project agent metadata updates.

`lib/openclaw/service.ts` keeps compatibility exports for `createAgent`, `updateAgent`, and `deleteAgent`, but delegates those calls to the application service.

`lib/openclaw/application/workspace-service.ts` now owns the first workspace read slice:

- Workspace edit seed assembly.
- Workspace manifest reads for edit defaults.
- Editable document override discovery.
- Existing workspace agent draft reconstruction.

`lib/openclaw/service.ts` keeps the compatibility export for `readWorkspaceEditSeed`, but delegates that call to the application service. Workspace create, update, and delete workflows are still delegated back to the compatibility service until their mutation behavior is covered with stronger characterization tests.

Workspace mutation characterization has started:

- Workspace create validation shape.
- Workspace update validation shape.
- Workspace delete validation shape.
- Missing workspace edit seed shape.

These tests intentionally cover low-risk contracts before moving filesystem and provisioning behavior.

## Still In `service.ts`

`lib/openclaw/service.ts` still owns substantial mutation and workflow orchestration that should be moved incrementally:

- Workspace create, update, delete, and plan application workflows.
- Mission submission, abort, task detail, and runtime output coordination.
- Channel registry mutations, managed surface setup, and routing sync.
- Filesystem writes for workspace manifests, scaffold docs, identities, skills, and channel metadata.
- OpenClaw CLI workflow calls for channel provisioning and setup flows.
- Compatibility delegation for snapshot reads, agent mutations, and cache invalidation used by the existing mutation workflows.

These are intentionally left in place because they mix filesystem mutation, OpenClaw config mutation, runtime/session state, progress streaming, and cache invalidation. They should be split only after characterization tests exist for each workflow.

## Next Safe Migrations

Recommended next slices:

1. Expand workspace mutation tests for rename, repair, existing workspace reuse, and delete cleanup, then move those workflows into `workspace-service`.
2. Move runtime/task read helpers after preserving mission dispatch and transcript output behavior.
3. Move mission submit/abort workflows after preserving dispatch lifecycle behavior.
4. Move channel provisioning only after preserving current CLI workflow behavior with tests.
