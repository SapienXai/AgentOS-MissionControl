import { getMissionControlSnapshot } from "@/lib/openclaw/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();

export async function GET(request: Request) {
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;

  const stream = new ReadableStream({
    async start(controller) {
      const cleanup = () => {
        if (interval) {
          clearInterval(interval);
          interval = undefined;
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
          // Stream may already be closed by the runtime.
        }
      };

      const sendEvent = (event: string, data: unknown) => {
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

      const handleAbort = () => {
        close();
      };

      request.signal.addEventListener("abort", handleAbort);

      const sendSnapshot = async () => {
        if (closed) {
          return;
        }

        try {
          const snapshot = await getMissionControlSnapshot({ force: true });
          sendEvent("snapshot", snapshot);
        } catch (error) {
          sendEvent("error", {
            error: error instanceof Error ? error.message : "Unknown stream error."
          });
        }
      };

      await sendSnapshot();

      interval = setInterval(() => {
        void sendSnapshot();
      }, 8000);

      sendEvent("ready", { ok: true });
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
