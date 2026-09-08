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
import {
  conflictedAgentChatSessionMessage,
  completedEmptyAgentChatResponseMessage,
  emptyAgentChatResponseMessage,
  extractAgentChatEmptyResponseDiagnosticText,
  extractAssistantTextFromAgentChatStreamLine,
  extractAgentChatMessagesFromSessionHistory,
  extractLatestAssistantTextFromSessionHistory,
  isCompletedEmptyAgentChatResponse,
  recoverStreamedAgentChatResponse,
  resolveAgentChatRuntimeFailureMessage,
  sanitizeAgentChatReplyText,
  sanitizeAgentChatVisibleText
} from "@/lib/openclaw/agent-chat-response";
import {
  readAgentChatTranscriptMessages,
  readLatestAgentChatTurn
} from "@/lib/openclaw/domains/agent-chat-transcript";
import { extractMissionControlAction, type MissionControlAction } from "@/lib/openclaw/chat-actions";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { ensureOpenAiAuthOrderForAgent } from "@/lib/openclaw/application/model-auth-service";
import { isOpenAiBackedModel } from "@/lib/openclaw/domains/model-provider-connection";
import {
  forgetAgentChatSession,
  markAgentChatSessionActive,
  markAgentChatSessionInactive,
  readAgentChatSessionsForAgent,
  recordAgentChatSession,
  resolveAgentChatSessionId
} from "@/lib/openclaw/domains/agent-chat-sessions";
import { persistRuntimeSmokeTest } from "@/lib/openclaw/domains/control-plane-settings";
import { openClawStateRootPath } from "@/lib/openclaw/state/paths";
import { inspectOpenClawRuntimeState } from "@/lib/openclaw/state/runtime-state";
import { stringifyCommandFailure } from "@/lib/openclaw/command-failure";
import { isOpenAiAuthFailure } from "@/lib/openclaw/model-auth-errors";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import {
  resolveOpenClawRuntimeFailureMessage,
  resolveOpenClawRuntimePreflightError
} from "@/lib/openclaw/runtime-compatibility";
import { resolveOpenClawModelReadinessIssue } from "@/lib/openclaw/readiness";
import { renderWorkspaceSurfaceCoordinationMarkdownForAgent } from "@/lib/openclaw/surface-coordination";
import { redactErrorMessage, redactSecretText, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
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
  thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional(),
  idempotencyKey: z.string().trim().min(1).max(240).optional()
});

const activeAgentChatSessionTurns = new Map<string, { lockId: symbol; startedAt: number }>();
const agentChatSessionTurnLockTtlMs = 130_000;

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
  sessionKey?: string | null;
  sessionId?: string | null;
  runStarted?: boolean;
  messageSeq?: number | null;
  idempotencyKey?: string | null;
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

type RehydratedAgentChatMessage = {
  id: string;
  role: "user" | "assistant";
  text: string;
  createdAt: number;
  status: "sent";
  runId?: string | null;
  submissionId?: string | null;
  messageSeq?: number | null;
};

export async function GET(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;

  try {
    const params = await Promise.resolve(context.params);
    const agentId = params.agentId.trim();

    if (!agentId) {
      return NextResponse.json({ error: "Agent id is required." }, { status: 400 });
    }

    const snapshot = await getMissionControlSnapshot({ includeHidden: true });
    const agent = snapshot.agents.find((entry) => entry.id === agentId) ?? null;

    if (!agent) {
      return NextResponse.json({ error: "Agent could not be found." }, { status: 404 });
    }

    const sessions = await readAgentChatSessionsForAgent({
      agentId,
      workspacePath: agent.workspacePath,
      limit: 5
    });
    const messages: RehydratedAgentChatMessage[] = [];

    for (const session of [...sessions].reverse()) {
      const transcriptMessages = await readAgentChatTranscriptMessages(
        agentId,
        session.sessionId,
        session.workspacePath ?? agent.workspacePath
      );

      if (transcriptMessages.length > 0) {
        messages.push(...transcriptMessages);
        continue;
      }

      const historyMessages = await readAgentChatHistoryMessages(agentId, session.sessionId);
      messages.push(...historyMessages);
    }

    return NextResponse.json({
      agentId,
      sessionId: sessions[0]?.sessionId ?? null,
      source: messages.length > 0 ? "openclaw-session" : "unavailable",
      messages: dedupeRehydratedAgentChatMessages(messages).slice(-60)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "OpenClaw chat history is unavailable.")
      },
      { status: 500 }
    );
  }
}

