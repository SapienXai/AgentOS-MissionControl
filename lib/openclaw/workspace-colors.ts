import type { CSSProperties } from "react";

const WORKSPACE_ACCENT_PALETTE = [
  "34, 211, 238",
  "59, 130, 246",
  "99, 102, 241",
  "139, 92, 246",
  "168, 85, 247",
  "236, 72, 153",
  "244, 63, 94",
  "249, 115, 22",
  "245, 158, 11",
  "34, 197, 94",
  "20, 184, 166",
  "14, 165, 233"
] as const;

function hashString(value: string) {
  let hash = 0;

  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) | 0;
  }

  return Math.abs(hash);
}

export function getWorkspaceAccentRgb(workspaceId: string) {
  const seed = workspaceId.trim() || workspaceId;
  return WORKSPACE_ACCENT_PALETTE[hashString(seed) % WORKSPACE_ACCENT_PALETTE.length];
}

type WorkspaceNodeStyle = CSSProperties & {
  "--workspace-accent-rgb"?: string;
};

export function getWorkspaceNodeStyle(workspaceId: string): WorkspaceNodeStyle {
  return {
    "--workspace-accent-rgb": getWorkspaceAccentRgb(workspaceId)
  };
}
