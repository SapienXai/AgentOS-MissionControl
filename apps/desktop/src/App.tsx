import { useEffect, useState } from "react";

import type { GitSummary, LocalWorkspace, OllamaStatus, TerminalOutput, TerminalSession, WorkspaceEntry } from "@/lib/agentos/local-workspace";
import { getPlatformCapabilities, type PlatformCapabilities } from "@/lib/agentos/platform";
import type { RuntimeLogEntry, RuntimeStatus } from "@/lib/agentos/runtime-contract";
import { RuntimeRegistry } from "@/lib/agentos/runtime-registry";
import type { Update } from "@tauri-apps/plugin-updater";

import {
  chooseWorkspace,
  checkForDesktopUpdate,
  getAutostartEnabled,
  getInitialDeepLinks,
  getGitSummary,
  getOllamaStatus,
  getPlatformInfo,
  listWorkspaceEntries,
  listWorkspaces,
  installDesktopUpdate,
  spawnTerminal,
  subscribeToTerminalOutput,
  subscribeToDeepLinks,
  setAutostartEnabled,
  writeTerminal,
  type DesktopPlatformInfo
} from "./native/bridge";
import { OpenClawRuntimeAdapter } from "./native/openclaw-runtime";

type DesktopSection = "overview" | "runtime" | "workspace";
const runtimeRegistry = new RuntimeRegistry([new OpenClawRuntimeAdapter()]);
const localRuntime = runtimeRegistry.get("openclaw-local")!;

