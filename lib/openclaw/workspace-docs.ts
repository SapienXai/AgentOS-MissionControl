import { formatAgentPresetLabel } from "@/lib/openclaw/agent-presets";
import type {
  AgentPolicy,
  PlannerPersistentAgentSpec,
  WorkspaceCreateRules,
  WorkspaceDocOverride,
  WorkspaceSourceMode,
  WorkspaceTemplate
} from "@/lib/openclaw/types";

type WorkspaceDocCategory = "core" | "memory" | "docs" | "deliverables";

type WorkspaceScaffoldDocumentSpec = {
  path: string;
  title: string;
  description: string;
  category: WorkspaceDocCategory;
  render: (context: WorkspaceScaffoldDocumentContext) => string;
};

export interface WorkspaceScaffoldDocumentContext {
  name: string;
  brief?: string;
  template: WorkspaceTemplate;
  sourceMode: WorkspaceSourceMode;
  rules: WorkspaceCreateRules;
  agents?: Array<Pick<PlannerPersistentAgentSpec, "role" | "name" | "skillId"> & { policy?: AgentPolicy }>;
  toolExamples?: string[];
  docOverrides?: WorkspaceDocOverride[];
}

export interface WorkspaceScaffoldDocument {
  path: string;
  title: string;
  description: string;
  category: WorkspaceDocCategory;
  baseContent: string;
  content: string;
  overridden: boolean;
}

export interface WorkspaceEditableDocument extends WorkspaceScaffoldDocument {
  generated: boolean;
}

const TEMPLATE_LABELS: Record<WorkspaceTemplate, string> = {
  software: "Software project",
  frontend: "Frontend app",
  backend: "Backend/API",
  research: "Research",
  content: "Content/Growth"
};

const DEFAULT_TOOL_EXAMPLES = [
  "Use repository-local scripts or documented commands for repeatable workflows.",
  "Update this file when the project exposes a cleaner build, test, or release path."
];

export function buildWorkspaceScaffoldDocumentPaths(
  template: WorkspaceTemplate,
  rules: WorkspaceCreateRules
) {
  return buildWorkspaceScaffoldDocumentSpecs(template, rules).map((spec) => spec.path);
}

export function buildWorkspaceScaffoldDocuments(context: WorkspaceScaffoldDocumentContext) {
  const specs = buildWorkspaceScaffoldDocumentSpecs(context.template, context.rules);
  const overrideMap = new Map(normalizeWorkspaceDocOverrides(context.docOverrides).map((entry) => [entry.path, entry.content]));

  return specs.map((spec) => {
    const baseContent = spec.render(context);
    const hasOverride = overrideMap.has(spec.path);

    return {
      path: spec.path,
      title: spec.title,
      description: spec.description,
      category: spec.category,
      baseContent,
      content: hasOverride ? overrideMap.get(spec.path) ?? "" : baseContent,
      overridden: hasOverride
    } satisfies WorkspaceScaffoldDocument;
  });
}

export function buildWorkspaceEditableDocuments(context: WorkspaceScaffoldDocumentContext) {
  const scaffoldDocuments = buildWorkspaceScaffoldDocuments(context).map(
    (document) =>
      ({
        ...document,
        generated: true
      }) satisfies WorkspaceEditableDocument
  );
  const scaffoldPathSet = new Set(scaffoldDocuments.map((document) => document.path));
  const extraDocuments = normalizeWorkspaceDocOverrides(context.docOverrides)
    .filter((entry) => !scaffoldPathSet.has(entry.path))
    .map(
      (entry) =>
        ({
          path: entry.path,
          title: entry.path,
          description: "Existing workspace file.",
          category: inferWorkspaceDocCategory(entry.path),
          baseContent: entry.content,
          content: entry.content,
          overridden: false,
          generated: false
        }) satisfies WorkspaceEditableDocument
    );

  return [...scaffoldDocuments, ...extraDocuments];
}

export function normalizeWorkspaceDocOverrides(overrides?: WorkspaceDocOverride[]) {
  const byPath = new Map<string, string>();

  for (const override of overrides ?? []) {
    const path = override.path.trim();

    if (!path) {
      continue;
    }

    byPath.set(path, override.content);
  }

  return Array.from(byPath.entries()).map(([path, content]) => ({
    path,
    content
  }));
}

