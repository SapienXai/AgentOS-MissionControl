#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptPath = fileURLToPath(import.meta.url);
const scriptDir = path.dirname(scriptPath);
const defaultRepoRoot = path.resolve(scriptDir, "..", "..", "..");

const AGENTOS_PACKAGE_NAME = "@sapienx/agentos";
const AGENTOS_PACKAGE_DIR = "packages/agentos";
const AGENTOS_PACKAGE_JSON = `${AGENTOS_PACKAGE_DIR}/package.json`;
const AGENTOS_BIN_ENTRY = "bin/agentos.js";
const CHECK_SCRIPT = `${AGENTOS_PACKAGE_DIR}/scripts/check-release-consistency.mjs`;
const MISSION_CONTROL_SMOKE_SCRIPT = "scripts/mission-control-browser-smoke.mjs";
const RELEASE_NOTES_TEMPLATE = "docs/release-notes-agentos-template.md";
const RELEASE_TAG_PREFIX = "agentos-v";
const INSTALL_COMMAND = "curl -fsSL https://raw.githubusercontent.com/SapienXai/AgentOS/main/install.sh | bash";
const WINDOWS_INSTALL_COMMAND = "iwr https://raw.githubusercontent.com/SapienXai/AgentOS/main/install.ps1 | iex";
const REQUIRED_NODE_ENGINE = ">=24.16.0 <25 || >=26.1.0";
const REQUIRED_NODE_RUNTIME_COPY = "Node.js 24.16.0+ or 26.1.0+";
const REQUIRED_NODE_WORKFLOW_VERSION = "24.20.0";
const OPENCLAW_VERSIONS_FILE = "lib/openclaw/versions.ts";
const RELEASE_ASSETS = [
  "agentos-darwin-arm64.tgz",
  "agentos-darwin-x64.tgz",
  "agentos-linux-x64.tgz",
  "agentos-win32-x64.tgz"
];

const SEMVER_SOURCE = "\\d+\\.\\d+\\.\\d+(?:-[0-9A-Za-z.-]+)?(?:\\+[0-9A-Za-z.-]+)?";
const SEMVER_PATTERN = new RegExp(`^${SEMVER_SOURCE}$`);

export function checkReleaseConsistency(options = {}) {
  const repoRoot = options.repoRoot ? path.resolve(options.repoRoot) : defaultRepoRoot;
  const overrides = normalizeOverrides(options.overrides);
  const context = {
    repoRoot,
    overrides,
    issues: [],
    notes: []
  };

  const rootPackage = readJson(context, "package.json");
  const agentosPackage = readJson(context, AGENTOS_PACKAGE_JSON);
  const readme = readText(context, "README.md");
  const packageReadme = readText(context, `${AGENTOS_PACKAGE_DIR}/README.md`);
  const security = readText(context, "SECURITY.md");
  const cleanInstallChecklist = readText(context, "docs/agentos-clean-install-smoke-checklist.md");
  const releaseNotesTemplate = readText(context, RELEASE_NOTES_TEMPLATE);
  const installSh = readText(context, "install.sh");
  const installPs1 = readText(context, "install.ps1");
  const ciWorkflow = readText(context, ".github/workflows/ci.yml");
  const workflow = readText(context, ".github/workflows/release-agentos.yml");
  const launcher = readText(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`);
  const prepareBundle = readText(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`);
  const runPrepack = readText(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`);
  const smokePackage = readText(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`);
  const missionControlSmoke = readText(context, MISSION_CONTROL_SMOKE_SCRIPT);
  const openClawVersions = readText(context, OPENCLAW_VERSIONS_FILE);

  if (!rootPackage || !agentosPackage) {
    return buildResult(context, agentosPackage);
  }

  validateRootPackage(context, rootPackage, agentosPackage);
  validateOpenClawVersions(context, openClawVersions);
  const openClawVersionPolicy = {
    recommended: readTypeScriptStringConstant(openClawVersions, "OPENCLAW_RECOMMENDED_VERSION"),
    supportedBaseline: readTypeScriptStringConstant(openClawVersions, "OPENCLAW_SUPPORTED_BASELINE_VERSION")
  };
  validateAgentosPackage(context, agentosPackage);
  validateLauncher(context, launcher, agentosPackage);
  validateInstallers(context, installSh, installPs1);
  validateReadmes(context, readme, packageReadme, agentosPackage, openClawVersionPolicy);
  validateSecurityDocs(context, security, cleanInstallChecklist, openClawVersionPolicy);
  validateReleaseNotesTemplate(context, releaseNotesTemplate);
  validateBuildScripts(context, rootPackage, agentosPackage, prepareBundle, runPrepack, smokePackage, missionControlSmoke);
  validateCiWorkflow(context, ciWorkflow);
  validateReleaseWorkflow(context, workflow, agentosPackage);

  return buildResult(context, agentosPackage);
}

