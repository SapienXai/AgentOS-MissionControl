import { execFile } from "node:child_process";
import { access, mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  formatAgentPresetLabel,
  inferAgentPresetFromContext,
  resolveAgentPolicy
} from "@/lib/openclaw/agent-presets";
import { resolveHeartbeatDraft } from "@/lib/openclaw/agent-heartbeat";
import {
  buildWorkspaceContextManifest,
  buildWorkspaceScaffoldDocuments,
  normalizeWorkspaceDocOverrides,
  type WorkspaceScaffoldDocumentContext
} from "@/lib/openclaw/workspace-docs";
import {
  DEFAULT_WORKSPACE_RULES,
  buildDefaultWorkspaceAgents,
  buildWorkspaceAgentName,
  getWorkspaceTemplateMeta
} from "@/lib/openclaw/workspace-presets";
import type {
  AgentPolicy,
  PlannerContextSource,
  WorkspaceAgentBlueprintInput,
  WorkspaceCreateInput,
  WorkspaceCreateRules,
  WorkspaceDocOverride,
  WorkspaceModelProfile,
  WorkspaceSourceMode,
  WorkspaceTemplate
} from "@/lib/openclaw/types";

const execFileAsync = promisify(execFile);

export type ResolvedWorkspaceBootstrapInput = {
  name: string;
  slug: string;
  brief?: string;
  directory?: string;
  modelId?: string;
  repoUrl?: string;
  existingPath?: string;
  sourceMode: WorkspaceSourceMode;
  template: WorkspaceTemplate;
  teamPreset: NonNullable<WorkspaceCreateInput["teamPreset"]>;
  modelProfile: WorkspaceModelProfile;
  rules: WorkspaceCreateRules;
  docOverrides: WorkspaceDocOverride[];
  agents: WorkspaceAgentBlueprintInput[];
  contextSources: PlannerContextSource[];
};

function normalizeOptionalValue(value: string | null | undefined) {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function findDuplicateStrings(values: string[]) {
  const seen = new Set<string>();
  const duplicates = new Set<string>();

  for (const value of values) {
    if (seen.has(value)) {
      duplicates.add(value);
      continue;
    }

    seen.add(value);
  }

  return Array.from(duplicates).sort((left, right) => left.localeCompare(right));
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

async function pathExists(targetPath: string) {
  try {
    await access(targetPath);
    return true;
  } catch {
    return false;
  }
}

async function runSystemCommand(
  command: string,
  args: string[],
  options: {
    cwd?: string;
    timeoutMs?: number;
  } = {}
) {
  try {
    await execFileAsync(command, args, {
      cwd: options.cwd ?? process.cwd(),
      timeout: options.timeoutMs ?? 120000,
      maxBuffer: 8 * 1024 * 1024
    });
  } catch (error) {
    const message =
      typeof error === "object" &&
      error &&
      "stderr" in error &&
      typeof error.stderr === "string" &&
      error.stderr.trim()
        ? error.stderr.trim()
        : error instanceof Error
          ? error.message
          : "Unknown system command failure.";

    throw new Error(message);
  }
}

export async function writeTextFileIfMissing(filePath: string, contents: string) {
  try {
    await access(filePath);
  } catch {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, contents, "utf8");
  }
}

export async function writeTextFileEnsured(filePath: string, contents: string) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents, "utf8");
}

async function ensureTargetPathVacant(targetPath: string) {
  try {
    await access(targetPath);
    throw new Error("Target workspace directory already exists.");
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      return;
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to verify target workspace directory.");
  }
}

