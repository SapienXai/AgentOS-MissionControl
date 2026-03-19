#!/usr/bin/env node

import { spawn } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const recordPath = process.argv[2];
const heartbeatIntervalMs = 15_000;

if (!recordPath) {
  process.exit(1);
}

async function main() {
  const record = await readRecord();

  if (!record || typeof record.agentId !== "string" || typeof record.routedMission !== "string") {
    throw new Error("Mission dispatch record is missing or invalid.");
  }

  const openClawBin = process.env.OPENCLAW_BIN || "openclaw";
  const startedAt = new Date().toISOString();
  const sessionId = typeof record.sessionId === "string" && record.sessionId.trim() ? record.sessionId.trim() : null;

  await mutateRecord((current) => ({
    ...current,
    status: "running",
    updatedAt: startedAt,
    error: null,
    runner: {
      ...(current.runner || {}),
      pid: process.pid,
      startedAt,
      lastHeartbeatAt: startedAt
    }
  }));

  const child = spawn(
    openClawBin,
    [
      "agent",
      "--agent",
      record.agentId,
      ...(sessionId ? ["--session-id", sessionId] : []),
      "--message",
      record.routedMission,
      "--thinking",
      typeof record.thinking === "string" ? record.thinking : "medium",
      "--json"
    ],
    {
      cwd: process.cwd(),
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"]
    }
  );

  let stdout = "";
  let stderr = "";
  let settled = false;
  let heartbeat = null;

  await mutateRecord((latest) => ({
    ...latest,
    runner: {
      ...(latest.runner || {}),
      pid: process.pid,
      childPid: child.pid ?? latest.runner?.childPid ?? null,
      startedAt: latest.runner?.startedAt || startedAt,
      lastHeartbeatAt: startedAt
    }
  }));

  const currentAfterSpawn = await readRecord();
  if (currentAfterSpawn && typeof currentAfterSpawn.status === "string" && currentAfterSpawn.status !== "running") {
    settled = true;
    clearInterval(heartbeat);

    if (!child.killed) {
      child.kill("SIGTERM");
    }

    process.exit(0);
    return;
  }

  heartbeat = setInterval(() => {
    void tickHeartbeat();
  }, heartbeatIntervalMs);

  child.stdout.on("data", (chunk) => {
    stdout += chunk.toString();
  });

  child.stderr.on("data", (chunk) => {
    stderr += chunk.toString();
  });

  child.on("error", (error) => {
    void finalize({
      status: "stalled",
      result: null,
      error: `OpenClaw mission failed to start. ${error.message}`
    });
  });

  child.on("close", (code) => {
    void (async () => {
      const current = await readRecord();

      if (current && typeof current.status === "string" && current.status !== "running") {
        settled = true;
        clearInterval(heartbeat);
        process.exit(0);
        return;
      }

      const payload = tryParseMissionPayload(stdout || stderr);

      if (code === 0 && payload && !isFailurePayload(payload)) {
        void finalize({
          status: "completed",
          result: payload,
          error: null
        });
        return;
      }

      void finalize({
        status: "stalled",
        result: payload,
        error:
          payload?.summary ||
          extractFailureMessage(stderr, stdout) ||
          `OpenClaw mission exited with code ${typeof code === "number" ? code : "unknown"}.`
      });
    })();
  });

  async function tickHeartbeat() {
    if (settled) {
      return;
    }

    const current = await readRecord();

    if (current && typeof current.status === "string" && current.status !== "running") {
      settled = true;
      clearInterval(heartbeat);

      if (!child.killed) {
        child.kill("SIGTERM");
      }

      process.exit(0);
      return;
    }

    await mutateRecord((latest) => ({
      ...latest,
      updatedAt: new Date().toISOString(),
      runner: {
        ...(latest.runner || {}),
        pid: process.pid,
        startedAt: latest.runner?.startedAt || startedAt,
        lastHeartbeatAt: new Date().toISOString()
      }
    }));
  }

  async function finalize({ status, result, error }) {
    if (settled) {
      return;
    }

    settled = true;
    clearInterval(heartbeat);
    const finishedAt = new Date().toISOString();

    await mutateRecord((current) => ({
      ...current,
      status,
      updatedAt: finishedAt,
      result: result || current.result || null,
      error,
      runner: {
        ...(current.runner || {}),
        pid: process.pid,
        startedAt: current.runner?.startedAt || startedAt,
        finishedAt,
        lastHeartbeatAt: finishedAt
      }
    }));

    process.exit(0);
  }
}

async function readRecord() {
  try {
    const raw = await readFile(recordPath, "utf8");
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

async function mutateRecord(mutator) {
  const current = (await readRecord()) || {};
  const next = mutator(current);
  await writeJsonAtomic(recordPath, next);
  return next;
}

async function writeJsonAtomic(targetPath, value) {
  const tempPath = `${targetPath}.${process.pid}.tmp`;
  await mkdir(path.dirname(targetPath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(tempPath, targetPath);
}

function tryParseMissionPayload(text) {
  const trimmed = String(text || "").trim();

  if (!trimmed) {
    return null;
  }

  try {
    return JSON.parse(trimmed);
  } catch {}

  const lines = trimmed.split(/\r?\n/);

  for (let start = 0; start < lines.length; start += 1) {
    const line = lines[start].trim();

    if (!line.startsWith("{") && !line.startsWith("[")) {
      continue;
    }

    for (let end = lines.length; end > start; end -= 1) {
      const candidate = lines.slice(start, end).join("\n").trim();

      try {
        return JSON.parse(candidate);
      } catch {}
    }
  }

  return null;
}

function isFailurePayload(payload) {
  const status = typeof payload?.status === "string" ? payload.status.toLowerCase() : "";
  return status === "error" || status === "failed" || status === "stalled";
}

function extractFailureMessage(stderr, stdout) {
  const text = [stderr, stdout]
    .filter(Boolean)
    .join("\n")
    .trim();

  if (!text) {
    return null;
  }

  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  return lines[0] || null;
}

main().catch(async (error) => {
  try {
    await mutateRecord((current) => ({
      ...current,
      status: "stalled",
      updatedAt: new Date().toISOString(),
      error: error instanceof Error ? error.message : "Mission dispatch runner failed unexpectedly.",
      runner: {
        ...(current.runner || {}),
        pid: process.pid,
        finishedAt: new Date().toISOString(),
        lastHeartbeatAt: new Date().toISOString()
      }
    }));
  } catch {}

  process.exit(1);
});
