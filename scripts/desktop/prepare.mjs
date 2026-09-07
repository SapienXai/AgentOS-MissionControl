import { chmod, cp, mkdir, readdir, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream, statSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_NODE_VERSION,
  nodeArchiveName,
  nodeArchiveUrl,
  nodeExecutableName,
  resolveTargetArch,
  resolveTargetPlatform
} from "./runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const runtimeRoot = path.join(desktopRoot, "runtime");
const agentosRuntimeRoot = path.join(runtimeRoot, "agentos");
const nodeRuntimeRoot = path.join(runtimeRoot, "node");
const cacheRoot = path.join(repoRoot, ".desktop-cache");
const targetPlatform = resolveTargetPlatform();
const targetArch = resolveTargetArch();

await rm(runtimeRoot, { recursive: true, force: true });

if (process.env.AGENTOS_DESKTOP_SKIP_BUILD !== "1") {
  await runCommand(pnpmCommand(), ["build:agentos-package"], {
    cwd: repoRoot,
    env: { ...process.env, AGENTOS_DESKTOP_BUILD: "1" }
  });
}

await rm(runtimeRoot, { recursive: true, force: true });
await mkdir(agentosRuntimeRoot, { recursive: true });
await copyDirectoryContents(path.join(repoRoot, "packages", "agentos", "bundle"), agentosRuntimeRoot);
await removeRuntimeEnvironmentFiles(agentosRuntimeRoot);

const nodeRuntime = await resolveNodeRuntime();
const nodeBinaryTarget = targetPlatform === "win32"
  ? path.join(nodeRuntimeRoot, nodeExecutableName(targetPlatform))
  : path.join(nodeRuntimeRoot, "bin", nodeExecutableName(targetPlatform));
await mkdir(path.dirname(nodeBinaryTarget), { recursive: true });
await cp(nodeRuntime.binary, nodeBinaryTarget, { dereference: true });
if (targetPlatform !== "win32" && await pathExists(path.join(nodeRuntime.root, "lib"))) {
  await copyNodeLibraries(path.join(nodeRuntime.root, "lib"), path.join(nodeRuntimeRoot, "lib"));
}
if (targetPlatform !== "win32") {
  await runCommand("chmod", ["755", nodeBinaryTarget], { cwd: repoRoot });
}

await writeFile(
  path.join(runtimeRoot, "metadata.json"),
  `${JSON.stringify({ nodeVersion: DESKTOP_NODE_VERSION, platform: targetPlatform, arch: targetArch }, null, 2)}\n`
);

assertFile(path.join(agentosRuntimeRoot, "server.js"), "standalone AgentOS server");
assertFile(path.join(agentosRuntimeRoot, ".next", "static"), "Next.js static assets");
assertFile(path.join(agentosRuntimeRoot, "public"), "public assets");
assertFile(nodeBinaryTarget, "packaged Node runtime");

console.log(`Prepared desktop runtime at ${runtimeRoot}`);

async function resolveNodeRuntime() {
  const explicitBinary = process.env.AGENTOS_DESKTOP_NODE_BINARY?.trim();
  if (explicitBinary) {
    assertFile(explicitBinary, "AGENTOS_DESKTOP_NODE_BINARY");
    return { binary: explicitBinary, root: inferNodeRuntimeRoot(explicitBinary) };
  }

  const hostMatchesTarget = process.platform === targetPlatform && process.arch === targetArch;
  if (process.env.AGENTOS_DESKTOP_USE_HOST_NODE === "1" && hostMatchesTarget) {
    return { binary: process.execPath, root: inferNodeRuntimeRoot(process.execPath) };
  }

  if (process.env.AGENTOS_DESKTOP_USE_HOST_NODE === "1" && !hostMatchesTarget) {
    throw new Error(
      `Target ${targetPlatform}/${targetArch} differs from the current host. Use the official Node download or provide AGENTOS_DESKTOP_NODE_BINARY.`
    );
  }

  return await downloadNodeRuntime();
}

async function downloadNodeRuntime() {
  const archiveName = nodeArchiveName({ platform: targetPlatform, arch: targetArch });
  const archivePath = path.join(cacheRoot, archiveName);
  await mkdir(cacheRoot, { recursive: true });

  if (!(await pathExists(archivePath))) {
    const response = await fetch(nodeArchiveUrl({ platform: targetPlatform, arch: targetArch }));
    if (!response.ok || !response.body) {
      throw new Error(`Unable to download the official Node runtime (${response.status} ${response.statusText}).`);
    }

    const output = createWriteStream(archivePath);
    await new Promise(async (resolve, reject) => {
      try {
        for await (const chunk of response.body) output.write(chunk);
        output.end(resolve);
      } catch (error) {
        output.destroy();
        reject(error);
      }
    });
  }

  const extractRoot = path.join(cacheRoot, `${archiveName}.extract`);
  await rm(extractRoot, { recursive: true, force: true });
  await mkdir(extractRoot, { recursive: true });
  await runCommand("tar", ["-xf", archivePath, "-C", extractRoot], { cwd: repoRoot });

  const extractedRoot = path.join(extractRoot, `node-v${DESKTOP_NODE_VERSION}-${targetPlatform === "win32" ? "win" : targetPlatform}-${targetArch}`);
  const executable = targetPlatform === "win32"
    ? path.join(extractedRoot, "node.exe")
    : path.join(extractedRoot, "bin", nodeExecutableName(targetPlatform));
  assertFile(executable, "downloaded Node runtime");
  return { binary: executable, root: extractedRoot };
}

function inferNodeRuntimeRoot(binaryPath) {
  const binaryDir = path.dirname(binaryPath);
  return path.basename(binaryDir) === "bin" ? path.dirname(binaryDir) : binaryDir;
}

async function copyDirectoryContents(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    await cp(path.join(sourceDir, entry.name), path.join(targetDir, entry.name), {
      recursive: entry.isDirectory(),
      dereference: true
    });
  }
}

async function copyNodeLibraries(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isFile() || !/^libnode(?:\.|$)/.test(entry.name)) continue;
    await mkdir(targetDir, { recursive: true });
    const target = path.join(targetDir, entry.name);
    await cp(path.join(sourceDir, entry.name), target, { dereference: true });
    await chmod(target, 0o644);
  }
}

async function removeRuntimeEnvironmentFiles(root) {
  for (const name of [".env", ".env.local", ".env.development", ".env.development.local", ".env.production", ".env.production.local", ".env.test", ".env.test.local"]) {
    await rm(path.join(root, name), { force: true });
  }
}

function assertFile(filePath, label) {
  if (!filePath || !pathExistsSync(filePath)) throw new Error(`Missing ${label}: ${filePath}`);
}

function pathExistsSync(filePath) {
  try {
    return Boolean(statSync(filePath));
  } catch {
    return false;
  }
}

async function pathExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch {
    return false;
  }
}

function pnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { ...options, stdio: "inherit", shell: process.platform === "win32" && command.endsWith(".cmd") });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) return resolve();
      reject(new Error(`${command} ${args.join(" ")} failed${signal ? ` with ${signal}` : ` with exit code ${code}`}`));
    });
  });
}
