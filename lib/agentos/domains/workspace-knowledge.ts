export type WorkspaceKnowledgeSourceKind =
  | "prompt"
  | "website"
  | "repository"
  | "file"
  | "folder"
  | "connector";

export type WorkspaceKnowledgeSourceProvenance =
  | "operator"
  | "wizard"
  | "planner"
  | "migration"
  | "derived";

/** Ready/error describe declaration/availability only; they never imply ingestion or indexing. */
export type WorkspaceKnowledgeSourceStatus = "ready" | "error";

export type WorkspaceKnowledgeSourceLocator =
  | { kind: "prompt"; text: string }
  | { kind: "website"; url: string }
  | { kind: "repository"; remoteUrl?: string; localPath?: string }
  | { kind: "file"; path: string }
  | { kind: "folder"; path: string }
  | {
      kind: "connector";
      provider: string;
      accountId?: string;
      resourceId?: string;
      resourceType?: string;
    };

export type WorkspaceKnowledgeSource = {
  id: string;
  kind: WorkspaceKnowledgeSourceKind;
  label: string;
  summary: string;
  details: string[];
  status: WorkspaceKnowledgeSourceStatus;
  createdAt: string;
  provenance: WorkspaceKnowledgeSourceProvenance;
  locator: WorkspaceKnowledgeSourceLocator;
  confidence?: number;
  error?: string;
};

type RawSource = Record<string, unknown>;

const SENSITIVE_KEY = /(token|password|secret|credential|apikey|api_key|accesskey|privatekey|cookie|authorization)/i;

function isRecord(value: unknown): value is RawSource {
  return typeof value === "object" && value !== null;
}

function text(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function hasSensitiveKey(value: unknown, seen = new Set<object>()): boolean {
  if (!isRecord(value) && !Array.isArray(value)) return false;
  if (typeof value === "object" && value !== null) {
    if (seen.has(value)) return false;
    seen.add(value);
  }

  if (Array.isArray(value)) return value.some((entry) => hasSensitiveKey(entry, seen));

  return Object.entries(value).some(([key, entry]) => SENSITIVE_KEY.test(key) || hasSensitiveKey(entry, seen));
}

function normalizedUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    if (parsed.pathname !== "/") parsed.pathname = parsed.pathname.replace(/\/+$/, "");
    return parsed.toString();
  } catch {
    return value.replace(/\/+$/, "");
  }
}

function normalizedPath(value: string) {
  return value.trim().replace(/\\/g, "/").replace(/\/+$/, "") || "/";
}

function normalizedLocator(locator: unknown, fallbackKind?: WorkspaceKnowledgeSourceKind): WorkspaceKnowledgeSourceLocator {
  const value = isRecord(locator) ? locator : {};
  const kind = value.kind === "repo" ? "repository" : value.kind ?? fallbackKind;

  if (kind === "prompt") {
    const prompt = text(value.text) ?? text(value.value);
    if (!prompt) throw new Error("Prompt knowledge source requires locator.text.");
    return { kind: "prompt", text: prompt };
  }
  if (kind === "website") {
    const url = text(value.url);
    if (!url) throw new Error("Website knowledge source requires locator.url.");
    return { kind: "website", url: normalizedUrl(url) };
  }
  if (kind === "repository") {
    const remoteUrl = text(value.remoteUrl) ?? text(value.url);
    const localPath = text(value.localPath) ?? text(value.path);
    if (!remoteUrl && !localPath) throw new Error("Repository knowledge source requires remoteUrl or localPath.");
    return {
      kind: "repository",
      ...(remoteUrl ? { remoteUrl: normalizedUrl(remoteUrl) } : {}),
      ...(localPath ? { localPath: normalizedPath(localPath) } : {})
    };
  }
  if (kind === "file" || kind === "folder") {
    const valuePath = text(value.path);
    if (!valuePath) throw new Error(`${kind[0].toUpperCase()}${kind.slice(1)} knowledge source requires locator.path.`);
    return { kind, path: normalizedPath(valuePath) };
  }
  if (kind === "connector") {
    const provider = text(value.provider);
    if (!provider) throw new Error("Connector knowledge source requires locator.provider.");
    return {
      kind: "connector",
      provider,
      ...(text(value.accountId) ? { accountId: text(value.accountId) } : {}),
      ...(text(value.resourceId) ? { resourceId: text(value.resourceId) } : {}),
      ...(text(value.resourceType) ? { resourceType: text(value.resourceType) } : {})
    };
  }

  throw new Error("Knowledge source locator kind is unsupported.");
}

export function createWorkspaceKnowledgeSource(input: {
  id: string;
  kind: WorkspaceKnowledgeSourceKind;
  label: string;
  summary: string;
  details?: string[];
  locator: WorkspaceKnowledgeSourceLocator;
  provenance?: WorkspaceKnowledgeSourceProvenance;
  status?: WorkspaceKnowledgeSourceStatus;
  createdAt?: string;
  confidence?: number;
  error?: string;
}): WorkspaceKnowledgeSource {
  const label = text(input.label) ?? input.kind;
  const summary = text(input.summary) ?? label;
  const locator = normalizedLocator(input.locator, input.kind);
  return {
    id: text(input.id) ?? `${input.kind}-${slugify(label) || "source"}`,
    kind: locator.kind,
    label,
    summary,
    details: (input.details ?? []).map(text).filter((entry): entry is string => Boolean(entry)),
    status: input.status ?? "ready",
    createdAt: text(input.createdAt) ?? new Date().toISOString(),
    provenance: input.provenance ?? "operator",
    locator,
    ...(typeof input.confidence === "number" ? { confidence: input.confidence } : {}),
    ...(text(input.error) ? { error: text(input.error) } : {})
  };
}

