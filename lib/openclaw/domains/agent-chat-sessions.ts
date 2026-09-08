import { mkdir, readFile, writeFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import path from "node:path";

import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";
import type { RuntimeRecord } from "@/lib/openclaw/types";

export type AgentChatSessionOrigin = "agent-chat";

export type AgentChatSessionRecord = {
  agentId: string;
  sessionId: string;
  workspacePath?: string;
  createdAt: string;
  updatedAt: string;
  origin: AgentChatSessionOrigin;
};

type AgentChatSessionRegistry = {
  version: 1;
  sessions: AgentChatSessionRecord[];
};

const missionControlRootPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control");
const agentChatSessionsPath = path.join(missionControlRootPath, "agent-chat-sessions.json");
const maxAgentChatSessionRecords = 200;
const maxAgentChatSessionAgeMs = 14 * 24 * 60 * 60 * 1000;
const activeAgentChatSessionKeys = new Set<string>();

export function markAgentChatSessionActive(input: { agentId: string; sessionId: string }) {
  const key = createAgentChatSessionKey(input.agentId.trim(), input.sessionId.trim());

  if (key !== ":") {
    activeAgentChatSessionKeys.add(key);
  }
}

export function markAgentChatSessionInactive(input: { agentId: string; sessionId: string }) {
  activeAgentChatSessionKeys.delete(createAgentChatSessionKey(input.agentId.trim(), input.sessionId.trim()));
}

export function isAgentChatSessionActive(input: { agentId?: string | null; sessionId?: string | null }) {
  const agentId = input.agentId?.trim();
  const sessionId = input.sessionId?.trim();

  return Boolean(agentId && sessionId && activeAgentChatSessionKeys.has(createAgentChatSessionKey(agentId, sessionId)));
}

export async function recordAgentChatSession(input: {
  agentId: string;
  sessionId: string;
  workspacePath?: string;
}) {
  const agentId = input.agentId.trim();
  const sessionId = input.sessionId.trim();

  if (!agentId || !sessionId) {
    return;
  }

  const now = new Date().toISOString();
  const registry = await readAgentChatSessionRegistry();
  const nextRecord: AgentChatSessionRecord = {
    agentId,
    sessionId,
    workspacePath: input.workspacePath,
    createdAt:
      registry.sessions.find((entry) => entry.agentId === agentId && entry.sessionId === sessionId)?.createdAt ??
      now,
    updatedAt: now,
    origin: "agent-chat"
  };
  const nextSessions = pruneAgentChatSessionRecords([
    nextRecord,
    ...registry.sessions.filter((entry) => entry.agentId !== agentId || entry.sessionId !== sessionId)
  ]);

  await mkdir(missionControlRootPath, { recursive: true });
  await writeFile(
    agentChatSessionsPath,
    `${JSON.stringify(
      {
        version: 1,
        sessions: nextSessions
      } satisfies AgentChatSessionRegistry,
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function forgetAgentChatSession(input: {
  agentId: string;
  sessionId: string;
}) {
  const agentId = input.agentId.trim();
  const sessionId = input.sessionId.trim();

  if (!agentId || !sessionId) {
    return;
  }

  const registry = await readAgentChatSessionRegistry();
  const nextSessions = registry.sessions.filter((entry) => entry.agentId !== agentId || entry.sessionId !== sessionId);

  if (nextSessions.length === registry.sessions.length) {
    return;
  }

  await mkdir(missionControlRootPath, { recursive: true });
  await writeFile(
    agentChatSessionsPath,
    `${JSON.stringify(
      {
        version: 1,
        sessions: nextSessions
      } satisfies AgentChatSessionRegistry,
      null,
      2
    )}\n`,
    "utf8"
  );
}

export async function readAgentChatSessionIndex() {
  const registry = await readAgentChatSessionRegistry();
  return new Map(registry.sessions.map((entry) => [createAgentChatSessionKey(entry.agentId, entry.sessionId), entry]));
}

export async function readAgentChatSessionsForAgent(input: {
  agentId: string;
  workspacePath?: string;
  limit?: number;
}) {
  const agentId = input.agentId.trim();
  if (!agentId) {
    return [];
  }

  const workspacePath = input.workspacePath?.trim() || null;
  const limit = Number.isFinite(input.limit) && input.limit && input.limit > 0 ? Math.floor(input.limit) : 20;
  const registry = await readAgentChatSessionRegistry();

  return selectReusableAgentChatSessions(registry.sessions, { agentId, workspacePath }).slice(0, limit);
}

export async function resolveAgentChatSessionId(input: {
  agentId: string;
  workspacePath?: string;
  reuse?: boolean;
}) {
  if (input.reuse === false) {
    return randomUUID();
  }

  const existingSession = (await readAgentChatSessionsForAgent({
    agentId: input.agentId,
    workspacePath: input.workspacePath,
    limit: 1
  }))[0];

  return existingSession?.sessionId ?? randomUUID();
}

export function selectReusableAgentChatSessions(
  sessions: readonly AgentChatSessionRecord[],
  input: {
    agentId: string;
    workspacePath?: string | null;
  }
) {
  const agentId = input.agentId.trim();
  const workspacePath = input.workspacePath?.trim() || null;

  if (!agentId) {
    return [];
  }

  return sessions
    .filter((entry) => entry.agentId === agentId)
    .filter((entry) => !workspacePath || !entry.workspacePath || entry.workspacePath === workspacePath)
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt));
}

export function annotateAgentChatSessions(
  sessions: SessionsPayload["sessions"],
  index: Map<string, AgentChatSessionRecord>
): SessionsPayload["sessions"] {
  if (sessions.length === 0 || index.size === 0) {
    return sessions;
  }

  return sessions.map((session) => {
    const record =
      session.agentId && session.sessionId
        ? index.get(createAgentChatSessionKey(session.agentId, session.sessionId))
        : null;

    if (!record) {
      return session;
    }

    return {
      ...session,
      kind: "direct",
      origin: record.origin
    };
  });
}

export function annotateAgentChatRuntimes(
  runtimes: RuntimeRecord[],
  index: Map<string, AgentChatSessionRecord>
): RuntimeRecord[] {
  if (runtimes.length === 0 || index.size === 0) {
    return runtimes;
  }

  return runtimes.map((runtime) => {
    const record = findAgentChatSessionRecordForRuntime(runtime, index);

    if (!record) {
      return runtime;
    }

    return {
      ...runtime,
      metadata: {
        ...runtime.metadata,
        origin: record.origin,
        kind: "direct",
        chatType: "direct",
        agentChatSessionId: record.sessionId
      }
    };
  });
}

async function readAgentChatSessionRegistry(): Promise<AgentChatSessionRegistry> {
  try {
    const raw = await readFile(agentChatSessionsPath, "utf8");
    const parsed = JSON.parse(raw);
    const rawSessions: unknown[] = Array.isArray(parsed?.sessions) ? parsed.sessions : [];
    const sessions = rawSessions.length > 0
      ? rawSessions
          .map(parseAgentChatSessionRecord)
          .filter((entry): entry is AgentChatSessionRecord => Boolean(entry))
      : [];

    return {
      version: 1,
      sessions: pruneAgentChatSessionRecords(sessions)
    };
  } catch {
    return {
      version: 1,
      sessions: []
    };
  }
}

function parseAgentChatSessionRecord(value: unknown): AgentChatSessionRecord | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const record = value as Partial<AgentChatSessionRecord>;
  const agentId = typeof record.agentId === "string" ? record.agentId.trim() : "";
  const sessionId = typeof record.sessionId === "string" ? record.sessionId.trim() : "";
  const createdAt = typeof record.createdAt === "string" ? record.createdAt : "";
  const updatedAt = typeof record.updatedAt === "string" ? record.updatedAt : createdAt;

  if (!agentId || !sessionId || Number.isNaN(Date.parse(createdAt))) {
    return null;
  }

  return {
    agentId,
    sessionId,
    workspacePath: typeof record.workspacePath === "string" ? record.workspacePath : undefined,
    createdAt,
    updatedAt: Number.isNaN(Date.parse(updatedAt)) ? createdAt : updatedAt,
    origin: "agent-chat"
  };
}

function pruneAgentChatSessionRecords(records: AgentChatSessionRecord[]) {
  const cutoff = Date.now() - maxAgentChatSessionAgeMs;
  const seen = new Set<string>();
  const deduped: AgentChatSessionRecord[] = [];

  for (const record of [...records].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))) {
    const updatedAt = Date.parse(record.updatedAt);
    const key = createAgentChatSessionKey(record.agentId, record.sessionId);

    if (Number.isNaN(updatedAt) || updatedAt < cutoff || seen.has(key)) {
      continue;
    }

    seen.add(key);
    deduped.push(record);
  }

  return deduped.slice(0, maxAgentChatSessionRecords);
}

function findAgentChatSessionRecordForRuntime(
  runtime: RuntimeRecord,
  index: Map<string, AgentChatSessionRecord>
) {
  const agentId = runtime.agentId?.trim();

  if (!agentId || hasMissionTaskIdentity(runtime)) {
    return null;
  }

  for (const sessionId of resolveRuntimeSessionIdCandidates(runtime)) {
    const record = index.get(createAgentChatSessionKey(agentId, sessionId));

    if (record) {
      return record;
    }
  }

  return null;
}

function hasMissionTaskIdentity(runtime: RuntimeRecord) {
  const origin = typeof runtime.metadata.origin === "string" ? runtime.metadata.origin.trim() : "";
  const dispatchId = typeof runtime.metadata.dispatchId === "string" ? runtime.metadata.dispatchId.trim() : "";
  const mission = typeof runtime.metadata.mission === "string" ? runtime.metadata.mission.trim() : "";

  return Boolean(
    origin === "mission-dispatch" ||
      origin === "agentos-mission-dispatch" ||
      dispatchId ||
      mission ||
      runtime.taskId?.trim()
  );
}

function resolveRuntimeSessionIdCandidates(runtime: RuntimeRecord) {
  const rawCandidates = [
    runtime.sessionId,
    runtime.key,
    typeof runtime.metadata.sessionId === "string" ? runtime.metadata.sessionId : null,
    typeof runtime.metadata.sessionKey === "string" ? runtime.metadata.sessionKey : null,
    typeof runtime.metadata.key === "string" ? runtime.metadata.key : null
  ];
  const candidates = new Set<string>();

  for (const rawValue of rawCandidates) {
    const value = rawValue?.trim();

    if (!value) {
      continue;
    }

    candidates.add(value);

    const explicitSessionId = extractExplicitSessionId(value);
    if (explicitSessionId) {
      candidates.add(explicitSessionId);
    }
  }

  return [...candidates];
}

function extractExplicitSessionId(value: string) {
  const marker = ":explicit:";
  const markerIndex = value.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  return value.slice(markerIndex + marker.length).split(":")[0]?.trim() || null;
}

function createAgentChatSessionKey(agentId: string, sessionId: string) {
  return `${agentId}:${sessionId}`;
}
