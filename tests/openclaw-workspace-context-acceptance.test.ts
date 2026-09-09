import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import {
  clearOpenClawCapabilityMatrixCacheForTesting,
  setOpenClawCapabilityMatrixNativeCallerForTesting
} from "@/lib/openclaw/application/capability-matrix-service";
import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { buildAgentPolicySkillId, buildWorkspaceAgentStatePath } from "@/lib/openclaw/domains/agent-config";
import {
  createBootstrappedWorkspaceAgent,
  createWorkspaceAgentId,
  ensureAgentPolicySkill
} from "@/lib/openclaw/domains/agent-provisioning";
import { submitMissionDispatch } from "@/lib/openclaw/domains/mission-dispatch-workflow";
import {
  OPENCLAW_NATIVE_WORKSPACE_BOOTSTRAP_FILES,
  OPENCLAW_NATIVE_WORKSPACE_CONTEXT_PATHS,
  OPENCLAW_NATIVE_WORKSPACE_MEMORY_PATHS
} from "@/lib/openclaw/workspace-bootstrap-files";
import {
  resolveWorkspaceBootstrapInput,
  scaffoldWorkspaceContents
} from "@/lib/openclaw/domains/workspace-bootstrap";
import type {
  AgentPolicy,
  MissionControlSnapshot,
  OpenClawAgent,
  WorkspaceAgentBlueprintInput
} from "@/lib/openclaw/types";

const tempRoots: string[] = [];
const dispatchIds: string[] = [];

const workspaceOnlyPolicy = {
  preset: "worker",
  missingToolBehavior: "fallback",
  installScope: "workspace",
  fileAccess: "workspace-only",
  networkAccess: "restricted"
} satisfies AgentPolicy;

const setupPolicy = {
  preset: "setup",
  missingToolBehavior: "allow-install",
  installScope: "workspace",
  fileAccess: "workspace-only",
  networkAccess: "enabled"
} satisfies AgentPolicy;

afterEach(async () => {
  setOpenClawAdapterForTesting(null);
  setOpenClawCapabilityMatrixNativeCallerForTesting(null);
  clearOpenClawCapabilityMatrixCacheForTesting();

  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
  await Promise.all(
    dispatchIds.splice(0).map((dispatchId) =>
      rm(path.join(process.cwd(), ".mission-control", "dispatches", `${dispatchId}.json`), { force: true })
    )
  );
});

