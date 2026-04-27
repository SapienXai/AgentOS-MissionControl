import { constants as fsConstants } from "node:fs";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";

import { getOpenClawLocalPrefixBinPath } from "@/lib/openclaw/install";
import type { OpenClawBinarySelection, OpenClawBinarySelectionMode } from "@/lib/openclaw/types";

const openClawStateRootPath = path.join(/*turbopackIgnore: true*/ os.homedir(), ".openclaw");
const openClawBinarySelectionPath = path.join(openClawStateRootPath, "binary-selection.json");

export function getOpenClawBinarySelectionFilePath() {
  return openClawBinarySelectionPath;
}

export function createDefaultOpenClawBinarySelection(): OpenClawBinarySelection {
  return {
    mode: "auto",
    path: null,
    resolvedPath: null,
    label: "Auto",
    detail: "Use the managed resolution order."
  };
}

export function normalizeOpenClawBinarySelection(value: unknown): OpenClawBinarySelection {
  if (!value || typeof value !== "object") {
    return createDefaultOpenClawBinarySelection();
  }

  const candidate = value as Record<string, unknown>;
  const mode = resolveOpenClawBinarySelectionMode(candidate.mode);

  if (!mode) {
    return createDefaultOpenClawBinarySelection();
  }

  if (mode === "auto") {
    return createDefaultOpenClawBinarySelection();
  }

  const pathValue = typeof candidate.path === "string" ? candidate.path.trim() : "";

  if (!pathValue) {
    return createDefaultOpenClawBinarySelection();
  }

  return {
    mode,
    path: path.normalize(pathValue),
    resolvedPath: path.normalize(pathValue),
    label: mode === "local-prefix" ? "Local prefix" : mode === "global-path" ? "Global PATH" : "Custom path",
    detail: path.normalize(pathValue)
  };
}

export async function readOpenClawBinarySelection(): Promise<OpenClawBinarySelection> {
  try {
    const raw = await readFile(openClawBinarySelectionPath, "utf8");
    return normalizeOpenClawBinarySelection(JSON.parse(raw));
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return createDefaultOpenClawBinarySelection();
    }

    return createDefaultOpenClawBinarySelection();
  }
}

export async function writeOpenClawBinarySelection(selection: OpenClawBinarySelection) {
  await mkdir(openClawStateRootPath, { recursive: true });
  await writeFile(openClawBinarySelectionPath, `${JSON.stringify(selection, null, 2)}\n`, "utf8");
}

export async function assertExecutableOpenClawBinary(binPath: string) {
  await access(binPath, fsConstants.X_OK);
}

export async function resolveGlobalOpenClawBinaryPath() {
  const command = process.platform === "win32" ? "where" : "which";
  const args = process.platform === "win32" ? ["openclaw.exe"] : ["openclaw"];
  const result = spawnSync(command, args, {
    encoding: "utf8"
  });

  if (result.status !== 0 || result.error) {
    throw new Error("Could not resolve openclaw from PATH.");
  }

  const candidate = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || "";

  if (!candidate) {
    throw new Error("Could not resolve openclaw from PATH.");
  }

  return candidate;
}

export function getOpenClawBinarySelectionLabel(selection: OpenClawBinarySelection | null) {
  return selection?.label || "Auto";
}

export function getOpenClawBinarySelectionDetail(selection: OpenClawBinarySelection | null) {
  if (!selection) {
    return "Use the managed resolution order.";
  }

  if (selection.mode === "auto") {
    return "Use the managed resolution order.";
  }

  return selection.detail || selection.path || "Unavailable";
}

export function resolveOpenClawBinarySelectionPath(selection: OpenClawBinarySelection | null) {
  if (!selection || selection.mode === "auto") {
    return null;
  }

  if (selection.mode === "local-prefix") {
    return getOpenClawLocalPrefixBinPath();
  }

  return selection.path;
}

export function resolveOpenClawBinarySelectionMode(value: unknown): OpenClawBinarySelectionMode | null {
  if (value === "auto" || value === "local-prefix" || value === "global-path" || value === "custom") {
    return value;
  }

  return null;
}

export function buildOpenClawBinarySelectionSnapshot(
  selection: OpenClawBinarySelection | null,
  resolvedPath: string | null
): OpenClawBinarySelection {
  if (!selection) {
    return {
      ...createDefaultOpenClawBinarySelection(),
      resolvedPath
    };
  }

  return {
    ...selection,
    resolvedPath: selection.mode === "auto" ? resolvedPath : selection.resolvedPath || selection.path || resolvedPath
  };
}