export function App() {
  const [section, setSection] = useState<DesktopSection>("overview");
  const [platform, setPlatform] = useState<DesktopPlatformInfo | null>(null);
  const [autostartEnabled, setAutostartEnabledState] = useState<boolean | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [logs, setLogs] = useState<RuntimeLogEntry[]>([]);
  const [workspaces, setWorkspaces] = useState<LocalWorkspace[]>([]);
  const [selectedWorkspace, setSelectedWorkspace] = useState<LocalWorkspace | null>(null);
  const [workspaceGit, setWorkspaceGit] = useState<GitSummary | null>(null);
  const [workspaceEntries, setWorkspaceEntries] = useState<WorkspaceEntry[]>([]);
  const [ollama, setOllama] = useState<OllamaStatus | null>(null);
  const [terminalSession, setTerminalSession] = useState<TerminalSession | null>(null);
  const [terminalOutput, setTerminalOutput] = useState("");
  const [terminalInput, setTerminalInput] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    void getPlatformInfo().then(setPlatform).catch(() => setPlatform(null));
    void getAutostartEnabled().then(setAutostartEnabledState).catch(() => setAutostartEnabledState(null));
    void getInitialDeepLinks().then((routes) => routes.forEach(handleDeepLink)).catch(() => {});
    void refreshRuntime();
    void refreshWorkspaceData();
  // The initial native hydration intentionally runs once at app startup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeToDeepLinks(handleDeepLink).then((cleanup) => {
      unlisten = cleanup;
    }).catch(() => {});
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeToTerminalOutput((output: TerminalOutput) => {
      if (!terminalSession || output.sessionId === terminalSession.id) setTerminalOutput((current) => `${current}${output.data}`.slice(-40_000));
    }).then((cleanup) => {
      unlisten = cleanup;
    }).catch(() => {});
    return () => unlisten?.();
  }, [terminalSession]);

  useEffect(() => {
    const subscription = localRuntime.subscribe((event) => {
      if (event.type === "log") setLogs((current) => [...current, event.entry].slice(-200));
    });
    return () => subscription.unsubscribe();
  }, []);

  async function refreshRuntime() {
    try {
      const [nextRuntime, nextLogs] = await Promise.all([localRuntime.getStatus(), localRuntime.getLogs()]);
      setRuntime(nextRuntime);
      setLogs(nextLogs);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to read local runtime state.");
    }
  }

  async function refreshWorkspaceData() {
    try {
      const nextWorkspaces = await listWorkspaces();
      setWorkspaces(nextWorkspaces);
      const nextWorkspace = selectedWorkspace && nextWorkspaces.find((item) => item.id === selectedWorkspace.id) || nextWorkspaces[0] || null;
      setSelectedWorkspace(nextWorkspace);
      if (nextWorkspace) {
        const [nextGit, nextEntries] = await Promise.all([getGitSummary(nextWorkspace.id), listWorkspaceEntries(nextWorkspace.id)]);
        setWorkspaceGit(nextGit);
        setWorkspaceEntries(nextEntries);
      } else {
        setWorkspaceGit(null);
        setWorkspaceEntries([]);
      }
      setOllama(await getOllamaStatus());
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to read local workspace state.");
    }
  }

  async function performRuntimeAction(action: "start" | "stop" | "restart" | "doctor") {
    setBusy(action);
    setNotice(null);
    try {
      if (action === "doctor") {
        const result = await localRuntime.doctor();
        setNotice(result.summary);
        setRuntime(await localRuntime.getStatus());
      } else {
        const nextRuntime = action === "start" ? await localRuntime.start() : action === "stop" ? await localRuntime.stop() : await localRuntime.restart();
        setRuntime(nextRuntime);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Runtime action failed.");
    } finally {
      setBusy(null);
    }
  }

  function handleDeepLink(route: string) {
    if (route === "runtime") {
      setSection("runtime");
      setNotice("Opened the local runtime from an AgentOS link.");
      return;
    }
    setSection("overview");
    setNotice(`AgentOS link received for ${route}. This desktop surface does not expose that detail view yet.`);
  }

  async function toggleAutostart() {
    if (autostartEnabled === null) return;
    setBusy("autostart");
    setNotice(null);
    try {
      const next = !autostartEnabled;
      await setAutostartEnabled(next);
      setAutostartEnabledState(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to update launch-at-login preference.");
    } finally {
      setBusy(null);
    }
  }

  async function checkForUpdates() {
    if (!capabilities.updater) {
      setNotice("Signed desktop updates are enabled only in release builds with an updater endpoint.");
      return;
    }
    setBusy("update-check");
    setNotice(null);
    try {
      const update = await checkForDesktopUpdate();
      setAvailableUpdate(update);
      setNotice(update ? `AgentOS ${update.version} is ready to install.` : "AgentOS is up to date.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to check for desktop updates.");
    } finally {
      setBusy(null);
    }
  }

  async function installUpdate() {
    if (!availableUpdate) return;
    setBusy("update-install");
    setNotice("Downloading the signed AgentOS update…");
    try {
      await installDesktopUpdate(availableUpdate);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "The desktop update could not be installed.");
    } finally {
      setBusy(null);
    }
  }

  async function addWorkspace() {
    setBusy("workspace");
    setNotice(null);
    try {
      const workspace = await chooseWorkspace();
      if (workspace) {
        await refreshWorkspaceData();
        setSelectedWorkspace(workspace);
        setSection("workspace");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to add workspace.");
    } finally {
      setBusy(null);
    }
  }

  async function openTerminal() {
    if (!selectedWorkspace) return;
    setBusy("terminal");
    setNotice(null);
    try {
      const session = await spawnTerminal(selectedWorkspace.id);
      setTerminalSession(session);
      setTerminalOutput("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to open the workspace terminal.");
    } finally {
      setBusy(null);
    }
  }

  async function submitTerminalInput() {
    if (!terminalSession || !terminalInput) return;
    try {
      await writeTerminal(terminalSession.id, `${terminalInput}\n`);
      setTerminalInput("");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to send terminal input.");
    }
  }

  const capabilities: PlatformCapabilities = platform?.capabilities ?? getPlatformCapabilities("web");
  const runtimeLabel = runtime?.running ? "Running" : runtime?.installed ? "Stopped" : "Not installed";

  return (
    <div className="app-shell">
      <aside className="sidebar" aria-label="Primary navigation">
        <div className="brand-lockup"><span className="brand-mark">A</span><div><strong>AgentOS</strong><span>Desktop control plane</span></div></div>
        <nav>
          {(["overview", "runtime", "workspace"] as const).map((item) => <button key={item} className={`nav-item ${section === item ? "active" : ""}`} onClick={() => setSection(item)}><span className="nav-icon">{item === "overview" ? "⌂" : item === "runtime" ? "◉" : "⌘"}</span>{item[0].toUpperCase() + item.slice(1)}</button>)}
        </nav>
        <div className="sidebar-footer"><span className="status-dot" data-state={runtime?.health ?? "unknown"} /><span>{runtimeLabel}</span><span className="muted">{runtime?.version ? `v${runtime.version}` : "Local runtime"}</span></div>
      </aside>
      <main className="main-content">
        <header className="topbar"><div><p className="eyebrow">Local operator surface</p><h1>{section === "overview" ? "Mission Control" : section === "runtime" ? "Local Runtime" : "Workspace"}</h1></div><div className="topbar-meta"><span className="connection-badge"><span className="status-dot" data-state="healthy" /> This computer</span></div></header>
        {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}
        {section === "overview" && <Overview runtime={runtime} runtimeLabel={runtimeLabel} workspace={selectedWorkspace} onRuntime={() => setSection("runtime")} onWorkspace={() => setSection("workspace")} />}
        {section === "runtime" && <RuntimeSection runtime={runtime} logs={logs} busy={busy} capabilities={capabilities} autostartEnabled={autostartEnabled} availableUpdate={availableUpdate} onToggleAutostart={toggleAutostart} onCheckUpdates={checkForUpdates} onInstallUpdate={installUpdate} onRefresh={refreshRuntime} onAction={performRuntimeAction} />}
        {section === "workspace" && <WorkspaceSection workspaces={workspaces} selectedWorkspace={selectedWorkspace} entries={workspaceEntries} git={workspaceGit} ollama={ollama} terminalSession={terminalSession} terminalOutput={terminalOutput} terminalInput={terminalInput} busy={busy} onAdd={addWorkspace} onOpenTerminal={openTerminal} onTerminalInput={setTerminalInput} onSubmitTerminalInput={() => void submitTerminalInput()} onSelect={(workspace) => { setSelectedWorkspace(workspace); void Promise.all([getGitSummary(workspace.id), listWorkspaceEntries(workspace.id)]).then(([nextGit, nextEntries]) => { setWorkspaceGit(nextGit); setWorkspaceEntries(nextEntries); }); }} />}
      </main>
    </div>
  );
}

function Overview({ runtime, runtimeLabel, workspace, onRuntime, onWorkspace }: { runtime: RuntimeStatus | null; runtimeLabel: string; workspace: LocalWorkspace | null; onRuntime: () => void; onWorkspace: () => void }) {
  return <section className="content-grid"><div className="hero-card"><p className="eyebrow">Human operating layer</p><h2>Run your workforce where the work is.</h2><p className="hero-copy">AgentOS Desktop keeps local runtime control, workspace context, and operator decisions in one calm surface.</p><div className="hero-actions"><button className="primary-button" onClick={onRuntime}>View runtime</button><button className="secondary-button" onClick={onWorkspace}>Open workspace</button></div></div><div className="stat-grid"><StatCard label="Runtime" value={runtimeLabel} detail={runtime?.version ? `OpenClaw v${runtime.version}` : "OpenClaw local runtime"} tone={runtime?.health ?? "unknown"} /><StatCard label="Workspace" value={workspace?.name ?? "Not selected"} detail={workspace?.path ?? "Choose an approved folder"} tone={workspace ? "healthy" : "unknown"} /></div><div className="section-card span-two"><div className="section-heading"><div><p className="eyebrow">Operator readiness</p><h3>Local execution foundations</h3></div><span className="quiet-label">Native surface</span></div><div className="readiness-list"><ReadinessItem label="OpenClaw lifecycle" ready={Boolean(runtime?.installed)} detail={runtime?.installed ? "Detected through the native runtime manager" : "Install OpenClaw to enable local execution"} /><ReadinessItem label="Approved workspace" ready={Boolean(workspace)} detail={workspace ? "Directory access is scoped to this workspace" : "No folder has been approved yet"} /><ReadinessItem label="Product state" ready={true} detail="Web and desktop surfaces use the same AgentOS contracts" /></div></div></section>;
}

function RuntimeSection({ runtime, logs, busy, capabilities, autostartEnabled, availableUpdate, onToggleAutostart, onCheckUpdates, onInstallUpdate, onRefresh, onAction }: { runtime: RuntimeStatus | null; logs: RuntimeLogEntry[]; busy: string | null; capabilities: PlatformCapabilities; autostartEnabled: boolean | null; availableUpdate: Update | null; onToggleAutostart: () => Promise<void>; onCheckUpdates: () => Promise<void>; onInstallUpdate: () => Promise<void>; onRefresh: () => Promise<void>; onAction: (action: "start" | "stop" | "restart" | "doctor") => Promise<void> }) {
  const isRunning = runtime?.running === true;
  return <section className="content-grid"><div className="section-card span-two"><div className="section-heading"><div><p className="eyebrow">OpenClaw</p><h2>Local Runtime</h2></div><span className="state-badge" data-state={runtime?.health ?? "unknown"}><span className="status-dot" data-state={runtime?.health ?? "unknown"} />{runtime?.health ?? "Unknown"}</span></div><div className="runtime-summary"><div><span className="metric-label">Version</span><strong>{runtime?.version ? `v${runtime.version}` : "Unknown"}</strong></div><div><span className="metric-label">Gateway</span><strong>{runtime?.ready ? "Ready" : isRunning ? "Running" : "Offline"}</strong></div><div><span className="metric-label">Connection</span><strong>This computer</strong></div><div><span className="metric-label">PID</span><strong>{runtime?.pid ?? "—"}</strong></div></div><p className="state-copy">{runtime?.reason ?? "Checking the local OpenClaw runtime."}</p><div className="action-row"><button className="primary-button" disabled={busy !== null || isRunning} onClick={() => void onAction("start")}>{busy === "start" ? "Starting…" : "Start runtime"}</button><button className="secondary-button" disabled={busy !== null || !isRunning} onClick={() => void onAction("restart")}>{busy === "restart" ? "Restarting…" : "Restart"}</button><button className="secondary-button" disabled={busy !== null || !isRunning} onClick={() => void onAction("stop")}>{busy === "stop" ? "Stopping…" : "Stop"}</button><button className="quiet-button" disabled={busy !== null} onClick={() => void onAction("doctor")}>{busy === "doctor" ? "Checking…" : "Run doctor"}</button><button className="quiet-button" disabled={busy !== null} onClick={() => void onRefresh()}>Refresh</button></div></div><div className="section-card span-two"><div className="section-heading"><div><p className="eyebrow">Live output</p><h3>Runtime logs</h3></div><span className="quiet-label">Last {logs.length} entries</span></div><div className="log-view" aria-live="polite">{logs.length === 0 ? <p className="empty-copy">No runtime output has been captured yet.</p> : logs.map((entry) => <div className="log-line" key={entry.id}><time>{formatTime(entry.timestamp)}</time><span className={`log-level ${entry.level}`}>{entry.level}</span><span>{entry.message}</span></div>)}</div><p className="footnote">Output is bounded to the latest 200 entries and is redacted by the native process boundary before delivery.</p></div><div className="section-card"><p className="eyebrow">Capabilities</p><h3>Available here</h3><Capability label="Local process control" enabled={capabilities.localRuntimeControl} /><Capability label="Secure credentials" enabled={capabilities.secureCredentialStore} /><Capability label="Native notifications" enabled={capabilities.nativeNotifications} /><Capability label="Terminal" enabled={capabilities.terminal} /></div><div className="section-card"><p className="eyebrow">Preferences</p><h3>Launch at login</h3><p className="state-copy">Start AgentOS automatically when you sign in to this computer.</p><button className="secondary-button" disabled={busy !== null || autostartEnabled === null} onClick={() => void onToggleAutostart()}>{busy === "autostart" ? "Saving…" : autostartEnabled ? "Enabled" : autostartEnabled === false ? "Enable" : "Unavailable"}</button></div><div className="section-card span-two"><div className="section-heading"><div><p className="eyebrow">Updates</p><h3>Signed desktop releases</h3></div><span className="quiet-label">{capabilities.updater ? "Release channel" : "Not configured"}</span></div><p className="state-copy">Updates are verified against the release signing key before installation.</p><div className="action-row"><button className="secondary-button" disabled={busy !== null || !capabilities.updater} onClick={() => void onCheckUpdates()}>{busy === "update-check" ? "Checking…" : "Check for updates"}</button>{availableUpdate && <button className="primary-button" disabled={busy !== null} onClick={() => void onInstallUpdate()}>{busy === "update-install" ? "Installing…" : `Install ${availableUpdate.version}`}</button>}</div></div></section>;
}

function WorkspaceSection({ workspaces, selectedWorkspace, entries, git, ollama, terminalSession, terminalOutput, terminalInput, busy, onAdd, onOpenTerminal, onTerminalInput, onSubmitTerminalInput, onSelect }: { workspaces: LocalWorkspace[]; selectedWorkspace: LocalWorkspace | null; entries: WorkspaceEntry[]; git: GitSummary | null; ollama: OllamaStatus | null; terminalSession: TerminalSession | null; terminalOutput: string; terminalInput: string; busy: string | null; onAdd: () => Promise<void>; onOpenTerminal: () => Promise<void>; onTerminalInput: (value: string) => void; onSubmitTerminalInput: () => void; onSelect: (workspace: LocalWorkspace) => void }) {
  return <section className="content-grid"><div className="section-card span-two"><div className="section-heading"><div><p className="eyebrow">Approved directories</p><h2>Workspace</h2></div><button className="primary-button" disabled={busy !== null} onClick={() => void onAdd()}>{busy === "workspace" ? "Choosing…" : "Add folder"}</button></div>{workspaces.length === 0 ? <div className="empty-state"><h3>No local workspace yet</h3><p>Select a folder to give AgentOS a scoped, user-approved working context.</p></div> : <div className="workspace-list">{workspaces.map((workspace) => <button key={workspace.id} className={`workspace-row ${selectedWorkspace?.id === workspace.id ? "selected" : ""}`} onClick={() => onSelect(workspace)}><span className="workspace-symbol">⌘</span><span><strong>{workspace.name}</strong><small>{workspace.path}</small></span><span className="chevron">›</span></button>)}</div>}</div><div className="section-card"><p className="eyebrow">Git</p><h3>{git?.branch ?? "Not connected"}</h3><p className="state-copy">{git?.summary ?? "Choose a workspace to inspect repository state."}</p><span className="state-badge" data-state={git?.dirty ? "degraded" : git?.repository ? "healthy" : "unknown"}>{git?.repository ? git.dirty ? "Changes present" : "Clean" : "Unknown"}</span></div><div className="section-card"><p className="eyebrow">Local models</p><h3>Ollama</h3><p className="state-copy">{ollama?.reason ?? (ollama?.running ? "Local model service is available." : "Not detected.")}</p><span className="state-badge" data-state={ollama?.running ? "healthy" : "unknown"}>{ollama?.running ? `${ollama.models.length} model${ollama.models.length === 1 ? "" : "s"}` : "Unavailable"}</span></div><div className="section-card span-two"><div className="section-heading"><div><p className="eyebrow">Scoped files</p><h3>{selectedWorkspace ? selectedWorkspace.name : "Choose a workspace"}</h3></div><span className="quiet-label">{entries.length} entries</span></div>{entries.length === 0 ? <p className="empty-copy">No readable entries at the workspace root.</p> : <div className="entry-grid">{entries.slice(0, 24).map((entry) => <div className="entry-row" key={entry.path}><span className="workspace-symbol">{entry.kind === "directory" ? "□" : "·"}</span><span><strong>{entry.name}</strong><small>{entry.kind}</small></span></div>)}</div>}</div><div className="section-card span-two"><div className="section-heading"><div><p className="eyebrow">Controlled PTY</p><h3>Terminal</h3></div><button className="secondary-button" disabled={!selectedWorkspace || busy !== null} onClick={() => void onOpenTerminal()}>{busy === "terminal" ? "Opening…" : terminalSession ? "Open another" : "Open terminal"}</button></div>{terminalSession ? <><div className="terminal-view" aria-live="polite">{terminalOutput || "Terminal ready. Commands run inside the approved workspace."}</div><div className="terminal-input-row"><input aria-label="Terminal input" value={terminalInput} onChange={(event) => onTerminalInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSubmitTerminalInput(); }} placeholder="Type a command and press Enter" /><button className="primary-button" onClick={onSubmitTerminalInput}>Send</button></div></> : <p className="empty-copy">Open a terminal to run an interactive shell scoped to the selected workspace.</p>}</div></section>;
}

function StatCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) { return <div className="stat-card"><span className="metric-label">{label}</span><strong>{value}</strong><span className="card-detail" title={detail}>{detail}</span><span className="status-dot" data-state={tone} /></div>; }
function ReadinessItem({ label, ready, detail }: { label: string; ready: boolean; detail: string }) { return <div className="readiness-item"><span className="status-dot" data-state={ready ? "healthy" : "unknown"} /><span><strong>{label}</strong><small>{detail}</small></span></div>; }
function Capability({ label, enabled }: { label: string; enabled: boolean }) { return <div className="capability-row"><span>{label}</span><span className="quiet-label">{enabled ? "Available" : "Unavailable"}</span></div>; }
function formatTime(value: string) { const date = /^\d+$/.test(value) ? new Date(Number(value) * 1_000) : new Date(value); return Number.isNaN(date.getTime()) ? "--:--:--" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" }); }
