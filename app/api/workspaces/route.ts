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

const agentPolicySchema = z.object({
  preset: z.enum(["worker", "setup", "browser", "monitoring", "custom"]),
  missingToolBehavior: z.enum(["fallback", "ask-setup", "route-setup", "allow-install"]),
  installScope: z.enum(["none", "workspace", "system"]),
  fileAccess: z.enum(["workspace-only", "extended"]),
  networkAccess: z.enum(["restricted", "enabled"])
});

const heartbeatSchema = z.object({
  enabled: z.boolean(),
  every: z.string().optional()
});

const workspaceSchema = z.object({
  name: z.string().min(1),
  brief: z.string().optional(),
  directory: z.string().optional(),
  modelId: z.string().optional(),
  sourceMode: z.enum(["empty", "clone", "existing"]).optional(),
  repoUrl: z.string().optional(),
  existingPath: z.string().optional(),
  template: z.enum(["software", "frontend", "backend", "research", "content"]).optional(),
  teamPreset: z.enum(["solo", "core", "custom"]).optional(),
  modelProfile: z.enum(["balanced", "fast", "quality"]).optional(),
  rules: z
    .object({
      workspaceOnly: z.boolean().optional(),
      generateStarterDocs: z.boolean().optional(),
      generateMemory: z.boolean().optional(),
      kickoffMission: z.boolean().optional()
    })
    .optional(),
  agents: z
    .array(
      z.object({
        id: z.string().min(1),
        role: z.string().min(1),
        name: z.string().min(1),
        enabled: z.boolean(),
        emoji: z.string().optional(),
        theme: z.string().optional(),
        skillId: z.string().optional(),
        modelId: z.string().optional(),
        isPrimary: z.boolean().optional(),
        policy: agentPolicySchema.optional(),
        heartbeat: heartbeatSchema.optional()
      })
    )
    .optional()
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
