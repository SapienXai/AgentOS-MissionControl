import { NextResponse } from "next/server";

import { discoverSurfaceRoutes, getMissionControlSnapshot } from "@/lib/openclaw/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    let snapshot = await getMissionControlSnapshot();
    let workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

    if (!workspace) {
      snapshot = await getMissionControlSnapshot({ force: true });
      workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);
    }

    if (!workspace) {
      return NextResponse.json({ error: "Workspace was not found." }, { status: 404 });
    }

    const { searchParams } = new URL(request.url);
    const provider = searchParams.get("provider")?.trim() ?? "";
    const accountId = searchParams.get("accountId")?.trim() || null;
    const supported = provider === "telegram" || provider === "discord";

    return NextResponse.json({
      provider,
      accountId,
      routes: supported ? await discoverSurfaceRoutes({ provider, accountId }) : [],
      supported
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to discover integration routes."
      },
      { status: 400 }
    );
  }
}
