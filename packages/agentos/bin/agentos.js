#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
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
const updateCacheDir = path.join(runtimeInstallRoot, "cache");
const updateCachePath = path.join(updateCacheDir, "update-check.json");
const stopPollIntervalMs = 100;
const stopTimeoutMs = 5_000;
const startupGracePeriodMs = 15_000;
const updateCacheTtlMs = 24 * 60 * 60 * 1000;
const updateWarningCooldownMs = 24 * 60 * 60 * 1000;
const updateRequestTimeoutMs = 5_000;

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

  if (firstArg === "update") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      printUpdateHelp();
      return;
    }

    await runUpdate(args.slice(1));
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
  const url = createAgentOsUrl(options.host, options.port);
  const existingServer = await detectExistingServer(options, trackedState, runtimeStatePath);

  if (existingServer) {
    if (options.open) {
      if (!browserOpener.available) {
        console.warn(
          `Browser auto-open is unavailable on this machine${browserOpener.detail ? ` (${browserOpener.detail})` : ""}.`
        );
        console.log(`AgentOS is already running on ${existingServer.url} (PID ${existingServer.pid}).`);
        return;
      }

      console.log(`AgentOS is already running on ${existingServer.url} (PID ${existingServer.pid}). Opening it...`);
      openBrowser(existingServer.url, browserOpener);
      return;
    }

    throw new Error(
      `AgentOS is already running on port ${options.port} (PID ${existingServer.pid}). Use "agentos stop --port ${options.port}" first.`
    );
  }

  if (trackedState) {
    clearRuntimeState(runtimeStatePath);
  }

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

  schedulePassiveUpdateNotice();

  let cleanedUp = false;
  const shutdownState = {
    forceTimer: null,
    parentSignal: null
  };
  const cleanup = () => {
    if (cleanedUp) {
      return;
    }

    cleanedUp = true;
    if (shutdownState.forceTimer) {
      clearTimeout(shutdownState.forceTimer);
    }
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);
    process.off("SIGQUIT", forwardSignal);
    clearRuntimeState(runtimeStatePath, child.pid);
  };

  const forwardSignal = (signal) => {
    if (shutdownState.parentSignal) {
      if (sendSignalToChild(child, "SIGKILL")) {
        console.warn("Force stopping AgentOS...");
      }
      return;
    }

    shutdownState.parentSignal = signal;

    if (signal === "SIGINT") {
      process.stdout.write("\nStopping AgentOS... Press Ctrl+C again to force quit.\n");
    } else {
      console.log(`Stopping AgentOS after ${signal}...`);
    }

    sendSignalToChild(child, "SIGTERM");
    shutdownState.forceTimer = setTimeout(() => {
      if (sendSignalToChild(child, "SIGKILL")) {
        console.warn("AgentOS did not stop in time. Sending SIGKILL...");
      }
    }, stopTimeoutMs);
    shutdownState.forceTimer.unref?.();
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

    if (shutdownState.parentSignal) {
      process.kill(process.pid, shutdownState.parentSignal);
      return;
    }

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

async function runUpdate(rawArgs) {
  const options = parseUpdateArgs(rawArgs);
  const install = inspectInstallation();

  if (install.kind === "package-manager") {
    if (options.check) {
      const status = await getUpdateStatus({
        install,
        forceRefresh: true,
        timeoutMs: updateRequestTimeoutMs,
        fallbackToCache: false
      });

      if (!status.ok) {
        console.error(status.errorMessage);
        process.exitCode = 1;
        return;
      }

      printUpdateStatus(status, {
        includeInstallInstructions: true
      });
      process.exitCode = status.updateAvailable ? 1 : 0;
      return;
    }

    printPackageManagerUpdateGuidance();
    return;
  }

  if (install.kind === "source") {
    console.log("This AgentOS copy looks like a source checkout, not a release installation.");
    console.log(`Update it with git pull from: ${findRepoRoot()}`);
    return;
  }

  const status = await getUpdateStatus({
    install,
    forceRefresh: true,
    timeoutMs: updateRequestTimeoutMs,
    fallbackToCache: false
  });

  if (!status.ok) {
    console.error(status.errorMessage);
    process.exitCode = 1;
    return;
  }

  if (options.check) {
    printUpdateStatus(status, {
      includeInstallInstructions: true
    });
    process.exitCode = status.updateAvailable ? 1 : 0;
    return;
  }

  if (!status.updateAvailable) {
    console.log(`AgentOS is already up to date (${status.currentVersion}).`);
    return;
  }

  await installReleaseUpdate(status);
  clearUpdateCache();
  console.log(`Updated AgentOS to ${status.latestVersion}. Restart AgentOS to use the new version.`);
}

async function runStop(rawArgs) {
  const options = parseStopArgs(rawArgs);
  const runtimeStatePath = resolveRuntimeStatePath(options.port);
  const trackedState = readRuntimeState(runtimeStatePath);
  const listeningPid = findListeningPidForPort(options.port);
  const trackedPid =
    trackedState?.pid && isProcessRunning(trackedState.pid) && getStartupWaitMs(trackedState) > 0 ? trackedState.pid : null;
  const targetPid = listeningPid ?? trackedPid;

  if (!targetPid) {
    if (trackedState) {
      clearRuntimeState(runtimeStatePath);
      console.log(`Cleared stale AgentOS runtime state for port ${options.port}. No process is listening on that port.`);
      return;
    }

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
    if (!findListeningPidForPort(options.port)) {
      clearRuntimeState(runtimeStatePath);
      console.log(`Cleared stale AgentOS runtime state for port ${options.port}. No process is listening on that port.`);
      return;
    }

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

function parseUpdateArgs(rawArgs) {
  const options = {
    check: false
  };

  for (const arg of rawArgs) {
    if (arg === "--check") {
      options.check = true;
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

function schedulePassiveUpdateNotice() {
  const install = inspectInstallation();

  if (install.kind === "source") {
    return;
  }

  const cachedStatus = readCachedUpdateStatus(install);
  const normalizedCachedStatus = cachedStatus ? buildUpdateStatusFromCache(cachedStatus, install) : null;

  if (normalizedCachedStatus?.updateAvailable && shouldNotifyCachedUpdate(normalizedCachedStatus)) {
    printPassiveUpdateWarning(normalizedCachedStatus);
    markUpdateNotified(normalizedCachedStatus);
    return;
  }

  if (cachedStatus && isUpdateCacheFresh(cachedStatus)) {
    return;
  }

  void getUpdateStatus({
    install,
    forceRefresh: true,
    timeoutMs: 2_500,
    fallbackToCache: true
  })
    .then((status) => {
      if (!status.ok || !status.updateAvailable || !shouldNotifyCachedUpdate(status)) {
        return;
      }

      printPassiveUpdateWarning(status);
      markUpdateNotified(status);
    })
    .catch(() => {});
}

async function detectExistingServer(options, trackedState, runtimeStatePath) {
  const listeningPid = findListeningPidForPort(options.port);

  if (listeningPid) {
    const host = trackedState?.host || options.host;
    syncRuntimeState(runtimeStatePath, trackedState, {
      pid: listeningPid,
      port: options.port,
      host
    });

    return {
      pid: listeningPid,
      url: createAgentOsUrl(host, options.port)
    };
  }

  if (!trackedState?.pid || !isProcessRunning(trackedState.pid)) {
    return null;
  }

  const waitMs = getStartupWaitMs(trackedState);

  if (waitMs > 0) {
    const readyPid = await waitForListeningPid(options.port, waitMs);

    if (readyPid) {
      const host = trackedState.host || options.host;
      syncRuntimeState(runtimeStatePath, trackedState, {
        pid: readyPid,
        port: options.port,
        host
      });

      return {
        pid: readyPid,
        url: createAgentOsUrl(host, options.port)
      };
    }
  }

  return null;
}

function ensureBundleExists() {
  if (!existsSync(bundledServerPath)) {
    throw new Error(
      "AgentOS bundle is missing. Reinstall the package or rebuild it before publishing."
    );
  }
}

function createAgentOsUrl(host, port) {
  return `http://${displayHost(host)}:${port}`;
}

function displayHost(host) {
  return host === "0.0.0.0" ? "127.0.0.1" : host;
}

function printHelp() {
  console.log(`AgentOS Mission Control

Usage:
  agentos
  agentos start --port 3000 --host 127.0.0.1 --open
  agentos update [--check]
  agentos stop --port 3000 [--force]
  agentos doctor
  agentos uninstall [--yes]
  agentos --version

Options:
  start: --port, -p   Port to bind the local server (default: 3000)
  start: --host, -H   Host to bind the local server (default: 127.0.0.1)
  start: --open, -o   Open AgentOS in the default browser after startup or reuse an existing instance
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

function printUpdateStatus(status, options = {}) {
  if (status.updateAvailable) {
    console.log(`Update available: ${status.currentVersion} -> ${status.latestVersion}.`);

    if (options.includeInstallInstructions) {
      if (status.install.kind === "release") {
        console.log('Run "agentos update" to install it.');
      } else if (status.install.kind === "package-manager") {
        printPackageManagerUpdateGuidance();
      }
    }

    return;
  }

  console.log(`AgentOS is already up to date (${status.currentVersion}).`);
}

function printPassiveUpdateWarning(status) {
  if (status.install.kind === "package-manager") {
    console.warn(`Update available: ${status.currentVersion} -> ${status.latestVersion}.`);
    printPackageManagerUpdateGuidance();
    return;
  }

  console.warn(`Update available: ${status.currentVersion} -> ${status.latestVersion}. Run "agentos update".`);
}

function printPackageManagerUpdateGuidance() {
  console.log("This AgentOS install appears to come from a package manager.");
  console.log("Update it with one of:");
  console.log("  pnpm add -g @sapienx/agentos@latest");
  console.log("  npm install -g @sapienx/agentos@latest");
}

function printUpdateHelp() {
  console.log(`Update AgentOS.

Usage:
  agentos update
  agentos update --check

Options:
  --check   Check for a newer version without installing it

Notes:
  - Release installs can update themselves with this command.
  - Package manager installs are redirected to pnpm or npm.
`);
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

function shouldNotifyCachedUpdate(status) {
  if (status.latestVersion !== status.cachedNotifiedVersion) {
    return true;
  }

  if (!status.cachedNotifiedAt) {
    return true;
  }

  return Date.now() - Date.parse(status.cachedNotifiedAt) >= updateWarningCooldownMs;
}

function isUpdateCacheFresh(status) {
  if (!status.cachedCheckedAt) {
    return false;
  }

  const checkedAtMs = Date.parse(status.cachedCheckedAt);

  if (!Number.isFinite(checkedAtMs)) {
    return false;
  }

  return Date.now() - checkedAtMs < updateCacheTtlMs;
}

function markUpdateNotified(status) {
  writeUpdateCache({
    ...status,
    cachedNotifiedVersion: status.latestVersion,
    cachedNotifiedAt: new Date().toISOString()
  });
}

function clearUpdateCache() {
  rmSync(updateCachePath, {
    force: true
  });
}

function readCachedUpdateStatus(install) {
  if (!existsSync(updateCachePath)) {
    return null;
  }

  try {
    const payload = JSON.parse(readFileSync(updateCachePath, "utf8"));

    if (!payload || typeof payload !== "object") {
      return null;
    }

    if (
      payload.installKind !== install.kind ||
      payload.currentVersion !== packageJson.version ||
      payload.sourceId !== getUpdateSourceId(install)
    ) {
      return null;
    }

    return payload;
  } catch {
    return null;
  }
}

function writeUpdateCache(payload) {
  mkdirSync(updateCacheDir, {
    recursive: true
  });

  writeFileSync(updateCachePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

async function getUpdateStatus({ install, forceRefresh, timeoutMs, fallbackToCache }) {
  try {
    const cache = readCachedUpdateStatus(install);

    if (!forceRefresh && cache && isUpdateCacheFresh(cache)) {
      return buildUpdateStatusFromCache(cache, install);
    }

    const latestVersionInfo = await fetchLatestVersionInfo(install, timeoutMs);
    const updateAvailable = compareVersions(latestVersionInfo.latestVersion, packageJson.version) > 0;
    const status = {
      ok: true,
      install,
      installKind: install.kind,
      currentVersion: packageJson.version,
      latestVersion: latestVersionInfo.latestVersion,
      downloadBaseUrl: latestVersionInfo.downloadBaseUrl || null,
      updateAvailable,
      sourceId: getUpdateSourceId(install),
      cachedCheckedAt: new Date().toISOString(),
      cachedNotifiedVersion: cache?.cachedNotifiedVersion || null,
      cachedNotifiedAt: cache?.cachedNotifiedAt || null
    };

    writeUpdateCache(status);
    return status;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const cache = readCachedUpdateStatus(install);

    if (fallbackToCache && cache) {
      return {
        ...buildUpdateStatusFromCache(cache, install),
        ok: true
      };
    }

    return {
      ok: false,
      errorMessage: `Unable to check for updates: ${message}`
    };
  }
}

function buildUpdateStatusFromCache(cache, install) {
  const updateAvailable = compareVersions(cache.latestVersion, packageJson.version) > 0;

  return {
    ok: true,
    install,
    currentVersion: packageJson.version,
    latestVersion: cache.latestVersion,
    downloadBaseUrl: cache.downloadBaseUrl || null,
    installKind: install.kind,
    updateAvailable,
    sourceId: getUpdateSourceId(install),
    cachedCheckedAt: cache.cachedCheckedAt || null,
    cachedNotifiedVersion: cache.cachedNotifiedVersion || null,
    cachedNotifiedAt: cache.cachedNotifiedAt || null
  };
}

function getUpdateSourceId(install) {
  if (install.kind === "release") {
    return `github:${process.env.AGENTOS_REPO || "SapienXai/AgentOS"}`;
  }

  if (install.kind === "package-manager") {
    return `npm:${packageJson.name}`;
  }

  return "source";
}

async function fetchLatestVersionInfo(install, timeoutMs) {
  if (install.kind === "release") {
    return fetchGitHubLatestVersion(timeoutMs);
  }

  if (install.kind === "package-manager") {
    return fetchNpmLatestVersion(timeoutMs);
  }

  throw new Error("Update checks are not supported for source checkouts.");
}

async function fetchGitHubLatestVersion(timeoutMs) {
  const repo = process.env.AGENTOS_REPO || "SapienXai/AgentOS";
  const response = await fetchJsonWithTimeout(`https://api.github.com/repos/${repo}/releases/latest`, timeoutMs, {
    headers: {
      Accept: "application/vnd.github+json",
      "User-Agent": "AgentOS"
    }
  });

  const tagName = typeof response.tag_name === "string" ? response.tag_name : "";
  const latestVersion = normalizeVersion(tagName);

  if (!latestVersion) {
    throw new Error("GitHub release metadata did not include a valid version.");
  }

  return {
    latestVersion,
    downloadBaseUrl: `https://github.com/${repo}/releases/download/agentos-v${latestVersion}`
  };
}

async function fetchNpmLatestVersion(timeoutMs) {
  const response = await fetchJsonWithTimeout(`https://registry.npmjs.org/${encodeURIComponent(packageJson.name)}/latest`, timeoutMs, {
    headers: {
      Accept: "application/json",
      "User-Agent": "AgentOS"
    }
  });

  const latestVersion = normalizeVersion(response.version);

  if (!latestVersion) {
    throw new Error("npm registry metadata did not include a valid version.");
  }

  return {
    latestVersion,
    downloadBaseUrl: null
  };
}

async function fetchJsonWithTimeout(url, timeoutMs, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => {
    controller.abort();
  }, timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal
    });

    if (!response.ok) {
      throw new Error(`Request failed with status ${response.status}.`);
    }

    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeVersion(value) {
  if (!value || typeof value !== "string") {
    return null;
  }

  const match = value.trim().match(/(?:agentos-v|v)?(\d+)\.(\d+)\.(\d+)/i);

  if (!match) {
    return null;
  }

  return `${Number(match[1])}.${Number(match[2])}.${Number(match[3])}`;
}

function compareVersions(a, b) {
  const left = parseVersion(a);
  const right = parseVersion(b);

  if (!left || !right) {
    return 0;
  }

  if (left.major !== right.major) {
    return left.major - right.major;
  }

  if (left.minor !== right.minor) {
    return left.minor - right.minor;
  }

  return left.patch - right.patch;
}

function parseVersion(value) {
  const normalized = normalizeVersion(value);

  if (!normalized) {
    return null;
  }

  const parts = normalized.split(".").map(Number);

  return {
    major: parts[0],
    minor: parts[1],
    patch: parts[2]
  };
}

async function installReleaseUpdate(status) {
  const installRoot = path.dirname(packageRoot);
  const artifactName = `agentos-${getAssetPlatform()}-${getAssetArch()}.tgz`;
  const checksumName = `${artifactName}.sha256`;
  const tempDir = mkdtempSync(path.join(os.tmpdir(), "agentos-update-"));

  try {
    const artifactPath = path.join(tempDir, artifactName);
    const checksumPath = path.join(tempDir, checksumName);
    const stageDir = path.join(tempDir, "stage");

    await downloadFileToPath(`${status.downloadBaseUrl}/${artifactName}`, artifactPath);

    try {
      await downloadFileToPath(`${status.downloadBaseUrl}/${checksumName}`, checksumPath);
      verifyChecksumFile(checksumPath, artifactPath);
    } catch {
      console.warn("No checksum file found; skipping SHA-256 verification.");
    }

    mkdirSync(stageDir, {
      recursive: true
    });

    const extractResult = spawnSync("tar", ["-xzf", artifactPath, "-C", stageDir], {
      encoding: "utf8"
    });

    if (extractResult.error || extractResult.status !== 0) {
      throw new Error(`Failed to extract update archive: ${extractResult.stderr || extractResult.error?.message || "tar failed"}`);
    }

    const stagedPackagePath = path.join(stageDir, "package");

    if (!existsSync(stagedPackagePath)) {
      throw new Error("Update archive did not contain a package directory.");
    }

    const backupPackagePath = `${packageRoot}.previous-${Date.now()}`;

    renameSync(packageRoot, backupPackagePath);

    try {
      renameSync(stagedPackagePath, packageRoot);
    } catch (error) {
      renameSync(backupPackagePath, packageRoot);
      throw error;
    }

    rmSync(backupPackagePath, {
      recursive: true,
      force: true
    });
  } finally {
    rmSync(tempDir, {
      recursive: true,
      force: true
    });
  }
}

function verifyChecksumFile(checksumPath, artifactPath) {
  const checksumLine = readFileSync(checksumPath, "utf8").trim();

  if (!checksumLine) {
    throw new Error(`Checksum file is empty: ${checksumPath}`);
  }

  const parts = checksumLine.split(/\s+/);
  const expectedHash = parts[0];
  const expectedName = parts[parts.length - 1];
  const actualName = path.basename(artifactPath);

  if (expectedName !== actualName) {
    throw new Error(`Checksum file does not match ${actualName}.`);
  }

  const actualHash = createHash("sha256").update(readFileSync(artifactPath)).digest("hex");

  if (actualHash.toLowerCase() !== expectedHash.toLowerCase()) {
    throw new Error(`SHA-256 verification failed for ${artifactPath}.`);
  }
}

async function downloadFileToPath(url, targetPath) {
  const response = await fetch(url, {
    headers: {
      "User-Agent": "AgentOS"
    }
  });

  if (!response.ok) {
    throw new Error(`Download failed with status ${response.status}.`);
  }

  const arrayBuffer = await response.arrayBuffer();
  writeFileSync(targetPath, Buffer.from(arrayBuffer));
}

function getAssetPlatform() {
  if (process.platform === "darwin") {
    return "darwin";
  }

  if (process.platform === "win32") {
    return "win32";
  }

  return "linux";
}

function getAssetArch() {
  if (process.arch === "arm64") {
    return "arm64";
  }

  return "x64";
}

function sendSignalToChild(child, signal) {
  if (!isChildProcessActive(child)) {
    return false;
  }

  try {
    child.kill(signal);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
      return false;
    }

    throw error;
  }
}

function isChildProcessActive(child) {
  return Boolean(child.pid) && child.exitCode === null && child.signalCode === null;
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
  const launcherNames =
    process.platform === "win32" ? ["agentos.cmd", "agentos.ps1", "agentos"] : ["agentos"];
  const candidates = new Set([
    resolveCommandPath("agentos"),
    ...launcherNames.map((name) => path.join(defaultBinDir, name))
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

function syncRuntimeState(runtimeStatePath, trackedState, payload) {
  if (
    trackedState?.pid === payload.pid &&
    trackedState.port === payload.port &&
    trackedState.host === payload.host
  ) {
    return;
  }

  try {
    writeRuntimeState(runtimeStatePath, {
      ...payload,
      startedAt: trackedState?.startedAt || new Date().toISOString()
    });
  } catch {
    // Port discovery still lets stop/find logic work even if the state file cannot be refreshed.
  }
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

function getStartupWaitMs(trackedState) {
  if (!trackedState?.startedAt) {
    return 0;
  }

  const startedAtMs = Date.parse(trackedState.startedAt);

  if (!Number.isFinite(startedAtMs)) {
    return 0;
  }

  return Math.max(0, startupGracePeriodMs - (Date.now() - startedAtMs));
}

async function waitForListeningPid(port, timeoutMs) {
  if (timeoutMs <= 0) {
    return findListeningPidForPort(port);
  }

  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const pid = findListeningPidForPort(port);

    if (pid) {
      return pid;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, stopPollIntervalMs);
    });
  }

  return findListeningPidForPort(port);
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
