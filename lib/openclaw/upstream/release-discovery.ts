import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import type { OpenClawReleaseCandidate, OpenClawReleaseDiscovery } from "@/lib/openclaw/upstream/types";

export const OPENCLAW_UPSTREAM_REPOSITORY = "openclaw/openclaw";
export const OPENCLAW_NPM_REGISTRY_URL = "https://registry.npmjs.org";
export const OPENCLAW_GITHUB_API_URL = "https://api.github.com";
export const DEFAULT_OPENCLAW_RELEASE_BACKLOG_LIMIT = 10;

const OPENCLAW_VERSION_PATTERN = /^v?(20\d{2}\.\d{1,2}\.\d{1,2})(?:-([0-9A-Za-z][0-9A-Za-z.-]*))?$/;
const KNOWN_PRERELEASE_MARKERS = ["alpha", "beta", "canary", "dev", "nightly", "next", "preview", "rc"];
const MAX_RESPONSE_BYTES = 4_000_000;
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_GITHUB_RELEASE_PAGES = 5;
const GITHUB_RELEASES_PER_PAGE = 50;

export type ReleaseWatcherFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type ParsedOpenClawVersion = {
  version: string;
  year: number;
  month: number;
  day: number;
  suffix: string | null;
  prerelease: boolean;
};

export function parseOpenClawReleaseVersion(value: unknown): ParsedOpenClawVersion | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim().replace(/^openclaw\s+/i, "").replace(/^v/i, "");
  const match = OPENCLAW_VERSION_PATTERN.exec(normalized);
  if (!match) {
    return null;
  }

  const [, core, suffix] = match;
  const [year, month, day] = core.split(".").map((part) => Number.parseInt(part, 10));
  return {
    version: normalized,
    year,
    month,
    day,
    suffix: suffix ?? null,
    prerelease: Boolean(suffix)
  };
}

export function normalizeOpenClawReleaseVersion(value: unknown) {
  return parseOpenClawReleaseVersion(value)?.version ?? null;
}

export function assertValidOpenClawReleaseVersion(value: unknown, label = "OpenClaw version") {
  const normalized = normalizeOpenClawReleaseVersion(value);
  if (!normalized) {
    throw new Error(`${label} is invalid. Expected an OpenClaw release version such as 2026.9.3.`);
  }
  return normalized;
}

export function isKnownPrereleaseSuffix(suffix: string | null) {
  if (!suffix) {
    return false;
  }

  const tokens = suffix.toLowerCase().split(/[.-]/).filter(Boolean);
  return tokens.some((token) => KNOWN_PRERELEASE_MARKERS.includes(token));
}

export function isStableOpenClawRelease(value: unknown) {
  const parsed = parseOpenClawReleaseVersion(value);
  return Boolean(parsed && !parsed.prerelease);
}

export function compareOpenClawReleaseVersions(left: string, right: string) {
  const leftParsed = parseOpenClawReleaseVersion(left);
  const rightParsed = parseOpenClawReleaseVersion(right);
  if (!leftParsed || !rightParsed) {
    return compareVersionStrings(left, right);
  }

  const coreDelta = compareVersionStrings(
    `${leftParsed.year}.${leftParsed.month}.${leftParsed.day}`,
    `${rightParsed.year}.${rightParsed.month}.${rightParsed.day}`
  );
  if (coreDelta !== 0) {
    return coreDelta;
  }

  if (!leftParsed.suffix && !rightParsed.suffix) {
    return 0;
  }
  if (!leftParsed.suffix) {
    return 1;
  }
  if (!rightParsed.suffix) {
    return -1;
  }

  return comparePrereleaseTokens(leftParsed.suffix, rightParsed.suffix);
}

