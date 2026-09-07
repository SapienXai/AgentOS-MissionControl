# AgentOS Desktop release

The desktop app is packaged with Tauri 2. Local development and unsigned
validation use apps/desktop/src-tauri/tauri.conf.json. The updater is
release-only: its Tauri feature and capability are enabled only when a signed
release configuration is prepared.

Before a signed build, provide these CI secrets or environment variables:

- AGENTOS_TAURI_UPDATER_PUBKEY
- AGENTOS_TAURI_UPDATER_ENDPOINT
- TAURI_SIGNING_PRIVATE_KEY
- TAURI_SIGNING_PRIVATE_KEY_PASSWORD

Generate the release overlay with:

~~~bash
pnpm desktop:release:config --output=apps/desktop/src-tauri/tauri.release.generated.json
pnpm exec tauri build \
  --config apps/desktop/src-tauri/tauri.release.generated.json \
  --features updater
~~~

The preparation command fails closed when the updater public key or endpoint is
missing. Never replace either value with a placeholder in a distributable
build. Tauri verifies signed update artifacts against the configured public key.

The repository does not contain signing credentials. macOS notarization,
Windows installer signing, and Linux artifact publication remain CI-owned
operations.