async function ensureFreshWorkspaceDirectory(targetDir: string) {
  try {
    const targetStat = await stat(targetDir);

    if (!targetStat.isDirectory()) {
      throw new Error("Target workspace path exists and is not a directory.");
    }

    const entries = await readdir(targetDir);

    if (entries.length > 0) {
      throw new Error("Target workspace directory already contains files. Use Existing folder instead.");
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      await mkdir(targetDir, { recursive: true });
      return;
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to prepare the workspace directory.");
  }

  await mkdir(targetDir, { recursive: true });
}

async function ensureExistingDirectory(targetDir: string) {
  try {
    const targetStat = await stat(targetDir);

    if (!targetStat.isDirectory()) {
      throw new Error("The selected existing path is not a directory.");
    }
  } catch (error) {
    const code = typeof error === "object" && error && "code" in error ? error.code : undefined;

    if (code === "ENOENT") {
      throw new Error("The selected existing folder does not exist.");
    }

    if (error instanceof Error) {
      throw error;
    }

    throw new Error("Unable to access the selected existing folder.");
  }
}

async function detectPackageManager(workspacePath: string, declaredPackageManager?: string) {
  const normalizedDeclared = normalizeOptionalValue(declaredPackageManager);

  if (normalizedDeclared) {
    return normalizedDeclared.split("@")[0];
  }

  if (await pathExists(path.join(workspacePath, "pnpm-lock.yaml"))) {
    return "pnpm";
  }

  if (await pathExists(path.join(workspacePath, "yarn.lock"))) {
    return "yarn";
  }

  return "npm";
}

function formatPackageScript(packageManager: string, scriptName: string) {
  return packageManager === "yarn" ? `yarn ${scriptName}` : `${packageManager} run ${scriptName}`;
}

async function detectPackageExamples(workspacePath: string) {
  const packageJsonPath = path.join(workspacePath, "package.json");

  try {
    const raw = await readFile(packageJsonPath, "utf8");
    const parsed = JSON.parse(raw) as {
      packageManager?: string;
      scripts?: Record<string, string>;
    };
    const scripts = parsed.scripts ?? {};
    const manager = await detectPackageManager(workspacePath, parsed.packageManager);
    const examples = [`Use \`${manager} install\` before the first local run.`];

    for (const scriptName of ["dev", "start", "test", "lint", "build"]) {
      if (scripts[scriptName]) {
        examples.push(`Use \`${formatPackageScript(manager, scriptName)}\` for the ${scriptName} workflow.`);
      }
    }

    return examples;
  } catch {
    return [];
  }
}

async function detectMakeExamples(workspacePath: string) {
  const makefilePath = path.join(workspacePath, "Makefile");

  try {
    const raw = await readFile(makefilePath, "utf8");
    const matches = raw.match(/^(dev|test|lint|build|run):/gm) ?? [];
    return matches.map((entry) => `Use \`make ${entry.replace(/:$/, "")}\` if the Makefile is the primary entry point.`);
  } catch {
    return [];
  }
}

async function detectPythonExamples(workspacePath: string) {
  const examples: string[] = [];

  if (await pathExists(path.join(workspacePath, "pyproject.toml"))) {
    examples.push("Use `pytest` for Python verification if the project exposes a test suite.");
  }

  if (await pathExists(path.join(workspacePath, "requirements.txt"))) {
    examples.push("Install Python dependencies in a virtualenv before running project commands.");
  }

  return examples;
}

export async function detectWorkspaceToolExamples(workspacePath: string) {
  const examples: string[] = [];
  const packageExamples = await detectPackageExamples(workspacePath);
  const makeExamples = await detectMakeExamples(workspacePath);
  const pythonExamples = await detectPythonExamples(workspacePath);

  examples.push(...packageExamples, ...makeExamples, ...pythonExamples);

  if (examples.length === 0) {
    examples.push(
      "Use repository-local scripts or documented commands for repeatable workflows.",
      "Update this file when the project exposes a cleaner build, test, or release path."
    );
  }

  return uniqueStrings(examples).slice(0, 6);
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
- Keep outputs specific, reviewable, and easy for other agents to extend.
`;
  }
}

export function buildAgentPolicyPromptLines(policy: AgentPolicy, setupAgentId?: string | null) {
  const lines: string[] = [`- Preset: ${formatAgentPresetLabel(policy.preset)}.`];

  if (policy.preset === "browser") {
    lines.push("- Prefer browser-native evidence capture, screenshots, and reproducible user-path validation.");
  } else if (policy.preset === "monitoring") {
    lines.push("- Periodically inspect the workspace, surface blockers, and leave concise triage handoffs without broad implementation changes.");
  } else if (policy.preset === "setup") {
    lines.push("- Prepare the environment, unblock other agents, and keep mutations minimal and explicit.");
  } else if (policy.preset === "worker") {
    lines.push("- Focus on producing deliverables, reviews, analysis, or code without unnecessary environment mutation.");
  } else {
    lines.push("- Operate with the selected policy, keep artifacts reviewable, and avoid surprising side effects.");
  }

  switch (policy.missingToolBehavior) {
    case "fallback":
      lines.push(
        "- If required tooling is unavailable, do not install it. Produce the closest viable fallback artifact, such as .md or .txt, and state the limitation."
      );
      break;
    case "ask-setup":
      lines.push(
        "- If required tooling is unavailable, stop before installing anything and report the missing capability clearly."
      );
      break;
    case "route-setup":
      lines.push(
        setupAgentId
          ? `- If required tooling is unavailable, do not install it yourself. Leave a concrete handoff for setup agent \`${setupAgentId}\` with the exact missing tools or commands.`
          : "- If required tooling is unavailable, do not install it yourself. Leave a concrete setup handoff with the exact missing tools or commands."
      );
      break;
    case "allow-install":
      lines.push("- If required tooling is unavailable, you may install it when the install scope below permits it.");
      break;
  }

  switch (policy.installScope) {
    case "none":
      lines.push("- Install scope: none. Do not run package installation commands.");
      break;
    case "workspace":
      lines.push(
        "- Install scope: workspace only. Limit installs to project-local or workspace-local dependencies and avoid system package managers."
      );
      break;
    case "system":
      lines.push("- Install scope: system. System-wide installs are allowed when necessary, but keep them minimal and report what changed.");
      break;
  }

  lines.push(
    policy.fileAccess === "workspace-only"
      ? "- File access: workspace only. Keep file operations inside the attached workspace."
      : "- File access: extended. Prefer the workspace, but you may touch adjacent paths when the task explicitly needs them."
  );
  lines.push(
    policy.networkAccess === "enabled"
      ? "- Network access: enabled when the task requires external information or downloads."
      : "- Network access: restricted. Avoid network access unless the task explicitly depends on it."
  );

  return lines;
}

