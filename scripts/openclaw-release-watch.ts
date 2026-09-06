import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, writeFile, appendFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST
} from "@/lib/openclaw/update-compatibility";
import { getOpenClawManifestStatus } from "@/lib/openclaw/upstream/impact-classifier";
import {
  OPENCLAW_NATIVE_CONTRACT_VERSION,
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";
import { buildOpenClawCompatibilityIntake, renderOpenClawCompatibilityIssue } from "@/lib/openclaw/upstream/compatibility-intake";
import { getOpenClawReleaseContractDiff } from "@/lib/openclaw/upstream/contract-diff";
import { createGitHubIssueClient, syncOpenClawCompatibilityIssue, type GitHubIssueClient } from "@/lib/openclaw/upstream/github-issue-client";
import { discoverOfficialOpenClawReleases, assertValidOpenClawReleaseVersion, type ReleaseWatcherFetch } from "@/lib/openclaw/upstream/release-discovery";
import type { OpenClawCompatibilityManifest } from "@/lib/openclaw/update-compatibility";
import type { OpenClawReleaseCandidate } from "@/lib/openclaw/upstream/types";
import { verifyOfficialOpenClawRelease } from "@/lib/openclaw/upstream/release-identity";

const execFile = promisify(execFileCallback);

export type OpenClawReleaseWatchOptions = {
  mode?: "scheduled" | "manual";
  targetVersion?: string | null;
  includePrerelease?: boolean;
  dryRun?: boolean;
  forceRefresh?: boolean;
  outputDir?: string;
  githubToken?: string | null;
  githubRepository?: string | null;
  issueClient?: GitHubIssueClient;
  fetchImpl?: ReleaseWatcherFetch;
  agentosCommit?: string;
  agentosVersion?: string;
  now?: () => Date;
  recommendedVersion?: string;
  supportedBaselineVersion?: string;
  nativeContractVersion?: string;
  showHelp?: boolean;
};

export type OpenClawReleaseWatchResult = {
  status: "current" | "intake-generated" | "discovery-failed" | "backlog-truncated" | "intake-blocked";
  discovery: Awaited<ReturnType<typeof discoverOfficialOpenClawReleases>>;
  intakes: Array<{
    version: string;
    intakePath: string | null;
    contractDiffPath: string | null;
    issuePath: string | null;
    issueAction: string;
    intakeHash: string;
  }>;
  message: string;
};

export async function runOpenClawReleaseWatch(options: OpenClawReleaseWatchOptions = {}): Promise<OpenClawReleaseWatchResult> {
  const mode = options.mode ?? (options.targetVersion ? "manual" : "scheduled");
  const recommendedVersion = assertValidOpenClawReleaseVersion(
    options.recommendedVersion ?? OPENCLAW_RECOMMENDED_VERSION,
    "Recommended OpenClaw version"
  );
  const supportedBaselineVersion = assertValidOpenClawReleaseVersion(
    options.supportedBaselineVersion ?? OPENCLAW_SUPPORTED_BASELINE_VERSION,
    "Supported OpenClaw baseline version"
  );
  const nativeContractVersion = assertValidOpenClawReleaseVersion(
    options.nativeContractVersion ?? OPENCLAW_NATIVE_CONTRACT_VERSION,
    "Native OpenClaw contract version"
  );
  const targetVersion = options.targetVersion ? assertValidOpenClawReleaseVersion(options.targetVersion, "Target OpenClaw version") : null;
  const discovery = await discoverOfficialOpenClawReleases({
    currentRecommendedVersion: recommendedVersion,
    targetVersion,
    includePrerelease: options.includePrerelease,
    githubToken: options.githubToken,
    fetchImpl: options.fetchImpl
  });

  if (discovery.status === "discovery-failed") {
    await writeWatcherSummary(`## OpenClaw Release Watch\n\n**Status:** DISCOVERY_FAILED\n\n${safeSummary(discovery.error ?? "Official discovery failed.")}`, options);
    return { status: "discovery-failed", discovery, intakes: [], message: discovery.error ?? "Official discovery failed." };
  }

  const releasesForIntake = selectOpenClawReleasesForIntake(discovery.releases, LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST);
  if (releasesForIntake.length === 0) {
    const message = `OpenClaw upstream check\nAgentOS recommended: ${recommendedVersion}\nLatest official stable: ${discovery.latestStableVersion ?? "unknown"}\nStatus: current`;
    await writeWatcherSummary(`## OpenClaw Release Watch\n\n${message.replaceAll("\n", "\n\n")}`, options);
    return { status: "current", discovery, intakes: [], message };
  }

  const outputDir = options.outputDir ?? path.join(process.cwd(), ".openclaw-release-intake");
  await mkdir(outputDir, { recursive: true });
  const agentosCommit = options.agentosCommit ?? await readGitCommit();
  const agentosVersion = options.agentosVersion ?? await readAgentOsVersion();
  const issueClient = options.issueClient ?? createIssueClientFromEnvironment(options);
  const intakes: OpenClawReleaseWatchResult["intakes"] = [];
  let blockedIntakeCount = 0;
  let baseVersion = recommendedVersion;

  for (const release of releasesForIntake) {
    const verification = await verifyOfficialOpenClawRelease({
      version: release.version,
      githubToken: options.githubToken,
      fetchImpl: options.fetchImpl
    });
    const contractDiff = await getOpenClawReleaseContractDiff({
      fromVersion: baseVersion,
      targetVersion: release.version,
      fetchImpl: options.fetchImpl,
      bypassCache: options.forceRefresh
    });
    const intake = buildOpenClawCompatibilityIntake({
      generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      intakeMode: mode,
      agentosCommit,
      agentosVersion,
      recommendedOpenClaw: recommendedVersion,
      supportedBaselineOpenClaw: supportedBaselineVersion,
      nativeContractOpenClaw: nativeContractVersion,
      identity: verification.identity,
      contractDiff,
      releaseNotes: verification.releaseNotes,
      manifest: LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST
    });
    const intakePath = await writeArtifact(outputDir, `openclaw-${release.version}-intake.json`, intake);
    const contractDiffPath = await writeArtifact(outputDir, `openclaw-${release.version}-contract-diff.json`, contractDiff);
    const issuePath = await writeTextArtifact(outputDir, `openclaw-${release.version}-issue.md`, renderOpenClawCompatibilityIssue(intake));
    let issueAction = "not-requested";
    if (issueClient) {
      const issueResult = await syncOpenClawCompatibilityIssue({ intake, client: issueClient, dryRun: options.dryRun });
      issueAction = issueResult.action;
    }
    intakes.push({
      version: release.version,
      intakePath,
      contractDiffPath,
      issuePath,
      issueAction,
      intakeHash: intake.intakeHash
    });
    if (intake.identity.status !== "verified" || intake.contractDiff.status === "unknown" || intake.contractDiff.evidenceGaps.length > 0) {
      blockedIntakeCount += 1;
    }
    baseVersion = release.version;
  }

  const truncated = discovery.truncated;
  const status = truncated
    ? "backlog-truncated"
    : blockedIntakeCount > 0
      ? "intake-blocked"
      : "intake-generated";
  const message = truncated
    ? `Processed ${intakes.length} release(s), but ${discovery.remainingReleaseCount} additional release(s) remain outside the bounded intake limit.`
    : blockedIntakeCount > 0
      ? `Generated ${intakes.length} intake(s), but ${blockedIntakeCount} require additional authoritative evidence before review can proceed.`
    : `Generated ${intakes.length} OpenClaw compatibility intake(s).`;
  await writeWatcherSummary(buildWatcherSummary({ discovery, intakes, message }), options);
  return { status, discovery, intakes, message };
}

export function selectOpenClawReleasesForIntake(
  releases: OpenClawReleaseCandidate[],
  manifest: OpenClawCompatibilityManifest
) {
  return releases.filter((release) => getOpenClawManifestStatus({ manifest, version: release.version }).status !== "certified");
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.showHelp) return;
  const result = await runOpenClawReleaseWatch(options);
  console.log(result.message);
  if (result.status === "discovery-failed" || result.status === "backlog-truncated" || result.status === "intake-blocked") {
    process.exitCode = 1;
  }
}

