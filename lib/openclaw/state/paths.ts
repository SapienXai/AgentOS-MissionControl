import "server-only";

import os from "node:os";
import path from "node:path";

export const missionControlRootPath = path.join(/*turbopackIgnore: true*/ process.cwd(), ".mission-control");
export const channelRegistryPath = path.join(missionControlRootPath, "channel-registry.json");
export const openClawStateRootPath = path.join(os.homedir(), ".openclaw");
