<div align="center">
  <img src="public/assets/screenshots/0.jpeg" alt="AgentOS control-plane interface" width="100%" />

# AgentOS | Control Plane

**Human operating layer for coordinating AI agents, projects, and companies from a single workspace.**

Built on top of OpenClaw, the agent orchestration kernel.

<p>
  <a href="https://sapienx.app/agentos"><strong>Website</strong></a>
  ·
  <a href="https://www.youtube.com/watch?v=ujz-4bYDjdY"><strong>Watch Demo</strong></a>
  ·
  <a href="#try-agentos-in-5-minutes"><strong>Try in 5 minutes</strong></a>
  ·
  <a href="#why-agentos"><strong>Why AgentOS</strong></a>
  ·
  <a href="#quick-start"><strong>Quick Start</strong></a>
  ·
  <a href="#architecture"><strong>Architecture</strong></a>
  ·
  <a href="#key-features"><strong>Features</strong></a>
  ·
  <a href="#product-highlights"><strong>Highlights</strong></a>
  ·
  <a href="#setup-and-development"><strong>Setup</strong></a>
  ·
  <a href="#roadmap"><strong>Roadmap</strong></a>
</p>

<p>
  <img src="https://img.shields.io/badge/Next.js-16-0b1220?style=for-the-badge&logo=nextdotjs&logoColor=white" alt="Next.js 16" />
  <img src="https://img.shields.io/badge/React-19-07111d?style=for-the-badge&logo=react&logoColor=61dafb" alt="React 19" />
  <img src="https://img.shields.io/badge/TypeScript-Strict-0f172a?style=for-the-badge&logo=typescript&logoColor=3178c6" alt="TypeScript" />
  <img src="https://img.shields.io/badge/OpenClaw-Kernel-111827?style=for-the-badge" alt="OpenClaw kernel" />
  <img src="https://img.shields.io/badge/Local--First-Control_Plane-101828?style=for-the-badge" alt="Local-first control plane" />
</p>

<p align="center">
  <a href="https://nextjs.org" target="_blank" rel="noreferrer" title="Next.js">
    <img src="https://cdn.simpleicons.org/nextdotjs/000000" alt="Next.js" height="24" />
  </a>
  <a href="https://react.dev" target="_blank" rel="noreferrer" title="React">
    <img src="https://cdn.simpleicons.org/react/61DAFB" alt="React" height="24" />
  </a>
  <a href="https://www.typescriptlang.org" target="_blank" rel="noreferrer" title="TypeScript">
    <img src="https://cdn.simpleicons.org/typescript/3178C6" alt="TypeScript" height="24" />
  </a>
  <a href="https://github.com/openclaw/openclaw" target="_blank" rel="noreferrer" title="OpenClaw">
    <img src="https://raw.githubusercontent.com/openclaw/openclaw/main/docs/assets/openclaw-logo-text-dark.svg" alt="OpenClaw" height="24" />
  </a>
  <a href="https://pnpm.io" target="_blank" rel="noreferrer" title="pnpm">
    <img src="https://cdn.simpleicons.org/pnpm/F69220" alt="pnpm" height="24" />
  </a>
</p>

</div>

## Try AgentOS in 5 minutes

1. Install AgentOS:

```bash
curl -fsSL https://raw.githubusercontent.com/SapienXai/AgentOS/main/install.sh | bash
```

Or install it with your package manager:

```bash
pnpm add -g @sapienx/agentos
```

2. Open the UI:

```bash
agentos start --open
```

3. Verify the runtime:

```bash
agentos doctor
```

First thing to try:

- Open the AgentOS UI.
- Check the OpenClaw onboarding state.
- Create or inspect a workspace.
- Create an agent or use the guided workspace flow.
- Dispatch a mission.
- Inspect the runtime output or transcript.

If OpenClaw is already installed, AgentOS connects to the live control plane and shows the current gateway, models, agents, and runtimes.
If OpenClaw is missing or not ready yet, AgentOS opens in an explicit fallback or onboarding flow instead of showing a fake live state.

## Product Highlights

The screenshots below show the current product flow in the order a new visitor is most likely to explore it.

