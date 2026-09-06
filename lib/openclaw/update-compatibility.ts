import {
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import type {
  OpenClawUpdateCompatibilityMode,
  OpenClawUpdateCompatibilitySnapshot,
  OpenClawUpdateCompatibilityStatus,
  OpenClawUpdateCompatibilityVersion,
  OpenClawUpdateDecision
} from "@/lib/openclaw/types";

export type OpenClawCompatibilityManifestVersion = {
  version: string;
  status: OpenClawUpdateCompatibilityStatus;
  minRequiredAgentOsVersion?: string | null;
  notes?: string | null;
  reason?: string | null;
};

export type OpenClawCompatibilityManifest = {
  schemaVersion: 1;
  source: "local-fallback" | "remote" | "override";
  recommendedVersion: string;
  minRequiredAgentOsVersion?: string | null;
  versions: OpenClawCompatibilityManifestVersion[];
};

export const LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST: OpenClawCompatibilityManifest = {
  schemaVersion: 1,
  source: "local-fallback",
  recommendedVersion: OPENCLAW_RECOMMENDED_VERSION,
  minRequiredAgentOsVersion: "0.7.2",
  versions: [
    ...(String(OPENCLAW_SUPPORTED_BASELINE_VERSION) === String(OPENCLAW_RECOMMENDED_VERSION) ? [] : [{
      version: OPENCLAW_SUPPORTED_BASELINE_VERSION,
      status: "certified" as const,
      minRequiredAgentOsVersion: "0.7.2",
      notes: "Certified stable baseline for AgentOS Gateway-first operation.",
      reason: "Validated against AgentOS compatibility diagnostics and runtime smoke coverage."
    }]),
    {
      version: OPENCLAW_RECOMMENDED_VERSION,
      status: "certified",
      minRequiredAgentOsVersion: "0.7.2",
      notes: "Recommended stable OpenClaw version for AgentOS Gateway-first operation.",
      reason: "Recommended for current AgentOS compatibility diagnostics and runtime smoke coverage."
    }
  ]
};

export function resolveOpenClawUpdateCompatibilitySnapshot(input: {
  manifest?: OpenClawCompatibilityManifest;
  agentOsVersion: string;
  currentVersion?: string | null;
  latestVersion?: string | null;
}): OpenClawUpdateCompatibilitySnapshot {
  const manifest = input.manifest ?? LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST;
  const agentOsVersion = normalizeVersion(input.agentOsVersion) ?? "0.0.0";
  const currentVersion = normalizeVersion(input.currentVersion);
  const latestVersion = normalizeVersion(input.latestVersion);
  const recommendedVersion = normalizeVersion(manifest.recommendedVersion) ?? OPENCLAW_RECOMMENDED_VERSION;
  const versions = normalizeManifestVersions(manifest);
  const recommendedDecision = resolveOpenClawUpdateDecision({
    manifest,
    agentOsVersion,
    targetVersion: recommendedVersion,
    mode: "recommended"
  });
  const latestDecision =
    latestVersion && latestVersion !== recommendedVersion
      ? resolveOpenClawUpdateDecision({
          manifest,
          agentOsVersion,
          targetVersion: latestVersion,
          mode: "recommended"
        })
      : latestVersion
        ? recommendedDecision
        : null;

  return {
    manifestSource: manifest.source,
    agentOsVersion,
    currentVersion,
    recommendedVersion,
    recommendedDecision,
    latestDecision,
    certifiedVersions: versions.filter((entry) => entry.status === "certified"),
    candidateVersions: versions.filter((entry) => entry.status === "candidate"),
    blockedVersions: versions.filter((entry) => entry.status === "blocked"),
    unknownVersions: versions.filter((entry) => entry.status === "unknown")
  };
}

export function resolveOpenClawUpdateDecision(input: {
  manifest?: OpenClawCompatibilityManifest;
  agentOsVersion: string;
  targetVersion: string;
  mode?: OpenClawUpdateCompatibilityMode;
}): OpenClawUpdateDecision {
  const manifest = input.manifest ?? LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST;
  const mode = input.mode ?? "recommended";
  const targetVersion = normalizeVersion(input.targetVersion) ?? input.targetVersion;
  const manifestEntry = findManifestVersion(manifest, targetVersion);
  const status = manifestEntry?.status ?? "unknown";
  const minRequiredAgentOsVersion =
    normalizeVersion(manifestEntry?.minRequiredAgentOsVersion) ??
    normalizeVersion(manifest.minRequiredAgentOsVersion);
  const belowSupportedBaseline =
    compareVersionStrings(targetVersion, OPENCLAW_SUPPORTED_BASELINE_VERSION) < 0;
  const requiresAgentOsUpdate = Boolean(
    minRequiredAgentOsVersion &&
      compareVersionStrings(normalizeVersion(input.agentOsVersion) ?? "0.0.0", minRequiredAgentOsVersion) < 0
  );
  const notes = manifestEntry?.notes?.trim() || null;
  const configuredReason = manifestEntry?.reason?.trim() || null;

  if (belowSupportedBaseline) {
    return {
      version: targetVersion,
      status: "blocked",
      allowed: false,
      defaultVisible: false,
      requiresExplicitOptIn: false,
      requiresAgentOsUpdate: false,
      minRequiredAgentOsVersion,
      reason: `AgentOS requires OpenClaw ${OPENCLAW_SUPPORTED_BASELINE_VERSION} or newer.`,
      notes: notes || "OpenClaw versions below the AgentOS required baseline are unsupported."
    };
  }

  if (requiresAgentOsUpdate) {
    return {
      version: targetVersion,
      status,
      allowed: false,
      defaultVisible: false,
      requiresExplicitOptIn: status === "candidate" || status === "unknown",
      requiresAgentOsUpdate: true,
      minRequiredAgentOsVersion,
      reason: `OpenClaw ${targetVersion} requires AgentOS ${minRequiredAgentOsVersion} or newer.`,
      notes
    };
  }

  if (status === "blocked") {
    return {
      version: targetVersion,
      status,
      allowed: false,
      defaultVisible: false,
      requiresExplicitOptIn: false,
      requiresAgentOsUpdate: false,
      minRequiredAgentOsVersion,
      reason: configuredReason || `OpenClaw ${targetVersion} is blocked by the AgentOS compatibility manifest.`,
      notes
    };
  }

  if (status === "candidate") {
    return {
      version: targetVersion,
      status,
      allowed: mode === "candidate" || mode === "advanced",
      defaultVisible: true,
      requiresExplicitOptIn: true,
      requiresAgentOsUpdate: false,
      minRequiredAgentOsVersion,
      reason:
        mode === "candidate" || mode === "advanced"
          ? configuredReason || "Preview update allowed after explicit opt-in and compatibility preflight."
          : configuredReason || "Preview updates require explicit opt-in and compatibility preflight.",
      notes
    };
  }

  if (status === "unknown") {
    return {
      version: targetVersion,
      status,
      allowed: mode === "advanced",
      defaultVisible: false,
      requiresExplicitOptIn: true,
      requiresAgentOsUpdate: false,
      minRequiredAgentOsVersion,
      reason:
        mode === "advanced"
          ? "Unknown OpenClaw version allowed only through advanced update mode."
          : "Unknown OpenClaw versions are hidden from the default update path.",
      notes: notes || "This version is not present in the AgentOS compatibility manifest."
    };
  }

  return {
    version: targetVersion,
    status: "certified",
    allowed: true,
    defaultVisible: true,
    requiresExplicitOptIn: false,
    requiresAgentOsUpdate: false,
    minRequiredAgentOsVersion,
    reason: configuredReason || "Certified OpenClaw version is allowed for normal update.",
    notes
  };
}

export function shouldShowDefaultOpenClawUpdate(input: {
  currentVersion?: string | null;
  decision: OpenClawUpdateDecision;
}) {
  const currentVersion = normalizeVersion(input.currentVersion);

  if (!input.decision.allowed || !input.decision.defaultVisible) {
    return false;
  }

  return Boolean(!currentVersion || compareVersionStrings(input.decision.version, currentVersion) !== 0);
}

function normalizeManifestVersions(
  manifest: OpenClawCompatibilityManifest
): OpenClawUpdateCompatibilityVersion[] {
  const entries = manifest.versions.map((entry) => ({
    version: normalizeVersion(entry.version) ?? entry.version,
    status: entry.status,
    minRequiredAgentOsVersion:
      normalizeVersion(entry.minRequiredAgentOsVersion) ?? normalizeVersion(manifest.minRequiredAgentOsVersion),
    notes: entry.notes?.trim() || null,
    reason: entry.reason?.trim() || null
  }));
  const hasRecommended = entries.some((entry) => entry.version === normalizeVersion(manifest.recommendedVersion));

  if (!hasRecommended) {
    entries.push({
      version: normalizeVersion(manifest.recommendedVersion) ?? manifest.recommendedVersion,
      status: "unknown",
      minRequiredAgentOsVersion: normalizeVersion(manifest.minRequiredAgentOsVersion),
      notes: null,
      reason: "Recommended version is missing from the compatibility manifest."
    });
  }

  return entries;
}

function findManifestVersion(manifest: OpenClawCompatibilityManifest, version: string) {
  const normalizedVersion = normalizeVersion(version);

  return manifest.versions.find((entry) => normalizeVersion(entry.version) === normalizedVersion);
}

function normalizeVersion(value: string | null | undefined) {
  const normalized = value?.trim().replace(/^v/i, "");
  return normalized || null;
}
