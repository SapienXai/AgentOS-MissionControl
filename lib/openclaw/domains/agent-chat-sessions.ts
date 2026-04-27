import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";

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

export async function readAgentChatSessionIndex() {
  const registry = await readAgentChatSessionRegistry();
  return new Map(registry.sessions.map((entry) => [createAgentChatSessionKey(entry.agentId, entry.sessionId), entry]));
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

function createAgentChatSessionKey(agentId: string, sessionId: string) {
  return `${agentId}:${sessionId}`;
}
