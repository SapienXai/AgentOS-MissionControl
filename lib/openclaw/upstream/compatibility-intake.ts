import { createHash } from "node:crypto";

import {
  classifyOpenClawReleaseImpact,
  getOpenClawManifestStatus
} from "@/lib/openclaw/upstream/impact-classifier";
import { sanitizeIssueText } from "@/lib/openclaw/upstream/release-notes";
import type { OpenClawCompatibilityManifest } from "@/lib/openclaw/update-compatibility";
import type {
  OpenClawCompatibilityIntake,
  OpenClawReleaseContractDiff,
  OpenClawReleaseIdentity,
  OpenClawReleaseMode,
  OpenClawReleaseNotesEvidence
} from "@/lib/openclaw/upstream/types";

export function buildOpenClawCompatibilityIntake(input: {
  generatedAt?: string;
  intakeMode: OpenClawReleaseMode;
  agentosCommit: string;
  agentosVersion: string;
  recommendedOpenClaw: string;
  supportedBaselineOpenClaw: string;
  nativeContractOpenClaw: string;
  identity: OpenClawReleaseIdentity;
  contractDiff: OpenClawReleaseContractDiff;
  releaseNotes: OpenClawReleaseNotesEvidence;
  manifest: OpenClawCompatibilityManifest;
}): OpenClawCompatibilityIntake {
  const manifestStatus = getOpenClawManifestStatus({
    manifest: input.manifest,
    version: input.identity.version
  });
  const impact = classifyOpenClawReleaseImpact({
    identity: input.identity,
    contractDiff: input.contractDiff,
    releaseNotes: input.releaseNotes,
    manifestStatus: manifestStatus.status
  });
  const base = {
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt ?? new Date().toISOString(),
    intakeMode: input.intakeMode,
    agentos: {
      commit: input.agentosCommit,
      version: input.agentosVersion,
      recommendedOpenClaw: input.recommendedOpenClaw,
      supportedBaselineOpenClaw: input.supportedBaselineOpenClaw,
      nativeContractOpenClaw: input.nativeContractOpenClaw
    },
    upstream: {
      version: input.identity.version,
      tag: input.identity.tag,
      sourceCommit: input.identity.sourceCommit,
      buildId: input.identity.buildId,
      packageIntegrity: input.identity.packageIntegrity,
      gatewayProtocolPackage: formatPackageIdentity(input.identity.gatewayProtocolPackage),
      gatewayClientPackage: formatPackageIdentity(input.identity.gatewayClientPackage),
      publishedAt: input.identity.publishedAt,
      releaseUrl: input.identity.releaseUrl
    },
    identity: input.identity,
    contractDiff: input.contractDiff,
    releaseNotes: input.releaseNotes,
    manifest: manifestStatus,
    impact,
    certification: {
      status: "not-certified" as const,
      normalUpdateAllowed: false as const,
      requiredChecks: impact.requiredChecks,
      automaticActionsPerformed: [
        "No AgentOS version policy was changed.",
        "No compatibility manifest entry was written.",
        "No Gateway or runtime mutation was performed.",
        "No Docker or Railway pin was changed.",
        "No deployment, publish, or merge was performed."
      ]
    }
  };
  const { generatedAt, ...fingerprintBase } = base;
  void generatedAt;
  const intakeHash = createHash("sha256")
    .update(stableStringify(fingerprintBase))
    .digest("hex");
  return { ...base, intakeHash };
}

export function renderOpenClawCompatibilityIssue(
  intake: OpenClawCompatibilityIntake,
  options: { identityDrift?: boolean; previousIdentityHash?: string | null } = {}
) {
  const marker = `<!-- agentos-openclaw-intake:${intake.upstream.version} -->`;
  const autoSection = renderOpenClawCompatibilityIssueAutoSection(intake, options);
  return [marker, autoSection].join("\n\n");
}

