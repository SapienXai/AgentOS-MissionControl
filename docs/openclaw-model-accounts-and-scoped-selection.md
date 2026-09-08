# OpenClaw Model Accounts and Scoped Selection

AgentOS presents model and provider state for operators, but OpenClaw remains
the authority for model identity, provider identity, account/profile state,
authentication, availability, selection, fallback execution, and runtime
resolution. AgentOS does not create a model registry, provider registry,
credential store, fallback engine, or session-model lifecycle.

## Exact 2026.9.3 contract

The Phase 4 integration is based on OpenClaw `2026.9.3`, source
`1391f7cd2d40ab5bbcf2f5f831d3a64f520e72d7`, Gateway protocol `v4`, and the
matching `@openclaw/gateway-client` and `@openclaw/gateway-protocol` packages.

The native model contract used by AgentOS is:

| Native method | AgentOS use | Scope | Authority |
| --- | --- | --- | --- |
| `models.list` | Catalog, availability, provider outcomes, agent-scoped reads | `operator.read` | OpenClaw |
| `models.authStatus` | Provider and auth-profile inventory | `operator.read` | OpenClaw |
| `models.authLogout` | Explicit provider/profile removal | `operator.admin` | OpenClaw |
| `agents.list` | Native worker primary/fallback configuration | `operator.read` | OpenClaw |
| `agents.update` | Worker model selection or clear/inherit | `operator.admin` | OpenClaw |
| `sessions.list` | Current session model and override provenance | `operator.read` | OpenClaw |
| `sessions.patch` | Session model override or clear | dynamic; model-only uses `operator.write` | OpenClaw |
| `config.patch` | Existing default/fallback configuration service | native config scope | OpenClaw |

`models.list` accepts the exact 9.1 catalog controls `view`, `preparedOnly`,
`refresh`, `agentId`, and `includeProviderCapabilities`. Normal reads do not
force refresh. AgentOS uses `agentId` only to ask OpenClaw for the selected
worker's native runtime context; it does not rebuild model inheritance.

OpenClaw 9.1 does not expose a dedicated native `models.setDefault` or
account-selection method in the contract used here. Defaults and fallback
order continue through the existing native config mutation path. A personal
account/profile selector is not simulated when OpenClaw does not expose one.
Mission-level model scope is not a native OpenClaw runtime scope and is not
invented by AgentOS.

## Separate model concepts

The product keeps these concepts distinct:

- Catalog: models returned by OpenClaw `models.list`.
- Account/profile: provider identities and auth profiles returned by
  `models.authStatus`.
- Configured model: the native default, worker primary, fallback list, or
  explicit session override.
- Effective runtime model: the model OpenClaw reports for the current session
  or run. A ready configured worker/default model is not runtime evidence.
- Fallbacks: the ordered native policy. OpenClaw chooses and executes a
  fallback; AgentOS only displays and edits the native order.

Catalog presence is not readiness. The normalized availability states are:

| AgentOS state | Native evidence |
| --- | --- |
| `ready` | `available: true` |
| `needs-auth` | `unavailableReason: missing-auth` |
| `auth-failed` | `unavailableReason: auth-failed` |
| `cooldown` | `unavailableReason: cooldown` |
| `unavailable` | explicit `available: false`, disabled/deprecated, or native missing marker |
| `unknown` | native availability was not reported |

Native `unavailableReason` and `unavailableUntil` remain available to the
advanced model detail surface. A configured model absent from the successful
native inventory is retained as an exact configured reference and presented as
missing; it is never silently replaced.

## Account and identity boundaries

Provider/profile rows are normalized directly from the secret-free native
`models.authStatus` response. AgentOS preserves provider IDs and profile IDs,
profile type, status, reason code, expiry metadata, and whether OpenClaw
supports logout. It never stores or displays tokens, API keys, OAuth refresh
tokens, cookies, or secret values.

The AgentOS authenticated operator and the OpenClaw native profile/account are
different identities. The mapping is established by the authenticated Gateway
and native auth response; matching a provider label is not treated as proof of
account ownership. Login and external completion continue through the existing
OpenClaw setup flow. AgentOS does not implement a second OAuth protocol.

The existing provider presentation registry remains presentation metadata and
legacy setup compatibility. It may supply labels, icons, grouping, and old
migration hints, but it cannot decide whether a model exists, is authenticated,
or is runtime-ready.

## Scoped selection

### Default