function normalizeWorkspaceContextSources(
  sources?: WorkspaceCreateInput["contextSources"]
): PlannerContextSource[] {
  return (sources ?? []).flatMap((source) => {
    if (!source || typeof source !== "object") {
      return [];
    }

    const kind = isPlannerContextSourceKind(source.kind) ? source.kind : "prompt";
    const label = normalizeOptionalValue(source.label) ?? kind;
    const summary = normalizeOptionalValue(source.summary) ?? label;
    const status = source.status === "error" ? "error" : "ready";
    const createdAt = normalizeOptionalValue(source.createdAt) ?? new Date().toISOString();

    if (!label || !summary) {
      return [];
    }

    const normalizedSource: PlannerContextSource = {
      id: normalizeOptionalValue(source.id) ?? `${kind}-${slugify(label) || "context"}`,
      kind,
      label,
      summary,
      details: Array.isArray(source.details)
        ? source.details
            .map((entry) => normalizeOptionalValue(entry) ?? "")
            .filter((entry): entry is string => Boolean(entry))
        : [],
      status,
      createdAt
    };

    const confidence = typeof source.confidence === "number" ? source.confidence : undefined;
    const error = normalizeOptionalValue(source.error) ?? undefined;
    const url = normalizeOptionalValue(source.url) ?? undefined;

    if (confidence !== undefined) {
      normalizedSource.confidence = confidence;
    }

    if (error !== undefined) {
      normalizedSource.error = error;
    }

    if (url !== undefined) {
      normalizedSource.url = url;
    }

    return [normalizedSource];
  });
}

function isPlannerContextSourceKind(value: unknown): value is PlannerContextSource["kind"] {
  return value === "prompt" || value === "website" || value === "repo" || value === "folder";
}

export function resolveWorkspaceCreationTargetDir(
  input: ResolvedWorkspaceBootstrapInput,
  workspaceRoot: string
) {
  if (input.sourceMode === "existing") {
    const existingPath = input.existingPath || input.directory;

    if (!existingPath) {
      throw new Error("Choose an existing folder for this workspace.");
    }

    return path.isAbsolute(existingPath) ? existingPath : path.resolve(existingPath);
  }

  if (input.directory) {
    return path.isAbsolute(input.directory) ? input.directory : path.join(workspaceRoot, input.directory);
  }

  return path.join(workspaceRoot, input.slug);
}

