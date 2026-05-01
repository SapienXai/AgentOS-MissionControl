import type { PresencePayload } from "@/lib/openclaw/client/gateway-client";
import type { PresenceRecord } from "@/lib/openclaw/types";

export function buildPresenceRecords(presence: PresencePayload): PresenceRecord[] {
  return presence.map((entry) => ({
    host: entry.host,
    ip: entry.ip,
    version: entry.version,
    platform: entry.platform,
    deviceFamily: entry.deviceFamily,
    mode: entry.mode,
    reason: entry.reason,
    text: entry.text,
    ts: entry.ts
  }));
}
