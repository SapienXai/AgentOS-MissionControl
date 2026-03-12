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

Optional flags:

```bash
agentos start --port 3000 --host 127.0.0.1
agentos start --port 3000 --host 127.0.0.1 --open
agentos doctor
```

Optional environment variables:

```bash
AGENTOS_HOST=127.0.0.1
AGENTOS_PORT=3000
AGENTOS_OPEN=1
```

`agentos doctor` prints the effective URL, bundle status, Node.js compatibility, OpenClaw detection, and browser auto-open support.

AgentOS is designed to work with a local OpenClaw installation. If OpenClaw is missing, AgentOS still starts and guides onboarding in the UI.