export function renderOpenClawCompatibilityIssueAutoSection(
  intake: OpenClawCompatibilityIntake,
  options: { identityDrift?: boolean; previousIdentityHash?: string | null } = {}
) {
  const classifications = options.identityDrift
    ? [...new Set(["UPSTREAM_RELEASE_IDENTITY_DRIFT", ...intake.impact.classifications])]
    : intake.impact.classifications;
  const title = `# OpenClaw ${intake.upstream.version} Compatibility Review`;
  const checks = intake.certification.requiredChecks.length > 0
    ? intake.certification.requiredChecks.map((check) => [
        `- [ ] ${sanitizeIssueText(check.label)}`,
        `  - Reason: ${sanitizeIssueText(check.reason)}`,
        ...check.commands.map((command) => `  - Command/reference: \`${sanitizeIssueText(command).replace(/`/g, "'")}\``)
      ].join("\n")).join("\n")
    : "- [ ] Decide the reduced certification scope from the static evidence.";
  const notes = intake.releaseNotes.excerpt
    ? `<details>\n<summary>Bounded upstream release-note excerpt</summary>\n\n${formatReleaseNoteExcerpt(intake.releaseNotes.excerpt)}\n\n</details>`
    : "No release-note body was available from the official GitHub release.";
  const drift = options.identityDrift
    ? [
        "## Integrity warning",
        "",
        "`UPSTREAM_RELEASE_IDENTITY_DRIFT`: this release version was previously ingested with different identity evidence.",
        `Previous identity hash: \`${sanitizeIssueText(options.previousIdentityHash ?? "unknown")}\``,
        "Do not certify or promote this release until the upstream discrepancy is resolved."
      ].join("\n")
    : "";

  return [
    "<!-- agentos-intake:auto:start -->",
    title,
    "",
    `<!-- agentos-openclaw-intake-hash:${intake.intakeHash} -->`,
    `<!-- agentos-openclaw-identity-hash:${intake.identity.identityHash} -->`,
    `**Status:** NOT CERTIFIED  \n**Risk:** ${classifications.join(" + ")}  \n**Static severity:** ${intake.impact.severity.toUpperCase()}`,
    "",
    "## Current AgentOS policy",
    `- Recommended OpenClaw: \`${sanitizeIssueText(intake.agentos.recommendedOpenClaw)}\``,
    `- Supported minimum: \`${sanitizeIssueText(intake.agentos.supportedBaselineOpenClaw)}\``,
    `- Native contract target: \`${sanitizeIssueText(intake.agentos.nativeContractOpenClaw)}\``,
    `- Exact manifest status for this release: **${intake.manifest.status}**${intake.manifest.reason ? ` — ${sanitizeIssueText(intake.manifest.reason)}` : ""}`,
    "",
    "## Upstream identity",
    `- Version: \`${sanitizeIssueText(intake.upstream.version)}\``,
    `- Tag: \`${sanitizeIssueText(intake.upstream.tag)}\``,
    `- Source commit: \`${sanitizeIssueText(intake.upstream.sourceCommit ?? "unavailable")}\``,
    `- Build ID: \`${sanitizeIssueText(intake.upstream.buildId ?? "unavailable")}\``,
    `- Package integrity: \`${sanitizeIssueText(intake.upstream.packageIntegrity ?? "unavailable")}\``,
    `- Gateway protocol package: \`${sanitizeIssueText(intake.upstream.gatewayProtocolPackage ?? "unavailable")}\``,
    `- Gateway client package: \`${sanitizeIssueText(intake.upstream.gatewayClientPackage ?? "unavailable")}\``,
    `- Published: \`${sanitizeIssueText(intake.upstream.publishedAt ?? "unavailable")}\``,
    `- Release: ${sanitizeIssueText(intake.upstream.releaseUrl ?? "unavailable")}`,
    `- Identity verification: **${intake.identity.status}**`,
    ...(intake.identity.mismatches.length > 0 ? ["- Identity mismatches:", ...intake.identity.mismatches.map((value) => `  - ${sanitizeIssueText(value)}`)] : []),
    ...(intake.identity.missingEvidence.length > 0 ? ["- Missing evidence:", ...intake.identity.missingEvidence.map((value) => `  - ${sanitizeIssueText(value)}`)] : []),
    "",
    "## Contract evidence",
    `- Methods added: ${formatValues(intake.contractDiff.methodsAdded)}`,
    `- Methods removed: ${formatValues(intake.contractDiff.methodsRemoved)}`,
    `- Scope changes: ${formatValues(intake.contractDiff.scopesChanged)}`,
    `- Request/response schema changes: ${formatValues([...intake.contractDiff.requestSchemasChanged, ...intake.contractDiff.responseSchemasChanged])}`,
    `- Config/default changes: ${formatValues([...intake.contractDiff.configKeysAdded, ...intake.contractDiff.configKeysRemoved, ...intake.contractDiff.configDefaultsChanged])}`,
    `- Protocol changed: **${intake.contractDiff.protocolChanged ? "yes" : "no"}**`,
    `- Durable/update contract changed: **${intake.contractDiff.updateContractChanged ? "yes" : "no"}**`,
    `- Session contract changed: **${intake.contractDiff.sessionContractChanged ? "yes" : "no"}**`,
    `- Changed files observed: ${intake.contractDiff.changedFiles.length}`,
    ...(intake.contractDiff.evidenceGaps.length > 0 ? ["- Evidence gaps:", ...intake.contractDiff.evidenceGaps.map((value) => `  - ${sanitizeIssueText(value)}`)] : []),
    "",
    "## AgentOS impact",
    `- Affected modules: ${formatValues(intake.impact.affectedAgentOsModules)}`,
    `- Changed domains: ${formatValues(intake.impact.changedDomains)}`,
    ...intake.impact.rationale.map((value) => `- ${sanitizeIssueText(value)}`),
    "",
    "## Release-note signals",
    `- Signals: ${formatValues(intake.releaseNotes.signals)}`,
    notes,
    "",
    "## Required certification",
    checks,
    "",
    "## Automatic actions not performed",
    ...intake.certification.automaticActionsPerformed.map((value) => `- ${sanitizeIssueText(value)}`),
    "",
    "Certification remains an explicit human-reviewed Compatibility Lab decision. Closing this issue does not change the AgentOS compatibility manifest.",
    drift,
    "<!-- agentos-intake:auto:end -->"
  ].join("\n");
}

function formatPackageIdentity(identity: OpenClawReleaseIdentity["gatewayProtocolPackage"]) {
  return identity.version ? `${identity.packageName}@${identity.version}` : null;
}

function formatValues(values: string[]) {
  return values.length > 0 ? values.map((value) => `\`${sanitizeIssueText(value).replace(/`/g, "'")}\``).join(", ") : "none observed";
}

function formatReleaseNoteExcerpt(value: string) {
  return value
    .split("\n")
    .map((line) => `> ${sanitizeIssueText(line)}`)
    .join("\n");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}
