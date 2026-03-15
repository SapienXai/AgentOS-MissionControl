import { getMissionControlSnapshot } from "@/lib/openclaw/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const encoder = new TextEncoder();
const STREAM_SNAPSHOT_INTERVAL_MS = 12_000;

export async function GET(request: Request) {
  let interval: ReturnType<typeof setInterval> | undefined;
  let closed = false;
  let snapshotTask: Promise<void> | null = null;

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

      request.signal.addEventListener("abort", handleAbort);

      const sendSnapshot = async () => {
        if (closed) {
          return;
        }

        if (snapshotTask) {
          return snapshotTask;
        }

        snapshotTask = (async () => {
          try {
            const snapshot = await getMissionControlSnapshot();
            sendEvent("snapshot", snapshot);
          } catch (error) {
            sendEvent("error", {
              error: error instanceof Error ? error.message : "Unknown stream error."
            });
          } finally {
            snapshotTask = null;
          }
        })();

        return snapshotTask;
      };

      await sendSnapshot();

      interval = setInterval(() => {
        void sendSnapshot();
      }, STREAM_SNAPSHOT_INTERVAL_MS);

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
