import { createHash } from "node:crypto";
import path from "node:path";

export function workspaceIdFromPath(workspacePath: string) {
  const base = path.basename(workspacePath) || workspacePath;
  return slugify(base) || createHashFallback(workspacePath);
}

export function legacyWorkspaceHashIdFromPath(workspacePath: string) {
  const hash = createHash("sha1").update(workspacePath).digest("hex").slice(0, 8);
  return `workspace:${hash}`;
}

export function workspacePathMatchesId(workspacePath: string, workspaceId: string) {
  return workspaceIdFromPath(workspacePath) === workspaceId || legacyWorkspaceHashIdFromPath(workspacePath) === workspaceId;
}

function createHashFallback(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash + value.charCodeAt(index)) | 0;
  }

  return `workspace-${Math.abs(hash)}`;
}

function slugify(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
