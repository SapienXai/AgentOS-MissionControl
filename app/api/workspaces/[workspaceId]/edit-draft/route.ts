import { NextResponse } from "next/server";

import { createWorkspacePlan, updateWorkspacePlan } from "@/lib/openclaw/planner";
import {
  createPlannerAgentSpec,
  createPlannerContextSource,
  createPlannerMessage,
  enrichWorkspacePlan,
  buildRecommendedPlannerAgents,
  buildRecommendedPlannerAutomations,
  buildRecommendedPlannerChannels,
  buildRecommendedPlannerHooks,
  buildRecommendedPlannerWorkflows
} from "@/lib/openclaw/planner-core";
import { readWorkspaceEditSeed } from "@/lib/openclaw/service";
import type { WorkspaceEditSeed } from "@/lib/openclaw/types";
import { buildWorkspaceEditableDocuments } from "@/lib/openclaw/workspace-docs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(
  _request: Request,
  context: {
    params: Promise<{
      workspaceId: string;
    }>;
  }
) {
  try {
    const { workspaceId } = await context.params;
    const seed = await readWorkspaceEditSeed(workspaceId);
    const { plan: basePlan } = await createWorkspacePlan();
    const enabledAgentCount = seed.agents.filter((agent) => agent.enabled).length;
    const editWorkspaceSize =
      enabledAgentCount <= 1 ? "small" : enabledAgentCount <= 3 ? "medium" : "large";
    const agents =
      seed.agents.length > 0
        ? seed.agents.map((agent) =>
            createPlannerAgentSpec({
              id: agent.id,
              role: agent.role,
              name: agent.name,
              purpose: `${agent.name} owns ${agent.role.toLowerCase()} execution and handoffs.`,
              enabled: agent.enabled,
              isPrimary: agent.isPrimary,
              emoji: agent.emoji,
              theme: agent.theme,
              skillId: agent.skillId,
              modelId: agent.modelId,
              policy: agent.policy,
              heartbeat: agent.heartbeat,
              responsibilities: [],
              outputs: []
            })
          )
        : buildRecommendedPlannerAgents(seed.template, seed.name);
    const editableDocuments = buildWorkspaceEditableDocuments({
      name: seed.name,
      brief: seed.brief,
      template: seed.template,
      sourceMode: seed.sourceMode,
      rules: seed.rules,
      agents: seed.agents,
      docOverrides: seed.docOverrides,
      toolExamples: []
    });
    const channels = buildRecommendedPlannerChannels();
    const plan = enrichWorkspacePlan({
      ...basePlan,
      status: "draft",
      stage: "intake",
      company: {
        ...basePlan.company,
        name: seed.name,
        mission: seed.brief,
        targetCustomer: seed.brief || seed.name
      },
      product: {
        ...basePlan.product,
        offer: seed.brief || seed.name
      },
      workspace: {
        ...basePlan.workspace,
        name: seed.name,
        directory: seed.directory,
        sourceMode: seed.sourceMode,
        template: seed.template,
        modelProfile: seed.modelProfile,
        modelId: seed.modelId,
        repoUrl: seed.repoUrl,
        existingPath: seed.existingPath,
        docs: editableDocuments.map((document) => document.path),
        docOverrides: seed.docOverrides,
        rules: seed.rules
      },
      team: {
        ...basePlan.team,
        persistentAgents: agents,
        allowEphemeralSubagents: basePlan.team.allowEphemeralSubagents,
        maxParallelRuns: basePlan.team.maxParallelRuns,
        escalationRules: basePlan.team.escalationRules
      },
      operations: {
        workflows: buildRecommendedPlannerWorkflows(seed.template, agents),
        channels,
        automations: buildRecommendedPlannerAutomations(seed.template, agents, channels),
        hooks: buildRecommendedPlannerHooks(),
        sandbox: basePlan.operations.sandbox
      },
      deploy: {
        ...basePlan.deploy,
        firstMissions: []
      },
      intake: {
        ...basePlan.intake,
        size: editWorkspaceSize,
        started: true,
        initialPrompt: seed.brief,
        latestPrompt: seed.brief,
        sources: [
          createPlannerContextSource({
            id: "workspace-edit-source",
            kind: "folder",
            label: "Existing workspace",
            summary: seed.directory,
            details: [seed.directory],
            url: seed.directory
          })
        ]
      },
      conversation: [
        createPlannerMessage(
          "assistant",
          "Workspace Architect",
          "Edit the existing workspace blueprint, scaffold files, and agents. Apply changes when you are ready."
        )
      ]
    });

    const result = await updateWorkspacePlan(basePlan.id, plan);
    return NextResponse.json({
      ...result,
      seed
    } satisfies { plan: typeof result.plan; seed: WorkspaceEditSeed });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to create workspace edit draft."
      },
      { status: 400 }
    );
  }
}
