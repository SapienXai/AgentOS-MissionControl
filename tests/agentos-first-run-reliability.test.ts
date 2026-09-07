import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

import { createErrorSnapshot, createFallbackSnapshot } from "@/lib/openclaw/fallback";
import { getRuntimeOutputForResolvedRuntime } from "@/lib/openclaw/domains/runtime-transcript";
import { sanitizeGatewayDiagnosticText } from "@/lib/openclaw/client/native-ws-gateway-errors";
import {
  isOpenClawOnboardingSystemReady,
  isOpenClawOnboardingModelReady,
  isOpenClawSystemReady,
  resolveAgentCreationReadinessError,
  resolveMissionDispatchReadinessError,
  resolveWorkspaceCreationReadinessError
} from "@/lib/openclaw/readiness";
import type { RuntimeRecord } from "@/lib/openclaw/types";

test("OpenClaw missing snapshot does not present fake live workspaces, models, agents, or runtimes", () => {
  const snapshot = createErrorSnapshot("OpenClaw CLI is not installed on this machine.", {
    installed: false,
    loaded: false,
    rpcOk: false
  });

  assert.equal(snapshot.mode, "fallback");
  assert.equal(snapshot.diagnostics.installed, false);
  assert.equal(snapshot.diagnostics.rpcOk, false);
  assert.equal(snapshot.diagnostics.modelReadiness.ready, false);
  assert.deepEqual(snapshot.workspaces, []);
  assert.deepEqual(snapshot.agents, []);
  assert.deepEqual(snapshot.models, []);
  assert.deepEqual(snapshot.runtimes, []);
  assert.deepEqual(snapshot.tasks, []);
});

test("fallback snapshot never advertises demo agents, models, or runnable work", () => {
  const snapshot = createFallbackSnapshot("OpenClaw snapshot unavailable.");

  assert.equal(snapshot.mode, "fallback");
  assert.equal(snapshot.diagnostics.installed, false);
  assert.equal(snapshot.diagnostics.loaded, false);
  assert.equal(snapshot.diagnostics.rpcOk, false);
  assert.equal(snapshot.diagnostics.health, "offline");
  assert.equal(snapshot.diagnostics.modelReadiness.ready, false);
  assert.deepEqual(snapshot.workspaces, []);
  assert.deepEqual(snapshot.agents, []);
  assert.deepEqual(snapshot.models, []);
  assert.deepEqual(snapshot.runtimes, []);
  assert.deepEqual(snapshot.tasks, []);
});

