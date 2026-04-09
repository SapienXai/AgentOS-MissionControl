#!/usr/bin/env node

import { spawn } from "node:child_process";
import { appendFile, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

const recordPath = process.argv[2];
const heartbeatIntervalMs = 15_000;
const runnerDiagnosticJsonKeys = new Set([
  "cause",
  "code",
  "details",
  "error",
  "message",
  "reason",
  "stack",
  "stderr",
  "stdout",
  "warning"
]);

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
  const runnerLogPath = resolveRunnerLogPath(record);
  let logWriteQueue = Promise.resolve();
  let stdoutLineBuffer = "";
  let stderrLineBuffer = "";

  await mutateRecord((current) => ({
    ...current,
    status: "running",
    updatedAt: startedAt,
    error: null,
    runner: {
      ...(current.runner || {}),
      pid: process.pid,
      startedAt,
      lastHeartbeatAt: startedAt,
      logPath: runnerLogPath
    }
  }));
  await enqueueRunnerStatus(
    sessionId
      ? `Dispatch runner booted for agent ${record.agentId} on session ${sessionId}.`
      : `Dispatch runner booted for agent ${record.agentId}.`
  );

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
      lastHeartbeatAt: startedAt,
      logPath: latest.runner?.logPath || runnerLogPath
    }
  }));
  await enqueueRunnerStatus(
    `Launched OpenClaw agent process${child.pid ? ` (pid ${child.pid})` : ""}.`
  );

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
    const text = chunk.toString();
    stdout += text;
    void consumeRunnerStream("stdout", text);
  });

  child.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderr += text;
    void consumeRunnerStream("stderr", text);
  });

  child.on("error", (error) => {
    void enqueueRunnerStatus(`OpenClaw process error: ${error.message}`);
    void finalize({
      status: "stalled",
      result: null,
      error: `OpenClaw mission failed to start. ${error.message}`
    });
  });

  child.on("close", (code) => {
    void (async () => {
      await flushBufferedRunnerOutput();
      const current = await readRecord();

      if (current && typeof current.status === "string" && current.status !== "running") {
        settled = true;
        clearInterval(heartbeat);
        process.exit(0);
        return;
      }

      const payload = tryParseMissionPayload(stdout || stderr);

      if (code === 0 && payload && !isFailurePayload(payload)) {
        await enqueueRunnerStatus("OpenClaw exited successfully and returned a mission payload.");
        void finalize({
          status: "completed",
          result: payload,
          error: null
        });
        return;
      }

      await enqueueRunnerStatus(
        code === 0
          ? "OpenClaw exited successfully but did not return a usable mission payload."
          : `OpenClaw exited with code ${typeof code === "number" ? code : "unknown"}.`
      );
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
    await flushBufferedRunnerOutput();
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
        lastHeartbeatAt: finishedAt,
        logPath: current.runner?.logPath || runnerLogPath
      }
    }));

    await logWriteQueue;
    process.exit(0);
  }

  function enqueueRunnerStatus(text) {
    return enqueueRunnerLog("status", text);
  }

  function enqueueRunnerLog(stream, text) {
    const normalized = normalizeRunnerLogText(text);

    if (!normalized) {
      return Promise.resolve();
    }

    const entry = {
      id: `runner-log:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      stream,
      text: normalized
    };

    logWriteQueue = logWriteQueue
      .then(() => appendRunnerLogEntry(runnerLogPath, entry))
      .catch(() => undefined);

    return logWriteQueue;
  }

  async function consumeRunnerStream(stream, chunk) {
    if (stream === "stdout") {
      stdoutLineBuffer += chunk;
    } else {
      stderrLineBuffer += chunk;
    }

    const buffer = stream === "stdout" ? stdoutLineBuffer : stderrLineBuffer;
    const lines = buffer.split(/\r?\n/);
    const remainder = lines.pop() ?? "";

    if (stream === "stdout") {
      stdoutLineBuffer = remainder;
    } else {
      stderrLineBuffer = remainder;
    }

    for (const line of lines) {
      const normalized = normalizeRunnerLogText(line);

      if (!normalized || shouldSkipRunnerLogLine(stream, normalized)) {
        continue;
      }

      await enqueueRunnerLog(stream, normalized);
    }
  }

  async function flushBufferedRunnerOutput() {
    for (const [stream, pending] of [
      ["stdout", stdoutLineBuffer],
      ["stderr", stderrLineBuffer]
    ]) {
      const normalized = normalizeRunnerLogText(pending);

      if (!normalized || shouldSkipRunnerLogLine(stream, normalized)) {
        continue;
      }

      await enqueueRunnerLog(stream, normalized);
    }

    stdoutLineBuffer = "";
    stderrLineBuffer = "";
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

async function appendRunnerLogEntry(targetPath, entry) {
  await mkdir(path.dirname(targetPath), { recursive: true });
  await appendFile(targetPath, `${JSON.stringify(entry)}\n`, "utf8");
}

function resolveRunnerLogPath(record) {
  const existingPath = record?.runner?.logPath;
  return typeof existingPath === "string" && existingPath.trim() ? existingPath.trim() : `${recordPath}.log.jsonl`;
}

function normalizeRunnerLogText(value) {
  return String(value || "")
    .replace(/\u0000/g, "")
    .trim()
    .slice(0, 400);
}

function shouldSkipRunnerLogLine(stream, text) {
  if (stream === "stdout" && Boolean(tryParseMissionPayload(text))) {
    return true;
  }

  return isIgnorableRunnerLogLine(text);
}

function isIgnorableRunnerLogLine(text) {
  const normalized = String(text || "").trim();

  if (!normalized) {
    return true;
  }

  if (/^[\[\]{}(),]+$/.test(normalized)) {
    return true;
  }

  const quotedPropertyMatch = normalized.match(/^"([^"]+)"\s*:\s*(.+?)(,)?$/);

  if (quotedPropertyMatch) {
    return !runnerDiagnosticJsonKeys.has(quotedPropertyMatch[1].toLowerCase());
  }

  const barePropertyMatch = normalized.match(/^([A-Za-z0-9_.-]+)\s*:\s*(.+)$/);

  if (barePropertyMatch) {
    return false;
  }

  return false;
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
    const failedAt = new Date().toISOString();
    await mutateRecord((current) => ({
      ...current,
      status: "stalled",
      updatedAt: failedAt,
      error: error instanceof Error ? error.message : "Mission dispatch runner failed unexpectedly.",
      runner: {
        ...(current.runner || {}),
        pid: process.pid,
        finishedAt: failedAt,
        lastHeartbeatAt: failedAt,
        logPath: current.runner?.logPath || `${recordPath}.log.jsonl`
      }
    }));
    await appendRunnerLogEntry(`${recordPath}.log.jsonl`, {
      id: `runner-log:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
      timestamp: failedAt,
      stream: "status",
      text: error instanceof Error ? error.message : "Mission dispatch runner failed unexpectedly."
    });
  } catch {}

  process.exit(1);
});
