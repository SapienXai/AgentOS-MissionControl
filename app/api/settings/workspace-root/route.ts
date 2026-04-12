import { NextResponse } from "next/server";
import { z } from "zod";

import { updateWorkspaceRoot } from "@/lib/agentos/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workspaceRootSettingsSchema = z.object({
  workspaceRoot: z.string().max(2048).optional().nullable()
});

export async function PATCH(request: Request) {
  try {
    const input = workspaceRootSettingsSchema.parse(await request.json());
    const snapshot = await updateWorkspaceRoot({
      workspaceRoot: input.workspaceRoot ?? null
    });

    return NextResponse.json({
      snapshot
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update the workspace root."
      },
      { status: 400 }
    );
  }
}
