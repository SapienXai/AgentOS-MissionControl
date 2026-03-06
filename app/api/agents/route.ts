import { NextResponse } from "next/server";
import { z } from "zod";

import { createAgent, getMissionControlSnapshot, updateAgent } from "@/lib/openclaw/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const createAgentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().min(1),
  modelId: z.string().optional(),
  name: z.string().optional(),
  emoji: z.string().optional(),
  theme: z.string().optional(),
  avatar: z.string().optional()
});

const updateAgentSchema = z.object({
  id: z.string().min(1),
  workspaceId: z.string().optional(),
  modelId: z.string().optional(),
  name: z.string().optional(),
  emoji: z.string().optional(),
  theme: z.string().optional(),
  avatar: z.string().optional()
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
