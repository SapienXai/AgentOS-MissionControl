import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

export type AgentConfigSessionCatalogInput = Array<{
  id: string;
  workspace?: string;
}>;

export type SessionsPayload = {
  sessions: Array<{
    agentId?: string;
    key?: string;
    sessionId?: string;
    updatedAt?: number;
    ageMs?: number;
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
    model?: string;
    modelProvider?: string;
    cacheRead?: number;
    kind?: string;
    origin?: string;
    dispatchId?: string;
    mission?: string;
    routedMission?: string;
    dispatchSubmittedAt?: string;
  }>;
};

type SessionCatalogEntry = Record<string, unknown>;

type NormalizedSessionCatalogEntry = SessionsPayload["sessions"][number] & {
  key: string;
};

export async function settleSessionsPayloadFromSessionCatalogs(
  agentConfig: AgentConfigSessionCatalogInput,
  openClawStateRootPath: string
): Promise<PromiseSettledResult<SessionsPayload>> {
  try {
    const roots = collectSessionCatalogRoots(agentConfig, openClawStateRootPath);
    const sessions = await readSessionsFromCatalogRoots(roots);

    return {
      status: "fulfilled",
      value: {
        sessions
      }
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}

export function collectSessionCatalogRoots(
  agentConfig: AgentConfigSessionCatalogInput,
  openClawStateRootPath: string
) {
  return uniqueStrings([
    ...agentConfig.flatMap((entry) => {
      const roots: string[] = [];
      const workspace = normalizeOptionalValue(entry.workspace);

      if (workspace) {
        roots.push(path.join(workspace, ".openclaw", "agents"));
      }

      return roots;
    }),
    path.join(openClawStateRootPath, "agents")
  ]);
}

export async function readSessionsFromCatalogRoots(roots: string[]) {
  const sessionsByKey = new Map<string, NormalizedSessionCatalogEntry>();

  for (const root of roots) {
    let entries;

    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch {
      continue;
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }

      const sessionsPath = path.join(root, entry.name, "sessions", "sessions.json");
      let raw: string;

      try {
        raw = await readFile(sessionsPath, "utf8");
      } catch {
        continue;
      }

      let parsed: unknown;

      try {
        parsed = JSON.parse(raw);
      } catch {
        continue;
      }

      if (Array.isArray(parsed)) {
        for (const candidate of parsed) {
          if (!isObjectRecord(candidate)) {
            continue;
          }

          const normalized = normalizeSessionCatalogEntry(candidate, entry.name);

          if (!sessionsByKey.has(normalized.key)) {
            sessionsByKey.set(normalized.key, normalized);
          }
        }

        continue;
      }

      if (!isObjectRecord(parsed)) {
        continue;
      }

      for (const [sessionKey, candidate] of Object.entries(parsed)) {
        if (!isObjectRecord(candidate)) {
          continue;
        }

        const normalized = normalizeSessionCatalogEntry(candidate, entry.name, sessionKey);

        if (!sessionsByKey.has(normalized.key)) {
          sessionsByKey.set(normalized.key, normalized);
        }
      }
    }
  }

  return Array.from(sessionsByKey.values()).sort(
    (left, right) => (right.updatedAt ?? 0) - (left.updatedAt ?? 0)
  );
}

function normalizeSessionCatalogEntry(
  entry: SessionCatalogEntry,
  agentId: string,
  fallbackKey?: string
): NormalizedSessionCatalogEntry {
  const sessionId = normalizeOptionalValue(typeof entry.sessionId === "string" ? entry.sessionId : undefined);
  const updatedAt = readSessionCatalogNumber(entry, "updatedAt");
  const inputTokens = readSessionCatalogNumber(entry, "inputTokens");
  const outputTokens = readSessionCatalogNumber(entry, "outputTokens");
  const totalTokens = readSessionCatalogNumber(entry, "totalTokens");
  const cacheRead = readSessionCatalogNumber(entry, "cacheRead");
  const ageMs = readSessionCatalogNumber(entry, "ageMs") ?? inferSessionAgeMs(updatedAt);
  const model = normalizeOptionalValue(typeof entry.model === "string" ? entry.model : undefined);
  const modelProvider = normalizeOptionalValue(typeof entry.modelProvider === "string" ? entry.modelProvider : undefined);
  const key =
    normalizeOptionalValue(typeof entry.key === "string" ? entry.key : fallbackKey) ??
    sessionId ??
    `${agentId}:${updatedAt ?? "session"}`;

  return {
    agentId,
    key,
    sessionId: sessionId || undefined,
    updatedAt,
    ageMs,
    inputTokens,
    outputTokens,
    totalTokens:
      totalTokens ?? (typeof inputTokens === "number" || typeof outputTokens === "number"
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined),
    model: model || undefined,
    modelProvider: modelProvider || undefined,
    cacheRead,
    kind: inferSessionKindFromCatalogEntry(entry, key)
  };
}

function readSessionCatalogNumber(entry: SessionCatalogEntry, key: string) {
  const value = entry[key];
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function inferSessionAgeMs(updatedAt?: number) {
  return typeof updatedAt === "number" ? Math.max(Date.now() - updatedAt, 0) : undefined;
}

export function inferSessionKindFromCatalogEntry(entry: SessionCatalogEntry, sessionKey?: string) {
  const declaredKind = normalizeOptionalValue(
    typeof entry.kind === "string" ? entry.kind : typeof entry.chatType === "string" ? entry.chatType : undefined
  );

  if (declaredKind) {
    return declaredKind;
  }

  const deliveryContext = isObjectRecord(entry.deliveryContext) ? entry.deliveryContext : null;
  const origin = isObjectRecord(entry.origin) ? entry.origin : null;

  if (normalizeOptionalValue(typeof deliveryContext?.to === "string" ? deliveryContext.to : undefined) === "heartbeat") {
    return "direct";
  }

  if (normalizeOptionalValue(typeof origin?.provider === "string" ? origin.provider : undefined) === "heartbeat") {
    return "direct";
  }

  const normalizedKey = normalizeOptionalValue(sessionKey);

  if (normalizedKey && /:(direct|dm|private):/i.test(normalizedKey)) {
    return "direct";
  }

  if (normalizedKey && /:(group|channel|thread):/i.test(normalizedKey)) {
    return "group";
  }

  return "task";
}

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function normalizeOptionalValue(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}
