import { NextResponse } from "next/server";
import { z } from "zod";

import { abortMissionTask } from "@/lib/agentos/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const abortRequestSchema = z.object({
  reason: z.string().trim().max(512).optional().nullable(),
  dispatchId: z.string().trim().min(1).optional().nullable()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId: rawTaskId } = await context.params;
  const taskId = decodeURIComponent(rawTaskId);

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parseResult = abortRequestSchema.safeParse(payload);

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: parseResult.error.message
      },
      { status: 400 }
    );
  }

  try {
    const result = await abortMissionTask(taskId, parseResult.data.reason ?? null, parseResult.data.dispatchId ?? null);
    return NextResponse.json({
      result
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to abort the task."
      },
      { status: 400 }
    );
  }
}
