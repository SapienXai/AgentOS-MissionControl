import { NextResponse } from "next/server";

import { createWorkspacePlan } from "@/lib/agentos/planner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST() {
  try {
    const result = await createWorkspacePlan();
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create planner workspace."
      },
      { status: 400 }
    );
  }
}
