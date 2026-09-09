import { getAgentPresetMeta } from "@/lib/openclaw/agent-presets";
import type { AgentBootstrapFilePath, AgentPreset } from "@/lib/openclaw/types";

export type { AgentBootstrapFilePath } from "@/lib/openclaw/types";

export type AgentBootstrapFileKind = "identity" | "soul";

export interface AgentBootstrapFileDraft {
  kind: AgentBootstrapFileKind;
  path: AgentBootstrapFilePath;
  label: string;
  description: string;
  required: boolean;
  removable: boolean;
  content: string;
  baseContent: string;
  manuallyEdited: boolean;
}

export interface AgentIdentityMarkdownFields {
  name: string | null;
  emoji: string | null;
  theme: string | null;
  avatar: string | null;
}

export const AGENT_BOOTSTRAP_FILE_OPTIONS = [
  {
    kind: "identity",
    path: "IDENTITY.md",
    label: "Identity",
    description: "Name, emoji, theme, and avatar metadata.",
    required: true,
    removable: false
  },
  {
    kind: "soul",
    path: "SOUL.md",
    label: "Soul",
    description: "Purpose and operating style.",
    required: false,
    removable: true
  },
] as const satisfies ReadonlyArray<{
  kind: AgentBootstrapFileKind;
  path: AgentBootstrapFilePath;
  label: string;
  description: string;
  required: boolean;
  removable: boolean;
}>;

export const AGENT_BOOTSTRAP_FILE_PATHS = [
  "IDENTITY.md",
  "SOUL.md"
] as const satisfies ReadonlyArray<AgentBootstrapFilePath>;

export function buildAgentBootstrapFileDrafts(input: {
  name: string;
  emoji?: string | null;
  theme?: string | null;
  avatar?: string | null;
  preset: AgentPreset;
}) {
  const presetMeta = getAgentPresetMeta(input.preset);
  const displayName = normalizeBootstrapValue(input.name) ?? presetMeta.defaultName;
  const identityContent = renderAgentIdentityMarkdown({
    name: displayName,
    emoji: normalizeBootstrapValue(input.emoji),
    theme: normalizeBootstrapValue(input.theme),
    avatar: normalizeBootstrapValue(input.avatar),
    presetLabel: presetMeta.label,
    presetDescription: presetMeta.description
  });
  const soulContent = renderAgentSoulMarkdown({
    name: displayName,
    presetLabel: presetMeta.label,
    presetDescription: presetMeta.description
  });
  return [
    {
      kind: "identity" as const,
      path: "IDENTITY.md" as const,
      label: "Identity",
      description: "Name, emoji, theme, and avatar metadata.",
      required: true,
      removable: false,
      content: identityContent,
      baseContent: identityContent,
      manuallyEdited: false
    },
    {
      kind: "soul" as const,
      path: "SOUL.md" as const,
      label: "Soul",
      description: "Purpose and operating style.",
      required: false,
      removable: true,
      content: soulContent,
      baseContent: soulContent,
      manuallyEdited: false
    }
  ] satisfies AgentBootstrapFileDraft[];
}

export function rebaseAgentBootstrapFileDrafts(
  current: AgentBootstrapFileDraft[],
  nextDefaults: AgentBootstrapFileDraft[]
) {
  const nextByPath = new Map(nextDefaults.map((entry) => [entry.path, entry] as const));
  const orderByPath = new Map(nextDefaults.map((entry, index) => [entry.path, index] as const));

  return [...current]
    .filter((entry) => nextByPath.has(entry.path))
    .map((entry) => {
      const next = nextByPath.get(entry.path);

      if (!next) {
        return entry;
      }

      return {
        ...entry,
        kind: next.kind,
        label: next.label,
        description: next.description,
        required: next.required,
        removable: next.removable,
        baseContent: next.baseContent,
        content: entry.manuallyEdited
          ? entry.content
          : entry.content === entry.baseContent
            ? next.baseContent
            : entry.content
      };
    })
    .sort((left, right) => (orderByPath.get(left.path) ?? Number.MAX_SAFE_INTEGER) - (orderByPath.get(right.path) ?? Number.MAX_SAFE_INTEGER));
}

export function parseAgentIdentityMarkdown(content: string): AgentIdentityMarkdownFields {
  const lines = content.split(/\r?\n/);

  return {
    name: parseIdentityLine(lines, "Name"),
    emoji: parseIdentityLine(lines, "Emoji"),
    theme: parseIdentityLine(lines, "Theme"),
    avatar: parseIdentityLine(lines, "Avatar")
  };
}

export function renderAgentIdentityMarkdown(input: {
  name: string;
  emoji?: string | null;
  theme?: string | null;
  avatar?: string | null;
  presetLabel?: string;
  presetDescription?: string;
}) {
  return [
    "# IDENTITY.md",
    "",
    `- **Name:** ${input.name}`,
    `- **Emoji:** ${normalizeBootstrapValue(input.emoji) ?? ""}`,
    `- **Theme:** ${normalizeBootstrapValue(input.theme) ?? ""}`,
    `- **Avatar:** ${normalizeBootstrapValue(input.avatar) ?? ""}`,
    "",
    "## Role",
    input.presetLabel ?? "Agent",
    "",
    "## Notes",
    input.presetDescription ?? "Pragmatic, concise, workspace-grounded."
  ].join("\n");
}

export function renderAgentSoulMarkdown(input: {
  name: string;
  presetLabel: string;
  presetDescription: string;
}) {
  return [
    "# SOUL.md",
    "",
    "## Purpose",
    `${input.name} is a ${input.presetLabel.toLowerCase()} agent.`,
    "",
    "## How I Operate",
    "- Stay workspace-grounded.",
    "- Keep changes small and reviewable.",
    "- Surface blockers early.",
    "",
    "## Notes",
    input.presetDescription
  ].join("\n");
}

function normalizeBootstrapValue(value: string | null | undefined) {
  if (typeof value !== "string") {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parseIdentityLine(lines: string[], label: string) {
  const pattern = new RegExp(`^\\s*-\\s*\\*\\*${label}:\\*\\*\\s*(.*)\\s*$`, "i");
  const matchLine = lines.find((line) => pattern.test(line.trim()));
  const value = matchLine?.match(pattern)?.[1] ?? null;

  return normalizeMarkdownValue(value);
}

function normalizeMarkdownValue(value: string | null) {
  if (value === null) {
    return null;
  }

  const cleaned = value
    .replace(/\r\n/g, "\n")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\[(.*?)\]\((.*?)\)/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned.length > 0 ? cleaned : null;
}
