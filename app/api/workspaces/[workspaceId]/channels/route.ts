import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createManagedSurfaceAccount,
  disconnectWorkspaceChannel,
  deleteWorkspaceChannelEverywhere,
  getMissionControlSnapshot,
  setWorkspaceChannelGroups,
  setWorkspaceChannelPrimary,
  upsertWorkspaceChannel,
  bindWorkspaceChannelAgent,
  unbindWorkspaceChannelAgent
} from "@/lib/openclaw/service";
import type { MissionControlSurfaceProvider, WorkspaceChannelGroupAssignment } from "@/lib/openclaw/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const groupAssignmentSchema = z.object({
  chatId: z.string().min(1),
  agentId: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  enabled: z.boolean().optional()
});

const createChannelSchema = z.object({
  channelId: z.string().optional(),
  type: z.string().min(1),
  name: z.string().min(1),
  config: z.record(z.any()).optional(),
  token: z.string().optional(),
  botToken: z.string().optional(),
  webhookUrl: z.string().optional(),
  primaryAgentId: z.string().nullable().optional(),
  agentId: z.string().nullable().optional(),
  groupAssignments: z.array(groupAssignmentSchema).optional()
});

const patchChannelSchema = z.object({
  channelId: z.string().min(1),
  action: z.enum(["bind-agent", "unbind-agent", "primary", "groups"]),
  agentId: z.string().nullable().optional(),
  primaryAgentId: z.string().nullable().optional(),
  groupAssignments: z.array(groupAssignmentSchema).optional()
});

const deleteChannelSchema = z.object({
  channelId: z.string().min(1),
  scope: z.enum(["workspace", "global"]).optional()
});

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
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

  const channels = snapshot.channelRegistry.channels.filter((channel) =>
    channel.workspaces.some((binding) => binding.workspaceId === workspaceId)
  );

  return NextResponse.json({
    workspaceId,
    channels,
    channelAccounts: snapshot.channelAccounts
  });
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    let snapshot = await getMissionControlSnapshot();
    let workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

    if (!workspace) {
      snapshot = await getMissionControlSnapshot({ force: true });
      workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);
    }

    if (!workspace) {
      throw new Error("Workspace was not found.");
    }

    const input = createChannelSchema.parse(await request.json());
    const channelId = input.channelId?.trim();
    const primaryAgentId = input.primaryAgentId?.trim() || null;
    const agentIds = input.agentId ? [input.agentId.trim()] : [];
    const groupAssignments = normalizeGroupAssignments(input.groupAssignments ?? []);

    if (!channelId) {
      const created = await createManagedSurfaceAccount({
        provider: input.type as MissionControlSurfaceProvider,
        name: input.name,
        config: input.config,
        token: input.token,
        botToken: input.botToken,
        webhookUrl: input.webhookUrl
      });

      const registry = await upsertWorkspaceChannel({
        workspaceId,
        workspacePath: workspace.path,
        channelId: created.id,
        type: input.type,
        name: input.name,
        primaryAgentId,
        agentIds,
        groupAssignments
      });

      return NextResponse.json({
        account: created,
        registry
      });
    }

    const registry = await upsertWorkspaceChannel({
      workspaceId,
      workspacePath: workspace.path,
      channelId,
      type: input.type,
      name: input.name,
      primaryAgentId,
      agentIds,
      groupAssignments
    });

    return NextResponse.json({
      registry
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create channel."
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    let snapshot = await getMissionControlSnapshot();
    let workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

    if (!workspace) {
      snapshot = await getMissionControlSnapshot({ force: true });
      workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);
    }

    if (!workspace) {
      throw new Error("Workspace was not found.");
    }

    const input = patchChannelSchema.parse(await request.json());

    if (input.action === "primary") {
      const registry = await setWorkspaceChannelPrimary({
        channelId: input.channelId,
        primaryAgentId: input.primaryAgentId ?? null
      });

      return NextResponse.json({ registry });
    }

    if (input.action === "groups") {
      const registry = await setWorkspaceChannelGroups({
        channelId: input.channelId,
        workspaceId,
        groupAssignments: normalizeGroupAssignments(input.groupAssignments ?? [])
      });

      return NextResponse.json({ registry });
    }

    if (input.action === "bind-agent") {
      if (!input.agentId) {
        throw new Error("Agent id is required.");
      }

      const registry = await bindWorkspaceChannelAgent({
        channelId: input.channelId,
        workspaceId,
        workspacePath: workspace.path,
        agentId: input.agentId
      });

      return NextResponse.json({ registry });
    }

    if (!input.agentId) {
      throw new Error("Agent id is required.");
    }

    const registry = await unbindWorkspaceChannelAgent({
      channelId: input.channelId,
      workspaceId,
      agentId: input.agentId
    });

    return NextResponse.json({ registry });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update channel."
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
    let snapshot = await getMissionControlSnapshot();
    let workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);

    if (!workspace) {
      snapshot = await getMissionControlSnapshot({ force: true });
      workspace = snapshot.workspaces.find((entry) => entry.id === workspaceId);
    }

    if (!workspace) {
      throw new Error("Workspace was not found.");
    }

    const input = deleteChannelSchema.parse(await request.json());
    const registry =
      input.scope === "global"
        ? await deleteWorkspaceChannelEverywhere({
            channelId: input.channelId
          })
        : await disconnectWorkspaceChannel({
            workspaceId,
            channelId: input.channelId
          });

    return NextResponse.json({ registry });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to delete channel."
      },
      { status: 400 }
    );
  }
}

function normalizeGroupAssignments(assignments: Array<z.infer<typeof groupAssignmentSchema>>): WorkspaceChannelGroupAssignment[] {
  return assignments.map((assignment) => ({
    chatId: assignment.chatId,
    agentId: assignment.agentId ?? null,
    title: assignment.title ?? null,
    enabled: assignment.enabled !== false
  }));
}