export async function discoverOfficialOpenClawReleases(input: {
  currentRecommendedVersion: string;
  targetVersion?: string | null;
  includePrerelease?: boolean;
  maxReleases?: number;
  githubToken?: string | null;
  fetchImpl?: ReleaseWatcherFetch;
}): Promise<OpenClawReleaseDiscovery> {
  const currentRecommendedVersion = assertValidOpenClawReleaseVersion(
    input.currentRecommendedVersion,
    "Current recommended OpenClaw version"
  );
  const includePrerelease = input.includePrerelease === true;
  const maxReleases = Math.max(1, Math.min(50, input.maxReleases ?? DEFAULT_OPENCLAW_RELEASE_BACKLOG_LIMIT));
  const fetchImpl = input.fetchImpl ?? fetch;
  const targetVersion = input.targetVersion
    ? assertValidOpenClawReleaseVersion(input.targetVersion, "Target OpenClaw version")
    : null;
  if (targetVersion && parseOpenClawReleaseVersion(targetVersion)?.prerelease && !includePrerelease) {
    throw new Error("Manual prerelease target requires --include-prerelease.");
  }

  try {
    const [npm, github] = await Promise.all([
      readNpmReleaseIndex({ fetchImpl, githubToken: input.githubToken }),
      readGitHubReleaseIndex({ fetchImpl, githubToken: input.githubToken })
    ]);
    const candidates = mergeReleaseCandidates(npm, github, {
      currentRecommendedVersion,
      targetVersion,
      includePrerelease
    });
    const latestStableVersion = [...new Set([...npm.versions, ...github.versions])]
      .filter((version) => isStableOpenClawRelease(version))
      .sort(compareOpenClawReleaseVersions)
      .at(-1) ?? null;
    const bounded = candidates.slice(0, maxReleases);

    return {
      status: "ok",
      currentRecommendedVersion,
      latestStableVersion,
      releases: bounded,
      truncated: candidates.length > bounded.length,
      remainingReleaseCount: Math.max(0, candidates.length - bounded.length),
      ignoredPrereleaseVersions: [...new Set([
        ...npm.versions.filter((version) => !isStableOpenClawRelease(version)),
        ...github.versions.filter((version) => !isStableOpenClawRelease(version))
      ])].sort(compareOpenClawReleaseVersions),
      npmLatestVersion: npm.latestVersion,
      githubLatestVersion: github.latestVersion,
      error: null
    };
  } catch (error) {
    return {
      status: "discovery-failed",
      currentRecommendedVersion,
      latestStableVersion: null,
      releases: [],
      truncated: false,
      remainingReleaseCount: 0,
      ignoredPrereleaseVersions: [],
      npmLatestVersion: null,
      githubLatestVersion: null,
      error: error instanceof Error && error.message.trim()
        ? error.message.trim()
        : "Official OpenClaw release discovery failed."
    };
  }
}

type ReleaseIndex = {
  versions: string[];
  latestVersion: string | null;
  metadata: Map<string, { publishedAt: string | null; releaseUrl: string | null; source: "npm" | "github" }>;
};

async function readNpmReleaseIndex(input: {
  fetchImpl: ReleaseWatcherFetch;
  githubToken?: string | null;
}): Promise<ReleaseIndex> {
  const [distTags, packageIndex] = await Promise.all([
    fetchJson(`${OPENCLAW_NPM_REGISTRY_URL}/-/package/openclaw/dist-tags`, input.fetchImpl, input.githubToken),
    fetchJson(`${OPENCLAW_NPM_REGISTRY_URL}/openclaw`, input.fetchImpl, input.githubToken)
  ]);
  const tags = asRecord(distTags);
  const packageRecord = asRecord(packageIndex);
  const versionsRecord = asRecord(packageRecord?.versions);
  const timeRecord = asRecord(packageRecord?.time);
  const versions = Object.keys(versionsRecord ?? {})
    .map((version) => normalizeOpenClawReleaseVersion(version))
    .filter((version): version is string => Boolean(version));
  const latestVersion = normalizeOpenClawReleaseVersion(tags?.latest) ?? null;
  const metadata = new Map<string, { publishedAt: string | null; releaseUrl: string | null; source: "npm" }>();

  for (const version of versions) {
    const publishedAt = typeof timeRecord?.[version] === "string" ? timeRecord[version] as string : null;
    metadata.set(version, { publishedAt, releaseUrl: `https://www.npmjs.com/package/openclaw/v/${version}`, source: "npm" });
  }
  if (latestVersion && !metadata.has(latestVersion)) {
    metadata.set(latestVersion, { publishedAt: null, releaseUrl: `https://www.npmjs.com/package/openclaw/v/${latestVersion}`, source: "npm" });
    versions.push(latestVersion);
  }

  return { versions: [...new Set(versions)], latestVersion, metadata };
}