function validateReleaseNotesTemplate(context, releaseNotesTemplate) {
  if (!releaseNotesTemplate) {
    return;
  }

  for (const heading of [
    "## Highlights",
    "## OpenClaw Compatibility Impact",
    "## Security Impact",
    "## Validation",
    "## Smoke Status",
    "## Known Limitations",
    "## Upgrade Notes"
  ]) {
    expectIncludes(context, RELEASE_NOTES_TEMPLATE, releaseNotesTemplate, heading);
  }

  expectIncludes(context, RELEASE_NOTES_TEMPLATE, releaseNotesTemplate, "pnpm smoke:mission-control");
  expectIncludes(context, RELEASE_NOTES_TEMPLATE, releaseNotesTemplate, "agentos doctor --deep");
}

export function formatReleaseConsistencyResult(result) {
  if (result.ok) {
    const lines = [`AgentOS release consistency check passed for ${result.packageName}@${result.version}.`];

    for (const note of result.notes) {
      lines.push(`- ${note}`);
    }

    return lines.join("\n");
  }

  return [
    "AgentOS release consistency check failed:",
    ...result.issues.map((issue) => `- ${issue.file}: ${issue.message}`)
  ].join("\n");
}

function validateRootPackage(context, rootPackage, agentosPackage) {
  if (rootPackage.private !== true) {
    addIssue(context, "package.json", "Root package must remain private because published release metadata lives in packages/agentos/package.json.");
  }

  expectEqual(context, "package.json", "engines.node", rootPackage.engines?.node, REQUIRED_NODE_ENGINE);

  if (rootPackage.version !== agentosPackage.version) {
    if (rootPackage.private === true) {
      context.notes.push(
        `Root package is private (${rootPackage.name}@${rootPackage.version}); published CLI version source is ${AGENTOS_PACKAGE_JSON} (${agentosPackage.version}).`
      );
    } else {
      addIssue(
        context,
        "package.json",
        `Root package version ${rootPackage.version} differs from published ${AGENTOS_PACKAGE_NAME} version ${agentosPackage.version}, but the root package is not private.`
      );
    }
  }
}

