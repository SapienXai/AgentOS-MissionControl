import assert from "node:assert/strict";
import { test } from "node:test";

import {
  resolveAgentChatAuthAction,
  resolveAgentChatGatewayRepairAction
} from "@/lib/openclaw/chat-auth-actions";

test("agent chat auth action detects ChatGPT Codex reconnect messages", () => {
  const action = resolveAgentChatAuthAction(
    "Your ChatGPT/Codex session has expired. Reconnect ChatGPT, then retry model discovery or runtime verification. Run: openclaw models auth login --provider openai --set-default",
    "openai/gpt-5.4-mini"
  );

  assert.equal(action?.provider, "openai");
  assert.equal(action?.label, "OpenAI");
});

test("agent chat auth action understands Codex provider login commands", () => {
  const action = resolveAgentChatAuthAction(
    "Run: openclaw models auth login --provider openai --set-default",
    "openai/gpt-5.4-mini"
  );

  assert.equal(action?.provider, "openai");
  assert.equal(action?.label, "OpenAI");
});

test("agent chat auth action detects Codex auth refresh timeout diagnostics", () => {
  const action = resolveAgentChatAuthAction(
    "OpenClaw completed the chat turn without assistant text, but exposed this diagnostic: Agent failed before reply: auth refresh request timed out after 10s.",
    "openai/gpt-5.4-mini"
  );

  assert.equal(action?.provider, "openai");
  assert.equal(action?.label, "OpenAI");
});

test("agent chat auth action detects silent Codex chat stream failures", () => {
  const action = resolveAgentChatAuthAction(
    "OpenClaw reported the ChatGPT/Codex chat stream failed before assistant text was available, but did not expose the provider error. Reconnect ChatGPT, then retry this message.",
    "openai/gpt-5.4-mini"
  );

  assert.equal(action?.provider, "openai");
  assert.equal(action?.label, "OpenAI");
});

test("agent chat auth action reads provider from OpenClaw auth command", () => {
  const action = resolveAgentChatAuthAction(
    "Authentication required. Run: openclaw models auth paste-token --provider=openrouter",
    "openrouter/anthropic/claude-sonnet-4.5"
  );

  assert.equal(action?.provider, "openrouter");
});

test("agent chat auth action uses local recovery for Ollama instead of login", () => {
  const action = resolveAgentChatAuthAction(
    'No API key found for provider "ollama".',
    "ollama/jonathan-qwen38-q4:latest"
  );

  assert.equal(action?.provider, "ollama");
  assert.equal(action?.cta, "Repair Ollama");
});

test("agent chat auth action falls back to the agent model provider", () => {
  const action = resolveAgentChatAuthAction(
    "Provider token expired with status 401. Please reconnect before retrying.",
    "anthropic/claude-sonnet-4.5"
  );

  assert.equal(action?.provider, "anthropic");
});

test("agent chat auth action maps Gemini model provider to Google", () => {
  const action = resolveAgentChatAuthAction(
    "Authentication failed. Sign in again before retrying this request.",
    "gemini/gemini-2.5-pro"
  );

  assert.equal(action?.provider, "google");
});

test("agent chat auth action ignores non-auth chat errors", () => {
  assert.equal(resolveAgentChatAuthAction("OpenClaw completed without returning a response.", "openai/gpt-5.4-mini"), null);
});

test("agent chat gateway repair action detects OpenClaw scope upgrade failures", () => {
  const action = resolveAgentChatGatewayRepairAction(
    "OpenClaw command failed with exit code 1: gateway connect failed: GatewayClientRequestError: scope upgrade pending approval (requestId: 163fa71c-6476-4d48-964b-7c7c423b1238)."
  );

  assert.equal(action?.label, "Gateway access");
  assert.equal(action?.apiAction, "repairDeviceAccess");
});

test("agent chat gateway repair action detects device token scope mismatch diagnostics", () => {
  const action = resolveAgentChatGatewayRepairAction(
    "gateway.runtime.snapshot: Gateway-first request fell back to CLI (auth): INVALID_REQUEST: unauthorized: device token scope mismatch (re-pair or approve scope upgrade)"
  );

  assert.equal(action?.label, "Gateway access");
  assert.equal(action?.apiAction, "repairDeviceAccess");
});

test("agent chat gateway repair action detects gateway token mismatch diagnostics", () => {
  const action = resolveAgentChatGatewayRepairAction(
    "gateway.health: Gateway-first request fell back to CLI (auth): INVALID_REQUEST: unauthorized: gateway token mismatch (provide gateway auth token)"
  );

  assert.equal(action?.label, "Gateway token");
  assert.equal(action?.apiAction, "generateLocalToken");
});
