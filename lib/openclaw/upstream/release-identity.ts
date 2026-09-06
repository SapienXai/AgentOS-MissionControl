import { createHash } from "node:crypto";

import {
  assertValidOpenClawReleaseVersion,
  OPENCLAW_GITHUB_API_URL,
  OPENCLAW_NPM_REGISTRY_URL,
  OPENCLAW_UPSTREAM_REPOSITORY,
  type ReleaseWatcherFetch
} from "@/lib/openclaw/upstream/release-discovery";
import { buildOpenClawReleaseNotesEvidence } from "@/lib/openclaw/upstream/release-notes";
import type {
  OpenClawReleaseIdentity,
  OpenClawReleaseNotesEvidence,
  OpenClawReleasePackageIdentity
} from "@/lib/openclaw/upstream/types";

const MAX_RESPONSE_BYTES = 4_000_000;
const MAX_BUILD_INFO_BYTES = 32_000;
const REQUEST_TIMEOUT_MS = 15_000;

export type OpenClawReleaseVerification = {
  identity: OpenClawReleaseIdentity;
  releaseNotes: OpenClawReleaseNotesEvidence;
};

export async function verifyOfficialOpenClawRelease(input: {
  version: string;
  githubToken?: string | null;
  fetchImpl?: ReleaseWatcherFetch;
}): Promise<OpenClawReleaseVerification> {
  const version = assertValidOpenClawReleaseVersion(input.version);
  const fetchImpl = input.fetchImpl ?? fetch;
  const tag = `v${version}`;
  const tagUrl = `https://github.com/${OPENCLAW_UPSTREAM_REPOSITORY}/releases/tag/${tag}`;
  const mismatches: string[] = [];
  const missingEvidence: string[] = [];

  const [npmPackage, protocolPackage, clientPackage, githubRelease, sourceCommit] = await Promise.all([
    fetchOptionalJson(`${OPENCLAW_NPM_REGISTRY_URL}/openclaw/${version}`, fetchImpl, input.githubToken),
    fetchOptionalJson(`${OPENCLAW_NPM_REGISTRY_URL}/%40openclaw%2Fgateway-protocol/${version}`, fetchImpl, input.githubToken),
    fetchOptionalJson(`${OPENCLAW_NPM_REGISTRY_URL}/%40openclaw%2Fgateway-client/${version}`, fetchImpl, input.githubToken),
    fetchOptionalJson(`${OPENCLAW_GITHUB_API_URL}/repos/${OPENCLAW_UPSTREAM_REPOSITORY}/releases/tags/${tag}`, fetchImpl, input.githubToken),
    resolveGitTagCommit(version, fetchImpl, input.githubToken)
  ]);

  const npmRecord = asRecord(npmPackage);
  const protocolRecord = asRecord(protocolPackage);
  const clientRecord = asRecord(clientPackage);
  const githubRecord = asRecord(githubRelease);
  const packageVersion = readString(npmRecord?.version);
  const packageIntegrity = readString(asRecord(npmRecord?.dist)?.integrity);
  const protocolIdentity = packageIdentity("@openclaw/gateway-protocol", protocolRecord);
  const clientIdentity = packageIdentity("@openclaw/gateway-client", clientRecord);
  const publishedAt = readString(asRecord(npmRecord?.time)?.[version]) ?? readString(githubRecord?.published_at);
  const releaseTag = readString(githubRecord?.tag_name);
  const releaseUrl = readString(githubRecord?.html_url) ?? tagUrl;
  const buildInfo = await fetchOptionalJson(
    `https://raw.githubusercontent.com/${OPENCLAW_UPSTREAM_REPOSITORY}/${tag}/dist/build-info.json`,
    fetchImpl,
    null,
    MAX_BUILD_INFO_BYTES
  );
  const buildRecord = asRecord(buildInfo);
  const buildId = readString(buildRecord?.buildId);
  const buildVersion = readString(buildRecord?.version);
  const buildCommit = readString(buildRecord?.commit);

  if (packageVersion && packageVersion !== version) {
    mismatches.push(`npm package version is ${packageVersion ?? "missing"}, expected ${version}.`);
  }
  if (releaseTag && normalizeTag(releaseTag) !== version) {
    mismatches.push(`GitHub release tag is ${releaseTag}, expected ${tag}.`);
  }
  if (buildVersion && normalizeTag(buildVersion) !== version) {
    mismatches.push(`Build metadata version is ${buildVersion}, expected ${version}.`);
  }
  if (buildCommit && sourceCommit && buildCommit !== sourceCommit) {
    mismatches.push("Build metadata commit does not match the resolved Git tag commit.");
  }
  if (sourceCommit && !/^[0-9a-f]{40}$/i.test(sourceCommit)) {
    mismatches.push("Resolved Git tag target is not a full commit SHA.");
  }
  if (packageIntegrity && !/^sha512-[A-Za-z0-9+/=]+$/.test(packageIntegrity)) {
    mismatches.push("npm package integrity is not a valid sha512 integrity value.");
  }

  if (!packageVersion) missingEvidence.push("npm package version");
  if (!packageIntegrity) missingEvidence.push("npm package integrity");
  if (!sourceCommit) missingEvidence.push("Git tag commit");
  if (!releaseTag) missingEvidence.push("GitHub release tag metadata");
  if (!protocolIdentity.version) missingEvidence.push("Gateway protocol package version");
  if (!clientIdentity.version) missingEvidence.push("Gateway client package version");

  const identityWithoutHash = {
    version,
    tag,
    sourceCommit,
    buildId,
    packageVersion,
    packageIntegrity,
    gatewayProtocolPackage: protocolIdentity,
    gatewayClientPackage: clientIdentity,
    publishedAt,
    releaseUrl,
    tagUrl,
    mismatches,
    missingEvidence
  };
  const identityHash = createHash("sha256")
    .update(stableStringify(identityWithoutHash))
    .digest("hex");
  const identity: OpenClawReleaseIdentity = {
    ...identityWithoutHash,
    status: mismatches.length > 0
      ? "identity-mismatch"
      : missingEvidence.length > 0
        ? "incomplete"
        : "verified",
    identityHash
  };

  return {
    identity,
    releaseNotes: buildOpenClawReleaseNotesEvidence({
      body: readString(githubRecord?.body),
      sourceUrl: releaseUrl
    })
  };
}

