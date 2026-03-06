# OpenClaw Mission Control

Production-oriented mission-control UI for live OpenClaw systems, built from an empty folder with:

- Next.js App Router
- TypeScript
- Tailwind CSS
- shadcn/ui-style component primitives
- React Flow
- Motion for React

The UI is not a detached dashboard. It reads and writes through real OpenClaw concepts:

- Workspaces are derived from configured OpenClaw workspace paths
- Agents are read from `openclaw agents list` and `agents.list`
- Models are read from `openclaw models list --json`
- Runtime/task surfaces are derived from real OpenClaw sessions and gateway status
- Mission dispatch writes through `openclaw agent`
- Workspace creation writes through `openclaw agents add`

## What It Does

- Shows OpenClaw gateway health, presence, and diagnostics
- Groups real workspaces/projects on an orchestration canvas
- Renders custom nodes for:
  - Workspace / Project
  - Agent
  - Model
  - Task / Run / Session
- Streams live snapshot updates over SSE
- Provides a mission command bar that sends business goals to real OpenClaw agents
- Supports creating a new OpenClaw workspace + default agent from the UI
- Falls back to a clearly marked simulated snapshot only when OpenClaw is unavailable

## Local OpenClaw Status In This Environment

During implementation, the local machine already had OpenClaw installed at `/opt/homebrew/bin/openclaw` with version `2026.3.2`.

Verified on March 6, 2026:

- CLI present and working
- Gateway service repaired and reinstalled into `launchd`
- Gateway running on `ws://127.0.0.1:18789`
- Dashboard responding on `http://127.0.0.1:18789/`
- Agent turn verified end-to-end via `openclaw agent`

## Run It

1. Install dependencies:

```bash
pnpm install
```

2. Make sure OpenClaw is available locally:

```bash
openclaw --version
openclaw gateway status
```

3. If the gateway is missing or not loaded:

```bash
openclaw gateway install --force --json
openclaw gateway status --json
```

4. Start the frontend:

```bash
pnpm dev
```

5. Open:

```text
http://localhost:3000
```

## Quality Checks

```bash
pnpm typecheck
pnpm lint
pnpm build
```

## Architecture

### App shell

- `app/page.tsx`
  Loads the initial OpenClaw snapshot server-side.
- `components/mission-control/mission-control-shell.tsx`
  Composes sidebar, mission bar, canvas, and inspector.

### OpenClaw adapter

- `lib/openclaw/cli.ts`
  Safe command runner + JSON extraction for noisy CLI output.
- `lib/openclaw/service.ts`
  Normalizes real OpenClaw state into a single frontend domain snapshot.
- `lib/openclaw/types.ts`
  Shared domain model for workspaces, agents, models, runtimes, and relationships.
- `lib/openclaw/fallback.ts`
  Fallback snapshot for temporary no-backend mode.

### Transport layer

- `app/api/snapshot/route.ts`
  Full normalized snapshot
- `app/api/diagnostics/route.ts`
  Gateway + presence diagnostics
- `app/api/mission/route.ts`
  Mission dispatch to `openclaw agent`
- `app/api/workspaces/route.ts`
  Workspace creation through `openclaw agents add`
- `app/api/stream/route.ts`
  SSE stream for live updates

### Presentation layer

- `components/mission-control/canvas.tsx`
  React Flow orchestration graph
- `components/mission-control/nodes/*`
  Custom workspace, agent, runtime, and model nodes
- `components/mission-control/sidebar.tsx`
  Workspace navigation and diagnostics
- `components/mission-control/command-bar.tsx`
  Mission entry and workspace creation
- `components/mission-control/inspector-panel.tsx`
  Entity details and raw payload view

## Real Data Sources

The current snapshot builder reads from these real OpenClaw surfaces:

- `openclaw gateway status --json`
- `openclaw status --json`
- `openclaw agents list --json`
- `openclaw config get agents.list --json`
- `openclaw models list --json`
- `openclaw sessions --all-agents --json`
- `openclaw gateway call system-presence --json`

## Notes

- The mission bar dispatches to a real agent, not a frontend simulation.
- Runtime nodes currently map to real OpenClaw session/task state.
- If future gateway RPCs expose richer orchestration entities, the adapter layer is the place to swap those in without changing the canvas shell.
- ESLint currently runs in legacy config mode because the shipped `eslint-config-next` export in this environment is still legacy-shaped under ESLint 9.
