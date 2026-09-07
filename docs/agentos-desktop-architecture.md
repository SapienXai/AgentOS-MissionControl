# AgentOS Desktop Architecture

## Decision

AgentOS Desktop is a Tauri 2 application with a React/Vite frontend and a
small Rust native boundary. The existing Next.js application remains the web
product and remains the source of shared product behavior where it already
works well.

Tauri was selected because the desktop product needs native process,
filesystem, secure-storage, notification, tray, and updater boundaries without
embedding a hosted AgentOS URL or shipping a second browser runtime. Electron
is intentionally not part of the architecture.

## Boundaries

```text
AgentOS web (Next.js)       AgentOS desktop (React/Vite)
          │                             │
          └──── shared AgentOS contracts/types ────┘
                        │
                typed native bridge
                        │
                   Tauri / Rust
                        │
             OpenClaw and local machine
```

- `lib/agentos` contains platform-neutral contracts and domain types.
- `lib/openclaw` remains the OpenClaw adapter/application boundary for the web
  product. OpenClaw remains authoritative for Gateway, sessions, tasks,
  agents, and execution state.
- `apps/desktop/src` contains desktop composition and the typed Tauri client;
  it does not call raw `invoke` from product components.
- `apps/desktop/src-tauri` owns process supervision, scoped workspace access,
  native dialogs, secure credential storage, tray behavior, and OS integration.

## Native boundary and security

Native commands are narrow and input-validated. Runtime control accepts only
fixed OpenClaw lifecycle operations and never exposes an arbitrary command
string. Workspace operations are rooted in user-approved directories and
reject traversal outside those roots. Runtime output is bounded and redacted
before it is sent to the frontend. Credentials use the platform keyring and
are never placed in localStorage or workspace JSON.

Tauri capabilities are explicit and limited to the commands and plugins used
by the desktop product. Updater configuration is present only for signed
artifacts; production signing material is supplied by CI secrets.

## Runtime direction

The provider-neutral `AgentRuntime` contract is intentionally derived from
operations AgentOS already exposes: status, lifecycle, doctor, capabilities,
and bounded runtime events. The first implementation is OpenClaw. A future
runtime such as Hermes can register a real adapter when it has a supported
implementation; no placeholder runtime is added just to fill a registry.

## Phase roadmap

1. Establish shared contracts and repository boundaries.
2. Add the standalone Tauri shell and typed bridge.
3. Manage local OpenClaw detection, lifecycle, health, and logs.
4. Add approved local workspaces, Git/Ollama summaries, and the controlled
   terminal boundary.
5. Keep runtime identity and capabilities provider-neutral.
6. Finish tray/background behavior, notifications, deep links, updater,
   packaging, CI, and the desktop threat review.

The web application is not moved into a new workspace as part of this work;
that migration would create risk without improving the native boundary.
