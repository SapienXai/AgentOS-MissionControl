import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "../..");
const runtimeRoot = path.join(repoRoot, "apps", "desktop", "runtime");
const bundleRoot = path.join(repoRoot, "apps", "desktop", "src-tauri", "target", "release", "bundle");
const explicitRoot = process.env.AGENTOS_DESKTOP_AUDIT_ROOT?.trim();

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const roots = [runtimeRoot];
  if (explicitRoot) roots.push(path.resolve(explicitRoot));
  await addMacAppResources(bundleRoot, roots);

  let auditedFiles = 0;
  for (const root of roots) {
    if (!(await pathExists(root))) continue;
    auditedFiles += await auditTree(root);
  }

  console.log(`Desktop package-content audit passed for ${roots.length} root(s) and ${auditedFiles} file(s).`);
}

async function addMacAppResources(root, rootsToAudit) {
  if (!(await pathExists(root))) return;
  const resources = path.join(root, "macos", "AgentOS.app", "Contents", "Resources");
  if (await pathExists(resources)) rootsToAudit.push(resources);
}

export async function auditTree(root) {
  const pending = [root];
  let files = 0;

  while (pending.length > 0) {
    const current = pending.pop();
    const entries = await readdir(current, { withFileTypes: true });

    for (const entry of entries) {
      const target = path.join(current, entry.name);
      const relative = path.relative(root, target);
      if (isForbiddenPath(relative)) {
        throw new Error(`Forbidden release content found in ${root}: ${relative}`);
      }
      if (entry.isDirectory()) {
        pending.push(target);
        continue;
      }

      files += 1;
      if (looksLikeSecretFile(entry.name)) {
        const content = await readFile(target, { encoding: "utf8" }).catch(() => "");
        if (containsPrivateMaterial(content)) {
          throw new Error(`Private credential material found in ${root}: ${relative}`);
        }
      }
    }
  }

  return files;
}

function isForbiddenPath(relativePath) {
  return relativePath.split(path.sep).some((segment) =>
      segment === ".git"
      || segment === ".desktop-cache"
      || /^\.env(?:\.|$)/i.test(segment)
      || /(?:^|[-_.])(?:private|secret|credential|signing)[-_.].*key/i.test(segment)
      || /(?:tauri|signing).*(?:private|secret).*key/i.test(segment)
  );
}

function looksLikeSecretFile(name) {
  return /(?:\.pem$|\.p12$|\.pfx$|\.key$|private|secret|credential|token)/i.test(name);
}

function containsPrivateMaterial(content) {
  return /BEGIN (?:RSA |EC |OPENSSH |DSA )?PRIVATE KEY|TAURI_SIGNING_PRIVATE_KEY|(?:NPM|NODE_AUTH)_TOKEN/i.test(content);
}

async function pathExists(target) {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}
