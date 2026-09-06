import type { OpenClawCompatibilityIntake, OpenClawIssueSyncResult } from "@/lib/openclaw/upstream/types";
import {
  renderOpenClawCompatibilityIssue,
  renderOpenClawCompatibilityIssueAutoSection
} from "@/lib/openclaw/upstream/compatibility-intake";

const GITHUB_API_URL = "https://api.github.com";
const MAX_ISSUE_PAGES = 10;

type GitHubIssue = {
  number: number;
  html_url: string;
  title: string;
  body: string | null;
  state: "open" | "closed";
  pull_request?: unknown;
};

export type GitHubIssueFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export type GitHubIssueClient = {
  listIssues: () => Promise<GitHubIssue[]>;
  createIssue: (input: { title: string; body: string }) => Promise<GitHubIssue>;
  updateIssue: (number: number, input: { body: string }) => Promise<GitHubIssue>;
};

export function createGitHubIssueClient(input: {
  repository: string;
  token: string;
  fetchImpl?: GitHubIssueFetch;
}): GitHubIssueClient {
  const repository = validateRepository(input.repository);
  const fetchImpl = input.fetchImpl ?? fetch;
  const request = async (url: string, init: RequestInit = {}) => {
    const response = await fetchImpl(url, {
      ...init,
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${input.token}`,
        "User-Agent": "AgentOS-OpenClaw-Release-Watcher",
        ...(init.headers ?? {})
      }
    });
    if (!response.ok) {
      throw new Error(`GitHub issue API returned HTTP ${response.status}.`);
    }
    return response;
  };

  return {
    async listIssues() {
      const issues: GitHubIssue[] = [];
      for (let page = 1; page <= MAX_ISSUE_PAGES; page += 1) {
        const response = await request(`${GITHUB_API_URL}/repos/${repository}/issues?state=all&per_page=100&page=${page}`);
        const payload = await response.json() as unknown;
        if (!Array.isArray(payload)) throw new Error("GitHub issues API returned an unexpected shape.");
        const pageIssues = payload.filter(isGitHubIssue);
        issues.push(...pageIssues.filter((issue) => !issue.pull_request));
        if (pageIssues.length < 100) break;
      }
      return issues;
    },
    async createIssue(issue) {
      const response = await request(`${GITHUB_API_URL}/repos/${repository}/issues`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(issue)
      });
      return parseGitHubIssue(await response.json());
    },
    async updateIssue(number, issue) {
      if (!Number.isInteger(number) || number < 1) throw new Error("GitHub issue number is invalid.");
      const response = await request(`${GITHUB_API_URL}/repos/${repository}/issues/${number}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(issue)
      });
      return parseGitHubIssue(await response.json());
    }
  };
}

export async function syncOpenClawCompatibilityIssue(input: {
  intake: OpenClawCompatibilityIntake;
  client: GitHubIssueClient;
  dryRun?: boolean;
}): Promise<OpenClawIssueSyncResult> {
  const issues = await input.client.listIssues();
  const marker = `<!-- agentos-openclaw-intake:${input.intake.upstream.version} -->`;
  const existing = issues.find((issue) => issue.body?.includes(marker)) ?? null;
  if (!existing) {
    if (input.dryRun) {
      return { action: "would-create", issueNumber: null, issueUrl: null, message: "No existing issue matched; dry-run would create one." };
    }
    const created = await input.client.createIssue({
      title: `OpenClaw ${input.intake.upstream.version} — AgentOS Compatibility Intake`,
      body: renderOpenClawCompatibilityIssue(input.intake)
    });
    return { action: "created", issueNumber: created.number, issueUrl: created.html_url, message: "Created the single compatibility intake issue for this release." };
  }

  const existingHash = readMarker(existing.body, "agentos-openclaw-intake-hash");
  const existingIdentityHash = readMarker(existing.body, "agentos-openclaw-identity-hash");
  const identityDrift = Boolean(existingIdentityHash && existingIdentityHash !== input.intake.identity.identityHash);
  if (!identityDrift && existingHash === input.intake.intakeHash) {
    return { action: "unchanged", issueNumber: existing.number, issueUrl: existing.html_url, message: "Existing issue already contains the same verified intake evidence." };
  }

  const autoSection = renderOpenClawCompatibilityIssueAutoSection(input.intake, {
    identityDrift,
    previousIdentityHash: existingIdentityHash
  });
  const body = replaceAutoSection(existing.body ?? "", autoSection, renderOpenClawCompatibilityIssue(input.intake));
  if (input.dryRun) {
    return {
      action: identityDrift ? "identity-drift" : "would-update",
      issueNumber: existing.number,
      issueUrl: existing.html_url,
      message: identityDrift
        ? "Existing issue has identity drift; dry-run would surface an integrity warning without reopening it."
        : "Existing issue evidence changed; dry-run would refresh only the generated section."
    };
  }
  const updated = await input.client.updateIssue(existing.number, { body });
  return {
    action: identityDrift ? "identity-drift" : "updated",
    issueNumber: updated.number,
    issueUrl: updated.html_url,
    message: identityDrift
      ? "Updated the existing issue with an upstream identity-drift warning; issue state was not changed."
      : "Refreshed the generated evidence section on the existing issue."
  };
}

function replaceAutoSection(existingBody: string, autoSection: string, fallback: string) {
  const start = existingBody.indexOf("<!-- agentos-intake:auto:start -->");
  const endMarker = "<!-- agentos-intake:auto:end -->";
  const end = existingBody.indexOf(endMarker);
  if (start >= 0 && end >= start) {
    return `${existingBody.slice(0, start)}${autoSection}${existingBody.slice(end + endMarker.length)}`;
  }
  return existingBody.trim() ? `${existingBody.trim()}\n\n${autoSection}` : fallback;
}

function readMarker(body: string | null, name: string) {
  if (!body) return null;
  const match = new RegExp(`<!-- ${name}:([^>]+) -->`).exec(body);
  return match?.[1]?.trim() || null;
}

function validateRepository(value: string) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(value)) {
    throw new Error("GITHUB_REPOSITORY must use the owner/name form.");
  }
  return value;
}

function parseGitHubIssue(value: unknown): GitHubIssue {
  if (!isGitHubIssue(value)) throw new Error("GitHub issue API returned an unexpected issue shape.");
  return value;
}

function isGitHubIssue(value: unknown): value is GitHubIssue {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const issue = value as Partial<GitHubIssue>;
  return Number.isInteger(issue.number) &&
    typeof issue.html_url === "string" &&
    typeof issue.title === "string" &&
    (typeof issue.body === "string" || issue.body === null) &&
    (issue.state === "open" || issue.state === "closed");
}
