import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");

const env = sanitizePathEnv(process.env);

await runCommand(resolvePnpmCommand(), ["exec", "next", "build", "--webpack"], {
  cwd: repoRoot,
  env
});

await runCommand(process.execPath, [path.join(scriptDir, "prepare-bundle.mjs")], {
  cwd: packageDir,
  env
});

function resolvePnpmCommand() {
  return process.platform === "win32" ? "pnpm.cmd" : "pnpm";
}

function sanitizePathEnv(sourceEnv) {
  const env = { ...sourceEnv };

  if (process.platform !== "win32") {
    return env;
  }

  const pathKey = Object.keys(env).find((key) => key.toLowerCase() === "path") ?? "Path";
  const rawPath = env[pathKey];

  if (!rawPath) {
    return env;
  }

  const keptEntries = [];
  let removedCount = 0;

  for (const rawEntry of rawPath.split(path.delimiter)) {
    const entry = unquotePathEntry(rawEntry);

    if (!entry) {
      continue;
    }

    try {
      const stats = fs.statSync(entry);

      if (stats.isDirectory()) {
        keptEntries.push(entry);
        continue;
      }
    } catch {}

    removedCount += 1;
  }

  if (keptEntries.length > 0) {
    env[pathKey] = keptEntries.join(path.delimiter);
  }

  if (removedCount > 0) {
    const suffix = removedCount === 1 ? "entry" : "entries";
    console.log(`Sanitized PATH for prepack by dropping ${removedCount} non-directory ${suffix}.`);
  }

  return env;
}

function unquotePathEntry(value) {
  const trimmed = value.trim();

  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }

  return trimmed;
}

function runCommand(command, args, options) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      ...options,
      stdio: "inherit"
    });

    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) {
        resolve();
        return;
      }

      if (signal) {
        reject(new Error(`Command was terminated by signal ${signal}: ${command}`));
        return;
      }

      reject(new Error(`Command failed with exit code ${code}: ${command} ${args.join(" ")}`));
    });
  });
}