test("workspace context survives create, dispatch, restart, and second-workspace isolation", async () => {
  const adapterState = createAdapterState();
  setOpenClawAdapterForTesting(createContextAdapter(adapterState));
  setOpenClawCapabilityMatrixNativeCallerForTesting(async () => ({
    protocolVersion: 4,
    methods: ["chat.send"]
  }));

  const first = await createWorkspaceFixture({
    name: "Orion Ops Lab",
    brief: "Build a telemetry workspace for launch operations and incident playbooks.",
    docsBrief: "Orion Ops Lab coordinates telemetry reviews, launch goals, and incident playbooks.",
    architecture: "A Next.js control plane reads mission docs and writes verified deliverables."
  });
  const second = await createWorkspaceFixture({
    name: "Nimbus Billing Lab",
    brief: "Build a billing analytics workspace for subscription margin reviews.",
    docsBrief: "Nimbus Billing Lab tracks subscription margin, invoices, and pricing decisions.",
    architecture: "A billing dashboard isolates analytics docs from launch operations context."
  });

  assertAddAgentPayload(adapterState.addAgentInputs, first.builderAgentId, first.workspacePath, "openai/test");
  assertAgentConfig(adapterState.agentConfig, first.builderAgentId, first.workspacePath);
  assert.equal(adapterState.identityInputs.length, 0);
  const agentsMarkdown = await readFile(path.join(first.workspacePath, "AGENTS.md"), "utf8");
  assert.match(agentsMarkdown, /## Team/);
  assert.match(agentsMarkdown, new RegExp(first.builderAgentId));
  assert.match(agentsMarkdown, /## Tools/);
  assert.doesNotMatch(agentsMarkdown, /## Agent Roles/);
  await assert.rejects(
    () => readFile(path.join(buildWorkspaceAgentStatePath(first.workspacePath, first.builderAgentId), "SOUL.md"), "utf8"),
    /ENOENT/
  );

  const dispatched = await submitMissionDispatch(
    {
      mission: "What project/workspace are you assigned to?",
      workspaceId: first.workspaceId,
      agentId: first.builderAgentId
    },
    {
      getMissionControlSnapshot: async () => first.snapshot,
      resolveAgentForMission: () => first.builderAgentId,
      invalidateMissionControlCaches: () => undefined
    }
  );
  if (dispatched.dispatchId) {
    dispatchIds.push(dispatched.dispatchId);
  }

  assert.equal(adapterState.turnInputs.length, 1);
  assert.equal(adapterState.turnInputs[0]?.agentId, first.builderAgentId);
  assert.equal(adapterState.turnInputs[0]?.workspace, first.workspacePath);

  const runtime = new FakeOpenClawRuntime(adapterState.agentConfig);
  const firstTranscript = await runtime.askContextProbe(first.builderAgentId);

  assert.equal(firstTranscript.sessionCwd, first.workspacePath);
  assert.match(firstTranscript.answer, /Workspace: Orion Ops Lab/);
  assert.match(firstTranscript.answer, /telemetry reviews/i);
  assert.match(firstTranscript.answer, /Role: Implementation lead/);
  assert.match(firstTranscript.answer, /Orion Ops Lab Reviewer/);
  assert.match(firstTranscript.answer, /workspace-only/);
  assert.deepEqual(firstTranscript.presentBootstrapFiles.sort(), [
    "AGENTS.md",
    "IDENTITY.md",
    "MEMORY.md",
    "SOUL.md",
    "USER.md"
  ]);
  assert.ok(firstTranscript.toolReads.includes("docs/brief.md"));
  assert.ok(firstTranscript.toolReads.includes("docs/architecture.md"));
  assert.ok(firstTranscript.toolReads.includes("skills/project-builder/SKILL.md"));
  assert.ok(firstTranscript.toolReads.includes(`skills/${buildAgentPolicySkillId(first.builderAgentId)}/SKILL.md`));

  const restartedRuntime = new FakeOpenClawRuntime(adapterState.agentConfig);
  const restartedTranscript = await restartedRuntime.askContextProbe(first.builderAgentId);

  assert.equal(restartedTranscript.answer, firstTranscript.answer);
  assert.equal(restartedTranscript.sessionCwd, first.workspacePath);

  const isolatedTranscript = await restartedRuntime.askContextProbe(second.builderAgentId);

  assert.match(isolatedTranscript.answer, /Workspace: Nimbus Billing Lab/);
  assert.match(isolatedTranscript.answer, /subscription margin/i);
  assert.doesNotMatch(isolatedTranscript.answer, /Orion Ops Lab/);
  assert.doesNotMatch(isolatedTranscript.answer, /launch operations/);
});

function createAdapterState() {
  return {
    agentConfig: [] as Array<Record<string, unknown>>,
    addAgentInputs: [] as Array<Parameters<OpenClawAdapter["addAgent"]>[0]>,
    identityInputs: [] as Array<Parameters<OpenClawAdapter["setAgentIdentity"]>[0]>,
    turnInputs: [] as Array<Parameters<OpenClawAdapter["runAgentTurn"]>[0]>
  };
}

function createContextAdapter(state: ReturnType<typeof createAdapterState>): OpenClawAdapter {
  return {
    async getStatus() {
      return { version: "9.9.9" };
    },
    async addAgent(input) {
      state.addAgentInputs.push(input);
      state.agentConfig.push({
        id: input.id,
        workspace: input.workspace,
        agentDir: input.agentDir,
        model: input.model,
        name: input.name
      });
      return { stdout: "", stderr: "" };
    },
    async setAgentIdentity(input) {
      state.identityInputs.push(input);
      return { stdout: "", stderr: "" };
    },
    async getConfig(pathName) {
      if (pathName === "agents.entries") {
        return Object.fromEntries(
          state.agentConfig.map((entry) => {
            const { id, ...config } = entry;
            return [id, config];
          })
        );
      }
      return null;
    },
    async setConfig(pathName, value) {
      if (pathName === "agents.entries" && value && typeof value === "object" && !Array.isArray(value)) {
        state.agentConfig = Object.entries(value as Record<string, Record<string, unknown>>).map(([id, config]) => ({
          ...config,
          id
        }));
      }
      return { stdout: "", stderr: "" };
    },
    async runAgentTurn(input) {
      state.turnInputs.push(input);
      return {
        runId: "run-context-acceptance",
        status: "completed",
        summary: "Context probe accepted"
      };
    }
  } as OpenClawAdapter;
}

async function createWorkspaceFixture(input: {
  name: string;
  brief: string;
  docsBrief: string;
  architecture: string;
}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-context-"));
  tempRoots.push(tempRoot);

  const workspacePath = path.join(tempRoot, slugify(input.name));
  await mkdir(workspacePath, { recursive: true });

  const normalized = resolveWorkspaceBootstrapInput({
    name: input.name,
    directory: workspacePath,
    template: "software",
    sourceMode: "empty",
    teamPreset: "core",
    modelProfile: "balanced",
    brief: input.brief,
    modelId: "openai/test",
    rules: {
      workspaceOnly: true,
      generateStarterDocs: true,
      generateMemory: true,
      kickoffMission: false
    },
    docOverrides: [
      {
        path: "docs/brief.md",
        content: `# Objective\n${input.docsBrief}\n\n## Goals\n- Keep agent context workspace-scoped.\n- Verify policy and team answers from runtime context.\n`
      },
      {
        path: "docs/architecture.md",
        content: `# Current shape\n${input.architecture}\n\n## Risks\n- Context from another workspace must never appear in answers.\n`
      }
    ],
    agents: [
      {
        id: "builder",
        name: `${input.name} Builder`,
        role: "Implementation lead",
        enabled: true,
        isPrimary: true,
        skillId: "project-builder",
        policy: workspaceOnlyPolicy
      },
      {
        id: "reviewer",
        name: `${input.name} Reviewer`,
        role: "Quality reviewer",
        enabled: true,
        isPrimary: false,
        skillId: "project-reviewer",
        policy: workspaceOnlyPolicy
      },
      {
        id: "setup",
        name: `${input.name} Setup`,
        role: "Setup operator",
        enabled: true,
        isPrimary: false,
        skillId: "project-builder",
        policy: setupPolicy
      }
    ]
  });

  await scaffoldWorkspaceContents(workspacePath, {
    name: normalized.name,
    brief: normalized.brief,
    template: normalized.template,
    teamPreset: normalized.teamPreset,
    modelProfile: normalized.modelProfile,
    rules: normalized.rules,
    sourceMode: normalized.sourceMode,
    docOverrides: normalized.docOverrides,
    agents: normalized.agents,
    contextSources: normalized.contextSources
  });

  const createdAgentIds: string[] = [];
  for (const agent of normalized.agents.filter((entry) => entry.enabled)) {
    createdAgentIds.push(
      await createBootstrappedWorkspaceAgent({
        workspacePath,
        workspaceSlug: normalized.slug,
        workspaceModelId: "openai/test",
        agent
      })
    );
  }

  const snapshot = createSnapshot({
    workspaceId: normalized.slug,
    workspaceName: input.name,
    workspacePath,
    agents: normalized.agents.filter((entry) => entry.enabled)
  });

  for (const agent of snapshot.agents) {
    await ensureAgentPolicySkill({
      workspacePath,
      agentId: agent.id,
      agentName: agent.name,
      policy: agent.policy,
      snapshot
    });
  }

  const builderAgentId = createWorkspaceAgentId(normalized.slug, "builder");

  assert.ok(createdAgentIds.includes(builderAgentId));

  return {
    workspaceId: normalized.slug,
    workspacePath,
    builderAgentId,
    snapshot
  };
}

function createSnapshot(input: {
  workspaceId: string;
  workspaceName: string;
  workspacePath: string;
  agents: WorkspaceAgentBlueprintInput[];
}): MissionControlSnapshot {
  const now = new Date().toISOString();
  const agents = input.agents.map((agent) => {
    const agentId = createWorkspaceAgentId(input.workspaceId, agent.id);
    const policy = agent.policy ?? workspaceOnlyPolicy;
    const skillId = agent.skillId ?? "project-builder";
    return {
      id: agentId,
      name: agent.name,
      workspaceId: input.workspaceId,
      workspacePath: input.workspacePath,
      modelId: agent.modelId ?? "openai/test",
      isDefault: Boolean(agent.isPrimary),
      status: "ready",
      sessionCount: 0,
      lastActiveAt: null,
      currentAction: "Idle",
      activeRuntimeIds: [],
      heartbeat: {
        enabled: false,
        every: null,
        everyMs: null
      },
      identity: {},
      profile: {
        purpose: null,
        operatingInstructions: [],
        responseStyle: [],
        outputPreference: null,
        sourceFiles: []
      },
      skills: [skillId, buildAgentPolicySkillId(agentId)],
      tools: policy.fileAccess === "workspace-only" ? ["fs.workspaceOnly"] : [],
      policy,
      agentDir: buildWorkspaceAgentStatePath(input.workspacePath, agentId)
    } satisfies OpenClawAgent;
  });

  return {
    generatedAt: now,
    mode: "live",
    diagnostics: {
      installed: true,
      loaded: true,
      rpcOk: true,
      health: "healthy",
      workspaceRoot: path.dirname(input.workspacePath),
      configuredWorkspaceRoot: null,
      dashboardUrl: "http://127.0.0.1:18789/",
      gatewayUrl: "ws://127.0.0.1:18789",
      configuredGatewayUrl: null,
      openClawBinarySelection: {
        mode: "auto",
        path: null,
        resolvedPath: null,
        label: "Auto",
        detail: "Auto"
      },
      modelReadiness: {
        ready: true,
        defaultModel: "openai/test",
        resolvedDefaultModel: "openai/test",
        defaultModelReady: true,
        recommendedModelId: null,
        preferredLoginProvider: null,
        totalModelCount: 1,
        availableModelCount: 1,
        localModelCount: 0,
        remoteModelCount: 1,
        missingModelCount: 0,
        authProviders: [],
        issues: []
      },
      configUpdatePacing: {
        settings: { mode: "respect-gateway", minimumIntervalMs: null },
        queueDurability: "persistent",
        pending: false,
        pendingCount: 0,
        pendingPaths: [],
        pendingSince: null,
        cooldownUntil: null,
        retryAfterMs: null,
        lastIssue: null,
        lastUpdatedAt: null
      },
      runtime: {
        stateRoot: path.join(input.workspacePath, ".openclaw"),
        stateWritable: true,
        sessionStoreWritable: true,
        sessionStores: [],
        smokeTest: {
          status: "passed",
          checkedAt: now,
          agentId: agents[0]?.id ?? "agent",
          runId: "run-smoke",
          summary: "ok",
          error: null
        },
        issues: []
      },
      runtimeIssues: [],
      securityWarnings: [],
      issues: []
    },
    presence: [],
    channelAccounts: [],
    workspaces: [
      {
        id: input.workspaceId,
        name: input.workspaceName,
        slug: input.workspaceId,
        path: input.workspacePath,
        kind: "workspace",
        agentIds: agents.map((agent) => agent.id),
        modelIds: ["openai/test"],
        activeRuntimeIds: [],
        totalSessions: 0,
        health: "ready",
        bootstrap: {
          template: "software",
          sourceMode: "empty",
          agentTemplate: "core-team",
          coreFiles: resourceStates([...OPENCLAW_NATIVE_WORKSPACE_CONTEXT_PATHS]),
          optionalFiles: resourceStates([...OPENCLAW_NATIVE_WORKSPACE_MEMORY_PATHS]),
          folders: resourceStates(["memory", "docs", "skills"]),
          projectShell: [],
          localSkillIds: ["project-builder", "project-reviewer"]
        },
        capabilities: {
          skills: ["project-builder", "project-reviewer"],
          tools: ["fs.workspaceOnly"],
          workspaceOnlyAgentCount: agents.filter((agent) => agent.tools.includes("fs.workspaceOnly")).length
        },
        channels: []
      }
    ],
    agents,
    models: [],
    runtimes: [],
    tasks: [],
    agentInbox: [],
    relationships: [],
    missionPresets: [],
    channelRegistry: {
      version: 1,
      channels: []
    },
    surfaceRuntime: {
      source: "unavailable",
      checkedAt: null,
      gatewayAccess: {
        ok: true,
        blocked: false,
        role: null,
        scopes: [],
        missingScopes: [],
        requestId: null,
        issue: null,
        repairAvailable: false,
        repairAction: null
      },
      providerOrder: [],
      providerLabels: {},
      accountsByProvider: {},
      accountsByKey: {},
      issue: null
    },
    surfaceDrift: {
      checked: false,
      source: "unavailable",
      checkedAt: null,
      expectedBindingCount: 0,
      currentBindingCount: 0,
      summary: {
        ok: 0,
        missingBindings: 0,
        extraBindings: 0,
        agentMismatch: 0,
        accountMissing: 0,
        providerDisabled: 0
      },
      issues: []
    }
  };
}

class FakeOpenClawRuntime {
  constructor(private readonly agentConfig: Array<Record<string, unknown>>) {}

  async askContextProbe(agentId: string) {
    const agentConfig = this.agentConfig.find((entry) => entry.id === agentId);
    assert.ok(agentConfig, `Missing agent config for ${agentId}`);
    assert.equal(typeof agentConfig.workspace, "string");

    const workspacePath = agentConfig.workspace as string;
    const project = JSON.parse(await readFile(path.join(workspacePath, ".openclaw", "project.json"), "utf8")) as {
      name: string;
      agents: Array<{
        id: string;
        name: string;
        role: string;
        isPrimary: boolean;
        policy: AgentPolicy;
      }>;
    };
    const bootstrapFiles = await readBootstrapFiles(workspacePath);
    const currentAgent = project.agents.find((agent) => agent.id === agentId);
    assert.ok(currentAgent, `Project manifest did not include runtime agent id ${agentId}`);

    const policySkillId = buildAgentPolicySkillId(agentId);
    const toolReads = await readToolContextFiles(workspacePath, [
      "docs/brief.md",
      "docs/architecture.md",
      "memory/blueprint.md",
      "memory/decisions.md",
      "skills/project-builder/SKILL.md",
      `skills/${policySkillId}/SKILL.md`
    ]);
    const docsBrief = toolReads.find((entry) => entry.relativePath === "docs/brief.md")?.content ?? "";
    const teammates = project.agents
      .filter((agent) => agent.id !== agentId)
      .map((agent) => `${agent.name} (${agent.id})`)
      .join(", ");
    const presentBootstrapFiles = bootstrapFiles.filter((entry) => !entry.missing).map((entry) => entry.relativePath);
    const accessedFiles = [
      ...presentBootstrapFiles,
      ...toolReads.map((entry) => entry.relativePath)
    ];

    return {
      agentId,
      question: "What project/workspace are you assigned to?",
      sessionCwd: workspacePath,
      presentBootstrapFiles,
      missingBootstrapFiles: bootstrapFiles.filter((entry) => entry.missing).map((entry) => entry.relativePath),
      toolReads: toolReads.map((entry) => entry.relativePath),
      answer: [
        `Workspace: ${project.name}`,
        `Purpose: ${extractFirstBodyLine(docsBrief)}`,
        `Role: ${currentAgent.role}`,
        `Team: ${teammates}`,
        `Policies: ${currentAgent.policy.fileAccess}; network ${currentAgent.policy.networkAccess}`,
        `Context files: ${accessedFiles.join(", ")}`
      ].join("\n")
    };
  }
}

async function readBootstrapFiles(workspacePath: string) {
  const bootstrapFiles = OPENCLAW_NATIVE_WORKSPACE_BOOTSTRAP_FILES
    .filter((file) => file.kind !== "hook")
    .map((file) => file.path);

  const results = [];
  for (const relativePath of bootstrapFiles) {
    try {
      results.push({
        relativePath,
        content: await readFile(path.join(workspacePath, relativePath), "utf8"),
        missing: false
      });
    } catch {
      if (!OPENCLAW_NATIVE_WORKSPACE_MEMORY_PATHS.includes(relativePath as (typeof OPENCLAW_NATIVE_WORKSPACE_MEMORY_PATHS)[number])) {
        results.push({ relativePath, content: "", missing: true });
      }
    }
  }
  return results;
}

async function readToolContextFiles(workspacePath: string, relativePaths: string[]) {
  const results = [];
  for (const relativePath of relativePaths) {
    results.push({
      relativePath,
      content: await readFile(path.join(workspacePath, relativePath), "utf8")
    });
  }
  return results;
}

function assertAddAgentPayload(
  inputs: Array<Parameters<OpenClawAdapter["addAgent"]>[0]>,
  agentId: string,
  workspacePath: string,
  modelId: string
) {
  const payload = inputs.find((entry) => entry.id === agentId);
  assert.ok(payload);
  assert.equal(payload.workspace, workspacePath);
  assert.equal(payload.agentDir, buildWorkspaceAgentStatePath(workspacePath, agentId));
  assert.equal(payload.model, modelId);
  assert.match(payload.name ?? "", /Builder$/);
}

function assertAgentConfig(config: Array<Record<string, unknown>>, agentId: string, workspacePath: string) {
  const entry = config.find((candidate) => candidate.id === agentId);
  assert.ok(entry);
  assert.equal(entry.workspace, workspacePath);
  assert.equal(entry.agentDir, buildWorkspaceAgentStatePath(workspacePath, agentId));
  assert.match(String((entry.identity as { name?: string } | undefined)?.name ?? ""), /Builder$/);
  assert.deepEqual(entry.tools, {
    fs: {
      workspaceOnly: true
    }
  });
  assert.ok(Array.isArray(entry.skills));
  assert.ok(entry.skills.includes("project-builder"));
  assert.ok(entry.skills.includes(buildAgentPolicySkillId(agentId)));
}

function resourceStates(labels: string[]) {
  return labels.map((label) => ({
    id: label,
    label,
    present: true
  }));
}

function extractFirstBodyLine(markdown: string) {
  return (
    markdown
      .split(/\r?\n/)
      .map((line) => line.trim())
      .find((line) => line && !line.startsWith("#") && !line.startsWith("-")) ?? ""
  );
}

function slugify(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}