export async function materializeWorkspaceSource(params: {
  targetDir: string;
  sourceMode: WorkspaceSourceMode;
  repoUrl?: string;
}) {
  if (params.sourceMode === "existing") {
    await ensureExistingDirectory(params.targetDir);
    return;
  }

  if (params.sourceMode === "clone") {
    const repoUrl = normalizeOptionalValue(params.repoUrl);

    if (!repoUrl) {
      throw new Error("Repository URL is required when cloning a repo.");
    }

    await ensureTargetPathVacant(params.targetDir);
    await mkdir(path.dirname(params.targetDir), { recursive: true });
    await runSystemCommand("git", ["clone", repoUrl, params.targetDir]);
    return;
  }

  await ensureFreshWorkspaceDirectory(params.targetDir);
}

export async function scaffoldWorkspaceContents(
  workspacePath: string,
  options: {
    name: string;
    brief?: string;
    template: WorkspaceTemplate;
    teamPreset: NonNullable<WorkspaceCreateInput["teamPreset"]>;
    modelProfile: WorkspaceModelProfile;
    rules: WorkspaceCreateRules;
    sourceMode: WorkspaceSourceMode;
    docOverrides: WorkspaceDocOverride[];
    agents: WorkspaceAgentBlueprintInput[];
    contextSources: WorkspaceScaffoldDocumentContext["contextSources"];
  }
) {
  const templateMeta = getWorkspaceTemplateMeta(options.template);
  const createdAt = new Date().toISOString();
  const toolExamples = await detectWorkspaceToolExamples(workspacePath);

  await ensureWorkspaceGitignore(workspacePath);
  await mkdir(path.join(workspacePath, "skills"), { recursive: true });
  await mkdir(path.join(workspacePath, ".openclaw", "project-shell", "runs"), { recursive: true });
  await mkdir(path.join(workspacePath, ".openclaw", "project-shell", "tasks"), { recursive: true });

  await writeTextFileIfMissing(path.join(workspacePath, ".openclaw", "project-shell", "events.jsonl"), "");
  await writeTextFileIfMissing(
    path.join(workspacePath, ".openclaw", "project.json"),
    `${JSON.stringify(
      {
        version: 1,
        slug: slugify(options.name),
        name: options.name,
        icon: templateMeta.icon,
        createdAt,
        updatedAt: createdAt,
        template: options.template,
        sourceMode: options.sourceMode,
        teamPreset: options.teamPreset,
        modelProfile: options.modelProfile,
        agentTemplate: options.teamPreset === "solo" ? "solo" : "core-team",
        rules: {
          workspaceOnly: options.rules.workspaceOnly,
          generateStarterDocs: options.rules.generateStarterDocs,
          generateMemory: options.rules.generateMemory,
          kickoffMission: options.rules.kickoffMission
        },
        contextSources: options.contextSources,
        agents: options.agents.map((agent) => ({
          id: agent.id,
          name: agent.name,
          role: agent.role,
          enabled: agent.enabled,
          emoji: normalizeOptionalValue(agent.emoji) ?? null,
          theme: normalizeOptionalValue(agent.theme) ?? null,
          isPrimary: Boolean(agent.isPrimary),
          skillId: normalizeOptionalValue(agent.skillId) ?? null,
          modelId: normalizeOptionalValue(agent.modelId) ?? null,
          policy: agent.policy ?? null
        }))
      },
      null,
      2
    )}\n`
  );

  const scaffoldDocuments = buildWorkspaceScaffoldDocuments({
    name: options.name,
    brief: options.brief,
    template: options.template,
    sourceMode: options.sourceMode,
    rules: options.rules,
    agents: options.agents,
    toolExamples,
    docOverrides: options.docOverrides,
    contextSources: options.contextSources
  });

  for (const document of scaffoldDocuments) {
    await writeTextFileIfMissing(path.join(workspacePath, document.path), document.content);
  }

  for (const agent of options.agents) {
    const skillId = normalizeOptionalValue(agent.skillId);

    if (!skillId) {
      continue;
    }

    await mkdir(path.join(workspacePath, "skills", skillId), { recursive: true });
    await writeTextFileIfMissing(path.join(workspacePath, "skills", skillId, "SKILL.md"), `${renderSkillMarkdown(skillId, agent.role)}\n`);
  }
}