<table>
  <tr>
    <td valign="top" width="50%">
      <img src="public/assets/screenshots/1.jpeg" alt="AgentOS launchpad onboarding flow" width="100%" />
      <strong>Launchpad</strong><br />
      Guided onboarding for OpenClaw, models, and the first workspace.
    </td>
    <td valign="top" width="50%">
      <img src="public/assets/screenshots/2.jpeg" alt="AgentOS control plane overview" width="100%" />
      <strong>Control Plane</strong><br />
      Live graph, task flow, and inspector visibility in one place.
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <img src="public/assets/screenshots/3.jpeg" alt="AgentOS agent builder flow" width="100%" />
      <strong>Agent Builder</strong><br />
      Create agents from scratch, presets, or imports.
    </td>
    <td valign="top" width="50%">
      <img src="public/assets/screenshots/4_1.jpeg" alt="AgentOS agent chat flow" width="100%" />
      <strong>Agent Chat</strong><br />
      Talk to agents directly and turn intent into action.
    </td>
  </tr>
  <tr>
    <td valign="top" width="50%">
      <img src="public/assets/screenshots/5.jpeg" alt="AgentOS model setup flow" width="100%" />
      <strong>Add Models</strong><br />
      Connect providers and discover models without leaving AgentOS.
    </td>
    <td valign="top" width="50%">
      <img src="public/assets/screenshots/6.jpeg" alt="AgentOS workspace wizard flow" width="100%" />
      <strong>Workspace Wizard</strong><br />
      Shape a workspace from one prompt and a guided flow.
    </td>
  </tr>
  <tr>
    <td colspan="2" valign="top">
      <img src="public/assets/screenshots/7.jpeg" alt="AgentOS workspace surfaces flow" width="100%" />
      <strong>Workspace Surfaces</strong><br />
      Connect Telegram, Discord, Slack, and more to every workspace.
    </td>
  </tr>
</table>

## Why AgentOS

As AI agents become cheaper to run, the bottleneck shifts from raw orchestration to human control.
Someone still has to decide what matters, inspect active work, route missions, review outputs, and keep multiple projects legible.

Most agent systems expose runtimes, sessions, and CLI primitives.
AgentOS adds the missing operating layer above them: a control-plane interface for humans coordinating teams of agents across real workspaces.

This repository contains the current AgentOS control plane: a Next.js application that sits above OpenClaw and turns live agent state into an operator-facing system for planning, execution, inspection, and workspace management.

## The Problem It Solves

Running one agent is not the hard part.
Operating many agents across many projects is.

AgentOS is built for that coordination problem:

- A human operator needs one place to see workspaces, agents, models, runtimes, and health.
- Missions should map to real project folders, not ephemeral chat threads.
- Runtime output should be inspectable after the fact, including created files and transcript history.
- Agent teams need structure: presets, policies, memory, workspace scaffolds, and repeatable operating conventions.
- As the "one-person company" model emerges, the human needs a control layer, not just an orchestration engine.

## Quick Start

Install the packaged launcher:

```bash
pnpm add -g @sapienx/agentos
agentos start --open
agentos doctor
```

Run the app locally from this repository:

```bash
pnpm install
pnpm dev
```

If OpenClaw is not ready yet, AgentOS starts in an explicit onboarding or fallback path instead of pretending a live control plane exists.

## Architecture

```mermaid
flowchart TD
    Human["Human Operator"] --> AgentOS["AgentOS<br/>control layer / operating layer"]
    AgentOS --> OpenClaw["OpenClaw<br/>agent orchestration kernel"]
    OpenClaw --> Runtime["LLMs, tools, channels, automations, agents"]
```

### Layer Responsibilities

| Layer | Responsibility |
| --- | --- |
| Human operator | Sets direction, reviews work, approves risky actions, and steers the system |
| AgentOS | Presents topology, planning, inspection, workspace bootstrap, settings, and mission dispatch |
| OpenClaw | Owns agent orchestration, gateway state, models, sessions, channels, and execution surfaces |
| LLMs and tools | Perform the underlying reasoning and tool-backed work |

### Control Plane Shape

```mermaid
flowchart LR
    UI["AgentOS UI<br/>Sidebar / Canvas / Inspector / Command Bar / Planner"] --> API["Next.js App Router + API routes"]
    API --> SERVICE["OpenClaw service adapter<br/>snapshot normalization + write actions"]
    SERVICE --> CLI["OpenClaw CLI"]
    CLI --> GATEWAY["Gateway status + presence"]
    CLI --> CONFIG["Agent config + workspace bindings"]
    CLI --> SESSIONS["Sessions + transcript files"]
    SERVICE --> FS["Workspace filesystem + .mission-control state"]
    API --> STREAM["SSE snapshot stream"]
    STREAM --> UI
```

