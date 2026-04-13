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
  onChange,
  surfaceTheme = "dark"
}: {
  snapshot: MissionControlSnapshot;
  workspaceId: string;
  channelIds: string[];
  agentId?: string | null;
  isSaving?: boolean;
  onChange: (channelIds: string[]) => void;
  surfaceTheme?: "dark" | "light";
}) {
  const channels = getWorkspaceChannels(snapshot, workspaceId);
  const selectedChannelIdSet = new Set(channelIds);
  const isLight = surfaceTheme === "light";
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
      <div
        className={cn(
          "rounded-[22px] border p-3.5",
          isLight
            ? "border-[#e1d5c8] bg-white/92 shadow-[0_14px_34px_rgba(161,125,101,0.08)]"
            : "border-white/10 bg-white/[0.03]"
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className={cn("text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>Surface participation</p>
            <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#7b6657]" : "text-slate-400")}>
              Connect workspace surfaces first. Primary agents own the surface; selected agents assist behind the scenes.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "rounded-[22px] border p-3.5",
        isLight
          ? "border-[#e1d5c8] bg-white/92 shadow-[0_14px_34px_rgba(161,125,101,0.08)]"
          : "border-white/10 bg-white/[0.03]"
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className={cn("text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>Surface participation</p>
          <p className={cn("mt-1 text-[11px] leading-4", isLight ? "text-[#7b6657]" : "text-slate-400")}>
            Primary agents own the surface. Selected surfaces let this agent assist the owner internally.
          </p>
        </div>
      </div>

      {isSaving ? (
        <div
          className={cn(
            "mt-3 inline-flex items-center gap-2 rounded-full border px-3 py-1 text-[10px]",
            isLight
              ? "border-[#c89e73]/25 bg-[#f5eadf] text-[#6b4f39]"
              : "border-cyan-300/20 bg-cyan-400/[0.08] text-cyan-50"
          )}
        >
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          <span>Applying surface changes...</span>
        </div>
      ) : null}

      <div className="mt-4 space-y-3">
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
                "flex items-center justify-between gap-3 rounded-[18px] border px-3.5 py-2.5",
                selected
                  ? isLight
                    ? "border-[#c89e73]/45 bg-[#fff7ef]"
                    : "border-cyan-300/40 bg-cyan-400/[0.08]"
                  : isLight
                    ? "border-[#e2d6ca] bg-white"
                    : "border-white/8 bg-white/[0.02]"
              )}
            >
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <p className={cn("truncate text-[13px] font-medium", isLight ? "text-[#3f2f24]" : "text-white")}>
                    {channel.name}
                  </p>
                  <Badge
                    variant="muted"
                    className={cn(
                      "h-4 rounded-full px-2 text-[9px]",
                      isLight ? "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]" : ""
                    )}
                  >
                    {channel.type}
                  </Badge>
                  {isPrimaryForAgent ? (
                    <Badge
                      className={cn(
                        "h-4 rounded-full px-2 text-[9px]",
                        isLight ? "border-[#c89e73]/35 bg-[#f5e7d8] text-[#6a4a34]" : ""
                      )}
                    >
                      Owner
                    </Badge>
                  ) : selected ? (
                    <Badge
                      className={cn(
                        "h-4 rounded-full px-2 text-[9px]",
                        isLight ? "border-[#c89e73]/35 bg-[#f5e7d8] text-[#6a4a34]" : ""
                      )}
                    >
                      Assistant
                    </Badge>
                  ) : null}
                  {sharedCount > 1 ? (
                    <Badge
                      variant="muted"
                      className={cn(
                        "h-4 rounded-full px-2 text-[9px]",
                        isLight ? "border-[#e1d5c8] bg-[#fbf7f2] text-[#6f5747]" : ""
                      )}
                    >
                      Team
                    </Badge>
                  ) : null}
                </div>
                <p className={cn("mt-1 truncate text-[10px]", isLight ? "text-[#7f6958]" : "text-slate-400")}>
                  {channel.id}
                  {primaryAgentName ? ` · owner ${primaryAgentName}` : ""}
                </p>
              </div>

              <Button
                type="button"
                variant={selected ? "secondary" : "default"}
                size="sm"
                className={cn(
                  "h-8 rounded-full px-2.5 text-[10px]",
                  isLight && !selected ? "shadow-none" : ""
                )}
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