export function resolveWorkspaceBootstrapInput(input: WorkspaceCreateInput): ResolvedWorkspaceBootstrapInput {
  const name = input.name.trim();

  if (!name) {
    throw new Error("Workspace name is required.");
  }

  const slug = slugify(name);

  if (!slug) {
    throw new Error("Workspace name must include letters or numbers.");
  }

  const template = input.template ?? "software";
  const teamPreset = input.teamPreset ?? "core";
  const sourceMode = input.sourceMode ?? "empty";
  const modelProfile = input.modelProfile ?? "balanced";
  const rules: WorkspaceCreateRules = {
    ...DEFAULT_WORKSPACE_RULES,
    ...(input.rules ?? {})
  };
  const normalizedAgents = (input.agents?.length
    ? input.agents
    : buildDefaultWorkspaceAgents(template, teamPreset, name)
  ).map((agent) => ({
    id: slugify(agent.id) || "agent",
    role: agent.role.trim() || prettifyAgentName(agent.id),
    name:
      normalizeOptionalValue(agent.name) ??
      (agent.isPrimary
        ? buildWorkspaceAgentName(name, agent.role, prettifyAgentName(agent.id))
        : prettifyAgentName(agent.id)),
    enabled: agent.enabled !== false,
    emoji: normalizeOptionalValue(agent.emoji) ?? undefined,
    theme: normalizeOptionalValue(agent.theme) ?? undefined,
    skillId: normalizeOptionalValue(agent.skillId) ?? undefined,
    modelId: normalizeOptionalValue(agent.modelId) ?? undefined,
    isPrimary: Boolean(agent.isPrimary),
    heartbeat: resolveHeartbeatDraft(
      agent.policy?.preset ??
        inferAgentPresetFromContext({
          skills: agent.skillId ? [agent.skillId] : [],
          id: agent.id,
          name: agent.name
        }),
      agent.heartbeat
    ),
    policy: resolveAgentPolicy(
      agent.policy?.preset ??
        inferAgentPresetFromContext({
          skills: agent.skillId ? [agent.skillId] : [],
          id: agent.id,
          name: agent.name
        }),
      {
        ...agent.policy,
        fileAccess: rules.workspaceOnly ? agent.policy?.fileAccess ?? "workspace-only" : "extended"
      }
    )
  }));

  if (!normalizedAgents.some((agent) => agent.enabled && agent.isPrimary)) {
    const firstEnabledAgent = normalizedAgents.find((agent) => agent.enabled);
    if (firstEnabledAgent) {
      firstEnabledAgent.isPrimary = true;
    }
  }

  const duplicateEnabledAgentIds = findDuplicateStrings(
    normalizedAgents.filter((agent) => agent.enabled).map((agent) => agent.id)
  );

  if (duplicateEnabledAgentIds.length > 0) {
    throw new Error(`Enabled agents must have unique ids. Conflicts: ${duplicateEnabledAgentIds.join(", ")}.`);
  }

  return {
    name,
    slug,
    brief: normalizeOptionalValue(input.brief) ?? undefined,
    directory: normalizeOptionalValue(input.directory) ?? undefined,
    modelId: normalizeOptionalValue(input.modelId) ?? undefined,
    repoUrl: normalizeOptionalValue(input.repoUrl) ?? undefined,
    existingPath: normalizeOptionalValue(input.existingPath) ?? undefined,
    sourceMode,
    template,
    teamPreset,
    modelProfile,
    rules,
    docOverrides: normalizeWorkspaceDocOverrides(input.docOverrides),
    agents: normalizedAgents,
    contextSources: normalizeWorkspaceContextSources(input.contextSources)
  };
}

