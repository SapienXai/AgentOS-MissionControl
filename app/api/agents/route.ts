import { NextResponse } from "next/server";
import { z } from "zod";

import { createAgent, deleteAgent, getMissionControlSnapshot, updateAgent } from "@/lib/agentos/control-plane";

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
  heartbeat: heartbeatSchema.optional(),
  channelIds: z.array(z.string()).optional()
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
  heartbeat: heartbeatSchema.optional(),
  channelIds: z.array(z.string()).optional(),
  skills: z.array(z.string()).optional(),
  tools: z.array(z.string()).optional()
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
        error: formatAgentApiError("create", error)
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
        error: formatAgentApiError("update", error)
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
        error: formatAgentApiError("delete", error)
      },
      { status: 400 }
    );
  }
}

function formatAgentApiError(
  action: "create" | "update" | "delete",
  error: unknown
) {
  const message = error instanceof Error ? error.message : "";

  if (/Config path not found:\s*agents\.list/i.test(message)) {
    return "OpenClaw is still initializing the agent registry for this workspace. Please try again in a moment.";
  }

  if (/Agent was not found\./i.test(message)) {
    return "That agent no longer exists in the current workspace.";
  }

  if (/OpenClaw command failed with exit code \d+:/i.test(message)) {
    return action === "delete"
      ? "OpenClaw could not delete the agent right now. Please try again."
      : action === "create"
        ? "OpenClaw could not create the agent right now. Please try again."
        : "OpenClaw could not update the agent right now. Please try again.";
  }

  return action === "delete"
    ? "OpenClaw could not delete the agent right now. Please try again."
    : action === "create"
      ? "OpenClaw could not create the agent right now. Please try again."
      : "OpenClaw could not update the agent right now. Please try again.";
}
