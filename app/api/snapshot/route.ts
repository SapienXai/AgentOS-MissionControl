import { NextResponse } from "next/server";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const force = searchParams.get("force") === "true";
  const snapshot = await getMissionControlSnapshot(force ? { force: true } : {});
  return NextResponse.json(snapshot);
}