export function describeWorkspaceSourceStart(sourceMode: WorkspaceSourceMode, targetDir: string) {
  if (sourceMode === "clone") {
    return `Cloning the source repository into ${targetDir}.`;
  }

  if (sourceMode === "existing") {
    return `Preparing the existing workspace folder at ${targetDir}.`;
  }

  return `Creating a fresh workspace folder at ${targetDir}.`;
}

export function describeWorkspaceSourceActivity(
  sourceMode: WorkspaceSourceMode,
  normalized: ResolvedWorkspaceBootstrapInput
) {
  if (sourceMode === "clone") {
    return normalized.repoUrl ? `Cloning ${normalized.repoUrl}.` : "Cloning the requested repository.";
  }

  if (sourceMode === "existing") {
    return normalized.existingPath ? `Attaching ${normalized.existingPath}.` : "Attaching the requested folder.";
  }

  return "Preparing an empty workspace scaffold.";
}

export function describeWorkspaceSourceCompletion(sourceMode: WorkspaceSourceMode, targetDir: string) {
  if (sourceMode === "clone") {
    return `Repository content is available at ${targetDir}.`;
  }

  if (sourceMode === "existing") {
    return `Existing folder linked and ready at ${targetDir}.`;
  }

  return `Fresh workspace folder created at ${targetDir}.`;
}

export function extractKickoffProgressMessages(text: string) {
  const trimmed = stripAnsiSequences(text).trim();

  if (!trimmed) {
    return [];
  }

  const normalized = trimmed
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => line.replace(/^[>•*-]\s*/, ""))
    .filter((line) => !line.startsWith("{") && !line.startsWith("["))
    .filter((line) => !/auth-profiles/i.test(line));

  return Array.from(new Set(normalized)).slice(0, 3);
}

function stripAnsiSequences(value: string) {
  return value.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
}

export function buildWorkspaceKickoffPrompt(
  template: WorkspaceTemplate,
  brief: string | undefined,
  rules: WorkspaceCreateRules
) {
  const templateMeta = getWorkspaceTemplateMeta(template);
  const contextManifest = buildWorkspaceContextManifest(template, rules);
  const manifestSummary = contextManifest.sections
    .map((section) => {
      const resourceList = section.resources.map((resource) => resource.label).join(", ");
      return section.enabled
        ? `${section.title}: ${resourceList || "none"}`
        : `${section.title}: disabled by workspace rules`;
    })
    .join("\n");

  return [
    `You are bootstrapping a newly created ${templateMeta.label.toLowerCase()} workspace.`,
    brief ? `Project brief: ${brief}` : "No detailed project brief was provided yet.",
    "Inspect the current files and improve the starter workspace without rewriting files that already had meaningful content.",
    "Treat the following workspace context manifest as the source of truth:",
    manifestSummary,
    "If those docs exist, refine the brief, architecture, memory, and deliverables guidance based on the real repository state instead of guessing.",
    "Leave the workspace with a concise first task batch and any critical unknowns clearly called out.",
    "Prefer concrete workspace-grounded edits over verbose chat output."
  ].join("\n\n");
}

async function ensureWorkspaceGitignore(workspacePath: string) {
  const gitignorePath = path.join(workspacePath, ".gitignore");
  let existing = "";

  try {
    existing = await readFile(gitignorePath, "utf8");
  } catch {
    existing = "";
  }

  const missingEntries = workspaceGitignoreManagedEntries.filter((entry) => !existing.includes(entry));

  if (missingEntries.length === 0) {
    return;
  }

  const managedBlock = ["# OpenClaw local runtime state", ...missingEntries].join("\n");
  const nextContents = existing.trim().length > 0 ? `${existing.trimEnd()}\n\n${managedBlock}\n` : `${managedBlock}\n`;

  await writeTextFileEnsured(gitignorePath, nextContents);
}

const workspaceGitignoreManagedEntries = [
  ".openclaw/agents/",
  ".openclaw/project-shell/events.jsonl",
  ".openclaw/project-shell/runs/",
  ".openclaw/project-shell/tasks/"
] as const;

function prettifyAgentName(agentId: string | undefined) {
  if (!agentId) {
    return "Agent";
  }

  return agentId
    .split(/[-_]+/g)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}
