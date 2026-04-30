import { NextResponse } from "next/server";
import { z } from "zod";

import { clearMissionControlCaches, getMissionControlSnapshot, updateAgent } from "@/lib/agentos/control-plane";
import {
  buildAgentChatPrompt,
  buildWorkspaceTeamPrompt,
  normalizeAgentChatHistory
} from "@/lib/openclaw/agent-chat-prompt";
import {
  buildDirectAgentIdentityReply,
  isDirectAgentIdentityQuestion,
  isStaleAgentChatContextRecoveryText
} from "@/lib/openclaw/agent-chat-guards";
import { readLatestAgentChatTurn } from "@/lib/openclaw/domains/agent-chat-transcript";
import { extractMissionControlAction, type MissionControlAction } from "@/lib/openclaw/chat-actions";
import { runOpenClawJsonStream } from "@/lib/openclaw/cli";
import { recordAgentChatSession } from "@/lib/openclaw/domains/agent-chat-sessions";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import {
  resolveOpenClawRuntimeFailureMessage,
  resolveOpenClawRuntimePreflightError
} from "@/lib/openclaw/runtime-compatibility";
import { renderWorkspaceSurfaceCoordinationMarkdownForAgent } from "@/lib/openclaw/surface-coordination";
import type { ControlPlaneSnapshot, MissionDispatchStatus, MissionResponse } from "@/lib/agentos/contracts";
import type { TranscriptTurn } from "@/lib/openclaw/domains/runtime-transcript";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const chatHistoryEntrySchema = z.object({
  role: z.enum(["user", "assistant"]),
  text: z.string().min(1)
});