async function resolveGitTagCommit(version: string, fetchImpl: ReleaseWatcherFetch, githubToken?: string | null) {
  let tagObject = await fetchOptionalJson(
    `${OPENCLAW_GITHUB_API_URL}/repos/${OPENCLAW_UPSTREAM_REPOSITORY}/git/ref/tags/v${version}`,
    fetchImpl,
    githubToken
  );
  for (let depth = 0; depth < 3; depth += 1) {
    const object = asRecord(asRecord(tagObject)?.object);
    const sha = readString(object?.sha);
    const type = readString(object?.type);
    if (!sha) return null;
    if (type === "commit") return sha;
    if (type !== "tag") return null;
    tagObject = await fetchOptionalJson(
      `${OPENCLAW_GITHUB_API_URL}/repos/${OPENCLAW_UPSTREAM_REPOSITORY}/git/tags/${sha}`,
      fetchImpl,
      githubToken
    );
  }
  return null;
}

function packageIdentity(
  packageName: OpenClawReleasePackageIdentity["packageName"],
  record: Record<string, unknown> | null
): OpenClawReleasePackageIdentity {
  return {
    packageName,
    version: readString(record?.version),
    integrity: readString(asRecord(record?.dist)?.integrity)
  };
}

async function fetchJson(
  url: string,
  fetchImpl: ReleaseWatcherFetch,
  githubToken?: string | null,
  maxBytes = MAX_RESPONSE_BYTES
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: headersFor(url, githubToken)
    });
    if (!response.ok) {
      throw new Error(`Official OpenClaw identity source returned HTTP ${response.status}.`);
    }
    const text = await response.text();
    if (text.length > maxBytes) throw new Error("Official OpenClaw identity metadata exceeded the safe response size limit.");
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOptionalJson(
  url: string,
  fetchImpl: ReleaseWatcherFetch,
  githubToken?: string | null,
  maxBytes = MAX_RESPONSE_BYTES
) {
  try {
    return await fetchJson(url, fetchImpl, githubToken, maxBytes);
  } catch (error) {
    if (error instanceof Error && /HTTP 404/.test(error.message)) return null;
    if (url.startsWith(OPENCLAW_NPM_REGISTRY_URL) || url.includes("releases/tags") || url.includes("dist/build-info.json") || url.includes("git/ref") || url.includes("git/tags/")) return null;
    throw error;
  }
}

function headersFor(url: string, githubToken?: string | null) {
  return {
    Accept: url.startsWith(OPENCLAW_GITHUB_API_URL) ? "application/vnd.github+json" : "application/json",
    "User-Agent": "AgentOS-OpenClaw-Release-Watcher",
    ...(githubToken && url.startsWith(OPENCLAW_GITHUB_API_URL) ? { Authorization: `Bearer ${githubToken}` } : {})
  };
}

function normalizeTag(value: string) {
  return value.trim().replace(/^v/i, "").replace(/^openclaw\s+/i, "");
}

function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(",")}]`;
  if (!value || typeof value !== "object") return JSON.stringify(value);
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(",")}}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