async function readGitHubReleaseIndex(input: {
  fetchImpl: ReleaseWatcherFetch;
  githubToken?: string | null;
}): Promise<ReleaseIndex> {
  const releases: Array<Record<string, unknown>> = [];
  for (let page = 1; page <= MAX_GITHUB_RELEASE_PAGES; page += 1) {
    const payload = await fetchJson(
      `${OPENCLAW_GITHUB_API_URL}/repos/${OPENCLAW_UPSTREAM_REPOSITORY}/releases?per_page=${GITHUB_RELEASES_PER_PAGE}&page=${page}`,
      input.fetchImpl,
      input.githubToken
    );
    if (!Array.isArray(payload)) {
      throw new Error("Official OpenClaw GitHub releases returned an unexpected shape.");
    }
    const pageReleases = payload.filter(isRecord);
    releases.push(...pageReleases);
    if (pageReleases.length < GITHUB_RELEASES_PER_PAGE) {
      break;
    }
  }

  const versions: string[] = [];
  const metadata = new Map<string, { publishedAt: string | null; releaseUrl: string | null; source: "github" }>();
  for (const release of releases) {
    if (release.draft === true) {
      continue;
    }
    const version = normalizeOpenClawReleaseVersion(release.tag_name);
    if (!version) {
      continue;
    }
    versions.push(version);
    metadata.set(version, {
      publishedAt: readString(release.published_at) ?? readString(release.created_at),
      releaseUrl: readString(release.html_url),
      source: "github"
    });
  }

  const stableVersions = versions.filter((version) => isStableOpenClawRelease(version));
  return {
    versions: [...new Set(versions)],
    latestVersion: stableVersions.sort(compareOpenClawReleaseVersions).at(-1) ?? null,
    metadata
  };
}

function mergeReleaseCandidates(
  npm: ReleaseIndex,
  github: ReleaseIndex,
  input: { currentRecommendedVersion: string; targetVersion: string | null; includePrerelease: boolean }
) {
  const versions = new Set([...npm.versions, ...github.versions]);
  if (input.targetVersion) {
    versions.add(input.targetVersion);
  }

  return [...versions]
    .map((version): OpenClawReleaseCandidate | null => {
      const parsed = parseOpenClawReleaseVersion(version);
      if (!parsed) {
        return null;
      }
      const manual = version === input.targetVersion;
      if (!manual && compareOpenClawReleaseVersions(version, input.currentRecommendedVersion) <= 0) {
        return null;
      }
      if (!input.includePrerelease && !manual && parsed.prerelease) {
        return null;
      }
      const npmMetadata = npm.metadata.get(version);
      const githubMetadata = github.metadata.get(version);
      return {
        version,
        tag: `v${version}`,
        prerelease: parsed.prerelease,
        publishedAt: githubMetadata?.publishedAt ?? npmMetadata?.publishedAt ?? null,
        releaseUrl: githubMetadata?.releaseUrl ?? npmMetadata?.releaseUrl ?? null,
        source: manual
          ? "manual"
          : npmMetadata && githubMetadata
            ? "both"
            : npmMetadata
              ? "npm"
              : "github"
      };
    })
    .filter((candidate): candidate is OpenClawReleaseCandidate => Boolean(candidate))
    .sort((left, right) => compareOpenClawReleaseVersions(left.version, right.version));
}

function comparePrereleaseTokens(left: string, right: string) {
  const leftTokens = left.toLowerCase().split(/[.-]/).filter(Boolean);
  const rightTokens = right.toLowerCase().split(/[.-]/).filter(Boolean);
  const length = Math.max(leftTokens.length, rightTokens.length);
  for (let index = 0; index < length; index += 1) {
    const leftToken = leftTokens[index];
    const rightToken = rightTokens[index];
    if (leftToken === undefined) return -1;
    if (rightToken === undefined) return 1;
    if (leftToken === rightToken) continue;
    const leftNumber = /^\d+$/.test(leftToken) ? Number(leftToken) : null;
    const rightNumber = /^\d+$/.test(rightToken) ? Number(rightToken) : null;
    if (leftNumber !== null && rightNumber !== null) return leftNumber - rightNumber;
    if (leftNumber !== null) return -1;
    if (rightNumber !== null) return 1;
    return leftToken.localeCompare(rightToken);
  }
  return 0;
}

async function fetchJson(url: string, fetchImpl: ReleaseWatcherFetch, githubToken?: string | null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: {
        Accept: url === `${OPENCLAW_NPM_REGISTRY_URL}/openclaw`
          ? "application/vnd.npm.install-v1+json"
          : "application/json",
        "User-Agent": "AgentOS-OpenClaw-Release-Watcher",
        ...(githubToken && url.startsWith(OPENCLAW_GITHUB_API_URL) ? { Authorization: `Bearer ${githubToken}` } : {})
      }
    });
    if (!response.ok) {
      throw new Error(`Official OpenClaw metadata returned HTTP ${response.status}.`);
    }
    const contentLength = Number(response.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_RESPONSE_BYTES) {
      throw new Error("Official OpenClaw metadata exceeded the safe response size limit.");
    }
    const text = await response.text();
    if (text.length > MAX_RESPONSE_BYTES) {
      throw new Error("Official OpenClaw metadata exceeded the safe response size limit.");
    }
    return JSON.parse(text) as unknown;
  } finally {
    clearTimeout(timeout);
  }
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return isRecord(value) ? value : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function readString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
