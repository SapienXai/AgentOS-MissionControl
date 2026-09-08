import { createServer, type IncomingMessage, type ServerResponse } from "node:http";

export const OPENCLAW_RUNTIME_FIXTURE_MODEL_ID = "agentos-runtime-fixture";

export type OpenClawRuntimeProviderFixture = {
  baseUrl: string;
  modelId: string;
  stats: {
    requestCount: number;
    completionCount: number;
    streamingCompletionCount: number;
    lastPrompt: string;
  };
  close: () => Promise<void>;
};

type FixtureToolCall = {
  id: string;
  name: "write" | "sessions_spawn";
  arguments: Record<string, unknown>;
};

type FixtureResponse = {
  content?: string;
  toolCall?: FixtureToolCall;
  delayMs?: number;
};

export async function createOpenClawRuntimeProviderFixture(input: {
  modelId?: string;
} = {}): Promise<OpenClawRuntimeProviderFixture> {
  const modelId = input.modelId ?? OPENCLAW_RUNTIME_FIXTURE_MODEL_ID;
  const stats = {
    requestCount: 0,
    completionCount: 0,
    streamingCompletionCount: 0,
    lastPrompt: ""
  };

  const server = createServer((request, response) => {
    void handleRequest(request, response, modelId, stats);
  });

  await new Promise<void>((resolve, reject) => {
    const onError = (error: Error) => {
      server.off("listening", onListening);
      reject(error);
    };
    const onListening = () => {
      server.off("error", onError);
      resolve();
    };
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(0, "127.0.0.1");
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    await closeServer(server);
    throw new Error("Loopback provider fixture did not expose a TCP address.");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}/v1`,
    modelId,
    stats,
    close: () => closeServer(server)
  };
}

async function handleRequest(
  request: IncomingMessage,
  response: ServerResponse,
  modelId: string,
  stats: OpenClawRuntimeProviderFixture["stats"]
) {
  stats.requestCount += 1;

  if (request.method === "GET" && request.url === "/v1/models") {
    writeJson(response, 200, {
      object: "list",
      data: [{ id: modelId, object: "model", owned_by: "agentos-runtime-certification" }]
    });
    return;
  }

  if (request.method !== "POST" || request.url !== "/v1/chat/completions") {
    writeJson(response, 404, { error: { message: "Not found", type: "invalid_request_error" } });
    return;
  }

  try {
    const payload = JSON.parse(await readBody(request)) as { stream?: boolean; messages?: unknown };
    const stream = payload.stream === true;
    const prompt = readLastUserMessage(payload.messages);
    stats.lastPrompt = prompt;
    const fixtureResponse = resolveFixtureResponse(prompt, payload.messages);
    stats.completionCount += 1;
    if (stream) stats.streamingCompletionCount += 1;

    if (fixtureResponse.delayMs) {
      await wait(fixtureResponse.delayMs);
    }

    if (stream) {
      writeStreamingResponse(response, modelId, fixtureResponse);
      return;
    }

    writeJson(response, 200, {
      id: `agentos-fixture-${stats.completionCount}`,
      object: "chat.completion",
      created: Math.floor(Date.now() / 1000),
      model: modelId,
      choices: [{
        index: 0,
        message: fixtureResponse.toolCall
          ? {
              role: "assistant",
              content: null,
              tool_calls: [{
                index: 0,
                id: fixtureResponse.toolCall.id,
                type: "function",
                function: {
                  name: fixtureResponse.toolCall.name,
                  arguments: JSON.stringify(fixtureResponse.toolCall.arguments)
                }
              }]
            }
          : { role: "assistant", content: fixtureResponse.content ?? "" },
        finish_reason: fixtureResponse.toolCall ? "tool_calls" : "stop"
      }],
      usage: { prompt_tokens: 1, completion_tokens: (fixtureResponse.content ?? "").length, total_tokens: (fixtureResponse.content ?? "").length + 1 }
    });
  } catch {
    writeJson(response, 400, { error: { message: "Invalid JSON request", type: "invalid_request_error" } });
  }
}

function resolveFixtureResponse(prompt: string, messages: unknown): FixtureResponse {
  const hasToolResult = Array.isArray(messages) && messages.some((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const role = (entry as { role?: unknown }).role;
    return role === "tool" || role === "toolResult";
  });

  if (/WORKFORCE_ACCEPTANCE_ARTIFACT/i.test(prompt) && !hasToolResult) {
    return {
      toolCall: {
        id: "agentos-acceptance-write",
        name: "write",
        arguments: {
          path: "deliverables/acceptance-result.txt",
          content: "AgentOS Workforce 2026.9.3 artifact acceptance.\n"
        }
      }
    };
  }

  if (/WORKFORCE_ACCEPTANCE_DELEGATION/i.test(prompt) && !hasToolResult) {
    return {
      toolCall: {
        id: "agentos-acceptance-spawn",
        name: "sessions_spawn",
        arguments: {
          task: "WORKFORCE_ACCEPTANCE_CHILD",
          taskName: "acceptance-child",
          label: "Acceptance child",
          runtime: "subagent",
          agentId: "main",
          mode: "run",
          cleanup: "keep",
          expectsCompletionMessage: true
        }
      }
    };
  }

  if (/WORKFORCE_ACCEPTANCE_CHILD/i.test(prompt)) {
    return {
      content: "AGENTOS_FIXTURE_CHILD_REPLY",
      delayMs: 3_000
    };
  }

  if (/CRON/i.test(prompt)) return { content: "AGENTOS_FIXTURE_CRON_REPLY" };
  if (/SECOND|CONTINUITY/i.test(prompt)) return { content: "AGENTOS_FIXTURE_SECOND_REPLY" };
  if (/WORKFORCE_ACCEPTANCE_ARTIFACT/i.test(prompt)) return { content: "AGENTOS_FIXTURE_ARTIFACT_REPLY" };
  if (/WORKFORCE_ACCEPTANCE_DELEGATION/i.test(prompt)) return { content: "AGENTOS_FIXTURE_DELEGATION_REPLY" };
  return { content: "AGENTOS_FIXTURE_FIRST_REPLY" };
}

function readLastUserMessage(messages: unknown): string {
  if (!Array.isArray(messages)) return "";
  const userMessages = messages.filter((entry) => (
    entry && typeof entry === "object" && (entry as { role?: unknown }).role === "user"
  ));
  const content = userMessages.map((message) => readMessageContent(message && typeof message === "object" ? (message as { content?: unknown }).content : null)).filter(Boolean).join("\n");
  return content;
}

function readMessageContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (Array.isArray(content)) {
    return content.map((part) => {
      if (typeof part === "string") return part;
      if (!part || typeof part !== "object") return "";
      const record = part as { text?: unknown; value?: unknown };
      return typeof record.text === "string" ? record.text : typeof record.value === "string" ? record.value : "";
    }).join(" ");
  }
  if (content && typeof content === "object") {
    const record = content as { text?: unknown; value?: unknown };
    return typeof record.text === "string" ? record.text : typeof record.value === "string" ? record.value : "";
  }
  return "";
}

function writeStreamingResponse(response: ServerResponse, modelId: string, fixtureResponse: FixtureResponse) {
  response.writeHead(200, {
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive"
  });
  const id = `agentos-fixture-stream-${Date.now()}`;
  if (fixtureResponse.toolCall) {
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: { role: "assistant", content: null, tool_calls: [{ index: 0, id: fixtureResponse.toolCall.id, type: "function", function: { name: fixtureResponse.toolCall.name, arguments: JSON.stringify(fixtureResponse.toolCall.arguments) } }] }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "tool_calls" }] })}\n\n`);
  } else {
    const content = fixtureResponse.content ?? "";
    const splitAt = Math.max(1, Math.floor(content.length / 2));
    const chunks = [content.slice(0, splitAt), content.slice(splitAt)];
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: { role: "assistant", content: chunks[0] }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: { content: chunks[1] }, finish_reason: null }] })}\n\n`);
    response.write(`data: ${JSON.stringify({ id, object: "chat.completion.chunk", created: Math.floor(Date.now() / 1000), model: modelId, choices: [{ index: 0, delta: {}, finish_reason: "stop" }] })}\n\n`);
  }
  response.end("data: [DONE]\n\n");
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(response: ServerResponse, statusCode: number, payload: unknown) {
  response.writeHead(statusCode, { "Content-Type": "application/json" });
  response.end(JSON.stringify(payload));
}

function readBody(request: IncomingMessage) {
  return new Promise<string>((resolve, reject) => {
    let body = "";
    request.setEncoding("utf8");
    request.on("data", (chunk: string) => {
      body += chunk;
    });
    request.once("end", () => resolve(body));
    request.once("error", reject);
  });
}

function closeServer(server: ReturnType<typeof createServer>) {
  return new Promise<void>((resolve, reject) => {
    server.close((error) => error ? reject(error) : resolve());
  });
}
