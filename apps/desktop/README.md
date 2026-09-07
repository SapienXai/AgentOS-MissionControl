# AgentOS Desktop

AgentOS Desktop is a thin Tauri host around the existing AgentOS Next.js application. It does not contain a second React product, Mission Control, agent model, or OpenClaw transport.

## Development

```bash
pnpm desktop:dev
```

Tauri starts the existing Next.js development server on loopback and loads that server in the native WebView.

## Production payload

```bash
pnpm desktop:prepare
pnpm desktop:check
pnpm desktop:smoke
pnpm desktop:build
```

`desktop:prepare` builds the existing Next.js app in standalone mode, copies the traced server plus `.next/static` and `public` into an ignored desktop runtime directory, and places a self-contained Node 24 runtime beside it. The default path downloads the official Node distribution for the target platform and architecture. Copying the host runtime is an explicit local escape hatch via `AGENTOS_DESKTOP_USE_HOST_NODE=1`.

The native host chooses an available `127.0.0.1` port, starts only the packaged AgentOS server, waits for `/api/auth/status`, and then navigates the WebView to that same AgentOS origin. The server is stopped on explicit application quit. OpenClaw is a separate process and is never terminated by the desktop host.

The bootstrap page is intentionally static and only communicates startup or failure. It is not an AgentOS product surface.

## Security boundary

- The packaged server receives `HOSTNAME=127.0.0.1` and an ephemeral local port.
- Tauri exposes no application-defined IPC commands to the WebView.
- Only loopback AgentOS URLs and the bundled bootstrap origin remain in the WebView.
- HTTP(S) navigation outside the embedded origin is handed to the system browser.
- Tauri owns the embedded Node/AgentOS child process only; OpenClaw remains owned by the existing AgentOS/OpenClaw integration.
