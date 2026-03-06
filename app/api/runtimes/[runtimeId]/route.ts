import { NextResponse } from "next/server";

import { getRuntimeOutput } from "@/lib/openclaw/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  _request: Request,
  context: { params: Promise<{ runtimeId: string }> }
) {
  try {
    const { runtimeId } = await context.params;
    const output = await getRuntimeOutput(decodeURIComponent(runtimeId));
    return NextResponse.json(output);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to load runtime output."
      },
      { status: 400 }
    );
  }
}
