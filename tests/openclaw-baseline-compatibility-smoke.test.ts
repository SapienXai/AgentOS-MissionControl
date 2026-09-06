import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";

import { getOpenClawInstallCommand } from "@/lib/openclaw/install";
import {
  buildOpenAiAuthLoginCommand,
  buildOpenAiAuthRepairCommand
} from "@/lib/openclaw/model-auth-errors";
import {
  OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS,
  OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS,
  OPENCLAW_GATEWAY_BASELINE_VERSION,
  OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS
} from "@/lib/openclaw/client/gateway-compatibility";
import { compareVersionStrings } from "@/lib/openclaw/domains/control-plane-normalization";
import {
  OPENCLAW_RECOMMENDED_VERSION,
  OPENCLAW_SUPPORTED_BASELINE_VERSION
} from "@/lib/openclaw/versions";

function source(path: string) {
  return readFileSync(path, "utf8");
}

const staleCodexAuthCommandPattern = new RegExp([
  ["--provider", "codex"].join(" "),
  ["--method", "app-server"].join(" ")
].join("|"));
const staleBaselineCopyPattern = new RegExp([
  ["2026", "5"].join("\\."),
  ["current", "stable", "OpenClaw"].join(" "),
  ["stable", "builds"].join(" ")
].join("|"));

test("setup smoke uses the centralized OpenClaw baseline constants", () => {
  assert.equal(OPENCLAW_RECOMMENDED_VERSION, "2026.9.2");
  assert.equal(OPENCLAW_SUPPORTED_BASELINE_VERSION, "2026.9.1");
  assert.equal(compareVersionStrings(OPENCLAW_RECOMMENDED_VERSION, OPENCLAW_SUPPORTED_BASELINE_VERSION) >= 0, true);
  assert.match(OPENCLAW_RECOMMENDED_VERSION, /^\d{4}\.\d+\.\d+$/);
  assert.equal(OPENCLAW_GATEWAY_BASELINE_VERSION, OPENCLAW_SUPPORTED_BASELINE_VERSION);

  const installCommand = getOpenClawInstallCommand();
  assert.match(installCommand, new RegExp(`(?:--version|-Tag)\\s+${OPENCLAW_RECOMMENDED_VERSION}`));
  assert.doesNotMatch(installCommand, /update\s+--tag/);
});

test("gateway native connection smoke covers the supported OpenClaw method baseline", () => {
  for (const method of [
    "status",
    "update.status",
    "models.list",
    "models.authStatus",
    "config.get",
    "config.set",
    "config.patch",
    "plugins.uiDescriptors",
    "sessions.list",
    "sessions.preview",
    "tasks.list",
    "tasks.get",
    "tasks.assign",
    "tasks.cancel",
    "channels.status",
    "channels.list",
    "device.pair.list",
    "device.pair.approve"
  ]) {
    assert.equal(OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS.includes(method), true, `${method} is tracked`);
  }

  assert.equal(OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS.includes("status"), true);
  assert.equal(OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS.includes("update.status"), true);
  assert.equal(OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS.includes("models.list"), true);
  assert.equal(OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS.includes("config.set"), true);
  assert.equal(OPENCLAW_GATEWAY_BASELINE_OPTIONAL_METHODS.includes("tasks.cancel"), true);
  assert.equal((OPENCLAW_GATEWAY_BASELINE_REQUIRED_METHODS as readonly string[]).includes("tasks.assign"), false);
  assert.equal(OPENCLAW_KNOWN_GATEWAY_FIRST_METHODS.includes("tasks.subscribe"), false);
});

test("gateway status and probe smoke use documented CLI commands", () => {
  const cliClient = source("lib/openclaw/client/cli-gateway-client.ts");
  const onboardingRoute = source("app/api/onboarding/route.ts");

  assert.match(cliClient, /\["gateway",\s*"status",\s*"--json"\]/);
  assert.match(cliClient, /\["gateway",\s*"probe",\s*"--json"\]/);
  assert.match(cliClient, /\["gateway",\s*action\]/);
  assert.match(onboardingRoute, /\["gateway",\s*"status",\s*"--json"\]/);
});

