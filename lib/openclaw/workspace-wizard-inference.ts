import { compactPath } from "@/lib/openclaw/presenters";
import type {
  WorkspacePlan,
  WorkspaceSourceMode,
  WorkspaceTemplate
} from "@/lib/openclaw/types";

export type WorkspaceWizardBasicDraft = {
  name: string;
  goal: string;
  source: string;
};

export type WorkspaceWizardSourceAnalysis = {
  kind: "empty" | "clone" | "existing" | "website" | "context";
  createSourceMode: WorkspaceSourceMode;
  label: string;
  hint: string;
  repoUrl?: string;
  existingPath?: string;
  websiteUrl?: string;
  contextText?: string;
};

const ignoredNameTokens = new Set([
  "a",
  "an",
  "and",
  "autonomous",
  "automate",
  "automated",
  "automation",
  "build",
  "create",
  "for",
  "from",
  "in",
  "launch",
  "new",
  "of",
  "on",
  "project",
  "run",
  "runs",
  "set",
  "setup",
  "start",
  "that",
  "the",
  "to",
  "up",
  "workspace",
  "adı",
  "agent",
  "ajan",
  "asistan",
  "benim",
  "bide",
  "bir",
  "birde",
  "de",
  "diye",
  "ekleyelim",
  "gibi",
  "için",
  "olarak",
  "olsun",
  "proje",
  "şahsi",
  "verelim",
  "yeni"
]);

export function createInitialWorkspaceWizardBasicDraft(): WorkspaceWizardBasicDraft {
  return {
    name: "",
    goal: "",
    source: ""
  };
}

export function analyzeWorkspaceWizardSourceInput(rawValue: string): WorkspaceWizardSourceAnalysis {
  const trimmed = rawValue.trim();

  if (!trimmed) {
    return {
      kind: "empty",
      createSourceMode: "empty",
      label: "Fresh workspace",
      hint: "AgentOS will scaffold a new project folder."
    };
  }

  if (isLikelyExistingPath(trimmed)) {
    return {
      kind: "existing",
      createSourceMode: "existing",
      label: "Existing folder",
      hint: trimmed,
      existingPath: trimmed
    };
  }

  if (isLikelySshRepositoryUrl(trimmed)) {
    return {
      kind: "clone",
      createSourceMode: "clone",
      label: "Clone repository",
      hint: trimmed,
      repoUrl: trimmed
    };
  }

  const normalizedUrl = normalizeUrlCandidate(trimmed);

  if (normalizedUrl) {
    if (isLikelyRepositoryUrl(normalizedUrl)) {
      return {
        kind: "clone",
        createSourceMode: "clone",
        label: "Clone repository",
        hint: normalizedUrl,
        repoUrl: normalizedUrl
      };
    }

    return {
      kind: "website",
      createSourceMode: "empty",
      label: "Fresh workspace + website",
      hint: normalizedUrl,
      websiteUrl: normalizedUrl
    };
  }

  return {
    kind: "context",
    createSourceMode: "empty",
    label: "Fresh workspace + context",
    hint: "The pasted source will be attached to the brief.",
    contextText: trimmed
  };
}

export function inferWorkspaceWizardTemplate(text: string): WorkspaceTemplate {
  const lower = text.toLowerCase();

  if (/\b(telegram|discord|community|channel automation|campaign|content|marketing|growth|seo|newsletter)\b/.test(lower)) {
    return "content";
  }

  if (/\b(frontend|ui|website|landing page|design system|dashboard)\b/.test(lower)) {
    return "frontend";
  }

  if (/\b(backend|api|service|microservice|worker|cron|queue|sdk)\b/.test(lower)) {
    return "backend";
  }

  if (/\b(research|investigation|analysis|benchmark|thesis)\b/.test(lower)) {
    return "research";
  }

  return "software";
}

export function inferWorkspaceWizardName(source: string, goal: string) {
  const sourceName = inferNameFromSource(source);

  if (sourceName) {
    return sourceName;
  }

  const quotedName = extractExplicitGoalName(goal);
  if (quotedName) {
    return quotedName;
  }

  const tokens = goal
    .toLowerCase()
    .replace(/[^a-z0-9\s-]+/g, " ")
    .split(/\s+/)
    .map((part) => part.trim())
    .filter((part) => part && !ignoredNameTokens.has(part))
    .slice(0, 4);

  if (tokens.length === 0) {
    return "";
  }

  return tokens
    .map((token) => token.charAt(0).toUpperCase() + token.slice(1))
    .join(" ");
}

export function resolveWorkspaceWizardName(draft: WorkspaceWizardBasicDraft) {
  return draft.name.trim() || inferWorkspaceWizardName(draft.source, draft.goal) || "New Workspace";
}

