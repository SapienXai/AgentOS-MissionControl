"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { cn } from "@/lib/utils";
import { getWorkspaceChannels } from "@/lib/openclaw/channel-bindings";
import { Loader2 } from "lucide-react";

export function ChannelBindingPicker({
  snapshot,
  workspaceId,
  channelIds,
  agentId,
  isSaving,
  onChange
}: {
  snapshot: MissionControlSnapshot;
  workspaceId: string;
  channelIds: string[];
  agentId?: string | null;
  isSaving?: boolean;
  onChange: (channelIds: string[]) => void;
}) {
  const channels = getWorkspaceChannels(snapshot, workspaceId);
  const selectedChannelIdSet = new Set(channelIds);
  const resolveAgentDisplayName = (lookupAgentId: string | null | undefined) => {
    if (!lookupAgentId) {
      return null;
    }

    return formatAgentDisplayName(
      snapshot.agents.find((agent) => agent.id === lookupAgentId) ?? { name: lookupAgentId }
    );
  };

  if (channels.length === 0) {
    return (
      <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-white">Surface participation</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Connect workspace surfaces first. Primary agents own the surface; selected agents assist behind the
              scenes.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-sm font-medium text-white">Surface participation</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Primary agents own the surface. Selected surfaces let this agent assist the owner internally.
          </p>
        </div>
      </div>

      {isSaving ? (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/[0.08] px-3 py-1.5 text-[11px] text-cyan-50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Applying surface changes...</span>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {channels.map((channel) => {
          const selected = selectedChannelIdSet.has(channel.id);
          const isPrimaryForAgent = Boolean(agentId && channel.primaryAgentId === agentId);
          const primaryAgentName = resolveAgentDisplayName(channel.primaryAgentId);
          const workspaceBinding = channel.workspaces.find((binding) => binding.workspaceId === workspaceId) ?? null;
          const sharedCount = workspaceBinding?.agentIds.length ?? 0;

          return (
            <div
              key={channel.id}
              className={cn(
                "flex items-center justify-between gap-3 rounded-2xl border px-3 py-2.5",
                selected ? "border-cyan-300/40 bg-cyan-400/[0.08]" : "border-white/8 bg-white/[0.02]"
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className="truncate text-sm font-medium text-white">{channel.name}</p>
                  <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                    {channel.type}
                  </Badge>
                  {isPrimaryForAgent ? (
                    <Badge className="h-5 rounded-full px-2 text-[10px]">Owner</Badge>
                  ) : selected ? (
                    <Badge className="h-5 rounded-full px-2 text-[10px]">Assistant</Badge>
                  ) : null}
                  {sharedCount > 1 ? (
                    <Badge variant="muted" className="h-5 rounded-full px-2 text-[10px]">
                      Team
                    </Badge>
                  ) : null}
                </div>
                <p className="mt-1 truncate text-[11px] text-slate-400">
                  {channel.id}
                  {primaryAgentName ? ` · owner ${primaryAgentName}` : ""}
                </p>
              </div>

              <Button
                type="button"
                variant={selected ? "secondary" : "default"}
                size="sm"
                className="h-8 rounded-full px-3 text-[11px]"
                disabled={Boolean(isSaving) || (selected && isPrimaryForAgent)}
                onClick={() =>
                  onChange(
                    selectedChannelIdSet.has(channel.id)
                      ? channelIds.filter((entry) => entry !== channel.id)
                      : [...channelIds, channel.id]
                  )
                }
              >
                {selected ? (isPrimaryForAgent ? "Owner" : "Remove") : "Assist"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
