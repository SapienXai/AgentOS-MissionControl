import { NextResponse } from "next/server";
import { z } from "zod";

import { runOpenClawJsonStream } from "@/lib/openclaw/cli";
import type { MissionDispatchStatus, MissionResponse } from "@/lib/openclaw/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatSchema = z.object({
  message: z.string().min(1),
  thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional()
});

type AgentChatCommandPayload = {
  runId: string;
  status: string;
  summary: string;
  result?: {
    payloads?: Array<{
      text?: string;
      mediaUrl?: string | null;
    }>;
    meta?: Record<string, unknown>;
  };
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

    return NextResponse.json(toAgentChatResponse(agentId, result), {
      status: normalizeStatus(result.status) === "completed" ? 200 : 202
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
  const payloads = Array.isArray(payload.result?.payloads)
    ? payload.result.payloads
        .map((entry) => ({
          text: typeof entry.text === "string" ? entry.text.trim() : "",
          mediaUrl: typeof entry.mediaUrl === "string" || entry.mediaUrl === null ? entry.mediaUrl : null
        }))
        .filter((entry) => entry.text.length > 0)
    : [];

  const summary =
    payload.summary.trim() ||
    payloads.map((entry) => entry.text).filter(Boolean).join("\n\n") ||
    "No response text was returned.";

  return {
    runId: payload.runId,
    agentId,
    status: normalizeStatus(payload.status),
    summary,
    payloads,
    meta: payload.result?.meta
  };
}

function normalizeStatus(value: string): MissionDispatchStatus {
  return value === "running" || value === "completed" || value === "stalled" || value === "cancelled"
    ? value
    : "completed";
}