export function normalizeWorkspaceKnowledgeSource(
  raw: unknown,
  options: { provenance?: WorkspaceKnowledgeSourceProvenance } = {}
): WorkspaceKnowledgeSource {
  if (!isRecord(raw)) throw new Error("Knowledge source must be an object.");
  if (hasSensitiveKey(raw)) throw new Error("Knowledge sources cannot contain credentials or secret material.");

  const rawKind = raw.kind === "repo" ? "repository" : raw.kind;
  if (!isKnowledgeSourceKind(rawKind)) throw new Error("Knowledge source kind is unsupported.");

  const locator = normalizedLocator(raw.locator ?? raw, rawKind);
  return createWorkspaceKnowledgeSource({
    id: text(raw.id) ?? `${rawKind}-${slugify(text(raw.label) ?? rawKind) || "source"}`,
    kind: rawKind,
    label: text(raw.label) ?? rawKind,
    summary: text(raw.summary) ?? text(raw.label) ?? rawKind,
    details: Array.isArray(raw.details) ? raw.details.map(text).filter((entry): entry is string => Boolean(entry)) : [],
    locator,
    provenance: options.provenance ?? (isProvenance(raw.provenance) ? raw.provenance : "operator"),
    status: raw.status === "error" ? "error" : "ready",
    createdAt: text(raw.createdAt),
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    error: text(raw.error)
  });
}

export function legacyPlannerContextSourceToKnowledgeSource(
  raw: unknown,
  provenance: WorkspaceKnowledgeSourceProvenance = "migration"
): WorkspaceKnowledgeSource {
  if (!isRecord(raw)) throw new Error("Legacy context source must be an object.");
  const kind = raw.kind === "repo" ? "repository" : raw.kind;
  const label = text(raw.label) ?? (typeof kind === "string" ? kind : "source");
  const url = text(raw.url);
  let locator: WorkspaceKnowledgeSourceLocator;

  if (kind === "website") locator = { kind: "website", url: url ?? text(raw.summary) ?? label };
  else if (kind === "repository") locator = { kind: "repository", ...(url ? { remoteUrl: url } : { localPath: text(raw.summary) ?? label }) };
  else if (kind === "folder") locator = { kind: "folder", path: url ?? text(raw.summary) ?? label };
  else locator = { kind: "prompt", text: text(raw.summary) ?? label };

  return createWorkspaceKnowledgeSource({
    id: text(raw.id) ?? `${kind}-${slugify(label) || "source"}`,
    kind: isKnowledgeSourceKind(kind) ? kind : "prompt",
    label,
    summary: text(raw.summary) ?? label,
    details: Array.isArray(raw.details) ? raw.details.map(text).filter((entry): entry is string => Boolean(entry)) : [],
    locator,
    provenance,
    status: raw.status === "error" ? "error" : "ready",
    createdAt: text(raw.createdAt),
    confidence: typeof raw.confidence === "number" ? raw.confidence : undefined,
    error: text(raw.error)
  });
}

export function workspaceKnowledgeSourceIdentity(source: WorkspaceKnowledgeSource) {
  const locator = source.locator;
  if (locator.kind === "prompt") return `prompt:${locator.text.replace(/\s+/g, " ").trim()}`;
  if (locator.kind === "website") return `website:${normalizedUrl(locator.url)}`;
  if (locator.kind === "repository") return `repository:${locator.remoteUrl ? normalizedUrl(locator.remoteUrl) : ""}:${locator.localPath ? normalizedPath(locator.localPath) : ""}`;
  if (locator.kind === "file" || locator.kind === "folder") return `${locator.kind}:${normalizedPath(locator.path)}`;
  return `connector:${locator.provider}:${locator.accountId ?? ""}:${locator.resourceType ?? ""}:${locator.resourceId ?? ""}`;
}

export function normalizeWorkspaceKnowledgeSources(raw: unknown): WorkspaceKnowledgeSource[] {
  if (!Array.isArray(raw)) return [];
  const sources: WorkspaceKnowledgeSource[] = [];
  const identities = new Set<string>();
  for (const entry of raw) {
    const source = normalizeWorkspaceKnowledgeSource(entry);
    const identity = workspaceKnowledgeSourceIdentity(source);
    if (identities.has(identity)) continue;
    identities.add(identity);
    sources.push(source);
  }
  return sources;
}

export function mergeWorkspaceKnowledgeSources(
  current: WorkspaceKnowledgeSource[],
  incoming: WorkspaceKnowledgeSource[]
) {
  return normalizeWorkspaceKnowledgeSources([...current, ...incoming]);
}

export function isKnowledgeSourceKind(value: unknown): value is WorkspaceKnowledgeSourceKind {
  return value === "prompt" || value === "website" || value === "repository" || value === "file" || value === "folder" || value === "connector";
}

function isProvenance(value: unknown): value is WorkspaceKnowledgeSourceProvenance {
  return value === "operator" || value === "wizard" || value === "planner" || value === "migration" || value === "derived";
}

function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 48);
}
