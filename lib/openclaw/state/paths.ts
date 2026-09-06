import "server-only";

import os from "node:os";
import path from "node:path";

export const missionControlRootPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control");
export const channelRegistryPath = path.join(missionControlRootPath, "channel-registry.json");

export function getOpenClawStateRootPath() {
  return path.resolve(process.env.OPENCLAW_STATE_DIR?.trim() || path.join(os.homedir(), ".openclaw"));
}

export const openClawStateRootPath = getOpenClawStateRootPath();