## AgentOS and OpenClaw

OpenClaw is the kernel.
It handles the underlying agent runtime, CLI, gateway, models, sessions, automations, and execution primitives.

AgentOS is the operating layer above it.
It does not replace OpenClaw.
Instead, it reads live OpenClaw state, normalizes it into a control-plane snapshot, and gives the human operator a coherent surface for acting on that state.

In practice, that means:

- OpenClaw remains the source of truth for agents, sessions, models, and gateway status.
- AgentOS translates UI actions into real OpenClaw commands and real filesystem changes.
- AgentOS is intentionally not a mock dashboard; it is a control surface over live operational state.

## How The System Works

1. AgentOS reads live OpenClaw surfaces such as gateway status, agent inventory, config, models, sessions, presence, and transcript files.
2. The service layer normalizes that data into a single `MissionControlSnapshot`.
3. The UI renders that snapshot as a control-plane surface with a topology canvas, sidebar, inspector, and command bar.
4. Operator actions such as mission dispatch, workspace creation, agent updates, planner deploys, gateway changes, or file reveal calls are translated into OpenClaw CLI commands and local filesystem operations.
5. Snapshot state is refreshed over Server-Sent Events so the UI can stay close to real runtime activity.

## Key Features

- Live topology canvas for real workspace -> agent -> runtime relationships.
- Mission dispatch that targets real OpenClaw agents and supports thinking levels.
- Transcript-backed runtime inspection, including final output, warnings, token usage, and created files.
- File reveal actions from the inspector for artifacts written to the local filesystem.
- Workspace wizard with basic create flow and advanced planner mode, including source modes (`empty`, `clone`, `existing`), templates, team presets, model profiles, and kickoff missions.
- Structured workspace scaffolding with `AGENTS.md`, `SOUL.md`, `IDENTITY.md`, `TOOLS.md`, `HEARTBEAT.md`, `MEMORY.md`, `docs/`, `memory/`, `deliverables/`, `skills/`, and `.openclaw/project-shell/`.
- Agent creation and editing with policy presets (`worker`, `setup`, `browser`, `monitoring`, `custom`) plus heartbeat, file-access, install-scope, and network controls.
- Guided workspace planner that models company, product, workspace, team, operations, and deploy decisions inside the workspace wizard.
- Planner deploy flows that can turn a plan into a live workspace, agent team, automations, channels, and first missions.
- OpenClaw onboarding, model setup, gateway control, reset, and update flows directly from the UI.
- Configurable gateway endpoint and default workspace root from settings.
- Explicit fallback mode when OpenClaw is unavailable, rather than pretending live control exists.

## What works today / What is coming next

### What works today

- Local AgentOS control plane built with Next.js.
- OpenClaw-aware onboarding and fallback state.
- Workspace overview and live control-plane snapshot.
- Agent creation and editing with presets and policies.
- Workspace creation and guided workspace wizard.
- Mission dispatch to OpenClaw-backed agents.
- Runtime and transcript inspection.
- Gateway diagnostics and control actions.
- Local-first settings for gateway endpoint and workspace root.
- Install paths through the release installer and package manager.

### What is coming next

- Deeper Telegram and Discord operation jobs.
- More complete approval history and audit trails.
- Stronger recurring workflow and job management.
- Richer model and provider setup guidance.
- More workspace and agent preset examples.
- Better remote or multi-host OpenClaw management.
- More durable analytics and historical runtime views.

## UI Surfaces

| Surface | Purpose |
| --- | --- |
| `MissionSidebar` | Gateway diagnostics, workspace navigation, models, agents, and workspace or agent CRUD |
| `MissionCanvas` | Visual topology for workspaces, agents, and runtimes with selection and mission feedback |
| `InspectorPanel` | Detailed inspection of selected entities, transcript output, raw payloads, and created files |
| `CommandBar` | Mission composition, agent targeting, thinking level selection, refresh, and quick suggestions |
| `WorkspaceWizardDialog` | Handle both basic workspace creation and advanced planner-driven workspace design and deploy |
| `OpenClawOnboarding` | Detect, install, start, verify OpenClaw, and guide model readiness when the local machine is not ready |
| `ResetDialog` | Preview AgentOS reset or full uninstall actions and stream execution progress and logs |

