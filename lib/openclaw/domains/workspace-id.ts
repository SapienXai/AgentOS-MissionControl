import { createHash } from "node:crypto";
import path from "node:path";

export function workspaceIdFromPath(workspacePath: string) {
  const base = path.basename(workspacePath) || workspacePath;
  return slugify(base) || createHashFallback(workspacePath);
}

export function createWorkspaceIdResolver(workspacePaths: readonly string[]) {
  const pathByKey = new Map<string, string>();

  for (const workspacePath of workspacePaths) {
    pathByKey.set(normalizeWorkspacePathKey(workspacePath), workspacePath);
  }

  const groups = new Map<string, string[]>();
  for (const workspacePath of pathByKey.values()) {
    const baseId = workspaceIdFromPath(workspacePath);
    groups.set(baseId, [...(groups.get(baseId) ?? []), workspacePath]);
  }

  const idByPath = new Map<string, string>();
  for (const [baseId, paths] of groups) {
    paths.forEach((workspacePath, index) => {
      idByPath.set(
        normalizeWorkspacePathKey(workspacePath),
        index === 0 ? baseId : workspaceDisambiguatedIdFromPath(workspacePath)
      );
    });
  }

  return (workspacePath: string) => idByPath.get(normalizeWorkspacePathKey(workspacePath)) ?? workspaceIdFromPath(workspacePath);
}

export function resolveWorkspaceIdForPath(workspacePath: string, workspacePaths: readonly string[]) {
  return createWorkspaceIdResolver(workspacePaths)(workspacePath);
}

export function legacyWorkspaceHashIdFromPath(workspacePath: string) {
  const hash = createHash("sha1").update(workspacePath).digest("hex").slice(0, 8);
  return `workspace:${hash}`;
}

export function workspaceDisambiguatedIdFromPath(workspacePath: string) {
  return `${workspaceIdFromPath(workspacePath)}-${hashWorkspacePath(workspacePath)}`;
}

export function workspacePathMatchesId(workspacePath: string, workspaceId: string) {
  return (
    workspaceIdFromPath(workspacePath) === workspaceId ||
    workspaceDisambiguatedIdFromPath(workspacePath) === workspaceId ||
    legacyWorkspaceHashIdFromPath(workspacePath) === workspaceId
  );
}

function normalizeWorkspacePathKey(workspacePath: string) {
  return path.resolve(workspacePath);
}

function hashWorkspacePath(workspacePath: string) {
  return createHash("sha1").update(path.resolve(workspacePath)).digest("hex").slice(0, 8);
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
