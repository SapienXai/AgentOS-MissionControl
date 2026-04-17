import { NextResponse } from "next/server";

import { discoverTelegramGroups } from "@/lib/agentos/control-plane";
import { createTimingCollector, formatTimingSummary, measureTiming } from "@/lib/openclaw/timing";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const timings = createTimingCollector("workspace-telegram-discovered-groups");

  try {
    await context.params;

    const groups = (await measureTiming(timings, "telegram.discovery", () => discoverTelegramGroups(timings))).map((route) => ({
      chatId: route.routeId,
      title: route.title ?? null,
      lastSeen: route.lastSeen
    }));
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json({ groups, timings: summary });
  } catch (error) {
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to discover Telegram groups.",
        timings: summary
      },
      { status: 400 }
    );
  }
}
