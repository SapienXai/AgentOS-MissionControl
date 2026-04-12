import { NextResponse } from "next/server";

import { createWorkspaceEditDraft } from "@/lib/agentos/application/workspace-edit-draft";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      workspaceId: string;
    }>;
  }
) {
  try {
    const { workspaceId } = await context.params;
    const result = await createWorkspaceEditDraft(workspaceId);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create workspace edit draft."
      },
      { status: 400 }
    );
  }
}
