import { createHash } from "node:crypto";

import { resolveRuntimeStatus } from "@/lib/openclaw/domains/control-plane-normalization";
import type { SessionsPayload } from "@/lib/openclaw/domains/session-catalog";
import type { RuntimeRecord } from "@/lib/openclaw/types";

export type RuntimeAgentConfigInput = Array<{
  id: string;
  workspace?: string;
  model?: string;
}>;

export type RuntimeAgentInput = Array<{
  id: string;
  workspace?: string;
  model?: string;
}>;

export function mapSessionCatalogEntryToRuntime(
  session: SessionsPayload["sessions"][number],
  agentConfig: RuntimeAgentConfigInput,
  agentsList: RuntimeAgentInput
): RuntimeRecord {
  const agent = agentsList.find((entry) => entry.id === session.agentId);
  const config = agentConfig.find((entry) => entry.id === session.agentId);
  const workspacePath = agent?.workspace || config?.workspace;
  const workspaceId = workspacePath ? workspaceIdFromPath(workspacePath) : undefined;
  const taskId = extractRuntimeKeyToken(session.key, "task");
  const stage = extractRuntimeKeyToken(session.key, "stage");
  const modelId =
    session.model && session.model.includes("/")
      ? session.model
      : config?.model || agent?.model || "unassigned";
  const status = resolveRuntimeStatus(stage, session.key, session.ageMs);
  const runtimeId = createRuntimeId(session);
  const taskLabel = taskId ? taskId.slice(0, 8) : null;
  const isAgentChatSession = session.origin === "agent-chat";

  return {
    id: runtimeId,
    source: "session",
    key: session.key || "unknown-session",
    title: isAgentChatSession
      ? "Agent chat session"
      : taskLabel
      ? `${prettifyAgentName(session.agentId)} · ${taskLabel}`
      : `${prettifyAgentName(session.agentId)} session`,
    subtitle: isAgentChatSession ? "direct chat" : taskLabel ? `task ${taskLabel} · ${stage || "running"}` : "main session",
    status,
    updatedAt: session.updatedAt ?? null,
    ageMs: session.ageMs ?? null,
    agentId: session.agentId,
    workspaceId,
    modelId,
    sessionId: session.sessionId,
    taskId,
    tokenUsage:
      typeof session.totalTokens === "number" || typeof session.inputTokens === "number"
        ? {
            input: session.inputTokens ?? 0,
            output: session.outputTokens ?? 0,
            total: session.totalTokens ?? (session.inputTokens ?? 0) + (session.outputTokens ?? 0),
            cacheRead: session.cacheRead ?? 0
          }
        : undefined,
    metadata: {
      kind: session.kind ?? "direct",
      chatType: session.kind ?? "direct",
      origin: session.origin ?? null,
      dispatchId: session.dispatchId ?? null,
      mission: session.mission ?? null,
      routedMission: session.routedMission ?? null,
      dispatchSubmittedAt: session.dispatchSubmittedAt ?? null,
      stage: stage ?? null,
      historical: false
    }
  };
}

export function createRuntimeId(session: SessionsPayload["sessions"][number]) {
  const taskId = extractRuntimeKeyToken(session.key, "task");
  const runtimeKey = taskId || session.key || session.sessionId || String(Math.random());
  const sessionToken = session.sessionId || hashValue(session.agentId || "sessionless");
  return `runtime:${sessionToken}:${hashValue(runtimeKey)}`;
}

export function extractRuntimeKeyToken(key: string | undefined, prefix: string) {
  if (!key) {
    return undefined;
  }

  const marker = `:${prefix}:`;
  const index = key.indexOf(marker);

  if (index === -1) {
    return undefined;
  }

  const tail = key.slice(index + marker.length);
  return tail.split(":")[0];
}

function workspaceIdFromPath(workspacePath: string) {
  const hash = createHash("sha1").update(workspacePath).digest("hex").slice(0, 8);
  return `workspace:${hash}`;
}

function prettifyAgentName(agentId: string | undefined) {
  if (!agentId) {
    return "OpenClaw";
  }

  return agentId
    .split(/[-_]/g)
    .filter(Boolean)
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");
}

function hashValue(value: string) {
  return createHash("sha1").update(value).digest("hex").slice(0, 10);
}
