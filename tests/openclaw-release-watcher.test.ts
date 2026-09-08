import assert from "node:assert/strict";
import { mkdtemp } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  assertValidOpenClawReleaseVersion,
  compareOpenClawReleaseVersions,
  discoverOfficialOpenClawReleases
} from "@/lib/openclaw/upstream/release-discovery";
import { verifyOfficialOpenClawRelease } from "@/lib/openclaw/upstream/release-identity";
import { buildOpenClawReleaseNotesEvidence } from "@/lib/openclaw/upstream/release-notes";
import {
  buildFixtureContractDiff,
  type OpenClawContractDiffSupplement
} from "@/lib/openclaw/upstream/contract-diff";
import {
  buildOpenClawCompatibilityIntake,
  renderOpenClawCompatibilityIssue
} from "@/lib/openclaw/upstream/compatibility-intake";
import {
  createGitHubIssueClient,
  syncOpenClawCompatibilityIssue,
  type GitHubIssueClient
} from "@/lib/openclaw/upstream/github-issue-client";
import { classifyOpenClawReleaseImpact } from "@/lib/openclaw/upstream/impact-classifier";
import { runOpenClawReleaseWatch, selectOpenClawReleasesForIntake } from "@/scripts/openclaw-release-watch";
import {
  LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST,
  resolveOpenClawUpdateDecision
} from "@/lib/openclaw/update-compatibility";
import type { OpenClawReleaseContractDiff, OpenClawReleaseIdentity } from "@/lib/openclaw/upstream/types";
import type { OpenClawCoreMethodSpec } from "@/lib/openclaw/application/update-contract-diff-service";

const releaseEndpoint = "https://api.github.com/repos/openclaw/openclaw/releases?per_page=50&page=1";
const npmDistTagsEndpoint = "https://registry.npmjs.org/-/package/openclaw/dist-tags";
const npmPackumentEndpoint = "https://registry.npmjs.org/openclaw";

test("OpenClaw release versions use strict validation and numeric ordering", () => {
  assert.equal(compareOpenClawReleaseVersions("2026.9.10", "2026.9.2") > 0, true);
  assert.equal(compareOpenClawReleaseVersions("v2026.10.1", "2026.9.10") > 0, true);
  assert.equal(compareOpenClawReleaseVersions("2026.9.3", "2026.9.3-rc.1") > 0, true);
  assert.equal(assertValidOpenClawReleaseVersion("v2026.9.3"), "2026.9.3");
  assert.throws(() => assertValidOpenClawReleaseVersion("../../foo"), /invalid/i);
  assert.throws(() => assertValidOpenClawReleaseVersion("2026.9.3; rm -rf /"), /invalid/i);
  assert.throws(() => assertValidOpenClawReleaseVersion("$(touch compromised)"), /invalid/i);
});

test("official discovery returns missed stable releases in ascending order and ignores prereleases", async () => {
  const fetchImpl = jsonFetch({
    [npmDistTagsEndpoint]: { latest: "2026.9.4", beta: "2026.9.5-beta.1" },
    [npmPackumentEndpoint]: {
      versions: {
        "2026.9.1": {},
        "2026.9.2": {},
        "2026.9.3": {},
        "2026.9.4": {},
        "2026.9.5-beta.1": {}
      },
      time: {
        "2026.9.3": "2026-09-03T00:00:00.000Z",
        "2026.9.4": "2026-09-04T00:00:00.000Z"
      }
    },
    [releaseEndpoint]: [
      releaseRecord("2026.9.4"),
      releaseRecord("2026.9.3"),
      releaseRecord("2026.9.5-beta.1")
    ]
  });

  const result = await discoverOfficialOpenClawReleases({
    currentRecommendedVersion: "2026.9.2",
    fetchImpl
  });

  assert.equal(result.status, "ok");
  assert.deepEqual(result.releases.map((release) => release.version), ["2026.9.3", "2026.9.4"]);
  assert.equal(result.latestStableVersion, "2026.9.4");
  assert.deepEqual(result.ignoredPrereleaseVersions, ["2026.9.5-beta.1"]);
});

