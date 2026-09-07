# AgentOS Desktop release readiness

The desktop version is checked against `packages/agentos/package.json`. `pnpm desktop:check` fails if the Tauri config, Cargo manifest, and published AgentOS package versions diverge.

## Updater signing

`tauri.conf.json` contains the updater verification key and points to the GitHub Release assets named `latest-{{target}}.json`. Production releases must provide:

- `TAURI_SIGNING_PRIVATE_KEY`
- `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`

The private key must never be committed or printed. The public key currently in the configuration was generated outside the repository for local artifact validation. Before the first production release, replace it with the long-lived organization-controlled public key and store its matching private key in the release environment. A local signed artifact is not evidence of production key control.

## GitHub Actions

- `desktop.yml` validates all three platforms and intentionally produces unsigned PR artifacts when release signing secrets are unavailable.
- `desktop-release.yml` is the release-only path. It runs for `agentos-v*` tags or an explicitly supplied tag, creates a draft GitHub Release, uploads platform installers and signed updater metadata, and requires the signing secrets.

macOS production distribution additionally requires Developer ID certificate and notarization credentials. The local `.app`/DMG build is not called Developer ID signed or notarized unless those credentials are present and the workflow reports successful signing/notarization.

Windows Authenticode signing is separate from Tauri updater signing and must be added to the organization's release environment before claiming a signed Windows installer.

Linux packages require the WebKitGTK/AppIndicator/Rsvg build dependencies listed in the workflow. Runtime users need a compatible WebKitGTK desktop environment and a system browser for external HTTP(S) links.

The native host starts only the packaged AgentOS server on loopback, retries a bounded set of startup port collisions, and waits up to five seconds during shutdown. Unix builds send the standalone server `SIGTERM` so Next.js can drain its listener; Windows uses the platform-native child termination behavior and retains the bounded wait plus explicit force fallback. The host never owns or stops the separate OpenClaw Gateway process.
