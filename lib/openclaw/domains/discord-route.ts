export type DiscordRouteId = {
  kind: "channel" | "thread" | "role";
  guildId: string | null;
  targetId: string;
  parentId?: string | null;
};

function normalizeDiscordId(value: unknown) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function parseDiscordRouteId(value: string) {
  const trimmed = value.trim();
  const [kind, guildIdToken, targetId, parentId] = trimmed.split(":");

  if ((kind !== "channel" && kind !== "thread" && kind !== "role") || !normalizeDiscordId(targetId)) {
    return null;
  }

  return {
    kind,
    guildId: guildIdToken && guildIdToken !== "_" ? normalizeDiscordId(guildIdToken) : null,
    targetId: normalizeDiscordId(targetId) as string,
    parentId: kind === "thread" ? normalizeDiscordId(parentId) : null
  } satisfies DiscordRouteId;
}
