# OpenClaw Runtime Smoke Test

Date: 2026-05-02

Commit tested: `4b71278` plus the working-tree fixes from this pass.

Environment:

- AgentOS dev server was already running from `pnpm dev` on `http://localhost:3000`.
- OpenClaw CLI was installed and detected.
- Local gateway endpoint was `ws://127.0.0.1:18789`.
- Browser validation used Browser Use with the in-app browser backend.
- Real Telegram, Discord, Slack, Google Chat, Gmail, webhook, cron, and email credentials were not provided, so provider success flows were not attempted.
- The local OpenClaw ChatGPT account hit a usage limit during agent chat/mission execution, so model-completion success is blocked by account quota.

## Commands Run

- `pnpm typecheck`
- `pnpm lint`
- `pnpm test`
- `pnpm test -- tests/openclaw-workspace-service.test.ts tests/openclaw-stabilization.test.ts`
- `/bin/zsh -lc "node /private/tmp/agentos-deep-runtime-smoke.mjs"`
- `/bin/zsh -lc "AGENTOS_OPENCLAW_GATEWAY_CLIENT=cli OPENCLAW_GATEWAY_CLIENT=cli AGENTOS_OPENCLAW_NATIVE_WS=0 node -r ./tests/register-paths.cjs -r jiti/register.js -e ..."`
- Browser Use navigation and DOM checks against `http://localhost:3000`.

## Browser Validation

Browser Use was available and used.

Validated:

- AgentOS booted at `http://localhost:3000`.
- Page title was `AgentOS | Control Plane`.
- Initial page contained OpenClaw status, workspace navigation, agent controls, and no captured browser console errors.
- API-created smoke workspaces appeared in the workspace list without a page reload.
- Selecting the non-ASCII smoke workspace `İstanbul Çalışma mooa18rv-yvxl6e` rendered a non-empty workspace canvas with workspace path, agent card, composer, and task controls.
- The previous empty-canvas-after-create symptom is resolved for the smoke workspace id path.

Not fully browser-driven:

- The full workspace wizard submit flow was not completed through browser clicks in this pass. API-level create/update/read flows were executed, then Browser Use validated that the resulting workspace list and canvas state rendered correctly.
- Agent delete and workspace delete through UI were not executed because local deletion requires explicit action-time confirmation.

## Smoke Checklist

Passed:

- App boot and visible Mission Control shell.
- No production imports from `lib/openclaw/service.ts`.
- Existing boundary tests for OpenClaw import cycles and direct CLI usage.
- Gateway restart/start/stop API requests returned stable responses.
- Model catalog loaded with 364 models.
- OpenAI Codex provider status returned a stable configured-model response.
- Model discovery returned 9 models.
- Capability catalog loaded with 14 skills and 37 tools.
- Workspace create returned an id present in refreshed `/api/snapshot?force=true`.
- Workspace edit draft loaded for the created workspace.
- Legacy `workspace:<hash>` update alias worked.
- Additional agent create/update worked in the smoke workspace.
- Non-ASCII workspace name creation worked.
- Same-basename workspace paths were disambiguated: `shared-base` and `shared-base-9c64e76b`.
- Task detail stream emitted a task event.
- Runtime output loaded for the smoke runtime.
- Gateway remote URL set/clear now reflects in `snapshot.diagnostics.configuredGatewayUrl`.
- Invalid gateway protocol `http://example.com` returns HTTP 400 with `Gateway address must start with ws:// or wss://.`
- CLI-forced fallback snapshot loaded with `AGENTOS_OPENCLAW_GATEWAY_CLIENT=cli`, `OPENCLAW_GATEWAY_CLIENT=cli`, and `AGENTOS_OPENCLAW_NATIVE_WS=0`.
- Provider validation returned stable missing-field errors for Telegram, Discord, Slack, Gmail, webhook, cron, and email.
- Google Chat provisioning returned the current stable unsupported-provider error.
- Telegram and Discord route discovery without credentials returned empty routes without crashing.
- Slack discovery is reported unsupported and does not crash.

Blocked:

