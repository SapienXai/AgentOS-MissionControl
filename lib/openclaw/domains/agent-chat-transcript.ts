import { readFile } from "node:fs/promises";

import {
  extractTranscriptTurns,
  filterTranscriptTurnsForRuntime,
  resolveRuntimeTranscriptPath,
  type TranscriptTurn
} from "@/lib/openclaw/domains/runtime-transcript";
import type { RuntimeRecord } from "@/lib/openclaw/types";

function createTranscriptRuntime(agentId: string, sessionId: string): RuntimeRecord {
  return {
    id: `agent-chat:${sessionId}`,
    source: "session",
    key: `${agentId}:${sessionId}`,
    title: "Agent chat session",
    subtitle: "",
    status: "running",
    updatedAt: Date.now(),
    ageMs: 0,
    agentId,
    sessionId,
    metadata: {},
    toolNames: [],
    runId: sessionId
  };
}

export async function readLatestAgentChatTurn(
  agentId: string,
  sessionId: string,
  workspacePath?: string
): Promise<TranscriptTurn | null> {
  const transcriptPath = await resolveRuntimeTranscriptPath(agentId, sessionId, workspacePath);

  if (!transcriptPath) {
    return null;
  }

  try {
    const raw = await readFile(transcriptPath, "utf8");
    const runtime = createTranscriptRuntime(agentId, sessionId);
    const turns = filterTranscriptTurnsForRuntime(runtime, extractTranscriptTurns(raw, runtime, workspacePath));
    return turns.at(-1) ?? null;
  } catch {
    return null;
  }
}
