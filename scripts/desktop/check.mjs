import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeExecutableName, resolveTargetPlatform } from "./runtime.mjs";
import { auditTree } from "./audit.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const runtimeRoot = path.join(desktopRoot, "runtime");
const configPath = path.join(desktopRoot, "src-tauri", "tauri.conf.json");
const capabilityPath = path.join(desktopRoot, "src-tauri", "capabilities", "default.json");
const cargoPath = path.join(desktopRoot, "src-tauri", "Cargo.toml");
const packagePath = path.join(repoRoot, "packages", "agentos", "package.json");
const targetPlatform = resolveTargetPlatform();
const nodeBinaryPath = targetPlatform === "win32"
  ? path.join(runtimeRoot, "node", nodeExecutableName(targetPlatform))
  : path.join(runtimeRoot, "node", "bin", nodeExecutableName(targetPlatform));

const config = JSON.parse(await readFile(configPath, "utf8"));
const capabilities = JSON.parse(await readFile(capabilityPath, "utf8"));
const packageMetadata = JSON.parse(await readFile(packagePath, "utf8"));
const cargoManifest = await readFile(cargoPath, "utf8");
const runtimeMetadata = JSON.parse(await readFile(path.join(runtimeRoot, "metadata.json"), "utf8"));
const requiredPaths = [
  path.join(desktopRoot, "bootstrap", "index.html"),
  path.join(desktopRoot, "src-tauri", "Cargo.toml"),
  path.join(desktopRoot, "src-tauri", "src", "main.rs"),
  path.join(runtimeRoot, "agentos", "server.js"),
  path.join(runtimeRoot, "agentos", "agentos-desktop-server.cjs"),
  path.join(runtimeRoot, "agentos", ".next", "static"),
  path.join(runtimeRoot, "agentos", "public"),
  nodeBinaryPath
];

for (const filePath of requiredPaths) {
  await access(filePath).catch(() => {
    throw new Error(`Desktop runtime is incomplete; missing ${filePath}. Run pnpm desktop:prepare first.`);
  });
}

const cargoVersion = /^version\s*=\s*"([^"]+)"/m.exec(cargoManifest)?.[1];
if (!cargoVersion || cargoVersion !== packageMetadata.version || config.version !== packageMetadata.version) {
  throw new Error(
    `Desktop version drift detected: package=${packageMetadata.version}, Cargo=${cargoVersion ?? "missing"}, Tauri=${config.version ?? "missing"}.`
  );
}

if (runtimeMetadata.nodeSource === "official" && !/^[0-9a-f]{64}$/i.test(runtimeMetadata.nodeSha256 ?? "")) {
  throw new Error("Official packaged Node runtime is missing its verified SHA-256 metadata.");
}

const permissions = config.app?.security?.permissions ?? config.app?.security?.capabilities ?? [];
if (JSON.stringify(permissions).match(/shell|fs|process/i)) {
  throw new Error("Desktop security configuration must not grant shell, filesystem, or process permissions to the WebView.");
}

if (!Array.isArray(capabilities.permissions) || capabilities.permissions.length !== 0) {
  throw new Error("The AgentOS desktop WebView must keep application-defined Tauri permissions empty.");
}

await auditTree(runtimeRoot);

if (config.bundle?.createUpdaterArtifacts !== true) {
  throw new Error("Production desktop configuration must generate signed updater artifacts.");
}

if (!config.plugins?.updater?.pubkey || !config.plugins?.updater?.endpoints?.some((endpoint) => endpoint.includes("latest-{{target}}.json"))) {
  throw new Error("Updater configuration must contain a public key and the release latest-{{target}}.json endpoint.");
}

if (!JSON.stringify(config.bundle?.resources ?? {}).includes("agentos-runtime")) {
  throw new Error("Tauri resources do not include the packaged AgentOS runtime.");
}

console.log("Desktop shell checks passed: bootstrap, standalone payload, Node runtime, and least-privilege configuration are present.");
