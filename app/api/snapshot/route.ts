import { NextResponse } from "next/server";

import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const snapshot = await getMissionControlSnapshot({ force: true });
  return NextResponse.json(snapshot);
}