function validateAgentosPackage(context, agentosPackage) {
  expectEqual(context, AGENTOS_PACKAGE_JSON, "name", agentosPackage.name, AGENTOS_PACKAGE_NAME);

  if (!isSemver(agentosPackage.version)) {
    addIssue(context, AGENTOS_PACKAGE_JSON, `version must be a valid semver string; found ${JSON.stringify(agentosPackage.version)}.`);
  }

  expectEqual(context, AGENTOS_PACKAGE_JSON, "type", agentosPackage.type, "module");
  expectEqual(
    context,
    AGENTOS_PACKAGE_JSON,
    "description",
    agentosPackage.description,
    "Gateway-first local AgentOS control plane for OpenClaw"
  );
  expectEqual(context, AGENTOS_PACKAGE_JSON, "license", agentosPackage.license, "MIT");
  expectEqual(context, AGENTOS_PACKAGE_JSON, "bin.agentos", agentosPackage.bin?.agentos, AGENTOS_BIN_ENTRY);
  expectEqual(context, AGENTOS_PACKAGE_JSON, "engines.node", agentosPackage.engines?.node, REQUIRED_NODE_ENGINE);
  expectEqual(context, AGENTOS_PACKAGE_JSON, "publishConfig.access", agentosPackage.publishConfig?.access, "public");
  expectEqual(context, AGENTOS_PACKAGE_JSON, "homepage", agentosPackage.homepage, "https://sapienx.app/agentos");
  expectEqual(context, AGENTOS_PACKAGE_JSON, "repository.type", agentosPackage.repository?.type, "git");
  expectEqual(context, AGENTOS_PACKAGE_JSON, "repository.url", agentosPackage.repository?.url, "git+https://github.com/SapienXai/AgentOS.git");
  expectEqual(context, AGENTOS_PACKAGE_JSON, "repository.directory", agentosPackage.repository?.directory, AGENTOS_PACKAGE_DIR);
  expectEqual(context, AGENTOS_PACKAGE_JSON, "bugs.url", agentosPackage.bugs?.url, "https://github.com/SapienXai/AgentOS/issues");

  for (const fileEntry of ["README.md", "bin", "bundle"]) {
    if (!Array.isArray(agentosPackage.files) || !agentosPackage.files.includes(fileEntry)) {
      addIssue(context, AGENTOS_PACKAGE_JSON, `files must include ${JSON.stringify(fileEntry)} for the published package.`);
    }
  }

  expectEqual(
    context,
    AGENTOS_PACKAGE_JSON,
    "scripts.check:release",
    agentosPackage.scripts?.["check:release"],
    "node scripts/check-release-consistency.mjs"
  );
  expectEqual(
    context,
    AGENTOS_PACKAGE_JSON,
    "scripts.prepare:bundle",
    agentosPackage.scripts?.["prepare:bundle"],
    "node scripts/prepare-bundle.mjs"
  );
  expectEqual(
    context,
    AGENTOS_PACKAGE_JSON,
    "scripts.prepack",
    agentosPackage.scripts?.prepack,
    "node scripts/check-release-consistency.mjs && node scripts/run-prepack.mjs"
  );
  expectEqual(
    context,
    AGENTOS_PACKAGE_JSON,
    "scripts.prepublishOnly",
    agentosPackage.scripts?.prepublishOnly,
    "node scripts/check-release-consistency.mjs"
  );
}

function validateOpenClawVersions(context, openClawVersions) {
  if (!openClawVersions) {
    context.issues.push(`${OPENCLAW_VERSIONS_FILE}: missing OpenClaw version constants file`);
    return;
  }

  const recommended = readTypeScriptStringConstant(openClawVersions, "OPENCLAW_RECOMMENDED_VERSION");
  const supportedBaseline = readTypeScriptStringConstant(openClawVersions, "OPENCLAW_SUPPORTED_BASELINE_VERSION");

  if (!recommended) {
    context.issues.push(`${OPENCLAW_VERSIONS_FILE}: missing OPENCLAW_RECOMMENDED_VERSION`);
  }

  if (!supportedBaseline) {
    context.issues.push(`${OPENCLAW_VERSIONS_FILE}: missing OPENCLAW_SUPPORTED_BASELINE_VERSION`);
  }

  if (recommended && supportedBaseline && compareVersionStrings(recommended, supportedBaseline) < 0) {
    context.issues.push(
      `${OPENCLAW_VERSIONS_FILE}: OPENCLAW_RECOMMENDED_VERSION (${recommended}) must be greater than or equal to OPENCLAW_SUPPORTED_BASELINE_VERSION (${supportedBaseline})`
    );
  }
}

function validateLauncher(context, launcher, agentosPackage) {
  if (!launcher) {
    return;
  }

  expectFileExists(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`);
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "#!/usr/bin/env node");
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, 'const packageJsonPath = path.join(packageRoot, "package.json");');
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "console.log(packageJson.version);");
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "${packageJson.name}@${packageJson.version}");
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "registry.npmjs.org");
  expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`, launcher, "releases/download/agentos-v${latestVersion}");

  if (launcher.includes(`${AGENTOS_PACKAGE_NAME}@${agentosPackage.version}`)) {
    addIssue(
      context,
      `${AGENTOS_PACKAGE_DIR}/${AGENTOS_BIN_ENTRY}`,
      "Launcher must read package name/version from package.json instead of hard-coding the current published version."
    );
  }
}