function parseArgs(args: string[]): OpenClawReleaseWatchOptions {
  const options: OpenClawReleaseWatchOptions = {
    mode: process.env.GITHUB_EVENT_NAME === "workflow_dispatch" ? "manual" : "scheduled",
    targetVersion: process.env.OPENCLAW_WATCH_TARGET_VERSION?.trim() || null,
    includePrerelease: process.env.OPENCLAW_WATCH_INCLUDE_PRERELEASE === "true",
    dryRun: process.env.OPENCLAW_WATCH_DRY_RUN === "true",
    forceRefresh: process.env.OPENCLAW_WATCH_FORCE_REFRESH === "true",
    outputDir: process.env.OPENCLAW_WATCH_OUTPUT_DIR?.trim() || undefined,
    githubToken: process.env.GITHUB_TOKEN?.trim() || null,
    githubRepository: process.env.GITHUB_REPOSITORY?.trim() || null
  };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    const next = args[index + 1];
    if (arg === "--target") {
      if (!next || next.startsWith("-")) throw new Error("--target requires a valid OpenClaw version.");
      options.targetVersion = assertValidOpenClawReleaseVersion(next, "Target OpenClaw version");
      options.mode = "manual";
      index += 1;
    } else if (arg === "--include-prerelease") {
      options.includePrerelease = true;
    } else if (arg === "--dry-run") {
      options.dryRun = true;
    } else if (arg === "--force-refresh") {
      options.forceRefresh = true;
    } else if (arg === "--output-dir") {
      if (!next || next.startsWith("-")) throw new Error("--output-dir requires a path.");
      options.outputDir = path.resolve(next);
      index += 1;
    } else if (arg === "--help" || arg === "-h") {
      console.log("Usage: pnpm openclaw:release-watch [--target VERSION] [--include-prerelease] [--dry-run] [--force-refresh] [--output-dir PATH]");
      options.showHelp = true;
      return options;
    } else {
      throw new Error(`Unknown release watcher option: ${arg}`);
    }
  }
  if (options.targetVersion && options.mode !== "manual") options.mode = "manual";
  if (!options.githubToken) options.dryRun = true;
  return options;
}