export function renderSkillMarkdown(skillId: string, role: string) {
  switch (skillId) {
    case "project-builder":
      return `# Project Builder

Use this skill when implementing changes in the current project.

- Prefer direct code or artifact changes over speculative planning.
- Respect AGENTS.md, TOOLS.md, MEMORY.md, and memory/*.md before large edits.
- Put task-specific artifacts under the current deliverables run folder instead of the workspace root.
- Verify impact before finishing and leave the workspace in a clearer state.
`;
    case "project-reviewer":
      return `# Project Reviewer

Use this skill when reviewing changes in the current project.

- Prioritize correctness, regressions, edge cases, and missing tests.
- Prefer concrete findings with file and behavior references.
- Keep summaries brief after findings.
`;
    case "project-tester":
      return `# Project Tester

Use this skill when validating behavior in the current project.

- Prefer reproducible checks over assumptions.
- Focus on failures, regressions, missing coverage, and environment constraints.
- Report exactly what was verified and what could not be verified.
`;
    case "project-learner":
      return `# Project Learner

Use this skill when consolidating durable project knowledge.

- Capture stable conventions, architecture decisions, and delivery notes.
- Prefer updating MEMORY.md or memory/*.md with concise, durable facts.
- Avoid ephemeral chatter and duplicated notes.
`;
    case "project-browser":
      return `# Project Browser

Use this skill when validating browser flows in the current workspace.

- Exercise real user paths, not only component-level assumptions.
- Capture screenshots, repro steps, and UI regressions with concrete evidence.
- Hand off findings that need code changes back to the implementation agent.
`;
    case "project-researcher":
      return `# Project Researcher

Use this skill when investigating, synthesizing, or pressure-testing a problem space.

- Start with explicit questions, evidence sources, and output goals.
- Distinguish verified facts from inference.
- Convert durable findings into MEMORY.md or memory/*.md.
`;
    case "project-strategist":
      return `# Project Strategist

Use this skill when shaping positioning, campaign direction, or editorial priorities.

- Tie recommendations to audience, channel, and measurable goals.
- Prefer explicit tradeoffs over vague guidance.
- Save task-specific briefs, plans, and campaign artifacts inside the current deliverables run folder.
- Leave a clear next-step plan other agents can execute.
`;
    case "project-writer":
      return `# Project Writer

Use this skill when drafting messaging, copy, or narrative assets.

- Write for the target audience and channel rather than internal shorthand.
- Keep tone and structure consistent with the workspace brief.
- Save publishable drafts and task-specific docs inside the current deliverables run folder.
- Flag assumptions that need strategic review before publication.
`;
    case "project-analyst":
      return `# Project Analyst

Use this skill when evaluating results, experiments, or performance signals.

- Prefer measurable baselines and explicit comparisons.
- Separate observed performance from speculation about causality.
- Keep task-specific reports and analysis artifacts inside the current deliverables run folder.
- Write down recommendations that can be actioned by the team.
`;
    default:
      return `# ${role}

Use this skill when operating in the current workspace.

- Stay grounded in the shared workspace context.
- Produce durable artifacts when the work needs to be handed off.
- Put task-specific artifacts in the current deliverables run folder and keep notes in memory/.
`;
  }
}

