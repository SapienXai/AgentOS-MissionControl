#!/usr/bin/env node

import { spawn } from "node:child_process";

const baseUrl = process.env.AGENTOS_SMOKE_BASE_URL ?? "http://localhost:3000";
const checks = [];

function record(name, status, detail = "") {
  checks.push({ name, status, detail });
  console.log(`${status.padEnd(7)} ${name}${detail ? ` -- ${detail}` : ""}`);
}

async function request(path, options = {}, timeoutMs = 20_000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      ...options,
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(options.headers ?? {})
      }
    });
    const text = await response.text();
    let body = null;

    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }

    return { ok: response.ok, status: response.status, body };
  } catch (error) {
    return {
      ok: false,
      status: 0,
      body: {
        error: error instanceof Error ? error.message : String(error)
      }
    };
  } finally {
    clearTimeout(timeout);
  }
}

function runNodeEval(source, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["-r", "./tests/register-paths.cjs", "-r", "jiti/register.js", "-e", source], {
      cwd: process.cwd(),
      env: {
        ...process.env,
        ...env
      },
      stdio: ["ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
  });
}

const snapshot = await request("/api/snapshot?force=true", {}, 45_000);
record(
  "gateway health/status",
  snapshot.ok && snapshot.body?.diagnostics?.installed ? "PASS" : "FAIL",
  snapshot.ok
    ? `health=${snapshot.body?.diagnostics?.health}; rpcOk=${snapshot.body?.diagnostics?.rpcOk}; issues=${snapshot.body?.diagnostics?.issues?.length ?? 0}`
    : snapshot.body?.error ?? "snapshot failed"
);

const modelStatus = await request("/api/models/providers", {
  method: "POST",
  body: JSON.stringify({ action: "status", provider: "openai-codex" })
}, 45_000);
record(
  "model status",
  modelStatus.ok && modelStatus.body?.provider === "openai-codex" ? "PASS" : "FAIL",
  modelStatus.body?.message ?? modelStatus.body?.error ?? `status=${modelStatus.status}`
);

const agents = Array.isArray(snapshot.body?.agents) ? snapshot.body.agents : [];
record(
  "agents list",
  snapshot.ok && Array.isArray(snapshot.body?.agents) ? "PASS" : "FAIL",
  snapshot.ok ? `count=${agents.length}` : snapshot.body?.error ?? "snapshot failed"
);

record(
  "sessions/recent activity",
  snapshot.ok && Array.isArray(snapshot.body?.runtimes) && Array.isArray(snapshot.body?.tasks) ? "PASS" : "FAIL",
  snapshot.ok
    ? `runtimes=${snapshot.body?.runtimes?.length ?? 0}; tasks=${snapshot.body?.tasks?.length ?? 0}`
    : snapshot.body?.error ?? "snapshot failed"
);

const fallbackIssues = Array.isArray(snapshot.body?.diagnostics?.issues)
  ? snapshot.body.diagnostics.issues.filter((issue) => typeof issue === "string" && issue.includes("Gateway-first request fell back to CLI"))
  : [];
record(
  "gateway fallback diagnostics",
  snapshot.ok && fallbackIssues.length > 0 ? "PASS" : "BLOCKED",
  snapshot.ok
    ? fallbackIssues.length > 0
      ? `${fallbackIssues.length} fallback diagnostic(s)`
      : "no Gateway fallback diagnostics present in current snapshot"
    : snapshot.body?.error ?? "snapshot failed"
);

const readyAgent = agents.find((agent) => agent?.id && agent?.workspaceId && agent?.workspacePath);
record(
  "agent preflight",
  readyAgent ? "PASS" : "BLOCKED",
  readyAgent ? `agent=${readyAgent.id}; workspace=${readyAgent.workspaceId}` : "no workspace-backed agent available"
);

const channelStatus = await runNodeEval(
  `const {getOpenClawAdapter}=require("./lib/openclaw/adapter/openclaw-adapter.ts");
getOpenClawAdapter().getChannelStatus({probe:false}, {timeoutMs:5000}).then((status)=> {
  console.log(JSON.stringify({
    channels: Array.isArray(status.channelOrder) ? status.channelOrder.length : 0,
    accounts: status.channelAccounts && typeof status.channelAccounts === "object"
      ? Object.values(status.channelAccounts).reduce((sum, entries)=> sum + (Array.isArray(entries) ? entries.length : 0), 0)
      : 0
  }));
}).catch((error)=> {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});`
);
const channelStatusDetail = channelStatus.code === 0
  ? channelStatus.stdout.trim()
  : channelStatus.stderr.trim() || `exit=${channelStatus.code}`;
record(
  "channel/provider status",
  channelStatus.code === 0
    ? "PASS"
    : /pairing|required|auth|gateway/i.test(channelStatusDetail)
      ? "BLOCKED"
      : "FAIL",
  channelStatusDetail
);

const fallback = await runNodeEval(
  `const svc=require("./lib/openclaw/application/mission-control-service.ts");
svc.getMissionControlSnapshot({force:true}).then((snapshot)=> {
  console.log(JSON.stringify({
    mode: snapshot.mode,
    installed: snapshot.diagnostics.installed,
    workspaces: snapshot.workspaces.length,
    models: snapshot.models.length
  }));
}).catch((error)=> {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});`,
  {
    AGENTOS_OPENCLAW_GATEWAY_CLIENT: "cli",
    OPENCLAW_GATEWAY_CLIENT: "cli",
    AGENTOS_OPENCLAW_NATIVE_WS: "0"
  }
);
record(
  "CLI fallback snapshot",
  fallback.code === 0 ? "PASS" : "FAIL",
  fallback.code === 0 ? fallback.stdout.trim() : fallback.stderr.trim() || `exit=${fallback.code}`
);

const failed = checks.filter((check) => check.status === "FAIL");
console.log("SMOKE_RESULT_JSON_START");
console.log(JSON.stringify({ baseUrl, checks }, null, 2));
console.log("SMOKE_RESULT_JSON_END");

if (failed.length > 0) {
  process.exit(1);
}
