import { NextResponse } from "next/server";
import { z } from "zod";

import { extractMissionControlAction, type MissionControlAction } from "@/lib/openclaw/chat-actions";
import { runOpenClawJsonStream } from "@/lib/openclaw/cli";
import { clearMissionControlCaches, updateAgent } from "@/lib/openclaw/service";
import type { MissionDispatchStatus, MissionResponse } from "@/lib/openclaw/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatSchema = z.object({
  message: z.string().min(1),
  rawMessage: z.string().min(1).optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional()
});

type AgentChatPayloadEntry = {
  text?: string;
  content?: string;
  mediaUrl?: string | null;
};

type AgentChatPayloadResult = {
  payloads?: AgentChatPayloadEntry[];
  meta?: Record<string, unknown>;
  summary?: string;
  stopReason?: string | null;
};

type AgentChatCommandPayload = {
  runId?: string | null;
  status?: string;
  summary?: string;
  payloads?: AgentChatPayloadEntry[];
  meta?: Record<string, unknown>;
  stopReason?: string | null;
  result?: AgentChatPayloadResult;
};

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> | { agentId: string } }
) {
  try {
    const params = await Promise.resolve(context.params);
    const agentId = params.agentId.trim();

    if (!agentId) {
      return NextResponse.json({ error: "Agent id is required." }, { status: 400 });
    }

    const input = chatSchema.parse(await request.json());
    const result = await runOpenClawJsonStream<AgentChatCommandPayload>(
      [
        "agent",
        "--agent",
        agentId,
        "--message",
        input.message.trim(),
        "--thinking",
        input.thinking ?? "low",
        "--timeout",
        "90",
        "--json"
      ],
      { timeoutMs: 120000 }
    );
    const response = toAgentChatResponse(agentId, result);
    const action = readMissionControlAction(response.meta);

    if (action?.type === "rename_agent") {
      await updateAgent({
        id: agentId,
        name: action.name
      });
    }

    clearMissionControlCaches();

    return NextResponse.json(applyMissionControlActionMetadata(response, action), {
      status: response.status === "completed" ? 200 : 202
    });
  } catch (error) {
    return NextResponse.json(
      {
        error:
          error instanceof Error
            ? error.message
            : "OpenClaw could not send the message right now. Please try again."
      },
      { status: 400 }
    );
  }
}

function toAgentChatResponse(agentId: string, payload: AgentChatCommandPayload): MissionResponse {
  const resultPayload = resolveAgentChatResultPayload(payload);
  let action: MissionControlAction | null = null;
  const payloads = Array.isArray(resultPayload.payloads)
    ? resultPayload.payloads
        .map((entry) => {
          const extracted = extractMissionControlAction(resolveAgentChatEntryText(entry));

          if (!action && extracted.action) {
            action = extracted.action;
          }

          return {
            text: extracted.cleanText,
            mediaUrl: typeof entry.mediaUrl === "string" || entry.mediaUrl === null ? entry.mediaUrl : null
          };
        })
        .filter((entry) => entry.text.length > 0)
    : [];
  const extractedSummary = extractMissionControlAction(
    typeof payload.summary === "string" ? payload.summary : resultPayload.summary
  );

  if (!action && extractedSummary.action) {
    action = extractedSummary.action;
  }

  const summary =
    extractedSummary.cleanText ||
    payloads.map((entry) => entry.text).filter(Boolean).join("\n\n") ||
    (action?.type === "rename_agent" ? `Renamed agent to ${action.name}.` : "") ||
    "No response text was returned.";

  return {
    runId: typeof payload.runId === "string" && payload.runId.trim() ? payload.runId : null,
    agentId,
    status: normalizeStatus(resolveAgentChatStatus(payload, resultPayload)),
    summary,
    payloads,
    meta: action
      ? {
          ...resultPayload.meta,
          missionControlAction: action
        }
      : resultPayload.meta
  };
}

function normalizeStatus(value: string): MissionDispatchStatus {
  return value === "running" || value === "completed" || value === "stalled" || value === "cancelled"
    ? value
    : "completed";
}

function resolveAgentChatResultPayload(payload: AgentChatCommandPayload): AgentChatPayloadResult {
  return isRecord(payload.result) ? payload.result : payload;
}

function resolveAgentChatEntryText(entry: AgentChatPayloadEntry) {
  if (typeof entry.text === "string") {
    return entry.text;
  }

  if (typeof entry.content === "string") {
    return entry.content;
  }

  return "";
}

function resolveAgentChatStatus(payload: AgentChatCommandPayload, resultPayload: AgentChatPayloadResult) {
  if (typeof payload.status === "string") {
    return payload.status;
  }

  if (resultPayload.stopReason === "aborted") {
    return "cancelled";
  }

  if (resultPayload.stopReason === "error") {
    return "stalled";
  }

  return "completed";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readMissionControlAction(meta: MissionResponse["meta"]): MissionControlAction | null {
  const candidate = meta?.missionControlAction;

  if (!candidate || typeof candidate !== "object") {
    return null;
  }

  const action = candidate as Record<string, unknown>;

  if (action.type !== "rename_agent" || typeof action.name !== "string" || action.name.trim().length === 0) {
    return null;
  }

  return {
    type: "rename_agent",
    name: action.name.trim()
  };
}

function applyMissionControlActionMetadata(response: MissionResponse, action: MissionControlAction | null): MissionResponse {
  if (!action) {
    return response;
  }

  return {
    ...response,
    summary: response.summary.trim() || `Renamed agent to ${action.name}.`,
    meta: {
      ...response.meta,
      missionControlAction: {
        ...action,
        applied: true
      }
    }
  };
}
