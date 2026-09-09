export type WorkspaceSourceMode = "empty" | "clone" | "existing";

/** The physical starting point of a workspace. This does not describe knowledge sources. */
export type WorkspaceMaterialization =
  | { mode: "empty" }
  | { mode: "clone"; repoUrl: string }
  | { mode: "existing"; existingPath: string };

export type LegacyWorkspaceMaterializationFields = {
  sourceMode?: WorkspaceSourceMode | null;
  repoUrl?: string | null;
  existingPath?: string | null;
  directory?: string | null;
};

function normalizedString(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasOwn(value: unknown, key: string) {
  return isRecord(value) && Object.prototype.hasOwnProperty.call(value, key);
}

export function isWorkspaceMaterialization(value: unknown): value is WorkspaceMaterialization {
  if (!isRecord(value) || (value.mode !== "empty" && value.mode !== "clone" && value.mode !== "existing")) {
    return false;
  }

  if (value.mode === "empty") {
    return !normalizedString(value.repoUrl) && !normalizedString(value.existingPath);
  }

  if (value.mode === "clone") {
    return Boolean(normalizedString(value.repoUrl)) && !normalizedString(value.existingPath);
  }

  return Boolean(normalizedString(value.existingPath)) && !normalizedString(value.repoUrl);
}

export function normalizeWorkspaceMaterialization(value: unknown): WorkspaceMaterialization {
  if (!isRecord(value) || typeof value.mode !== "string") {
    throw new Error("Workspace materialization must declare mode: empty, clone, or existing.");
  }

  const repoUrl = normalizedString(value.repoUrl);
  const existingPath = normalizedString(value.existingPath);

  if (value.mode === "empty") {
    if (repoUrl || existingPath) {
      throw new Error("Empty workspace materialization cannot include a repository URL or existing path.");
    }
    return { mode: "empty" };
  }

  if (value.mode === "clone") {
    if (!repoUrl) {
      throw new Error("Clone workspace materialization requires repoUrl.");
    }
    if (existingPath) {
      throw new Error("Clone workspace materialization cannot include existingPath.");
    }
    return { mode: "clone", repoUrl };
  }

  if (value.mode === "existing") {
    if (!existingPath) {
      throw new Error("Existing workspace materialization requires existingPath.");
    }
    if (repoUrl) {
      throw new Error("Existing workspace materialization cannot include repoUrl.");
    }
    return { mode: "existing", existingPath };
  }

  throw new Error("Workspace materialization mode must be empty, clone, or existing.");
}

export function legacyWorkspaceMaterializationFromFields(
  fields: LegacyWorkspaceMaterializationFields
): WorkspaceMaterialization {
  const sourceMode = fields.sourceMode ?? undefined;
  const repoUrl = normalizedString(fields.repoUrl);
  const existingPath = normalizedString(fields.existingPath);

  if (sourceMode === "clone") {
    if (!repoUrl) throw new Error("Clone workspace materialization requires repoUrl.");
    if (existingPath) throw new Error("Clone workspace materialization cannot include existingPath.");
    return { mode: "clone", repoUrl };
  }

  if (sourceMode === "existing") {
    const resolvedPath = existingPath ?? normalizedString(fields.directory);
    if (!resolvedPath) throw new Error("Existing workspace materialization requires existingPath.");
    if (repoUrl) throw new Error("Existing workspace materialization cannot include repoUrl.");
    return { mode: "existing", existingPath: resolvedPath };
  }

  if (!sourceMode && repoUrl && !existingPath) {
    return { mode: "clone", repoUrl };
  }

  if (!sourceMode && existingPath && !repoUrl) {
    return { mode: "existing", existingPath };
  }

  if (!sourceMode && repoUrl && existingPath) {
    throw new Error("Legacy workspace input cannot include both repoUrl and existingPath.");
  }

  if (repoUrl || existingPath) {
    throw new Error("Empty workspace materialization cannot include a repository URL or existing path.");
  }

  return { mode: "empty" };
}

export function normalizeWorkspaceMaterializationInput(input: {
  materialization?: unknown;
  sourceMode?: WorkspaceSourceMode | null;
  repoUrl?: string | null;
  existingPath?: string | null;
  directory?: string | null;
}): WorkspaceMaterialization {
  const hasCanonical = hasOwn(input, "materialization") && input.materialization !== undefined;
  const legacy = legacyWorkspaceMaterializationFromFields(input);

  if (!hasCanonical) return legacy;

  const canonical = normalizeWorkspaceMaterialization(input.materialization);
  const legacyFieldsPresent =
    hasOwn(input, "sourceMode") ||
    hasOwn(input, "repoUrl") ||
    hasOwn(input, "existingPath");

  if (legacyFieldsPresent) {
    const hasMeaningfulLegacy =
      input.sourceMode !== undefined ||
      normalizedString(input.repoUrl) !== undefined ||
      normalizedString(input.existingPath) !== undefined;

    if (hasMeaningfulLegacy && !workspaceMaterializationsEqual(canonical, legacy)) {
      throw new Error("Workspace materialization conflicts with legacy sourceMode/repoUrl/existingPath fields.");
    }
  }

  return canonical;
}

export function workspaceMaterializationsEqual(
  left: WorkspaceMaterialization,
  right: WorkspaceMaterialization
) {
  return left.mode === right.mode &&
    (left.mode === "empty" ||
      (left.mode === "clone" && right.mode === "clone" && left.repoUrl === right.repoUrl) ||
      (left.mode === "existing" && right.mode === "existing" && left.existingPath === right.existingPath));
}

export function materializationToWorkspaceSourceMode(
  materialization: WorkspaceMaterialization
): WorkspaceSourceMode {
  return materialization.mode;
}

export function materializationToLegacyWorkspaceFields(materialization: WorkspaceMaterialization) {
  if (materialization.mode === "clone") {
    return { sourceMode: "clone" as const, repoUrl: materialization.repoUrl, existingPath: undefined };
  }
  if (materialization.mode === "existing") {
    return { sourceMode: "existing" as const, repoUrl: undefined, existingPath: materialization.existingPath };
  }
  return { sourceMode: "empty" as const, repoUrl: undefined, existingPath: undefined };
}
