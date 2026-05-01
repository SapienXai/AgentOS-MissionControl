import "server-only";

import { readFile } from "node:fs/promises";

import {
  normalizeChannelRegistry,
  parseWorkspaceChannelSummary
} from "@/lib/openclaw/domains/workspace-manifest";
import type { ChannelRegistry, WorkspaceChannelSummary } from "@/lib/openclaw/types";

function isObjectRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

export async function settleChannelRegistryFromLocalFile(
  channelRegistryPath: string
): Promise<PromiseSettledResult<ChannelRegistry>> {
  try {
    const raw = await readFile(channelRegistryPath, "utf8");
    const parsed = JSON.parse(raw);
    const registryInput = isObjectRecord(parsed)
      ? parsed
      : { version: 1, channels: [] as unknown[] };
    const channels = Array.isArray(registryInput.channels)
      ? registryInput.channels
          .map((entry) => parseWorkspaceChannelSummary(entry))
          .filter((entry): entry is WorkspaceChannelSummary => Boolean(entry))
      : [];

    return {
      status: "fulfilled",
      value: normalizeChannelRegistry({
        version: 1,
        channels
      })
    };
  } catch (error) {
    return {
      status: "rejected",
      reason: error
    };
  }
}
