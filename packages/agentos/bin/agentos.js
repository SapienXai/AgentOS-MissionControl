#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(__dirname, "..");
const packageJsonPath = path.join(packageRoot, "package.json");
const bundleDir = path.join(packageRoot, "bundle");
const bundledServerPath = path.join(bundleDir, "server.js");

const packageJson = JSON.parse(await readTextFile(packageJsonPath));
const defaultInstallRoot = path.join(os.homedir(), ".agentos");
const defaultBinDir = path.join(os.homedir(), ".local", "bin");
const runtimeInstallRoot = resolveRuntimeInstallRoot();
const runtimeStateDir = path.join(runtimeInstallRoot, "run");
const stopPollIntervalMs = 100;
const stopTimeoutMs = 5_000;

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});

async function main() {
  const args = process.argv.slice(2);
  const firstArg = args[0];

  if (!firstArg) {
    await startServer([]);
    return;
  }

  if (firstArg === "--help" || firstArg === "-h" || firstArg === "help") {
    printHelp();
    return;
  }

  if (firstArg === "--version" || firstArg === "-v" || firstArg === "version") {
    console.log(packageJson.version);
    return;
  }

  if (firstArg === "doctor") {
    runDoctor();
    return;
  }

  if (firstArg === "stop") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      printStopHelp();
      return;
    }

    await runStop(args.slice(1));
    return;
  }

  if (firstArg === "uninstall") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      printUninstallHelp();
      return;
    }

    await runUninstall(args.slice(1));
    return;
  }

  if (firstArg === "start") {
    await startServer(args.slice(1));
    return;
  }

  await startServer(args);
}

