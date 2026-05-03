import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";

const rootDir = process.cwd();

function toProjectPath(filePath: string) {
  return path.relative(rootDir, filePath).split(path.sep).join("/");
}

function walkFiles(dir: string, predicate: (filePath: string) => boolean) {
  const files: string[] = [];

  for (const entry of readdirSync(dir)) {
    const filePath = path.join(dir, entry);
    const stat = statSync(filePath);

    if (stat.isDirectory()) {
      files.push(...walkFiles(filePath, predicate));
      continue;
    }

    if (stat.isFile() && predicate(filePath)) {
      files.push(filePath);
    }
  }

  return files;
}

function readProjectSourceFiles(dirs: string[]) {
  return dirs.flatMap((dir) =>
    walkFiles(path.join(rootDir, dir), (filePath) => /\.(ts|tsx)$/.test(filePath))
  );
}

test("OpenClaw production code does not import the legacy service entrypoint", () => {
  const productionFiles = readProjectSourceFiles(["app", "components", "hooks", "lib"]).filter(
    (filePath) => toProjectPath(filePath) !== "lib/openclaw/service.ts"
  );
  const offenders = productionFiles
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /from\s+["'][^"']*openclaw\/service["']/.test(source);
    })
    .map(toProjectPath);

  assert.deepEqual(offenders, []);
});

test("app, components, and hooks do not import low-level OpenClaw clients directly", () => {
  const allowedTransitionalApiRoutes = new Set([
    "app/api/models/providers/route.ts",
    "app/api/onboarding/models/route.ts",
    "app/api/onboarding/route.ts",
    "app/api/settings/openclaw-binary/route.ts",
    "app/api/update/route.ts"
  ]);
  const forbidden = [
    "@/lib/openclaw/cli",
    "@/lib/openclaw/client/cli-gateway-client",
    "@/lib/openclaw/client/native-ws-gateway-client",
    "@/lib/openclaw/client/gateway-client-factory"
  ];
  const offenders = readProjectSourceFiles(["app", "components", "hooks"])
    .filter((filePath) => !allowedTransitionalApiRoutes.has(toProjectPath(filePath)))
    .flatMap((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return forbidden
        .filter((specifier) => source.includes(`from "${specifier}"`) || source.includes(`from '${specifier}'`))
        .map((specifier) => `${toProjectPath(filePath)} -> ${specifier}`);
    })
    .sort();

  assert.deepEqual(offenders, []);
});

test("OpenClaw direct CLI JSON usage remains in documented fallback/discovery files", () => {
  const allowed = new Set([
    "lib/openclaw/cli.ts",
    "lib/openclaw/client/cli-gateway-client.ts",
    "lib/openclaw/domains/agent-config.ts",
    "lib/openclaw/domains/channels.ts",
    "lib/openclaw/application/settings-service.ts",
    "lib/openclaw/planner.ts",
    "lib/openclaw/surface-adapters.ts"
  ]);
  const offenders = readProjectSourceFiles(["lib/openclaw"])
    .filter((filePath) => readFileSync(filePath, "utf8").includes("runOpenClawJson"))
    .map(toProjectPath)
    .filter((filePath) => !allowed.has(filePath));

  assert.deepEqual(offenders, []);
});

test("OpenClaw direct CLI command usage remains in documented fallback/provisioning files", () => {
  const allowed = new Set([
    "lib/openclaw/client/cli-gateway-client.ts",
    "lib/openclaw/domains/agent-config.ts",
    "lib/openclaw/domains/agent-provisioning.ts",
    "lib/openclaw/planner.ts",
    "lib/openclaw/reset.ts",
    "lib/openclaw/application/channel-service.ts"
  ]);
  const offenders = readProjectSourceFiles(["lib/openclaw"])
    .filter((filePath) => toProjectPath(filePath) !== "lib/openclaw/cli.ts")
    .filter((filePath) => {
      const source = readFileSync(filePath, "utf8");
      return /import\s+\{[^}]*\brunOpenClaw\b[^}]*\}\s+from\s+["']@\/lib\/openclaw\/cli["']/.test(source);
    })
    .map(toProjectPath)
    .filter((filePath) => !allowed.has(filePath));

  assert.deepEqual(offenders, []);
});

test("OpenClaw local module imports do not introduce cycles", () => {
  const files = readProjectSourceFiles(["lib/openclaw"]);
  const fileSet = new Set(files.map(toProjectPath));
  const graph = new Map<string, string[]>();

  for (const filePath of files) {
    const source = readFileSync(filePath, "utf8");
    const imports: string[] = [];
    const importPattern =
      /import(?:[\s\S]*?from\s*)?["']([^"']+)["']|export\s+\{[\s\S]*?\}\s+from\s*["']([^"']+)["']/g;
    let match: RegExpExecArray | null;

    while ((match = importPattern.exec(source))) {
      const specifier = match[1] ?? match[2];
      const resolved = resolveLocalOpenClawImport(filePath, specifier);

      if (resolved && fileSet.has(resolved)) {
        imports.push(resolved);
      }
    }

    graph.set(toProjectPath(filePath), imports);
  }

  const cycles = findCycles(graph);

  assert.deepEqual(cycles, []);
});

function resolveLocalOpenClawImport(filePath: string, specifier: string) {
  if (specifier.startsWith("@/")) {
    return `${specifier.slice(2)}.ts`;
  }

  if (!specifier.startsWith(".")) {
    return null;
  }

  return `${toProjectPath(path.resolve(path.dirname(filePath), specifier))}.ts`;
}

function findCycles(graph: Map<string, string[]>) {
  const cycles: string[][] = [];
  const seen = new Set<string>();
  const active = new Set<string>();
  const stack: string[] = [];

  function visit(node: string) {
    seen.add(node);
    active.add(node);
    stack.push(node);

    for (const next of graph.get(node) ?? []) {
      if (!seen.has(next)) {
        visit(next);
        continue;
      }

      if (active.has(next)) {
        cycles.push([...stack.slice(stack.indexOf(next)), next]);
      }
    }

    stack.pop();
    active.delete(node);
  }

  for (const node of graph.keys()) {
    if (!seen.has(node)) {
      visit(node);
    }
  }

  return cycles.map((cycle) => cycle.join(" -> ")).sort();
}