export async function POST(
  request: Request,
  context: { params: Promise<{ agentId: string }> }
) {
  const routeParams = await Promise.resolve(context.params);
  const agentId = routeParams.agentId.trim();

  if (!agentId) {
    return NextResponse.json({ error: "Agent id is required." }, { status: 400 });
  }

  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: "agent.chat",
    method: "chat.send",
    params: { agentId },
    targetKind: "agent-session",
    targetId: agentId,
    securityClass: "privileged-mutation",
    executionPath: "gateway-or-verified-cli",
    productPermission: "runtime.use"
  });
  if ("response" in authorization) return authorization.response;

  try {
    const input = chatSchema.parse(await request.json());

    const stream = new TransformStream();
    const writer = stream.writable.getWriter();
    const encoder = new TextEncoder();
    let writeChain = Promise.resolve();
    let closed = false;

    const send = (event: AgentChatStreamEvent) => {
      const safeEvent = redactSecrets(event);
      if (closed) {
        return Promise.resolve();
      }

      writeChain = writeChain
        .then(() => writer.write(encoder.encode(`${JSON.stringify(safeEvent)}\n`)))
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
      let latestStreamAction: MissionControlAction | null = null;
      let latestStatusMessage = "";
      let latestTurnStatus: TranscriptTurn["status"] | null = null;
      let keepPolling = true;
      let streamStdoutBuffer = "";
      let activeAgentModelId: string | null = null;

      const stopPolling = () => {
        keepPolling = false;
      };

      const wait = (ms: number) => new Promise((resolve) => globalThis.setTimeout(resolve, ms));

      const emitAssistantText = async (value: string | null | undefined) => {
        const sanitizedText = sanitizeAgentChatReplyText(value);
        if (extractAgentChatSessionConflict(sanitizedText)) {
          return;
        }

        const extracted = extractMissionControlAction(sanitizedText);
        const currentText = sanitizeAgentChatVisibleText(sanitizedText);

        if (!latestStreamAction && extracted.action) {
          latestStreamAction = extracted.action;
        }

        if (!currentText || currentText === latestAssistantText) {
          return;
        }

        latestAssistantText = currentText;
        await send({
          type: "assistant",
          text: currentText
        });
      };

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
        await emitAssistantText(currentText);
      };

      const pollGatewayHistory = async (agentId: string, sessionId: string) => {
        const history = await getOpenClawAdapter().getSessionHistory(
          {
            agentId,
            sessionId,
            limit: 40
          },
          { timeoutMs: 1000 }
        );
        await emitAssistantText(extractLatestAssistantTextFromSessionHistory(history));
      };

      const handleCommandStdout = async (chunk: string) => {
        streamStdoutBuffer += chunk;
        const lines = streamStdoutBuffer.split(/\r?\n/);
        streamStdoutBuffer = lines.pop() ?? "";

        for (const line of lines) {
          await emitAssistantText(extractAssistantTextFromAgentChatStreamLine(line));
        }
      };

      const waitForLateAssistantText = async (agentId: string, sessionId: string, workspacePath?: string) => {
        const startedAt = Date.now();

        while (!latestAssistantText && Date.now() - startedAt < 6000 && !request.signal.aborted) {
          await wait(300);

          try {
            await pollTranscript(agentId, sessionId, workspacePath);
          } catch {
            // Transcript files can appear slightly after the Gateway marks a turn complete.
          }

          if (latestAssistantText) {
            return;
          }

          try {
            await pollGatewayHistory(agentId, sessionId);
          } catch {
            // Older Gateways may not expose chat history for explicit sessions.
          }
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
        activeAgentModelId = agent.modelId;

        const resolvedDefaultModelId = resolveReadyDefaultAgentModelId(snapshot);
        if (agent.modelId === "unassigned" && resolvedDefaultModelId) {
          await updateAgent({
            id: agentId,
            modelId: resolvedDefaultModelId
          }, authorization.commandOptions);
          agent.modelId = resolvedDefaultModelId;
          activeAgentModelId = agent.modelId;
        }

        const submittedMessage = input.message.trim();
        const rawMessage = input.rawMessage?.trim();
        const operatorMessage = rawMessage || submittedMessage;
        const history = normalizeAgentChatHistory(input.history ?? []).slice(-16);
        const directRename = resolveDirectAgentRenameRequest(operatorMessage, history);
        if (directRename) {
          await updateAgent({
            id: agentId,
            name: directRename
          }, authorization.commandOptions);
          clearMissionControlCaches();

          const response = applyMissionControlActionMetadata(
            {
              runId: null,
              agentId,
              status: "completed",
              summary: `Renamed agent to ${directRename}.`,
              payloads: [
                {
                  text: `Renamed agent to ${directRename}.`,
                  mediaUrl: null
                }
              ],
              meta: {
                missionControlAction: {
                  type: "rename_agent",
                  name: directRename
                }
              }
            },
            {
              type: "rename_agent",
              name: directRename
            }
          );

          await send({
            type: "done",
            ok: true,
            message: response.summary,
            response
          });
          return;
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

        const modelReadinessError = resolveOpenClawModelReadinessIssue(
          snapshot,
          agent.modelId === "unassigned" ? null : agent.modelId
        );
        if (modelReadinessError) {
          await send({
            type: "done",
            ok: false,
            message: `${modelReadinessError} Connect a provider and choose a default model before starting a chat.`
          });
          return;
        }

        const runtimeState = await inspectOpenClawRuntimeState(openClawStateRootPath, [agentId], {
          agentDirs: {
            [agentId]: agent.agentDir
          },
          touch: true
        });
        if (runtimeState.issues.length > 0) {
          await send({
            type: "done",
            ok: false,
            message:
              "AgentOS cannot write the OpenClaw session store for this agent. Start AgentOS outside the sandbox or grant write access to ~/.openclaw, then retry the chat."
          });
          clearMissionControlCaches();
          return;
        }

        await ensureOpenAiAuthOrderForAgent({
          agentId,
          modelId: agent.modelId
        });

        let message = submittedMessage;

        if (rawMessage || !isComposedAgentChatPrompt(submittedMessage)) {
          const workspaceTeamPrompt = buildWorkspaceTeamPrompt(snapshot, agent);
          const workspaceSurfacePrompt = renderWorkspaceSurfaceCoordinationMarkdownForAgent(agentId, snapshot);

          message = buildAgentChatPrompt(history, operatorMessage, {
            agentId,
            agentName: formatAgentDisplayName(agent),
            agentDir: agent.agentDir,
            workspacePath: agent.workspacePath,
            workspaceTeamPrompt,
            workspaceSurfacePrompt
          });
        }

        const sessionId = await resolveAgentChatSessionId({
          agentId,
          workspacePath: agent.workspacePath,
          reuse: false
        });

        const inFlightKey = createAgentChatSessionInFlightKey(agentId, sessionId);
        const inFlightLock = acquireAgentChatSessionTurnLock(inFlightKey);
        if (!inFlightLock) {
          await send({
            type: "done",
            ok: false,
            message: conflictedAgentChatSessionMessage
          });
          return;
        }

        try {
          await recordAgentChatSession({
            agentId,
            sessionId,
            workspacePath: agent.workspacePath
          });
          markAgentChatSessionActive({ agentId, sessionId });
          const commandPromise = getOpenClawAdapter().streamAgentTurn(
            {
              agentId,
              sessionId,
              message,
              thinking: input.thinking,
              timeoutSeconds: 90,
              workspace: agent.workspacePath,
              idempotencyKey: input.idempotencyKey,
              local: !snapshot.diagnostics.rpcOk
            },
            {
              onStdout: handleCommandStdout
            },
            {
              timeoutMs: 120000,
              signal: request.signal,
              ...authorization.commandOptions
            }
          ) as Promise<AgentChatCommandPayload>;

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
          if (streamStdoutBuffer.trim()) {
            await emitAssistantText(extractAssistantTextFromAgentChatStreamLine(streamStdoutBuffer));
            streamStdoutBuffer = "";
          }
          stopPolling();

          try {
            await pollTranscript(agentId, sessionId, agent.workspacePath);
          } catch {
            // Ignore a last transient read failure.
          }

          let response = toAgentChatResponse(agentId, result);
          if (isEmptyAgentChatResponse(response) && !latestAssistantText) {
            await waitForLateAssistantText(agentId, sessionId, agent.workspacePath);
          }

          if (latestAssistantText && response.payloads.length === 0) {
            response = {
              ...response,
              summary: latestAssistantText,
              payloads: [
                {
                  text: latestAssistantText,
                  mediaUrl: null
                }
              ]
            };
          }
          response = recoverStreamedAgentChatResponse(response, latestAssistantText);
          const emptyResponseDiagnosticMessage = resolveEmptyAgentChatDiagnosticMessage(result, {
            modelId: activeAgentModelId
          });
          response = recoverSilentOpenAiChatFailure(response, activeAgentModelId);
          response = recoverDirectIdentityResponse(response, formatAgentDisplayName(agent), operatorMessage);
          response = attachStreamMissionControlAction(response, latestStreamAction);
          response = recoverCompletedEmptyAgentChatResponse(response, emptyResponseDiagnosticMessage);
          const responseConflict = extractAgentChatSessionConflict(readAgentChatResponseDiagnosticText(response));
          if (responseConflict) {
            await forgetAgentChatSession({
              agentId: responseConflict.agentId,
              sessionId: responseConflict.sessionId
            }).catch(() => {});
            await send({
              type: "done",
              ok: false,
              message: conflictedAgentChatSessionMessage
            });
            return;
          }

          if (isEmptyAgentChatResponse(response)) {
            await send({
              type: "done",
              ok: false,
              message: emptyResponseDiagnosticMessage ?? emptyAgentChatResponseMessage
            });
            return;
          }

          const action = readMissionControlAction(response.meta);

          if (action?.type === "rename_agent") {
            await updateAgent({
              id: agentId,
              name: action.name
            }, authorization.commandOptions);
          }

          clearMissionControlCaches();

          await send({
            type: "done",
            ok: true,
            message: response.summary,
            response: applyMissionControlActionMetadata(response, action)
          });
        } finally {
          markAgentChatSessionInactive({ agentId, sessionId });
          releaseAgentChatSessionTurnLock(inFlightKey, inFlightLock);
        }
      } catch (error) {
        stopPolling();

        if (request.signal.aborted) {
          return;
        }

        const rawFailure = redactSecretText(stringifyCommandFailure(error) || redactErrorMessage(error, ""));
        const agentRegistryFailureMessage = resolveGatewayAgentRegistryFailureMessage(rawFailure, agentId);
        const failureMessage =
          resolveOpenClawRuntimeFailureMessage(rawFailure, { modelId: activeAgentModelId }) ||
          agentRegistryFailureMessage ||
          resolveAgentChatRuntimeFailureMessage(rawFailure) ||
          (error instanceof Error
            ? redactSecretText(error.message)
            : "OpenClaw could not send the message right now. Please try again.");

        const conflictedSession = extractAgentChatSessionConflict(rawFailure);
        if (conflictedSession) {
          await forgetAgentChatSession({
            agentId: conflictedSession.agentId,
            sessionId: conflictedSession.sessionId
          }).catch(() => {});
        }

        if (agentRegistryFailureMessage) {
          clearMissionControlCaches();
        }

        if (isOpenAiAuthFailure(rawFailure) || isOpenAiAuthFailure(failureMessage)) {
          await persistRuntimeSmokeTest({
            status: "failed",
            checkedAt: new Date().toISOString(),
            agentId,
            runId: null,
            summary: null,
            error: failureMessage
          }).catch(() => {});
          clearMissionControlCaches();
        }

        await send({
          type: "done",
          ok: false,
          message: failureMessage
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
          redactErrorMessage(error, "OpenClaw could not send the message right now. Please try again.")
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

async function readAgentChatHistoryMessages(agentId: string, sessionId: string): Promise<RehydratedAgentChatMessage[]> {
  try {
    const history = await getOpenClawAdapter().getSessionHistory(
      {
        agentId,
        sessionId,
        limit: 60
      },
      { timeoutMs: 1500 }
    );

    return extractAgentChatMessagesFromSessionHistory(history).map((message, index) => ({
      id: message.id ? `openclaw-history:${sessionId}:${message.id}` : `openclaw-history:${sessionId}:${index}`,
      role: message.role,
      text: message.text,
      createdAt: normalizeAgentChatMessageTimestamp(message.timestamp, index),
      status: "sent" as const,
      runId: null,
      submissionId: message.idempotencyKey,
      messageSeq: message.messageSeq
    }));
  } catch {
    return [];
  }
}

function dedupeRehydratedAgentChatMessages(messages: RehydratedAgentChatMessage[]) {
  const byId = new Map<string, RehydratedAgentChatMessage>();

  for (const message of messages) {
    const text = message.text.replace(/\s+/g, " ").trim();
    if (!text) {
      continue;
    }

    const existing = byId.get(message.id);
    if (!existing || message.createdAt > existing.createdAt) {
      byId.set(message.id, {
        ...message,
        text
      });
    }
  }

  return [...byId.values()].sort((left, right) => left.createdAt - right.createdAt);
}

function normalizeAgentChatMessageTimestamp(value: string | number | null, index: number) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim()) {
    const parsed = Date.parse(value);
    if (!Number.isNaN(parsed)) {
      return parsed;
    }
  }

  return Date.now() + index;
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

  const latestItem = turn.items.at(-1);

  if (latestItem?.role === "toolCall") {
    return `Agent is using ${formatAgentChatToolName(latestItem.toolName)}...`;
  }

  if (latestItem?.role === "toolResult") {
    return `Agent received a result from ${formatAgentChatToolName(latestItem.toolName)}.`;
  }

  if (turn.finalText && turn.finalText.trim().length > 0) {
    return "Agent is finalizing the reply...";
  }

  return "Agent is thinking...";
}

function formatAgentChatToolName(toolName: string | undefined) {
  const normalized = toolName?.trim().replace(/[_-]+/g, " ");

  if (!normalized) {
    return "a tool";
  }

  return `the ${normalized} tool`;
}

function sanitizePolledAssistantText(value: string) {
  return sanitizeAgentChatVisibleText(value);
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

  const hasResponseText = Boolean(
    extractedSummary.cleanText ||
      payloads.map((entry) => entry.text).filter(Boolean).join("\n\n") ||
      (action?.type === "rename_agent" ? action.name : "")
  );
  const summary =
    extractedSummary.cleanText ||
    payloads.map((entry) => entry.text).filter(Boolean).join("\n\n") ||
    (action?.type === "rename_agent" ? `Renamed agent to ${action.name}.` : "") ||
    emptyAgentChatResponseMessage;
  const status = normalizeStatus(resolveAgentChatStatus(payload, resultPayload));
  const meta = action
    ? {
        ...resultPayload.meta,
        missionControlAction: action
      }
    : resultPayload.meta;

  return {
    runId: typeof payload.runId === "string" && payload.runId.trim() ? payload.runId : null,
    agentId,
    status: hasResponseText ? status : "stalled",
    summary,
    payloads,
    meta: hasResponseText ? meta : { ...meta, emptyAgentChatResponse: true, emptyAgentChatStatus: status }
  };
}

function isEmptyAgentChatResponse(response: MissionResponse) {
  return response.meta?.emptyAgentChatResponse === true;
}

function createAgentChatSessionInFlightKey(agentId: string, sessionId: string) {
  return `${agentId.trim()}:${sessionId.trim()}`;
}

function acquireAgentChatSessionTurnLock(key: string) {
  const now = Date.now();
  const existing = activeAgentChatSessionTurns.get(key);

  if (existing && now - existing.startedAt < agentChatSessionTurnLockTtlMs) {
    return null;
  }

  const lockId = Symbol(key);
  activeAgentChatSessionTurns.set(key, {
    lockId,
    startedAt: now
  });

  return lockId;
}

function releaseAgentChatSessionTurnLock(key: string, lockId: symbol) {
  if (activeAgentChatSessionTurns.get(key)?.lockId === lockId) {
    activeAgentChatSessionTurns.delete(key);
  }
}

function extractAgentChatSessionConflict(rawFailure: string) {
  const match = rawFailure.match(/reply session initialization conflicted for agent:([^:\s]+):explicit:([0-9a-f-]+)/i);

  if (!match?.[1] || !match[2]) {
    return null;
  }

  return {
    agentId: match[1],
    sessionId: match[2]
  };
}

function readAgentChatResponseDiagnosticText(response: MissionResponse) {
  return [
    response.summary,
    ...response.payloads.map((entry) => entry.text)
  ].join("\n");
}

function resolveDirectAgentRenameRequest(
  operatorMessage: string,
  history: Array<{ role: "user" | "assistant"; text: string }>
) {
  const explicitName = extractDirectAgentRenameName(operatorMessage);
  if (explicitName) {
    return explicitName;
  }

  if (!/\b(?:change|update|set)\b.*\b(?:card|display|name)\b/i.test(operatorMessage) &&
    !/(?:kart|card).*(?:ad|name)|(?:ad|name).*(?:kart|card)/i.test(operatorMessage)) {
    return null;
  }

  for (let index = history.length - 1; index >= 0; index -= 1) {
    const entry = history[index];
    const historyName = extractDirectAgentRenameName(entry.text) || extractAcceptedAgentName(entry.text);

    if (historyName) {
      return historyName;
    }
  }

  return null;
}

function extractDirectAgentRenameName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const patterns = [
    /\b(?:rename (?:yourself|you|this agent|agent) to|set (?:your )?(?:display )?name to|call yourself)\s+(.{1,80})$/i,
    /(?:ad(?:ı|i)n|ism(?:i|ı)n)\s+(.{1,80}?)(?:\s+olsun)?[.!?]*$/i,
    /(?:ad(?:ı|i)n(?:ı|i)|ism(?:i|ı)n(?:i|ı))\s+(.{1,80}?)\s+(?:yap|koy|de(?:g|ğ)i(?:s|ş)tir)[.!?]*$/i
  ];

  for (const pattern of patterns) {
    const match = normalized.match(pattern);
    const name = normalizeDirectAgentRenameName(match?.[1]);

    if (name) {
      return name;
    }
  }

  return null;
}

function extractAcceptedAgentName(value: string) {
  const normalized = value.replace(/\s+/g, " ").trim();
  const match = normalized.match(/(?:ad(?:ı|i)n|name)(?:\s+(?:is|art(?:ı|i)k))?\s+\*{0,2}(.{1,80}?)\*{0,2}(?:[.!?]|$)/i);

  return normalizeDirectAgentRenameName(match?.[1]);
}

function normalizeDirectAgentRenameName(value: unknown) {
  if (typeof value !== "string") {
    return null;
  }

  const stripped = value
    .replace(/<[^>]+>/g, "")
    .replace(/[`*_#"“”‘’'.,!?]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!stripped || stripped.length > 48 || /\b(?:ne|what|who|kim|neden|why)\b/i.test(stripped)) {
    return null;
  }

  return stripped;
}

function recoverCompletedEmptyAgentChatResponse(
  response: MissionResponse,
  diagnosticMessage?: string | null
): MissionResponse {
  if (!isCompletedEmptyAgentChatResponse(response)) {
    return response;
  }

  const message = diagnosticMessage ?? completedEmptyAgentChatResponseMessage;

  return {
    ...response,
    status: "completed",
    summary: message,
    payloads: [
      {
        text: message,
        mediaUrl: null
      }
    ],
    meta: {
      ...response.meta,
      emptyAgentChatResponse: false,
      emptyAgentChatCompletedWithoutText: true
    }
  };
}

function recoverSilentOpenAiChatFailure(response: MissionResponse, modelId?: string | null): MissionResponse {
  if (!modelId || !isOpenAiBackedModel(modelId) || response.status !== "stalled") {
    return response;
  }

  const responseText = [response.summary, ...response.payloads.map((entry) => entry.text)].join("\n\n");
  if (!/OpenClaw Gateway reported the chat stream failed before assistant text was available\./i.test(responseText)) {
    return response;
  }

  const message = [
    "OpenClaw reported the OpenAI chat stream failed before assistant text was available, but did not expose the provider error.",
    "Reconnect the OpenAI provider, then retry this message.",
    "If it repeats after reconnecting, inspect `openclaw logs --follow`."
  ].join(" ");

  return {
    ...response,
    summary: message,
    payloads: [
      {
        text: message,
        mediaUrl: null
      }
    ]
  };
}

function resolveEmptyAgentChatDiagnosticMessage(
  payload: AgentChatCommandPayload,
  options: {
    modelId?: string | null;
  } = {}
) {
  const diagnosticText = extractAgentChatEmptyResponseDiagnosticText(payload);

  if (!diagnosticText) {
    return null;
  }

  return (
    resolveOpenClawRuntimeFailureMessage(diagnosticText, options) ||
    resolveAgentChatRuntimeFailureMessage(diagnosticText) ||
    `OpenClaw completed the chat turn without assistant text, but exposed this diagnostic: ${diagnosticText}`
  );
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

function attachStreamMissionControlAction(
  response: MissionResponse,
  action: MissionControlAction | null
): MissionResponse {
  if (!action || readMissionControlAction(response.meta)) {
    return response;
  }

  return {
    ...response,
    meta: {
      ...response.meta,
      missionControlAction: action
    }
  };
}

function resolveGatewayAgentRegistryFailureMessage(output: string, agentId: string) {
  if (!isGatewayAgentRegistryMissingFailure(output, agentId)) {
    return null;
  }

  return `OpenClaw Gateway has not loaded agent "${agentId}" yet. AgentOS refreshed local state; restart the OpenClaw Gateway from System Setup or Settings, then retry chat.`;
}

function isGatewayAgentRegistryMissingFailure(output: string, agentId: string) {
  const normalized = output.replace(/\s+/g, " ").trim();

  if (!normalized || !/\bagent\b/i.test(normalized) || !/\bnot found\b/i.test(normalized)) {
    return false;
  }

  const escapedAgentId = escapeRegExp(agentId);
  return new RegExp(`\\bagent\\s+["'\`]?${escapedAgentId}["'\`]?\\s+not\\s+found\\b`, "i").test(normalized);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
