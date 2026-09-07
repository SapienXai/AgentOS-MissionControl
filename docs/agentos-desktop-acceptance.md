# AgentOS Desktop acceptance

## Locally verified

- Desktop React/Vite build
- Desktop TypeScript check
- Tauri native check and package binary build
- Rust formatting and native unit tests
- OpenClaw version/status parsing and log redaction
- Workspace traversal protection
- Absolute-path and nested-symlink workspace write rejection
- Deep-link allowlist
- Product contract and OpenClaw-backed snapshot normalization
- Persisted onboarding and desktop preference defaults
- UUID PTY sessions, natural-exit cleanup, and bounded terminal output
- Existing Next.js lint, typecheck, tests, and production build

## CI matrix

- Ubuntu, macOS, and Windows native desktop checks
- Manual/tag-gated desktop packaging artifacts
- Existing OpenClaw compatibility matrix

## Release-only checks

- Updater configuration requires a real public key and endpoint
- Tauri updater feature is enabled only for the signed release build
- Signing and notarization credentials remain CI secrets
- Release publication remains outside the default CI workflow
