import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createManagedSurfaceAccount,
  disconnectWorkspaceChannel,
  deleteWorkspaceChannelEverywhere,
  setWorkspaceChannelGroups,
  setWorkspaceChannelPrimary,
  upsertWorkspaceChannel,
  bindWorkspaceChannelAgent,
  unbindWorkspaceChannelAgent
} from "@/lib/agentos/control-plane";
import {
  buildLegacyRegistrySurfaceAccounts,
  applyChannelAccountDisplayNames,
  getChannelRegistry,
  mergeMissionControlSurfaceAccounts,
  readChannelAccounts
} from "@/lib/openclaw/domains/channels";
import type { MissionControlSurfaceProvider, WorkspaceChannelGroupAssignment } from "@/lib/agentos/contracts";
import { createTimingCollector, formatTimingSummary, measureTiming } from "@/lib/openclaw/timing";

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
  workspacePath: z.string().min(1),
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
  workspacePath: z.string().min(1).optional(),
  groupAssignments: z.array(groupAssignmentSchema).optional()
});

const deleteChannelSchema = z.object({
  channelId: z.string().min(1),
  scope: z.enum(["workspace", "global"]).optional()
});

export async function GET(_request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const { workspaceId } = await context.params;
  const [registry, channelAccounts] = await Promise.all([getChannelRegistry(), readChannelAccounts()]);
  const channels = registry.channels.filter((channel) =>
    channel.workspaces.some((binding) => binding.workspaceId === workspaceId)
  );
  const accounts = applyChannelAccountDisplayNames(
    mergeMissionControlSurfaceAccounts([
      ...channelAccounts,
      ...buildLegacyRegistrySurfaceAccounts(registry)
    ]),
    registry
  );

  return NextResponse.json({
    workspaceId,
    channels,
    channelAccounts: accounts
  });
}

export async function POST(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  const timings = createTimingCollector("workspace-surface-provision");

  try {
    const { workspaceId } = await context.params;
    const input = await measureTiming(timings, "request.parse", async () =>
      createChannelSchema.parse(await request.json())
    );
    const channelId = input.channelId?.trim();
    const primaryAgentId = input.primaryAgentId?.trim() || null;
    const workspacePath = input.workspacePath.trim();
    const agentIds = input.agentId ? [input.agentId.trim()] : [];
    const groupAssignments = normalizeGroupAssignments(input.groupAssignments ?? []);

    if (!channelId) {
      const created = await measureTiming(timings, "channel.account.create", () =>
        createManagedSurfaceAccount(
          {
            provider: input.type as MissionControlSurfaceProvider,
            name: input.name,
            config: input.config,
            token: input.token,
            botToken: input.botToken,
            webhookUrl: input.webhookUrl
          },
          timings
        )
      );

      const registry = await measureTiming(timings, "channel.registry.upsert", () =>
        upsertWorkspaceChannel(
          {
            workspaceId,
            workspacePath,
            channelId: created.id,
            type: input.type,
            name: input.name,
            primaryAgentId,
            agentIds,
            groupAssignments
          },
          timings
        )
      );

      const summary = timings.summary();
      console.info(formatTimingSummary(summary));

      return NextResponse.json({
        account: created,
        registry,
        timings: summary
      });
    }

    const registry = await measureTiming(timings, "channel.registry.upsert", () =>
      upsertWorkspaceChannel(
        {
          workspaceId,
          workspacePath,
          channelId,
          type: input.type,
          name: input.name,
          primaryAgentId,
          agentIds,
          groupAssignments
        },
        timings
      )
    );

    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json({
      registry,
      timings: summary
    });
  } catch (error) {
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create channel.",
        timings: summary
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request, context: { params: Promise<{ workspaceId: string }> }) {
  try {
    const { workspaceId } = await context.params;
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

      const workspacePath = input.workspacePath?.trim();
      if (!workspacePath) {
        throw new Error("Workspace path is required.");
      }

      const registry = await bindWorkspaceChannelAgent({
        channelId: input.channelId,
        workspaceId,
        workspacePath,
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
  const timings = createTimingCollector("workspace-surface-delete");

  try {
    const { workspaceId } = await context.params;
    const input = await measureTiming(timings, "request.parse", async () =>
      deleteChannelSchema.parse(await request.json())
    );
    const registry = await measureTiming(timings, "channel.delete", () =>
      input.scope === "global"
        ? deleteWorkspaceChannelEverywhere(
            {
              channelId: input.channelId
            },
            timings
          )
        : disconnectWorkspaceChannel(
            {
              workspaceId,
              channelId: input.channelId
            },
            timings
          )
    );

    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json({
      registry,
      timings: summary
    });
  } catch (error) {
    const summary = timings.summary();
    console.info(formatTimingSummary(summary));

    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to delete channel.",
        timings: summary
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