test("discovery distinguishes upstream failure from no new release", async () => {
  const noRelease = await discoverOfficialOpenClawReleases({
    currentRecommendedVersion: "2026.9.2",
    fetchImpl: jsonFetch({
      [npmDistTagsEndpoint]: { latest: "2026.9.2" },
      [npmPackumentEndpoint]: { versions: { "2026.9.2": {} }, time: {} },
      [releaseEndpoint]: [releaseRecord("2026.9.2")]
    })
  });
  assert.equal(noRelease.status, "ok");
  assert.deepEqual(noRelease.releases, []);
  assert.equal(noRelease.latestStableVersion, "2026.9.2");

  const failed = await discoverOfficialOpenClawReleases({
    currentRecommendedVersion: "2026.9.2",
    fetchImpl: async () => {
      throw new Error("network unavailable");
    }
  });
  assert.equal(failed.status, "discovery-failed");
  assert.match(failed.error ?? "", /network unavailable/i);
});

test("explicit prerelease targets require explicit prerelease opt-in", async () => {
  await assert.rejects(
    discoverOfficialOpenClawReleases({
      currentRecommendedVersion: "2026.9.2",
      targetVersion: "2026.9.3-rc.1",
      fetchImpl: jsonFetch({
        [npmDistTagsEndpoint]: { latest: "2026.9.2" },
        [npmPackumentEndpoint]: { versions: { "2026.9.2": {} }, time: {} },
        [releaseEndpoint]: []
      })
    }),
    /include-prerelease/i
  );
});

test("official identity verification fails closed when npm and GitHub disagree", async () => {
  const verifiedFetch = identityFetch({ packageVersion: "2026.9.3" });
  const verified = await verifyOfficialOpenClawRelease({ version: "2026.9.3", fetchImpl: verifiedFetch });
  assert.equal(verified.identity.status, "verified");
  assert.equal(verified.identity.sourceCommit, "a".repeat(40));
  assert.equal(verified.releaseNotes.signals.includes("security"), true);

  const mismatch = await verifyOfficialOpenClawRelease({
    version: "2026.9.3",
    fetchImpl: identityFetch({ packageVersion: "2026.9.99", requestVersion: "2026.9.3" })
  });
  assert.equal(mismatch.identity.status, "identity-mismatch");
  assert.match(mismatch.identity.mismatches.join("\n"), /npm package version/i);

  const verifiedSource = identityFetch({ packageVersion: "2026.9.3" });
  const incomplete = await verifyOfficialOpenClawRelease({
    version: "2026.9.3",
    fetchImpl: async (input) => String(input) === "https://registry.npmjs.org/openclaw/2026.9.3"
      ? new Response(null, { status: 404 })
      : verifiedSource(input)
  });
  assert.equal(incomplete.identity.status, "incomplete");
  assert.equal(incomplete.identity.missingEvidence.includes("npm package version"), true);
});

