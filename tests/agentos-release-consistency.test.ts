import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { cp, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

const rootDir = process.cwd();
const releaseCheckScript = path.join(rootDir, "packages/agentos/scripts/check-release-consistency.mjs");
const releaseCheckFiles = [
  "package.json",
  "README.md",
  "SECURITY.md",
  "docs/agentos-clean-install-smoke-checklist.md",
  "docs/release-notes-agentos-template.md",
  "install.sh",
  "install.ps1",
  ".github/workflows/ci.yml",
  ".github/workflows/release-agentos.yml",
  "scripts/mission-control-browser-smoke.mjs",
  "packages/agentos/package.json",
  "packages/agentos/README.md",
  "packages/agentos/bin/agentos.js",
  "packages/agentos/scripts/check-release-consistency.mjs",
  "packages/agentos/scripts/prepare-bundle.mjs",
  "packages/agentos/scripts/run-prepack.mjs",
  "packages/agentos/scripts/smoke-package.mjs",
  "lib/openclaw/versions.ts"
];

test("AgentOS release metadata stays consistent", () => {
  const packageVersion = readPackageVersion(rootDir);
  const result = runReleaseCheck(rootDir);

  assert.equal(result.status, 0, result.stderr || result.stdout);
  assert.match(result.stdout, new RegExp(`AgentOS release consistency check passed for @sapienx/agentos@${escapeRegExp(packageVersion)}`));
  assert.match(result.stdout, /Root package is private/);
});

test("AgentOS release check rejects stale README version references", async () => {
  const staleVersion = readPackageVersion(rootDir);
  const tempRoot = await copyReleaseCheckFixture();
  const packageJsonPath = path.join(tempRoot, "packages/agentos/package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { version: string };
  packageJson.version = "9.9.9";
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const result = runReleaseCheck(tempRoot);

  assert.notEqual(result.status, 0);
  assert.match(
    result.stderr,
    new RegExp(`README\\.md: macOS/Linux AGENTOS_VERSION example uses ${escapeRegExp(staleVersion)}, expected 9\\.9\\.9`)
  );
  assert.match(
    result.stderr,
    new RegExp(`README\\.md: release tag example uses ${escapeRegExp(staleVersion)}, expected 9\\.9\\.9`)
  );
});

test("AgentOS release check rejects missing root Node 24 engine", async () => {
  const tempRoot = await copyReleaseCheckFixture();
  const packageJsonPath = path.join(tempRoot, "package.json");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8")) as { engines?: Record<string, string> };
  delete packageJson.engines;
  await writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8");

  const result = runReleaseCheck(tempRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /package\.json: engines\.node is undefined, expected ">=24\.0\.0"/);
});

test("AgentOS release check rejects vague README Node prerequisites", async () => {
  const tempRoot = await copyReleaseCheckFixture();
  const readmePath = path.join(tempRoot, "README.md");
  const readme = await readFile(readmePath, "utf8");
  await writeFile(readmePath, readme.replaceAll("- Node.js 24 or newer", "- A recent Node.js runtime"), "utf8");

  const result = runReleaseCheck(tempRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /README\.md: Expected to find "- Node\.js 24 or newer"/);
});

test("AgentOS release check keeps recommended and supported OpenClaw versions distinct", async () => {
  const tempRoot = await copyReleaseCheckFixture();
  const paths = [
    "README.md",
    "packages/agentos/README.md",
    "docs/agentos-clean-install-smoke-checklist.md"
  ];

  for (const relativePath of paths) {
    const filePath = path.join(tempRoot, relativePath);
    const contents = await readFile(filePath, "utf8");
    await writeFile(filePath, contents
      .replaceAll("Recommended OpenClaw: `2026.9.2`", "OpenClaw 2026.9.2 or newer")
      .replaceAll("Recommended OpenClaw: 2026.9.2", "OpenClaw 2026.9.2 or newer")
      .replaceAll("recommended OpenClaw 2026.9.2", "OpenClaw 2026.9.2 or newer"), "utf8");
  }

  const result = runReleaseCheck(tempRoot);

  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Recommended OpenClaw/);
  assert.doesNotMatch(result.stderr, /Supported minimum:.*2026\.9\.2/);
});

function runReleaseCheck(repoRoot: string) {
  return spawnSync(process.execPath, [releaseCheckScript, "--repo-root", repoRoot], {
    cwd: rootDir,
    encoding: "utf8"
  });
}

async function copyReleaseCheckFixture() {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "agentos-release-check-"));

  for (const relativePath of releaseCheckFiles) {
    const sourcePath = path.join(rootDir, relativePath);
    const targetPath = path.join(tempRoot, relativePath);
    await mkdir(path.dirname(targetPath), { recursive: true });
    await cp(sourcePath, targetPath);
  }

  return tempRoot;
}

function readPackageVersion(repoRoot: string) {
  const packageJson = JSON.parse(readFileSync(path.join(repoRoot, "packages/agentos/package.json"), "utf8")) as {
    version: string;
  };

  return packageJson.version;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
