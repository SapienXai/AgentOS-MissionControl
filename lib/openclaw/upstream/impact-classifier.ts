import type { OpenClawCompatibilityManifest } from "@/lib/openclaw/update-compatibility";
import type {
  OpenClawCertificationCheck,
  OpenClawReleaseContractDiff,
  OpenClawReleaseIdentity,
  OpenClawReleaseImpact,
  OpenClawReleaseManifestStatus,
  OpenClawReleaseNotesEvidence
} from "@/lib/openclaw/upstream/types";

const MODULE_BY_DOMAIN: Record<string, string[]> = {
  agents: ["Agents", "Workspace"],
  channels: ["Channels", "Accounts and scopes"],
  config: ["Gateway configuration", "Fresh baseline"],
  gateway: ["Gateway protocol", "OpenClaw adapter"],
  "gateway-lifecycle": ["Gateway lifecycle", "Railway supervisor"],
  models: ["Models and providers"],
  protocol: ["Gateway protocol", "Native payload normalizers"],
  security: ["Security policy", "Gateway permissions"],
  sessions: ["Sessions", "Security bootstrap", "Multi-user boundary"],
  tasks: ["Tasks and automations"],
  tools: ["Tools and plugins"],
  updates: ["Operations Updates", "Native Doctor", "Update lifecycle"]
};

export function getOpenClawManifestStatus(input: {
  manifest: OpenClawCompatibilityManifest;
  version: string;
}): { status: OpenClawReleaseManifestStatus; exactEntry: boolean; reason: string | null } {
  const normalizedVersion = normalizeVersion(input.version);
  const entry = input.manifest.versions.find((candidate) => normalizeVersion(candidate.version) === normalizedVersion);
  return {
    status: entry?.status ?? "unknown",
    exactEntry: Boolean(entry),
    reason: entry?.reason ?? entry?.notes ?? null
  };
}

export function classifyOpenClawReleaseImpact(input: {
  identity: OpenClawReleaseIdentity;
  contractDiff: OpenClawReleaseContractDiff;
  releaseNotes: OpenClawReleaseNotesEvidence;
  manifestStatus?: OpenClawReleaseManifestStatus;
}): OpenClawReleaseImpact {
  const classifications = new Set<OpenClawReleaseImpact["classifications"][number]>();
  const rationale: string[] = [];
  const changedDomains = new Set(input.contractDiff.domainsChanged);
  const noteSignals = new Set(input.releaseNotes.signals);
  const identityEvidenceIncomplete = input.identity.status === "incomplete";
  const contractEvidenceIncomplete = input.contractDiff.status === "unknown" || input.contractDiff.evidenceGaps.length > 0;

  if (input.identity.status === "identity-mismatch") {
    classifications.add("IDENTITY_MISMATCH");
    rationale.push("Official npm, GitHub, tag, or build identity evidence disagrees.");
  }

  if (identityEvidenceIncomplete) {
    classifications.add("DISCOVERY_INCOMPLETE");
    rationale.push("The official release could not provide every supported identity evidence field.");
  }

  if (contractEvidenceIncomplete) {
    classifications.add("DISCOVERY_INCOMPLETE");
    rationale.push("Contract evidence is incomplete; the release cannot be promoted from static intake alone.");
  }

  if (input.contractDiff.securitySensitiveChanges.length > 0 || changedDomains.has("security") || noteSignals.has("security")) {
    classifications.add("SECURITY_CRITICAL");
    classifications.add("BEHAVIOR_CHANGE");
    rationale.push("Security-sensitive authorization, session, config, or runtime behavior requires explicit review.");
  }

  if (
    input.contractDiff.methodsRemoved.length > 0 ||
    input.contractDiff.requiredFieldsRemoved.length > 0 ||
    input.contractDiff.enumValuesRemoved.length > 0 ||
    input.contractDiff.configKeysRemoved.length > 0 ||
    input.contractDiff.status === "blocker" ||
    input.contractDiff.scopesChanged.length > 0 ||
    input.contractDiff.protocolChanged
  ) {
    classifications.add("BREAKING");
    rationale.push("Required Gateway methods, scopes, schemas, enums, config, or protocol evidence changed.");
  }

  if (
    input.contractDiff.sessionContractChanged ||
    input.contractDiff.updateContractChanged ||
    input.contractDiff.configDefaultsChanged.length > 0 ||
    noteSignals.has("sessions") ||
    noteSignals.has("updates") ||
    noteSignals.has("migration")
  ) {
    classifications.add("BEHAVIOR_CHANGE");
    rationale.push("Operational behavior or default semantics may have changed beyond the static method list.");
  }

  if (input.contractDiff.methodsAdded.length > 0 || input.contractDiff.eventsAdded.length > 0) {
    classifications.add("NEW_CAPABILITY");
    rationale.push("The upstream contract adds methods or events; AgentOS product scope is unchanged until reviewed.");
  }

  if (
    input.contractDiff.status !== "safe" ||
    input.contractDiff.changedFiles.length > 0 ||
    input.contractDiff.methodsAdded.length > 0 ||
    input.contractDiff.methodsRemoved.length > 0 ||
    input.contractDiff.securitySensitiveChanges.length > 0
  ) {
    classifications.add("COMPATIBILITY_REVIEW");
  }

  if (classifications.size === 0 && !identityEvidenceIncomplete && !contractEvidenceIncomplete) {
    classifications.add("NO_KNOWN_AGENTOS_IMPACT");
    classifications.add("LOW_RISK_ADDITIVE");
    rationale.push("No AgentOS-relevant contract or release-note signal was found in the bounded static evidence.");
  }

  if (input.manifestStatus === "unknown") {
    rationale.push("The target has no exact AgentOS compatibility-manifest entry and remains not certified.");
  } else if (input.manifestStatus === "candidate") {
    rationale.push("The target is already a candidate, but candidate status is not certification.");
  } else if (input.manifestStatus === "blocked") {
    rationale.push("The exact target is blocked by the AgentOS compatibility manifest.");
  }

  const domains = changedDomains;
  if (input.contractDiff.securitySensitiveChanges.length > 0) domains.add("security");
  if (input.contractDiff.updateContractChanged) domains.add("updates");
  if (input.contractDiff.sessionContractChanged) domains.add("sessions");
  if (input.contractDiff.protocolChanged) domains.add("protocol");

  return {
    severity: resolveSeverity(classifications),
    classifications: [...classifications].sort(),
    affectedAgentOsModules: unique([...domains].flatMap((domain) => MODULE_BY_DOMAIN[domain] ?? ["Compatibility Lab"])),
    changedDomains: [...domains].sort(),
    requiredChecks: buildCertificationPlan({ classifications, domains, contractDiff: input.contractDiff }),
    rationale
  };
}

