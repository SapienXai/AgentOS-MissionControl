"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AlertTriangle,
  Braces,
  ChevronDown,
  FileText,
  Info,
  Loader2,
  PlusCircle,
  RefreshCw,
  Save,
  Undo2,
  Users
} from "lucide-react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { toast } from "@/components/ui/sonner";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type {
  WorkspaceManagedFile,
  WorkspaceManagedFileCategory,
  WorkspaceManagedFileListResponse,
  WorkspaceManagedFileReadResponse
} from "@/lib/openclaw/workspace-file-types";
import { cn } from "@/lib/utils";

type WorkspaceDialogAgent = MissionControlSnapshot["agents"][number];
type AgentFileGroupData = {
  agent: WorkspaceDialogAgent;
  files: WorkspaceManagedFile[];
};

const categoryLabels: Record<WorkspaceManagedFileCategory, string> = {
  context: "Context",
  memory: "Memory",
  identity: "Identity",
  tools: "Tools",
  boot: "Boot",
  skills: "Skills",
  "project-config": "Project Config",
  "agent-policy-config": "Agent Policy/Config"
};

export function WorkspaceContextFilesDialog({
  snapshot,
  workspaceId,
  open,
  onOpenChange
}: {
  snapshot: MissionControlSnapshot;
  workspaceId: string | null;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const workspace = useMemo(
    () => snapshot.workspaces.find((entry) => entry.id === workspaceId) ?? null,
    [snapshot.workspaces, workspaceId]
  );
  const [files, setFiles] = useState<WorkspaceManagedFile[]>([]);
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [selectedFile, setSelectedFile] = useState<WorkspaceManagedFile | null>(null);
  const [content, setContent] = useState("");
  const [savedContent, setSavedContent] = useState("");
  const [isLoadingList, setIsLoadingList] = useState(false);
  const [isLoadingFile, setIsLoadingFile] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [maxFileBytes, setMaxFileBytes] = useState<number | null>(null);
  const [workspaceFilesExpanded, setWorkspaceFilesExpanded] = useState(true);
  const [expandedAgentIds, setExpandedAgentIds] = useState<string[]>([]);
  const [isInfoOpen, setIsInfoOpen] = useState(false);
  const hasUnsavedChanges = content !== savedContent;
  const activeFile = selectedFile ?? files.find((file) => file.path === selectedPath) ?? null;
  const canEditActiveFile = Boolean(activeFile?.editable && !isLoadingFile);
  const workspaceAgents = useMemo(() => {
    if (!workspaceId) {
      return [];
    }

    const agents = snapshot.agents.filter((agent) => agent.workspaceId === workspaceId);
    const workspaceAgentOrder = new Map(
      (workspace?.agentIds ?? []).map((agentId, index) => [agentId, index])
    );

    return agents.toSorted(
      (left, right) =>
        (workspaceAgentOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (workspaceAgentOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) ||
        left.name.localeCompare(right.name)
    );
  }, [snapshot.agents, workspace?.agentIds, workspaceId]);
  const fileNavigation = useMemo(
    () => buildFileNavigation(files, workspaceAgents),
    [files, workspaceAgents]
  );
  const activeFileAgentId = useMemo(
    () => (activeFile ? getWorkspaceManagedFileAgentId(activeFile, workspaceAgents) : null),
    [activeFile, workspaceAgents]
  );
  const activeFileIsWorkspaceFile = Boolean(activeFile && !activeFileAgentId);

  const refreshFiles = useCallback(async () => {
    if (!workspaceId) {
      return;
    }

    setIsLoadingList(true);
    setError(null);

    try {
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`, {
        cache: "no-store"
      });
      const result = (await response.json()) as WorkspaceManagedFileListResponse & { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "Workspace file list could not be loaded.");
      }

      setFiles(result.files);
      setMaxFileBytes(result.maxFileBytes);
      setSelectedPath((current) => {
        if (current && result.files.some((file) => file.path === current)) {
          return current;
        }

        return chooseInitialFilePath(result.files);
      });
    } catch (loadError) {
      setFiles([]);
      setSelectedPath(null);
      setSelectedFile(null);
      setContent("");
      setSavedContent("");
      setError(loadError instanceof Error ? loadError.message : "Workspace file list could not be loaded.");
    } finally {
      setIsLoadingList(false);
    }
  }, [workspaceId]);

  useEffect(() => {
    if (!open || !workspaceId) {
      setFiles([]);
      setSelectedPath(null);
      setSelectedFile(null);
      setContent("");
      setSavedContent("");
      setError(null);
      setWorkspaceFilesExpanded(true);
      setExpandedAgentIds([]);
      setIsInfoOpen(false);
      return;
    }

    void refreshFiles();
  }, [open, refreshFiles, workspaceId]);

  useEffect(() => {
    setIsInfoOpen(false);
  }, [selectedPath]);

  useEffect(() => {
    if (!activeFileAgentId) {
      return;
    }

    setExpandedAgentIds((current) =>
      current.includes(activeFileAgentId) ? current : [...current, activeFileAgentId]
    );
  }, [activeFileAgentId]);

  useEffect(() => {
    if (activeFileIsWorkspaceFile) {
      setWorkspaceFilesExpanded(true);
    }
  }, [activeFileIsWorkspaceFile]);

  useEffect(() => {
    if (!open || !workspaceId || !selectedPath) {
      return;
    }

    let cancelled = false;
    setIsLoadingFile(true);
    setError(null);

    void (async () => {
      try {
        const response = await fetch(
          `/api/workspaces/${encodeURIComponent(workspaceId)}/files?path=${encodeURIComponent(selectedPath)}`,
          { cache: "no-store" }
        );
        const result = (await response.json()) as WorkspaceManagedFileReadResponse & { error?: string };

        if (!response.ok || result.error) {
          throw new Error(result.error || "Workspace file could not be loaded.");
        }

        if (cancelled) {
          return;
        }

        setSelectedFile(result.file);
        setFiles((current) => replaceWorkspaceFile(current, result.file));
        setContent(result.content);
        setSavedContent(result.content);
        setMaxFileBytes(result.maxFileBytes);
      } catch (loadError) {
        if (cancelled) {
          return;
        }

        setSelectedFile(null);
        setContent("");
        setSavedContent("");
        setError(loadError instanceof Error ? loadError.message : "Workspace file could not be loaded.");
      } finally {
        if (!cancelled) {
          setIsLoadingFile(false);
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, selectedPath, workspaceId]);

  const selectFile = useCallback(
    (file: WorkspaceManagedFile) => {
      if (file.path === selectedPath) {
        return true;
      }

      if (hasUnsavedChanges && !window.confirm("Discard unsaved changes?")) {
        return false;
      }

      setSelectedPath(file.path);
      setSelectedFile(file);
      return true;
    },
    [hasUnsavedChanges, selectedPath]
  );
  const toggleAgent = useCallback(
    (agentId: string) => {
      const isExpanded = expandedAgentIds.includes(agentId);

      if (!isExpanded) {
        const firstFile = fileNavigation.agentFilesByAgentId.get(agentId)?.[0];

        if (firstFile && !selectFile(firstFile)) {
          return;
        }
      }

      setExpandedAgentIds((current) =>
        current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId]
      );
    },
    [expandedAgentIds, fileNavigation.agentFilesByAgentId, selectFile]
  );
  const toggleWorkspaceFiles = useCallback(() => {
    if (!workspaceFilesExpanded) {
      const firstFile = fileNavigation.workspaceFiles[0];

      if (firstFile && !selectFile(firstFile)) {
        return;
      }
    }

    setWorkspaceFilesExpanded((current) => !current);
  }, [fileNavigation.workspaceFiles, selectFile, workspaceFilesExpanded]);

  const saveFile = useCallback(async () => {
    if (!workspaceId || !activeFile || !activeFile.editable) {
      return;
    }

    if (maxFileBytes && new Blob([content]).size > maxFileBytes) {
      setError(`File exceeds ${formatFileSize(maxFileBytes)}.`);
      return;
    }

    if (activeFile.language === "json") {
      try {
        JSON.parse(content);
      } catch (jsonError) {
        setError(jsonError instanceof Error ? `Invalid JSON: ${jsonError.message}` : "Invalid JSON.");
        return;
      }
    }

    setIsSaving(true);
    setError(null);

    try {
      const wasCreated = !activeFile.exists;
      const response = await fetch(`/api/workspaces/${encodeURIComponent(workspaceId)}/files`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          path: activeFile.path,
          content
        })
      });
      const result = (await response.json()) as WorkspaceManagedFileReadResponse & { error?: string };

      if (!response.ok || result.error) {
        throw new Error(result.error || "Workspace file could not be saved.");
      }

      setSelectedFile(result.file);
      setFiles((current) => replaceWorkspaceFile(current, result.file));
      setContent(result.content);
      setSavedContent(result.content);
      setMaxFileBytes(result.maxFileBytes);
      toast.success(wasCreated ? "Workspace file created." : "Workspace file saved.");
    } catch (saveError) {
      const message = saveError instanceof Error ? saveError.message : "Workspace file could not be saved.";
      setError(message);
      toast.error("Workspace file save failed.", {
        description: message
      });
    } finally {
      setIsSaving(false);
    }
  }, [activeFile, content, maxFileBytes, workspaceId]);

  const discardChanges = useCallback(() => {
    setContent(savedContent);
    setError(null);
  }, [savedContent]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="flex h-[min(780px,calc(100vh-48px))] max-w-[min(1120px,calc(100vw-32px))] flex-col gap-0 overflow-hidden rounded-[24px] border-border bg-popover p-0 text-popover-foreground dark:border-white/10 dark:bg-slate-950 dark:text-white">
        <DialogHeader className="border-b border-border px-6 py-5 dark:border-white/10">
          <DialogTitle className="text-lg">OpenClaw Workspace Files</DialogTitle>
          <DialogDescription className="truncate">
            {workspace ? `${workspace.name} · ${workspace.path}` : "Workspace context, memory, policy, and config files."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[340px_minmax(0,1fr)]">
          <aside className="min-h-0 overflow-y-auto border-b border-border bg-muted/20 p-3 md:border-b-0 md:border-r dark:border-white/10 dark:bg-white/[0.02]">
            <div className="mb-3 flex items-center justify-between gap-3">
              <p className="text-xs font-medium uppercase tracking-[0.16em] text-muted-foreground dark:text-slate-400">Files</p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void refreshFiles()}
                disabled={isLoadingList || !workspaceId}
                className="h-8 rounded-xl px-2 text-xs"
              >
                <RefreshCw className={cn("mr-1.5 h-3.5 w-3.5", isLoadingList && "animate-spin")} />
                Refresh
              </Button>
            </div>

            {isLoadingList ? (
              <div className="flex items-center gap-2 rounded-2xl border border-border bg-background px-3 py-3 text-xs text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300">
                <Loader2 className="h-3.5 w-3.5 animate-spin" />
                Loading workspace files
              </div>
            ) : files.length === 0 ? (
              <div className="rounded-2xl border border-border bg-background px-3 py-3 text-xs text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                No editable OpenClaw workspace files were found.
              </div>
            ) : (
              <div className="space-y-5">
                <div className="space-y-2">
                  <WorkspaceFileGroup
                    files={fileNavigation.workspaceFiles}
                    expanded={workspaceFilesExpanded}
                    active={activeFileIsWorkspaceFile}
                    activePath={activeFile?.path ?? null}
                    onToggle={toggleWorkspaceFiles}
                    onSelectFile={selectFile}
                  />
                </div>

                <div className="space-y-1.5">
                  <SectionHeading label="Agents" detail={`${workspaceAgents.length} members`} />
                  <div className="space-y-2">
                    {workspaceAgents.length === 0 ? (
                      <div className="rounded-2xl border border-border bg-background px-3 py-3 text-xs text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                        No agents are assigned to this workspace.
                      </div>
                    ) : (
                      fileNavigation.agentGroups.map((group) => (
                        <AgentFileGroup
                          key={group.agent.id}
                          group={group}
                          expanded={expandedAgentIds.includes(group.agent.id)}
                          active={activeFileAgentId === group.agent.id}
                          activePath={activeFile?.path ?? null}
                          onToggle={toggleAgent}
                          onSelectFile={selectFile}
                        />
                      ))
                    )}
                  </div>
                </div>
                {workspaceAgents.length > 0 && fileNavigation.agentGroups.every((group) => group.files.length === 0) ? (
                  <div className="rounded-2xl border border-border bg-background px-3 py-3 text-xs text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-400">
                    No agent-specific editable files were found.
                  </div>
                ) : null}
              </div>
            )}
          </aside>

          <section className="flex min-h-0 flex-col">
            <div className="flex items-start justify-between gap-4 border-b border-border px-5 py-4 dark:border-white/10">
              <div className="min-w-0">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <p className="truncate font-display text-base text-foreground dark:text-white">
                    {activeFile?.path ?? "Select a workspace file"}
                  </p>
                  {activeFile ? (
                    <>
                      <Badge variant="muted" className="rounded-full px-2 py-0.5 text-[10px] uppercase">
                        {activeFile.language}
                      </Badge>
                      {!activeFile.exists && activeFile.createable ? (
                        <Badge variant="muted" className="rounded-full px-2 py-0.5 text-[10px] uppercase">
                          New file
                        </Badge>
                      ) : null}
                    </>
                  ) : null}
                </div>
                <p className="mt-1 text-xs text-muted-foreground dark:text-slate-500">
                  {activeFile?.description ??
                    (activeFile?.size ? `${formatFileSize(activeFile.size)}` : "Markdown and JSON only.")}
                </p>
              </div>
              {activeFile ? (
                <div className="relative flex shrink-0 items-center gap-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    aria-label={`Show information for ${activeFile.path}`}
                    aria-expanded={isInfoOpen}
                    onClick={() => setIsInfoOpen((current) => !current)}
                    className="h-8 w-8 rounded-full border border-border bg-background text-muted-foreground hover:bg-muted hover:text-foreground dark:border-white/10 dark:bg-white/[0.03] dark:text-slate-300 dark:hover:bg-white/[0.08] dark:hover:text-white"
                  >
                    <Info className="h-4 w-4" />
                  </Button>
                  {activeFile.source ? (
                    <Badge variant="muted" className="rounded-full px-2.5 py-1 text-[10px] uppercase">
                      {activeFile.source}
                    </Badge>
                  ) : null}
                  {isInfoOpen ? <WorkspaceFileInfoPopover file={activeFile} /> : null}
                </div>
              ) : null}
            </div>

            <div className="min-h-0 flex-1 p-5">
              {error ? (
                <div className="mb-3 flex items-start gap-2 rounded-2xl border border-rose-300/40 bg-rose-50 px-3 py-2 text-xs text-rose-950 shadow-sm dark:border-rose-300/20 dark:bg-rose-400/10 dark:text-rose-50">
                  <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-rose-700 dark:text-rose-200" />
                  <span>{error}</span>
                </div>
              ) : null}

              {!activeFile ? (
                <div className="flex h-full items-center justify-center rounded-2xl border border-dashed border-border bg-background text-sm text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                  Select an OpenClaw workspace file.
                </div>
              ) : isLoadingFile ? (
                <div className="flex h-full items-center justify-center gap-2 rounded-2xl border border-border bg-background text-sm text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-300">
                  <Loader2 className="h-4 w-4 animate-spin" />
                  Loading file
                </div>
              ) : activeFile.editable ? (
                <Textarea
                  value={content}
                  onChange={(event) => setContent(event.target.value)}
                  spellCheck={false}
                  className="h-full min-h-[360px] resize-none rounded-2xl border-border bg-background font-mono text-xs leading-5 text-foreground shadow-sm dark:border-white/10 dark:bg-white/[0.03] dark:text-white"
                />
              ) : (
                <div className="flex h-full items-center justify-center rounded-2xl border border-border bg-background px-6 text-center text-sm text-muted-foreground shadow-sm dark:border-white/10 dark:bg-white/[0.02] dark:text-slate-400">
                  {activeFile.reason ?? "This file is not editable from AgentOS."}
                </div>
              )}
            </div>

            <DialogFooter className="border-t border-border px-5 py-4 dark:border-white/10">
              <Button
                type="button"
                variant="secondary"
                onClick={discardChanges}
                disabled={!hasUnsavedChanges || isSaving}
              >
                <Undo2 className="mr-2 h-4 w-4" />
                Discard
              </Button>
              <Button
                type="button"
                onClick={() => void saveFile()}
                disabled={!canEditActiveFile || (activeFile?.exists !== false && !hasUnsavedChanges) || isSaving}
              >
                {isSaving ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : activeFile?.exists ? (
                  <Save className="mr-2 h-4 w-4" />
                ) : (
                  <PlusCircle className="mr-2 h-4 w-4" />
                )}
                {activeFile?.exists ? "Save" : "Create"}
              </Button>
            </DialogFooter>
          </section>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function WorkspaceFileInfoPopover({ file }: { file: WorkspaceManagedFile }) {
  return (
    <div className="absolute right-0 top-10 z-20 w-[min(360px,calc(100vw-48px))] rounded-2xl border border-border bg-popover p-3 text-left text-popover-foreground shadow-lg dark:border-white/10 dark:bg-[#0b1220] dark:text-white dark:shadow-[0_18px_70px_rgba(0,0,0,0.42)]">
      <div className="flex items-start gap-2">
        <Info className="mt-0.5 h-4 w-4 shrink-0 text-cyan-600 dark:text-cyan-200" />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground dark:text-white">{file.path}</p>
          <p className="mt-1 text-xs leading-5 text-muted-foreground dark:text-slate-300">
            {file.description ?? "Workspace-managed OpenClaw Markdown or JSON file."}
          </p>
        </div>
      </div>

      {file.usage ? (
        <div className="mt-3 rounded-xl border border-border bg-muted/30 p-2.5 dark:border-white/10 dark:bg-white/[0.03]">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-muted-foreground dark:text-slate-500">How to use it</p>
          <p className="mt-1 text-xs leading-5 text-foreground dark:text-slate-300">{file.usage}</p>
        </div>
      ) : null}

      {file.runtimeBehavior ? (
        <div className="mt-2 rounded-xl border border-cyan-300/20 bg-cyan-50 p-2.5 dark:border-cyan-300/10 dark:bg-cyan-300/[0.04]">
          <p className="text-[10px] font-medium uppercase tracking-[0.16em] text-cyan-800 dark:text-cyan-200/80">Runtime behavior</p>
          <p className="mt-1 text-xs leading-5 text-foreground dark:text-slate-300">{file.runtimeBehavior}</p>
        </div>
      ) : null}
    </div>
  );
}

function SectionHeading({ label, detail }: { label: string; detail?: string }) {
  return (
    <div className="flex items-center justify-between gap-3 px-2">
      <p className="text-[10px] font-medium uppercase tracking-[0.18em] text-muted-foreground dark:text-slate-500">{label}</p>
      {detail ? <p className="shrink-0 text-[10px] text-muted-foreground dark:text-slate-400">{detail}</p> : null}
    </div>
  );
}

function WorkspaceFileGroup({
  files,
  expanded,
  active,
  activePath,
  onToggle,
  onSelectFile
}: {
  files: WorkspaceManagedFile[];
  expanded: boolean;
  active: boolean;
  activePath: string | null;
  onToggle: () => void;
  onSelectFile: (file: WorkspaceManagedFile) => void;
}) {
  const fileListId = "workspace-core-files";
  const hasFiles = files.length > 0;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-background p-1.5 transition-colors shadow-sm dark:bg-white/[0.025]",
        active ? "border-cyan-300/35 bg-cyan-50 dark:bg-cyan-300/10" : "border-border dark:border-white/5"
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        disabled={!hasFiles}
        aria-expanded={hasFiles ? expanded : undefined}
        aria-controls={hasFiles ? fileListId : undefined}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors disabled:cursor-default",
          active
            ? "text-foreground dark:text-white"
            : "text-muted-foreground hover:bg-muted disabled:text-muted-foreground/60 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-white/[0.04] dark:disabled:text-slate-500"
        )}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform dark:text-slate-500",
            expanded ? "rotate-0" : "-rotate-90",
            active && "text-cyan-600 dark:text-cyan-200"
          )}
        />
        <FileText className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-200" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">Workspace Files</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground dark:text-slate-500">
            Shared project context and config
          </span>
        </span>
        <Badge variant="muted" className="shrink-0 rounded-full px-1.5 py-0 text-[10px]">
          {files.length}
        </Badge>
      </button>

      {expanded && hasFiles ? (
        <div id={fileListId} className="ml-6 mt-1 space-y-1 border-l border-border pl-2 dark:border-white/10">
          {files.map((file) => (
            <FileListButton
              key={file.path}
              file={file}
              active={file.path === activePath}
              onSelect={onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function AgentFileGroup({
  group,
  expanded,
  active,
  activePath,
  onToggle,
  onSelectFile
}: {
  group: AgentFileGroupData;
  expanded: boolean;
  active: boolean;
  activePath: string | null;
  onToggle: (agentId: string) => void;
  onSelectFile: (file: WorkspaceManagedFile) => void;
}) {
  const fileListId = `workspace-agent-files-${group.agent.id}`;
  const hasFiles = group.files.length > 0;

  return (
    <div
      className={cn(
        "rounded-2xl border bg-background p-1.5 transition-colors shadow-sm dark:bg-white/[0.025]",
        active ? "border-cyan-300/35 bg-cyan-50 dark:bg-cyan-300/10" : "border-border dark:border-white/5"
      )}
    >
      <button
        type="button"
        onClick={() => onToggle(group.agent.id)}
        disabled={!hasFiles}
        aria-expanded={hasFiles ? expanded : undefined}
        aria-controls={hasFiles ? fileListId : undefined}
        className={cn(
          "flex w-full min-w-0 items-center gap-2 rounded-xl px-2 py-2 text-left transition-colors disabled:cursor-default",
          active
            ? "text-foreground dark:text-white"
            : "text-muted-foreground hover:bg-muted disabled:text-muted-foreground/60 disabled:hover:bg-transparent dark:text-slate-300 dark:hover:bg-white/[0.04] dark:disabled:text-slate-500"
        )}
      >
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform dark:text-slate-500",
            expanded ? "rotate-0" : "-rotate-90",
            active && "text-cyan-600 dark:text-cyan-200"
          )}
        />
        <Users className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-200" />
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-medium">{group.agent.name}</span>
          <span className="mt-0.5 block truncate text-[10px] text-muted-foreground dark:text-slate-500">{group.agent.id}</span>
        </span>
        <Badge variant="muted" className="shrink-0 rounded-full px-1.5 py-0 text-[10px]">
          {group.files.length}
        </Badge>
      </button>

      {expanded && hasFiles ? (
        <div id={fileListId} className="ml-6 mt-1 space-y-1 border-l border-border pl-2 dark:border-white/10">
          {group.files.map((file) => (
            <FileListButton
              key={file.path}
              file={file}
              active={file.path === activePath}
              onSelect={onSelectFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  );
}

function FileListButton({
  file,
  active,
  onSelect
}: {
  file: WorkspaceManagedFile;
  active: boolean;
  onSelect: (file: WorkspaceManagedFile) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(file)}
      className={cn(
        "w-full rounded-2xl border px-3 py-2 text-left transition-colors",
        active
          ? "border-cyan-300/40 bg-cyan-50 text-foreground dark:bg-cyan-300/10 dark:text-white"
          : "border-transparent text-muted-foreground hover:border-border hover:bg-muted dark:text-slate-300 dark:hover:border-white/10 dark:hover:bg-white/[0.04]"
      )}
    >
      <span className="flex min-w-0 items-center gap-2">
        {file.language === "json" ? (
          <Braces className="h-3.5 w-3.5 shrink-0 text-cyan-600 dark:text-cyan-200" />
        ) : (
          <FileText className="h-3.5 w-3.5 shrink-0 text-muted-foreground dark:text-slate-300" />
        )}
        <span className="min-w-0 flex-1 truncate text-xs font-medium">{file.label}</span>
        <Badge variant="muted" className="rounded-full px-1.5 py-0 text-[10px]">
          {categoryLabels[file.category]}
        </Badge>
        {!file.exists && file.createable ? (
          <Badge variant="muted" className="rounded-full px-1.5 py-0 text-[10px]">
            Create
          </Badge>
        ) : null}
      </span>
      <span className="mt-1 block truncate text-[10px] text-muted-foreground dark:text-slate-500">{file.path}</span>
    </button>
  );
}

function buildFileNavigation(files: WorkspaceManagedFile[], agents: WorkspaceDialogAgent[]) {
  const workspaceFiles: WorkspaceManagedFile[] = [];
  const agentFilesByAgentId = new Map<string, WorkspaceManagedFile[]>(
    agents.map((agent) => [agent.id, []])
  );

  for (const file of files) {
    const agentId = getWorkspaceManagedFileAgentId(file, agents);

    if (!agentId) {
      workspaceFiles.push(file);
      continue;
    }

    const agentFiles = agentFilesByAgentId.get(agentId) ?? [];
    agentFiles.push(file);
    agentFilesByAgentId.set(agentId, agentFiles);
  }

  for (const agent of agents) {
    agentFilesByAgentId.set(agent.id, sortAgentManagedFiles(agentFilesByAgentId.get(agent.id) ?? []));
  }

  return {
    workspaceFiles,
    agentFilesByAgentId,
    agentGroups: agents.map((agent) => ({
      agent,
      files: agentFilesByAgentId.get(agent.id) ?? []
    }))
  };
}

function sortAgentManagedFiles(files: WorkspaceManagedFile[]) {
  return files.toSorted(
    (left, right) =>
      Number(isAgentProfileFile(right)) - Number(isAgentProfileFile(left)) ||
      left.path.localeCompare(right.path)
  );
}

function isAgentProfileFile(file: WorkspaceManagedFile) {
  return /^agents\/[^/]+\/PROFILE\.md$/.test(file.path);
}

function getWorkspaceManagedFileAgentId(file: WorkspaceManagedFile, agents: WorkspaceDialogAgent[]) {
  const profileMatch = /^agents\/([^/]+)\/PROFILE\.md$/.exec(file.path);
  if (profileMatch?.[1] && agents.some((agent) => agent.id === profileMatch[1])) {
    return profileMatch[1];
  }

  const agentDirMatch = /^\.openclaw\/agents\/([^/]+)\/agent\//.exec(file.path);
  if (agentDirMatch?.[1] && agents.some((agent) => agent.id === agentDirMatch[1])) {
    return agentDirMatch[1];
  }

  const policyOwner = agents.find(
    (agent) => file.path === `skills/${buildAgentPolicySkillId(agent.id)}/SKILL.md`
  );

  return policyOwner?.id ?? null;
}

function buildAgentPolicySkillId(agentId: string) {
  return `agent-policy-${slugify(agentId) || "agent"}`;
}

function slugify(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function chooseInitialFilePath(files: WorkspaceManagedFile[]) {
  return (
    files.find((file) => file.path === "AGENTS.md")?.path ??
    files.find((file) => file.exists)?.path ??
    files[0]?.path ??
    null
  );
}

function replaceWorkspaceFile(files: WorkspaceManagedFile[], nextFile: WorkspaceManagedFile) {
  if (!files.some((file) => file.path === nextFile.path)) {
    return [...files, nextFile];
  }

  return files.map((file) => (file.path === nextFile.path ? nextFile : file));
}

function formatFileSize(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  return `${Math.round(bytes / 1024)} KB`;
}
