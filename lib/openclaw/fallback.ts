import os from "node:os";
import path from "node:path";

import { resolveAgentPolicy } from "@/lib/openclaw/agent-presets";
import {
  buildWorkspaceContextManifest,
  WORKSPACE_CONTEXT_CORE_PATHS,
  WORKSPACE_CONTEXT_OPTIONAL_PATHS
} from "@/lib/openclaw/workspace-docs";
import type { MissionControlSnapshot } from "@/lib/openclaw/types";

export function createLoadingSnapshot(reason: string): MissionControlSnapshot {
  const now = Date.now();
  const workspaceRoot = path.join(os.homedir(), "Documents", "Shared", "projects");
  const stateRoot = path.join(os.homedir(), ".openclaw");

  return {
    generatedAt: new Date(now).toISOString(),
    mode: "fallback",
    diagnostics: {
      installed: true,
      loaded: true,
      rpcOk: false,
      health: "degraded",
      workspaceRoot,
      configuredWorkspaceRoot: null,
      dashboardUrl: "http://127.0.0.1:18789/",
      gatewayUrl: "ws://127.0.0.1:18789",
      configuredGatewayUrl: null,
      modelReadiness: {
        ready: false,
        defaultModel: null,
        resolvedDefaultModel: null,
        defaultModelReady: false,
        recommendedModelId: null,
        preferredLoginProvider: null,
        totalModelCount: 0,
        availableModelCount: 0,
        localModelCount: 0,
        remoteModelCount: 0,
        missingModelCount: 0,
        authProviders: [],
        issues: [reason]
      },
      runtime: {
        stateRoot,
        stateWritable: false,
        sessionStoreWritable: false,
        sessionStores: [],
        smokeTest: {
          status: "not-run",
          checkedAt: null,
          agentId: null,
          runId: null,
          summary: null,
          error: null
        },
        issues: [reason]
      },
      securityWarnings: [],
      issues: [reason]
    },
    presence: [],
    channelAccounts: [],
    workspaces: [],
    agents: [],
    models: [],
    runtimes: [],
    tasks: [],
    relationships: [],
    missionPresets: [],
    channelRegistry: {
      version: 1,
      channels: []
    }
  };
}

