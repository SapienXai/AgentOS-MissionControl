import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { nodeExecutableName, resolveTargetPlatform } from "./runtime.mjs";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const desktopRoot = path.join(repoRoot, "apps", "desktop");
const runtimeRoot = path.join(desktopRoot, "runtime");
const configPath = path.join(desktopRoot, "src-tauri", "tauri.conf.json");
const targetPlatform = resolveTargetPlatform();
const nodeBinaryPath = targetPlatform === "win32"
  ? path.join(runtimeRoot, "node", nodeExecutableName(targetPlatform))
  : path.join(runtimeRoot, "node", "bin", nodeExecutableName(targetPlatform));

const config = JSON.parse(await readFile(configPath, "utf8"));
const requiredPaths = [
  path.join(desktopRoot, "bootstrap", "index.html"),
  path.join(desktopRoot, "src-tauri", "Cargo.toml"),
  path.join(desktopRoot, "src-tauri", "src", "main.rs"),
  path.join(runtimeRoot, "agentos", "server.js"),
  path.join(runtimeRoot, "agentos", ".next", "static"),
  path.join(runtimeRoot, "agentos", "public"),
  nodeBinaryPath
];

for (const filePath of requiredPaths) {
  await access(filePath).catch(() => {
    throw new Error(`Desktop runtime is incomplete; missing ${filePath}. Run pnpm desktop:prepare first.`);
  });
}

const permissions = config.app?.security?.permissions ?? config.app?.security?.capabilities ?? [];
if (JSON.stringify(permissions).match(/shell|fs|process/i)) {
  throw new Error("Desktop security configuration must not grant shell, filesystem, or process permissions to the WebView.");
}

if (!JSON.stringify(config.bundle?.resources ?? {}).includes("agentos-runtime")) {
  throw new Error("Tauri resources do not include the packaged AgentOS runtime.");
}

console.log("Desktop shell checks passed: bootstrap, standalone payload, Node runtime, and least-privilege configuration are present.");
