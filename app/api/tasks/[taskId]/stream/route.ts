import { getTaskDetail } from "@/lib/agentos/control-plane";
import type { TaskDetailStreamEvent } from "@/lib/agentos/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId: rawTaskId } = await context.params;
  const taskId = decodeURIComponent(rawTaskId);
  const dispatchId = new URL(request.url).searchParams.get("dispatchId");
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let taskRequest: Promise<void> | null = null;

  const stream = new ReadableStream({
    async start(controller) {
      const handleAbort = () => {
        close();
      };

      const cleanup = () => {
        if (interval) {
          clearInterval(interval);
          interval = undefined;
        }

        request.signal.removeEventListener("abort", handleAbort);
      };

      const sendEvent = (event: string, data: TaskDetailStreamEvent) => {
        if (closed) {
          return false;
        }

        try {
          controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
          return true;
        } catch {
          close();
          return false;
        }
      };

      const close = () => {
        if (closed) {
          return;
        }

        closed = true;
        cleanup();

        try {
          controller.close();
        } catch {
          // Stream may already be closed.
        }
      };

      request.signal.addEventListener("abort", handleAbort);

      const sendTask = async () => {
        if (closed) {
          return;
        }

        if (taskRequest) {
          return taskRequest;
        }

        taskRequest = (async () => {
          try {
            const detail = await getTaskDetail(taskId, { dispatchId });
            sendEvent("task", { type: "task", detail });
          } catch (error) {
            sendEvent("task-error", {
              type: "error",
              error: error instanceof Error ? error.message : "Unable to load task detail."
            });
          } finally {
            taskRequest = null;
          }
        })();

        return taskRequest;
      };

      await sendTask();
      interval = setInterval(() => {
        void sendTask();
      }, 3000);
      sendEvent("ready", { type: "ready", ok: true });
    },
    cancel() {
      closed = true;

      if (interval) {
        clearInterval(interval);
      }
    }
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive"
    }
  });
}
