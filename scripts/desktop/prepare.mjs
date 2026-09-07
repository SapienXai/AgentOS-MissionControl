import { chmod, cp, mkdir, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { createWriteStream, statSync } from "node:fs";
import { spawn } from "node:child_process";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  DESKTOP_NODE_VERSION,
  nodeArchiveName,
  nodeArchiveUrl,
  nodeExecutableName,
  nodeChecksumManifestUrl,
  parseSha256Manifest,
  resolveTargetArch,
  resolveTargetPlatform,
  verifySha256File
} from "./runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const runtimeRoot = path.join(desktopRoot, "runtime");
const agentosRuntimeRoot = path.join(runtimeRoot, "agentos");
const nodeRuntimeRoot = path.join(runtimeRoot, "node");
const serverWrapperSource = path.join(desktopRoot, "agentos-server-wrapper.cjs");
const serverWrapperTarget = path.join(agentosRuntimeRoot, "agentos-desktop-server.cjs");
const bootstrapRoot = path.join(desktopRoot, "bootstrap");
const bootstrapAssetRoot = path.join(bootstrapRoot, "assets");
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
await cp(serverWrapperSource, serverWrapperTarget);
await removeRuntimeEnvironmentFiles(agentosRuntimeRoot);
await prepareBootstrapAssets();

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
  `${JSON.stringify({
    nodeVersion: DESKTOP_NODE_VERSION,
    platform: targetPlatform,
    arch: targetArch,
    nodeSource: nodeRuntime.source,
    nodeSha256: nodeRuntime.sha256 ?? null
  }, null, 2)}\n`
);

assertFile(path.join(agentosRuntimeRoot, "server.js"), "standalone AgentOS server");
assertFile(serverWrapperTarget, "desktop server lifecycle wrapper");
assertFile(path.join(agentosRuntimeRoot, ".next", "static"), "Next.js static assets");
assertFile(path.join(agentosRuntimeRoot, "public"), "public assets");
assertFile(nodeBinaryTarget, "packaged Node runtime");

console.log(`Prepared desktop runtime at ${runtimeRoot}`);

async function resolveNodeRuntime() {
  const explicitBinary = process.env.AGENTOS_DESKTOP_NODE_BINARY?.trim();
  if (explicitBinary) {
    assertFile(explicitBinary, "AGENTOS_DESKTOP_NODE_BINARY");
    return { binary: explicitBinary, root: inferNodeRuntimeRoot(explicitBinary), source: "explicit-host" };
  }

  const hostMatchesTarget = process.platform === targetPlatform && process.arch === targetArch;
  if (process.env.AGENTOS_DESKTOP_USE_HOST_NODE === "1" && hostMatchesTarget) {
    return { binary: process.execPath, root: inferNodeRuntimeRoot(process.execPath), source: "host" };
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
  const manifestResponse = await fetch(nodeChecksumManifestUrl());
  if (!manifestResponse.ok) {
    throw new Error(`Unable to download the official Node checksum manifest (${manifestResponse.status} ${manifestResponse.statusText}).`);
  }
  const manifest = await manifestResponse.text();
  const expectedChecksum = parseSha256Manifest(manifest, archiveName);
  if (!expectedChecksum) {
    throw new Error(`The official Node checksum manifest has no SHA-256 entry for ${archiveName}.`);
  }

  await mkdir(cacheRoot, { recursive: true });

  if (await pathExists(archivePath)) {
    try {
      await verifySha256File(archivePath, expectedChecksum);
    } catch (error) {
      await rm(archivePath, { force: true });
      throw new Error(`Cached Node archive was removed after integrity verification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  } else {
    const temporaryArchivePath = `${archivePath}.download-${process.pid}`;
    await rm(temporaryArchivePath, { force: true });
    const response = await fetch(nodeArchiveUrl({ platform: targetPlatform, arch: targetArch }));
    if (!response.ok || !response.body) {
      throw new Error(`Unable to download the official Node runtime (${response.status} ${response.statusText}).`);
    }

    try {
      await pipeline(Readable.fromWeb(response.body), createWriteStream(temporaryArchivePath));
      await verifySha256File(temporaryArchivePath, expectedChecksum);
      await rename(temporaryArchivePath, archivePath);
    } catch (error) {
      await rm(temporaryArchivePath, { force: true });
      throw new Error(`Downloaded Node archive failed integrity verification: ${error instanceof Error ? error.message : String(error)}`);
    }
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
  return { binary: executable, root: extractedRoot, source: "official", sha256: expectedChecksum };
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

async function prepareBootstrapAssets() {
  await mkdir(bootstrapAssetRoot, { recursive: true });
  await cp(
    path.join(repoRoot, "public", "assets", "pikoLoader.webm"),
    path.join(bootstrapAssetRoot, "pikoLoader.webm")
  );

  const macAlphaSource = path.join(repoRoot, "public", "assets", "pikoLoader.hevc.mov");
  const macAlphaTarget = path.join(bootstrapAssetRoot, "pikoLoader.hevc.mov");
  if (targetPlatform === "darwin" && await pathExists(macAlphaSource)) {
    await cp(macAlphaSource, macAlphaTarget);
  } else {
    await rm(macAlphaTarget, { force: true });
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
