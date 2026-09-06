# OpenClaw upstream release watcher

AgentOS uses a scheduled, read-only upstream intake to turn official OpenClaw
releases into compatibility-review evidence. The watcher is an engineering
maintenance system, not a runtime updater or certification authority.

```text
official npm metadata + GitHub release/tag/source
        -> exact identity verification
        -> existing AgentOS Gateway contract diff
        -> deterministic impact classifier
        -> certification-plan generator
        -> JSON/Markdown workflow artifacts
        -> one deduplicated GitHub review issue
        -> human Compatibility Lab review
```

## Sources and release selection

The watcher reads only official OpenClaw sources:

- npm registry package metadata for `openclaw`, `@openclaw/gateway-protocol`,
  and `@openclaw/gateway-client`;
- the official `openclaw/openclaw` GitHub releases API;
- the official Git tag/ref and bounded raw build metadata when available.

The community stability service is deliberately not imported by the watcher.
It remains an advisory runtime/UI source only.

Scheduled runs select stable OpenClaw releases newer than the current
`OPENCLAW_RECOMMENDED_VERSION`. Known `alpha`, `beta`, `rc`, `canary`,
`nightly`, `dev`, `next`, and `preview` suffixes are ignored by default.
Manual dispatch can provide one validated exact target and opt into prerelease
inspection. Versions are parsed numerically, so `2026.9.10` sorts after
`2026.9.2`.

The watcher processes a bounded backlog in ascending order. Each target gets
its own intake and is compared sequentially to the previous upstream release,
while AgentOS policy still remains based on the current recommended version.
An unexpectedly large backlog fails visibly instead of launching an unbounded
job.

## Identity and evidence

An intake verifies the exact package version and npm integrity, GitHub release
tag, resolved Git commit, publication metadata, and protocol/client package
identity. Build metadata is captured when the official tagged source exposes
`dist/build-info.json`; unavailable optional evidence is reported as
incomplete, never invented.

Disagreements are `IDENTITY_MISMATCH`. A later change to the identity hash for
an already-ingested version is `UPSTREAM_RELEASE_IDENTITY_DRIFT` and remains
blocked from certification.

Contract evidence reuses
`lib/openclaw/application/update-contract-diff-service.ts`. The watcher adapts
that result into structured facts: method/scope changes, protocol and schema
file changes, update/session contract flags, security-sensitive evidence, and
changed domains. Release-note signals are preserved separately as advisory
evidence; they cannot override the contract diff.

Release identity verification and compatibility evidence completeness are
independent. A verified package/tag identity does not prove that the contract
diff is complete. Any incomplete identity evidence or contract evidence gap keeps
`DISCOVERY_INCOMPLETE`, blocks certification, and keeps the intake blocked.

## Impact and certification plan

The classifier is deterministic and evidence-based. It can emit:

- `SECURITY_CRITICAL`
- `BREAKING`
- `BEHAVIOR_CHANGE`
- `COMPATIBILITY_REVIEW`
- `NEW_CAPABILITY`
- `LOW_RISK_ADDITIVE`
- `NO_KNOWN_AGENTOS_IMPACT`
- `IDENTITY_MISMATCH`
- `UPSTREAM_RELEASE_IDENTITY_DRIFT`
- `DISCOVERY_INCOMPLETE`

Changed domains map to bounded AgentOS modules and real existing checks. For
example, session/security evidence requires the session-security, multi-user,
and shared-Gateway trust review; update evidence requires Native Doctor,
durable lifecycle, reconnect, and target verification; config/default changes
require fresh-baseline and migration checks.

The intake always has certification status `not-certified` and normal update
permission `false`. Exact manifest status is read from the current manifest;
version ordering never infers certification. A closed issue is not a
certification decision.

## Artifacts and issues

Each processed release produces:

- `openclaw-<version>-intake.json`;
- `openclaw-<version>-contract-diff.json`;
- `openclaw-<version>-issue.md`.

Scheduled Actions uploads these artifacts with bounded retention. It does not
commit them to `main`.

The issue title is:

`OpenClaw <version> — AgentOS Compatibility Intake`

Every body contains the stable marker
`<!-- agentos-openclaw-intake:<version> -->`, an intake hash, and an identity
hash. All issue states are searched, including closed issues. The same identity
and intake hash is a no-op. Changed evidence refreshes only the generated
section. Identity drift adds an integrity warning without reopening a closed
issue.

Release notes are bounded, control-character/ANSI sanitized, and rendered as
quoted evidence. They are never executed or interpolated into shell commands.
Manual target versions are validated before they can be used in URLs or
artifact paths.

## Workflow and local invocation

The scheduled workflow is
`.github/workflows/openclaw-release-watch.yml` and runs daily at a non-round
minute. It supports manual inputs for `target_version`, `include_prerelease`,
`dry_run`, and `force_refresh`. It uses only `contents: read` and `issues: write`
permissions and the standard `GITHUB_TOKEN`; no Gateway token or model key is
needed.

Local deterministic execution is available through:

```bash
pnpm openclaw:release-watch --dry-run
pnpm openclaw:release-watch --target 2026.9.3 --dry-run
```

Network discovery failures are distinct from `current`/no-release results.
The runner writes a GitHub Actions step summary and exits non-zero for
discovery failure or an unbounded backlog.

## Safety boundary

The watcher may detect and analyze a release, but it never:

- changes recommended, supported-baseline, or native-contract constants;
- writes the compatibility manifest or promotes candidate/certified status;
- calls the normal native update mutation or Compatibility Lab updater;
- mutates a Gateway, Docker/Railway pin, deployment, package, or release;
- requires a production Gateway or an LLM/API key.

The handoff is explicit: upstream intake produces evidence and a review issue;
human review then decides whether to run Compatibility Lab certification and,
separately, promote a manifest entry.