const chatSchema = z.object({
  message: z.string().min(1),
  rawMessage: z.string().min(1).optional(),
  history: z.array(chatHistoryEntrySchema).optional(),
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

type AgentChatStreamEvent =
  | {
      type: "status";
      message: string;
    }
  | {
      type: "assistant";
      text: string;
    }
  | {
      type: "done";
      ok: boolean;
      message: string;
      response?: MissionResponse;
    };

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  try {
    const params = await Promise.resolve(context.params);
    const agentId = params.agentId.trim();

    if (!agentId) {
      return NextResponse.json({ error: "Agent id is required." }, { status: 400 });
    }

    const input = chatSchema.parse(await request.json());

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    let writeChain = Promise.resolve();
    let closed = false;

    const send = (event: AgentChatStreamEvent) => {
      if (closed) {
        return Promise.resolve();
      }

      writeChain = writeChain
        .then(() => writer.write(encoder.encode(`${JSON.stringify(event)}\n`)))
        .catch(() => {});

      return writeChain;
    };

    const closeWriter = async () => {
      if (closed) {
        return;
      }

      closed = true;
      await writeChain;

      try {
        await writer.close();
      } catch {
        // The reader may already be gone.
      }
    };

    void (async () => {
      let latestAssistantText = "";
      let latestStatusMessage = "";
      let latestTurnStatus: TranscriptTurn["status"] | null = null;
      let keepPolling = true;

      const stopPolling = () => {
        keepPolling = false;
      };

      const wait = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

      const pollTranscript = async (agentId: string, sessionId: string, workspacePath?: string) => {
        const turn = await readLatestAgentChatTurn(agentId, sessionId, workspacePath);

        if (!turn) {
          return;
        }

        const statusMessage = resolveChatStatusMessage(turn);
        if (turn.status !== latestTurnStatus || statusMessage !== latestStatusMessage) {
          latestTurnStatus = turn.status;
          latestStatusMessage = statusMessage;
          await send({
            type: "status",
            message: statusMessage
          });
        }

        const currentText = typeof turn.finalText === "string" ? sanitizePolledAssistantText(turn.finalText) : "";
        if (currentText && currentText !== latestAssistantText) {
          latestAssistantText = currentText;
          await send({
            type: "assistant",
            text: currentText
          });
        }
      };

      const handleAbort = () => {
        stopPolling();
      };

      request.signal.addEventListener("abort", handleAbort);

      try {
        await send({
          type: "status",
          message: "Starting agent turn..."
        });

        const snapshot = await getMissionControlSnapshot({ includeHidden: true });
        const agent = snapshot.agents.find((entry) => entry.id === agentId) ?? null;

        if (!agent) {
          await send({
            type: "done",
            ok: false,
            message: "Agent could not be found."
          });
          return;
        }

        const resolvedDefaultModelId = resolveReadyDefaultAgentModelId(snapshot);
        if (agent.modelId === "unassigned" && resolvedDefaultModelId) {
          await updateAgent({
            id: agentId,
            modelId: resolvedDefaultModelId
          });
          agent.modelId = resolvedDefaultModelId;
        }

        const runtimePreflightError = resolveOpenClawRuntimePreflightError(snapshot);
        if (runtimePreflightError) {
          await send({
            type: "done",
            ok: false,
            message: runtimePreflightError
          });
          return;
        }

        const submittedMessage = input.message.trim();
        const rawMessage = input.rawMessage?.trim();
        const operatorMessage = rawMessage || submittedMessage;
        let message = submittedMessage;

        if (rawMessage || !isComposedAgentChatPrompt(submittedMessage)) {
          const workspaceTeamPrompt = buildWorkspaceTeamPrompt(snapshot, agent);
          const workspaceSurfacePrompt = renderWorkspaceSurfaceCoordinationMarkdownForAgent(agentId, snapshot);
          const history = normalizeAgentChatHistory(input.history ?? []).slice(-16);

          message = buildAgentChatPrompt(history, operatorMessage, {
            agentName: formatAgentDisplayName(agent),
            agentDir: agent.agentDir,
            workspacePath: agent.workspacePath,
            workspaceTeamPrompt,
            workspaceSurfacePrompt
          });
        }

        const sessionId = globalThis.crypto.randomUUID();
        await recordAgentChatSession({
          agentId,
          sessionId,
          workspacePath: agent.workspacePath
        });
        const commandPromise = runOpenClawJsonStream<AgentChatCommandPayload>(
          [
            "agent",
            "--agent",
            agentId,
            "--session-id",
            sessionId,
            "--message",
            message,
            "--thinking",
            input.thinking ?? "low",
            "--timeout",
            "90",
            "--json"
          ],
          { timeoutMs: 120000, signal: request.signal }
        );

        void (async () => {
          while (keepPolling && !request.signal.aborted) {
            try {
              await pollTranscript(agentId, sessionId, agent.workspacePath);
            } catch {
              // Ignore transient transcript reads while the session is still booting.
            }

            await wait(250);
          }
        })();

        const result = await commandPromise;
        stopPolling();

        try {
          await pollTranscript(agentId, sessionId, agent.workspacePath);
        } catch {
          // Ignore a last transient read failure.
        }

        let response = toAgentChatResponse(agentId, result);
        response = recoverDirectIdentityResponse(response, formatAgentDisplayName(agent), operatorMessage);
        const action = readMissionControlAction(response.meta);

        if (action?.type === "rename_agent") {
          await updateAgent({
            id: agentId,
            name: action.name
          });
        }

        clearMissionControlCaches();

        await send({
          type: "done",
          ok: true,
          message: response.summary,
          response: applyMissionControlActionMetadata(response, action)
        });
      } catch (error) {
        stopPolling();

        if (request.signal.aborted) {
          return;
        }

        await send({
          type: "done",
          ok: false,
          message:
            resolveOpenClawRuntimeFailureMessage(error instanceof Error ? error.message : "") ||
            (error instanceof Error
              ? error.message
              : "OpenClaw could not send the message right now. Please try again.")
        });
      } finally {
        stopPolling();
        request.signal.removeEventListener("abort", handleAbort);
        await closeWriter();
      }
    })();

    return new Response(stream.readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
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

function isComposedAgentChatPrompt(value: string) {
  return (
    value.includes("Workspace team roster:") ||
    value.includes("## Telegram coordination") ||
    value.includes("## Discord coordination") ||
    value.includes("You are chatting directly with the operator inside AgentOS.")
  );
}

function resolveReadyDefaultAgentModelId(snapshot: ControlPlaneSnapshot) {
  if (!snapshot.diagnostics.modelReadiness.defaultModelReady) {
    return null;
  }

  return (
    snapshot.diagnostics.modelReadiness.resolvedDefaultModel?.trim() ||
    snapshot.diagnostics.modelReadiness.defaultModel?.trim() ||
    null
  );
}

function resolveChatStatusMessage(turn: TranscriptTurn) {
  if (turn.status === "completed") {
    return "Agent composed a reply.";
  }

  if (turn.status === "stalled") {
    return "Agent hit a snag while composing the reply.";
  }

  if (turn.status === "cancelled") {
    return "Agent reply was cancelled.";
  }

  if (turn.finalText && turn.finalText.trim().length > 0) {
    return "Agent is finalizing the reply...";
  }

  return "Agent is thinking...";
}

function sanitizePolledAssistantText(value: string) {
  return sanitizeAgentChatReplyText(value);
}

function sanitizeAgentChatReplyText(value: unknown) {
  if (typeof value !== "string") {
    return "";
  }

  const trimmed = value.trim();
  return stripLeadingThinkingBlock(trimmed);
}

function stripLeadingThinkingBlock(value: string) {
  if (!value || !/^\[thinking\]\b/i.test(value)) {
    return value;
  }

  const paragraphs = value
    .split(/\n{2,}/)
    .map((paragraph) => paragraph.trim())
    .filter(Boolean);

  if (paragraphs.length <= 2) {
    return "";
  }

  return paragraphs.slice(2).join("\n\n").trim();
}

function toAgentChatResponse(agentId: string, payload: AgentChatCommandPayload): MissionResponse {
  const resultPayload = resolveAgentChatResultPayload(payload);
  let action: MissionControlAction | null = null;
  const payloads = Array.isArray(resultPayload.payloads)
    ? resultPayload.payloads
        .map((entry) => {
          const extracted = extractMissionControlAction(sanitizeAgentChatReplyText(resolveAgentChatEntryText(entry)));

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
    sanitizeAgentChatReplyText(typeof payload.summary === "string" ? payload.summary : resultPayload.summary)
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

function recoverDirectIdentityResponse(response: MissionResponse, agentName: string, operatorMessage: string): MissionResponse {
  if (!isDirectAgentIdentityQuestion(operatorMessage)) {
    return response;
  }

  const responseText = [response.summary, ...response.payloads.map((entry) => entry.text)].join("\n\n");
  if (!isStaleAgentChatContextRecoveryText(responseText)) {
    return response;
  }

  const text = buildDirectAgentIdentityReply(agentName);

  return {
    ...response,
    summary: text,
    payloads: [
      {
        text,
        mediaUrl: null
      }
    ]
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
