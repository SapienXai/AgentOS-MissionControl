# Official OpenClaw Gateway transport

The AgentOS OpenClaw Gateway migration is complete. The native production path
uses the exact OpenClaw 2026.9.2 packages and Gateway protocol v4:

- `@openclaw/gateway-client@2026.9.2`
- `@openclaw/gateway-protocol@2026.9.2`
- OpenClaw source commit `3928bad9badfcb6c7d140530435e806fb8092190`
- Gateway protocol range `{ min: 4, max: 4 }`

There is one native Gateway transport architecture. The custom AgentOS
WebSocket transport, selector, socket lifecycle, request correlation, custom
reconnect loop, and rollback-only authentication assembly were removed in
Phase 5B. The pre-Phase-5B implementation remains recoverable through Git
history; it is no longer active production code.

## Final dependency graph

```text
AgentOS services and routes
        |
        v
gateway-client-factory
        |
        +--> forced CLI -> CliOpenClawGatewayClient
        |
        +--> official-backed AgentOS client
                  |
                  +--> AgentOsGatewayRequestPolicy
                  +--> OfficialOpenClawGatewayConnectionCoordinator
                  +--> OfficialOpenClawGatewayTransport
                  +--> OfficialOpenClawGatewayHost
                              |
                              +--> gateway-state
                              +--> gateway-device-auth
                  +--> @openclaw/gateway-client
                  +--> @openclaw/gateway-protocol
                              |
                              v
                       OpenClaw Gateway
```

`NativeWsOpenClawGatewayClient` is retained as a historical compatibility name
for the shared AgentOS domain/policy client. It does not implement WebSocket
transport. The official factory supplies its transport boundary explicitly;
tests use a transport-neutral double or the official local harness.

## Ownership

AgentOS owns:

- domain methods, normalization, payload projections, and product semantics;
- `AgentOsGatewayRequestPolicy`, including the 300 ms read cache, read
  coalescing, mutation invalidation, abort isolation, and generation fencing;
- CLI fallback policy, diagnostics, auth attribution, and runtime projections;
- aggregate subscription intent, event fan-out and persistence, and bounded
  snapshot reconciliation after reconnects or sequence gaps;
- managed-write state handling at the official host boundary.

OpenClaw owns:

- protocol contracts and the socket lifecycle;
- challenge/auth protocol, request correlation, timeouts, reconnect/backoff;
- raw event delivery, sequencing, sequence-gap detection, and device-token
  protocol behavior.

The event bridge listens to official lifecycle/reconnect notifications. It does
not own a reconnect timer or a second reconnect loop. Runtime subscriptions
remain `sessions.subscribe` plus per-key `sessions.messages.subscribe`; task
updates arrive as raw task events. AgentOS never sends `tasks.subscribe`.

## Factory and CLI behavior

`getOpenClawGatewayClient()` resolves to the official-backed client by default.
The only alternate factory result is the explicit CLI client when one of these
supported overrides is active:

- `AGENTOS_OPENCLAW_GATEWAY_CLIENT=cli`
- `OPENCLAW_GATEWAY_CLIENT=cli`
- `AGENTOS_OPENCLAW_NATIVE_WS=0|false|off`

CLI is a bounded AgentOS fallback/recovery path, not a native transport
rollback. Sent or ambiguous mutations remain fail-closed, and no CLI event
transport is created.

## Auth and state boundary

The official host continues to use `gateway-state.ts` and
`gateway-device-auth.ts` for state resolution, device identity derivation,
Ed25519 signing, token persistence, token clearing, and stale-writer fencing.
Explicit token/password behavior and `sharedStateMode` semantics are unchanged.
Diagnostics and error callbacks remain redacted; secrets and private keys are
never emitted.

## Certification and historical records

The official transport tests use the local official Gateway harness for v4
handshake, request/error behavior, reconnect, event replay, sequence gaps,
device auth, token rotation, and managed-write state safety. Domain, policy,
CLI fallback, task, channel, and compatibility tests remain above that seam.

The final disposable-runtime certification uses the true production factory
and the exact pinned OpenClaw release. Provider-backed chat execution and live
Telegram/WhatsApp lifecycle are skipped when credentials or runtime targets are
not available; their transport-independent regression coverage remains.

Earlier Phase 1 through Phase 5A docs and evidence intentionally retain their
historical descriptions of the migration and rollback architecture. They are
not current implementation contracts. Future OpenClaw upgrades follow the
normal compatibility and release-certification workflow rather than this
migration plan.

Current status: **OpenClaw official Gateway migration COMPLETE**.
