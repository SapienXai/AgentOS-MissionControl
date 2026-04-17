import { NextResponse } from "next/server";

import { discoverSurfaceRoutes } from "@/lib/agentos/control-plane";
import { createTimingCollector, formatTimingSummary, measureTiming } from "@/lib/openclaw/timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const timings = createTimingCollector("workspace-surface-discovery");

  try {
    await context.params;

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider")?.trim() ?? "";
    const accountId = searchParams.get("accountId")?.trim() || null;
    const supported = provider === "telegram" || provider === "discord";
    const routes = supported
      ? await measureTiming(timings, "surface.discovery", () => discoverSurfaceRoutes({ provider, accountId }, timings))
      : [];

    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json({
      provider,
      accountId,
      routes,
      supported,
      timings: summary
    });
  } catch (error) {
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to discover integration routes.",
        timings: summary
      },
      { status: 400 }
    );
  }
}