async function startServer(rawArgs) {
  ensureBundleExists();

  const options = parseStartArgs(rawArgs);
  const runtimeStatePath = resolveRuntimeStatePath(options.port);
  const trackedState = readRuntimeState(runtimeStatePath);
  const openClawCheck = detectOpenClaw();
  const browserOpener = detectBrowserOpener();

  if (trackedState?.pid && isProcessRunning(trackedState.pid)) {
    throw new Error(
      `AgentOS is already running on port ${options.port} (PID ${trackedState.pid}). Use "agentos stop --port ${options.port}" first.`
    );
  }

  if (trackedState) {
    clearRuntimeState(runtimeStatePath);
  }

  const url = `http://${displayHost(options.host)}:${options.port}`;
  console.log(`Starting AgentOS on ${url}`);

  if (!openClawCheck.available) {
    console.log("OpenClaw was not found on PATH. AgentOS will start and guide onboarding in the UI.");
  } else if (openClawCheck.version) {
    console.log(`OpenClaw detected: ${openClawCheck.version}`);
  }

  if (options.open && !browserOpener.available) {
    console.warn(
      `Browser auto-open is unavailable on this machine${browserOpener.detail ? ` (${browserOpener.detail})` : ""}.`
    );
  }

  const child = spawn(process.execPath, [bundledServerPath], {
    cwd: bundleDir,
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(options.port),
      HOSTNAME: options.host
    }
  });

  if (!child.pid) {
    child.kill("SIGTERM");
    throw new Error("AgentOS could not determine the server PID.");
  }

  try {
    writeRuntimeState(runtimeStatePath, {
      pid: child.pid,
      port: options.port,
      host: options.host,
      startedAt: new Date().toISOString()
    });
  } catch (error) {
    child.kill("SIGTERM");
    throw error;
  }

  const browserState = { opened: false };
  const relayStdout = createRelay(process.stdout, options, url, browserOpener, browserState);
  const relayStderr = createRelay(process.stderr, options, url, browserOpener, browserState);

  child.stdout.on("data", relayStdout);
  child.stderr.on("data", relayStderr);

  let cleanedUp = false;
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);
    process.off("SIGQUIT", forwardSignal);
    clearRuntimeState(runtimeStatePath, child.pid);
  };

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);
  process.on("SIGQUIT", forwardSignal);

  child.on("error", (error) => {
    cleanup();
    console.error(`AgentOS failed to start: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    cleanup();

    if (signal) {
      process.kill(process.pid, signal);
      return;
    }

    process.exit(code ?? 0);
  });
}

function runDoctor() {
  const options = parseStartArgs([]);
  const openClawCheck = detectOpenClaw();
  const browserOpener = detectBrowserOpener();
  const targetUrl = `http://${displayHost(options.host)}:${options.port}`;
  const checks = [
    {
      ok: true,
      label: "Package",
      detail: `${packageJson.name}@${packageJson.version}`
    },
    {
      ok: isSupportedNodeVersion(process.versions.node),
      label: "Node.js",
      detail: `${process.version} (required >= 20.9.0)`
    },
    {
      ok: true,
      label: "Platform",
      detail: `${os.platform()} ${os.release()}`
    },
    {
      ok: existsSync(bundledServerPath),
      label: "Bundle",
      detail: existsSync(bundledServerPath)
        ? `ready at ${bundledServerPath}`
        : `missing at ${bundledServerPath}`
    },
    {
      ok: true,
      label: "Target URL",
      detail: targetUrl
    },
    {
      ok: true,
      label: "Configured env",
      detail: formatConfiguredEnv(options)
    },
    {
      ok: openClawCheck.available,
      label: "OpenClaw",
      detail: openClawCheck.available
        ? `${openClawCheck.version || "installed"}${openClawCheck.path ? ` at ${openClawCheck.path}` : ""}`
        : "not found on PATH"
    },
    {
      ok: browserOpener.available,
      label: "Browser opener",
      detail: browserOpener.available
        ? `${browserOpener.command} is available`
        : browserOpener.detail || "no supported browser opener detected"
    }
  ];

  for (const check of checks) {
    console.log(`${check.ok ? "OK" : "WARN"}  ${check.label}: ${check.detail}`);
  }

  if (!checks.every((check) => check.ok || check.label === "OpenClaw" || check.label === "Browser opener")) {
    process.exitCode = 1;
  }
}

async function runStop(rawArgs) {
  const options = parseStopArgs(rawArgs);
  const runtimeStatePath = resolveRuntimeStatePath(options.port);
  const trackedState = readRuntimeState(runtimeStatePath);
  const targetPid = trackedState?.pid ?? findListeningPidForPort(options.port);

  if (!targetPid) {
    clearRuntimeState(runtimeStatePath);
    console.log(`No running AgentOS process was found on port ${options.port}.`);
    return;
  }

  console.log(`Stopping AgentOS on port ${options.port} (PID ${targetPid})...`);

  try {
    process.kill(targetPid, options.force ? "SIGKILL" : "SIGTERM");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
      clearRuntimeState(runtimeStatePath);
      console.log(`AgentOS is not running on port ${options.port}.`);
      return;
    }

    throw error;
  }

  const stopped = await waitForProcessExit(targetPid, options.force ? 1_000 : stopTimeoutMs);

  if (!stopped) {
    console.error(
      options.force
        ? `AgentOS did not stop after SIGKILL on port ${options.port}.`
        : `AgentOS did not stop within ${Math.round(stopTimeoutMs / 1000)} seconds. Re-run "agentos stop --port ${options.port} --force" if you want to terminate it.`
    );
    process.exitCode = 1;
    return;
  }

  clearRuntimeState(runtimeStatePath);
  console.log(`Stopped AgentOS on port ${options.port}.`);
}

function parseStartArgs(rawArgs) {
  const envPort = process.env.AGENTOS_PORT || process.env.PORT;
  const options = {
    host: process.env.AGENTOS_HOST || "127.0.0.1",
    port: envPort && /^\d+$/.test(envPort) ? Number(envPort) : 3000,
    open: parseBooleanEnv(process.env.AGENTOS_OPEN)
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--port" || arg === "-p") {
      const value = rawArgs[index + 1];
      index += 1;
      assertPort(value);
      options.port = Number(value);
      continue;
    }

    if (arg.startsWith("--port=")) {
      const value = arg.slice("--port=".length);
      assertPort(value);
      options.port = Number(value);
      continue;
    }

    if (arg === "--host" || arg === "-H") {
      const value = rawArgs[index + 1];
      index += 1;
      assertHost(value);
      options.host = value;
      continue;
    }

    if (arg.startsWith("--host=")) {
      const value = arg.slice("--host=".length);
      assertHost(value);
      options.host = value;
      continue;
    }

    if (arg === "--open" || arg === "-o") {
      options.open = true;
      continue;
    }

    if (arg === "--no-open") {
      options.open = false;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseStopArgs(rawArgs) {
  const envPort = process.env.AGENTOS_PORT || process.env.PORT;
  const options = {
    port: envPort && /^\d+$/.test(envPort) ? Number(envPort) : 3000,
    force: false
  };

  for (let index = 0; index < rawArgs.length; index += 1) {
    const arg = rawArgs[index];

    if (arg === "--port" || arg === "-p") {
      const value = rawArgs[index + 1];
      index += 1;
      assertPort(value);
      options.port = Number(value);
      continue;
    }

    if (arg.startsWith("--port=")) {
      const value = arg.slice("--port=".length);
      assertPort(value);
      options.port = Number(value);
      continue;
    }

    if (arg === "--force" || arg === "-f") {
      options.force = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseUninstallArgs(rawArgs) {
  const options = {
    yes: false
  };

  for (const arg of rawArgs) {
    if (arg === "--yes" || arg === "-y") {
      options.yes = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function assertPort(value) {
  if (!value || !/^\d+$/.test(value)) {
    throw new Error("Expected a numeric value after --port.");
  }

  const port = Number(value);

  if (port < 1 || port > 65535) {
    throw new Error("Port must be between 1 and 65535.");
  }
}

function assertHost(value) {
  if (!value) {
    throw new Error("Expected a value after --host.");
  }
}

function detectOpenClaw() {
  const pathResult = resolveCommandPath("openclaw");
  const result = spawnSync("openclaw", ["--version"], {
    encoding: "utf8"
  });

  if (result.error || result.status !== 0) {
    return {
      available: false,
      version: null,
      path: pathResult
    };
  }

  return {
    available: true,
    version: result.stdout.trim() || result.stderr.trim() || null,
    path: pathResult
  };
}

function detectBrowserOpener() {
  if (process.platform === "darwin") {
    return {
      available: true,
      command: "open",
      args: [],
      detail: null
    };
  }

  if (process.platform === "win32") {
    return {
      available: true,
      command: "cmd",
      args: ["/c", "start", ""],
      detail: null
    };
  }

  const command = resolveCommandPath("xdg-open");

  if (!command) {
    return {
      available: false,
      command: "xdg-open",
      args: [],
      detail: "xdg-open was not found on PATH"
    };
  }

  return {
    available: true,
    command,
    args: [],
    detail: null
  };
}

function ensureBundleExists() {
  if (!existsSync(bundledServerPath)) {
    throw new Error(
      "AgentOS bundle is missing. Reinstall the package or rebuild it before publishing."
    );
  }
}

function displayHost(host) {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function printHelp() {
  console.log(`AgentOS Mission Control

Usage:
  agentos
  agentos start --port 3000 --host 127.0.0.1 --open
  agentos stop --port 3000 [--force]
  agentos doctor
  agentos uninstall [--yes]
  agentos --version

Options:
  start: --port, -p   Port to bind the local server (default: 3000)
  start: --host, -H   Host to bind the local server (default: 127.0.0.1)
  start: --open, -o   Open AgentOS in the default browser after startup
  start: --no-open    Disable browser auto-open even if AGENTOS_OPEN is set
  stop:  --port, -p   Port to stop (default: 3000)
  stop:  --force, -f  Send SIGKILL if SIGTERM does not stop the server
`);
}

function printStopHelp() {
  console.log(`Stop a running AgentOS server.

Usage:
  agentos stop
  agentos stop --port 3000
  agentos stop --port 3000 --force

Options:
  --port, -p    Port to stop (default: 3000)
  --force, -f   Send SIGKILL if SIGTERM does not stop the server
`);
}

function printUninstallHelp() {
  console.log(`Remove an AgentOS release installation.

Usage:
  agentos uninstall
  agentos uninstall --yes

Options:
  --yes, -y   Skip the confirmation prompt
`);
}

function createRelay(target, options, url, browserOpener, browserState) {
  return (chunk) => {
    const text = chunk.toString();
    target.write(text);

    if (browserState.opened || !options.open || !browserOpener.available) {
      return;
    }

    if (text.includes("Ready in") || text.includes("Local:")) {
      browserState.opened = true;
      openBrowser(url, browserOpener);
    }
  };
}

function openBrowser(url, browserOpener) {
  const browser = spawn(browserOpener.command, [...browserOpener.args, url], {
    detached: true,
    stdio: "ignore"
  });

  browser.on("error", (error) => {
    console.warn(`Could not open a browser automatically: ${error.message}`);
  });

  browser.unref();
}

function resolveCommandPath(command) {
  if (process.platform === "win32") {
    const result = spawnSync("where", [command], {
      encoding: "utf8"
    });

    if (result.error || result.status !== 0) {
      return null;
    }

    return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) || null;
  }

  const result = spawnSync("which", [command], {
    encoding: "utf8"
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  return result.stdout.trim() || null;
}

function isSupportedNodeVersion(version) {
  const [majorText, minorText] = version.split(".");
  const major = Number(majorText);
  const minor = Number(minorText);

  if (!Number.isFinite(major) || !Number.isFinite(minor)) {
    return false;
  }

  return major > 20 || (major === 20 && minor >= 9);
}

function parseBooleanEnv(value) {
  if (!value) {
    return false;
  }

  const normalized = value.trim().toLowerCase();
  return normalized === "1" || normalized === "true" || normalized === "yes" || normalized === "on";
}

function formatConfiguredEnv(options) {
  const pairs = [
    `AGENTOS_HOST=${options.host}`,
    `AGENTOS_PORT=${options.port}`,
    `AGENTOS_OPEN=${options.open ? "1" : "0"}`
  ];

  return pairs.join(", ");
}

async function readTextFile(filePath) {
  const { readFile } = await import("node:fs/promises");
  return readFile(filePath, "utf8");
}

async function runUninstall(rawArgs) {
  const options = parseUninstallArgs(rawArgs);
  const install = inspectInstallation();

  if (install.kind === "package-manager") {
    printPackageManagerUninstallGuidance();
    return;
  }

  if (install.kind === "source") {
    console.log("This AgentOS copy looks like a source checkout, not a release installation.");
    console.log(`Delete the checkout manually if you want to remove it: ${findRepoRoot()}`);
    return;
  }

  if (!options.yes) {
    const confirmed = await confirmUninstall(install);

    if (!confirmed) {
      console.log("Uninstall cancelled.");
      return;
    }
  }

  const removedPaths = [];

  if (await removePathIfExists(install.packagePath)) {
    removedPaths.push(install.packagePath);
  }

  if (install.launcherPath && (await removePathIfExists(install.launcherPath))) {
    removedPaths.push(install.launcherPath);
  }

  await removeDirectoryIfEmpty(install.installRoot);

  if (removedPaths.length === 0) {
    console.log("No removable AgentOS release files were found.");
    return;
  }

  console.log("Removed AgentOS release installation:");

  for (const removedPath of removedPaths) {
    console.log(`- ${removedPath}`);
  }

  if (!install.launcherPath) {
    console.log(`No managed launcher was detected on PATH. If you used a custom bin directory, remove that launcher manually.`);
  }
}

function inspectInstallation() {
  if (path.basename(packageRoot) === "package") {
    return {
      kind: "release",
      installRoot: path.dirname(packageRoot),
      packagePath: packageRoot,
      launcherPath: detectManagedLauncher(packageRoot)
    };
  }

  if (packageRoot.includes(`${path.sep}node_modules${path.sep}`) || packageRoot.includes(`${path.sep}.pnpm${path.sep}`)) {
    return {
      kind: "package-manager"
    };
  }

  return {
    kind: "source"
  };
}

function printPackageManagerUninstallGuidance() {
  console.log("This AgentOS install appears to come from a package manager.");
  console.log("Remove it with one of:");
  console.log("  pnpm remove -g @sapienx/agentos");
  console.log("  npm uninstall -g @sapienx/agentos");
}

function findRepoRoot() {
  return path.resolve(packageRoot, "..", "..");
}

function detectManagedLauncher(installedPackagePath) {
  const scriptMarker = normalizeForMatch(path.join(installedPackagePath, "bin", "agentos.js"));
  const candidates = new Set([
    resolveCommandPath("agentos"),
    path.join(defaultBinDir, "agentos")
  ]);

  for (const candidate of candidates) {
    if (!candidate || !existsSync(candidate)) {
      continue;
    }

    try {
      const contents = readFileSync(candidate, "utf8");

      if (normalizeForMatch(contents).includes(scriptMarker)) {
        return candidate;
      }
    } catch {
      continue;
    }
  }

  return null;
}

function normalizeForMatch(value) {
  return value.replaceAll("\\", "/");
}

function resolveRuntimeInstallRoot() {
  if (process.env.AGENTOS_INSTALL_ROOT) {
    return path.resolve(process.env.AGENTOS_INSTALL_ROOT);
  }

  if (path.basename(packageRoot) === "package") {
    return path.dirname(packageRoot);
  }

  return defaultInstallRoot;
}

function resolveRuntimeStatePath(port) {
  return path.join(runtimeStateDir, `agentos-${port}.json`);
}

function readRuntimeState(runtimeStatePath) {
  if (!existsSync(runtimeStatePath)) {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(runtimeStatePath, "utf8"));

    if (!payload || typeof payload !== "object" || !Number.isInteger(payload.pid) || payload.pid <= 0) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function writeRuntimeState(runtimeStatePath, payload) {
  mkdirSync(runtimeStateDir, {
    recursive: true
  });
  writeFileSync(runtimeStatePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function clearRuntimeState(runtimeStatePath, expectedPid) {
  if (existsSync(runtimeStatePath)) {
    if (expectedPid) {
      const payload = readRuntimeState(runtimeStatePath);

      if (payload?.pid && payload.pid !== expectedPid) {
        return;
      }
    }

    rmSync(runtimeStatePath, {
      force: true
    });
  }

  if (!existsSync(runtimeStateDir)) {
    return;
  }

  if (readdirSync(runtimeStateDir).length === 0) {
    rmdirSync(runtimeStateDir);
  }
}

function isProcessRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ESRCH") {
        return false;
      }

      if (error.code === "EPERM") {
        return true;
      }
    }

    throw error;
  }
}

function findListeningPidForPort(port) {
  if (process.platform === "win32") {
    return null;
  }

  const result = spawnSync("lsof", ["-nP", `-iTCP:${port}`, "-sTCP:LISTEN", "-t"], {
    encoding: "utf8"
  });

  if (result.error || result.status !== 0) {
    return null;
  }

  const firstLine = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find(Boolean);

  if (!firstLine || !/^\d+$/.test(firstLine)) {
    return null;
  }

  return Number(firstLine);
}

async function waitForProcessExit(pid, timeoutMs) {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    if (!isProcessRunning(pid)) {
      return true;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, stopPollIntervalMs);
    });
  }

  return !isProcessRunning(pid);
}

async function confirmUninstall(install) {
  if (!process.stdin.isTTY || !process.stdout.isTTY) {
    throw new Error("Refusing to uninstall without --yes in a non-interactive terminal.");
  }

  console.log("AgentOS release uninstall");
  console.log(`Package: ${install.packagePath}`);

  if (install.launcherPath) {
    console.log(`Launcher: ${install.launcherPath}`);
  } else {
    console.log(`Launcher: not detected on PATH`);
  }

  const readline = createInterface({
    input: process.stdin,
    output: process.stdout
  });

  try {
    const answer = await readline.question("Remove these files? [y/N] ");
    return /^y(es)?$/i.test(answer.trim());
  } finally {
    readline.close();
  }
}

async function removePathIfExists(targetPath) {
  const { rm } = await import("node:fs/promises");

  if (!existsSync(targetPath)) {
    return false;
  }

  await rm(targetPath, {
    recursive: true,
    force: true
  });

  return true;
}

async function removeDirectoryIfEmpty(targetPath) {
  const { readdir, rmdir } = await import("node:fs/promises");

  if (!existsSync(targetPath)) {
    return;
  }

  const entries = await readdir(targetPath);

  if (entries.length === 0) {
    await rmdir(targetPath);
  }
}
