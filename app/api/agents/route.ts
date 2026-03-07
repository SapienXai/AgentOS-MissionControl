import { NextResponse } from "next/server";
import { z } from "zod";

import { createAgent, deleteAgent, getMissionControlSnapshot, updateAgent } from "@/lib/openclaw/service";

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

const createAgentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  modelId: z.string().optional(),
  name: z.string().optional(),
  emoji: z.string().optional(),
  theme: z.string().optional(),
  avatar: z.string().optional(),
  policy: agentPolicySchema.optional(),
  heartbeat: heartbeatSchema.optional()
});

const updateAgentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().optional(),
  modelId: z.string().optional(),
  name: z.string().optional(),
  emoji: z.string().optional(),
  theme: z.string().optional(),
  avatar: z.string().optional(),
  policy: agentPolicySchema.optional(),
  heartbeat: heartbeatSchema.optional()
});

const deleteAgentSchema = z.object({
  agentId: z.string().min(1)
});

export async function GET() {
  const snapshot = await getMissionControlSnapshot({ force: true });
  return NextResponse.json({
    agents: snapshot.agents
  });
}

export async function POST(request: Request) {
  try {
    const input = createAgentSchema.parse(await request.json());
    const created = await createAgent(input);
    return NextResponse.json(created);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create agent."
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  try {
    const input = updateAgentSchema.parse(await request.json());
    const updated = await updateAgent(input);
    return NextResponse.json(updated);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update agent."
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  try {
    const input = deleteAgentSchema.parse(await request.json());
    const deleted = await deleteAgent(input);
    return NextResponse.json(deleted);
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to delete agent."
      },
      { status: 400 }
    );
  }
}
