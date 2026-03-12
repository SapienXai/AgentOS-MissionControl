import { cp, mkdir, readdir, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const packageDir = path.resolve(scriptDir, "..");
const repoRoot = path.resolve(packageDir, "..", "..");

const standaloneDir = path.join(repoRoot, ".next", "standalone");
const staticDir = path.join(repoRoot, ".next", "static");
const publicDir = path.join(repoRoot, "public");
const bundleDir = path.join(packageDir, "bundle");
const bundleNodeModulesDir = path.join(bundleDir, "node_modules");

await rm(bundleDir, { recursive: true, force: true });
await mkdir(bundleDir, { recursive: true });

await copyDirectoryContents(standaloneDir, bundleDir);
await materializeBundleNodeModules(bundleNodeModulesDir);
await cp(staticDir, path.join(bundleDir, ".next", "static"), {
  recursive: true,
  dereference: true
});
await cp(publicDir, path.join(bundleDir, "public"), {
  recursive: true,
  dereference: true
});
await rm(path.join(bundleDir, ".mission-control"), { recursive: true, force: true });
await removeDotStoreFiles(bundleDir);

console.log(`Prepared AgentOS bundle at ${bundleDir}`);

async function copyDirectoryContents(sourceDir, targetDir) {
  const entries = await readdir(sourceDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceDir, entry.name);
    const targetPath = path.join(targetDir, entry.name);

    if (entry.isDirectory()) {
      await cp(sourcePath, targetPath, {
        recursive: true,
        dereference: true
      });
      continue;
    }

    await cp(sourcePath, targetPath, {
      dereference: true
    });
  }
}

async function materializeBundleNodeModules(nodeModulesDir) {
  const pnpmStoreDir = path.join(nodeModulesDir, ".pnpm");
  const storeEntries = await readdir(pnpmStoreDir, { withFileTypes: true });

  for (const storeEntry of storeEntries) {
    if (!storeEntry.isDirectory()) {
      continue;
    }

    const storeNodeModulesDir = path.join(pnpmStoreDir, storeEntry.name, "node_modules");

    try {
      await copyNestedPackagesToRoot(storeNodeModulesDir, nodeModulesDir);
    } catch {
      continue;
    }
  }

  await rm(pnpmStoreDir, { recursive: true, force: true });
}

async function copyNestedPackagesToRoot(sourceNodeModulesDir, targetNodeModulesDir) {
  const entries = await readdir(sourceNodeModulesDir, { withFileTypes: true });

  for (const entry of entries) {
    const sourcePath = path.join(sourceNodeModulesDir, entry.name);
    const targetPath = path.join(targetNodeModulesDir, entry.name);

    if (entry.name.startsWith("@") && entry.isDirectory()) {
      await mkdir(targetPath, { recursive: true });
      await copyNestedPackagesToRoot(sourcePath, targetPath);
      continue;
    }

    await rm(targetPath, { recursive: true, force: true });
    await cp(sourcePath, targetPath, {
      recursive: true,
      dereference: true
    });
  }
}

async function removeDotStoreFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });

  for (const entry of entries) {
    const targetPath = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      await removeDotStoreFiles(targetPath);
      continue;
    }

    if (entry.name === ".DS_Store") {
      await rm(targetPath, { force: true });
    }
  }
}
