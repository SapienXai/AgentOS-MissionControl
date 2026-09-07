import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

const outputArgument = process.argv.find((value) => value.startsWith("--output="));
const outputPath = path.resolve(
  process.cwd(),
  outputArgument?.slice("--output=".length) || "apps/desktop/src-tauri/tauri.release.generated.json"
);
const publicKey = process.env.AGENTOS_TAURI_UPDATER_PUBKEY?.trim();
const endpoint = process.env.AGENTOS_TAURI_UPDATER_ENDPOINT?.trim();

if (!publicKey || !endpoint) {
  console.error("Signed desktop release configuration requires AGENTOS_TAURI_UPDATER_PUBKEY and AGENTOS_TAURI_UPDATER_ENDPOINT.");
  process.exit(1);
}

const configPath = path.resolve(process.cwd(), "apps/desktop/src-tauri/tauri.conf.json");
const capabilityPath = path.resolve(process.cwd(), "apps/desktop/src-tauri/capabilities/release.generated.json");
const config = JSON.parse(await readFile(configPath, "utf8"));
config.plugins = {
  ...(config.plugins || {}),
  updater: {
    pubkey: publicKey,
    endpoints: [endpoint]
  }
};

await mkdir(path.dirname(outputPath), { recursive: true });
await writeFile(capabilityPath, JSON.stringify({
  $schema: "../gen/schemas/desktop-schema.json",
  identifier: "release",
  description: "Signed-release-only updater capability.",
  windows: ["main"],
  permissions: ["updater:default"]
}, null, 2) + "\n", "utf8");
await writeFile(outputPath, JSON.stringify(config, null, 2) + "\n", "utf8");
console.log("Prepared signed desktop release configuration at " + outputPath + ".");