function createIssueClientFromEnvironment(options: OpenClawReleaseWatchOptions) {
  if (options.dryRun) return null;
  if (!options.githubToken) throw new Error("GITHUB_TOKEN is required for non-dry-run issue synchronization.");
  if (!options.githubRepository) throw new Error("GITHUB_REPOSITORY is required for non-dry-run issue synchronization.");
  return createGitHubIssueClient({ repository: options.githubRepository, token: options.githubToken });
}

async function writeArtifact(outputDir: string, fileName: string, value: unknown) {
  const filePath = safeArtifactPath(outputDir, fileName);
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  return filePath;
}

async function writeTextArtifact(outputDir: string, fileName: string, value: string) {
  const filePath = safeArtifactPath(outputDir, fileName);
  await writeFile(filePath, `${value}\n`, "utf8");
  return filePath;
}

function safeArtifactPath(outputDir: string, fileName: string) {
  if (!/^openclaw-20\d{2}\.\d{1,2}\.\d{1,2}(?:-[0-9A-Za-z][0-9A-Za-z.-]*)?-(?:intake|contract-diff|issue)\.(?:json|md)$/.test(fileName)) {
    throw new Error("Release watcher artifact name is invalid.");
  }
  const resolvedDir = path.resolve(outputDir);
  const resolvedPath = path.resolve(resolvedDir, fileName);
  if (!resolvedPath.startsWith(`${resolvedDir}${path.sep}`)) throw new Error("Release watcher artifact path escaped its output directory.");
  return resolvedPath;
}

async function readGitCommit() {
  const result = await execFile("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), maxBuffer: 1_000_000 });
  const commit = result.stdout.trim();
  return /^[0-9a-f]{40}$/i.test(commit) ? commit : "unknown";
}

async function readAgentOsVersion() {
  const packageJson = JSON.parse(await readFile(path.join(process.cwd(), "packages/agentos/package.json"), "utf8")) as { version?: unknown };
  return typeof packageJson.version === "string" ? packageJson.version : "unknown";
}

async function writeWatcherSummary(summary: string, options: OpenClawReleaseWatchOptions) {
  const summaryPath = process.env.GITHUB_STEP_SUMMARY;
  if (summaryPath) await appendFile(summaryPath, `${summary}\n`, "utf8");
  if (options.outputDir) {
    await mkdir(options.outputDir, { recursive: true });
    await writeFile(path.join(options.outputDir, "openclaw-release-watch-summary.md"), `${summary}\n`, "utf8");
  }
}

function buildWatcherSummary(input: {
  discovery: Awaited<ReturnType<typeof discoverOfficialOpenClawReleases>>;
  intakes: OpenClawReleaseWatchResult["intakes"];
  message: string;
}) {
  return [
    "## OpenClaw Release Watch",
    "",
    `- AgentOS recommended: \`${input.discovery.currentRecommendedVersion}\``,
    `- Latest official stable: \`${input.discovery.latestStableVersion ?? "unknown"}\``,
    `- Discovered releases: ${input.discovery.releases.map((release) => `\`${release.version}\``).join(", ") || "none"}`,
    `- Result: ${input.message}`,
    ...input.intakes.map((intake) => `- ${intake.version}: intake generated; issue action **${intake.issueAction}**; evidence hash \`${intake.intakeHash}\``),
    "",
    "The watcher only creates compatibility-review evidence. Certification and version promotion remain human decisions."
  ].join("\n");
}

function safeSummary(value: string) {
  return value.replace(/[\u0000-\u001F\u007F]/g, " ").slice(0, 1_000);
}

if (process.argv[1]?.endsWith("openclaw-release-watch.ts")) {
  void main().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : "OpenClaw release watcher failed.");
    process.exitCode = 1;
  });
}
