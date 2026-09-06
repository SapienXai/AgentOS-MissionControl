import { NextResponse } from "next/server";

import { getOpenClawLifecycleService } from "@/lib/openclaw/lifecycle/service";

export const dynamic = "force-dynamic";

export async function GET() {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 1_500);

  try {
    const response = await fetch("http://127.0.0.1:18789/healthz", {
      cache: "no-store",
      signal: controller.signal
    });

    if (!response.ok) {
      return NextResponse.json(
        { status: "starting" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    const gateway = await getOpenClawLifecycleService().inspect().catch(() => null);
    if (!gateway?.ready) {
      return NextResponse.json(
        { status: "starting" },
        { status: 503, headers: { "Cache-Control": "no-store" } }
      );
    }

    return NextResponse.json(
      { status: "ok" },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch {
    return NextResponse.json(
      { status: "starting" },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  } finally {
    clearTimeout(timeout);
  }
}
