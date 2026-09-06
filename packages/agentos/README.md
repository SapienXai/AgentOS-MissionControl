# @sapienx/agentos

License: MIT

Install:

```bash
pnpm add -g @sapienx/agentos
```

Run:

```bash
agentos
```

The `agentos` command starts the local AgentOS server and prints the local URL.

If you pass `--open` and AgentOS is already listening on the selected port, the CLI opens the existing instance instead of failing.

Press `Ctrl+C` to stop a foreground AgentOS process. If shutdown hangs, press `Ctrl+C` again to force quit.

Optional flags:

```bash
agentos start --port 3000 --host 127.0.0.1
agentos start --port 3000 --host 127.0.0.1 --open
agentos update
agentos update --check
agentos stop
agentos stop --port 3000 --force
agentos status
agentos auth reset
agentos doctor
agentos uninstall
```

Optional environment variables:

```bash
AGENTOS_HOST=127.0.0.1
AGENTOS_PORT=3000
AGENTOS_OPEN=1
AGENTOS_TRUSTED_OPERATOR_ORIGINS=https://agentos.example.com
```

`agentos status` prints a concise local dashboard for Gateway, runtime, model, channel, and server readiness.

`agentos auth reset` removes only the local Instance Protection credential and invalidates protected browser sessions. It does not change workspaces, agents, tasks, accounts, integrations, or OpenClaw data.

`agentos doctor` prints deeper install diagnostics: effective URL, bundle status, Node.js compatibility, OpenClaw detection, Gateway reachability, and browser auto-open support.

`agentos doctor --deep` adds read-only OpenClaw compatibility probes for Gateway protocol, native auth, scopes, required methods, config access, config schema/patch support, channel status, model readiness, fallback count, and the last native failure when AgentOS is running.

`agentos stop` sends `SIGTERM` to the AgentOS server listening on the selected port. If the runtime state is stale and no process is listening there, the CLI clears that stale state automatically.

`agentos update` refreshes a release installation in place. `agentos update --check` only checks whether a newer version exists.

If AgentOS was installed with `pnpm` or `npm`, update commands only print the matching package manager command instead of changing files in place.

`agentos uninstall` removes a release-installer copy. If the package was installed with `pnpm` or `npm`, remove it with your package manager instead.

AgentOS is designed to work with a local OpenClaw installation. If OpenClaw is missing, AgentOS still starts and guides onboarding in the UI.

For a hosted installation, use the repository's documented Railway deployment instead of exposing the local package launcher. It runs the pinned OpenClaw Gateway on container loopback, requires Instance Protection, and persists runtime state on a Railway volume. See `docs/deploy-on-railway.md` in the AgentOS repository.

Security:

- AgentOS is intended to bind locally by default; avoid exposing it publicly without your own network controls.
- Packaged AgentOS uses API token authentication and opens an authenticated local URL from the launcher.
- Remote mutations are disabled by default. `AGENTOS_TRUSTED_OPERATOR_ORIGINS` can opt in exact, comma-separated HTTPS origins; wildcards and HTTP origins are rejected, and authenticated AgentOS access remains required.
- After Instance Protection is enabled, trusted browsers and mobile devices can authenticate with the configured username and password without receiving an `#agentos_token` bootstrap URL. API token authentication remains the bootstrap boundary while Instance Protection is disabled.
- API routes are centrally protected, and remote Gateway URLs are blocked by default unless explicitly allowed with `AGENTOS_ALLOW_REMOTE_GATEWAY_URL=1`.
- Sensitive local config/auth files are written with owner-only permissions where applicable.

Compatibility:

- Requires Node.js 24 or newer.
- Recommended OpenClaw: 2026.9.2.
- Supported minimum: OpenClaw 2026.9.1 after explicit session-security reconciliation.
- Native contract target: OpenClaw 2026.9.2.
- Uses OpenClaw Gateway-first transport by default, with explicit CLI fallback for install, recovery, Gateway process control, older or unsupported Gateway methods, malformed responses, scope limits, and unavailable native auth.
- Run `agentos doctor --deep` and check in-app diagnostics to verify OpenClaw version, Gateway protocol compatibility, native auth, scopes, fallback activity, and model readiness before the first mission.
- Account-target browser-profile dispatch is an MVP bridge until OpenClaw exposes typed browser-profile dispatch. AgentOS enforces access rules before task launch and passes selected profile/session context; `requires_approval` rules remain blocked until approval dispatch exists.