## Repository Map (Key Files)

```text
app/
  api/
    agents/
    diagnostics/
    files/reveal/
    gateway/control/
    mission/
    onboarding/
    onboarding/models/
    planner/
    reset/
    runtimes/[runtimeId]/
    settings/
    snapshot/
    stream/
    system/open-terminal/
    update/
    workspaces/
  layout.tsx
  page.tsx

components/mission-control/
  canvas.tsx
  command-bar.tsx
  create-agent-dialog.tsx
  inspector-panel.tsx
  mission-control-shell.tsx
  openclaw-onboarding.tsx
  operation-progress.tsx
  reset-dialog.tsx
  sidebar.tsx
  nodes/
  workspace-wizard/
    workspace-wizard-dialog.tsx
    workspace-wizard-draft-pane.tsx
    workspace-wizard-header.tsx
    wizard-composer.tsx
    wizard-message-list.tsx
    wizard-suggestion-chips.tsx

hooks/
  use-mission-control-data.ts
  use-workspace-wizard-draft.ts

lib/openclaw/
  agent-heartbeat.ts
  cli.ts
  agent-presets.ts
  fallback.ts
  operation-progress.ts
  planner.ts
  planner-core.ts
  planner-presenters.ts
  presenters.ts
  readiness.ts
  reset.ts
  service.ts
  types.ts
  workspace-presets.ts
  workspace-wizard-inference.ts
  workspace-wizard-mappers.ts

packages/agentos/
  bin/
  scripts/
  README.md
  package.json
```

This is a representative map of the current control-plane code, not an exhaustive file listing.
Many internal files still use legacy `mission-control` naming.

## Setup And Development

### Prerequisites

- A recent Node.js runtime
- `pnpm`
- OpenClaw installed locally and reachable on `PATH`

If OpenClaw is installed in a non-standard location:

```bash
export OPENCLAW_BIN=/absolute/path/to/openclaw
```

### Install

GitHub Release installer:

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/SapienXai/AgentOS/main/install.sh | bash
agentos start --open
agentos stop
agentos doctor
```

Windows PowerShell:

```powershell
iwr https://raw.githubusercontent.com/SapienXai/AgentOS/main/install.ps1 | iex
agentos start --open
agentos stop
agentos doctor
```

Install a specific published version:

macOS / Linux:

```bash
curl -fsSL https://raw.githubusercontent.com/SapienXai/AgentOS/main/install.sh | AGENTOS_VERSION=0.4.1 bash
```

Windows PowerShell:

```powershell
$env:AGENTOS_VERSION='0.4.1'; iwr https://raw.githubusercontent.com/SapienXai/AgentOS/main/install.ps1 | iex
```

Package manager install:

```bash
pnpm add -g @sapienx/agentos
# or
npm install -g @sapienx/agentos

