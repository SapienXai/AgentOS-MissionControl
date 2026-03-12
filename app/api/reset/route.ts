import { NextResponse } from "next/server";
import { z } from "zod";

import { executeReset, getResetPreview } from "@/lib/openclaw/reset";
import type { ResetStreamEvent } from "@/lib/openclaw/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const resetTargetSchema = z.enum(["mission-control", "full-uninstall"]);

const previewRequestSchema = z.object({
  intent: z.literal("preview"),
  target: resetTargetSchema
});

const executeRequestSchema = z.object({
  intent: z.literal("execute"),
  target: resetTargetSchema,
  confirmed: z.literal(true)
});

export async function POST(request: Request) {
  let payload: unknown;

  try {
    payload = await request.json();
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Reset request body is required."
      },
      { status: 400 }
    );
  }

  const previewParse = previewRequestSchema.safeParse(payload);

  if (previewParse.success) {
    try {
      const preview = await getResetPreview(previewParse.data.target);
      return NextResponse.json({
        preview
      });
    } catch (error) {
      return NextResponse.json(
        {
          error: error instanceof Error ? error.message : "Unable to prepare the reset preview."
        },
        { status: 400 }
      );
    }
  }

  const executeParse = executeRequestSchema.safeParse(payload);

  if (!executeParse.success) {
    return NextResponse.json(
      {
        error: executeParse.error.message
      },
      { status: 400 }
    );
  }

  const stream = new TransformStream();
  const writer = stream.writable.getWriter();
  const encoder = new TextEncoder();
  let writeChain = Promise.resolve();

  const send = (event: ResetStreamEvent) => {
    writeChain = writeChain
      .then(() => writer.write(encoder.encode(`${JSON.stringify(event)}\n`)))
      .catch(() => {});

    return writeChain;
  };

  void (async () => {
    try {
      const result = await executeReset(executeParse.data.target, {
        onEvent: send
      });

      await send({
        type: "done",
        ok: true,
        target: executeParse.data.target,
        message: result.message,
        snapshot: result.snapshot,
        backgroundLogPath: result.backgroundLogPath
      });
    } catch (error) {
      await send({
        type: "done",
        ok: false,
        target: executeParse.data.target,
        message: error instanceof Error ? error.message : "Reset operation failed."
      });
    } finally {
      await writeChain;
      await writer.close();
    }
  })();

  return new Response(stream.readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
