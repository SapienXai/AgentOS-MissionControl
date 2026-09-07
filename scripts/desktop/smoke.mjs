import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { spawn } from "node:child_process";
import net from "node:net";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeExecutableName, sanitizeDiagnostics, resolveTargetPlatform } from "./runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const runtimeRoot = path.join(repoRoot, "apps", "desktop", "runtime");
const targetPlatform = resolveTargetPlatform();
const serverRoot = path.join(runtimeRoot, "agentos");
const serverWrapperPath = path.join(serverRoot, "agentos-desktop-server.cjs");
const nodePath = targetPlatform === "win32"
  ? path.join(runtimeRoot, "node", nodeExecutableName(targetPlatform))
  : path.join(runtimeRoot, "node", "bin", nodeExecutableName(targetPlatform));
const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-desktop-smoke-"));
const runtimeState = path.join(tempRoot, "agentos-state");
const port = await reservePort();
const apiToken = randomBytes(32).toString("hex");

const child = spawn(nodePath, [serverWrapperPath], {
  cwd: serverRoot,
  stdio: ["pipe", "pipe", "pipe"],
  env: {
    ...process.env,
    NODE_ENV: "production",
    HOSTNAME: "127.0.0.1",
    PORT: String(port),
    AGENTOS_API_TOKEN: apiToken,
    AGENTOS_PACKAGE_RUNTIME: "1",
    AGENTOS_RUNTIME_DIR: runtimeState
  }
});

let output = "";
child.stdout.on("data", (chunk) => { output += String(chunk); });
child.stderr.on("data", (chunk) => { output += String(chunk); });

try {
  await waitForReady(`http://127.0.0.1:${port}/api/auth/status`, child);
  const response = await fetch(`http://127.0.0.1:${port}/api/auth/status`, { headers: { authorization: `Bearer ${apiToken}` } });
  if (!response.ok) throw new Error(`AgentOS readiness endpoint returned HTTP ${response.status}.`);

  const binding = await inspectLoopbackBinding(child.pid, port);
  if (binding.status === "verified" && !binding.value.includes("127.0.0.1")) {
    throw new Error(`AgentOS server did not bind to loopback only: ${binding.value}`);
  }

  child.stdin.write("shutdown\n");
  child.stdin.end();
  const exit = await waitForExit(child);
  if (exit !== 0 && exit !== 143) throw new Error(`AgentOS server did not exit cleanly after graceful shutdown (code ${exit}).`);
  console.log(`Desktop packaged-server smoke passed on ${process.platform}/${process.arch}; loopback binding ${binding.status}.`);
} catch (error) {
  if (!child.killed) child.kill("SIGKILL");
  throw new Error(`${error instanceof Error ? error.message : String(error)}${output ? `\n${sanitizeDiagnostics(output)}` : ""}`);
} finally {
  await rm(tempRoot, { recursive: true, force: true });
}

async function waitForReady(url, processChild) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    if (processChild.exitCode !== null) throw new Error(`AgentOS server exited during startup with code ${processChild.exitCode}.`);
    try {
      const response = await fetch(url);
      if (response.status < 500) return;
    } catch {
      // Keep polling until the server accepts a request.
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(`AgentOS server did not become ready at ${url}.`);
}

function reservePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const portNumber = typeof address === "object" && address ? address.port : null;
      server.close((error) => error ? reject(error) : portNumber ? resolve(portNumber) : reject(new Error("Could not reserve a loopback port.")));
    });
  });
}

async function inspectLoopbackBinding(pid, portNumber) {
  if (!pid) return { status: "unavailable", value: "missing child pid" };
  const command = process.platform === "win32" ? "netstat" : "lsof";
  const args = process.platform === "win32" ? ["-ano", "-p", "TCP"] : ["-Pan", "-p", String(pid), "-iTCP", "-sTCP:LISTEN"];
  try {
    const result = await runCommand(command, args);
    const value = process.platform === "win32"
      ? result.stdout.split(/\r?\n/).filter((line) => line.includes(`:${portNumber}`) && line.trim().endsWith(String(pid))).join("\n").trim()
      : result.stdout.trim();
    return { status: value ? "verified" : "unavailable", value };
  } catch {
    return { status: "unavailable", value: "binding inspection tool unavailable" };
  }
}

function waitForExit(processChild) {
  if (processChild.exitCode !== null) return Promise.resolve(processChild.exitCode);
  return new Promise((resolve) => processChild.once("exit", (code) => resolve(code ?? 1)));
}

function runCommand(command, args) {
  return new Promise((resolve, reject) => {
    const processChild = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"] });
    let stdout = "";
    processChild.stdout.on("data", (chunk) => { stdout += String(chunk); });
    processChild.on("error", reject);
    processChild.on("exit", (code) => code === 0 ? resolve({ stdout }) : reject(new Error(`${command} exited with ${code}`)));
  });
}
