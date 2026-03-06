import type { MissionControlSnapshot } from "@/lib/openclaw/types";

export function createFallbackSnapshot(reason: string): MissionControlSnapshot {
  const now = Date.now();

  return {
    generatedAt: new Date(now).toISOString(),
    mode: "fallback",
    diagnostics: {
      installed: false,
      loaded: false,
      rpcOk: false,
      health: "offline",
      dashboardUrl: "http://127.0.0.1:18789/",
      gatewayUrl: "ws://127.0.0.1:18789",
      securityWarnings: [],
      issues: [reason]
    },
    presence: [],
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
        health: "engaged"
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
        tools: ["fs.workspaceOnly"]
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
        tools: ["fs.workspaceOnly"]
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
        status: "active",
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
    missionPresets: [
      "Plan a multi-agent release mission for the selected workspace.",
      "Stand up a builder, tester, and reviewer loop for the next milestone.",
      "Audit the current workspace, identify blockers, and propose the first task batch."
    ]
  };
}