function validateInstallers(context, installSh, installPs1) {
  if (installSh) {
    expectIncludes(context, "install.sh", installSh, 'REQUESTED_VERSION="${AGENTOS_VERSION:-latest}"');
    expectIncludes(context, "install.sh", installSh, 'RELEASE_PATH="latest/download"');
    expectIncludes(context, "install.sh", installSh, 'RELEASE_PATH="download/agentos-v${REQUESTED_VERSION}"');
    expectIncludes(context, "install.sh", installSh, 'ARTIFACT_NAME="agentos-${ASSET_PLATFORM}-${ASSET_ARCH}.tgz"');
    expectIncludes(context, "install.sh", installSh, 'CHECKSUM_NAME="${ARTIFACT_NAME}.sha256"');
    expectIncludes(context, "install.sh", installSh, 'REPO="${AGENTOS_REPO:-SapienXai/AgentOS}"');
    expectIncludes(context, "install.sh", installSh, "major === 24 && minor >= 16");
    expectIncludes(context, "install.sh", installSh, `AgentOS requires ${REQUIRED_NODE_RUNTIME_COPY}.`);
  }

  if (installPs1) {
    expectIncludes(context, "install.ps1", installPs1, '$requestedVersion = if ($env:AGENTOS_VERSION) { $env:AGENTOS_VERSION } else { "latest" }');
    expectIncludes(context, "install.ps1", installPs1, '$releasePath = "latest/download"');
    expectIncludes(context, "install.ps1", installPs1, '$releasePath = "download/agentos-v$requestedVersion"');
    expectIncludes(context, "install.ps1", installPs1, '$artifactName = "agentos-$assetPlatform-$assetArch.tgz"');
    expectIncludes(context, "install.ps1", installPs1, '$checksumUrl = "$artifactUrl.sha256"');
    expectIncludes(context, "install.ps1", installPs1, '"SapienXai/AgentOS"');
    expectIncludes(context, "install.ps1", installPs1, "major === 24 && minor >= 16");
    expectIncludes(context, "install.ps1", installPs1, `AgentOS requires ${REQUIRED_NODE_RUNTIME_COPY}.`);
  }
}

