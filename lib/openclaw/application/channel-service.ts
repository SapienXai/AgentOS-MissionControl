import "server-only";

export {
  bindWorkspaceChannelAgent,
  createManagedSurfaceAccount,
  createTelegramChannelAccount,
  deleteWorkspaceChannelEverywhere,
  disconnectWorkspaceChannel,
  discoverDiscordRoutes,
  discoverSurfaceRoutes,
  discoverTelegramGroups,
  getChannelRegistry,
  setWorkspaceChannelGroups,
  setWorkspaceChannelPrimary,
  unbindWorkspaceChannelAgent,
  upsertWorkspaceChannel
} from "@/lib/openclaw/service";