export function buildCertificationPlan(input: {
  classifications: Set<OpenClawReleaseImpact["classifications"][number]> | OpenClawReleaseImpact["classifications"];
  domains: Set<string>;
  contractDiff: OpenClawReleaseContractDiff;
}): OpenClawCertificationCheck[] {
  const classifications = new Set(input.classifications);
  const checks = new Map<string, OpenClawCertificationCheck>();
  const add = (check: OpenClawCertificationCheck) => checks.set(check.id, check);

  add({
    id: "static-compatibility",
    label: "Run static OpenClaw contract compatibility",
    reason: "Confirm the bounded upstream contract diff and AgentOS normalizers remain interpretable.",
    commands: ["pnpm test -- tests/openclaw-update-contract-diff.test.ts tests/openclaw-gateway-first-contract.test.ts"]
  });

  if (input.domains.has("sessions") || input.domains.has("security") || classifications.has("SECURITY_CRITICAL")) {
    add({
      id: "session-security",
      label: "Run session and multi-user security certification",
      reason: "Session visibility, transcript reachability, users, tools, or authorization evidence changed.",
      commands: [
        "pnpm test -- tests/openclaw-session-security-policy.test.ts tests/openclaw-multi-user-boundary.test.ts tests/openclaw-multi-user-identity.test.ts",
        "pnpm openclaw:multi-user-e2e"
      ]
    });
    add({
      id: "shared-gateway-trust-review",
      label: "Review shared-Gateway trust boundary",
      reason: "The shared Gateway must remain a trusted-team boundary unless upstream identity policy proves stronger tenant isolation.",
      commands: ["docs/openclaw-2026.9.2-compatibility-audit.md"]
    });
  }

  if (input.domains.has("updates")) {
    add({
      id: "native-update-lifecycle",
      label: "Run native Doctor and update lifecycle certification",
      reason: "OpenClaw update.status, update.run, update.hold, or durable run evidence changed.",
      commands: [
        "pnpm test -- tests/openclaw-native-doctor-service.test.ts tests/openclaw-update-compatibility.test.ts tests/openclaw-normal-update-surface.test.ts",
        "pnpm openclaw:native-doctor-cert"
      ]
    });
    add({
      id: "reconnect-verification",
      label: "Run restart, reconnect, and target-version verification",
      reason: "Native update completion must be independently verified after Gateway lifecycle changes.",
      commands: ["pnpm test -- tests/openclaw-lifecycle.test.ts tests/openclaw-fresh-baseline.test.ts"]
    });
  }

  if (input.domains.has("gateway-lifecycle")) {
    add({
      id: "gateway-lifecycle",
      label: "Run Gateway lifecycle and supervisor certification",
      reason: "Restart, suspend, service ownership, or supervisor behavior changed.",
      commands: ["pnpm test -- tests/openclaw-lifecycle.test.ts tests/railway-deployment.test.ts"]
    });
  }

  if (input.domains.has("config")) {
    add({
      id: "fresh-baseline",
      label: "Run fresh baseline and config migration certification",
      reason: "Config schema, defaults, or migration semantics changed.",
      commands: ["pnpm openclaw:fresh-baseline-e2e", "pnpm openclaw:migration-e2e"]
    });
  }

  if (input.domains.has("models")) {
    add({
      id: "models",
      label: "Run model and provider contract tests",
      reason: "Model, provider, OAuth, or credential contract evidence changed.",
      commands: ["pnpm test -- tests/openclaw-model-provider-state-service.test.ts tests/model-catalog-projection.test.ts"]
    });
  }

  if (input.contractDiff.evidenceGaps.length > 0 || classifications.has("DISCOVERY_INCOMPLETE")) {
    add({
      id: "evidence-completion",
      label: "Complete missing upstream evidence",
      reason: "The static diff is bounded or missing an authoritative source; do not promote until resolved.",
      commands: ["pnpm openclaw:release-watch --target <version> --force-refresh"]
    });
  }

  return [...checks.values()];
}

function resolveSeverity(classifications: Set<OpenClawReleaseImpact["classifications"][number]>) {
  if (classifications.has("IDENTITY_MISMATCH") || classifications.has("UPSTREAM_RELEASE_IDENTITY_DRIFT") || classifications.has("SECURITY_CRITICAL")) return "critical" as const;
  if (classifications.has("BREAKING")) return "high" as const;
  if (classifications.has("DISCOVERY_INCOMPLETE")) return "unknown" as const;
  if (classifications.has("BEHAVIOR_CHANGE") || classifications.has("COMPATIBILITY_REVIEW")) return "medium" as const;
  return "low" as const;
}

function normalizeVersion(value: string) {
  return value.trim().replace(/^v/i, "");
}

function unique(values: string[]) {
  return [...new Set(values)].sort();
}
