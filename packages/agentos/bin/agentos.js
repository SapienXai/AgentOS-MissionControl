#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, rmdirSync, writeFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { createTerminalBoot, renderDoctorReport, renderStatusDashboard } from "./terminal-boot.js";
import { isSupportedAgentOsNodeVersion } from "./node-runtime.js";

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
const apiTokenPath = path.join(runtimeInstallRoot, "api-token");
const instanceProtectionPath = path.join(runtimeInstallRoot, "instance-protection.json");
const agentOsUserStorePath = path.join(runtimeInstallRoot, "agentos-users.json");
const updateCacheDir = path.join(runtimeInstallRoot, "cache");
const updateCachePath = path.join(updateCacheDir, "update-check.json");
const stopPollIntervalMs = 100;
const stopTimeoutMs = 5_000;
const startupGracePeriodMs = 15_000;
const updateCacheTtlMs = 24 * 60 * 60 * 1000;
const updateWarningCooldownMs = 24 * 60 * 60 * 1000;
const updateRequestTimeoutMs = 5_000;
const openClawGatewayProbeTimeoutMs = 3_000;
const cliSmokeTestMode = process.env.AGENTOS_CLI_TEST === "1";
const requiredOpenClawGatewayProtocolVersion = 4;
const requiredOpenClawGatewayMethods = [
  "health",
  "status",
  "models.list",
  "models.authStatus",
  "agents.list",
  "agents.create",
  "agents.update",
  "agents.delete",
  "sessions.list",
  "chat.send",
  "config.get",
  "config.schema",
  "config.schema.lookup",
  "config.patch",
  "config.apply",
  "channels.status",
  "logs.tail"
];
const requiredOpenClawOperatorScopes = [
  "operator.admin",
  "operator.read",
  "operator.write",
  "operator.approvals",
  "operator.pairing",
  "operator.talk.secrets"
];
const bundleRuntimeEnvFiles = [
  ".env",
  ".env.local",
  ".env.development",
  ".env.development.local",
  ".env.production",
  ".env.production.local",
  ".env.test",
  ".env.test.local"
];

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
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      printDoctorHelp();
      return;
    }

    await runDoctor(args.slice(1));
    return;
  }

  if (firstArg === "status") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help") {
      printStatusHelp();
      return;
    }

    runStatus(args.slice(1));
    return;
  }

  if (firstArg === "auth") {
    if (args[1] === "--help" || args[1] === "-h" || args[1] === "help" || !args[1]) {
      printAuthHelp();
      return;
    }
    if (args[1] === "reset" && args.length === 2) {
      resetInstanceProtection();
      return;
    }
    throw new Error(`Unknown auth command: ${args.slice(1).join(" ")}`);
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

  if (firstArg === "start" || firstArg === "dev") {
    await startServer(args.slice(1));
    return;
  }

  await startServer(args);
}

