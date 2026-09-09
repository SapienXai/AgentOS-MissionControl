import type { AgentPolicy, WorkspaceSourceMode } from "@/lib/openclaw/types";

export type WorkspaceAgentsMarkdownAgentInput = {
  id?: string | null;
  name?: string | null;
  role?: string | null;
  enabled?: boolean | null;
  isPrimary?: boolean | null;
  skillId?: string | null;
  skillIds?: string[] | null;
  toolIds?: string[] | null;
  modelId?: string | null;
  policy?: AgentPolicy | null;
  channelIds?: string[] | null;
};

type NormalizedWorkspaceAgentInput = {
  id: string;
  name: string;
  role: string | null;
  enabled: boolean;
  isPrimary: boolean;
  skillId: string | null;
  skillIds: string[];
  toolIds: string[];
  modelId: string | null;
  policy: AgentPolicy | null;
  channelIds: string[];
};

export function renderWorkspaceAgentsMarkdown(params: {
  name: string;
  brief?: string;
  templateLabel: string;
  sourceMode: WorkspaceSourceMode;
  workspaceOnly: boolean;
  agents: WorkspaceAgentsMarkdownAgentInput[];
  workspaceSlug?: string | null;
  toolExamples?: string[];
}) {
  return `# ${params.name}

Shared project context for all agents working in this workspace.

## Workspace
- Template: ${params.templateLabel}
- Source mode: ${params.sourceMode}
- Workspace-only access: ${params.workspaceOnly ? "enabled" : "disabled"}

${renderWorkspaceAgentsTeamSection(params.agents, params.workspaceSlug)}

${renderWorkspaceToolsSection(params.toolExamples)}

## Customize
${params.brief || "Clarify the project goal, definition of done, constraints, and success signals before large changes."}

## Safety defaults
- Stay inside the attached workspace unless the task explicitly requires another location.
- Prefer direct, reviewable changes over speculative rewrites.
- Preserve user work and avoid destructive actions without clear approval.
- Update durable docs when stable architecture, workflow, or product decisions change.
- Worker and browser agents should not install tooling unless their explicit policy allows it.
- Route environment preparation to setup-oriented agents when the work depends on new tooling.

## Daily memory
- Keep MEMORY.md curated and concise; put focused durable notes in memory/*.md.
- Record stable decisions in memory/decisions.md.
- Keep temporary chatter and scratch notes in memory/.

## Output
- Be concise in chat and write longer output to files when the artifact matters.
- Put task-specific deliverables, drafts, reports, and docs inside per-run folders under deliverables/.
- Avoid writing final artifacts to the workspace root unless explicitly requested.
`;
}

export function renderWorkspaceToolsSection(toolExamples: string[] = []) {
  const examples = uniqueStrings(toolExamples);

  return `## Tools
Repository-local command and workflow guidance for this workspace. These notes are guidance only; OpenClaw config and policy determine actual permissions.

${(examples.length > 0
  ? examples
  : [
      "Use repository-local scripts or documented commands for repeatable workflows.",
      "Prefer commands that can be verified by another agent without interpretation drift."
    ]
  ).map((line) => `- ${line}`).join("\n")}`;
}

export function renderWorkspaceAgentsTeamSection(
  agents: WorkspaceAgentsMarkdownAgentInput[],
  workspaceSlug?: string | null
) {
  const activeAgents = normalizeAgentInputs(agents, workspaceSlug).filter((agent) => agent.enabled);
  const lines = activeAgents.map((agent) => {
    const labels = [
      agent.isPrimary ? "primary" : null,
      agent.role
    ].filter((value): value is string => Boolean(value));

    return `- ${agent.name} (\`${agent.id}\`)${labels.length > 0 ? ` · ${labels.join(" · ")}` : ""}`;
  });

  return `## Team
${lines.length > 0 ? lines.join("\n") : "- No active agents configured yet."}`;
}

function normalizeAgentInputs(
  agents: WorkspaceAgentsMarkdownAgentInput[],
  workspaceSlug?: string | null
): NormalizedWorkspaceAgentInput[] {
  return [...agents]
    .map((agent, index) => {
      const baseId = normalizeOptionalValue(agent.id) ?? slugify(normalizeOptionalValue(agent.name) ?? `agent-${index + 1}`);
      const id = workspaceSlug && !baseId.startsWith(`${workspaceSlug}-`)
        ? `${workspaceSlug}-${slugify(baseId) || "agent"}`
        : baseId;
      const role = normalizeOptionalValue(agent.role);
      const skillIds = uniqueStrings([
        ...(agent.skillIds ?? []),
        normalizeOptionalValue(agent.skillId) ?? ""
      ]);

      return {
        id,
        name: normalizeOptionalValue(agent.name) ?? role ?? id,
        role,
        enabled: agent.enabled !== false,
        isPrimary: Boolean(agent.isPrimary),
        skillId: skillIds[0] ?? null,
        skillIds,
        toolIds: uniqueStrings(agent.toolIds ?? []),
        modelId: normalizeOptionalValue(agent.modelId),
        policy: agent.policy ?? null,
        channelIds: uniqueStrings(agent.channelIds ?? [])
      };
    })
    .sort((left, right) => {
      if (left.isPrimary !== right.isPrimary) {
        return left.isPrimary ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

export function replaceOrInsertMarkdownSection(
  content: string,
  sectionTitle: string,
  nextSection: string,
  insertAfterTitle?: string
) {
  const normalizedSection = nextSection.trim();
  const sectionMatch = findMarkdownSection(content, sectionTitle);

  if (sectionMatch) {
    return [
      content.slice(0, sectionMatch.start).trimEnd(),
      normalizedSection,
      content.slice(sectionMatch.end).trimStart()
    ].filter(Boolean).join("\n\n");
  }

  if (insertAfterTitle) {
    const insertAfterMatch = findMarkdownSection(content, insertAfterTitle);

    if (insertAfterMatch) {
      return [
        content.slice(0, insertAfterMatch.end).trimEnd(),
        normalizedSection,
        content.slice(insertAfterMatch.end).trimStart()
      ].filter(Boolean).join("\n\n");
    }
  }

  return [content.trimEnd(), normalizedSection].filter(Boolean).join("\n\n");
}

function findMarkdownSection(content: string, sectionTitle: string) {
  const heading = new RegExp(`^##\\s+${escapeRegExp(sectionTitle)}\\s*$`, "m");
  const match = heading.exec(content);

  if (!match || match.index === undefined) {
    return null;
  }

  const start = match.index;
  const afterHeadingIndex = start + match[0].length;
  const nextHeading = /^##\s+/m.exec(content.slice(afterHeadingIndex));
  const end = nextHeading?.index === undefined
    ? content.length
    : afterHeadingIndex + nextHeading.index;

  return { start, end };
}

function normalizeOptionalValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: readonly string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function ensureTrailingNewline(value: string) {
  return value.endsWith("\n") ? value : `${value}\n`;
}