The default model and ordered fallbacks are read from OpenClaw's native
`agents.defaults` configuration and written through the existing native config
service. Clearing or changing a value preserves native inheritance/config
semantics. AgentOS does not select the next fallback when the primary is not
ready.

### Worker

Worker selection is read from native `agents.list` and the selected worker's
agent-scoped `models.list` result. The Worker Profile picker offers ready
native models and an `Automatic` option. `Automatic` sends a native clear
(`model: null`) so future OpenClaw default changes remain effective. AgentOS
does not persist a worker assignment table.

### Session

Session model selection uses native `sessions.patch` with the exact session key
and model ID. The session inspector reads the selected session through the
AgentOS model-management route, which composes `models.list` and `sessions.list`
inside the application layer. The native session row's `modelOverrideSource`
is preserved:

- `user` means an explicit session override;
- `auto` means OpenClaw selected a temporary/automatic runtime value;
- `null` means the session is inherited;
- missing provenance remains unknown rather than being guessed.

The current session model and its native provenance are never rewritten to the
latest worker or default configuration. A running session can therefore show a
different native model from its worker after the worker configuration changes.
Clearing a session override sends `model: null` to OpenClaw; it does not copy
the current agent model into the session.

Mission is an AgentOS business context, not a fabricated native model scope.

## Phase 4.1 — Truthfulness and inheritance hardening

Native session provenance is authoritative. `modelOverrideSource: "user"`
means that a session has an explicit model override even when its worker is
`Automatic` or has no explicit model. `"auto"` and `null` are not user
overrides; an omitted field remains unprojected and is not treated as proof of
an override. Choosing `Automatic` in the session inspector sends the native
`sessions.patch` mutation with `model: null`, then rereads OpenClaw state to
confirm that the explicit override is gone. AgentOS never copies a worker or
default model into the session to simulate inheritance.

Selection projections now separate three facts: `configuredModelId` and
`configuredStatus` describe native configuration and catalog readiness, while
`effectiveModelId` describes only concrete native session evidence. Worker and
default scopes therefore report a ready configured model without claiming that
it is the model currently executing; fallback execution remains OpenClaw-owned.

The worker and session pickers use the same native `models.list` `view=default`
read as session mutation validation. A model is selectable only when native
availability is explicitly `true`; visible configured references that are
missing, unavailable, or have missing authentication remain visible as
non-selectable state. A catalog race after the picker read can still be
rejected by OpenClaw, but a stable native state cannot disagree solely because
AgentOS used different catalog views.

## Mutation safety and reconciliation

Worker, default, fallback, account, and session mutations use existing AgentOS
product permissions, OpenClaw scope preflight, the Gateway's final
authorization, cache invalidation, and authoritative rereads. AgentOS does
not blindly retry a mutation after a timeout. For session model selection, a
failed write is reconciled by a bounded native `sessions.list` read; success is
returned only when the requested native model is visible. Session reset also
reconciles against the refreshed native snapshot before reporting failure.

Native model/profile changes are observable through the existing Gateway/event
and request-policy infrastructure. No second event stream, reconnect owner,
or model polling daemon is introduced. When an exact native event is not
available, the mutation's explicit invalidation and authoritative reread are
the freshness guarantee.

## UI and performance boundaries

The global Models surface shows native catalog/provider state, account/profile
status, primary/fallback configuration, and advanced policy details. Worker
selection remains in the existing Worker Profile flow. Session selection is
limited to the existing runtime inspector. No model or provider marketplace,
new navigation category, or broad selector redesign is added.

Normal root Dashboard rendering is unchanged and does not fetch full model or
account management state. Global model reads are bounded parallel native reads;
worker and session detail reads are lazy and agent/session scoped. A selector
uses one catalog read for its options, not one read per model or provider.

Primary UI wording is human-facing (`Ready`, `Needs authentication`,
`Cooling down`, `Status unknown`, `OpenClaw default`). Exact native IDs,
provider IDs, fallback order, and raw availability evidence remain available
only in appropriate advanced/detail surfaces.

## Compatibility and legacy behavior

Existing OpenClaw setup and compatibility flows remain in place where they are
needed for onboarding, migration, or provider-specific preparation. They are
not a competing source of model truth. New Phase 4 reads and session model
selection use the typed AgentOS application/service boundary and the native
Gateway path. No new CLI fallback is introduced for these integrated methods.

Exact 9.1 features not exposed by OpenClaw remain explicitly unsupported or
deferred: dedicated account/profile selection, a dedicated default-model RPC,
Mission model scope, and any provider-specific account transfer workflow.
