import { NextResponse } from "next/server";
import { z } from "zod";

import { getWorkspacePlan, updateWorkspacePlan } from "@/lib/agentos/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const planUpdateSchema = z.object({
  plan: z.any()
});

export async function GET(
  _request: Request,
  context: {
    params: Promise<{
      planId: string;
    }>;
  }
) {
  try {
    const { planId } = await context.params;
    const result = await getWorkspacePlan(planId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load planner workspace."
      },
      { status: 404 }
    );
  }
}

export async function PUT(
  request: Request,
  context: {
    params: Promise<{
      planId: string;
    }>;
  }
) {
  try {
    const { planId } = await context.params;
    const input = planUpdateSchema.parse(await request.json());
    const result = await updateWorkspacePlan(planId, input.plan);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save planner workspace."
      },
      { status: 400 }
    );
  }
}
