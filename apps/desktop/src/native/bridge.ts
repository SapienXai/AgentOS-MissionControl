import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { disable as disableAutostart, enable as enableAutostart, isEnabled as isAutostartEnabled } from "@tauri-apps/plugin-autostart";
import { check as checkForUpdate, type Update } from "@tauri-apps/plugin-updater";

import type { GitSummary, LocalWorkspace, OllamaStatus, TerminalOutput, TerminalSession, WorkspaceEntry } from "@/lib/agentos/local-workspace";
import type { PlatformCapabilities } from "@/lib/agentos/platform";
import type { RuntimeLogEntry, RuntimeStatus } from "@/lib/agentos/runtime-contract";

export type DesktopPlatformInfo = {
  platform: "desktop";
  capabilities: PlatformCapabilities;
  appVersion: string;
};

export class DesktopUnavailableError extends Error {
  constructor(message = "Native desktop capabilities are unavailable in the web preview.") {
    super(message);
    this.name = "DesktopUnavailableError";
  }
}

export async function getPlatformInfo() {
  return invoke<DesktopPlatformInfo>("platform_info").catch(() => {
    throw new DesktopUnavailableError();
  });
}

export async function getRuntimeStatus() { return invoke<RuntimeStatus>("runtime_status").catch(toDesktopError); }
export async function startRuntime() { return invoke<RuntimeStatus>("runtime_start").catch(toDesktopError); }
export async function stopRuntime() { return invoke<RuntimeStatus>("runtime_stop").catch(toDesktopError); }
export async function restartRuntime() { return invoke<RuntimeStatus>("runtime_restart").catch(toDesktopError); }
export async function runRuntimeDoctor() { return invoke<{ summary: string; issues: string[]; status: RuntimeStatus }>("runtime_doctor").catch(toDesktopError); }
export async function getRuntimeLogs() { return invoke<RuntimeLogEntry[]>("runtime_logs").catch(toDesktopError); }

export async function subscribeToRuntimeLogs(listener: (entry: RuntimeLogEntry) => void): Promise<UnlistenFn> {
  try {
    return await listen<RuntimeLogEntry>("runtime-log", (event) => listener(event.payload));
  } catch (error) {
    throw toDesktopError(error);
  }
}

export async function listWorkspaces() { return invoke<LocalWorkspace[]>("workspace_list").catch(toDesktopError); }
export async function chooseWorkspace() { return invoke<LocalWorkspace | null>("workspace_choose").catch(toDesktopError); }
export async function listWorkspaceEntries(workspaceId: string) { return invoke<WorkspaceEntry[]>("workspace_list_directory", { workspaceId }).catch(toDesktopError); }
export async function readWorkspaceFile(workspaceId: string, relativePath: string) { return invoke<string>("workspace_read_file", { workspaceId, relativePath }).catch(toDesktopError); }
export async function getGitSummary(workspaceId: string) { return invoke<GitSummary>("workspace_git_summary", { workspaceId }).catch(toDesktopError); }
export async function getOllamaStatus() { return invoke<OllamaStatus>("ollama_status").catch(toDesktopError); }
export async function writeWorkspaceFile(workspaceId: string, relativePath: string, contents: string) { return invoke<void>("workspace_write_file", { workspaceId, relativePath, contents }).catch(toDesktopError); }
export async function createWorkspaceDirectory(workspaceId: string, relativePath: string) { return invoke<void>("workspace_create_directory", { workspaceId, relativePath }).catch(toDesktopError); }
export async function renameWorkspacePath(workspaceId: string, from: string, to: string) { return invoke<void>("workspace_rename", { workspaceId, from, to }).catch(toDesktopError); }
export async function deleteWorkspacePath(workspaceId: string, relativePath: string, confirm: boolean) { return invoke<void>("workspace_delete", { workspaceId, relativePath, confirm }).catch(toDesktopError); }
export async function spawnTerminal(workspaceId: string, cols = 120, rows = 32) { return invoke<TerminalSession>("terminal_spawn", { workspaceId, cols, rows }).catch(toDesktopError); }
export async function writeTerminal(sessionId: string, data: string) { return invoke<void>("terminal_write", { sessionId, data }).catch(toDesktopError); }
export async function resizeTerminal(sessionId: string, cols: number, rows: number) { return invoke<void>("terminal_resize", { sessionId, cols, rows }).catch(toDesktopError); }
export async function killTerminal(sessionId: string) { return invoke<void>("terminal_kill", { sessionId }).catch(toDesktopError); }
export async function subscribeToTerminalOutput(listener: (output: TerminalOutput) => void): Promise<UnlistenFn> {
  try {
    return await listen<TerminalOutput>("terminal-output", (event) => listener(event.payload));
  } catch (error) {
    throw toDesktopError(error);
  }
}
export async function getAutostartEnabled() { return isAutostartEnabled().catch(toDesktopError); }
export async function setAutostartEnabled(enabled: boolean) { return (enabled ? enableAutostart() : disableAutostart()).catch(toDesktopError); }
export async function notifyDesktop(event: "runtime-crashed" | "approval-required" | "mission-completed" | "agent-blocked" | "critical-error") { return invoke<void>("native_notify", { event }).catch(toDesktopError); }
export async function checkForDesktopUpdate() { return checkForUpdate({ timeout: 8_000 }).catch(toDesktopError); }
export async function installDesktopUpdate(update: Update) { return update.downloadAndInstall().catch(toDesktopError); }
export async function getInitialDeepLinks() { return invoke<string[]>("deep_link_current").catch(toDesktopError); }
export async function subscribeToDeepLinks(listener: (route: string) => void): Promise<UnlistenFn> {
  try {
    return await listen<string>("deep-link", (event) => listener(event.payload));
  } catch (error) {
    throw toDesktopError(error);
  }
}
export async function setSecureSecret(key: string, value: string) { return invoke<void>("secure_set", { key, value }).catch(toDesktopError); }

function toDesktopError(error: unknown): never {
  if (error instanceof DesktopUnavailableError) throw error;
  const message = typeof error === "string"
    ? error
    : error instanceof Error
      ? error.message
      : error && typeof error === "object" && "message" in error && typeof error.message === "string"
        ? error.message
        : "Native desktop command failed.";
  if (message.includes("reading 'invoke'") || message.includes("__TAURI")) {
    throw new DesktopUnavailableError();
  }
  throw new Error(message);
}
