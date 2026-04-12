import { NextResponse } from "next/server";
import { z } from "zod";

import { submitWorkspacePlanTurn } from "@/lib/agentos/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const turnSchema = z.object({
  message: z.string().min(1),
  plan: z.any().optional()
});

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      planId: string;
    }>;
  }
) {
  try {
    const { planId } = await context.params;
    const input = turnSchema.parse(await request.json());
    const result = await submitWorkspacePlanTurn(planId, input.message, input.plan);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to process planner turn."
      },
      { status: 400 }
    );
  }
}