function buildWorkspaceScaffoldDocumentSpecs(
  template: WorkspaceTemplate,
  rules: WorkspaceCreateRules
): WorkspaceScaffoldDocumentSpec[] {
  const specs: WorkspaceScaffoldDocumentSpec[] = [
    {
      path: "AGENTS.md",
      title: "AGENTS.md",
      description: "Shared operating instructions for all agents.",
      category: "core",
      render: renderAgentsMarkdown
    },
    {
      path: "SOUL.md",
      title: "SOUL.md",
      description: "Purpose, operating style, and active focus.",
      category: "core",
      render: ({ template, brief }) => renderSoulMarkdown(template, brief)
    },
    {
      path: "IDENTITY.md",
      title: "IDENTITY.md",
      description: "Workspace identity and vibe.",
      category: "core",
      render: ({ template }) => renderIdentityMarkdown(template)
    },
    {
      path: "TOOLS.md",
      title: "TOOLS.md",
      description: "Repository commands and workflow notes.",
      category: "core",
      render: ({ template, toolExamples }) => renderToolsMarkdown(template, toolExamples ?? DEFAULT_TOOL_EXAMPLES)
    },
    {
      path: "HEARTBEAT.md",
      title: "HEARTBEAT.md",
      description: "Refresh ritual and coherence checks.",
      category: "core",
      render: ({ template }) => renderHeartbeatMarkdown(template)
    }
  ];

  if (rules.generateMemory) {
    specs.push(
      {
        path: "MEMORY.md",
        title: "MEMORY.md",
        description: "Durable project memory.",
        category: "memory",
        render: ({ name, template, brief }) => renderMemoryMarkdown(name, template, brief)
      },
      {
        path: "memory/blueprint.md",
        title: "memory/blueprint.md",
        description: "Project blueprint and current outcome.",
        category: "memory",
        render: ({ name, template, brief }) => renderBlueprintMarkdown(name, template, brief)
      },
      {
        path: "memory/decisions.md",
        title: "memory/decisions.md",
        description: "Decision log.",
        category: "memory",
        render: () => renderDecisionsMarkdown()
      }
    );
  }

  if (rules.generateStarterDocs) {
    specs.push(
      {
        path: "docs/brief.md",
        title: "docs/brief.md",
        description: "Objective, source mode, and success signals.",
        category: "docs",
        render: ({ name, template, brief, sourceMode }) => renderBriefMarkdown(name, template, brief, sourceMode)
      },
      {
        path: "docs/architecture.md",
        title: "docs/architecture.md",
        description: "Current system shape and dependencies.",
        category: "docs",
        render: ({ template }) => renderArchitectureMarkdown(template)
      },
      {
        path: "deliverables/README.md",
        title: "deliverables/README.md",
        description: "Guidance for handoff artifacts.",
        category: "deliverables",
        render: () => renderDeliverablesMarkdown()
      }
    );
  }

  if (template === "frontend") {
    specs.push({
      path: "docs/ux-notes.md",
      title: "docs/ux-notes.md",
      description: "Interaction patterns and UI risks.",
      category: "docs",
      render: () => renderTemplateSpecificDoc("ux")
    });
  }

  if (template === "backend") {
    specs.push({
      path: "docs/service-map.md",
      title: "docs/service-map.md",
      description: "Service, queue, and dependency map.",
      category: "docs",
      render: () => renderTemplateSpecificDoc("backend")
    });
  }

  if (template === "research") {
    specs.push({
      path: "docs/research-plan.md",
      title: "docs/research-plan.md",
      description: "Question framing and evidence plan.",
      category: "docs",
      render: () => renderTemplateSpecificDoc("research")
    });
  }

  if (template === "content") {
    specs.push({
      path: "docs/content-brief.md",
      title: "docs/content-brief.md",
      description: "Audience, channel, and campaign brief.",
      category: "docs",
      render: () => renderTemplateSpecificDoc("content")
    });
  }

  return specs;
}

function inferWorkspaceDocCategory(path: string): WorkspaceDocCategory {
  if (path.startsWith("memory/")) {
    return "memory";
  }

  if (path.startsWith("docs/")) {
    return "docs";
  }

  if (path.startsWith("deliverables/")) {
    return "deliverables";
  }

  return "core";
}

function renderAgentsMarkdown({
  name,
  brief,
  template,
  sourceMode,
  rules,
  agents = []
}: WorkspaceScaffoldDocumentContext) {
  const teamLines = agents.map(
    (agent) =>
      `- ${agent.role}: ${agent.name}${agent.skillId ? ` · skill ${agent.skillId}` : ""}${
        agent.policy ? ` · ${formatAgentPresetLabel(agent.policy.preset)}` : ""
      }`
  );

  return `# ${name}

Shared project context for all agents working in this workspace.

## Workspace
- Template: ${TEMPLATE_LABELS[template]}
- Source mode: ${sourceMode}
- Workspace-only access: ${rules.workspaceOnly ? "enabled" : "disabled"}

## Team
${teamLines.length > 0 ? teamLines.join("\n") : "- No agents configured yet."}

## Customize
${brief || "Clarify the project goal, definition of done, constraints, and success signals before large changes."}

## Safety defaults
- Stay inside the attached workspace unless the task explicitly requires another location.
- Prefer direct, reviewable changes over speculative rewrites.
- Preserve user work and avoid destructive actions without clear approval.
- Update durable docs when stable architecture, workflow, or product decisions change.
- Worker and browser agents should not install tooling unless their explicit policy allows it.
- Route environment preparation to setup-oriented agents when the work depends on new tooling.

## Daily memory
- Capture durable facts in MEMORY.md and memory/*.md.
- Record stable decisions in memory/decisions.md.
- Keep temporary chatter and scratch notes in memory/.

## Output
- Be concise in chat and write longer output to files when the artifact matters.
- Put task-specific deliverables, drafts, reports, and docs inside per-run folders under deliverables/.
- Avoid writing final artifacts to the workspace root unless explicitly requested.
`;
}

