#!/usr/bin/env node

import { spawn, spawnSync } from "node:child_process";
import { existsSync } from "node:fs";
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

  if (firstArg === "start") {
    await startServer(args.slice(1));
    return;
  }

  await startServer(args);
}

async function startServer(rawArgs) {
  ensureBundleExists();

  const options = parseStartArgs(rawArgs);
  const openClawCheck = detectOpenClaw();
  const browserOpener = detectBrowserOpener();

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

  const browserState = { opened: false };
  const relayStdout = createRelay(process.stdout, options, url, browserOpener, browserState);
  const relayStderr = createRelay(process.stderr, options, url, browserOpener, browserState);

  child.stdout.on("data", relayStdout);
  child.stderr.on("data", relayStderr);

  const forwardSignal = (signal) => {
    if (!child.killed) {
      child.kill(signal);
    }
  };

  process.on("SIGINT", forwardSignal);
  process.on("SIGTERM", forwardSignal);

  child.on("exit", (code, signal) => {
    process.off("SIGINT", forwardSignal);
    process.off("SIGTERM", forwardSignal);

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
  agentos doctor
  agentos --version

Options:
  --port, -p   Port to bind the local server (default: 3000)
  --host, -H   Host to bind the local server (default: 127.0.0.1)
  --open, -o   Open AgentOS in the default browser after startup
  --no-open    Disable browser auto-open even if AGENTOS_OPEN is set
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
