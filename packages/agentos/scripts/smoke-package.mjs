import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const packageJson = JSON.parse(readFileSync(path.join(packageDir, "package.json"), "utf8"));

const tempRoot = mkdtempSync(path.join(os.tmpdir(), "agentos-package-smoke-"));
const npmCache = path.join(tempRoot, "npm-cache");
const installPrefix = path.join(tempRoot, "prefix");
const tarball = resolveTarball(process.argv.slice(2));

try {
  const packageTarball = tarball ?? packPackage();
  assertPackageTarballContents(packageTarball);
  installPackage(packageTarball);
  const installedPackageRoot = resolveInstalledPackageRoot();
  const installedBin = resolveInstalledBinPath();

  expectFile(path.join(installedPackageRoot, "bundle", "server.js"), "installed bundle server");
  expectFile(installedBin, "installed agentos bin");
  expectCommand(installedBin, ["--version"], packageJson.version);
  expectCommand(installedBin, ["doctor"], "AGENTOS DOCTOR");
  expectCommand(installedBin, ["doctor", "--deep"], "AGENTOS DOCTOR");

  console.log(`AgentOS package smoke passed for ${packageJson.name}@${packageJson.version}`);
} finally {
  if (process.env.AGENTOS_KEEP_PACKAGE_SMOKE !== "1") {
    rmSync(tempRoot, { recursive: true, force: true });
  } else {
    console.log(`Kept AgentOS package smoke temp dir: ${tempRoot}`);
  }
}

function resolveTarball(args) {
  const index = args.indexOf("--tarball");
  if (index === -1) {
    return null;
  }

  const value = args[index + 1];
  if (!value) {
    throw new Error("--tarball requires a path.");
  }

  const tarballPath = path.resolve(repoRoot, value);
  expectFile(tarballPath, "package tarball");
  return tarballPath;
}

function packPackage() {
  const packDir = path.join(tempRoot, "pack");
  mkdirSync(packDir, { recursive: true });
  const result = run(npmCommand(), [
    "pack",
    packageDir,
    "--pack-destination",
    packDir,
    "--cache",
    npmCache
  ], {
    cwd: repoRoot
  });
  const tarballName = result.stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".tgz"))
    .at(-1);

  if (!tarballName) {
    throw new Error(`npm pack did not report a tarball.\n${result.stdout}\n${result.stderr}`);
  }

  const tarballPath = path.join(packDir, tarballName);
  expectFile(tarballPath, "packed AgentOS tarball");
  return tarballPath;
}

function installPackage(tarballPath) {
  run(npmCommand(), [
    "install",
    "--global",
    "--prefix",
    installPrefix,
    "--cache",
    npmCache,
    "--no-audit",
    "--fund=false",
    tarballPath
  ], {
    cwd: repoRoot
  });
}

function assertPackageTarballContents(tarballPath) {
  const result = run(tarCommand(), ["-tzf", tarballPathForTar(tarballPath)], {
    cwd: repoRoot
  });
  const entries = new Set(
    result.stdout
      .split(/\r?\n/)
      .map((line) => line.trim().replace(/^\.\//, ""))
      .filter(Boolean)
  );
  const requiredEntries = [
    "package/package.json",
    "package/README.md",
    "package/bin/agentos.js",
    "package/bin/node-runtime.js",
    "package/bin/terminal-boot.js",
    "package/bundle/server.js"
  ];
  const missingEntries = requiredEntries.filter((entry) => !entries.has(entry));

  if (missingEntries.length > 0) {
    throw new Error(`Package tarball is missing expected npm files: ${missingEntries.join(", ")}`);
  }

  for (const forbiddenEntry of ["package/.env", "package/.env.local"]) {
    if (entries.has(forbiddenEntry)) {
      throw new Error(`Package tarball must not include source environment file: ${forbiddenEntry}`);
    }
  }
}

function resolveInstalledPackageRoot() {
  const result = run(npmCommand(), ["root", "--global", "--prefix", installPrefix], {
    cwd: repoRoot
  });
  const nodeModulesRoot = result.stdout.trim();
  if (!nodeModulesRoot) {
    throw new Error("npm root did not return an installed global node_modules path.");
  }

  return path.join(nodeModulesRoot, "@sapienx", "agentos");
}

function resolveInstalledBinPath() {
  return process.platform === "win32"
    ? path.join(installPrefix, "agentos.cmd")
    : path.join(installPrefix, "bin", "agentos");
}

function expectFile(filePath, label) {
  if (!existsSync(filePath)) {
    throw new Error(`Missing ${label}: ${filePath}`);
  }
}

function expectCommand(command, args, expectedOutput) {
  const result = run(command, args, {
    cwd: repoRoot,
    env: {
      ...process.env,
      AGENTOS_INSTALL_ROOT: path.join(tempRoot, "agentos-runtime"),
      AGENTOS_HOST: "127.0.0.1",
      AGENTOS_PORT: "3000",
      AGENTOS_OPEN: "0"
    }
  });
  const combined = `${result.stdout}\n${result.stderr}`;

  if (!combined.includes(expectedOutput)) {
    throw new Error(`Expected ${command} ${args.join(" ")} output to include ${JSON.stringify(expectedOutput)}.\n${combined}`);
  }
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    encoding: "utf8",
    shell: shouldUseShell(command),
    ...options,
    env: options.env ?? process.env
  });

  if (result.error) {
    throw result.error;
  }

  if (result.status !== 0) {
    throw new Error([
      `Command failed with exit code ${result.status}: ${command} ${args.join(" ")}`,
      result.stdout,
      result.stderr
    ].filter(Boolean).join("\n"));
  }

  return {
    stdout: result.stdout || "",
    stderr: result.stderr || ""
  };
}

function npmCommand() {
  return process.platform === "win32" ? "npm.cmd" : "npm";
}

function tarCommand() {
  return process.platform === "win32" ? "tar.exe" : "tar";
}

function tarballPathForTar(tarballPath) {
  if (process.platform !== "win32") {
    return tarballPath;
  }

  const relativePath = path.relative(repoRoot, tarballPath);
  if (relativePath && !relativePath.startsWith("..") && !path.isAbsolute(relativePath)) {
    return relativePath.split(path.sep).join("/");
  }

  return tarballPath
    .replace(/\\/g, "/")
    .replace(/^([A-Za-z]):\//, (_, drive) => `/${drive.toLowerCase()}/`);
}

function shouldUseShell(command) {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
}
