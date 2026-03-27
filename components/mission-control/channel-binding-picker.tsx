"use client";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";
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

  if (channels.length === 0) {
    return (
      <div className="rounded-[20px] border border-white/10 bg-white/[0.03] p-4">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-medium text-white">Channel participation</p>
            <p className="mt-1 text-xs leading-5 text-slate-400">
              Add Telegram channels from the workspace screen first. Primary agents speak publicly; selected agents assist internally.
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
          <p className="text-sm font-medium text-white">Channel participation</p>
          <p className="mt-1 text-xs leading-5 text-slate-400">
            Primary agents speak on Telegram. Selected channels let this agent assist the primary internally.
          </p>
        </div>
      </div>

      {isSaving ? (
        <div className="mt-3 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-400/[0.08] px-3 py-1.5 text-[11px] text-cyan-50">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Applying channel changes...</span>
        </div>
      ) : null}

      <div className="mt-3 space-y-2">
        {channels.map((channel) => {
          const selected = selectedChannelIdSet.has(channel.id);
          const isPrimaryForAgent = Boolean(agentId && channel.primaryAgentId === agentId);
          const primaryAgentName = channel.primaryAgentId
            ? snapshot.agents.find((agent) => agent.id === channel.primaryAgentId)?.name ?? channel.primaryAgentId
            : null;
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
                    <Badge className="h-5 rounded-full px-2 text-[10px]">Primary voice</Badge>
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
                  {primaryAgentName ? ` · primary ${primaryAgentName}` : ""}
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
                {selected ? (isPrimaryForAgent ? "Primary" : "Remove") : "Assist"}
              </Button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