function renderSoulMarkdown(template: WorkspaceTemplate, brief?: string) {
  return `# SOUL

## My Purpose
Help this ${TEMPLATE_LABELS[template].toLowerCase()} workspace turn intent into real outcomes with pragmatic execution, verification, and durable memory.

## How I Operate
- Start from the current workspace reality before proposing large moves.
- Prefer concrete action, visible artifacts, and clear handoffs.
- Keep docs, memory, and deliverables aligned with the actual state of the work.

## My Quirks
- Pragmatic
- Direct
- Product-aware
- Quality-minded

${brief ? `## Active Focus\n${brief}\n` : ""}`;
}

function renderIdentityMarkdown(template: WorkspaceTemplate) {
  return `# IDENTITY

## Role
This workspace hosts a ${TEMPLATE_LABELS[template].toLowerCase()} team coordinated through OpenClaw.

**Vibe:** pragmatic, concise, quality-minded, workspace-grounded
`;
}

function renderToolsMarkdown(template: WorkspaceTemplate, toolExamples: string[]) {
  return `# TOOLS

Repository commands and workflow notes for this ${TEMPLATE_LABELS[template].toLowerCase()} workspace.

## Examples
${toolExamples.map((line) => `- ${line}`).join("\n")}

## Notes
- Replace these examples with sharper project-specific commands when the repo exposes them.
- Prefer repeatable commands that other agents can run without interpretation drift.
`;
}

function renderHeartbeatMarkdown(template: WorkspaceTemplate) {
  return `# HEARTBEAT

- Start each substantial task by refreshing the brief, docs, and current files.
- Keep the ${TEMPLATE_LABELS[template].toLowerCase()} workspace coherent across code, docs, and memory.
- Prefer explicit handoffs between implementation, review, testing, and knowledge capture.
`;
}

function renderMemoryMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return `# ${name} Memory

Durable project facts for this ${TEMPLATE_LABELS[template].toLowerCase()} workspace.

## Current brief
${brief || "No brief captured yet. Fill this in as soon as the project goal is clarified."}

## Stable facts
- Add durable architecture, product, or workflow facts here.
- Move longer notes into memory/*.md when they outgrow this file.
`;
}

function renderBlueprintMarkdown(name: string, template: WorkspaceTemplate, brief?: string) {
  return `# ${name} Blueprint

## Workspace type
${TEMPLATE_LABELS[template]}

## Outcome
${brief || "Define the target outcome, user impact, and quality bar for this workspace."}

## Constraints
- Add technical, product, legal, or operational constraints here.

## Unknowns
- Capture unresolved questions that block confident execution.
`;
}

function renderDecisionsMarkdown() {
  return `# Decisions

Use this file for durable decisions that should survive across sessions.

## Template
- Date:
- Decision:
- Context:
- Consequence:
`;
}

function renderBriefMarkdown(
  name: string,
  template: WorkspaceTemplate,
  brief: string | undefined,
  sourceMode: WorkspaceSourceMode
) {
  return `# ${name} Brief

## Template
${TEMPLATE_LABELS[template]}

## Source mode
${sourceMode}

## Objective
${brief || "Clarify the main goal, target user, and success definition for this workspace."}

## Success signals
- Define what success looks like in observable terms.

## Open questions
- List the unknowns worth resolving first.
`;
}

function renderArchitectureMarkdown(template: WorkspaceTemplate) {
  return `# Architecture

## Current shape
- Describe the main components, systems, or content lanes in this ${TEMPLATE_LABELS[template].toLowerCase()} workspace.

## Dependencies
- List critical external services, repos, data sources, or channels.

## Risks
- Capture structural, operational, or delivery risks here.
`;
}

function renderDeliverablesMarkdown() {
  return `# Deliverables

Use this folder for substantial output artifacts that should be easy to hand off or review.

- Create one subfolder per task or run, for example \`deliverables/2026-03-07-15-30-00-launch-brief/\`.
- Put drafts, reports, docs, and publishable assets for that task inside its run folder.
- Keep filenames descriptive and tied to the task or audience.
`;
}

function renderTemplateSpecificDoc(kind: "ux" | "backend" | "research" | "content") {
  if (kind === "ux") {
    return `# UX Notes

- Track interaction patterns, responsive edge cases, and visual risk areas here.
`;
  }

  if (kind === "backend") {
    return `# Service Map

- Document services, jobs, queues, external dependencies, and critical flows here.
`;
  }

  if (kind === "research") {
    return `# Research Plan

- State the question, method, evidence sources, and expected output before large investigation work.
`;
  }

  return `# Content Brief

- Capture audience, channel, tone, CTA, and distribution assumptions for this content workspace.
`;
}
