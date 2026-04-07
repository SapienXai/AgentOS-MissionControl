# @sapienx/agentos

Install:

```bash
pnpm add -g @sapienx/agentos
```

Run:

```bash
agentos
```

The `agentos` command starts the local AgentOS Mission Control server and prints the local URL.

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
agentos doctor
agentos uninstall
```

Optional environment variables:

```bash
AGENTOS_HOST=127.0.0.1
AGENTOS_PORT=3000
AGENTOS_OPEN=1
```

`agentos doctor` prints the effective URL, bundle status, Node.js compatibility, OpenClaw detection, and browser auto-open support.

`agentos stop` sends `SIGTERM` to the AgentOS server listening on the selected port. If the runtime state is stale and no process is listening there, the CLI clears that stale state automatically.

`agentos update` refreshes a release installation in place. `agentos update --check` only checks whether a newer version exists.

If AgentOS was installed with `pnpm` or `npm`, update commands only print the matching package manager command instead of changing files in place.

`agentos uninstall` removes a release-installer copy. If the package was installed with `pnpm` or `npm`, remove it with your package manager instead.

AgentOS is designed to work with a local OpenClaw installation. If OpenClaw is missing, AgentOS still starts and guides onboarding in the UI.
