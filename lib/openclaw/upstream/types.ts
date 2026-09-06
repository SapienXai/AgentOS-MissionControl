export type OpenClawReleaseMode = "scheduled" | "manual";

export type OpenClawReleaseIdentityStatus = "verified" | "incomplete" | "identity-mismatch";

export type OpenClawReleaseManifestStatus = "certified" | "candidate" | "blocked" | "unknown";

export type OpenClawReleaseCandidate = {
  version: string;
  tag: string;
  prerelease: boolean;
  publishedAt: string | null;
  releaseUrl: string | null;
  source: "npm" | "github" | "both" | "manual";
};

export type OpenClawReleaseDiscovery = {
  status: "ok" | "discovery-failed";
  currentRecommendedVersion: string;
  latestStableVersion: string | null;
  releases: OpenClawReleaseCandidate[];
  truncated: boolean;
  remainingReleaseCount: number;
  ignoredPrereleaseVersions: string[];
  npmLatestVersion: string | null;
  githubLatestVersion: string | null;
  error: string | null;
};

export type OpenClawReleasePackageIdentity = {
  packageName: "openclaw" | "@openclaw/gateway-protocol" | "@openclaw/gateway-client";
  version: string | null;
  integrity: string | null;
};

export type OpenClawReleaseIdentity = {
  status: OpenClawReleaseIdentityStatus;
  version: string;
  tag: string;
  sourceCommit: string | null;
  buildId: string | null;
  packageVersion: string | null;
  packageIntegrity: string | null;
  gatewayProtocolPackage: OpenClawReleasePackageIdentity;
  gatewayClientPackage: OpenClawReleasePackageIdentity;
  publishedAt: string | null;
  releaseUrl: string | null;
  tagUrl: string;
  identityHash: string;
  mismatches: string[];
  missingEvidence: string[];
};

export type OpenClawReleaseNotesEvidence = {
  sourceUrl: string | null;
  excerpt: string;
  signals: string[];
};

export type OpenClawReleaseContractDiff = {
  status: "safe" | "warning" | "blocker" | "unknown";
  source: "agentos-server-method-diff" | "fixture" | "unavailable";
  fromVersion: string;
  targetVersion: string;
  changedFiles: string[];
  methodsAdded: string[];
  methodsRemoved: string[];
  eventsAdded: string[];
  eventsRemoved: string[];
  scopesChanged: string[];
  requestSchemasChanged: string[];
  responseSchemasChanged: string[];
  requiredFieldsAdded: string[];
  requiredFieldsRemoved: string[];
  enumValuesAdded: string[];
  enumValuesRemoved: string[];
  configKeysAdded: string[];
  configKeysRemoved: string[];
  configDefaultsChanged: string[];
  protocolChanged: boolean;
  updateContractChanged: boolean;
  sessionContractChanged: boolean;
  securitySensitiveChanges: string[];
  domainsChanged: string[];
  evidenceGaps: string[];
  summary: string;
};

export type OpenClawReleaseImpactClassification =
  | "SECURITY_CRITICAL"
  | "BREAKING"
  | "BEHAVIOR_CHANGE"
  | "COMPATIBILITY_REVIEW"
  | "NEW_CAPABILITY"
  | "LOW_RISK_ADDITIVE"
  | "NO_KNOWN_AGENTOS_IMPACT"
  | "IDENTITY_MISMATCH"
  | "UPSTREAM_RELEASE_IDENTITY_DRIFT"
  | "DISCOVERY_INCOMPLETE";

export type OpenClawReleaseImpact = {
  severity: "critical" | "high" | "medium" | "low" | "unknown";
  classifications: OpenClawReleaseImpactClassification[];
  affectedAgentOsModules: string[];
  changedDomains: string[];
  requiredChecks: OpenClawCertificationCheck[];
  rationale: string[];
};

export type OpenClawCertificationCheck = {
  id: string;
  label: string;
  reason: string;
  commands: string[];
};

export type OpenClawCompatibilityIntake = {
  schemaVersion: 1;
  generatedAt: string;
  intakeMode: OpenClawReleaseMode;
  agentos: {
    commit: string;
    version: string;
    recommendedOpenClaw: string;
    supportedBaselineOpenClaw: string;
    nativeContractOpenClaw: string;
  };
  upstream: {
    version: string;
    tag: string;
    sourceCommit: string | null;
    buildId: string | null;
    packageIntegrity: string | null;
    gatewayProtocolPackage: string | null;
    gatewayClientPackage: string | null;
    publishedAt: string | null;
    releaseUrl: string | null;
  };
  identity: OpenClawReleaseIdentity;
  contractDiff: OpenClawReleaseContractDiff;
  releaseNotes: OpenClawReleaseNotesEvidence;
  manifest: {
    status: OpenClawReleaseManifestStatus;
    exactEntry: boolean;
    reason: string | null;
  };
  impact: OpenClawReleaseImpact;
  certification: {
    status: "not-certified";
    normalUpdateAllowed: false;
    requiredChecks: OpenClawCertificationCheck[];
    automaticActionsPerformed: string[];
  };
  intakeHash: string;
};

export type OpenClawIssueSyncResult = {
  action: "created" | "updated" | "unchanged" | "identity-drift" | "would-create" | "would-update";
  issueNumber: number | null;
  issueUrl: string | null;
  message: string;
};
