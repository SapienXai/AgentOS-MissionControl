# AgentOS Clean-Install Smoke Checklist

Use this checklist before publishing or announcing an AgentOS release. It is manual by design because it depends on local OpenClaw Gateway auth, operator scopes, model credentials, and provider state.

## Prerequisites

- Use Node.js 24.16.0+ or 26.1.0+.
- Use the recommended OpenClaw 2026.9.3. The supported minimum is OpenClaw 2026.9.1 after explicit session-security reconciliation; the native contract target is 2026.9.3.
- Start the OpenClaw Gateway on loopback.
- Confirm `openclaw gateway status --deep --json` reports protocol v4, reachable RPC, and operator auth.

## Package Smoke

```bash
pnpm lint
pnpm typegen
pnpm typecheck
pnpm test
pnpm build
pnpm check:release
pnpm smoke:agentos-package
```

## Clean Install

```bash
pnpm remove -g @sapienx/agentos || true
pnpm add -g @sapienx/agentos
agentos --version
agentos doctor
agentos doctor --deep
```

Expected:

- `agentos --version` prints the release version.
- `agentos doctor` reports package, Node.js, bundle, OpenClaw, and Gateway basics without deep compatibility noise.
- `agentos doctor --deep` reports Gateway protocol, native auth, scopes, required methods, config access, channel status, model readiness, fallback count, and last native failure.
- Scope approval warnings are acceptable only when OpenClaw is actually waiting for operator scope approval.
- The packaged launcher opens an authenticated local URL and does not require source checkout config files.
- Run this section on a physical operator machine before publishing or announcing a release.

## Mission Flow

- Start AgentOS with `agentos start --open`.
- Compare `agentos doctor --deep`, `/api/diagnostics`, and the in-app diagnostics panel.
- Confirm the dashboard loads workspaces, agents, sessions, model readiness, runtime cards, and visible Gateway fallback diagnostics.
- Dispatch a mission to a real workspace-backed OpenClaw agent.
- Abort one active run if available.
- Send a direct chat message to an agent.
- Refresh `/api/snapshot?force=true` and confirm runtime cards show real source/degraded state.

## Accounts And Browser Profiles

- Open the Accounts page and confirm it reads real OpenClaw browser profiles or shows an explicit unavailable state.
- Connect Account should open a login URL through a reported OpenClaw browser profile and save only the AgentOS login-target entry after the browser action succeeds.
- Confirm the UI states that website account identity is not verified by OpenClaw and typed browser-profile dispatch is not exposed yet.
- Grant `Can use profile` only to browser-capable agents and confirm agents without access cannot launch account-target tasks.
- Confirm `requires_approval` access rules remain blocked/coming soon until approval dispatch exists.
- Confirm saved login target URLs do not retain query strings or fragments containing tokens, cookies, passwords, or other secrets.

## Surface Repair

- Open a workspace with surface binding drift.
- Run the repair preview first.
- Confirm the preview returns `dryRun: true`, `applied: false`, `auditId`, `auditPath`, planned config paths, and restore instructions.
- Apply only after explicit confirmation.
- Confirm the applied repair returns `applied: true`, `confirmedPreviewAuditId`, `backupId`, `backupPath`, `auditId`, and config mutation metadata.
- Inspect the redacted audit and backup JSON records under `.mission-control/surface-reconcile/`.
- Confirm unmanaged OpenClaw bindings remain untouched.

## Degradation Checks

- Force CLI mode with `AGENTOS_OPENCLAW_GATEWAY_CLIENT=cli`.
- Stop the Gateway and confirm AgentOS shows visible degraded/fallback state.
- Test a bad Gateway token and confirm secrets are redacted.
- Reproduce missing scope approval and confirm `agentos doctor --deep` reports warnings, not hidden success.
