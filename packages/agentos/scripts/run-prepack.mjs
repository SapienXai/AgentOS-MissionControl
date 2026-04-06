import { spawn } from "node:child_process";
import fs from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");
const require = createRequire(import.meta.url);

const env = sanitizePathEnv(process.env);

await runCommand(process.execPath, [resolveNextCliPath(), "build", "--webpack"], {
  cwd: repoRoot,
  env
});

await runCommand(process.execPath, [path.join(scriptDir, "prepare-bundle.mjs")], {
  cwd: packageDir,
  env
});

function resolveNextCliPath() {
  return require.resolve("next/dist/bin/next", {
    paths: [repoRoot]
  });
}

function sanitizePathEnv(sourceEnv) {
  const env = { ...sourceEnv };

  if (process.platform !== "win32") {
    return env;
  }

  const pathKeys = Object.keys(env).filter((key) => key.toLowerCase() === "path");
  const rawPath = pathKeys.map((key) => env[key]).find(Boolean);

  if (!rawPath) {
    return env;
  }

  const keptEntries = [];
  let removedCount = 0;
  let removedWindowsAppsCount = 0;

  for (const rawEntry of rawPath.split(path.delimiter)) {
    const entry = unquotePathEntry(rawEntry);

    if (!entry) {
      continue;
    }

    if (isWindowsAppsPath(entry)) {
      removedWindowsAppsCount += 1;
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
    for (const key of pathKeys) {
      delete env[key];
    }

    env.Path = keptEntries.join(path.delimiter);
  }

  if (removedCount > 0) {
    const suffix = removedCount === 1 ? "entry" : "entries";
    console.log(`Sanitized PATH for prepack by dropping ${removedCount} non-directory ${suffix}.`);
  }

  if (removedWindowsAppsCount > 0) {
    const suffix = removedWindowsAppsCount === 1 ? "directory" : "directories";
    console.log(`Sanitized PATH for prepack by dropping ${removedWindowsAppsCount} WindowsApps ${suffix}.`);
  }

  return env;
}

function isWindowsAppsPath(value) {
  return /[\\/]microsoft[\\/]windowsapps$/i.test(value.replace(/[\\/]+$/, ""));
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