test("release notes are bounded evidence and cannot inject workflow commands", () => {
  const notes = buildOpenClawReleaseNotesEvidence({
    body: "$(rm -rf /)\n::set-output name=x::bad\n<script>alert(1)</script>\nsecurity session update",
    sourceUrl: "https://github.com/openclaw/openclaw/releases/tag/v2026.9.3"
  });
  assert.doesNotMatch(notes.excerpt, /\$\(/);
  assert.doesNotMatch(notes.excerpt, /::set-output/);
  assert.doesNotMatch(notes.excerpt, /<script>/i);
  assert.equal(notes.signals.includes("security"), true);
  assert.equal(notes.signals.includes("sessions"), true);
  assert.equal(notes.signals.includes("updates"), true);
});

test("the historical 2026.9.1 to 2026.9.2 fixture detects security, behavior, and update capability changes", () => {
  const contractDiff = buildFixtureContractDiff({
    fromVersion: "2026.9.1",
    targetVersion: "2026.9.2",
    currentSpecs: [method("health"), method("update.status"), method("sessions.list")],
    targetSpecs: [
      method("health"),
      method("update.status"),
      method("sessions.list"),
      method("update.runs.get"),
      method("update.runs.list")
    ],
    supplement: historicalNineTwoSupplement()
  });
  const identity = identityFor("2026.9.2");
  const impact = classifyOpenClawReleaseImpact({
    identity,
    contractDiff,
    releaseNotes: buildOpenClawReleaseNotesEvidence({
      body: "Security hardening changes session visibility and adds durable update reports.",
      sourceUrl: null
    }),
    manifestStatus: "unknown"
  });

  assert.equal(contractDiff.source, "fixture");
  assert.equal(impact.classifications.includes("SECURITY_CRITICAL"), true);
  assert.equal(impact.classifications.includes("BEHAVIOR_CHANGE"), true);
  assert.equal(impact.classifications.includes("NEW_CAPABILITY"), true);
  assert.equal(impact.changedDomains.includes("sessions"), true);
  assert.equal(impact.changedDomains.includes("security"), true);
  assert.equal(impact.changedDomains.includes("updates"), true);
  assert.equal(impact.requiredChecks.some((check) => check.id === "session-security"), true);
  assert.equal(impact.requiredChecks.some((check) => check.id === "native-update-lifecycle"), true);
});

test("verified identity does not clear unknown contract evidence", () => {
  const impact = classifyOpenClawReleaseImpact({
    ...impactInput(),
    contractDiff: contractDiffFixture({ status: "unknown", evidenceGaps: [] })
  });

  assert.equal(impact.classifications.includes("DISCOVERY_INCOMPLETE"), true);
  assert.equal(impact.severity, "unknown");
  assert.equal(impact.requiredChecks.some((check) => check.id === "evidence-completion"), true);
});

test("verified identity does not override a contract evidence gap", () => {
  const impact = classifyOpenClawReleaseImpact({
    ...impactInput(),
    contractDiff: contractDiffFixture({
      status: "safe",
      evidenceGaps: ["target protocol descriptor unavailable"]
    })
  });

  assert.equal(impact.classifications.includes("DISCOVERY_INCOMPLETE"), true);
  assert.equal(impact.severity, "unknown");
  assert.equal(impact.requiredChecks.some((check) => check.id === "evidence-completion"), true);
});

test("complete evidence permits the normal low-risk or no-impact classification", () => {
  const impact = classifyOpenClawReleaseImpact(impactInput());

  assert.equal(impact.classifications.includes("DISCOVERY_INCOMPLETE"), false);
  assert.equal(impact.classifications.includes("LOW_RISK_ADDITIVE"), true);
  assert.equal(impact.classifications.includes("NO_KNOWN_AGENTOS_IMPACT"), true);
  assert.equal(impact.severity, "low");
});

test("identity incompleteness remains independent from complete contract evidence", () => {
  const impact = classifyOpenClawReleaseImpact({
    ...impactInput(),
    identity: {
      ...identityFor("2026.9.3"),
      status: "incomplete",
      missingEvidence: ["npm package integrity"]
    }
  });

  assert.equal(impact.classifications.includes("DISCOVERY_INCOMPLETE"), true);
  assert.equal(impact.severity, "unknown");
  assert.equal(impact.requiredChecks.some((check) => check.id === "evidence-completion"), true);
});

test("identity and contract incompleteness remain visible together", () => {
  const impact = classifyOpenClawReleaseImpact({
    ...impactInput(),
    identity: {
      ...identityFor("2026.9.3"),
      status: "incomplete",
      missingEvidence: ["npm package integrity"]
    },
    contractDiff: contractDiffFixture({ status: "unknown", evidenceGaps: [] })
  });

  assert.equal(impact.classifications.includes("DISCOVERY_INCOMPLETE"), true);
  assert.equal(impact.severity, "unknown");
  assert.equal(impact.rationale.some((value) => /identity/i.test(value)), true);
  assert.equal(impact.rationale.some((value) => /contract evidence/i.test(value)), true);
});

test("identity mismatch remains a distinct critical fail-closed classification", () => {
  const impact = classifyOpenClawReleaseImpact({
    ...impactInput(),
    identity: {
      ...identityFor("2026.9.3"),
      status: "identity-mismatch",
      mismatches: ["npm package version is 2026.9.99, expected 2026.9.3."]
    }
  });

  assert.equal(impact.classifications.includes("IDENTITY_MISMATCH"), true);
  assert.equal(impact.classifications.includes("DISCOVERY_INCOMPLETE"), false);
  assert.equal(impact.severity, "critical");
});

test("incomplete evidence cannot be made low risk by release-note reassurance", () => {
  const impact = classifyOpenClawReleaseImpact({
    ...impactInput(),
    contractDiff: contractDiffFixture({ status: "unknown", evidenceGaps: [] }),
    releaseNotes: buildOpenClawReleaseNotesEvidence({
      body: "No breaking changes are expected.",
      sourceUrl: "https://github.com/openclaw/openclaw/releases/tag/v2026.9.3"
    })
  });

  assert.equal(impact.classifications.includes("DISCOVERY_INCOMPLETE"), true);
  assert.equal(impact.classifications.includes("LOW_RISK_ADDITIVE"), false);
  assert.equal(impact.classifications.includes("NO_KNOWN_AGENTOS_IMPACT"), false);
  assert.equal(impact.severity, "unknown");
});

test("security-critical evidence remains critical when contract evidence is incomplete", () => {
  const impact = classifyOpenClawReleaseImpact({
    ...impactInput(),
    contractDiff: contractDiffFixture({
      status: "unknown",
      evidenceGaps: [],
      securitySensitiveChanges: ["session visibility default changed"],
      domainsChanged: ["security"]
    })
  });

  assert.equal(impact.classifications.includes("DISCOVERY_INCOMPLETE"), true);
  assert.equal(impact.classifications.includes("SECURITY_CRITICAL"), true);
  assert.equal(impact.severity, "critical");
});

test("intake JSON and issue output agree when identity is verified but contract evidence is incomplete", () => {
  const intake = buildOpenClawCompatibilityIntake({
    ...intakeInput(),
    contractDiff: contractDiffFixture({ status: "unknown", evidenceGaps: [] })
  });
  const issue = renderOpenClawCompatibilityIssue(intake);

  assert.equal(intake.identity.status, "verified");
  assert.equal(intake.contractDiff.status, "unknown");
  assert.equal(intake.impact.classifications.includes("DISCOVERY_INCOMPLETE"), true);
  assert.equal(intake.certification.status, "not-certified");
  assert.equal(intake.certification.normalUpdateAllowed, false);
  assert.match(issue, /NOT CERTIFIED/);
  assert.match(issue, /Static evidence incomplete.*certification blocked/i);
  assert.equal(intake.certification.requiredChecks.some((check) => check.id === "evidence-completion"), true);
});

test("runner returns intake-blocked and writes incomplete evidence for an authoritative contract failure", async () => {
  const outputDir = await mkdtemp(join(tmpdir(), "agentos-openclaw-watch-"));
  const result = await runOpenClawReleaseWatch({
    mode: "manual",
    targetVersion: "2026.9.4",
    dryRun: true,
    forceRefresh: true,
    outputDir,
    agentosCommit: "c".repeat(40),
    agentosVersion: "0.8.0",
    now: () => new Date("2026-09-06T00:00:00.000Z"),
    fetchImpl: releaseWatchIncompleteContractFetch("2026.9.4")
  });

  assert.equal(result.status, "intake-blocked");
  assert.equal(result.intakes.length, 1);
  const intake = JSON.parse(readFileSync(result.intakes[0].intakePath!, "utf8")) as ReturnType<typeof buildOpenClawCompatibilityIntake>;
  assert.equal(intake.identity.status, "verified");
  assert.equal(intake.contractDiff.status, "unknown");
  assert.equal(intake.impact.classifications.includes("DISCOVERY_INCOMPLETE"), true);
  assert.equal(intake.certification.status, "not-certified");
  assert.equal(intake.certification.normalUpdateAllowed, false);
});

test("intake fingerprint excludes volatile generation time and leaves the manifest untouched", () => {
  const manifestBefore = structuredClone(LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST);
  const input = intakeInput({ generatedAt: "2026-09-06T00:00:00.000Z" });
  const first = buildOpenClawCompatibilityIntake(input);
  const second = buildOpenClawCompatibilityIntake({ ...input, generatedAt: "2026-09-06T01:00:00.000Z" });

  assert.equal(first.intakeHash, second.intakeHash);
  assert.equal(first.certification.status, "not-certified");
  assert.equal(first.certification.normalUpdateAllowed, false);
  assert.deepEqual(LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST, manifestBefore);
});

test("issue rendering is deduplicated across open and closed issues and surfaces identity drift", async () => {
  const intake = buildOpenClawCompatibilityIntake(intakeInput());
  const body = renderOpenClawCompatibilityIssue(intake);
  const issue = { number: 42, html_url: "https://github.com/SapienXai/AgentOS/issues/42", title: "review", body, state: "closed" as const };
  let updateCount = 0;
  const client: GitHubIssueClient = {
    listIssues: async () => [issue],
    createIssue: async () => { throw new Error("create should not run"); },
    updateIssue: async (number, update) => {
      updateCount += 1;
      return { ...issue, number, body: update.body, state: "closed" };
    }
  };

  const unchanged = await syncOpenClawCompatibilityIssue({ intake, client });
  assert.equal(unchanged.action, "unchanged");
  assert.equal(updateCount, 0);

  const driftIdentity = { ...intake.identity, sourceCommit: "b".repeat(40), identityHash: "different-identity" };
  const driftIntake = buildOpenClawCompatibilityIntake({
    ...intakeInput(),
    identity: driftIdentity
  });
  const drift = await syncOpenClawCompatibilityIssue({ intake: driftIntake, client, dryRun: true });
  assert.equal(drift.action, "identity-drift");
  assert.equal(updateCount, 0);
  assert.match(renderOpenClawCompatibilityIssue(driftIntake, { identityDrift: true }), /IDENTITY_DRIFT/);
});

test("unmanifested releases remain blocked from normal updates and watcher code has no mutation path", () => {
  const decision = resolveOpenClawUpdateDecision({
    targetVersion: "2026.9.4",
    agentOsVersion: "0.8.0",
    manifest: LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST,
    mode: "recommended"
  });
  assert.equal(decision.status, "unknown");
  assert.equal(decision.allowed, false);

  const watcherSource = [
    readFileSync("scripts/openclaw-release-watch.ts", "utf8"),
    readFileSync("lib/openclaw/upstream/compatibility-intake.ts", "utf8"),
    readFileSync("lib/openclaw/upstream/github-issue-client.ts", "utf8")
  ].join("\n");
  assert.doesNotMatch(watcherSource, /update\.run|\/api\/update|spawn\(|isitstable\.iclaw\.digital|getOpenClawStabilitySnapshot/);
});

test("an exact certified target is not re-intaken while candidate and blocked targets remain reviewable", () => {
  const releases = [
    { version: "2026.9.2", tag: "v2026.9.2", prerelease: false, publishedAt: null, releaseUrl: null, source: "manual" as const },
    { version: "2026.9.3", tag: "v2026.9.3", prerelease: false, publishedAt: null, releaseUrl: null, source: "manual" as const },
    { version: "2026.9.10", tag: "v2026.9.10", prerelease: false, publishedAt: null, releaseUrl: null, source: "manual" as const }
  ];
  const manifest = {
    ...LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST,
    versions: [
      ...LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST.versions,
      { version: "2026.9.3", status: "candidate" as const },
      { version: "2026.9.10", status: "blocked" as const }
    ]
  };
  assert.deepEqual(
    selectOpenClawReleasesForIntake(releases, manifest).map((release) => release.version),
    ["2026.9.2", "2026.9.10"]
  );
});

test("GitHub issue client validates repository identity and sends only read/issue operations", async () => {
  const calls: Array<{ url: string; method: string }> = [];
  const client = createGitHubIssueClient({
    repository: "SapienXai/AgentOS",
    token: "test-token",
    fetchImpl: async (input, init) => {
      calls.push({ url: String(input), method: init?.method ?? "GET" });
      return jsonResponse([]);
    }
  });
  assert.deepEqual(await client.listIssues(), []);
  assert.equal(calls[0]?.method, "GET");
  assert.match(calls[0]?.url ?? "", /state=all/);
  assert.throws(() => createGitHubIssueClient({ repository: "not-a-repository", token: "test" }), /owner\/name/);
});

function historicalNineTwoSupplement(): OpenClawContractDiffSupplement {
  const evidence = JSON.parse(readFileSync("docs/evidence/openclaw-2026.9.1-to-2026.9.2-contract-diff.json", "utf8")) as {
    schemaChanges: Array<{ type?: string; method?: string; field?: string; event?: string }>;
    securityBehaviorChanges: Array<Record<string, unknown>>;
  };
  return {
    eventsAdded: evidence.schemaChanges
      .filter((change) => change.type === "event-added" && change.event)
      .map((change) => change.event as string),
    requiredFieldsAdded: evidence.schemaChanges
      .filter((change) => change.type === "response-field-added" && change.method && change.field)
      .map((change) => `${change.method}.${change.field}`),
    configDefaultsChanged: evidence.securityBehaviorChanges
      .map((change) => typeof change.setting === "string" ? change.setting : null)
      .filter((setting): setting is string => Boolean(setting)),
    securitySensitiveChanges: evidence.securityBehaviorChanges.map((change) =>
      `Historical 9.2 security behavior: ${typeof change.setting === "string" ? change.setting : typeof change.behavior === "string" ? change.behavior : "unspecified"}`
    ),
    requestSchemasChanged: evidence.schemaChanges
      .filter((change) => change.type === "request-field-added" && change.method && change.field)
      .map((change) => `${change.method}.${change.field}`),
    responseSchemasChanged: evidence.schemaChanges
      .filter((change) => change.type === "response-field-added" && change.method && change.field)
      .map((change) => `${change.method}.${change.field}`)
  };
}

function intakeInput(overrides: { generatedAt?: string } = {}) {
  return {
    generatedAt: overrides.generatedAt ?? "2026-09-06T00:00:00.000Z",
    intakeMode: "manual" as const,
    agentosCommit: "c".repeat(40),
    agentosVersion: "0.8.0",
    recommendedOpenClaw: "2026.9.2",
    supportedBaselineOpenClaw: "2026.9.1",
    nativeContractOpenClaw: "2026.9.2",
    identity: identityFor("2026.9.3"),
    contractDiff: buildFixtureContractDiff({
      fromVersion: "2026.9.2",
      targetVersion: "2026.9.3",
      currentSpecs: [method("health")],
      targetSpecs: [method("health"), method("models.list")]
    }),
    releaseNotes: buildOpenClawReleaseNotesEvidence({
      body: "A bounded compatibility review is required.",
      sourceUrl: "https://github.com/openclaw/openclaw/releases/tag/v2026.9.3"
    }),
    manifest: LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST
  };
}

function impactInput(overrides: {
  identity?: OpenClawReleaseIdentity;
  contractDiff?: OpenClawReleaseContractDiff;
} = {}) {
  return {
    identity: overrides.identity ?? identityFor("2026.9.3"),
    contractDiff: overrides.contractDiff ?? contractDiffFixture(),
    releaseNotes: buildOpenClawReleaseNotesEvidence({ body: "", sourceUrl: null })
  };
}

function contractDiffFixture(overrides: Partial<OpenClawReleaseContractDiff> = {}): OpenClawReleaseContractDiff {
  return {
    ...buildFixtureContractDiff({
      fromVersion: "2026.9.2",
      targetVersion: "2026.9.3",
      currentSpecs: [method("health")],
      targetSpecs: [method("health")]
    }),
    ...overrides
  };
}

function identityFor(version: string): OpenClawReleaseIdentity {
  return {
    status: "verified",
    version,
    tag: `v${version}`,
    sourceCommit: "a".repeat(40),
    buildId: `build-${version}`,
    packageVersion: version,
    packageIntegrity: "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA",
    gatewayProtocolPackage: { packageName: "@openclaw/gateway-protocol", version, integrity: null },
    gatewayClientPackage: { packageName: "@openclaw/gateway-client", version, integrity: null },
    publishedAt: "2026-09-03T00:00:00.000Z",
    releaseUrl: `https://github.com/openclaw/openclaw/releases/tag/v${version}`,
    tagUrl: `https://github.com/openclaw/openclaw/releases/tag/v${version}`,
    identityHash: `identity-${version}`,
    mismatches: [],
    missingEvidence: []
  };
}

function method(name: string, scope = "operator.read"): OpenClawCoreMethodSpec {
  return {
    name,
    family: null,
    scope,
    since: null,
    advertise: true,
    startup: false,
    controlPlaneWrite: false,
    compatibilityRestored: false,
    description: null
  };
}

function releaseRecord(version: string) {
  return {
    tag_name: `v${version}`,
    html_url: `https://github.com/openclaw/openclaw/releases/tag/v${version}`,
    published_at: `2026-09-${version.endsWith(".4") ? "04" : "03"}T00:00:00.000Z`,
    body: `OpenClaw ${version}`,
    draft: false
  };
}

function jsonFetch(records: Record<string, unknown>) {
  return async (input: string | URL | Request) => {
    const url = String(input);
    if (!(url in records)) throw new Error(`Unexpected fixture URL: ${url}`);
    return jsonResponse(records[url]);
  };
}

function identityFetch(input: { packageVersion: string; requestVersion?: string }) {
  const version = input.requestVersion ?? input.packageVersion;
  const sourceCommit = "a".repeat(40);
  const integrity = "sha512-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
  return jsonFetch({
    [`https://registry.npmjs.org/openclaw/${version}`]: {
      version: input.packageVersion,
      dist: { integrity },
      time: { [version]: "2026-09-03T00:00:00.000Z" }
    },
    [`https://registry.npmjs.org/%40openclaw%2Fgateway-protocol/${version}`]: { version, dist: { integrity } },
    [`https://registry.npmjs.org/%40openclaw%2Fgateway-client/${version}`]: { version, dist: { integrity } },
    [`https://api.github.com/repos/openclaw/openclaw/releases/tags/v${version}`]: {
      tag_name: `v${version}`,
      html_url: `https://github.com/openclaw/openclaw/releases/tag/v${version}`,
      published_at: "2026-09-03T00:00:00.000Z",
      body: "Security session update changes."
    },
    [`https://api.github.com/repos/openclaw/openclaw/git/ref/tags/v${version}`]: {
      object: { sha: sourceCommit, type: "commit" }
    },
    [`https://raw.githubusercontent.com/openclaw/openclaw/v${version}/dist/build-info.json`]: {
      buildId: `build-${version}`,
      version,
      commit: sourceCommit
    }
  });
}

function releaseWatchIncompleteContractFetch(version: string) {
  const verifiedSource = identityFetch({ packageVersion: version });
  return async (input: string | URL | Request) => {
    const url = String(input);
    if (url === npmDistTagsEndpoint) {
      return jsonResponse({ latest: version });
    }
    if (url === npmPackumentEndpoint) {
      return jsonResponse({
        versions: { "2026.9.2": {}, [version]: {} },
        time: { [version]: "2026-09-03T00:00:00.000Z" }
      });
    }
    if (url === releaseEndpoint) {
      return jsonResponse([releaseRecord(version)]);
    }
    if (url.includes("/src/gateway/methods/core-descriptors.ts") || url.includes(`/compare/v2026.9.3...v${version}`)) {
      return new Response(null, { status: 404 });
    }
    return verifiedSource(input);
  };
}

function jsonResponse(value: unknown) {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { "content-type": "application/json" }
  });
}