test("onboarding overlay is portaled and does not create outer page scroll", () => {
  const source = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding.tsx"), "utf8");

  assert.match(source, /createPortal\(/);
  assert.match(source, /document\.body/);
  assert.match(source, /openclaw-onboarding-backdrop fixed inset-0 z-\[1000\]/);
  assert.match(source, /overflow-hidden/);
  assert.doesNotMatch(source, /openclaw-onboarding-backdrop[^\n]+overflow-y-auto/);
  assert.match(source, /max-h-\[calc\(100dvh-32px\)\]/);
});

test("system onboarding keeps setup rows compact and the log collapsed", () => {
  const source = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding.tsx"), "utf8");

  assert.match(source, /role="switch"/);
  assert.match(source, /aria-label=\{surfaceTheme === "light" \? "Switch to dark theme" : "Switch to light theme"\}/);
  assert.match(source, /max-sm:invisible sm:mt-2 sm:min-h-5/);
  assert.match(source, /h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-\[9px\]/);
  assert.match(source, /mb-6 mt-6 grid max-w-\[640px\]/);
  assert.match(source, /h-7 w-7 shrink-0 items-center justify-center rounded-full border text-\[12px\]/);
  assert.match(source, /id: "system", label: "Setup"/);
  assert.match(source, /text-\[16px\] font-semibold leading-5 tracking-\[-0\.01em\]/);
  assert.match(source, /grid-cols-\[minmax\(0,1fr\)_48px_minmax\(0,1fr\)_48px_minmax\(0,1fr\)\]/);
  assert.match(source, /flex min-w-0 flex-col items-center gap-1 text-center/);
  assert.match(source, /relative mt-3\.5 h-0\.5 w-full self-start overflow-hidden rounded-full bg-border/);
  assert.match(source, /transition=\{\{ duration: 1\.2, ease: \[0\.22, 1, 0\.36, 1\] \}\}/);
  assert.doesNotMatch(source, /<p className="mt-0\.5 text-\[12px\] leading-4 text-muted-foreground">\{step\.description\}/);
  assert.match(source, /const \[detailsOpen, setDetailsOpen\] = useState\(false\)/);
  assert.match(source, /aria-controls="onboarding-setup-log-details"/);
  assert.match(source, /OpenClaw setup target:/);
  assert.doesNotMatch(source, /What happens next\?/);
});

test("default model switching uses a compact feedback state", () => {
  const stagesSource = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding.stages.tsx"), "utf8");
  const onboardingSource = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding.tsx"), "utf8");
  const switchStart = stagesSource.indexOf("function ModelSwitchScene");
  const switchEnd = stagesSource.indexOf("function resolveModelDisplayLabel", switchStart);
  const switchSource = stagesSource.slice(switchStart, switchEnd);

  assert.match(stagesSource, /open=\{run\.runState === "running" && modelSwitchFeedback\.phase === "idle" && \(!chatGptBrowserAuth \|\| isChatGptPreparation\)\}/);
  assert.match(switchSource, /max-w-\[560px\] rounded-\[14px\]/);
  assert.match(switchSource, /role="status"/);
  assert.doesNotMatch(switchSource, /min-h-\[300px\]|Saving model route|Previous|Model route/);
  assert.match(onboardingSource, /const isModelSwitchActive = visualStage === "models" && modelSwitchFeedback\.phase !== "idle";/);
  assert.match(onboardingSource, /isModelSwitchActive && "!overflow-y-hidden"/);
  assert.match(onboardingSource, /isModelSwitchActive && "!hidden"/);
});

test("ChatGPT return stays on model selection until the user confirms", () => {
  const onboardingSource = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding.tsx"), "utf8");
  const flowSource = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding-provider-flow.tsx"), "utf8");
  const shellSource = readFileSync(path.join(process.cwd(), "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(onboardingSource, /const modelSetupConfirmed = showReadyState \|\| modelSwitchFeedback\.phase === "success";/);
  assert.match(onboardingSource, /const showLaunchpad = modelSetupConfirmed &&/);
  assert.match(onboardingSource, /modelReady=\{modelSetupConfirmed\}/);
  assert.match(flowSource, /id="chatgpt-model-select"/);
  assert.match(flowSource, /id="chatgpt-reasoning-select"/);
  assert.match(flowSource, /\["xhigh", "Xhigh"\]/);
  assert.match(shellSource, /thinking: selectedOnboardingThinking/);
  const modelSetDefaultStart = shellSource.indexOf("const runModelSetDefault = async");
  const modelSetDefaultSource = shellSource.slice(modelSetDefaultStart, shellSource.indexOf("  const dismissOnboarding", modelSetDefaultStart));
  assert.match(
    modelSetDefaultSource,
    /targetModelId\.trim\(\) === currentDefaultModelId\.trim\(\) &&\s*resolveOpenClawModelReady\(snapshot\)/
  );
  assert.match(modelSetDefaultSource, /await continueFromAi\(thinking\);\s*return;/);
  assert.match(shellSource, /const enterAgentOS = useCallback\(async \(readySnapshot\?: MissionControlSnapshot\)/);
  assert.match(shellSource, /const refreshedSnapshot = await refreshSnapshot\(\{ force: true \}\)/);
  assert.match(shellSource, /void enterAgentOS\(readySnapshot\)/);
});

test("Continue to AgentOS advances the onboarding stage after model selection", () => {
  const source = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding.tsx"), "utf8");
  const continueHandlerStart = source.indexOf("onContinueFromAi={(thinking) => {");
  const continueHandlerEnd = source.indexOf("onRunModelSetDefault", continueHandlerStart);
  const continueHandler = source.slice(continueHandlerStart, continueHandlerEnd);

  assert.notEqual(continueHandlerStart, -1);
  assert.match(continueHandler, /setSelectedVisualStage\("finish"\)/);
  assert.match(continueHandler, /onContinueFromAi\(thinking\)/);
});

test("Model Library ChatGPT account switching returns to live model selection", () => {
  const addModelsSource = readFileSync(path.join(process.cwd(), "components/mission-control/add-models/add-models-dialog.tsx"), "utf8");
  const shellSource = readFileSync(path.join(process.cwd(), "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(addModelsSource, /showSwitchAccountAction && onSwitchChatGptAccount/);
  assert.match(addModelsSource, /onSwitchChatGptAccount\(\);/);
  assert.doesNotMatch(addModelsSource, /switchAccountProviderId/);
  assert.doesNotMatch(addModelsSource, /Preparing terminal command/);
  assert.match(shellSource, /const handleChatGptAccountSwitch = \(\) => \{/);
  assert.match(shellSource, /void runChatGptOnboarding\(true\);/);
  assert.match(shellSource, /onSwitchChatGptAccount=\{handleChatGptAccountSwitch\}/);
});

test("browser ChatGPT auth keeps onboarding focused and callback recovery compact", () => {
  const onboardingSource = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding.tsx"), "utf8");
  const stagesSource = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding.stages.tsx"), "utf8");
  const shellSource = readFileSync(path.join(process.cwd(), "components/mission-control/mission-control-shell.tsx"), "utf8");

  assert.match(onboardingSource, /const isChatGptAuthSurface = visualStage === "models" && Boolean\(chatGptBrowserAuth\);/);
  assert.match(onboardingSource, /isChatGptAuthSurface && !advancedProviderFlowOpen\s*\n\s*\? "sm:max-w-\[720px\]"/);
  assert.match(onboardingSource, /sm:w-\[min\(1240px,calc\(100vw-32px\)\)\] sm:max-w-\[1240px\]/);
  assert.match(onboardingSource, /!isModelSwitchActive && !isChatGptAuthSurface/);
  assert.match(onboardingSource, /isChatGptAuthSurface && "!hidden"/);
  assert.match(stagesSource, /open=\{run\.runState === "running" && modelSwitchFeedback\.phase === "idle" && \(!chatGptBrowserAuth \|\| isChatGptPreparation\)\}/);
  assert.match(stagesSource, /role=\{browserAuthError \? "alert" : "status"\}/);
  assert.match(stagesSource, /<details className="mt-2\.5 text-\[10px\]">/);
  assert.match(stagesSource, /Use callback URL manually/);
  assert.doesNotMatch(stagesSource, /Mobile callback fallback/);
  assert.match(shellSource, /await openExternalAuthUrl\(currentAuthFlow\.browserUrl\)/);
  assert.match(shellSource, /The ChatGPT sign-in page is ready\. Use Open sign-in to continue in your browser\./);
  assert.doesNotMatch(shellSource, /window\.open\(currentAuthFlow\.browserUrl/);
});

test("launchpad uses the same compact status-row language as setup", () => {
  const source = readFileSync(path.join(process.cwd(), "components/mission-control/openclaw-onboarding.stages.tsx"), "utf8");

  assert.match(source, /text-\[16px\] font-semibold leading-5 tracking-\[-0\.01em\]/);
  assert.match(source, /mt-3 grid grid-cols-2 gap-2/);
  assert.match(source, /flex min-h-\[58px\] min-w-0 items-center justify-between gap-3 rounded-\[12px\] border px-4 py-3/);
  assert.match(source, /<Info className=\{cn\("h-3\.5 w-3\.5 shrink-0"/);
  assert.match(source, /Next: \{nextStep\}/);
  assert.doesNotMatch(source, /const launchSummary =/);
  assert.doesNotMatch(source, /detail=\{modelMetricDetail\}/);
});

test("first-run write actions return actionable readiness failures before mutation", () => {
  const snapshot = createErrorSnapshot("OpenClaw CLI is not installed on this machine.", {
    installed: false,
    loaded: false,
    rpcOk: false
  });

  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /OpenClaw CLI is not installed/);
  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /blocked before any files are written/);
  assert.match(resolveAgentCreationReadinessError(snapshot) ?? "", /Agent creation is blocked/);
  assert.match(resolveMissionDispatchReadinessError(snapshot) ?? "", /Mission dispatch is blocked/);
});

test("onboarding system readiness waits for runtime write access after Gateway RPC", () => {
  const snapshot = createErrorSnapshot("Runtime state is not writable.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });

  assert.equal(isOpenClawSystemReady(snapshot), false);
  assert.equal(isOpenClawOnboardingSystemReady(snapshot), false);
  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /runtime state is not writable/i);

  snapshot.diagnostics.runtime.stateWritable = true;
  snapshot.diagnostics.runtime.sessionStoreWritable = true;

  assert.equal(isOpenClawSystemReady(snapshot), true);
  assert.equal(isOpenClawOnboardingSystemReady(snapshot), true);
});

test("model readiness failures explain the next action for first workspace and agent creation", () => {
  const snapshot = createErrorSnapshot("Model setup unavailable.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });
  snapshot.diagnostics.runtime.stateWritable = true;
  snapshot.diagnostics.runtime.sessionStoreWritable = true;
  snapshot.diagnostics.modelReadiness = {
    ...snapshot.diagnostics.modelReadiness,
    ready: false,
    totalModelCount: 0,
    availableModelCount: 0,
    issues: []
  };

  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /No models are configured yet/);
  assert.match(resolveWorkspaceCreationReadinessError(snapshot) ?? "", /Choose a model before creating the first workspace/);
  assert.match(resolveAgentCreationReadinessError(snapshot) ?? "", /Choose a ready model before creating the agent/);
});

test("a clean install blocks an implicit OpenAI default before any chat or smoke-test dispatch", () => {
  const snapshot = createErrorSnapshot("No provider is configured.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });
  snapshot.diagnostics.runtime.stateWritable = true;
  snapshot.diagnostics.runtime.sessionStoreWritable = true;
  snapshot.diagnostics.modelReadiness = {
    ...snapshot.diagnostics.modelReadiness,
    defaultModel: "openai/gpt-5.5",
    resolvedDefaultModel: "openai/gpt-5.5",
    defaultModelReady: false,
    ready: false,
    totalModelCount: 0,
    availableModelCount: 0,
    issues: ["Choose a default model to finish setup."]
  };

  assert.match(
    resolveMissionDispatchReadinessError(snapshot, "openai/gpt-5.5") ?? "",
    /Requested model openai\/gpt-5\.5 is not ready/
  );

  const chatRoute = readFileSync(path.join(process.cwd(), "app/api/agents/[agentId]/chat/route.ts"), "utf8");
  const readinessGuard = chatRoute.indexOf("const modelReadinessError = resolveOpenClawModelReadinessIssue(");
  const dispatch = chatRoute.indexOf("getOpenClawAdapter().streamAgentTurn(");

  assert.ok(readinessGuard >= 0);
  assert.ok(dispatch > readinessGuard);
});

test("workspace-backed agent models keep first-run actions usable when the global default is missing", () => {
  const snapshot = createErrorSnapshot("Model setup default is missing.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });
  snapshot.diagnostics.runtime.stateWritable = true;
  snapshot.diagnostics.runtime.sessionStoreWritable = true;
  snapshot.workspaces = [
    {
      id: "workspace",
      name: "Workspace",
      path: "/tmp/workspace",
      status: "ready",
      tags: []
    }
  ] as unknown as typeof snapshot.workspaces;
  snapshot.agents = [
    {
      id: "main",
      workspaceId: "workspace",
      workspacePath: "/tmp/workspace",
      modelId: "openai/gpt-5.4-mini",
      name: "Main",
      status: "ready",
      role: "Worker",
      emoji: "A",
      theme: "slate",
      avatar: null,
      heartbeat: null,
      skills: [],
      tools: [],
      policy: {
        preset: "worker",
        missingToolBehavior: "ask-setup",
        installScope: "none",
        fileAccess: "workspace-only",
        networkAccess: "restricted"
      }
    }
  ] as unknown as typeof snapshot.agents;
  snapshot.models = [
    {
      id: "openai/gpt-5.4-mini",
      name: "GPT 5.4 Mini",
      provider: "openai",
      input: "remote",
      contextWindow: null,
      local: false,
      available: true,
      missing: false,
      tags: [],
      usageCount: 1
    }
  ];
  snapshot.diagnostics.modelReadiness = {
    ...snapshot.diagnostics.modelReadiness,
    ready: false,
    defaultModel: null,
    resolvedDefaultModel: null,
    defaultModelReady: false,
    recommendedModelId: "openai/gpt-5.4-mini",
    totalModelCount: 1,
    availableModelCount: 1,
    issues: ["Choose a default model to finish setup."]
  };

  assert.equal(isOpenClawOnboardingModelReady(snapshot), true);
  assert.equal(resolveMissionDispatchReadinessError(snapshot, "openai/gpt-5.4-mini"), null);
  assert.equal(resolveWorkspaceCreationReadinessError(snapshot, "openai/gpt-5.4-mini"), null);
  assert.equal(resolveAgentCreationReadinessError(snapshot, "openai/gpt-5.4-mini"), null);
  assert.match(resolveAgentCreationReadinessError(snapshot, "openai/missing") ?? "", /not ready/);
});

test("runtime output surfaces an explicit diagnostic when dispatch output is empty", async () => {
  const snapshot = createErrorSnapshot("OpenClaw snapshot unavailable.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });
  snapshot.mode = "live";
  const runtime: RuntimeRecord = {
    id: "runtime:dispatch:dispatch-1",
    source: "turn",
    key: "dispatch:dispatch-1",
    title: "First mission",
    subtitle: "Mission accepted.",
    status: "running",
    updatedAt: Date.parse("2026-05-22T10:00:00.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    metadata: {
      dispatchId: "dispatch-1",
      dispatchStatus: "running",
      mission: "Say hello"
    }
  };

  const output = await getRuntimeOutputForResolvedRuntime(runtime, snapshot);

  assert.equal(output.status, "missing");
  assert.match(output.errorMessage ?? "", /no transcript output has been captured yet/i);
  assert.equal(output.finalText, null);
  assert.deepEqual(output.items, []);
});

test("runtime output redacts dispatch metadata errors before exposing diagnostics", async () => {
  const snapshot = createErrorSnapshot("OpenClaw snapshot unavailable.", {
    installed: true,
    loaded: true,
    rpcOk: true
  });
  snapshot.mode = "live";
  const runtime: RuntimeRecord = {
    id: "runtime:dispatch:dispatch-secret",
    source: "turn",
    key: "dispatch:dispatch-secret",
    title: "First mission",
    subtitle: "Mission failed.",
    status: "stalled",
    updatedAt: Date.parse("2026-05-22T10:00:00.000Z"),
    ageMs: 0,
    agentId: "agent-1",
    workspaceId: "workspace-1",
    metadata: {
      dispatchId: "dispatch-secret",
      dispatchStatus: "failed",
      error: "Gateway rejected request with token=query-secret and password=json-secret"
    }
  };

  const output = await getRuntimeOutputForResolvedRuntime(runtime, snapshot);

  assert.equal(output.status, "missing");
  assert.doesNotMatch(output.errorMessage ?? "", /query-secret|json-secret/);
  assert.match(output.errorMessage ?? "", /\[redacted\]/);
});

test("Gateway diagnostic sanitization redacts token, password, bearer, and URL query secrets", () => {
  const sanitized = sanitizeGatewayDiagnosticText(
    'Authorization: Bearer bearer-secret ws://127.0.0.1:18789/?token=query-secret {"password":"json-secret","clientSecret":"client-secret"}'
  );

  assert.doesNotMatch(sanitized, /bearer-secret|query-secret|json-secret|client-secret/);
  assert.match(sanitized, /\[redacted\]/);
});
