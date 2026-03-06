import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  getMissionControlSnapshot,
  updateWorkspaceProject
} from "@/lib/openclaw/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const workspaceSchema = z.object({
  name: z.string().min(1),
  directory: z.string().optional(),
  modelId: z.string().optional()
});

const workspaceUpdateSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().optional(),
  directory: z.string().optional()
});

const workspaceDeleteSchema = z.object({
  workspaceId: z.string().min(1)
});

export async function GET() {
  const snapshot = await getMissionControlSnapshot({ force: true });
  return NextResponse.json({
    workspaces: snapshot.workspaces
  });
}

export async function POST(request: Request) {
  try {
    const input = workspaceSchema.parse(await request.json());
    const created = await createWorkspaceProject(input);

    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create workspace."
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const input = workspaceUpdateSchema.parse(await request.json());
    const updated = await updateWorkspaceProject(input);

    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update workspace."
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const input = workspaceDeleteSchema.parse(await request.json());
    const deleted = await deleteWorkspaceProject(input);

    return NextResponse.json(deleted);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to delete workspace."
      },
      { status: 400 }
    );
  }
}
