import "server-only";

import { execFile, spawn } from "node:child_process";
import { readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { runOpenClaw } from "@/lib/openclaw/cli";
import {
  clearMissionControlCaches,
  deleteAgent,
  deleteWorkspaceProject,
  getMissionControlSnapshot
} from "@/lib/agentos/control-plane";
import type {
  MissionControlSnapshot,
  ResetPreview,
  ResetPreviewPackageAction,
  ResetPreviewWorkspace,
  ResetStreamEvent,
  ResetTarget
} from "@/lib/openclaw/types";

const execFileAsync = promisify(execFile);

const missionControlRootPath = path.join(process.cwd(), ".mission-control");
const missionControlSettingsPath = path.join(missionControlRootPath, "settings.json");
const plannerRootPath = path.join(missionControlRootPath, "planner");
const plannerRuntimeWorkspacePath = path.join(plannerRootPath, "runtime-workspace");
const openClawStateRootPath = path.join(os.homedir(), ".openclaw");
const openClawDefaultWorkspacePath = path.join(openClawStateRootPath, "workspace-dev");
const browserStorageKeys = [
  "mission-control-surface-theme",
  "mission-control-workspace-plan-id",
  "mission-control-recent-prompts",
  "mission-control-composer-draft:*"
] as const;
const liveAgentStatuses = new Set(["engaged", "monitoring", "ready"]);

type ResetExecutionOptions = {
  onEvent?: (event: ResetStreamEvent) => Promise<void> | void;
};

type ResetExecutionResult = {
  message: string;
  snapshot?: MissionControlSnapshot;
  backgroundLogPath?: string;
};

export async function getResetPreview(target: ResetTarget): Promise<ResetPreview> {
  const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
  const workspaces = buildResetPreviewWorkspaces(snapshot, target);
  const workspaceIds = new Set(workspaces.map((workspace) => workspace.workspaceId));
  const packageActions = target === "full-uninstall" ? await detectPackageActions(snapshot) : [];
  const summary = {
    deleteFolderCount: workspaces.filter((workspace) => workspace.action === "delete-folder").length,
    metadataOnlyCount: workspaces.filter((workspace) => workspace.action === "clean-integration").length,
    agentCount: workspaces.reduce((total, workspace) => total + workspace.agentCount, 0),
    liveAgentCount: workspaces.reduce((total, workspace) => total + workspace.liveAgentCount, 0),
    activeRuntimeCount: snapshot.runtimes.filter((runtime) => {
      return (
        typeof runtime.workspaceId === "string" &&
        workspaceIds.has(runtime.workspaceId) &&
        (runtime.status === "running" || runtime.status === "queued")
      );
    }).length
  };
  const warnings = buildResetWarnings(target, workspaces, summary, packageActions);

  return {
    target,
    generatedAt: new Date().toISOString(),
    summary,
    workspaces,
    missionControlPaths: [missionControlSettingsPath, plannerRootPath],
    browserStorageKeys: [...browserStorageKeys],
    openClawPaths:
      target === "full-uninstall"
        ? [
            openClawStateRootPath,
            openClawDefaultWorkspacePath
          ]
        : [],
    packageActions,
    warnings
  };
}

export async function executeReset(
  target: ResetTarget,
  options: ResetExecutionOptions = {}
): Promise<ResetExecutionResult> {
  const preview = await getResetPreview(target);
  const emit = async (event: ResetStreamEvent) => {
    await options.onEvent?.(event);
  };

  await emit({
    type: "status",
    phase: "planning",
    message:
      target === "mission-control"
        ? "Preparing the AgentOS reset plan..."
        : "Preparing the full uninstall plan..."
  });
  await emit({
    type: "log",
    text: `Found ${preview.workspaces.length} workspace(s), ${preview.summary.agentCount} agent(s), and ${preview.summary.liveAgentCount} live agent(s).`
  });

  await runMissionControlReset(preview, emit);

  let backgroundLogPath: string | undefined;

  if (target === "full-uninstall") {
    await emit({
      type: "status",
      phase: "openclaw-state",
      message: "Removing the OpenClaw service and local state..."
    });

    const openClawResult = await runOpenClaw([
      "uninstall",
      "--service",
      "--state",
      "--yes",
      "--non-interactive"
    ]);

    if (openClawResult.stdout.trim()) {
      await emit({
        type: "log",
        text: openClawResult.stdout.trim()
      });
    }

    if (openClawResult.stderr.trim()) {
      await emit({
        type: "log",
        text: openClawResult.stderr.trim()
      });
    }

    const scheduledCommands = preview.packageActions
      .map((action) => action.command)
      .filter((command): command is string => typeof command === "string" && command.trim().length > 0);

    if (scheduledCommands.length > 0) {
      await emit({
        type: "status",
        phase: "package-removal",
        message: "Scheduling CLI cleanup for OpenClaw and AgentOS..."
      });

      backgroundLogPath = await scheduleBackgroundPackageRemoval(scheduledCommands);
      await emit({
        type: "log",
        text: `Background package removal scheduled. Log: ${backgroundLogPath}`
      });
    } else {
      await emit({
        type: "log",
        text: "No supported OpenClaw or AgentOS installs were detected for automatic cleanup."
      });
    }
  }

  await emit({
    type: "status",
    phase: "refreshing",
    message: "Refreshing the AgentOS snapshot..."
  });

  clearMissionControlCaches();

  const snapshot = await getMissionControlSnapshot({ force: true });

  return {
    message:
      target === "mission-control"
        ? "AgentOS reset completed."
        : backgroundLogPath
          ? "Full uninstall started. Final CLI cleanup is running in the background."
          : "Full uninstall completed for AgentOS and OpenClaw state.",
    snapshot,
    backgroundLogPath
  };
}

function buildResetPreviewWorkspaces(
  snapshot: MissionControlSnapshot,
  target: ResetTarget
): ResetPreviewWorkspace[] {
  const agentsByWorkspace = new Map<string, MissionControlSnapshot["agents"]>();
  const runtimesByWorkspace = new Map<string, MissionControlSnapshot["runtimes"]>();

  for (const workspace of snapshot.workspaces) {
    agentsByWorkspace.set(
      workspace.id,
      snapshot.agents.filter((agent) => agent.workspaceId === workspace.id)
    );
    runtimesByWorkspace.set(
      workspace.id,
      snapshot.runtimes.filter((runtime) => runtime.workspaceId === workspace.id)
    );
  }

  return snapshot.workspaces
    .map((workspace) => {
      if (target === "mission-control" && isOpenClawStateWorkspacePath(workspace.path)) {
        return null;
      }

      const agents = agentsByWorkspace.get(workspace.id) ?? [];
      const runtimes = runtimesByWorkspace.get(workspace.id) ?? [];
      const reasons: string[] = [];
      let action: ResetPreviewWorkspace["action"] = "clean-integration";
      const isOpenClawStateWorkspace = isOpenClawStateWorkspacePath(workspace.path);

      if (target === "full-uninstall" && isOpenClawStateWorkspace) {
        action = "delete-folder";
        reasons.push("OpenClaw local state workspace. Full uninstall removes this folder.");
      } else if (
        workspace.path === plannerRuntimeWorkspacePath ||
        workspace.path.startsWith(`${plannerRuntimeWorkspacePath}${path.sep}`)
      ) {
        action = "delete-folder";
        reasons.push("Planner runtime workspace managed by AgentOS.");
      } else if (workspace.bootstrap.sourceMode === "empty") {
        action = "delete-folder";
        reasons.push("AgentOS created this workspace from an empty folder.");
      } else if (workspace.bootstrap.sourceMode === "clone") {
        action = "delete-folder";
        reasons.push("AgentOS cloned and manages this workspace folder.");
      } else if (workspace.bootstrap.sourceMode === "existing") {
        action = "clean-integration";
        reasons.push("Attached existing folder. The folder stays, but OpenClaw and AgentOS integration files are removed.");
      } else {
        action = "clean-integration";
        reasons.push("Workspace origin is unknown. The folder stays, but OpenClaw and AgentOS integration files are removed.");
      }

      return {
        workspaceId: workspace.id,
        name: workspace.name,
        path: workspace.path,
        sourceMode: workspace.bootstrap.sourceMode,
        action,
        agentCount: agents.length,
        runtimeCount: runtimes.length,
        liveAgentCount: agents.filter((agent) => liveAgentStatuses.has(agent.status)).length,
        reasons
      };
    })
    .filter((workspace): workspace is ResetPreviewWorkspace => Boolean(workspace))
    .sort((left, right) => {
      if (left.action !== right.action) {
        return left.action === "delete-folder" ? -1 : 1;
      }

      return left.name.localeCompare(right.name);
    });
}

function buildResetWarnings(
  target: ResetTarget,
  workspaces: ResetPreviewWorkspace[],
  summary: ResetPreview["summary"],
  packageActions: ResetPreviewPackageAction[]
) {
  const warnings: string[] = [];

  if (summary.liveAgentCount > 0) {
    warnings.push(
      `${summary.liveAgentCount} live agent${summary.liveAgentCount === 1 ? "" : "s"} may be interrupted immediately.`
    );
  }

  if (summary.activeRuntimeCount > 0) {
    warnings.push(
      `${summary.activeRuntimeCount} active or queued runtime${summary.activeRuntimeCount === 1 ? "" : "s"} may stop mid-run.`
    );
  }

  const metadataOnlyWorkspaces = workspaces.filter((workspace) => workspace.action === "clean-integration").length;

  if (metadataOnlyWorkspaces > 0) {
    warnings.push(
      `${metadataOnlyWorkspaces} attached workspace folder${metadataOnlyWorkspaces === 1 ? "" : "s"} will be preserved. Only OpenClaw and AgentOS integration files will be removed there.`
    );
  }

  if (target === "full-uninstall" && packageActions.some((action) => !action.detected)) {
    warnings.push(
      "Some OpenClaw or AgentOS installs were not detected for automatic cleanup. Those may need manual removal."
    );
  }

  return warnings;
}

async function runMissionControlReset(
  preview: ResetPreview,
  emit: (event: ResetStreamEvent) => Promise<void>
) {
  const deleteFolderWorkspaces = preview.workspaces.filter((workspace) => workspace.action === "delete-folder");
  const metadataOnlyWorkspaces = preview.workspaces.filter((workspace) => workspace.action === "clean-integration");

  if (deleteFolderWorkspaces.length > 0) {
    await emit({
      type: "status",
      phase: "workspaces",
      message: "Removing managed workspace folders and their agents..."
    });

    for (const workspace of deleteFolderWorkspaces) {
      if (isOpenClawStateWorkspacePath(workspace.path)) {
        await emit({
          type: "log",
          text: `Skipping direct workspace deletion for ${workspace.name}. OpenClaw uninstall will remove ${workspace.path}.`
        });
        continue;
      }

      await emit({
        type: "log",
        text: `Deleting workspace folder: ${workspace.name} (${workspace.path})`
      });
      await deleteWorkspaceProject({
        workspaceId: workspace.workspaceId
      });
    }
  }

  if (metadataOnlyWorkspaces.length > 0) {
    await emit({
      type: "status",
      phase: "agents",
      message: "Detaching agents and cleaning integration files from attached workspaces..."
    });

    for (const workspace of metadataOnlyWorkspaces) {
      if (isOpenClawStateWorkspacePath(workspace.path)) {
        await emit({
          type: "log",
          text: `Skipping OpenClaw state workspace during AgentOS reset: ${workspace.name} (${workspace.path})`
        });
        continue;
      }

      const snapshot = await getMissionControlSnapshot({ force: true, includeHidden: true });
      const agents = snapshot.agents.filter((agent) => agent.workspaceId === workspace.workspaceId);

      for (const agent of agents) {
        try {
          await emit({
            type: "log",
            text: `Deleting agent: ${agent.id} (${workspace.name})`
          });
          await deleteAgent({
            agentId: agent.id
          });
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unknown agent delete error.";

          if (message.includes("cannot be deleted")) {
            await emit({
              type: "log",
              text: `Skipping protected agent: ${agent.id} (${workspace.name})`
            });
            continue;
          }

          throw error;
        }
      }

      const workspaceOpenClawPath = path.join(workspace.path, ".openclaw");
      await rm(workspaceOpenClawPath, { recursive: true, force: true });
      await emit({
        type: "log",
        text: `Removed integration directory: ${workspaceOpenClawPath}`
      });
    }
  }

  await emit({
    type: "status",
    phase: "mission-control-state",
    message: "Removing AgentOS planner and settings state..."
  });

  await rm(plannerRootPath, { recursive: true, force: true });
  await rm(missionControlSettingsPath, { force: true });
  await removePathIfEmpty(missionControlRootPath);

  await emit({
    type: "log",
    text: `Removed AgentOS state under ${missionControlRootPath}`
  });
}

async function detectPackageActions(
  snapshot: MissionControlSnapshot
): Promise<ResetPreviewPackageAction[]> {
  const actions: ResetPreviewPackageAction[] = [];
  const preferredManagers = uniqueStrings(
    [snapshot.diagnostics.updatePackageManager, "pnpm", "npm", "yarn"].filter(
      (value): value is string => typeof value === "string" && value.trim().length > 0
    )
  );
  const openClawPackageName = inferOpenClawPackageName(snapshot);

  if (
    snapshot.diagnostics.updateInstallKind === "package" &&
    snapshot.diagnostics.updatePackageManager &&
    (await canRunCommand(snapshot.diagnostics.updatePackageManager))
  ) {
    actions.push({
      packageName: openClawPackageName,
      manager: snapshot.diagnostics.updatePackageManager,
      command: buildPackageRemovalCommand(snapshot.diagnostics.updatePackageManager, openClawPackageName),
      detected: true,
      reason: "Detected from OpenClaw status."
    });
  } else {
    actions.push({
      packageName: openClawPackageName,
      manager: snapshot.diagnostics.updatePackageManager ?? null,
      command: null,
      detected: false,
      reason: "OpenClaw package manager could not be verified from status."
    });
  }

  actions.push(await detectAgentOsCleanupAction(preferredManagers));

  return actions;
}

async function detectAgentOsCleanupAction(
  preferredManagers: string[]
): Promise<ResetPreviewPackageAction> {
  const globalPackageAction = await detectGlobalPackageAction("@sapienx/agentos", preferredManagers);

  if (globalPackageAction.detected) {
    return globalPackageAction;
  }

  const releaseAction = await detectAgentOsReleaseAction();

  if (releaseAction) {
    return releaseAction;
  }

  return globalPackageAction;
}

async function detectGlobalPackageAction(
  packageName: string,
  preferredManagers: string[]
): Promise<ResetPreviewPackageAction> {
  for (const manager of preferredManagers) {
    if (!(await canRunCommand(manager))) {
      continue;
    }

    const rootPath = await getGlobalPackageRoot(manager);

    if (!rootPath) {
      continue;
    }

    const packagePath = path.join(rootPath, ...packageName.split("/"));

    if (await pathExists(packagePath)) {
      return {
        packageName,
        manager,
        command: buildPackageRemovalCommand(manager, packageName),
        detected: true,
        reason: `Detected under ${packagePath}.`
      };
    }
  }

  return {
    packageName,
    manager: null,
    command: null,
    detected: false,
    reason: "Not detected on supported global package managers."
  };
}

async function detectAgentOsReleaseAction(): Promise<ResetPreviewPackageAction | null> {
  const defaultScriptPath = path.join(os.homedir(), ".agentos", "package", "bin", "agentos.js");

  if (await pathExists(defaultScriptPath)) {
    return {
      packageName: "@sapienx/agentos",
      manager: null,
      command: buildAgentOsReleaseUninstallCommand(defaultScriptPath),
      detected: true,
      reason: `Detected AgentOS release install at ${path.dirname(path.dirname(defaultScriptPath))}.`
    };
  }

  const commandPath = await resolveCommandPath("agentos");

  if (!commandPath) {
    return null;
  }

  const launcherContents = await readTextFileIfExists(commandPath);
  const releaseScriptPath = inferAgentOsReleaseScriptPath(launcherContents);

  if (!releaseScriptPath || !(await pathExists(releaseScriptPath))) {
    return null;
  }

  return {
    packageName: "@sapienx/agentos",
    manager: null,
    command: buildAgentOsReleaseUninstallCommand(releaseScriptPath),
    detected: true,
    reason: `Detected AgentOS release launcher at ${commandPath}.`
  };
}

function inferOpenClawPackageName(snapshot: MissionControlSnapshot) {
  const updateRoot = snapshot.diagnostics.updateRoot?.trim();

  if (!updateRoot) {
    return "openclaw";
  }

  return path.basename(updateRoot) || "openclaw";
}

async function getGlobalPackageRoot(manager: string) {
  try {
    if (manager === "yarn") {
      const { stdout } = await execFileAsync("yarn", ["global", "dir"], {
        cwd: process.cwd(),
        timeout: 15000,
        maxBuffer: 1024 * 1024
      });

      const globalDir = stdout.toString().trim();
      return globalDir ? path.join(globalDir, "node_modules") : null;
    }

    const { stdout } = await execFileAsync(manager, ["root", "-g"], {
      cwd: process.cwd(),
      timeout: 15000,
      maxBuffer: 1024 * 1024
    });

    const globalRoot = stdout.toString().trim();
    return globalRoot || null;
  } catch {
    return null;
  }
}

async function canRunCommand(command: string) {
  try {
    await execFileAsync(command, ["--version"], {
      cwd: process.cwd(),
      timeout: 10000,
      maxBuffer: 512 * 1024
    });
    return true;
  } catch {
    return false;
  }
}

async function resolveCommandPath(command: string) {
  try {
    const locator = process.platform === "win32" ? "where" : "which";
    const { stdout } = await execFileAsync(locator, [command], {
      cwd: process.cwd(),
      timeout: 10000,
      maxBuffer: 512 * 1024
    });
    const firstMatch = stdout
      .toString()
      .split(/\r?\n/)
      .map((entry) => entry.trim())
      .find(Boolean);

    return firstMatch || null;
  } catch {
    return null;
  }
}

function buildAgentOsReleaseUninstallCommand(scriptPath: string) {
  return `node ${quoteShellArg(scriptPath)} uninstall --yes`;
}

function buildPackageRemovalCommand(manager: string, packageName: string) {
  const quotedPackageName = quoteShellArg(packageName);

  if (manager === "pnpm") {
    return `pnpm remove -g ${quotedPackageName}`;
  }

  if (manager === "yarn") {
    return `yarn global remove ${quotedPackageName}`;
  }

  return `${manager} uninstall -g ${quotedPackageName}`;
}

async function readTextFileIfExists(targetPath: string) {
  try {
    return await readFile(targetPath, "utf8");
  } catch {
    return null;
  }
}

function inferAgentOsReleaseScriptPath(launcherContents: string | null) {
  if (!launcherContents) {
    return null;
  }

  const normalized = launcherContents.replaceAll("\\", "/");
  const quotedMatch = normalized.match(/["']([^"'\r\n]*\/package\/bin\/agentos\.js)["']/i);
  const bareMatch = normalized.match(/(?:^|[\s(])([^"'()\r\n]*\/package\/bin\/agentos\.js)(?:$|[\s)])/i);
  const candidate = quotedMatch?.[1] ?? bareMatch?.[1];

  if (!candidate) {
    return null;
  }

  if (candidate.includes("/node_modules/") || candidate.includes("/.pnpm/")) {
    return null;
  }

  return path.normalize(candidate);
}

async function scheduleBackgroundPackageRemoval(commands: string[]) {
  const timestamp = Date.now();
  const scriptPath = path.join(os.tmpdir(), `agentos-full-uninstall-${timestamp}.sh`);
  const logPath = path.join(os.tmpdir(), `agentos-full-uninstall-${timestamp}.log`);
  const commandLines = commands.flatMap((command) => [
    `printf 'Running: %s\\n' ${quoteShellArg(command)}`,
    `if ${command}; then`,
    `  printf 'Completed: %s\\n' ${quoteShellArg(command)}`,
    "else",
    "  status=$?",
    `  printf 'Failed (exit %s): %s\\n' \"$status\" ${quoteShellArg(command)}`,
    "fi"
  ]);
  const scriptContents = [
    "#!/bin/sh",
    `exec >>${quoteShellArg(logPath)} 2>&1`,
    "sleep 1",
    "set -u",
    ...commandLines,
    `rm -f ${quoteShellArg(scriptPath)}`
  ].join("\n");

  await writeFile(scriptPath, `${scriptContents}\n`, {
    encoding: "utf8",
    mode: 0o700
  });

  const child = spawn("/bin/sh", [scriptPath], {
    detached: true,
    stdio: "ignore",
    env: process.env
  });

  child.unref();

  return logPath;
}

async function removePathIfEmpty(targetPath: string) {
  try {
    const entries = await readdir(targetPath);

    if (entries.length === 0) {
      await rm(targetPath, { recursive: true, force: true });
    }
  } catch {
    // Ignore missing or concurrently removed directories.
  }
}

async function pathExists(targetPath: string) {
  try {
    await stat(targetPath);
    return true;
  } catch {
    return false;
  }
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values));
}

function quoteShellArg(value: string) {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isOpenClawStateWorkspacePath(workspacePath: string) {
  return (
    workspacePath === openClawDefaultWorkspacePath ||
    workspacePath.startsWith(`${openClawStateRootPath}${path.sep}`)
  );
}
