"use client";

import { AlertTriangle, CheckCircle2, Copy, LoaderCircle, SquareTerminal } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import {
  resolveUpdateDialogDescription,
  resolveUpdateDialogTitle,
  resolveUpdateResultIconWrapClassName,
  resolveUpdateResultPanelClassName
} from "@/components/mission-control/mission-control-shell.utils";
import type {
  MissionControlSnapshot,
  TaskRecord
} from "@/lib/agentos/contracts";
import type { OpenClawInstallSummary } from "@/components/mission-control/mission-control-shell.utils";
import { isOpenClawTerminalCommand } from "@/lib/openclaw/terminal-command";
import { cn } from "@/lib/utils";

type SurfaceTheme = "dark" | "light";
type TaskAbortState = "idle" | "running" | "error";
type UpdateRunState = "idle" | "running" | "success" | "error";

export function MissionControlShellDialogs({
  snapshot,
  surfaceTheme,
  isInspectorOpen,
  taskAbortRequest,
  taskAbortRunState,
  taskAbortMessage,
  onTaskAbortOpenChange,
  onTaskAbortConfirm,
  updateDialogOpen,
  updateRunState,
  updateStatusMessage,
  updateResultMessage,
  updateLog,
  updateManualCommand,
  activeRuntimeCount,
  updateInstallSummary,
  onUpdateDialogOpenChange,
  onRunOpenClawUpdate
}: {
  snapshot: MissionControlSnapshot;
  surfaceTheme: SurfaceTheme;
  isInspectorOpen: boolean;
  taskAbortRequest: TaskRecord | null;
  taskAbortRunState: TaskAbortState;
  taskAbortMessage: string | null;
  onTaskAbortOpenChange: (open: boolean) => void;
  onTaskAbortConfirm: () => void;
  updateDialogOpen: boolean;
  updateRunState: UpdateRunState;
  updateStatusMessage: string | null;
  updateResultMessage: string | null;
  updateLog: string;
  updateManualCommand: string | null;
  activeRuntimeCount: number;
  updateInstallSummary: OpenClawInstallSummary;
  onUpdateDialogOpenChange: (open: boolean) => void;
  onRunOpenClawUpdate: () => void;
}) {
  const isUpdateRunning = updateRunState === "running";
  const isUpdateFinished = updateRunState === "success" || updateRunState === "error";
  const updateDialogTitle = resolveUpdateDialogTitle(updateRunState);
  const updateDialogDescription = resolveUpdateDialogDescription(updateRunState);
  const [isOpeningUpdateTerminal, setIsOpeningUpdateTerminal] = useState(false);
  const canOpenUpdateTerminal = isOpenClawTerminalCommand(updateManualCommand);

  const copyUpdateCommand = async () => {
    if (!updateManualCommand) {
      return;
    }

    try {
      await navigator.clipboard.writeText(updateManualCommand);
      toast.success("Command copied.", {
        description: "Open Terminal and paste it."
      });
    } catch (error) {
      toast.error("Could not copy command.", {
        description: error instanceof Error ? error.message : "Clipboard access is unavailable."
      });
    }
  };

  const openUpdateTerminal = async () => {
    if (!updateManualCommand || !canOpenUpdateTerminal) {
      return;
    }

    setIsOpeningUpdateTerminal(true);

    try {
      const response = await fetch("/api/system/open-terminal", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({
          command: updateManualCommand
        })
      });

      const result = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok || result?.error) {
        throw new Error(result?.error || "Unable to open Terminal.");
      }

      toast.success("Terminal opened.", {
        description: "Confirm the update there, then return to AgentOS."
      });
    } catch (error) {
      toast.error("Could not open Terminal.", {
        description: error instanceof Error ? error.message : "Open Terminal manually and run the command."
      });
    } finally {
      setIsOpeningUpdateTerminal(false);
    }
  };

  return (
    <>
      <Dialog
        open={taskAbortRequest !== null}
        onOpenChange={(open) => {
          if (taskAbortRunState === "running") {
            return;
          }

          onTaskAbortOpenChange(open);
        }}
      >
        <DialogContent
          className={cn(
            "max-w-[480px] gap-5 p-5 sm:p-6",
            surfaceTheme === "light"
              ? "border-[#d7c5b7] bg-[rgba(252,247,241,0.98)] text-[#4a382c] shadow-[0_30px_80px_rgba(161,125,101,0.2)]"
              : "border-white/10 bg-slate-950/94 text-slate-100"
          )}
        >
          <DialogHeader>
            <DialogTitle className={surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"}>
              Abort task?
            </DialogTitle>
            <DialogDescription className={surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-400"}>
              This stops the current OpenClaw dispatch for the selected task. It does not delete captured evidence or files.
            </DialogDescription>
          </DialogHeader>

          {taskAbortRequest ? (
            <div
              className={cn(
                "rounded-[20px] border px-4 py-4",
                surfaceTheme === "light"
                  ? "border-[#e3d4c8] bg-[#fffaf6] text-[#4f3d31]"
                  : "border-rose-400/20 bg-rose-400/10 text-rose-50"
              )}
            >
              <p className="text-[10px] uppercase tracking-[0.24em] text-slate-500">Selected task</p>
              <p className="mt-2 font-display text-[1.02rem] leading-6 text-inherit">{taskAbortRequest.title}</p>
              <p className={cn("mt-1 text-sm leading-6", surfaceTheme === "light" ? "text-[#8b7262]" : "text-rose-100/80")}>
                {taskAbortRequest.subtitle}
              </p>
              {taskAbortMessage ? (
                <p className="mt-3 rounded-[16px] border border-rose-400/20 bg-rose-400/10 px-3 py-2 text-sm text-rose-50">
                  {taskAbortMessage}
                </p>
              ) : null}
            </div>
          ) : null}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              disabled={taskAbortRunState === "running"}
              className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
              onClick={() => {
                if (taskAbortRunState === "running") {
                  return;
                }

                onTaskAbortOpenChange(false);
              }}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={!taskAbortRequest || taskAbortRunState === "running"}
              onClick={() => {
                onTaskAbortConfirm();
              }}
            >
              {taskAbortRunState === "running" ? (
                <>
                  <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                  Aborting...
                </>
              ) : (
                "Abort task"
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {isInspectorOpen ? null : (
        <div
          className={cn(
            "pointer-events-auto absolute bottom-3 right-[74px] z-30 text-[11px] tracking-[0.04em] lg:bottom-4",
            surfaceTheme === "light" ? "text-[#8f7664]" : "text-slate-500"
          )}
        >
          Built on{" "}
          <a
            href="https://openclaw.ai/"
            target="_blank"
            rel="noreferrer"
            className={cn(
              "transition-colors",
              surfaceTheme === "light" ? "text-[#6f5a4b] hover:text-[#4f3d31]" : "text-slate-300 hover:text-slate-100"
            )}
          >
            OpenClaw
          </a>{" "}
          by{" "}
          <a
            href="https://sapienx.app/"
            target="_blank"
            rel="noreferrer"
            className={cn(
              "transition-colors",
              surfaceTheme === "light" ? "text-[#6f5a4b] hover:text-[#4f3d31]" : "text-slate-300 hover:text-slate-100"
            )}
          >
            SapienX
          </a>
        </div>
      )}

      <Dialog
        open={updateDialogOpen}
        onOpenChange={(open) => {
          if (isUpdateRunning) {
            return;
          }

          onUpdateDialogOpenChange(open);
        }}
      >
        <DialogContent
          className={cn(
            "max-h-[calc(100vh-48px)] max-w-[468px] gap-5 overflow-y-auto p-5 sm:p-6",
            surfaceTheme === "light"
              ? "border-[#d7c5b7] bg-[rgba(252,247,241,0.98)] text-[#4a382c] shadow-[0_30px_80px_rgba(161,125,101,0.2)]"
              : "border-white/10 bg-slate-950/94 text-slate-100"
          )}
        >
          <DialogHeader>
            <DialogTitle className={surfaceTheme === "light" ? "text-[#3f2f24]" : "text-white"}>
              {updateDialogTitle}
            </DialogTitle>
            <DialogDescription className={surfaceTheme === "light" ? "text-[#7e6555]" : "text-slate-400"}>
              {updateDialogDescription}
            </DialogDescription>
          </DialogHeader>

          {isUpdateFinished ? (
            <div
              className={cn(
                "space-y-4",
                surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
              )}
            >
              <div
                className={cn(
                  "rounded-[24px] border px-4 py-5",
                  resolveUpdateResultPanelClassName(updateRunState, surfaceTheme)
                )}
              >
                <div className="flex items-start gap-3">
                  <div
                    className={cn(
                      "flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl border",
                      resolveUpdateResultIconWrapClassName(updateRunState, surfaceTheme)
                    )}
                  >
                    {updateRunState === "success" ? (
                      <CheckCircle2 className="h-5 w-5" />
                    ) : (
                      <AlertTriangle className="h-5 w-5" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="font-display text-[1.05rem] leading-6">
                      {updateRunState === "success" ? "OpenClaw is up to date" : "Update needs attention"}
                    </p>
                    <p className="mt-1 text-sm leading-6">
                      {updateResultMessage ||
                        (updateRunState === "success"
                          ? "The update finished successfully."
                          : "The update did not finish cleanly.")}
                    </p>
                  </div>
                </div>

                <div className="mt-4 grid gap-3 sm:grid-cols-3">
                  <div
                    className={cn(
                      "rounded-[18px] border px-3 py-3",
                      surfaceTheme === "light" ? "border-white/70 bg-white/70" : "border-white/10 bg-slate-950/30"
                    )}
                  >
                    <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.22em] text-[#8d725f]" : "text-[10px] uppercase tracking-[0.22em] text-slate-500"}>
                      Installed version
                    </p>
                    <p className="mt-2 font-display text-lg text-inherit">
                      v{snapshot.diagnostics.version || snapshot.diagnostics.latestVersion || "unknown"}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "rounded-[18px] border px-3 py-3",
                      surfaceTheme === "light" ? "border-white/70 bg-white/70" : "border-white/10 bg-slate-950/30"
                    )}
                  >
                    <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.22em] text-[#8d725f]" : "text-[10px] uppercase tracking-[0.22em] text-slate-500"}>
                      Latest reported
                    </p>
                    <p className="mt-2 font-display text-lg text-inherit">
                      v{snapshot.diagnostics.latestVersion || snapshot.diagnostics.version || "unknown"}
                    </p>
                  </div>
                  <div
                    className={cn(
                      "rounded-[18px] border px-3 py-3",
                      surfaceTheme === "light" ? "border-white/70 bg-white/70" : "border-white/10 bg-slate-950/30"
                    )}
                  >
                    <p className={surfaceTheme === "light" ? "text-[10px] uppercase tracking-[0.22em] text-[#8d725f]" : "text-[10px] uppercase tracking-[0.22em] text-slate-500"}>
                      Detected install
                    </p>
                    <p className="mt-2 text-sm font-medium text-inherit">{updateInstallSummary.label}</p>
                    <p className={surfaceTheme === "light" ? "mt-1 text-xs text-[#8b7262]" : "mt-1 text-xs text-slate-400"}>
                      {updateInstallSummary.detail}
                    </p>
                  </div>
                </div>
              </div>

              <div
                className={cn(
                  "rounded-[20px] border",
                  surfaceTheme === "light"
                    ? "border-[#e3d4c8] bg-[#fffaf6]"
                    : "border-white/8 bg-white/[0.03]"
                )}
              >
                <div
                  className={cn(
                    "flex items-center justify-between border-b px-4 py-3",
                    surfaceTheme === "light" ? "border-[#eadccf]" : "border-white/8"
                  )}
                >
                  <p
                    className={cn(
                      "text-[10px] uppercase tracking-[0.24em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    Update log
                  </p>
                  <span className={surfaceTheme === "light" ? "text-xs text-[#8b7262]" : "text-xs text-slate-400"}>
                    {updateRunState === "success" ? "Completed" : "Failed"}
                  </span>
                </div>
                <pre
                  className={cn(
                    "max-h-[180px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-5",
                    surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                  )}
                >
                  {updateLog || "No command output was captured."}
                </pre>
              </div>

              {updateManualCommand ? (
                <div
                  className={cn(
                    "rounded-[20px] border px-4 py-3",
                    surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6]"
                      : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <p
                    className={cn(
                      "text-[10px] uppercase tracking-[0.24em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    {canOpenUpdateTerminal ? "Terminal" : "Manual"}
                  </p>
                  {canOpenUpdateTerminal ? (
                    <p
                      className={cn(
                        "mt-1 text-sm leading-6",
                        surfaceTheme === "light" ? "text-[#705b4d]" : "text-slate-400"
                      )}
                    >
                      Open Terminal and run this command to confirm the update.
                    </p>
                  ) : null}
                  <p
                    className={cn(
                      "mt-2 break-all font-mono text-[11px] leading-5",
                      surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                    )}
                  >
                    {updateManualCommand}
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      variant="secondary"
                      size="sm"
                      onClick={() => {
                        void copyUpdateCommand();
                      }}
                      className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
                    >
                      <Copy className="mr-1.5 h-3 w-3" />
                      Copy command
                    </Button>
                    {canOpenUpdateTerminal ? (
                      <Button
                        type="button"
                        variant="secondary"
                        size="sm"
                        onClick={() => {
                          void openUpdateTerminal();
                        }}
                        disabled={isOpeningUpdateTerminal}
                        className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
                      >
                        {isOpeningUpdateTerminal ? (
                          <>
                            <LoaderCircle className="mr-1.5 h-3 w-3 animate-spin" />
                            Opening...
                          </>
                        ) : (
                          <>
                            <SquareTerminal className="mr-1.5 h-3 w-3" />
                            Open Terminal
                          </>
                        )}
                      </Button>
                    ) : null}
                  </div>
                </div>
              ) : null}
            </div>
          ) : (
            <>
              <div
                className={cn(
                  "grid gap-3 sm:grid-cols-2",
                  surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                )}
              >
                <div
                  className={cn(
                    "rounded-[20px] border px-4 py-4",
                    surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6]"
                      : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <p
                    className={cn(
                      "text-[10px] uppercase tracking-[0.24em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    Version target
                  </p>
                  <p className="mt-2 font-display text-[1.1rem] leading-6 text-inherit">
                    v{snapshot.diagnostics.latestVersion || snapshot.diagnostics.version || "unknown"}
                  </p>
                  <p className={surfaceTheme === "light" ? "mt-1 text-xs text-[#8b7262]" : "mt-1 text-xs text-slate-400"}>
                    Current: v{snapshot.diagnostics.version || "unknown"}
                  </p>
                </div>

                <div
                  className={cn(
                    "rounded-[20px] border px-4 py-4",
                    surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6]"
                      : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <p
                    className={cn(
                      "text-[10px] uppercase tracking-[0.24em]",
                      surfaceTheme === "light" ? "text-[#9a7f6c]" : "text-slate-500"
                    )}
                  >
                    Detected install
                  </p>
                  <p className="mt-2 text-sm font-medium leading-6 text-inherit">
                    {updateInstallSummary.label}
                  </p>
                  <p className={surfaceTheme === "light" ? "mt-1 text-xs text-[#8b7262]" : "mt-1 text-xs text-slate-400"}>
                    {updateInstallSummary.detail}
                  </p>
                </div>
              </div>

              <div
                className={cn(
                  "rounded-[20px] border px-4 py-3 text-sm",
                  activeRuntimeCount > 0
                    ? surfaceTheme === "light"
                      ? "border-rose-300/80 bg-rose-50 text-rose-800"
                      : "border-rose-300/25 bg-rose-300/10 text-rose-100"
                    : surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6] text-[#745e4f]"
                      : "border-white/8 bg-white/[0.03] text-slate-300"
                )}
              >
                {activeRuntimeCount > 0
                  ? `${activeRuntimeCount} running or queued runtime${activeRuntimeCount === 1 ? "" : "s"} may be interrupted during the update.`
                  : "No running runtimes are currently tracked, so the update risk is lower."}
              </div>

              {isUpdateRunning ? (
                <div
                  className={cn(
                    "rounded-[20px] border",
                    surfaceTheme === "light"
                      ? "border-[#e3d4c8] bg-[#fffaf6]"
                      : "border-white/8 bg-white/[0.03]"
                  )}
                >
                  <div
                    className={cn(
                      "flex items-center gap-3 border-b px-4 py-3",
                      surfaceTheme === "light" ? "border-[#eadccf]" : "border-white/8"
                    )}
                  >
                    <div
                      className={cn(
                        "flex h-9 w-9 items-center justify-center rounded-2xl border",
                        surfaceTheme === "light"
                          ? "border-[#dcc6b6] bg-[#f4e8dd] text-[#7b6453]"
                          : "border-white/10 bg-white/[0.05] text-slate-200"
                      )}
                    >
                      <LoaderCircle className="h-4 w-4 animate-spin" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <p className={surfaceTheme === "light" ? "text-sm font-medium text-[#4a382c]" : "text-sm font-medium text-white"}>
                        Update in progress
                      </p>
                      <p className={surfaceTheme === "light" ? "text-xs text-[#8b7262]" : "text-xs text-slate-400"}>
                        {updateStatusMessage || "Streaming OpenClaw output..."}
                      </p>
                    </div>
                  </div>
                  <pre
                    className={cn(
                      "max-h-[180px] min-h-[120px] overflow-auto whitespace-pre-wrap break-words px-4 py-3 font-mono text-[11px] leading-5",
                      surfaceTheme === "light" ? "text-[#4f3d31]" : "text-slate-200"
                    )}
                  >
                    {updateLog || "Waiting for command output..."}
                  </pre>
                </div>
              ) : null}
            </>
          )}

          <DialogFooter>
            <Button
              type="button"
              variant="secondary"
              onClick={() => {
                onUpdateDialogOpenChange(false);
              }}
              className={surfaceTheme === "light" ? "border-[#d9c9bc] bg-[#f5ebe3] text-[#6c5647] hover:bg-[#eddccf]" : ""}
            >
              {isUpdateRunning ? "Run in background" : isUpdateFinished ? "Done" : "Cancel"}
            </Button>
            {isUpdateFinished ? null : (
              <Button
                type="button"
                onClick={onRunOpenClawUpdate}
                disabled={isUpdateRunning}
                className={cn(
                  snapshot.diagnostics.updateAvailable
                    ? "bg-amber-400 text-slate-950 shadow-lg shadow-amber-400/20 hover:bg-amber-300"
                    : "",
                  surfaceTheme === "light" && !snapshot.diagnostics.updateAvailable
                    ? "bg-[#c8946f] text-white shadow-[0_12px_28px_rgba(200,148,111,0.24)] hover:bg-[#b88461]"
                    : ""
                )}
              >
                {isUpdateRunning ? (
                  <>
                    <LoaderCircle className="mr-2 h-4 w-4 animate-spin" />
                    Updating...
                  </>
                ) : (
                  "Update now"
                )}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
