import { NextResponse } from "next/server";

import { discoverTelegramGroups, getMissionControlSnapshot } from "@/lib/openclaw/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
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

    const groups = await discoverTelegramGroups();
    return NextResponse.json({ groups });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to discover Telegram groups."
      },
      { status: 400 }
    );
  }
}
