import assert from "node:assert/strict";
import { spawn, spawnSync, type ChildProcessWithoutNullStreams } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { chmod, cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

import { OPENCLAW_RECOMMENDED_VERSION } from "@/lib/openclaw/versions";

const rootDir = process.cwd();
const realCliPath = path.join(rootDir, "packages", "agentos", "bin", "agentos.js");
const realNodeRuntimePath = path.join(rootDir, "packages", "agentos", "bin", "node-runtime.js");
const realTerminalBootPath = path.join(rootDir, "packages", "agentos", "bin", "terminal-boot.js");
const realPackageJsonPath = path.join(rootDir, "packages", "agentos", "package.json");
const packageJson = JSON.parse(readFileSync(realPackageJsonPath, "utf8")) as {
  name: string;
  version: string;
};

test("agentos --version prints the published package version", async () => {
  const fixture = await createCliFixture();
  const result = runCli(fixture.cliPath, ["--version"], {
    env: createSmokeEnv(fixture.installRoot)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout.trim(), packageJson.version);
});

test("agentos doctor prints deterministic package, install, node, platform, bundle, env, and OpenClaw diagnostics", async () => {
  const fixture = await createCliFixture();
  const result = runCli(fixture.cliPath, ["doctor"], {
    env: createSmokeEnv(fixture.installRoot)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /AGENTOS DOCTOR/);
  assert.match(result.stdout, new RegExp(`Package\\s+✓ OK\\s+${escapeRegExp(packageJson.name)}@${escapeRegExp(packageJson.version)}`));
  assert.match(result.stdout, /Install\s+✓ OK\s+source checkout/);
  assert.match(result.stdout, /Node\.js\s+✓ OK\s+v\d+\.\d+\.\d+ \(required 24\.16\.0\+ or 26\.1\.0\+\)/);
  assert.match(result.stdout, /Platform\s+✓ OK\s+/);
  assert.match(result.stdout, /Bundle\s+✓ OK\s+ready at /);
  assert.match(result.stdout, /Target URL\s+✓ OK\s+http:\/\/localhost:3000/);
  assert.match(result.stdout, /Configured env\s+✓ OK\s+AGENTOS_HOST=127\.0\.0\.1, AGENTOS_PORT=3000/);
  assert.match(result.stdout, /OpenClaw\s+⚠ WARNING\s+not found in PATH or default local instal/);
  assert.match(result.stdout, /Gateway\s+– DISABLED\s+OpenClaw is required before Gateway RPC/);
  assert.doesNotMatch(result.stdout, /Gateway protocol/);
  assert.doesNotMatch(result.stdout, /Required methods/);
  assert.doesNotMatch(result.stdout, /Model readiness/);
});

test("agentos doctor help documents deep compatibility probes", async () => {
  const fixture = await createCliFixture();
  const result = runCli(fixture.cliPath, ["doctor", "--help"], {
    env: createSmokeEnv(fixture.installRoot)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /agentos doctor --deep/);
  assert.match(result.stdout, /Scope approval warnings/);
});

test("agentos doctor detects an explicit OpenClaw binary outside PATH", async () => {
  const fixture = await createCliFixture();
  const fakeOpenClaw = await writeFakeOpenClawBinary(fixture.installRoot);
  const result = runCli(fixture.cliPath, ["doctor"], {
    env: {
      ...createSmokeEnv(fixture.installRoot),
      OPENCLAW_BIN: fakeOpenClaw
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(
    result.stdout,
    /OpenClaw\s+✓ OK\s+OpenClaw 0\.0\.0-test at /
  );
});

test("agentos doctor reports read-only OpenClaw Gateway compatibility details", async () => {
  const fixture = await createCliFixture();
  const fakeOpenClaw = await writeFakeOpenClawGatewayBinary(fixture.installRoot);
  const result = runCli(fixture.cliPath, ["doctor", "--deep"], {
    env: {
      ...createSmokeEnv(fixture.installRoot, { port: allocateSmokePort() }),
      OPENCLAW_BIN: fakeOpenClaw
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Gateway protocol\s+✓ OK\s+v4 \(required v4\)/);
  assert.match(result.stdout, /Required methods\s+✓ OK\s+17 required methods advertised/);
  assert.match(result.stdout, /Gateway scopes\s+✓ OK\s+operator scopes approved/);
  assert.match(result.stdout, /Native auth\s+✓ OK\s+native RPC available/);
  assert.match(result.stdout, /Model readiness\s+✓ OK\s+models\.list and models\.authStatus readable/);
  assert.match(result.stdout, /Config access\s+✓ OK\s+config\.get readable/);
  assert.match(result.stdout, /Config schema\s+✓ OK\s+config\.schema readable/);
  assert.match(result.stdout, /Config patch\s+✓ OK\s+config\.patch advertised/);
  assert.match(result.stdout, /Channel status\s+✓ OK\s+channels\.status readable/);
  assert.match(result.stdout, /Fallback count\s+– DISABLED\s+available when AgentOS is running/);
  assert.match(result.stdout, /Last native failure\s+– DISABLED\s+available when AgentOS is running/);
});

test("agentos doctor deep mode can print OpenClaw compatibility JSON", async () => {
  const fixture = await createCliFixture();
  const fakeOpenClaw = await writeFakeOpenClawGatewayBinary(fixture.installRoot);
  const result = runCli(fixture.cliPath, ["doctor", "--deep", "--json"], {
    env: {
      ...createSmokeEnv(fixture.installRoot, { port: allocateSmokePort() }),
      OPENCLAW_BIN: fakeOpenClaw
    }
  });

  assert.equal(result.status, 0, result.stderr);
  const parsed = JSON.parse(result.stdout) as {
    deep?: boolean;
    checks?: Array<{ label?: string; state?: string; detail?: string }>;
  };
  const checks = new Map((parsed.checks ?? []).map((check) => [check.label, check]));

  assert.equal(parsed.deep, true);
  assert.equal(checks.get("Gateway protocol")?.state, "ok");
  assert.equal(checks.get("Config schema")?.detail, "config.schema readable");
  assert.match(checks.get("Config patch")?.detail ?? "", /config\.patch advertised/);
});

test("agentos doctor warns when Gateway required method metadata is incomplete", async () => {
  const fixture = await createCliFixture();
  const fakeOpenClaw = await writeFakeOpenClawGatewayBinary(fixture.installRoot, {
    methods: ["health", "status"],
    scopes: ["operator.read"]
  });
  const result = runCli(fixture.cliPath, ["doctor", "--deep"], {
    env: {
      ...createSmokeEnv(fixture.installRoot, { port: allocateSmokePort() }),
      OPENCLAW_BIN: fakeOpenClaw
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Required methods\s+⚠ WARNING\s+missing models\.list/);
  assert.match(result.stdout, /Gateway scopes\s+⚠ WARNING\s+missing operator\.admin/);
});

test("agentos doctor redacts Gateway probe failure details", async () => {
  const fixture = await createCliFixture();
  const fakeOpenClaw = await writeFakeOpenClawGatewayBinary(fixture.installRoot, {
    configFailureMessage: "config.get failed token=plain-secret-token"
  });
  const result = runCli(fixture.cliPath, ["doctor", "--deep"], {
    env: {
      ...createSmokeEnv(fixture.installRoot, { port: allocateSmokePort() }),
      OPENCLAW_BIN: fakeOpenClaw
    }
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Config access\s+⚠ WARNING\s+config\.get failed token=\[redacted\]/);
  assert.doesNotMatch(result.stdout, /plain-secret-token/);
});

test("agentos status prints a concise branded runtime dashboard", async () => {
  const fixture = await createCliFixture();
  const result = runCli(fixture.cliPath, ["status"], {
    env: createSmokeEnv(fixture.installRoot)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /SYSTEM CHECK/);
  assert.match(result.stdout, new RegExp(`AgentOS\\s+✓ READY\\s+${escapeRegExp(packageJson.version)}`));
  assert.match(result.stdout, /Update\s+– DISABLED\s+source checkout/);
  assert.match(result.stdout, /OpenClaw Gateway\s+⚠ WARNING\s+OpenClaw not found/);
  assert.match(result.stdout, /Native Gateway\s+– DISABLED\s+waiting for OpenClaw/);
  assert.match(result.stdout, /Workspace Engine\s+✓ READY\s+bundle ready/);
  assert.match(result.stdout, /Agent Runtime\s+– INACTIVE\s+server not running/);
  assert.match(result.stdout, /Local Server\s+– PENDING\s+http:\/\/localhost:3000/);
});

test("agentos start and stop maintain runtime state without real OpenClaw", async () => {
  const fixture = await createCliFixture();
  const port = allocateSmokePort();
  const env = createSmokeEnv(fixture.installRoot);
  const statePath = path.join(fixture.installRoot, "run", `agentos-${port}.json`);
  let startProcess: ChildProcessWithoutNullStreams | null = null;

  try {
    startProcess = spawn(process.execPath, [
      fixture.cliPath,
      "start",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-open"
    ], { env });

    const output = collectProcessOutput(startProcess);
    const state = await waitForRuntimeState(statePath);

    assert.equal(state.port, port);
    assert.equal(state.host, "127.0.0.1");
    assert.equal(typeof state.pid, "number");
    await waitFor(() => new RegExp(`Starting AgentOS ${escapeRegExp(packageJson.version)} on http://localhost:${port}`).test(output()) ? true : null, 2_000);

    const stopResult = runCli(fixture.cliPath, ["stop", "--port", String(port)], { env });

    assert.equal(stopResult.status, 0, stopResult.stderr);
    assert.match(stopResult.stdout, new RegExp(`Stopped AgentOS on port ${port}|Cleared stale AgentOS runtime state for port ${port}`));
    await waitForProcessExit(startProcess);
    assert.equal(existsSync(statePath), false);
  } finally {
    if (startProcess && startProcess.exitCode === null && startProcess.signalCode === null) {
      startProcess.kill("SIGTERM");
      await waitForProcessExit(startProcess).catch(() => undefined);
    }
  }
});

test("agentos dev --plain starts with normal logs and no boot splash", async () => {
  const fixture = await createCliFixture();
  const port = allocateSmokePort();
  const env = createSmokeEnv(fixture.installRoot);
  let startProcess: ChildProcessWithoutNullStreams | null = null;

  try {
    startProcess = spawn(process.execPath, [
      fixture.cliPath,
      "dev",
      "--plain",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-open"
    ], { env });

    const output = collectProcessOutput(startProcess);
    await waitForRuntimeState(path.join(fixture.installRoot, "run", `agentos-${port}.json`));
    await waitFor(() => new RegExp(`Starting AgentOS ${escapeRegExp(packageJson.version)} on http://localhost:${port}`).test(output()) ? true : null, 2_000);
    await waitFor(() => /Ready in 1ms/.test(output()) ? true : null, 2_000);

    assert.doesNotMatch(output(), /█████╗/);
    assert.match(output(), /Ready in 1ms/);

    const stopResult = runCli(fixture.cliPath, ["stop", "--port", String(port)], { env });
    assert.equal(stopResult.status, 0, stopResult.stderr);
    await waitForProcessExit(startProcess);
  } finally {
    if (startProcess && startProcess.exitCode === null && startProcess.signalCode === null) {
      startProcess.kill("SIGTERM");
      await waitForProcessExit(startProcess).catch(() => undefined);
    }
  }
});

test("agentos start scrubs package runtime env files before launching the bundle", async () => {
  const fixture = await createCliFixture();
  const port = allocateSmokePort();
  const env = createSmokeEnv(fixture.installRoot);
  const bundledEnvPath = path.join(fixture.packageDir, "bundle", ".env.local");
  let startProcess: ChildProcessWithoutNullStreams | null = null;

  await writeFile(bundledEnvPath, "AGENTOS_OPENCLAW_GATEWAY_TOKEN=\"stale-token\"\n", "utf8");

  try {
    startProcess = spawn(process.execPath, [
      fixture.cliPath,
      "start",
      "--port",
      String(port),
      "--host",
      "127.0.0.1",
      "--no-open"
    ], { env });

    const output = collectProcessOutput(startProcess);
    await waitForRuntimeState(path.join(fixture.installRoot, "run", `agentos-${port}.json`));
    await waitFor(() => /Package runtime: 1/.test(output()) ? true : null, 2_000);

    assert.equal(existsSync(bundledEnvPath), false);
    assert.match(output(), new RegExp(`Runtime dir: ${escapeRegExp(fixture.installRoot)}`));

    const stopResult = runCli(fixture.cliPath, ["stop", "--port", String(port)], { env });
    assert.equal(stopResult.status, 0, stopResult.stderr);
    await waitForProcessExit(startProcess);
  } finally {
    if (startProcess && startProcess.exitCode === null && startProcess.signalCode === null) {
      startProcess.kill("SIGTERM");
      await waitForProcessExit(startProcess).catch(() => undefined);
    }
  }
});

test("terminal boot renders refined large, medium, compact, and complete frames", async () => {
  const terminalBoot = runTerminalBootEval(`{
    header: AGENTOS_BOOT_HEADER,
    medium: renderBootFrame({ columns: 72, color: false, unicode: true, frameIndex: 0 }),
    wideDefault: renderBootFrame({ columns: 100, color: false, unicode: true, frameIndex: 0 }),
    large: renderBootFrame({ columns: 140, color: false, unicode: true, frameIndex: 0 }),
    narrow: renderBootFrame({ columns: 32, color: false, unicode: true, frameIndex: 0 }),
    complete: renderBootFrame({ columns: 100, color: false, unicode: true, complete: true, finalInfo: "http://localhost:3000" }),
    coloredComplete: renderBootFrame({ columns: 100, color: true, unicode: true, complete: true, finalInfo: "http://localhost:3000" }),
    wideDefaultWidth: renderBootFrame({ columns: 100, color: false, unicode: true, frameIndex: 0 }).split("\\n").find((line) => line.includes("AGENTOS CONTROL ROOM")).length,
    largeWidth: renderBootFrame({ columns: 140, color: false, unicode: true, frameIndex: 0 }).split("\\n").find((line) => line.includes("AGENTOS CONTROL ROOM")).length
  }`) as { header: string; medium: string; wideDefault: string; large: string; narrow: string; complete: string; coloredComplete: string; wideDefaultWidth: number; largeWidth: number };
  const medium = terminalBoot.medium;
  const wideDefault = terminalBoot.wideDefault;
  const large = terminalBoot.large;
  const narrow = terminalBoot.narrow;
  const complete = terminalBoot.complete;

  assert.match(medium, /AGENTOS CONTROL ROOM/);
  assert.match(medium, /▄▀█ █▀▀ █▀▀ █▄░█ ▀█▀/);
  assert.match(medium, /Built on OpenClaw/);
  assert.match(medium, /Human operating layer for AI agents/);
  assert.match(medium, /AgentOS\s+✓ READY/);
  assert.match(medium, /Update\s+– PENDING/);
  assert.match(medium, /OpenClaw Gateway\s+… CHECKING/);
  assert.match(medium, /OpenClaw Gateway .* AgentOS Runtime .* Local UI/);
  assert.doesNotMatch(medium, /█████╗/);
  assert.match(wideDefault, /█████╗/);
  assert.match(large, /█████╗/);
  assert.equal(terminalBoot.wideDefaultWidth, 80);
  assert.equal(terminalBoot.largeWidth, 80);
  assert.ok(large.includes(terminalBoot.header.split("\n")[0]));
  assert.match(narrow, /AgentOS/);
  assert.match(narrow, /Built on OpenClaw/);
  assert.doesNotMatch(narrow, /█████╗/);
  assert.match(complete, /█████╗/);
  assert.match(complete, /OpenClaw Gateway\s+… CHECKING/);
  assert.match(complete, /AgentOS ready/);
  assert.match(complete, /Local UI:\s+http:\/\/localhost:3000/);
  assert.doesNotMatch(complete, /Workspace .* Agent .* Channel/);
  assert.match(terminalBoot.coloredComplete, /\u001B\[38;2;255;23;68m└/);
  assert.match(terminalBoot.coloredComplete, /\u001B\[38;2;255;90;109m├/);
  assert.doesNotMatch(terminalBoot.coloredComplete, /\u001B\[38;2;74;18;27m[└├]/);
});

test("terminal boot uses plain mode for CI and non-TTY while NO_COLOR disables color only", async () => {
  const terminalBoot = runTerminalBootEval(`{
    nonTtyPlain: shouldUsePlainBoot({ stdout: { isTTY: false }, stderr: { isTTY: true }, env: {} }),
    ciPlain: shouldUsePlainBoot({ stdout: { isTTY: true }, stderr: { isTTY: true }, env: { CI: "1" } }),
    noColor: supportsBootColor({ stdout: { isTTY: true }, env: { NO_COLOR: "1", TERM: "xterm-256color" } }),
    colored: renderBootFrame({ columns: 100, color: true, unicode: true }),
    plain: renderBootFrame({ columns: 100, color: false, unicode: true })
  }`) as { nonTtyPlain: boolean; ciPlain: boolean; noColor: boolean; colored: string; plain: string };
  const colored = terminalBoot.colored;
  const plain = terminalBoot.plain;

  assert.equal(terminalBoot.nonTtyPlain, true);
  assert.equal(terminalBoot.ciPlain, true);
  assert.equal(terminalBoot.noColor, false);
  assert.match(colored, /\u001B\[/);
  assert.doesNotMatch(plain, /\u001B\[/);
});

test("package-manager update --check prints package manager guidance without network", async () => {
  const fixture = await createCliFixture({
    packageDir: path.join(await mkdtemp(path.join(os.tmpdir(), "agentos-pm-fixture-")), "node_modules", "@sapienx", "agentos")
  });
  const result = runCli(fixture.cliPath, ["update", "--check"], {
    env: {
      ...createSmokeEnv(fixture.installRoot),
      AGENTOS_TEST_LATEST_VERSION: bumpPatchVersion(packageJson.version)
    }
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(result.stdout, /Update available:/);
  assert.match(result.stdout, /This AgentOS install appears to come from a package manager\./);
  assert.match(result.stdout, /pnpm add -g @sapienx\/agentos@latest/);
  assert.match(result.stdout, /npm install -g @sapienx\/agentos@latest/);
});

test("package-manager update --check falls back to package manager metadata when registry fetch fails", async () => {
  const fixture = await createCliFixture({
    packageDir: path.join(await mkdtemp(path.join(os.tmpdir(), "agentos-pm-fallback-")), "node_modules", "@sapienx", "agentos")
  });
  const fakeBinDir = path.join(fixture.installRoot, "fake-bin");
  const latestVersion = bumpPatchVersion(packageJson.version);

  await writeFakePackageManagerBinary(fakeBinDir, "npm", latestVersion);

  const result = runCli(fixture.cliPath, ["update", "--check"], {
    env: {
      ...createSmokeEnv(fixture.installRoot),
      AGENTOS_TEST_FORCE_NPM_FETCH_FAILURE: "1",
      PATH: `${fakeBinDir}${path.delimiter}${process.env.PATH || ""}`
    }
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`Update available: ${escapeRegExp(packageJson.version)} -> ${escapeRegExp(latestVersion)}\\.`)
  );
  assert.match(result.stdout, /This AgentOS install appears to come from a package manager\./);
});

test("package-manager update --check still reports when update cache cannot be written", async () => {
  const fixture = await createCliFixture({
    packageDir: path.join(await mkdtemp(path.join(os.tmpdir(), "agentos-pm-cache-")), "node_modules", "@sapienx", "agentos")
  });
  const latestVersion = bumpPatchVersion(packageJson.version);

  await writeFile(fixture.installRoot, "not a directory\n", "utf8");

  const result = runCli(fixture.cliPath, ["update", "--check"], {
    env: {
      ...createSmokeEnv(fixture.installRoot),
      AGENTOS_TEST_LATEST_VERSION: latestVersion
    }
  });

  assert.equal(result.status, 1, result.stderr);
  assert.match(
    result.stdout,
    new RegExp(`Update available: ${escapeRegExp(packageJson.version)} -> ${escapeRegExp(latestVersion)}\\.`)
  );
});

test("package-manager uninstall redirects to package manager commands", async () => {
  const fixture = await createCliFixture({
    packageDir: path.join(await mkdtemp(path.join(os.tmpdir(), "agentos-pm-uninstall-")), "node_modules", "@sapienx", "agentos")
  });
  const result = runCli(fixture.cliPath, ["uninstall", "--yes"], {
    env: createSmokeEnv(fixture.installRoot)
  });

  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /This AgentOS install appears to come from a package manager\./);
  assert.match(result.stdout, /pnpm remove -g @sapienx\/agentos/);
  assert.match(result.stdout, /npm uninstall -g @sapienx\/agentos/);
});

test("release installer scripts keep expected asset patterns and pass static sanity checks", () => {
  const installSh = readFileSync(path.join(rootDir, "install.sh"), "utf8");
  const installPs1 = readFileSync(path.join(rootDir, "install.ps1"), "utf8");

  if (process.platform !== "win32") {
    const shellCheck = spawnSync("sh", ["-n", path.join(rootDir, "install.sh")], {
      encoding: "utf8"
    });
    assert.equal(shellCheck.status, 0, shellCheck.stderr);
  }

  assert.match(installSh, /ARTIFACT_NAME="agentos-\$\{ASSET_PLATFORM\}-\$\{ASSET_ARCH\}\.tgz"/);
  assert.match(installSh, /RELEASE_PATH="latest\/download"/);
  assert.match(installSh, /RELEASE_PATH="download\/agentos-v\$\{REQUESTED_VERSION\}"/);
  assert.match(installSh, /CHECKSUM_NAME="\$\{ARTIFACT_NAME\}\.sha256"/);
  assert.match(installPs1, /\$assetPlatform = "win32"/);
  assert.match(installPs1, /\$artifactName = "agentos-\$assetPlatform-\$assetArch\.tgz"/);
  assert.match(installPs1, /\$releasePath = "latest\/download"/);
  assert.match(installPs1, /\$releasePath = "download\/agentos-v\$requestedVersion"/);
  assert.match(installPs1, /\$checksumUrl = "\$artifactUrl\.sha256"/);
});

async function createCliFixture(options: { packageDir?: string } = {}) {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-cli-smoke-"));
  const packageDir = options.packageDir ?? path.join(tempRoot, "agentos-source", "packages", "agentos");
  const installRoot = path.join(tempRoot, "install-root");
  const cliPath = path.join(packageDir, "bin", "agentos.js");

  await mkdir(path.join(packageDir, "bin"), { recursive: true });
  await mkdir(path.join(packageDir, "bundle"), { recursive: true });
  await cp(realCliPath, cliPath);
  await cp(realNodeRuntimePath, path.join(packageDir, "bin", "node-runtime.js"));
  await cp(realTerminalBootPath, path.join(packageDir, "bin", "terminal-boot.js"));
  await writeFile(path.join(packageDir, "package.json"), `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");
  await writeFile(path.join(packageDir, "bundle", "server.js"), renderStubServer(), "utf8");

  return {
    cliPath,
    installRoot,
    packageDir
  };
}

function runCli(
  cliPath: string,
  args: string[],
  options: {
    env: NodeJS.ProcessEnv;
  }
) {
  return spawnSync(process.execPath, [cliPath, ...args], {
    env: options.env,
    encoding: "utf8"
  });
}

function createSmokeEnv(installRoot: string, options: { port?: number } = {}): NodeJS.ProcessEnv {
  const port = options.port ?? 3000;

  return {
    ...process.env,
    AGENTOS_CLI_TEST: "1",
    AGENTOS_INSTALL_ROOT: installRoot,
    AGENTOS_HOST: "127.0.0.1",
    AGENTOS_PORT: String(port),
    AGENTOS_OPEN: "0",
    PATH: path.join(installRoot, "empty-bin")
  };
}

function renderStubServer() {
  return [
    'import http from "node:http";',
    'if (process.env.AGENTOS_CLI_TEST === "1") {',
    '  console.log("Ready in 1ms");',
    '  console.log(`Package runtime: ${process.env.AGENTOS_PACKAGE_RUNTIME || ""}`);',
    '  console.log(`Runtime dir: ${process.env.AGENTOS_RUNTIME_DIR || ""}`);',
    '  setInterval(() => {}, 1000);',
    '  process.on("SIGTERM", () => process.exit(0));',
    '  process.on("SIGINT", () => process.exit(0));',
    '} else {',
    'const host = process.env.HOSTNAME || "127.0.0.1";',
    "const port = Number(process.env.PORT || 3000);",
    'const server = http.createServer((_request, response) => { response.end("ok"); });',
    'server.listen(port, host, () => { console.log("Ready in 1ms"); });',
    'const shutdown = () => { server.close(() => process.exit(0)); };',
    'process.on("SIGTERM", shutdown);',
    'process.on("SIGINT", shutdown);',
    '}'
  ].join("\n");
}

async function writeFakeOpenClawBinary(installRoot: string) {
  const binDir = path.join(installRoot, "fake-openclaw");
  const binPath = path.join(binDir, process.platform === "win32" ? "openclaw.cmd" : "openclaw");

  await mkdir(binDir, { recursive: true });

  if (process.platform === "win32") {
    await writeFile(binPath, "@echo off\r\necho OpenClaw 0.0.0-test\r\n", "utf8");
    return binPath;
  }

  await writeFile(binPath, "#!/bin/sh\necho OpenClaw 0.0.0-test\n", "utf8");
  await chmod(binPath, 0o755);
  return binPath;
}

async function writeFakeOpenClawGatewayBinary(
  installRoot: string,
  options: { methods?: string[]; scopes?: string[]; configFailureMessage?: string } = {}
) {
  const binDir = path.join(installRoot, "fake-openclaw-gateway");
  const scriptPath = path.join(binDir, "openclaw-gateway.js");
  const binPath = path.join(binDir, process.platform === "win32" ? "openclaw.cmd" : "openclaw");
  const methods = options.methods ?? [
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
  const scopes = options.scopes ?? [
    "operator.admin",
    "operator.read",
    "operator.write",
    "operator.approvals",
    "operator.pairing",
    "operator.talk.secrets"
  ];

  await mkdir(binDir, { recursive: true });
  await writeFile(scriptPath, [
    "#!/usr/bin/env node",
    `const methods = ${JSON.stringify(methods)};`,
    `const scopes = ${JSON.stringify(scopes)};`,
    `const configFailureMessage = ${JSON.stringify(options.configFailureMessage ?? null)};`,
    "const args = process.argv.slice(2);",
    "function print(value) { console.log(JSON.stringify(value)); }",
    `if (args[0] === '--version') { console.log('OpenClaw ${OPENCLAW_RECOMMENDED_VERSION}'); process.exit(0); }`,
    "if (args[0] === 'gateway' && args[1] === 'status') {",
    "  print({ status: 'connected', rpc: { ok: true, protocolVersion: 4, methods, auth: { role: 'operator', scopes } } });",
    "  process.exit(0);",
    "}",
    "if (args[0] === 'gateway' && args[1] === 'call') {",
    "  const method = args[2];",
    "  if (method === 'status') { print({ protocolVersion: 4, features: { methods }, auth: { role: 'operator', scopes } }); process.exit(0); }",
    "  if (method === 'health') { print({ ok: true }); process.exit(0); }",
    "  if (method === 'models.list') { print({ models: [{ id: 'openai/gpt-5.5', ready: true }] }); process.exit(0); }",
    "  if (method === 'models.authStatus') { print({ providers: [{ provider: 'openai', connected: true }] }); process.exit(0); }",
    "  if (method === 'config.get') { if (configFailureMessage) { console.error(configFailureMessage); process.exit(1); } print({ bindings: [] }); process.exit(0); }",
    "  if (method === 'config.schema') { print({ schema: { type: 'object' } }); process.exit(0); }",
    "  if (method === 'channels.status') { print({ channels: [] }); process.exit(0); }",
    "}",
    "console.error(`unexpected openclaw args: ${args.join(' ')}`);",
    "process.exit(2);"
  ].join("\n"), "utf8");

  if (process.platform === "win32") {
    await writeFile(binPath, `@echo off\r\n"${process.execPath}" "${scriptPath}" %*\r\n`, "utf8");
    return binPath;
  }

  await chmod(scriptPath, 0o755);
  await writeFile(binPath, `#!/bin/sh\nexec ${JSON.stringify(process.execPath)} ${JSON.stringify(scriptPath)} "$@"\n`, "utf8");
  await chmod(binPath, 0o755);
  return binPath;
}

async function writeFakePackageManagerBinary(binDir: string, command: string, version: string) {
  await mkdir(binDir, { recursive: true });

  if (process.platform === "win32") {
    const binPath = path.join(binDir, `${command}.cmd`);
    await writeFile(binPath, `@echo off\r\necho "${version}"\r\n`, "utf8");
    return binPath;
  }

  const binPath = path.join(binDir, command);
  await writeFile(binPath, `#!/bin/sh\nprintf '%s\\n' '${JSON.stringify(version)}'\n`, "utf8");
  await chmod(binPath, 0o755);
  return binPath;
}

function collectProcessOutput(child: ChildProcessWithoutNullStreams) {
  let output = "";
  child.stdout.on("data", (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on("data", (chunk) => {
    output += chunk.toString();
  });
  return () => output;
}

async function waitForRuntimeState(statePath: string) {
  return waitFor(async () => {
    const raw = await readFile(statePath, "utf8").catch(() => null);

    if (!raw) {
      return null;
    }

    const state = JSON.parse(raw) as { pid?: unknown; port?: unknown; host?: unknown };
    return typeof state.pid === "number" ? state as { pid: number; port: number; host: string } : null;
  }, 5_000);
}

async function waitForProcessExit(child: ChildProcessWithoutNullStreams) {
  await waitFor(() => child.exitCode !== null || child.signalCode !== null ? true : null, 5_000);
}

async function waitFor<T>(read: () => Promise<T | null> | T | null, timeoutMs: number): Promise<T> {
  const startedAt = Date.now();

  while (Date.now() - startedAt < timeoutMs) {
    const value = await read();

    if (value) {
      return value;
    }

    await new Promise((resolve) => {
      setTimeout(resolve, 50);
    });
  }

  throw new Error(`Timed out after ${timeoutMs}ms.`);
}

function runTerminalBootEval(expression: string) {
  const script = [
    `import { AGENTOS_BOOT_HEADER, renderBootFrame, shouldUsePlainBoot, supportsBootColor } from ${JSON.stringify(pathToFileURL(realTerminalBootPath).href)};`,
    `console.log(JSON.stringify(${expression}));`
  ].join("\n");
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", script], {
    cwd: rootDir,
    encoding: "utf8"
  });

  assert.equal(result.status, 0, result.stderr);
  return JSON.parse(result.stdout);
}

function allocateSmokePort() {
  const offset = (Date.now() + process.pid) % 20_000;
  return 30_000 + offset;
}

function bumpPatchVersion(version: string) {
  const [major, minor, patch] = version.split(".").map(Number);
  return `${major}.${minor}.${patch + 1}`;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