agentos start --open
agentos stop
agentos doctor
```

Stop a running server:

```bash
agentos stop
```

Uninstall:

```bash
agentos uninstall
```

If AgentOS was installed with `pnpm` or `npm`, remove it with your package manager instead:

```bash
pnpm remove -g @sapienx/agentos
# or
npm uninstall -g @sapienx/agentos
```

Local development:

```bash
pnpm install
openclaw --version
openclaw gateway status --json
```

If the gateway service is missing or not loaded:

```bash
openclaw gateway install --json
openclaw gateway status --json
```

### Releases

Push a tag in the format below to build platform-specific release assets on GitHub Releases:

```bash
git tag agentos-v0.4.1
git push origin agentos-v0.4.1
```

The release workflow uploads:

- `agentos-darwin-arm64.tgz`
- `agentos-darwin-x64.tgz`
- `agentos-linux-x64.tgz`
- `agentos-win32-x64.tgz`
- matching `.sha256` files

### Run The App

```bash
pnpm dev
```

Open the URL printed by Next.js, typically:

```text
http://localhost:3000
```

If OpenClaw is unavailable when the app starts, AgentOS can fall back to a demo snapshot and exposes an in-app onboarding flow to help bring the local machine online.

### Quality Checks

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## Operational Notes

- AgentOS is currently local-first. Several API routes spawn local processes, inspect transcript files, and mutate workspace directories.
- This makes the current implementation best suited for operator workstations or trusted environments, not serverless-only deployments.
- OpenClaw remains the primary runtime source of truth; AgentOS adds control-plane state rather than a separate database layer.
- The app is configured for standalone Next.js output via `next.config.mjs`.

## Control-Plane APIs

| Route | Method | Purpose |
| --- | --- | --- |
| `/api/snapshot` | `GET` | Return the normalized AgentOS snapshot |
| `/api/stream` | `GET` | Stream snapshot updates over SSE |
| `/api/diagnostics` | `GET` | Return gateway diagnostics and presence |
| `/api/mission` | `POST` | Dispatch a mission to a real OpenClaw agent |
| `/api/agents` | `GET`, `POST`, `PATCH`, `DELETE` | Read and mutate agents |
| `/api/workspaces` | `GET`, `POST`, `PATCH`, `DELETE` | Read and mutate workspace projects |
| `/api/runtimes/:runtimeId` | `GET` | Load transcript-backed runtime output |
| `/api/onboarding` | `POST` | Install or start OpenClaw and verify readiness |
| `/api/onboarding/models` | `POST` | Discover models, refresh readiness, set a default model, or guide provider login |
| `/api/update` | `POST` | Run `openclaw update` and stream output |
| `/api/gateway/control` | `POST` | Start, stop, or restart the OpenClaw gateway |
| `/api/planner` | `POST` | Create a new workspace planning draft |
| `/api/planner/:planId` | `GET`, `PUT` | Load or save a planning draft |
| `/api/planner/:planId/turn` | `POST` | Process a planner conversation turn |
| `/api/planner/:planId/simulate` | `POST` | Simulate the planner team |
| `/api/planner/:planId/deploy` | `POST` | Deploy a planned workspace |
| `/api/reset` | `POST` | Preview or execute an AgentOS reset or full uninstall flow |
| `/api/settings/gateway` | `PATCH` | Update the OpenClaw gateway endpoint |
| `/api/settings/workspace-root` | `PATCH` | Update the default workspace root |
| `/api/system/open-terminal` | `POST` | Open a supported OpenClaw command in Terminal on macOS |
| `/api/files/reveal` | `POST` | Reveal a local file in Finder, Explorer, or the platform file manager |

## Local State And Persistence

AgentOS keeps most durable operational state close to the workspace and to OpenClaw itself.

- OpenClaw-backed runtime state comes from gateway status, agent config, models, sessions, presence, and transcript files.
- AgentOS settings are stored under the legacy `.mission-control/settings.json` path.
- Planner drafts and planner runtime assets are stored under the legacy `.mission-control/planner/` path.
- Planner deploys write workspace-specific planning artifacts under `.openclaw/planner/`, including `blueprint.json` and `deploy-report.json`.
- Browser convenience state such as theme, draft missions, recent prompts, and the last planner id is stored in `localStorage`.
- When OpenClaw is unavailable, AgentOS returns an explicit fallback snapshot with demo workspaces, agents, models, and runtimes.

## Screens And Workflows Worth Exploring

- Create a workspace from scratch and inspect the generated scaffold files.
- Open the workspace wizard in advanced mode and move from company context to deploy.
- Create agents with different presets and heartbeat policies.
- Dispatch a mission, then inspect runtime output and created files from the inspector.
- Change the gateway endpoint or workspace root from settings and watch the live snapshot refresh.

## Roadmap

This repository already shows the shape of a broader operating system for AI work.
Directionally, the next layer looks like this:

- Deeper company-level operations above individual project workspaces.
- Richer provisioning for channels, automations, hooks, and recurring operational loops.
- Stronger governance, permissions, approvals, and audit trails for multi-agent work.
- Better remote and multi-host control over OpenClaw-backed environments.
- More durable historical views for runtime analytics, operational memory, and handoff quality.

## Contributing

Contributions are welcome.
If you want to extend the control plane, the planner, the workspace bootstrap flow, or the OpenClaw integration, open an issue or pull request.

Please keep contributions aligned with the current design principles:

- Keep the project developer-focused and operationally grounded.
- Prefer real OpenClaw-backed behavior over front-end-only mocks.
- Keep user-facing copy and documentation in English.
- Run `pnpm lint`, `pnpm typecheck`, and `pnpm build` before opening a PR.
- Prefer concise English commit messages; Conventional Commits are a good fit here.

## License

MIT