test("add ChatGPT/Codex model smoke uses the canonical OpenAI provider handoff", () => {
  const loginCommand = buildOpenAiAuthLoginCommand("openclaw");
  const repairCommand = buildOpenAiAuthRepairCommand("openclaw");

  assert.match(loginCommand, /models auth login --provider openai --set-default/);
  assert.doesNotMatch(loginCommand, staleCodexAuthCommandPattern);
  assert.match(repairCommand, /plugins install --force --accept-capabilities @openclaw\/codex/);
  assert.doesNotMatch(repairCommand, /doctor --fix/);
  assert.match(repairCommand, /gateway restart/);
  assert.match(repairCommand, /models auth login --provider openai --set-default/);
  assert.doesNotMatch(repairCommand, staleCodexAuthCommandPattern);
});

test("legacy provider credential compatibility stays outside post-onboarding management", () => {
  const stateService = source("lib/openclaw/application/model-provider-state-service.ts");
  const registry = source("lib/openclaw/model-provider-registry.ts");
  const managementService = source("lib/openclaw/application/model-management-service.ts");
  const wizardService = source("lib/openclaw/application/model-setup-wizard-service.ts");

  assert.match(stateService, /persistProviderCredentialViaGateway/);
  assert.match(stateService, /\.setConfig\(target\.configPath, credential/);
  assert.match(registry, /env\.vars\.OPENROUTER_API_KEY/);
  assert.match(registry, /Legacy compatibility targets/);
  assert.match(registry, /not a provider capability registry/);
  assert.doesNotMatch(managementService, /modelProviderCredentialRegistry/);
  assert.match(managementService, /models\.authStatus/);
  assert.match(wizardService, /openclaw\.setup\.activate\.start/);
  assert.doesNotMatch(stateService, /Gateway-native provider token persistence is not available yet/);
});

test("set default model smoke stays Gateway-native before explicit recovery fallback", () => {
  const stateService = source("lib/openclaw/application/model-provider-state-service.ts");

  assert.match(stateService, /setDefaultModelViaGateway/);
  assert.match(stateService, /adapter\.setConfig\("agents\.defaults"/);
  assert.match(stateService, /AgentOS did not use CLI or legacy file fallback/);
  assert.doesNotMatch(stateService, /AGENTOS_OPENCLAW_LEGACY_PROVIDER_FILE_FALLBACK/);
});

test("agent create and dispatch smoke keeps unsupported task assignment fail-closed", () => {
  const nativeClient = source("lib/openclaw/client/native-ws-gateway-client.ts");
  const cliClient = source("lib/openclaw/client/cli-gateway-client.ts");

  assert.match(nativeClient, /gatewayFirst\(\s*"agents\.create"/);
  assert.doesNotMatch(nativeClient, /gatewayFirstCompatible<OpenClawTaskPayload>\(\s*"taskAssign"/);
  assert.match(nativeClient, /does not expose task assignment through Gateway or CLI/);
  assert.match(nativeClient, /callNative<MissionCommandPayload>\(\s*"chat\.send"/);
  assert.match(nativeClient, /callNative<MissionCommandPayload>\(\s*"sessions\.send"/);
  assert.match(nativeClient, /name: input\.id/);
  assert.doesNotMatch(nativeClient, /agents\.create[\s\S]{0,900}agentDir: input\.agentDir/);
  assert.match(cliClient, /"agents",\s*"add"/);
  assert.match(cliClient, /"agent",\s*"--agent"/);
  assert.match(cliClient, /does not expose task assignment through Gateway or CLI/);
});

test("CLI fallback visibility smoke rejects outdated baseline assumptions", () => {
  const files = [
    "lib/openclaw/client/gateway-compatibility.ts",
    "lib/openclaw/client/cli-gateway-client.ts",
    "lib/openclaw/model-auth-errors.ts",
    "README.md",
    "packages/agentos/README.md",
    "docs/agentos-clean-install-smoke-checklist.md"
  ];

  for (const file of files) {
    const text = source(file);
    assert.doesNotMatch(text, staleBaselineCopyPattern);
    assert.doesNotMatch(text, staleCodexAuthCommandPattern);
  }
});