function validateReadmes(context, readme, packageReadme, agentosPackage, openClawVersionPolicy) {
  const recommendedCopy = openClawVersionPolicy.recommended
    ? `Recommended OpenClaw: \`${openClawVersionPolicy.recommended}\``
    : null;
  const supportedMinimumCopy = openClawVersionPolicy.supportedBaseline
    ? `Supported minimum: \`${openClawVersionPolicy.supportedBaseline}\``
    : null;
  const packageRecommendedCopy = openClawVersionPolicy.recommended
    ? `Recommended OpenClaw: ${openClawVersionPolicy.recommended}`
    : null;
  const packageSupportedMinimumCopy = openClawVersionPolicy.supportedBaseline
    ? `Supported minimum: OpenClaw ${openClawVersionPolicy.supportedBaseline}`
    : null;

  if (readme) {
    expectIncludes(context, "README.md", readme, INSTALL_COMMAND);
    expectIncludes(context, "README.md", readme, WINDOWS_INSTALL_COMMAND);
    expectIncludes(context, "README.md", readme, "pnpm add -g @sapienx/agentos");
    expectIncludes(context, "README.md", readme, "npm install -g @sapienx/agentos");
    expectIncludes(context, "README.md", readme, "pnpm check:release");
    expectIncludes(context, "README.md", readme, "pnpm typegen");
    expectIncludes(context, "README.md", readme, "pnpm test");
    expectIncludes(context, "README.md", readme, "pnpm smoke:agentos-package");
    expectIncludes(context, "README.md", readme, "docs/agentos-clean-install-smoke-checklist.md");
    expectIncludes(context, "README.md", readme, "packages/agentos/package.json");
    expectIncludes(context, "README.md", readme, REQUIRED_NODE_RUNTIME_COPY);
    expectIncludes(context, "README.md", readme, `- ${REQUIRED_NODE_RUNTIME_COPY}`);
    if (recommendedCopy) expectIncludes(context, "README.md", readme, recommendedCopy);
    if (supportedMinimumCopy) expectIncludes(context, "README.md", readme, supportedMinimumCopy);
    if (openClawVersionPolicy.recommended) expectIncludes(context, "README.md", readme, `Native contract target: \`${openClawVersionPolicy.recommended}\``);
    expectIncludes(context, "README.md", readme, "CLI fallback remains explicit and visible");
    expectIncludes(context, "README.md", readme, "Accounts and browser profiles are an MVP bridge");
    expectIncludes(context, "README.md", readme, "OpenClaw does not yet expose typed browser-profile dispatch");
    expectIncludes(context, "README.md", readme, "`requires_approval` account access rules are intentionally blocked until approval dispatch exists");
    expectIncludes(context, "README.md", readme, "Surface repair is preview-first");
    expectIncludes(context, "README.md", readme, "`agentos doctor --deep` is the release-readiness diagnostic");

    expectVersionReferences(context, "README.md", readme, agentosPackage.version, [
      {
        label: "macOS/Linux AGENTOS_VERSION example",
        pattern: new RegExp(`AGENTOS_VERSION=(${SEMVER_SOURCE})\\s+bash`, "g")
      },
      {
        label: "Windows AGENTOS_VERSION example",
        pattern: new RegExp(`AGENTOS_VERSION='(${SEMVER_SOURCE})'`, "g")
      },
      {
        label: "release tag example",
        pattern: new RegExp(`git tag ${RELEASE_TAG_PREFIX}(${SEMVER_SOURCE})`, "g")
      },
      {
        label: "release tag push example",
        pattern: new RegExp(`git push origin ${RELEASE_TAG_PREFIX}(${SEMVER_SOURCE})`, "g")
      },
      {
        label: "versioned package manager install",
        pattern: new RegExp(`@sapienx/agentos@(${SEMVER_SOURCE})`, "g"),
        optional: true
      }
    ]);
  }

  if (packageReadme) {
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, "pnpm add -g @sapienx/agentos");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, "agentos update --check");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, REQUIRED_NODE_RUNTIME_COPY);
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, "Packaged AgentOS uses API token authentication");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, "AGENTOS_ALLOW_REMOTE_GATEWAY_URL=1");
    if (packageRecommendedCopy) expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, packageRecommendedCopy);
    if (packageSupportedMinimumCopy) expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, packageSupportedMinimumCopy);
    if (openClawVersionPolicy.recommended) expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, `Native contract target: OpenClaw ${openClawVersionPolicy.recommended}`);
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, "Gateway-first transport by default, with explicit CLI fallback");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, "Account-target browser-profile dispatch is an MVP bridge");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/README.md`, packageReadme, "`requires_approval` rules remain blocked until approval dispatch exists");
  }
}

function validateSecurityDocs(context, security, cleanInstallChecklist, openClawVersionPolicy) {
  if (security) {
    expectIncludes(context, "SECURITY.md", security, "Keep it bound to `127.0.0.1`");
    expectIncludes(context, "SECURITY.md", security, "Packaged AgentOS generates a local API token");
    expectIncludes(context, "SECURITY.md", security, "protects API routes centrally");
    expectIncludes(context, "SECURITY.md", security, "AGENTOS_ALLOW_REMOTE_GATEWAY_URL=1");
    expectIncludes(context, "SECURITY.md", security, "Do not expose AgentOS publicly");
  }

  if (cleanInstallChecklist) {
  expectIncludes(context, "docs/agentos-clean-install-smoke-checklist.md", cleanInstallChecklist, REQUIRED_NODE_RUNTIME_COPY);
    if (openClawVersionPolicy.recommended && openClawVersionPolicy.supportedBaseline) {
      expectIncludes(context, "docs/agentos-clean-install-smoke-checklist.md", cleanInstallChecklist, `recommended OpenClaw ${openClawVersionPolicy.recommended}`);
      expectIncludes(context, "docs/agentos-clean-install-smoke-checklist.md", cleanInstallChecklist, `supported minimum is OpenClaw ${openClawVersionPolicy.supportedBaseline}`);
      expectIncludes(context, "docs/agentos-clean-install-smoke-checklist.md", cleanInstallChecklist, `native contract target is ${openClawVersionPolicy.recommended}`);
    }
    expectIncludes(context, "docs/agentos-clean-install-smoke-checklist.md", cleanInstallChecklist, "agentos doctor --deep");
    expectIncludes(context, "docs/agentos-clean-install-smoke-checklist.md", cleanInstallChecklist, "physical operator machine");
    expectIncludes(context, "docs/agentos-clean-install-smoke-checklist.md", cleanInstallChecklist, "`requires_approval` access rules remain blocked/coming soon until approval dispatch exists");
    expectIncludes(context, "docs/agentos-clean-install-smoke-checklist.md", cleanInstallChecklist, "Run the repair preview first");
  }
}

function validateBuildScripts(context, rootPackage, agentosPackage, prepareBundle, runPrepack, smokePackage, missionControlSmoke) {
  expectEqual(
    context,
    "package.json",
    "scripts.typegen",
    rootPackage.scripts?.typegen,
    "next typegen"
  );
  expectEqual(
    context,
    "package.json",
    "scripts.check:release",
    rootPackage.scripts?.["check:release"],
    `node ${CHECK_SCRIPT}`
  );
  expectEqual(
    context,
    "package.json",
    "scripts.build:agentos-package",
    rootPackage.scripts?.["build:agentos-package"],
    `pnpm check:release && node ${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`
  );
  expectEqual(
    context,
    "package.json",
    "scripts.pack:agentos",
    rootPackage.scripts?.["pack:agentos"],
    "pnpm check:release && npm pack ./packages/agentos --pack-destination /tmp --cache /tmp/agentos-npm-cache"
  );
  expectEqual(
    context,
    "package.json",
    "scripts.smoke:agentos-package",
    rootPackage.scripts?.["smoke:agentos-package"],
    `node ${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`
  );
  expectEqual(
    context,
    "package.json",
    "scripts.smoke:mission-control",
    rootPackage.scripts?.["smoke:mission-control"],
    `node ${MISSION_CONTROL_SMOKE_SCRIPT}`
  );
  expectFileExists(context, MISSION_CONTROL_SMOKE_SCRIPT);
  expectFileExists(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`);
  expectEqual(
    context,
    "package.json",
    "scripts.publish:agentos",
    rootPackage.scripts?.["publish:agentos"],
    "pnpm check:release && npm publish ./packages/agentos --access public --cache /tmp/agentos-npm-cache"
  );

  if (prepareBundle) {
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, 'const packageDir = path.resolve(scriptDir, "..");');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, 'const repoRoot = path.resolve(packageDir, "..", "..");');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, 'const bundleDir = path.join(packageDir, "bundle");');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, 'await rm(path.join(dir, ".env.local"), { force: true });');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/prepare-bundle.mjs`, prepareBundle, "Prepared AgentOS bundle");
  }

  if (runPrepack) {
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'const repoRoot = path.resolve(packageDir, "..", "..");');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'cleanNextBuildOutput();');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'fs.rmSync(path.join(repoRoot, ".next"),');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'resolveNextCliPath(), "build", "--webpack"');
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/run-prepack.mjs`, runPrepack, 'path.join(scriptDir, "prepare-bundle.mjs")');
  }

  if (smokePackage) {
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`, smokePackage, "\"pack\"");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`, smokePackage, "assertPackageTarballContents(packageTarball)");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`, smokePackage, "tarballPathForTar(tarballPath)");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`, smokePackage, "replace(/^([A-Za-z]):\\//");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`, smokePackage, "\"package/bin/terminal-boot.js\"");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`, smokePackage, "[\"--version\"]");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`, smokePackage, "[\"doctor\", \"--deep\"]");
    expectIncludes(context, `${AGENTOS_PACKAGE_DIR}/scripts/smoke-package.mjs`, smokePackage, "\"bundle\", \"server.js\"");
  }

  if (missionControlSmoke) {
    expectIncludes(context, MISSION_CONTROL_SMOKE_SCRIPT, missionControlSmoke, "AGENTOS_SMOKE_JSON_OUTPUT");
    expectIncludes(context, MISSION_CONTROL_SMOKE_SCRIPT, missionControlSmoke, "AGENTOS_SMOKE_ALLOW_DATA_BLOCKED");
    expectIncludes(context, MISSION_CONTROL_SMOKE_SCRIPT, missionControlSmoke, "\"PASS\"");
    expectIncludes(context, MISSION_CONTROL_SMOKE_SCRIPT, missionControlSmoke, "\"FAIL\"");
    expectIncludes(context, MISSION_CONTROL_SMOKE_SCRIPT, missionControlSmoke, "\"SKIP\"");
    expectIncludes(context, MISSION_CONTROL_SMOKE_SCRIPT, missionControlSmoke, "\"BLOCKED\"");
  }

  if (agentosPackage.bin?.agentos !== AGENTOS_BIN_ENTRY) {
    addIssue(context, AGENTOS_PACKAGE_JSON, `bin.agentos must target ${AGENTOS_BIN_ENTRY} before build, pack, or publish.`);
  }
}

function validateCiWorkflow(context, workflow) {
  if (!workflow) {
    return;
  }

  expectIncludes(context, ".github/workflows/ci.yml", workflow, "name: CI");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pull_request:");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "branches:");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "- main");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, `node-version: ${REQUIRED_NODE_WORKFLOW_VERSION}`);
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm install --frozen-lockfile");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm lint");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm typegen");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm typecheck");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm test");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm build");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm check:release");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "mission-control-browser-smoke");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm start > .smoke/agentos-server.log");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "AGENTOS_SMOKE_BASE_URL: http://127.0.0.1:3000");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, 'AGENTOS_SMOKE_ALLOW_DATA_BLOCKED: "1"');
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "AGENTOS_SMOKE_JSON_OUTPUT: .smoke/mission-control-smoke.json");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "pnpm smoke:mission-control");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "actions/upload-artifact@v6");
  expectIncludes(context, ".github/workflows/ci.yml", workflow, "mission-control-browser-smoke");
}

function validateReleaseWorkflow(context, workflow, agentosPackage) {
  if (!workflow) {
    return;
  }

  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, '- "agentos-v*"');
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm install --frozen-lockfile");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm lint");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm typegen");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm typecheck");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm test");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm build");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm check:release");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "Run Mission Control browser smoke");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm start > .smoke/agentos-server.log");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "pnpm smoke:mission-control");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "mission-control-release-smoke");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "Smoke AgentOS CLI package");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "packages/agentos/scripts/smoke-package.mjs --tarball");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "require('./packages/agentos/package.json').version");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "Ensure tag matches package version");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "npm pack ./packages/agentos --pack-destination dist");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "install.sh");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "install.ps1");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, `node-version: ${REQUIRED_NODE_WORKFLOW_VERSION}`);
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "${{ needs.validate-release.outputs.version }}");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "## Highlights");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "## OpenClaw compatibility impact");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "## Security impact");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "## Validation");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "## Smoke status");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "## Known limitations");
  expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, "## Upgrade notes");

  for (const asset of RELEASE_ASSETS) {
    expectIncludes(context, ".github/workflows/release-agentos.yml", workflow, asset);
  }

  expectVersionReferences(context, ".github/workflows/release-agentos.yml", workflow, agentosPackage.version, [
    {
      label: "literal release tag version",
      pattern: new RegExp(`${RELEASE_TAG_PREFIX}(${SEMVER_SOURCE})`, "g"),
      optional: true
    },
    {
      label: "literal package version",
      pattern: new RegExp(`${AGENTOS_PACKAGE_NAME.replace("/", "\\/")}@(${SEMVER_SOURCE})`, "g"),
      optional: true
    }
  ]);
}

function expectVersionReferences(context, file, source, expectedVersion, checks) {
  for (const check of checks) {
    const matches = [...source.matchAll(check.pattern)];

    if (matches.length === 0) {
      if (!check.optional) {
        addIssue(context, file, `Missing ${check.label} for published package version ${expectedVersion}.`);
      }
      continue;
    }

    for (const match of matches) {
      const actualVersion = match[1];

      if (actualVersion !== expectedVersion) {
        addIssue(context, file, `${check.label} uses ${actualVersion}, expected ${expectedVersion} from ${AGENTOS_PACKAGE_JSON}.`);
      }
    }
  }
}

function buildResult(context, agentosPackage) {
  return {
    ok: context.issues.length === 0,
    packageName: agentosPackage?.name || AGENTOS_PACKAGE_NAME,
    version: agentosPackage?.version || "unknown",
    issues: context.issues,
    notes: context.notes
  };
}

function readText(context, relativePath) {
  if (context.overrides.has(relativePath)) {
    return context.overrides.get(relativePath);
  }

  const absolutePath = path.join(context.repoRoot, relativePath);

  try {
    return readFileSync(absolutePath, "utf8");
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addIssue(context, relativePath, `Unable to read required release file: ${detail}`);
    return null;
  }
}

function readJson(context, relativePath) {
  const text = readText(context, relativePath);

  if (!text) {
    return null;
  }

  try {
    return JSON.parse(text);
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    addIssue(context, relativePath, `Invalid JSON: ${detail}`);
    return null;
  }
}

function readTypeScriptStringConstant(source, name) {
  const pattern = new RegExp(`export\\s+const\\s+${name}\\s*=\\s*"([^"]+)"\\s*;`);
  return source.match(pattern)?.[1] ?? null;
}

