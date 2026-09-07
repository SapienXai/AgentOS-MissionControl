# AgentOS 0.7.8 Release Notes

AgentOS 0.7.8 improves the packaged desktop operator experience and keeps the Mission Control task composer reliable during interactive task creation.

## Highlights

- Keeps Mission Compose open while users choose an agent, thinking level, schedule, or submit a task.
- Preserves the native Tauri titlebar maximize interaction on supported desktop platforms.
- Retains the Gateway-first OpenClaw integration and thin Tauri desktop shell.

## OpenClaw Compatibility Impact

- Recommended OpenClaw: 2026.9.2.
- Supported minimum: OpenClaw 2026.9.1 after explicit session-security reconciliation.
- No OpenClaw runtime or credential ownership changes are included in this release.

## Security Impact

- No new credential, shell, remote-content, or Gateway authorization surface is introduced.
- Packaged AgentOS continues to use the existing local API token and secure Tauri URL boundaries.

## Validation

- `pnpm lint`
- Focused Mission Control regression tests
- `pnpm check:release`
- `pnpm smoke:agentos-package`
- `pnpm desktop:check`

## Smoke Status

- The release workflow runs the full CI, Mission Control browser smoke, and per-platform package smoke before publishing release assets.
- Manual packaged macOS validation remains required for the final desktop artifact.

## Known Limitations

- Runtime and OAuth smoke paths remain dependent on a configured local OpenClaw Gateway and provider credentials.
- Desktop release signing and notarization require the organization-controlled CI secrets described in `apps/desktop/RELEASE.md`.

## Upgrade Notes

- Requires Node.js 24 or newer.
- Preserve the existing OpenClaw state and credentials during upgrade.
- Run `agentos doctor --deep` after upgrading to verify Gateway reachability, native authentication, scopes, and model readiness.