- Real agent chat completion: OpenClaw returned `You have hit your ChatGPT usage limit (plus plan). Try again in ~91 min.`
- Real mission completion: submit and task/runtime surfaces worked, but task status stalled with the same ChatGPT usage-limit message.
- Real provider success flows for Telegram, Discord, Slack, Google Chat, Gmail, webhook, cron, and email require credentials/configuration not present in this environment.
- Actual delete-agent/delete-workspace cleanup is blocked until action-time confirmation is provided for deleting the temporary local smoke artifacts.
- Running a second `next dev` server with forced CLI fallback is blocked by Next dev's single-repo lock while the active dev server is running. A CLI-forced snapshot load was validated instead.

Temporary artifacts pending delete confirmation:

- `runtime-smoke-updated-mooa18rv-yvxl6e` at `/private/tmp/agentos-smoke-mooa18rv-yvxl6e/runtime-smoke-updated-mooa18rv-yvxl6e`
- `istanbul` at `/private/tmp/agentos-smoke-mooa18rv-yvxl6e/istanbul`
- `shared-base` at `/private/tmp/agentos-smoke-mooa18rv-yvxl6e/a/shared-base`
- `shared-base-9c64e76b` at `/private/tmp/agentos-smoke-mooa18rv-yvxl6e/b/shared-base`
- Additional agent `smoke-extra-mooa18rv-yvxl6e`

## Fixed Issues

### Workspace Id Collision

Reproduction:

- Create two workspaces with different parent folders but the same basename.
- Before this pass, both paths resolved to the same basename-derived workspace id.

Root cause:

- Workspace ids were normalized from only `path.basename(workspacePath)`, so different paths with the same basename collided.

Fix:

- Added contextual workspace id resolution in `lib/openclaw/domains/workspace-id.ts`.
- Non-colliding workspaces keep the existing slug id.
- Colliding workspaces keep the first observed slug id and disambiguate later same-basename paths with a short path hash.
- Legacy `workspace:<hash>` aliases remain accepted.
- Mission-control snapshots, workspace service responses, agent workspace resolution, and runtime normalization now use the shared id resolver where context is available.

Tests:

- Added workspace id resolver coverage for same-basename paths and legacy aliases.

### Gateway Remote URL Not Reflected In Snapshot

Reproduction:

- `PATCH /api/settings/gateway` with `ws://127.0.0.1:18789` returned success.
- The returned snapshot still had `configuredGatewayUrl: null`.

Root cause:

- Settings mutations wrote `gateway.remote.url` through the adapter, but mission-control snapshot loading was not reading that config path back into diagnostics.

Fix:

- Mission-control snapshot loading now reads `gateway.remote.url` through `OpenClawAdapter.getConfig`.
- The value is normalized into `snapshot.diagnostics.configuredGatewayUrl`.
- Clear still returns `configuredGatewayUrl: null`.

Verification:

- Live API recheck returned `configured: "ws://127.0.0.1:18789"` after set and `configured: null` after clear.

## Notes

- The smoke probe initially marked `gatewayUrl: "not-a-url"` as invalid, but the current product intentionally accepts bare host shorthand and normalizes it to `ws://...`. The true invalid-protocol case `http://example.com` correctly returns 400.
- Gateway stop returned a stable API response and then the local gateway health recovered. This appears to be current local gateway/probe behavior rather than a crash.
- Native WS scope remains unchanged: generic RPC only with CLI fallback for typed workflows.
- CLI fallback remains required and was validated through a forced-env snapshot load.

## Final Verification

Final verification from this pass:

- `pnpm typecheck`: passed.
- `pnpm lint`: passed.
- `pnpm test`: passed, 92 tests.

## Remaining Risks

- Real agent/mission success still needs a fresh ChatGPT/OpenClaw quota window or a different configured model/provider.
- Real external provider provisioning requires valid provider credentials and target accounts.
- Destructive cleanup/delete flows still need explicit confirmation before execution.
- A full UI wizard-driven workspace create flow should be manually smoke-tested in a clean session before a demo.