export function buildWorkspaceWizardPathPreview(
  workspaceRoot: string,
  draft: WorkspaceWizardBasicDraft,
  sourceAnalysis = analyzeWorkspaceWizardSourceInput(draft.source)
) {
  if (sourceAnalysis.kind === "existing" && sourceAnalysis.existingPath) {
    return sourceAnalysis.existingPath;
  }

  const slug = resolveWorkspaceWizardName(draft)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return `${compactPath(workspaceRoot)}/${slug || "workspace"}`;
}

export function extractBasicDraftFromWorkspacePlan(plan: WorkspacePlan): WorkspaceWizardBasicDraft {
  const source =
    plan.workspace.repoUrl?.trim() ||
    plan.workspace.existingPath?.trim() ||
    plan.intake.sources.find((entry) => entry.kind === "website")?.url ||
    plan.intake.sources.find((entry) => entry.kind === "prompt")?.summary ||
    "";

  return {
    name: plan.workspace.name || "",
    goal: plan.company.mission || plan.product.offer || plan.intake.latestPrompt || "",
    source
  };
}

function inferNameFromSource(source: string) {
  const trimmed = source.trim();

  if (!trimmed) {
    return undefined;
  }

  if (isLikelySshRepositoryUrl(trimmed)) {
    return inferNameFromRepositoryPath(trimmed.split(":").at(-1) ?? "");
  }

  const normalizedUrl = normalizeUrlCandidate(trimmed);

  if (normalizedUrl) {
    if (isLikelyRepositoryUrl(normalizedUrl)) {
      return inferNameFromRepositoryPath(new URL(normalizedUrl).pathname);
    }

    return inferNameFromUrl(normalizedUrl);
  }

  if (isLikelyExistingPath(trimmed)) {
    return inferNameFromRepositoryPath(trimmed);
  }

  return undefined;
}

function extractExplicitGoalName(goal: string) {
  const quotedName = goal.match(/["“]([^"”]+)["”]/)?.[1]?.trim();
  if (quotedName) {
    return quotedName;
  }

  const patterns = [
    /\b(?:adı|ismi|name)\s*(?:olarak|:|=)?\s*([\p{L}\p{N}][\p{L}\p{N}._-]{1,40}(?:\s+[\p{L}\p{N}][\p{L}\p{N}._-]{1,40}){0,2})(?=\s+(?:olsun|olacak|diyelim|verelim|koyalım|olarak|için)\b|[.!?,]|$)/iu,
    /\b([\p{L}\p{N}][\p{L}\p{N}._-]{1,40}(?:\s+[\p{L}\p{N}][\p{L}\p{N}._-]{1,40}){0,2})\s+diye\b/iu
  ];

  for (const pattern of patterns) {
    const value = sanitizeGoalName(goal.match(pattern)?.[1] ?? "");
    if (value) {
      return value;
    }
  }

  return undefined;
}

function sanitizeGoalName(value: string) {
  return value
    .replace(/\b(yeni|bir|workspace|project|proje|ekleyelim|kuralım|başlatalım|oluşturalım)\b/giu, " ")
    .replace(/\b(diye|olarak|benim|bide|bir de)\b.*$/iu, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isLikelyExistingPath(value: string) {
  return value.startsWith("/") || value.startsWith("./") || value.startsWith("../");
}

function isLikelySshRepositoryUrl(value: string) {
  return /^git@[^:]+:[^/].+/.test(value);
}

function normalizeUrlCandidate(value: string) {
  if (value.includes("@")) {
    return null;
  }

  const cleaned = value.replace(/[),.;!?]+$/g, "");
  const candidate = /^https?:\/\//i.test(cleaned) ? cleaned : `https://${cleaned}`;

  try {
    const url = new URL(candidate);
    return url.hostname.includes(".") ? url.toString() : null;
  } catch {
    return null;
  }
}

function isLikelyRepositoryUrl(value: string) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();

    return host === "github.com" || host === "gitlab.com" || host === "bitbucket.org" || pathname.endsWith(".git");
  } catch {
    return false;
  }
}

function inferNameFromUrl(value: string) {
  try {
    const hostname = new URL(value).hostname.replace(/^www\./, "");
    const [rawName] = hostname.split(".");

    if (!rawName) {
      return undefined;
    }

    return rawName
      .split(/[-_]+/g)
      .filter(Boolean)
      .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  } catch {
    return undefined;
  }
}

function inferNameFromRepositoryPath(value: string) {
  const normalized = value
    .replace(/\\/g, "/")
    .replace(/\/+$/g, "")
    .split("/")
    .filter(Boolean)
    .at(-1)
    ?.replace(/\.git$/i, "");

  if (!normalized) {
    return undefined;
  }

  return normalized
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