function compareVersionStrings(left, right) {
  const leftParts = normalizeVersionParts(left);
  const rightParts = normalizeVersionParts(right);
  const length = Math.max(leftParts.length, rightParts.length);

  for (let index = 0; index < length; index += 1) {
    const leftPart = leftParts[index] ?? 0;
    const rightPart = rightParts[index] ?? 0;

    if (leftPart !== rightPart) {
      return leftPart > rightPart ? 1 : -1;
    }
  }

  return 0;
}

function normalizeVersionParts(version) {
  return String(version)
    .trim()
    .replace(/^v/i, "")
    .split(/[.-]/)
    .map((part) => Number.parseInt(part, 10))
    .map((part) => (Number.isFinite(part) ? part : 0));
}

function expectFileExists(context, relativePath) {
  if (context.overrides.has(relativePath)) {
    return;
  }

  if (!existsSync(path.join(context.repoRoot, relativePath))) {
    addIssue(context, relativePath, "Expected file does not exist.");
  }
}

function expectIncludes(context, file, source, expected) {
  if (!source.includes(expected)) {
    addIssue(context, file, `Expected to find ${JSON.stringify(expected)}.`);
  }
}

function expectEqual(context, file, field, actual, expected) {
  if (actual !== expected) {
    addIssue(context, file, `${field} is ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}.`);
  }
}

function addIssue(context, file, message) {
  context.issues.push({
    file,
    message
  });
}

function isSemver(value) {
  return typeof value === "string" && SEMVER_PATTERN.test(value);
}

function normalizeOverrides(overrides) {
  if (!overrides) {
    return new Map();
  }

  if (overrides instanceof Map) {
    return overrides;
  }

  return new Map(Object.entries(overrides));
}

function parseCliArgs(argv) {
  const args = {
    repoRoot: defaultRepoRoot
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];

    if (arg === "--repo-root") {
      const value = argv[index + 1];

      if (!value) {
        throw new Error("--repo-root requires a path value.");
      }

      args.repoRoot = path.resolve(value);
      index += 1;
      continue;
    }

    throw new Error(`Unknown argument: ${arg}`);
  }

  return args;
}

if (path.resolve(process.argv[1] || "") === scriptPath) {
  try {
    const args = parseCliArgs(process.argv.slice(2));
    const result = checkReleaseConsistency(args);
    const output = formatReleaseConsistencyResult(result);

    if (result.ok) {
      console.log(output);
    } else {
      console.error(output);
      process.exitCode = 1;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
  }
}