async function startServer(rawArgs) {
  ensureBundleExists();
  removeBundleRuntimeEnvFiles();

  const options = parseStartArgs(rawArgs);
  const runtimeStatePath = resolveRuntimeStatePath(options.port);
  const trackedState = readRuntimeState(runtimeStatePath);
  const openClawCheck = detectOpenClaw();
  const browserOpener = detectBrowserOpener();
  const apiToken = ensureAgentOsApiToken();
  const url = createAgentOsUrl(options.host, options.port);
  const authUrl = createAgentOsAuthUrl(url, apiToken);
  const existingServer = await detectExistingServer(options, trackedState, runtimeStatePath);

  if (existingServer) {
    if (options.open) {
      if (!browserOpener.available) {
        console.warn(
          `Browser auto-open is unavailable on this machine${browserOpener.detail ? ` (${browserOpener.detail})` : ""}.`
        );
        console.log(`AgentOS is already running on ${existingServer.url} (PID ${existingServer.pid}).`);
        console.log(`Open AgentOS: ${createAgentOsAuthUrl(existingServer.url, apiToken)}`);
        return;
      }

      console.log(`AgentOS is already running on ${existingServer.url} (PID ${existingServer.pid}). Opening it...`);
      openBrowser(createAgentOsAuthUrl(existingServer.url, apiToken), browserOpener);
      return;
    }

    throw new Error(
      `AgentOS is already running on port ${options.port} (PID ${existingServer.pid}). Use "agentos stop --port ${options.port}" first.`
    );
  }

  if (trackedState) {
    clearRuntimeState(runtimeStatePath);
  }

  const boot = createTerminalBoot({
    plain: options.plain,
    stdout: process.stdout,
    stderr: process.stderr,
    env: process.env
  });

  if (boot.isPlain()) {
    console.log(`Starting AgentOS ${packageJson.version} on ${url}`);

    if (!openClawCheck.available) {
      console.log("OpenClaw was not found in PATH or the default local install paths. AgentOS will start and guide onboarding in the UI.");
    } else if (openClawCheck.version) {
      console.log(`OpenClaw detected: ${openClawCheck.version}`);
    }
  } else {
    initializeBootVersionStatus(boot);
    boot.start();
    boot.updateStatus("workspaceEngine", "loading", "bundle ready");
    applyOpenClawBootStatus(boot, openClawCheck);
  }

  if (options.open && !browserOpener.available) {
    const message = `Browser auto-open is unavailable on this machine${browserOpener.detail ? ` (${browserOpener.detail})` : ""}.`;
    if (boot.isPlain()) {
      console.warn(message);
    } else {
      boot.warn(message);
    }
  }

  const child = spawn(process.execPath, [bundledServerPath], {
    cwd: bundleDir,
    stdio: ["inherit", "pipe", "pipe"],
    env: {
      ...process.env,
      PORT: String(options.port),
      HOSTNAME: options.host,
      AGENTOS_PACKAGE_RUNTIME: "1",
      AGENTOS_RUNTIME_DIR: runtimeInstallRoot,
      AGENTOS_API_TOKEN: apiToken,
      AGENTOS_BUNDLE_DIR: bundleDir
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

  if (!boot.isPlain()) {
    boot.updateStatus("workspaceEngine", "ready", "runtime state written");
    boot.updateStatus("agentRuntime", "starting", `pid ${child.pid}`);
  }

  const startupState = {
    ready: false,
    completing: false,
    completed: boot.isPlain(),
    bufferedLogs: []
  };
  const browserState = { opened: false };
  const onServerReady = () => {
    if (startupState.ready) {
      return;
    }

    startupState.ready = true;

    if (options.open && browserOpener.available && !browserState.opened) {
      browserState.opened = true;
      openBrowser(authUrl, browserOpener);
    }

    if (boot.isPlain()) {
      if (!browserState.opened) {
        console.log(`Open AgentOS: ${authUrl}`);
      }
      return;
    }

    startupState.completing = true;
    void completeBootAfterServerReady(boot, startupState, url, authUrl, apiToken);
  };
  const relayStdout = createRelay(process.stdout, boot, startupState, onServerReady);
  const relayStderr = createRelay(process.stderr, boot, startupState, onServerReady);

  child.stdout.on("data", relayStdout);
  child.stderr.on("data", relayStderr);

  if (boot.isPlain()) {
    schedulePassiveUpdateNotice();
  }

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
      boot.stop({ clear: true });
      flushBufferedStartupLogs(startupState);
      process.stdout.write("\nStopping AgentOS... Press Ctrl+C again to force quit.\n");
    } else {
      boot.stop({ clear: true });
      flushBufferedStartupLogs(startupState);
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
    boot.stop({ clear: true });
    flushBufferedStartupLogs(startupState);
    console.error(`AgentOS failed to start: ${error.message}`);
    process.exit(1);
  });

  child.on("exit", (code, signal) => {
    cleanup();

    if (!startupState.completed) {
      boot.stop({ clear: true });
      flushBufferedStartupLogs(startupState);
    }

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

async function runDoctor(rawArgs) {
  const doctorOptions = parseDoctorArgs(rawArgs);
  const options = parseStartArgs(doctorOptions.startArgs);
  const apiToken = readAgentOsApiToken();
  const openClawCheck = detectOpenClaw();
  const gatewayStatus = openClawCheck.available ? inspectOpenClawGatewayStatus(openClawCheck) : null;
  const browserOpener = detectBrowserOpener();
  const targetUrl = `http://${displayHost(options.host)}:${options.port}`;
  const compatibility = doctorOptions.deep && openClawCheck.available
    ? await inspectOpenClawCompatibility(openClawCheck, gatewayStatus, targetUrl, apiToken)
    : [];
  const checks = [
    {
      state: "ok",
      label: "Package",
      detail: `${packageJson.name}@${packageJson.version}`
    },
    {
      state: "ok",
      label: "Install",
      detail: formatInstallKind(inspectInstallation())
    },
    {
      state: isSupportedNodeVersion(process.versions.node) ? "ok" : "failed",
      label: "Node.js",
      detail: `${process.version} (required 24.16.0+ or 26.1.0+)`
    },
    {
      state: "ok",
      label: "Platform",
      detail: `${os.platform()} ${os.release()}`
    },
    {
      state: existsSync(bundledServerPath) ? "ok" : "failed",
      label: "Bundle",
      detail: existsSync(bundledServerPath)
        ? `ready at ${bundledServerPath}`
        : `missing at ${bundledServerPath}`
    },
    {
      state: "ok",
      label: "Target URL",
      detail: targetUrl
    },
    {
      state: "ok",
      label: "Configured env",
      detail: formatConfiguredEnv(options)
    },
    {
      state: openClawCheck.available ? "ok" : "warning",
      label: "OpenClaw",
      detail: openClawCheck.available
        ? `${openClawCheck.version || "installed"}${openClawCheck.path ? ` at ${openClawCheck.path}` : ""}`
        : "not found in PATH or default local install paths; install OpenClaw or continue with the AgentOS onboarding flow"
    },
    {
      state: !openClawCheck.available ? "disabled" : gatewayStatus?.ok ? "ok" : "warning",
      label: "Gateway",
      detail: !openClawCheck.available
        ? "OpenClaw is required before Gateway RPC can be checked"
        : gatewayStatus?.gatewayMessage || "Gateway status unavailable"
    },
    ...compatibility,
    {
      state: browserOpener.available ? "ok" : "warning",
      label: "Browser opener",
      detail: browserOpener.available
        ? `${browserOpener.command} is available`
        : browserOpener.detail || "no supported browser opener detected"
    }
  ];

  if (doctorOptions.json) {
    console.log(JSON.stringify({
      title: "AGENTOS DOCTOR",
      generatedAt: new Date().toISOString(),
      deep: doctorOptions.deep,
      targetUrl,
      checks: checks.map((check) => ({
        label: check.label,
        state: check.state,
        detail: check.detail
      }))
    }, null, 2));
  } else {
    console.log(renderDoctorReport({
      title: "AGENTOS DOCTOR",
      rows: checks.map((check) => ({
        label: check.label,
        state: check.state,
        message: check.detail
      })),
      footer: "Doctor shows install and runtime diagnostics. The in-app diagnostics panel has live Gateway/model detail."
    }));
  }

  if (checks.some((check) => check.state === "failed")) {
    process.exitCode = 1;
  }
}

function parseDoctorArgs(rawArgs) {
  const startArgs = [];
  let deep = false;
  let json = false;

  for (const arg of rawArgs) {
    if (arg === "--deep") {
      deep = true;
      continue;
    }

    if (arg === "--json") {
      json = true;
      continue;
    }

    startArgs.push(arg);
  }

  return {
    deep,
    json,
    startArgs
  };
}

function runStatus(rawArgs) {
  const options = parseStatusArgs(rawArgs);
  const runtimeStatePath = resolveRuntimeStatePath(options.port);
  const trackedState = readRuntimeState(runtimeStatePath);
  const listeningPid = findListeningPidForPort(options.port);
  const trackedPid = trackedState?.pid && isProcessRunning(trackedState.pid) ? trackedState.pid : null;
  const runningPid = listeningPid ?? trackedPid;
  const host = trackedState?.host || options.host;
  const url = createAgentOsUrl(host, options.port);
  const openClawCheck = detectOpenClaw();
  const gatewayStatus = openClawCheck.available ? inspectOpenClawGatewayStatus(openClawCheck) : null;
  const bundleReady = existsSync(bundledServerPath);
  const install = inspectInstallation();
  const rows = [
    {
      label: "AgentOS",
      state: "ready",
      message: packageJson.version
    },
    buildUpdateDashboardRow(install),
    {
      label: "OpenClaw Gateway",
      state: !openClawCheck.available ? "warning" : gatewayStatus?.ok ? "connected" : "degraded",
      message: !openClawCheck.available
        ? "OpenClaw not found; setup will guide installation"
        : gatewayStatus?.gatewayMessage || "needs attention"
    },
    {
      label: "Native Gateway",
      state: !openClawCheck.available ? "disabled" : gatewayStatus?.nativeState || "warning",
      message: !openClawCheck.available
        ? "waiting for OpenClaw"
        : gatewayStatus?.nativeMessage || "check Gateway diagnostics"
    },
    {
      label: "Workspace Engine",
      state: bundleReady ? "ready" : "failed",
      message: bundleReady ? "bundle ready" : "bundle missing"
    },
    {
      label: "Agent Runtime",
      state: runningPid ? "ready" : "inactive",
      message: runningPid ? `server running (PID ${runningPid})` : "server not running"
    },
    {
      label: "Models",
      state: runningPid ? "warning" : "pending",
      message: runningPid ? "verify in setup or diagnostics" : "available after server start"
    },
    {
      label: "Channels",
      state: "disabled",
      message: "no channel status loaded from CLI"
    },
    {
      label: "Local Server",
      state: runningPid ? "ready" : "pending",
      message: url
    }
  ];

  console.log(renderStatusDashboard({
    title: "SYSTEM CHECK",
    rows,
    finalInfo: runningPid ? url : "",
    footer: runningPid ? "" : "AgentOS is not running. Start it with agentos start --open."
  }));

  if (!bundleReady) {
    process.exitCode = 1;
  }
}

function removeBundleRuntimeEnvFiles() {
  for (const fileName of bundleRuntimeEnvFiles) {
    rmSync(path.join(bundleDir, fileName), { force: true });
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

function applyOpenClawBootStatus(boot, openClawCheck) {
  if (!openClawCheck.available) {
    boot.updateStatus("openclawGateway", "warning", "OpenClaw not found; onboarding will guide setup");
    boot.updateStatus("nativeGateway", "disabled", "waiting for OpenClaw");
    return;
  }

  boot.updateStatus("openclawGateway", "checking", openClawCheck.version || "OpenClaw detected");
  boot.updateStatus("nativeGateway", "waiting", "probing gateway");

  const gatewayStatus = inspectOpenClawGatewayStatus(openClawCheck);

  if (gatewayStatus.ok) {
    boot.updateStatus("openclawGateway", "connected", gatewayStatus.gatewayMessage);
    boot.updateStatus("nativeGateway", gatewayStatus.nativeState, gatewayStatus.nativeMessage);
    return;
  }

  boot.updateStatus("openclawGateway", "warning", gatewayStatus.gatewayMessage);
  boot.updateStatus("nativeGateway", "disabled", gatewayStatus.nativeMessage);
}

function initializeBootVersionStatus(boot) {
  boot.updateStatus("agentosVersion", "ready", packageJson.version);

  const install = inspectInstallation();
  const cached = readCachedUpdateStatus(install);

  if (install.kind === "source") {
    boot.updateStatus("update", "disabled", "source checkout");
    return;
  }

  if (cached) {
    updateBootUpdateStatus(boot, buildUpdateStatusFromCache(cached, install));
  } else {
    boot.updateStatus("update", "checking", "checking latest version");
  }

  if (cached && isUpdateCacheFresh(cached)) {
    return;
  }

  void getUpdateStatus({
    install,
    forceRefresh: false,
    timeoutMs: 1_500,
    fallbackToCache: true
  })
    .then((status) => {
      if (!status.ok) {
        boot.updateStatus("update", "disabled", "check unavailable");
        return;
      }

      updateBootUpdateStatus(boot, status);
    })
    .catch(() => {
      boot.updateStatus("update", "disabled", "check unavailable");
    });
}

function updateBootUpdateStatus(boot, status) {
  const row = buildUpdateRowFromStatus(status);
  boot.updateStatus("update", row.state, row.message);
}

function buildUpdateDashboardRow(install) {
  if (install.kind === "source") {
    return {
      label: "Update",
      state: "disabled",
      message: "source checkout"
    };
  }

  const cached = readCachedUpdateStatus(install);

  if (!cached) {
    return {
      label: "Update",
      state: "pending",
      message: 'run "agentos update --check"'
    };
  }

  return {
    label: "Update",
    ...buildUpdateRowFromStatus(buildUpdateStatusFromCache(cached, install))
  };
}

function buildUpdateRowFromStatus(status) {
  if (status.updateAvailable) {
    return {
      state: "warning",
      message: `${status.latestVersion} available · ${formatBootUpdateAction(status.install)}`
    };
  }

  return {
    state: "ready",
    message: "up to date"
  };
}

function formatBootUpdateAction(install) {
  if (install.kind === "release") {
    return "run agentos update";
  }

  if (install.kind === "package-manager") {
    return "update package";
  }

  return 'run "agentos update --check"';
}

function inspectOpenClawGatewayStatus(openClawCheck) {
  const command = openClawCheck.path || "openclaw";
  const result = spawnSync(command, ["gateway", "status", "--json"], {
    encoding: "utf8",
    timeout: openClawGatewayProbeTimeoutMs
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();

  if (result.error) {
    return {
      ok: false,
      gatewayMessage: result.error.code === "ETIMEDOUT" ? "gateway probe timed out" : "gateway status unavailable",
      nativeMessage: "Gateway will be checked in the UI",
      nativeState: "disabled"
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      gatewayMessage: summarizeBootText(output) || "gateway not reachable yet",
      nativeMessage: "start or repair OpenClaw Gateway in setup",
      nativeState: "disabled"
    };
  }

  const parsed = parseFirstJsonObject(output);
  const capability = String(parsed?.capability || parsed?.Capability || "");
  const connected = /connected|ok|reachable/i.test(output);
  const missingOperatorScope = /no-operator-scope|operator scope/i.test(capability || output);

  return {
    ok: true,
    payload: parsed,
    gatewayMessage: connected ? "reachable" : "status available",
    nativeState: missingOperatorScope ? "warning" : "active",
    nativeMessage: missingOperatorScope ? "operator scope needs repair" : "native RPC available"
  };
}

async function inspectOpenClawCompatibility(openClawCheck, gatewayStatus, targetUrl, apiToken = null) {
  const command = openClawCheck.path || "openclaw";
  const statusProbe = runOpenClawGatewayCall(command, "status");
  const healthProbe = runOpenClawGatewayCall(command, "health");
  const modelsProbe = runOpenClawGatewayCall(command, "models.list");
  const modelAuthProbe = runOpenClawGatewayCall(command, "models.authStatus");
  const configProbe = runOpenClawGatewayCall(command, "config.get");
  const configSchemaProbe = runOpenClawGatewayCall(command, "config.schema");
  const channelProbe = runOpenClawGatewayCall(command, "channels.status");
  const agentOsDiagnostics = await readAgentOsDiagnostics(targetUrl, apiToken);
  const payloads = [
    gatewayStatus?.payload,
    statusProbe.payload,
    healthProbe.payload
  ].filter(Boolean);
  const protocolVersion = readFirstProtocolVersion(payloads);
  const supportedMethods = readSupportedMethods(payloads);
  const scopes = readAuthScopes(payloads);
  const missingMethods = supportedMethods.length > 0
    ? requiredOpenClawGatewayMethods.filter((method) => !supportedMethods.includes(method))
    : [];
  const missingScopes = scopes.length > 0
    ? requiredOpenClawOperatorScopes.filter((scope) => !scopes.includes(scope))
    : [];
  const transport = isRecord(agentOsDiagnostics.payload?.diagnostics?.transport)
    ? agentOsDiagnostics.payload.diagnostics.transport
    : null;
  const fallbackTotal = Number.isFinite(transport?.fallbackTotal) ? Number(transport.fallbackTotal) : null;
  const lastNativeFailure = typeof transport?.lastNativeError === "string" && transport.lastNativeError.trim()
    ? summarizeBootText(transport.lastNativeError)
    : null;
  const modelReadiness = summarizeModelReadiness(agentOsDiagnostics, modelsProbe, modelAuthProbe);
  const configPatchMethod = resolveConfigPatchMethod(supportedMethods);

  return [
    {
      state: resolveProtocolState(protocolVersion),
      label: "Gateway protocol",
      detail: protocolVersion
        ? `v${protocolVersion} (required v${requiredOpenClawGatewayProtocolVersion})`
        : summarizeProbeFailure(statusProbe, gatewayStatus?.gatewayMessage || "protocol metadata unavailable")
    },
    {
      state: supportedMethods.length === 0 ? "warning" : missingMethods.length === 0 ? "ok" : "warning",
      label: "Required methods",
      detail: supportedMethods.length === 0
        ? "method metadata unavailable; compatibility is unknown"
        : missingMethods.length === 0
          ? `${requiredOpenClawGatewayMethods.length} required methods advertised`
          : `missing ${missingMethods.slice(0, 5).join(", ")}${missingMethods.length > 5 ? ` +${missingMethods.length - 5}` : ""}`
    },
    {
      state: scopes.length === 0 ? "warning" : missingScopes.length === 0 ? "ok" : "warning",
      label: "Gateway scopes",
      detail: scopes.length === 0
        ? summarizeProbeFailure(statusProbe, "scope metadata unavailable")
        : missingScopes.length === 0
          ? "operator scopes approved"
          : `missing ${missingScopes.join(", ")}`
    },
    {
      state: gatewayStatus?.nativeState === "active" ? "ok" : gatewayStatus?.nativeState === "warning" ? "warning" : "disabled",
      label: "Native auth",
      detail: gatewayStatus?.nativeMessage || "native Gateway auth metadata unavailable"
    },
    {
      state: modelReadiness.state,
      label: "Model readiness",
      detail: modelReadiness.detail
    },
    {
      state: configProbe.ok ? "ok" : "warning",
      label: "Config access",
      detail: configProbe.ok ? "config.get readable" : configProbe.message
    },
    {
      state: configSchemaProbe.ok ? "ok" : "warning",
      label: "Config schema",
      detail: configSchemaProbe.ok ? "config.schema readable" : configSchemaProbe.message
    },
    {
      state: supportedMethods.length === 0 ? "warning" : configPatchMethod ? "ok" : "warning",
      label: "Config patch",
      detail: supportedMethods.length === 0
        ? "method metadata unavailable; config patch support is unknown"
        : configPatchMethod
          ? `${configPatchMethod} advertised; doctor does not mutate config`
          : "config.patch/config.apply not advertised"
    },
    {
      state: channelProbe.ok ? "ok" : "warning",
      label: "Channel status",
      detail: channelProbe.ok ? "channels.status readable" : channelProbe.message
    },
    {
      state: agentOsDiagnostics.ok && fallbackTotal !== null ? "ok" : agentOsDiagnostics.ok ? "warning" : "disabled",
      label: "Fallback count",
      detail: agentOsDiagnostics.ok
        ? fallbackTotal !== null
          ? `${fallbackTotal} Gateway fallback${fallbackTotal === 1 ? "" : "s"} recorded`
          : "transport fallback metadata unavailable"
        : agentOsDiagnostics.message
    },
    {
      state: agentOsDiagnostics.ok ? lastNativeFailure ? "warning" : "ok" : "disabled",
      label: "Last native failure",
      detail: agentOsDiagnostics.ok
        ? lastNativeFailure || "none recorded"
        : "available when AgentOS is running"
    }
  ];
}

function summarizeModelReadiness(agentOsDiagnostics, modelsProbe, modelAuthProbe) {
  const readiness = isRecord(agentOsDiagnostics.payload?.diagnostics?.modelReadiness)
    ? agentOsDiagnostics.payload.diagnostics.modelReadiness
    : null;

  if (readiness) {
    const availableModelCount = numberOrZero(readiness.availableModelCount);
    const defaultModel =
      readString(readiness.resolvedDefaultModel) ||
      readString(readiness.defaultModel) ||
      readString(readiness.recommendedModelId);
    const ready = readiness.ready === true || readiness.defaultModelReady === true || availableModelCount > 0;
    const issues = Array.isArray(readiness.issues) ? readiness.issues.map(readString).filter(Boolean) : [];

    return {
      state: ready ? "ok" : "warning",
      detail: ready
        ? `${availableModelCount} available model${availableModelCount === 1 ? "" : "s"}${defaultModel ? `; default ${defaultModel}` : ""}`
        : issues[0] || "model readiness is incomplete"
    };
  }

  if (modelsProbe.ok) {
    return {
      state: "ok",
      detail: modelAuthProbe.ok ? "models.list and models.authStatus readable" : "models.list readable; auth status unavailable"
    };
  }

  if (agentOsDiagnostics.ok) {
    return {
      state: "warning",
      detail: "model readiness metadata unavailable"
    };
  }

  return {
    state: "disabled",
    detail: "available when AgentOS is running or models.list is readable"
  };
}

function runOpenClawGatewayCall(command, method, params = {}) {
  const result = spawnSync(command, ["gateway", "call", method, "--params", JSON.stringify(params), "--json"], {
    encoding: "utf8",
    timeout: openClawGatewayProbeTimeoutMs
  });
  const output = `${result.stdout || ""}\n${result.stderr || ""}`.trim();

  if (result.error) {
    return {
      ok: false,
      payload: null,
      message: result.error.code === "ETIMEDOUT" ? `${method} probe timed out` : `${method} probe unavailable`
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      payload: null,
      message: summarizeBootText(output) || `${method} probe failed`
    };
  }

  return {
    ok: true,
    payload: parseFirstJsonObject(output),
    message: "ok"
  };
}

async function readAgentOsDiagnostics(targetUrl, apiToken = null) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 800);

  try {
    const response = await fetch(`${targetUrl}/api/diagnostics`, {
      headers: apiToken ? { authorization: `Bearer ${apiToken}` } : undefined,
      signal: controller.signal
    });

    if (!response.ok) {
      return {
        ok: false,
        payload: null,
        message: `AgentOS diagnostics returned HTTP ${response.status}`
      };
    }

    return {
      ok: true,
      payload: await response.json(),
      message: "ok"
    };
  } catch {
    return {
      ok: false,
      payload: null,
      message: "available when AgentOS is running"
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function completeBootAfterServerReady(boot, startupState, url, authUrl, apiToken) {
  boot.updateStatus("agentRuntime", "ready", "server ready");
  boot.updateStatus("localServerUrl", "ready", url);
  boot.updateStatus("models", "loading", "checking readiness");
  boot.updateStatus("channels", "loading", "checking registry");

  const readiness = await readStartupReadiness(url, apiToken);

  if (readiness.openClawGateway) {
    boot.updateStatus("openclawGateway", readiness.openClawGateway.state, readiness.openClawGateway.message);
  }

  if (readiness.nativeGateway) {
    boot.updateStatus("nativeGateway", readiness.nativeGateway.state, readiness.nativeGateway.message);
  }

  boot.updateStatus("workspaceEngine", readiness.workspaceEngine.state, readiness.workspaceEngine.message);
  boot.updateStatus("models", readiness.models.state, readiness.models.message);
  boot.updateStatus("channels", readiness.channels.state, readiness.channels.message);
  boot.complete(authUrl);
  startupState.bufferedLogs = [];
  startupState.completed = true;
}

async function readStartupReadiness(url, apiToken = null) {
  const fallback = {
    workspaceEngine: { state: "ready", message: "available" },
    models: { state: "warning", message: "finish setup in the UI" },
    channels: { state: "disabled", message: "none confirmed yet" }
  };
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 2_500);

  try {
    const response = await fetch(`${url}/api/snapshot`, {
      headers: apiToken ? { authorization: `Bearer ${apiToken}` } : undefined,
      signal: controller.signal
    });

    if (!response.ok) {
      return fallback;
    }

    const snapshot = await response.json();
    return summarizeStartupSnapshot(snapshot);
  } catch {
    return fallback;
  } finally {
    clearTimeout(timeout);
  }
}

function summarizeStartupSnapshot(snapshot) {
  const diagnostics = isRecord(snapshot?.diagnostics) ? snapshot.diagnostics : {};
  const modelReadiness = isRecord(diagnostics.modelReadiness) ? diagnostics.modelReadiness : {};
  const transport = isRecord(diagnostics.transport) ? diagnostics.transport : {};
  const workspaces = Array.isArray(snapshot?.workspaces) ? snapshot.workspaces : [];
  const channelAccounts = Array.isArray(snapshot?.channelAccounts) ? snapshot.channelAccounts : [];
  const channelRegistry = isRecord(snapshot?.channelRegistry) && Array.isArray(snapshot.channelRegistry.channels)
    ? snapshot.channelRegistry.channels
    : [];
  const rpcOk = diagnostics.rpcOk === true;
  const modelReady = modelReadiness.ready === true || modelReadiness.defaultModelReady === true;
  const availableModelCount = numberOrZero(modelReadiness.availableModelCount);
  const modelIssues = Array.isArray(modelReadiness.issues) ? modelReadiness.issues.filter(Boolean) : [];
  const enabledChannels = channelAccounts.filter((channel) => channel && channel.enabled !== false).length + channelRegistry.length;
  const transportStatus = typeof transport.gatewayMode === "string"
    ? transport.gatewayMode
    : typeof transport.statusLabel === "string"
      ? transport.statusLabel
      : "";

  return {
    openClawGateway: {
      state: rpcOk ? "connected" : "warning",
      message: rpcOk ? "authenticated RPC ready" : summarizeBootText(diagnostics.health) || "setup may be required"
    },
    nativeGateway: {
      state: rpcOk ? "active" : "warning",
      message: transportStatus || (rpcOk ? "native Gateway active" : "check diagnostics")
    },
    workspaceEngine: {
      state: "ready",
      message: workspaces.length > 0 ? `${workspaces.length} workspace${workspaces.length === 1 ? "" : "s"}` : "ready for first workspace"
    },
    models: {
      state: modelReady || availableModelCount > 0 ? "ready" : "warning",
      message: modelReady
        ? modelReadiness.resolvedDefaultModel || modelReadiness.defaultModel || "default model ready"
        : modelIssues[0] || "model setup needed"
    },
    channels: {
      state: enabledChannels > 0 ? "ready" : "disabled",
      message: enabledChannels > 0 ? `${enabledChannels} configured` : "no channels configured"
    }
  };
}

function flushBufferedStartupLogs(startupState) {
  if (!startupState?.bufferedLogs?.length) {
    return;
  }

  for (const entry of startupState.bufferedLogs) {
    entry.target.write(entry.text);
  }

  startupState.bufferedLogs = [];
}

function parseFirstJsonObject(value) {
  if (!value) {
    return null;
  }

  const start = value.indexOf("{");
  const end = value.lastIndexOf("}");

  if (start < 0 || end <= start) {
    return null;
  }

  try {
    return JSON.parse(value.slice(start, end + 1));
  } catch {
    return null;
  }
}

function summarizeBootText(value) {
  if (typeof value !== "string") {
    return "";
  }

  return redactDiagnosticText(value).replace(/\s+/g, " ").trim().slice(0, 96);
}

function redactDiagnosticText(value) {
  return value
    .replace(/([?&](?:token|password|secret|api[_-]?key)=)[^&\s]+/gi, "$1[redacted]")
    .replace(/(authorization:\s*bearer\s+)[^\s]+/gi, "$1[redacted]")
    .replace(/\b(token|password|secret|api[_-]?key)\s*[:=]\s*"?[^"\s,}]+/gi, "$1=[redacted]");
}

function numberOrZero(value) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isRecord(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function resolveProtocolState(protocolVersion) {
  if (!protocolVersion) {
    return "warning";
  }

  return Number(protocolVersion) === requiredOpenClawGatewayProtocolVersion ? "ok" : "warning";
}

function summarizeProbeFailure(probe, fallback) {
  return probe?.ok ? fallback : probe?.message || fallback;
}

function resolveConfigPatchMethod(supportedMethods) {
  return ["config.patch", "config.apply", "config.set"].find((method) => supportedMethods.includes(method)) || null;
}

function readFirstProtocolVersion(payloads) {
  for (const payload of payloads) {
    const value =
      readProperty(payload, "protocolVersion") ??
      readProperty(payload, "protocol") ??
      readProperty(readProperty(payload, "gateway"), "protocolVersion") ??
      readProperty(readProperty(payload, "rpc"), "protocolVersion") ??
      readProperty(readProperty(payload, "rpc"), "protocol");

    const normalized = readStringOrNumber(value);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function readSupportedMethods(payloads) {
  const methods = new Set();

  for (const payload of payloads) {
    for (const method of [
      ...readStringArray(readProperty(payload, "methods")),
      ...readStringArray(readProperty(payload, "supportedMethods")),
      ...readStringArray(readProperty(readProperty(payload, "rpc"), "methods")),
      ...readStringArray(readProperty(readProperty(payload, "features"), "methods")),
      ...readMethodObjects(readProperty(payload, "methods")),
      ...readMethodObjects(readProperty(readProperty(payload, "rpc"), "methods"))
    ]) {
      methods.add(method);
    }
  }

  return Array.from(methods).sort();
}

function readAuthScopes(payloads) {
  const scopes = new Set();

  for (const payload of payloads) {
    for (const scope of [
      ...readStringArray(readProperty(payload, "scopes")),
      ...readStringArray(readProperty(readProperty(payload, "auth"), "scopes")),
      ...readStringArray(readProperty(readProperty(payload, "security"), "scopes")),
      ...readStringArray(readProperty(readProperty(readProperty(payload, "rpc"), "auth"), "scopes"))
    ]) {
      scopes.add(scope);
    }
  }

  return Array.from(scopes).sort();
}

function readMethodObjects(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => readString(readProperty(entry, "name")) || readString(readProperty(entry, "method")))
    .filter(Boolean);
}

function readStringArray(value) {
  if (!Array.isArray(value)) {
    return [];
  }

  return value.map(readString).filter(Boolean);
}

function readString(value) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function readStringOrNumber(value) {
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }

  return readString(value);
}

function readProperty(value, key) {
  return isRecord(value) ? value[key] : undefined;
}

function parseStartArgs(rawArgs) {
  const envPort = process.env.AGENTOS_PORT || process.env.PORT;
  const options = {
    host: process.env.AGENTOS_HOST || "127.0.0.1",
    port: envPort && /^\d+$/.test(envPort) ? Number(envPort) : 3000,
    open: parseBooleanEnv(process.env.AGENTOS_OPEN),
    plain: false
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

    if (arg === "--plain") {
      options.plain = true;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function parseStatusArgs(rawArgs) {
  const envPort = process.env.AGENTOS_PORT || process.env.PORT;
  const options = {
    host: process.env.AGENTOS_HOST || "127.0.0.1",
    port: envPort && /^\d+$/.test(envPort) ? Number(envPort) : 3000
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
  const candidates = getOpenClawCommandCandidates();
  let lastPath = null;

  for (const candidate of candidates) {
    const result = spawnSync(candidate, ["--version"], {
      encoding: "utf8"
    });

    lastPath = candidate;

    if (!result.error && result.status === 0) {
      return {
        available: true,
        version: result.stdout.trim() || result.stderr.trim() || null,
        path: candidate
      };
    }
  }

  return {
    available: false,
    version: null,
    path: lastPath || resolveCommandPath("openclaw")
  };
}

function getOpenClawCommandCandidates() {
  const executableName = process.platform === "win32" ? "openclaw.cmd" : "openclaw";
  const explicitBin = (process.env.OPENCLAW_BIN || process.env.AGENTOS_OPENCLAW_BIN || "").trim();
  const pathBin = resolveCommandPath("openclaw");
  const candidates = [
    explicitBin,
    path.join(os.homedir(), ".openclaw", "tools", "node", "bin", executableName),
    path.join(os.homedir(), ".openclaw", "bin", executableName),
    path.join(os.homedir(), ".local", "bin", executableName),
    pathBin,
    "openclaw"
  ];

  return Array.from(new Set(candidates.filter(Boolean)));
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

function createAgentOsAuthUrl(url, apiToken) {
  if (!apiToken) {
    return url;
  }

  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.hash ? parsed.hash.slice(1) : "");
  params.set("agentos_token", apiToken);
  parsed.hash = params.toString();

  return parsed.toString();
}

function displayHost(host) {
  if (host === "0.0.0.0" || host === "127.0.0.1" || host === "::1" || host === "[::1]") {
    return "localhost";
  }

  return host;
}

function printHelp() {
  console.log(`AgentOS

Usage:
  agentos
  agentos start --port 3000 --host 127.0.0.1 --open
  agentos dev --plain
  agentos status
  agentos auth reset
  agentos update [--check]
  agentos stop --port 3000 [--force]
  agentos doctor
  agentos doctor --deep
  agentos uninstall [--yes]
  agentos --version

Options:
  start: --port, -p   Port to bind the local server (default: 3000)
  start: --host, -H   Host to bind the local server (default: 127.0.0.1)
  start: --open, -o   Open AgentOS in the default browser after startup or reuse an existing instance
  start: --no-open    Disable browser auto-open even if AGENTOS_OPEN is set
  start: --plain      Disable the AgentOS boot splash and live startup UI
  status: --port, -p  Port to inspect (default: 3000)
  status: --host, -H  Host to display when no runtime state exists (default: 127.0.0.1)
  stop:  --port, -p   Port to stop (default: 3000)
  stop:  --force, -f  Send SIGKILL if SIGTERM does not stop the server
`);
}

function printAuthHelp() {
  console.log(`Manage local AgentOS Instance Protection.

Usage:
  agentos auth reset

Commands:
  reset   Remove Instance Protection credentials and invalidate all browser sessions.

Notes:
  This does not modify workspaces, agents, tasks, integrations, or OpenClaw data.
`);
}

function resetInstanceProtection() {
  const existed = existsSync(instanceProtectionPath) || existsSync(agentOsUserStorePath);
  rmSync(instanceProtectionPath, { force: true });
  rmSync(agentOsUserStorePath, { force: true });
  console.log(existed
    ? "AgentOS Instance Protection was reset. Credentials and account security state were removed, and all sessions were invalidated."
    : "AgentOS Instance Protection is already disabled. No other data was changed.");
}

function printDoctorHelp() {
  console.log(`Show AgentOS install and OpenClaw runtime diagnostics.

Usage:
  agentos doctor
  agentos doctor --deep
  agentos doctor --deep --json
  agentos doctor --deep --port 3000 --host 127.0.0.1

Options:
  --deep       Run read-only OpenClaw compatibility probes for Gateway protocol, native auth, scopes,
               required methods, config access, config schema/patch capability, channel status,
               model readiness, fallback count, and last native failure.
  --json       Print diagnostics as JSON.
  --port, -p   AgentOS port used when reading /api/diagnostics in deep mode (default: 3000)
  --host, -H   AgentOS host used when reading /api/diagnostics in deep mode (default: 127.0.0.1)

Notes:
  Scope approval warnings mean OpenClaw has not approved the operator scopes needed for deep read-only probes.
  When AgentOS is running, /api/diagnostics adds live fallback, native failure, and model readiness detail.
`);
}

function printStatusHelp() {
  console.log(`Show the local AgentOS runtime dashboard.

Usage:
  agentos status
  agentos status --port 3000 --host 127.0.0.1

Options:
  --port, -p   Port to inspect (default: 3000)
  --host, -H   Host to display when no runtime state exists (default: 127.0.0.1)
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

function createRelay(target, boot, startupState, onServerReady) {
  return (chunk) => {
    const text = chunk.toString();
    const ready = isServerReadyOutput(text);

    if (ready) {
      onServerReady();
    }

    if (boot.isPlain() || startupState.completed) {
      target.write(text);
      return;
    }

    startupState.bufferedLogs.push({
      target,
      text
    });

    if (target === process.stderr) {
      boot.warn(text);
    } else if (isImportantStartupLog(text)) {
      boot.log(text);
    }
  };
}

function isServerReadyOutput(text) {
  return text.includes("Ready in") || text.includes("Local:");
}

function isImportantStartupLog(text) {
  return /\b(warn|warning|error|failed|exception|EADDRINUSE|EACCES)\b/i.test(text);
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
  writeUpdateCacheBestEffort({
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

function writeUpdateCacheBestEffort(payload) {
  try {
    writeUpdateCache(payload);
  } catch {
    // Update availability should not disappear just because the cache is unavailable.
  }
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

    writeUpdateCacheBestEffort(status);
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
  const testOverride = readSmokeTestLatestVersionOverride(install);

  if (testOverride) {
    return testOverride;
  }

  if (install.kind === "release") {
    return fetchGitHubLatestVersion(timeoutMs);
  }

  if (install.kind === "package-manager") {
    return fetchNpmLatestVersion(timeoutMs);
  }

  throw new Error("Update checks are not supported for source checkouts.");
}

function readSmokeTestLatestVersionOverride(install) {
  if (!cliSmokeTestMode) {
    return null;
  }

  const latestVersion = normalizeVersion(process.env.AGENTOS_TEST_LATEST_VERSION);

  if (!latestVersion) {
    return null;
  }

  return {
    latestVersion,
    downloadBaseUrl:
      install.kind === "release"
        ? `https://github.com/${process.env.AGENTOS_REPO || "SapienXai/AgentOS"}/releases/download/agentos-v${latestVersion}`
        : null
  };
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
  try {
    return await fetchNpmLatestVersionFromRegistry(timeoutMs);
  } catch (error) {
    const fallback = fetchNpmLatestVersionWithPackageManager(timeoutMs);

    if (fallback.ok) {
      return {
        latestVersion: fallback.latestVersion,
        downloadBaseUrl: null
      };
    }

    throw new Error(
      `npm registry fetch failed (${formatErrorMessage(error)}); package manager fallback failed (${fallback.errorMessage})`
    );
  }
}

async function fetchNpmLatestVersionFromRegistry(timeoutMs) {
  if (cliSmokeTestMode && parseBooleanEnv(process.env.AGENTOS_TEST_FORCE_NPM_FETCH_FAILURE)) {
    throw new Error("forced npm registry fetch failure");
  }

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

function fetchNpmLatestVersionWithPackageManager(timeoutMs) {
  const command = resolvePackageManagerViewCommand();

  if (!command) {
    return {
      ok: false,
      errorMessage: "npm or pnpm was not found on PATH"
    };
  }

  const result = spawnSync(command, ["view", packageJson.name, "version", "--json"], {
    encoding: "utf8",
    timeout: timeoutMs,
    env: {
      ...process.env,
      NO_UPDATE_NOTIFIER: "1",
      npm_config_audit: "false",
      npm_config_fund: "false",
      npm_config_loglevel: "silent",
      npm_config_progress: "false"
    }
  });

  if (result.error) {
    return {
      ok: false,
      errorMessage: result.error.message
    };
  }

  if (result.status !== 0) {
    return {
      ok: false,
      errorMessage: (result.stderr || result.stdout || `${path.basename(command)} exited with ${result.status}`).trim()
    };
  }

  const latestVersion = parsePackageManagerViewVersion(result.stdout);

  if (!latestVersion) {
    return {
      ok: false,
      errorMessage: "package manager metadata did not include a valid version"
    };
  }

  return {
    ok: true,
    latestVersion
  };
}

function resolvePackageManagerViewCommand() {
  return resolveCommandPath("npm") || resolveCommandPath("pnpm");
}

function parsePackageManagerViewVersion(output) {
  const trimmed = output.trim();

  if (!trimmed) {
    return null;
  }

  try {
    const parsed = JSON.parse(trimmed);

    if (typeof parsed === "string") {
      return normalizeVersion(parsed);
    }
  } catch {
    // Some package managers may ignore --json for simple scalar output.
  }

  return normalizeVersion(trimmed.split(/\r?\n/).find(Boolean) || "");
}

function formatErrorMessage(error) {
  return error instanceof Error ? error.message : String(error);
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
  return isSupportedAgentOsNodeVersion(version);
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

function formatInstallKind(install) {
  if (install.kind === "release") {
    return `release at ${install.installRoot}`;
  }

  if (install.kind === "package-manager") {
    return "package manager install";
  }

  return `source checkout at ${findRepoRoot()}`;
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
  writeFileSync(runtimeStatePath, `${JSON.stringify(payload, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  chmodSync(runtimeStatePath, 0o600);
}

function ensureAgentOsApiToken() {
  const existing = readAgentOsApiToken();
  if (existing) {
    return existing;
  }

  const token = randomBytes(32).toString("base64url");
  mkdirSync(runtimeInstallRoot, {
    recursive: true
  });
  writeFileSync(apiTokenPath, `${token}\n`, {
    encoding: "utf8",
    mode: 0o600
  });
  chmodSync(apiTokenPath, 0o600);

  return token;
}

function readAgentOsApiToken() {
  try {
    const token = readFileSync(apiTokenPath, "utf8").trim();
    return token || null;
  } catch {
    return null;
  }
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
