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

## Still In `service.ts`

`lib/openclaw/service.ts` still owns substantial orchestration that should be moved incrementally:

- Snapshot assembly orchestration and cache invalidation coordination.
- Agent create, update, and delete workflows.
- Workspace create, update, delete, edit seed, and plan application workflows.
- Mission submission, abort, task detail, and runtime output coordination.
- Channel registry mutations, managed surface setup, and routing sync.
- Filesystem writes for workspace manifests, scaffold docs, identities, skills, and channel metadata.
- OpenClaw CLI workflow calls for channel provisioning and setup flows.

These are intentionally left in place because they mix filesystem mutation, OpenClaw config mutation, runtime/session state, progress streaming, and cache invalidation. They should be split only after characterization tests exist for each workflow.

## Next Safe Migrations

Recommended next slices:

1. Move read-only snapshot orchestration into a real `mission-control-service` implementation.
2. Move agent mutation workflows into `agent-service` behind explicit dependencies.
3. Move workspace mutation workflows into `workspace-service` after adding tests for rename, repair, and existing workspace reuse.
4. Move channel provisioning only after preserving current CLI workflow behavior with tests.