export function createFallbackSnapshot(reason: string): MissionControlSnapshot {
  const now = Date.now();
  const workspaceRoot = path.join(os.homedir(), "Documents", "Shared", "projects");
  const excludedContextPaths = new Set<string>([
    ...WORKSPACE_CONTEXT_CORE_PATHS,
    ...WORKSPACE_CONTEXT_OPTIONAL_PATHS
  ]);

  return {
    generatedAt: new Date(now).toISOString(),
    mode: "fallback",
    diagnostics: {
      installed: false,
      loaded: false,
      rpcOk: false,
      health: "offline",
      workspaceRoot,
      configuredWorkspaceRoot: null,
      dashboardUrl: "http://127.0.0.1:18789/",
      gatewayUrl: "ws://127.0.0.1:18789",
      configuredGatewayUrl: null,
      modelReadiness: {
        ready: true,
        defaultModel: "openai-codex/gpt-5.1-codex-mini",
        resolvedDefaultModel: "openai-codex/gpt-5.1-codex-mini",
        defaultModelReady: true,
        recommendedModelId: "openai-codex/gpt-5.1-codex-mini",
        preferredLoginProvider: "openai-codex",
        totalModelCount: 2,
        availableModelCount: 2,
        localModelCount: 1,
        remoteModelCount: 1,
        missingModelCount: 0,
        authProviders: [
          {
            provider: "openai-codex",
            connected: true,
            canLogin: true,
            detail: "Fallback demo profile"
          },
          {
            provider: "ollama",
            connected: true,
            canLogin: false,
            detail: "Fallback demo profile"
          }
        ],
        issues: []
      },
      runtime: {
        stateRoot: path.join(os.homedir(), ".openclaw"),
        stateWritable: false,
        sessionStoreWritable: false,
        sessionStores: [],
        smokeTest: {
          status: "not-run",
          checkedAt: null,
          agentId: null,
          runId: null,
          summary: null,
          error: null
        },
        issues: [reason]
      },
      securityWarnings: [],
      issues: [reason]
    },
    presence: [],
    channelAccounts: [],
    workspaces: [
      {
        id: "workspace-demo",
        name: "Demo Workspace",
        slug: "demo-workspace",
        path: "~/openclaw/demo",
        kind: "workspace",
        agentIds: ["agent-demo-planner", "agent-demo-executor"],
        modelIds: ["openai-codex/gpt-5.1-codex-mini", "ollama/qwen3.5:9b"],
        activeRuntimeIds: ["runtime-demo-plan"],
        totalSessions: 2,
        health: "engaged",
        bootstrap: {
          template: "software",
          sourceMode: "empty",
          agentTemplate: "core-team",
          coreFiles: [
            { id: "agents", label: "AGENTS.md", present: true },
            { id: "soul", label: "SOUL.md", present: true },
            { id: "identity", label: "IDENTITY.md", present: true },
            { id: "tools", label: "TOOLS.md", present: true },
            { id: "heartbeat", label: "HEARTBEAT.md", present: true }
          ],
          optionalFiles: [{ id: "memory-md", label: "MEMORY.md", present: true }],
          contextFiles: buildWorkspaceContextManifest("software", {
            workspaceOnly: true,
            generateStarterDocs: true,
            generateMemory: true,
            kickoffMission: true
          })
            .resources.filter((entry) => !excludedContextPaths.has(entry.relativePath))
            .map((entry) => ({
              id: entry.id,
              label: entry.label,
              present: true
            })),
          folders: [
            { id: "docs", label: "docs/", present: true },
            { id: "memory", label: "memory/", present: true },
            { id: "deliverables", label: "deliverables/", present: true },
            { id: "skills", label: "skills/", present: true },
            { id: "openclaw", label: ".openclaw/", present: true }
          ],
          projectShell: [
            { id: "project-json", label: ".openclaw/project.json", present: true },
            { id: "events", label: ".openclaw/project-shell/events.jsonl", present: true },
            { id: "runs", label: ".openclaw/project-shell/runs", present: true },
            { id: "tasks", label: ".openclaw/project-shell/tasks", present: true }
          ],
          localSkillIds: ["planning", "execution"]
        },
        capabilities: {
          skills: ["planning", "execution"],
          tools: ["fs.workspaceOnly"],
          workspaceOnlyAgentCount: 2
        },
        channels: []
      }
    ],
    agents: [
      {
        id: "agent-demo-planner",
        name: "Planner",
        workspaceId: "workspace-demo",
        workspacePath: "~/openclaw/demo",
        modelId: "openai-codex/gpt-5.1-codex-mini",
        isDefault: true,
        status: "engaged",
        sessionCount: 1,
        lastActiveAt: now - 120000,
        currentAction: "Awaiting a real OpenClaw connection",
        activeRuntimeIds: ["runtime-demo-plan"],
        heartbeat: {
          enabled: true,
          every: "30m",
          everyMs: 1800000
        },
        identity: {
          emoji: "🦞",
          theme: "slate",
          source: "fallback"
        },
        profile: {
          purpose: "Plan the first mission structure while the real OpenClaw backend is unavailable.",
          operatingInstructions: [
            "Stay tied to the demo workspace context until a live gateway is available."
          ],
          responseStyle: ["calm", "operational", "mission-first"],
          outputPreference: "Prefer concise command feedback and workspace-grounded artifacts.",
          sourceFiles: []
        },
        skills: ["planning"],
        tools: ["fs.workspaceOnly"],
        policy: resolveAgentPolicy("worker")
      },
      {
        id: "agent-demo-executor",
        name: "Executor",
        workspaceId: "workspace-demo",
        workspacePath: "~/openclaw/demo",
        modelId: "ollama/qwen3.5:9b",
        isDefault: false,
        status: "ready",
        sessionCount: 1,
        lastActiveAt: now - 1800000,
        currentAction: "Standing by for a live runtime",
        activeRuntimeIds: [],
        heartbeat: {
          enabled: false,
          every: null,
          everyMs: null
        },
        identity: {
          emoji: "🛠️",
          theme: "amber",
          source: "fallback"
        },
        profile: {
          purpose: "Execute concrete workspace actions once the mission has been planned.",
          operatingInstructions: [
            "Operate inside the attached workspace and wait for a live runtime assignment."
          ],
          responseStyle: ["pragmatic", "focused", "execution-ready"],
          outputPreference: "Prefer direct task updates linked to real workspace files.",
          sourceFiles: []
        },
        skills: ["execution"],
        tools: ["fs.workspaceOnly"],
        policy: resolveAgentPolicy("worker")
      }
    ],
    models: [
      {
        id: "openai-codex/gpt-5.1-codex-mini",
        name: "GPT-5.1 Codex Mini",
        provider: "openai-codex",
        input: "text+image",
        contextWindow: 272000,
        local: false,
        available: true,
        missing: false,
        tags: ["default"],
        usageCount: 1
      },
      {
        id: "ollama/qwen3.5:9b",
        name: "qwen3.5:9b",
        provider: "ollama",
        input: "text",
        contextWindow: 262144,
        local: true,
        available: true,
        missing: false,
        tags: ["configured"],
        usageCount: 1
      }
    ],
    runtimes: [
      {
        id: "runtime-demo-plan",
        source: "session",
        key: "agent:agent-demo-planner:task:demo-plan:stage:in_progress",
        title: "Mission planning task",
        subtitle: "Fallback surface while OpenClaw is unavailable",
        status: "running",
        updatedAt: now - 120000,
        ageMs: 120000,
        agentId: "agent-demo-planner",
        workspaceId: "workspace-demo",
        modelId: "openai-codex/gpt-5.1-codex-mini",
        sessionId: "session-demo-plan",
        taskId: "demo-plan",
        tokenUsage: {
          input: 1800,
          output: 220,
          total: 2020,
          cacheRead: 0
        },
        metadata: {
          reason
        }
      }
    ],
    tasks: [
      {
        id: "task:demo-plan",
        key: "task:demo-plan",
        title: "Mission planning task",
        mission: "Plan the first mission structure while OpenClaw is unavailable.",
        subtitle: "Fallback surface while OpenClaw is unavailable",
        status: "running",
        updatedAt: now - 120000,
        ageMs: 120000,
        workspaceId: "workspace-demo",
        primaryAgentId: "agent-demo-planner",
        primaryAgentName: "Planner",
        primaryRuntimeId: "runtime-demo-plan",
        runtimeIds: ["runtime-demo-plan"],
        agentIds: ["agent-demo-planner"],
        sessionIds: ["session-demo-plan"],
        runIds: [],
        runtimeCount: 1,
        updateCount: 1,
        liveRunCount: 1,
        artifactCount: 0,
        warningCount: 0,
        tokenUsage: {
          input: 1800,
          output: 220,
          total: 2020,
          cacheRead: 0
        },
        metadata: {
          reason
        }
      }
    ],
    relationships: [
      {
        id: "edge-demo-planner-model",
        sourceId: "agent-demo-planner",
        targetId: "openai-codex/gpt-5.1-codex-mini",
        kind: "uses-model",
        label: "primary model"
      },
      {
        id: "edge-demo-executor-model",
        sourceId: "agent-demo-executor",
        targetId: "ollama/qwen3.5:9b",
        kind: "uses-model",
        label: "local fallback"
      },
      {
        id: "edge-demo-planner-runtime",
        sourceId: "agent-demo-planner",
        targetId: "runtime-demo-plan",
        kind: "active-run",
        label: "current run"
      }
    ],
    channelRegistry: {
      version: 1,
      channels: []
    },
    missionPresets: [
      "Plan a multi-agent release mission for the selected workspace.",
      "Stand up a builder, tester, and reviewer loop for the next milestone.",
      "Audit the current workspace, identify blockers, and propose the first task batch."
    ]
  };
}
