import { useEffect, useMemo, useState, type ReactNode } from "react";

import type { GitSummary, LocalWorkspace, OllamaStatus, TerminalOutput, TerminalSession, WorkspaceEntry } from "@/lib/agentos/local-workspace";
import { getPlatformCapabilities, type PlatformCapabilities } from "@/lib/agentos/platform";
import type {
  DesktopActivity,
  DesktopAgent,
  DesktopMission,
  DesktopModel,
  DesktopPreferences,
  DesktopProductSnapshot,
  DesktopSkill
} from "@/lib/agentos/product-contract";
import type { RuntimeLogEntry, RuntimeStatus } from "@/lib/agentos/runtime-contract";
import { RuntimeRegistry } from "@/lib/agentos/runtime-registry";
import type { Update } from "@tauri-apps/plugin-updater";

import {
  chooseWorkspace,
  checkForDesktopUpdate,
  getAutostartEnabled,
  getDesktopPreferences,
  getDesktopProductSnapshot,
  getInitialDeepLinks,
  getGitSummary,
  getOllamaStatus,
  getPlatformInfo,
  installDesktopUpdate,
  listWorkspaceEntries,
  listWorkspaces,
  saveDesktopPreferences,
  spawnTerminal,
  subscribeToDeepLinks,
  subscribeToRuntimeRefresh,
  subscribeToTerminalExit,
  subscribeToTerminalOutput,
  setAutostartEnabled,
  writeTerminal,
  type DesktopPlatformInfo,
  DesktopUnavailableError
} from "./native/bridge";
import { OpenClawRuntimeAdapter } from "./native/openclaw-runtime";

type DesktopSection =
  | "mission-control"
  | "agents"
  | "missions"
  | "approvals"
  | "activity"
  | "models"
  | "skills"
  | "memory"
  | "runtime"
  | "workspaces"
  | "connections"
  | "settings";

type NavigationGroup = {
  label: string;
  items: { id: DesktopSection; label: string; icon: string }[];
};

const NAVIGATION: NavigationGroup[] = [
  { label: "AgentOS", items: [{ id: "mission-control", label: "Mission Control", icon: "⌂" }] },
  {
    label: "Workforce",
    items: [
      { id: "agents", label: "Agents", icon: "✦" },
      { id: "missions", label: "Missions", icon: "◇" },
      { id: "approvals", label: "Approvals", icon: "✓" },
      { id: "activity", label: "Activity", icon: "◌" }
    ]
  },
  {
    label: "Intelligence",
    items: [
      { id: "models", label: "Models", icon: "◎" },
      { id: "skills", label: "Skills", icon: "⌘" },
      { id: "memory", label: "Memory", icon: "▧" }
    ]
  },
  {
    label: "System",
    items: [
      { id: "runtime", label: "Runtime", icon: "◉" },
      { id: "workspaces", label: "Workspaces", icon: "□" },
      { id: "connections", label: "Connections", icon: "↔" },
      { id: "settings", label: "Settings", icon: "⚙" }
    ]
  }
];

const SECTION_TITLES: Record<DesktopSection, string> = {
  "mission-control": "Mission Control",
  agents: "Agents",
  missions: "Missions",
  approvals: "Approvals",
  activity: "Activity",
  models: "Models",
  skills: "Skills",
  memory: "Memory",
  runtime: "Runtime",
  workspaces: "Workspaces",
  connections: "Connections",
  settings: "Settings"
};

const runtimeRegistry = new RuntimeRegistry([new OpenClawRuntimeAdapter()]);
const localRuntime = runtimeRegistry.get("openclaw-local")!;

export function App() {
  const [section, setSection] = useState<DesktopSection>("mission-control");
  const [selectedProductId, setSelectedProductId] = useState<string | null>(null);
  const [platform, setPlatform] = useState<DesktopPlatformInfo | null>(null);
  const [preferences, setPreferences] = useState<DesktopPreferences | null>(null);
  const [autostartEnabled, setAutostartEnabledState] = useState<boolean | null>(null);
  const [availableUpdate, setAvailableUpdate] = useState<Update | null>(null);
  const [runtime, setRuntime] = useState<RuntimeStatus | null>(null);
  const [product, setProduct] = useState<DesktopProductSnapshot | null>(null);
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

  const capabilities: PlatformCapabilities = platform?.capabilities ?? getPlatformCapabilities("web");
  const runtimeLabel = runtime?.running ? "Running" : runtime?.installed ? "Stopped" : "Not installed";

  useEffect(() => {
    let active = true;
    async function initialize() {
      try {
        const nextPlatform = await getPlatformInfo();
        if (!active) return;
        setPlatform(nextPlatform);
        const nextPreferences = await getDesktopPreferences();
        if (!active) return;
        setPreferences(nextPreferences);
        setAutostartEnabledState(await getAutostartEnabled());
        if (nextPreferences.startRuntimeOnLaunch) await localRuntime.start();
        await Promise.all([refreshRuntime(), refreshProduct(), refreshWorkspaceData()]);
        const routes = await getInitialDeepLinks();
        routes.forEach(handleDeepLink);
      } catch (error) {
        if (!active) return;
        if (!(error instanceof DesktopUnavailableError)) setNotice(error instanceof Error ? error.message : "Unable to initialize the desktop surface.");
      }
    }
    void initialize();
    return () => { active = false; };
  // Native hydration intentionally runs once at app startup.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeToDeepLinks(handleDeepLink).then((cleanup) => { unlisten = cleanup; }).catch(() => {});
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeToRuntimeRefresh(() => { void refreshRuntime(); void refreshProduct(); }).then((cleanup) => { unlisten = cleanup; }).catch(() => {});
    return () => unlisten?.();
  }, []);

  useEffect(() => {
    if (!platform) return;
    const interval = window.setInterval(() => void refreshProduct(), 30_000);
    return () => window.clearInterval(interval);
  // The desktop product snapshot is intentionally low-frequency and native-driven.
  }, [platform]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeToTerminalOutput((output: TerminalOutput) => {
      setTerminalOutput((current) => {
        if (terminalSession && output.sessionId !== terminalSession.id) return current;
        return `${current}${output.data}`.slice(-40_000);
      });
    }).then((cleanup) => { unlisten = cleanup; }).catch(() => {});
    return () => unlisten?.();
  }, [terminalSession]);

  useEffect(() => {
    let unlisten: (() => void) | undefined;
    void subscribeToTerminalExit((sessionId) => {
      if (terminalSession?.id === sessionId) {
        setTerminalSession(null);
        setTerminalInput("");
        setNotice("The workspace terminal exited.");
      }
    }).then((cleanup) => { unlisten = cleanup; }).catch(() => {});
    return () => unlisten?.();
  }, [terminalSession]);

  async function refreshRuntime() {
    try {
      const [nextRuntime, nextLogs] = await Promise.all([localRuntime.getStatus(), localRuntime.getLogs()]);
      setRuntime(nextRuntime);
      setLogs(nextLogs);
    } catch (error) {
      if (!(error instanceof DesktopUnavailableError)) setNotice(error instanceof Error ? error.message : "Unable to read local runtime state.");
    }
  }

  async function refreshProduct() {
    try {
      setProduct(await getDesktopProductSnapshot());
    } catch (error) {
      if (error instanceof DesktopUnavailableError) { setProduct(null); return; }
      setNotice(error instanceof Error ? error.message : "Unable to read AgentOS product state.");
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
      if (!(error instanceof DesktopUnavailableError)) setNotice(error instanceof Error ? error.message : "Unable to read local workspace state.");
    }
  }

  async function performRuntimeAction(action: "start" | "stop" | "restart" | "doctor") {
    setBusy(action);
    setNotice(null);
    try {
      if (action === "doctor") setNotice((await localRuntime.doctor()).summary);
      else setRuntime(action === "start" ? await localRuntime.start() : action === "stop" ? await localRuntime.stop() : await localRuntime.restart());
      await refreshProduct();
      await refreshRuntime();
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Runtime action failed.");
    } finally {
      setBusy(null);
    }
  }

  function handleDeepLink(route: string) {
    const [root, id] = route.split("/");
    if (route === "runtime") {
      setSection("runtime");
      setSelectedProductId(null);
      setNotice("Opened the local runtime from an AgentOS link.");
      return;
    }
    if ((root === "agents" || root === "missions" || root === "approvals" || root === "workspaces") && id) {
      setSection(root === "workspaces" ? "workspaces" : root);
      setSelectedProductId(id);
      return;
    }
    setSection("mission-control");
    setSelectedProductId(null);
    setNotice(`AgentOS link received for ${route}. The route is not available in this desktop build.`);
  }

  async function toggleAutostart() {
    if (autostartEnabled === null) return;
    setBusy("autostart");
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

  async function savePreferences(patch: Partial<DesktopPreferences>, operation = "preferences") {
    if (!preferences) return;
    const next = { ...preferences, ...patch };
    setBusy(operation);
    try {
      await saveDesktopPreferences(next);
      setPreferences(next);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to save desktop preferences.");
    } finally {
      setBusy(null);
    }
  }

  async function completeOnboarding() { await savePreferences({ onboardingCompleted: true }, "onboarding"); }

  async function chooseOnboardingWorkspace() {
    if (!preferences) return;
    setBusy("onboarding");
    try {
      const workspace = await chooseWorkspace();
      if (workspace) {
        await refreshWorkspaceData();
        setSelectedWorkspace(workspace);
        setSection("workspaces");
        const next = { ...preferences, onboardingCompleted: true };
        await saveDesktopPreferences(next);
        setPreferences(next);
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to choose a workspace.");
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
    try {
      const workspace = await chooseWorkspace();
      if (workspace) {
        await refreshWorkspaceData();
        setSelectedWorkspace(workspace);
        setSection("workspaces");
      }
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to add workspace.");
    } finally {
      setBusy(null);
    }
  }

  async function selectWorkspace(workspace: LocalWorkspace) {
    setSelectedWorkspace(workspace);
    try {
      const [nextGit, nextEntries] = await Promise.all([getGitSummary(workspace.id), listWorkspaceEntries(workspace.id)]);
      setWorkspaceGit(nextGit);
      setWorkspaceEntries(nextEntries);
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Unable to inspect the selected workspace.");
    }
  }

  async function openTerminal() {
    if (!selectedWorkspace) return;
    setBusy("terminal");
    try {
      setTerminalSession(await spawnTerminal(selectedWorkspace.id));
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

  return <div className="app-shell"><aside className="sidebar" aria-label="Primary navigation"><div className="brand-lockup"><span className="brand-mark">A</span><div><strong>AgentOS</strong><span>Desktop control plane</span></div></div><nav className="product-nav">{NAVIGATION.map((group) => <div className="nav-group" key={group.label}><span className="nav-group-label">{group.label}</span>{group.items.map((item) => <button type="button" key={item.id} className={`nav-item ${section === item.id ? "active" : ""}`} onClick={() => { setSection(item.id); setSelectedProductId(null); }}><span className="nav-icon">{item.icon}</span>{item.label}{item.id === "approvals" && product?.approvals.length ? <span className="nav-count">{product.approvals.length}</span> : null}</button>)}</div>)}</nav><div className="sidebar-footer"><span className="status-dot" data-state={runtime?.health ?? "unknown"} /><span>{runtimeLabel}</span><span className="muted">{runtime?.version ? `v${runtime.version}` : "Local runtime"}</span></div></aside><main className="main-content"><header className="topbar"><div><p className="eyebrow">Human operating layer</p><h1>{SECTION_TITLES[section]}</h1></div><div className="topbar-meta"><span className="connection-badge"><span className="status-dot" data-state={product?.mode === "live" ? "healthy" : product?.mode === "offline" ? "offline" : "degraded"} /> This computer · OpenClaw</span></div></header>{notice && <div className="notice" role="status">{notice}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss notice">×</button></div>}{section === "mission-control" && <MissionControl product={product} runtime={runtime} onNavigate={(next, id) => { setSection(next); setSelectedProductId(id ?? null); }} />}{section === "agents" && <AgentsSection product={product} selectedId={selectedProductId} onSelect={setSelectedProductId} />}{section === "missions" && <MissionsSection product={product} selectedId={selectedProductId} onSelect={setSelectedProductId} />}{section === "approvals" && <ApprovalsSection product={product} selectedId={selectedProductId} onSelect={setSelectedProductId} />}{section === "activity" && <ActivitySection product={product} />}{section === "models" && <ModelsSection product={product} ollama={ollama} />}{section === "skills" && <SkillsSection product={product} />}{section === "memory" && <MemorySection product={product} />}{section === "connections" && <ConnectionsSection product={product} />}{section === "runtime" && <RuntimeSection runtime={runtime} logs={logs} busy={busy} capabilities={capabilities} autostartEnabled={autostartEnabled} availableUpdate={availableUpdate} onToggleAutostart={toggleAutostart} onCheckUpdates={checkForUpdates} onInstallUpdate={installUpdate} onRefresh={refreshRuntime} onAction={performRuntimeAction} />}{section === "workspaces" && <WorkspaceSection workspaces={workspaces} selectedWorkspace={selectedWorkspace} entries={workspaceEntries} git={workspaceGit} ollama={ollama} terminalSession={terminalSession} terminalOutput={terminalOutput} terminalInput={terminalInput} busy={busy} onAdd={addWorkspace} onOpenTerminal={openTerminal} onTerminalInput={setTerminalInput} onSubmitTerminalInput={() => void submitTerminalInput()} onSelect={(workspace) => void selectWorkspace(workspace)} />}{section === "settings" && <SettingsSection capabilities={capabilities} preferences={preferences} autostartEnabled={autostartEnabled} busy={busy} onPreference={(patch) => void savePreferences(patch, "preferences")} onToggleAutostart={toggleAutostart} onCheckUpdates={checkForUpdates} onInstallUpdate={installUpdate} availableUpdate={availableUpdate} />}{preferences && !preferences.onboardingCompleted && <FirstRunOverlay runtime={runtime} workspaces={workspaces} git={workspaceGit} ollama={ollama} busy={busy} onChooseWorkspace={chooseOnboardingWorkspace} onContinue={completeOnboarding} />}</main></div>;
}

function MissionControl({ product, runtime, onNavigate }: { product: DesktopProductSnapshot | null; runtime: RuntimeStatus | null; onNavigate: (section: DesktopSection, id?: string) => void }) {
  if (!product) return <LoadingState title="Mission Control is loading" detail="Waiting for the native AgentOS product bridge." />;
  const activeAgents = product.agents.filter((agent) => agent.status === "working").length;
  const runningMissions = product.missions.filter((mission) => mission.status === "running").length;
  const target = product.executionTargets[0];
  return <section className="product-stack"><ProductStateNotice product={product} /><div className="product-summary-grid"><MetricCard label="Active agents" value={String(activeAgents)} detail={product.agents.length ? `${product.agents.length} discovered` : "No agents reported"} tone={activeAgents ? "healthy" : "unknown"} /><MetricCard label="Running missions" value={String(runningMissions)} detail={product.missions.length ? `${product.missions.length} real missions` : "No active mission records"} tone={runningMissions ? "healthy" : "unknown"} /><MetricCard label="Approvals" value={String(product.approvals.length)} detail={product.approvals.length ? "Needs operator review" : "Nothing waiting"} tone={product.approvals.length ? "degraded" : "healthy"} /><MetricCard label="Execution target" value={target?.status === "ready" ? "Ready" : target?.status ?? "Unknown"} detail={target?.label ?? "No local target"} tone={target?.status === "ready" ? "healthy" : "degraded"} /></div><div className="content-grid"><div className="section-card"><SectionHeading eyebrow="Workforce" title="Agents" action={product.agents.length ? { label: "View all", onClick: () => onNavigate("agents") } : undefined} />{product.agents.length ? <div className="product-list">{product.agents.slice(0, 6).map((agent) => <ProductRow key={agent.id} selected={false} onClick={() => onNavigate("agents", agent.id)} title={agent.name} detail={agent.currentAction ?? "No active action reported"} meta={agentStatusLabel(agent.status)} state={agent.status === "working" ? "healthy" : agent.status === "blocked" ? "degraded" : "unknown"} trailing={target?.label} />)}</div> : <EmptyState title="No agents reported" detail="The native OpenClaw agent list is empty." />}</div><div className="section-card"><SectionHeading eyebrow="Workforce" title="Missions" action={product.missions.length ? { label: "View all", onClick: () => onNavigate("missions") } : undefined} />{product.missions.length ? <div className="product-list">{product.missions.slice(0, 6).map((mission) => <ProductRow key={mission.id} selected={false} onClick={() => onNavigate("missions", mission.id)} title={mission.title} detail={mission.summary ?? mission.agentName ?? "No mission detail reported"} meta={missionStatusLabel(mission.status)} state={mission.status === "running" ? "healthy" : mission.status === "failed" || mission.status === "blocked" ? "degraded" : "unknown"} />)}</div> : <EmptyState title="No missions reported" detail="Automation history is not presented as workforce missions." />}</div><div className="section-card span-two"><SectionHeading eyebrow="Recent activity" title="What OpenClaw changed" action={product.activity.length ? { label: "View activity", onClick: () => onNavigate("activity") } : undefined} />{product.activity.length ? <div className="activity-grid">{product.activity.slice(0, 8).map((item) => <ActivityRow key={item.id} activity={item} />)}</div> : <EmptyState title="No recent activity" detail="The native session and task feeds have not reported activity." />}</div><div className="section-card span-two compact-runtime"><div><p className="eyebrow">Runtime authority</p><h3>{runtime?.displayName ?? "OpenClaw"} · {runtime?.ready ? "Ready" : runtime?.running ? "Running" : "Offline"}</h3><p className="state-copy">Low-level process details stay in Runtime. Product state above comes from OpenClaw’s native CLI surfaces.</p></div><button type="button" className="quiet-button" onClick={() => onNavigate("runtime")}>Open Runtime</button></div></div></section>;
}

function AgentsSection({ product, selectedId, onSelect }: { product: DesktopProductSnapshot | null; selectedId: string | null; onSelect: (id: string) => void }) {
  return <ProductListSection eyebrow="Workforce" title="Agents" product={product} hasContent={Boolean(product?.agents.length)} emptyTitle="No agents reported" emptyDetail="OpenClaw has not exposed an agent record to the desktop yet.">{product?.agents.map((agent) => <ProductRow key={agent.id} selected={selectedId === agent.id} onClick={() => onSelect(agent.id)} title={agent.name} detail={agent.currentAction ?? agent.workspacePath ?? "No current action reported"} meta={`${agentStatusLabel(agent.status)} · ${agent.modelId ?? "Model not reported"}`} state={agent.status === "working" ? "healthy" : agent.status === "blocked" ? "degraded" : "unknown"} trailing="This Computer · OpenClaw" />)}</ProductListSection>;
}

function MissionsSection({ product, selectedId, onSelect }: { product: DesktopProductSnapshot | null; selectedId: string | null; onSelect: (id: string) => void }) {
  return <ProductListSection eyebrow="Workforce" title="Missions" product={product} hasContent={Boolean(product?.missions.length)} emptyTitle="No missions reported" emptyDetail="Only non-automation OpenClaw task records are shown here.">{product?.missions.map((mission) => <ProductRow key={mission.id} selected={selectedId === mission.id} onClick={() => onSelect(mission.id)} title={mission.title} detail={mission.summary ?? "No mission summary reported"} meta={`${missionStatusLabel(mission.status)} · ${mission.agentName ?? "Agent not reported"}`} state={mission.status === "running" ? "healthy" : mission.status === "failed" || mission.status === "blocked" ? "degraded" : "unknown"} trailing="This Computer · OpenClaw" />)}</ProductListSection>;
}

function ApprovalsSection({ product, selectedId, onSelect }: { product: DesktopProductSnapshot | null; selectedId: string | null; onSelect: (id: string) => void }) {
  return <ProductListSection eyebrow="Human control" title="Approvals" product={product} hasContent={Boolean(product?.approvals.length)} emptyTitle="No pending approvals" emptyDetail="OpenClaw is not reporting an operation that needs review.">{product?.approvals.map((approval) => <ProductRow key={approval.id} selected={selectedId === approval.id} onClick={() => onSelect(approval.id)} title={approval.title} detail={approval.summary ?? "Approval details were not reported by OpenClaw."} meta={`Pending · ${approval.agentId ?? "Agent not reported"}`} state="degraded" />)}</ProductListSection>;
}

function ActivitySection({ product }: { product: DesktopProductSnapshot | null }) {
  return <ProductListSection eyebrow="Evidence" title="Activity" product={product} hasContent={Boolean(product?.activity.length)} emptyTitle="No activity reported" emptyDetail="Sessions and non-automation task records will appear here when OpenClaw reports them."><div className="activity-grid">{product?.activity.map((item) => <ActivityRow key={item.id} activity={item} />)}</div></ProductListSection>;
}

function ModelsSection({ product, ollama }: { product: DesktopProductSnapshot | null; ollama: OllamaStatus | null }) {
  const models = useMemo(() => {
    const native = product?.models ?? [];
    const local = ollama?.models.map((id): DesktopModel => ({ id: `ollama/${id}`, name: id, provider: "Ollama", local: true, available: ollama.running, tags: ["this computer"] })) ?? [];
    return [...native, ...local];
  }, [ollama, product]);
  return <ProductListSection eyebrow="Intelligence" title="Models" product={product} hasContent={Boolean(product?.models.length || ollama?.models.length)} emptyTitle="No models reported" emptyDetail="OpenClaw and Ollama have not reported any model records."><div className="model-grid">{models.map((model) => <div className="model-card" key={model.id}><div className="row-between"><strong>{model.name}</strong><StatusBadge state={model.available === false ? "offline" : model.local ? "healthy" : "unknown"} label={model.available === false ? "Unavailable" : model.local ? "Local" : "Configured"} /></div><span className="card-detail">{model.provider} · {model.local ? "This computer" : "OpenClaw"}</span>{model.tags.length ? <div className="tag-list">{model.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}</div> : null}</div>)}</div></ProductListSection>;
}

function SkillsSection({ product }: { product: DesktopProductSnapshot | null }) {
  return <ProductListSection eyebrow="Intelligence" title="Skills" product={product} hasContent={Boolean(product?.skills.length)} emptyTitle="No skills reported" emptyDetail="The OpenClaw skills surface is unavailable or empty."><div className="model-grid">{product?.skills.map((skill) => <SkillCard key={skill.id} skill={skill} />)}</div></ProductListSection>;
}

function MemorySection({ product }: { product: DesktopProductSnapshot | null }) {
  if (!product) return <LoadingState title="Memory is loading" detail="Waiting for the native OpenClaw memory status." />;
  return <section className="product-stack"><ProductStateNotice product={product} /><div className="section-card"><SectionHeading eyebrow="Intelligence" title="Memory" /><div className="runtime-summary"><div><span className="metric-label">Backend</span><strong>{product.memory.available ? "Available" : "Unavailable"}</strong></div><div><span className="metric-label">Indexed files</span><strong>{product.memory.indexedFiles}</strong></div><div><span className="metric-label">Index state</span><strong>{product.memory.dirty ? "Needs attention" : "Clean"}</strong></div><div><span className="metric-label">Owner</span><strong>OpenClaw</strong></div></div><p className="state-copy">{product.memory.reason ?? "OpenClaw memory status is healthy."}</p></div></section>;
}

function ConnectionsSection({ product }: { product: DesktopProductSnapshot | null }) {
  return <ProductListSection eyebrow="System" title="Connections" product={product} hasContent={Boolean(product?.connections.length)} emptyTitle="No connections reported" emptyDetail="The OpenClaw status surface has not reported connection metadata.">{product?.connections.map((connection) => <ProductRow key={connection.id} selected={false} title={connection.name} detail={connection.detail ?? "No connection detail reported"} meta={`${connection.type} · ${connection.status}`} state={connection.status === "connected" ? "healthy" : connection.status === "configured" ? "degraded" : "unknown"} />)}</ProductListSection>;
}

function RuntimeSection({ runtime, logs, busy, capabilities, autostartEnabled, availableUpdate, onToggleAutostart, onCheckUpdates, onInstallUpdate, onRefresh, onAction }: { runtime: RuntimeStatus | null; logs: RuntimeLogEntry[]; busy: string | null; capabilities: PlatformCapabilities; autostartEnabled: boolean | null; availableUpdate: Update | null; onToggleAutostart: () => Promise<void>; onCheckUpdates: () => Promise<void>; onInstallUpdate: () => Promise<void>; onRefresh: () => Promise<void>; onAction: (action: "start" | "stop" | "restart" | "doctor") => Promise<void> }) {
  const isRunning = runtime?.running === true;
  return <section className="product-stack"><div className="section-card"><div className="section-heading"><div><p className="eyebrow">Execution target</p><h2>OpenClaw · This computer</h2></div><StatusBadge state={runtime?.health ?? "unknown"} label={runtime?.ready ? "Ready" : runtime?.running ? "Running" : runtime?.health ?? "Unknown"} /></div><div className="runtime-summary"><div><span className="metric-label">Version</span><strong>{runtime?.version ? `v${runtime.version}` : "Unknown"}</strong></div><div><span className="metric-label">Gateway</span><strong>{runtime?.ready ? "Ready" : isRunning ? "Running" : "Offline"}</strong></div><div><span className="metric-label">Authority</span><strong>OpenClaw</strong></div><div><span className="metric-label">PID</span><strong>{runtime?.pid ?? "—"}</strong></div></div><p className="state-copy">{runtime?.reason ?? "Checking the local OpenClaw runtime."}</p><div className="action-row"><button type="button" className="primary-button" disabled={busy !== null || isRunning} onClick={() => void onAction("start")}>{busy === "start" ? "Starting…" : "Start runtime"}</button><button type="button" className="secondary-button" disabled={busy !== null || !isRunning} onClick={() => void onAction("restart")}>{busy === "restart" ? "Restarting…" : "Restart"}</button><button type="button" className="secondary-button" disabled={busy !== null || !isRunning} onClick={() => void onAction("stop")}>{busy === "stop" ? "Stopping…" : "Stop"}</button><button type="button" className="quiet-button" disabled={busy !== null} onClick={() => void onAction("doctor")}>{busy === "doctor" ? "Checking…" : "Run doctor"}</button><button type="button" className="quiet-button" disabled={busy !== null} onClick={() => void onRefresh()}>Refresh</button></div></div><div className="section-card"><SectionHeading eyebrow="Advanced diagnostics" title="Runtime output" /><details><summary>Show the latest {logs.length} log entries</summary><div className="log-view" aria-live="polite">{logs.length === 0 ? <p className="empty-copy">No runtime output has been captured yet.</p> : logs.map((entry) => <div className="log-line" key={entry.id}><time>{formatTime(entry.timestamp)}</time><span className={`log-level ${entry.level}`}>{entry.level}</span><span>{entry.message}</span></div>)}</div><p className="footnote">Output is bounded to the latest 200 entries and redacted at the native process boundary.</p></details></div><div className="content-grid"><div className="section-card"><p className="eyebrow">Native capabilities</p><h3>Available here</h3><Capability label="Local process control" enabled={capabilities.localRuntimeControl} /><Capability label="Secure credentials" enabled={capabilities.secureCredentialStore} /><Capability label="Native notifications" enabled={capabilities.nativeNotifications} /><Capability label="Controlled terminal" enabled={capabilities.terminal} /></div><div className="section-card"><p className="eyebrow">Launch at login</p><h3>{autostartEnabled ? "Enabled" : "Disabled"}</h3><p className="state-copy">Start AgentOS automatically when you sign in to this computer.</p><button type="button" className="secondary-button" disabled={busy !== null || autostartEnabled === null} onClick={() => void onToggleAutostart()}>{busy === "autostart" ? "Saving…" : autostartEnabled ? "Disable" : autostartEnabled === false ? "Enable" : "Unavailable"}</button></div></div><div className="section-card"><SectionHeading eyebrow="Release channel" title="Signed desktop updates" /><p className="state-copy">Updates are verified against the release signing key before installation.</p><div className="action-row"><button type="button" className="secondary-button" disabled={busy !== null || !capabilities.updater} onClick={() => void onCheckUpdates()}>{busy === "update-check" ? "Checking…" : capabilities.updater ? "Check for updates" : "Release build only"}</button>{availableUpdate && <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void onInstallUpdate()}>{busy === "update-install" ? "Installing…" : `Install ${availableUpdate.version}`}</button>}</div></div></section>;
}

function WorkspaceSection({ workspaces, selectedWorkspace, entries, git, ollama, terminalSession, terminalOutput, terminalInput, busy, onAdd, onOpenTerminal, onTerminalInput, onSubmitTerminalInput, onSelect }: { workspaces: LocalWorkspace[]; selectedWorkspace: LocalWorkspace | null; entries: WorkspaceEntry[]; git: GitSummary | null; ollama: OllamaStatus | null; terminalSession: TerminalSession | null; terminalOutput: string; terminalInput: string; busy: string | null; onAdd: () => Promise<void>; onOpenTerminal: () => Promise<void>; onTerminalInput: (value: string) => void; onSubmitTerminalInput: () => void; onSelect: (workspace: LocalWorkspace) => void }) {
  return <section className="product-stack"><div className="section-card"><div className="section-heading"><div><p className="eyebrow">Approved directories</p><h2>Workspaces</h2></div><button type="button" className="primary-button" disabled={busy !== null} onClick={() => void onAdd()}>{busy === "workspace" ? "Choosing…" : "Add folder"}</button></div>{workspaces.length === 0 ? <EmptyState title="No local workspace yet" detail="Select a folder to give AgentOS a scoped, user-approved working context." /> : <div className="workspace-list">{workspaces.map((workspace) => <button type="button" key={workspace.id} className={`workspace-row ${selectedWorkspace?.id === workspace.id ? "selected" : ""}`} onClick={() => onSelect(workspace)}><span className="workspace-symbol">⌘</span><span><strong>{workspace.name}</strong><small>{workspace.path}</small></span><span className="chevron">›</span></button>)}</div>}</div><div className="content-grid"><div className="section-card"><p className="eyebrow">Git</p><h3>{git?.branch ?? "Not connected"}</h3><p className="state-copy">{git?.summary ?? "Choose a workspace to inspect repository state."}</p><StatusBadge state={git?.dirty ? "degraded" : git?.repository ? "healthy" : "unknown"} label={git?.repository ? git.dirty ? "Changes present" : "Clean" : "Unknown"} /></div><div className="section-card"><p className="eyebrow">Ollama</p><h3>{ollama?.running ? "Local service available" : "Local service unavailable"}</h3><p className="state-copy">{ollama?.reason ?? "Ollama is available on this computer."}</p><StatusBadge state={ollama?.running ? "healthy" : "unknown"} label={ollama?.running ? `${ollama.models.length} model${ollama.models.length === 1 ? "" : "s"}` : "Unavailable"} /></div></div><div className="section-card"><SectionHeading eyebrow="Scoped files" title={selectedWorkspace?.name ?? "Choose a workspace"} /><span className="quiet-label">{entries.length} entries</span>{entries.length === 0 ? <p className="empty-copy">No readable entries at the workspace root.</p> : <div className="entry-grid">{entries.slice(0, 24).map((entry) => <div className="entry-row" key={entry.path}><span className="workspace-symbol">{entry.kind === "directory" ? "□" : "·"}</span><span><strong>{entry.name}</strong><small>{entry.kind}</small></span></div>)}</div>}</div><div className="section-card"><div className="section-heading"><div><p className="eyebrow">Controlled PTY</p><h3>Terminal</h3></div><button type="button" className="secondary-button" disabled={!selectedWorkspace || busy !== null} onClick={() => void onOpenTerminal()}>{busy === "terminal" ? "Opening…" : terminalSession ? "Open another" : "Open terminal"}</button></div>{terminalSession ? <><div className="terminal-view" aria-live="polite">{terminalOutput || "Terminal ready. Commands run inside the approved workspace."}</div><div className="terminal-input-row"><input aria-label="Terminal input" value={terminalInput} onChange={(event) => onTerminalInput(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") onSubmitTerminalInput(); }} placeholder="Type a command and press Enter" /><button type="button" className="primary-button" onClick={onSubmitTerminalInput}>Send</button></div></> : <p className="empty-copy">Open a terminal to run an interactive shell scoped to the selected workspace.</p>}</div></section>;
}

function SettingsSection({ capabilities, preferences, autostartEnabled, busy, onPreference, onToggleAutostart, onCheckUpdates, onInstallUpdate, availableUpdate }: { capabilities: PlatformCapabilities; preferences: DesktopPreferences | null; autostartEnabled: boolean | null; busy: string | null; onPreference: (patch: Partial<DesktopPreferences>) => void; onToggleAutostart: () => Promise<void>; onCheckUpdates: () => Promise<void>; onInstallUpdate: () => Promise<void>; availableUpdate: Update | null }) {
  return <section className="product-stack"><div className="section-card"><SectionHeading eyebrow="Desktop preferences" title="Operator settings" /><PreferenceRow label="Launch at login" detail="Start AgentOS when you sign in to this computer." value={autostartEnabled} onToggle={() => void onToggleAutostart()} disabled={busy !== null || autostartEnabled === null} /><PreferenceRow label="Close to tray" detail="Keep the local runtime available when the window is closed." value={preferences?.closeToTray ?? null} onToggle={() => onPreference({ closeToTray: !preferences?.closeToTray })} disabled={busy !== null || !preferences} /><PreferenceRow label="Notifications" detail="Allow event-driven desktop notifications for approvals, completions, blocks, and crashes." value={preferences?.notificationsEnabled ?? null} onToggle={() => onPreference({ notificationsEnabled: !preferences?.notificationsEnabled })} disabled={busy !== null || !preferences} /><PreferenceRow label="Start OpenClaw on launch" detail="Start the managed runtime on app launch when the local binary is available." value={preferences?.startRuntimeOnLaunch ?? null} onToggle={() => onPreference({ startRuntimeOnLaunch: !preferences?.startRuntimeOnLaunch })} disabled={busy !== null || !preferences} /></div><div className="section-card"><SectionHeading eyebrow="Native boundary" title="Capabilities" /><Capability label="Scoped filesystem" enabled={capabilities.nativeFilesystem} /><Capability label="OpenClaw lifecycle" enabled={capabilities.localRuntimeControl} /><Capability label="Secure credential store" enabled={capabilities.secureCredentialStore} /><Capability label="System tray" enabled={capabilities.systemTray} /><Capability label="Signed updater" enabled={capabilities.updater} /></div><div className="section-card"><SectionHeading eyebrow="Release channel" title="Updates" /><p className="state-copy">Only release builds with a configured updater endpoint can install signed updates.</p><div className="action-row"><button type="button" className="secondary-button" disabled={busy !== null || !capabilities.updater} onClick={() => void onCheckUpdates()}>{busy === "update-check" ? "Checking…" : capabilities.updater ? "Check for updates" : "Release build only"}</button>{availableUpdate && <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void onInstallUpdate()}>{busy === "update-install" ? "Installing…" : `Install ${availableUpdate.version}`}</button>}</div></div></section>;
}

function FirstRunOverlay({ runtime, workspaces, git, ollama, busy, onChooseWorkspace, onContinue }: { runtime: RuntimeStatus | null; workspaces: LocalWorkspace[]; git: GitSummary | null; ollama: OllamaStatus | null; busy: string | null; onChooseWorkspace: () => Promise<void>; onContinue: () => Promise<void> }) {
  const openClawDetail = runtime?.installed ? (runtime.ready ? "Installed and ready" : "Installed; readiness needs attention") : "Not detected";
  const workspaceDetail = workspaces.length ? `${workspaces.length} approved folder${workspaces.length === 1 ? "" : "s"}` : "Choose a folder when you are ready";
  const ollamaDetail = ollama?.running ? `${ollama.models.length} local model${ollama.models.length === 1 ? "" : "s"}` : "Optional local model service";
  return (
    <div className="onboarding-scrim">
      <section className="onboarding-card" role="dialog" aria-modal="true" aria-labelledby="onboarding-title">
        <p className="eyebrow">First run</p>
        <h2 id="onboarding-title">Welcome to AgentOS</h2>
        <p className="hero-copy">A local operator surface for the OpenClaw workforce. Confirm the pieces available on this computer before entering Mission Control.</p>
        <div className="readiness-list">
          <ReadinessItem label="OpenClaw" ready={Boolean(runtime?.installed)} detail={openClawDetail} />
          <ReadinessItem label="Approved workspace" ready={workspaces.length > 0} detail={workspaceDetail} />
          <ReadinessItem label="Git" ready={Boolean(git?.available)} detail={git?.available ? "Available for the selected workspace" : "Checked when a workspace is selected"} />
          <ReadinessItem label="Ollama" ready={Boolean(ollama?.running)} detail={ollamaDetail} />
        </div>
        <div className="action-row">
          <button type="button" className="primary-button" disabled={busy !== null} onClick={() => void onChooseWorkspace()}>{busy === "onboarding" ? "Saving…" : "Choose workspace"}</button>
          <button type="button" className="quiet-button" disabled={busy !== null} onClick={() => void onContinue()}>Continue without local runtime</button>
        </div>
        <p className="footnote">You can change these choices later in Settings. No remote execution target is added automatically.</p>
      </section>
    </div>
  );
}
function ProductListSection({ eyebrow, title, product, hasContent, emptyTitle, emptyDetail, children }: { eyebrow: string; title: string; product: DesktopProductSnapshot | null; hasContent?: boolean; emptyTitle: string; emptyDetail: string; children: ReactNode }) {
  const contentAvailable = hasContent ?? Boolean(product && (product.agents.length || product.missions.length || product.approvals.length || product.activity.length || product.models.length || product.skills.length || product.connections.length));
  return <section className="product-stack"><ProductStateNotice product={product} />{!product ? <LoadingState title={`${title} is loading`} detail="Waiting for the native AgentOS product bridge." /> : <div className="section-card"><SectionHeading eyebrow={eyebrow} title={title} />{contentAvailable ? children : <EmptyState title={emptyTitle} detail={emptyDetail} />}</div>}</section>;
}

function ProductStateNotice({ product }: { product: DesktopProductSnapshot | null }) {
  if (!product || product.mode === "live") return null;
  return <div className={`product-state ${product.mode}`}><StatusBadge state={product.mode === "offline" ? "offline" : "degraded"} label={product.mode === "offline" ? "Offline" : "Degraded"} /><span>{product.reason ?? "Some OpenClaw product data is unavailable. Displayed records remain bounded to verified native responses."}</span></div>;
}

function SectionHeading({ eyebrow, title, action }: { eyebrow: string; title: string; action?: { label: string; onClick: () => void } }) {
  return <div className="section-heading"><div><p className="eyebrow">{eyebrow}</p><h2>{title}</h2></div>{action && <button type="button" className="quiet-button" onClick={action.onClick}>{action.label}</button>}</div>;
}

function ProductRow({ title, detail, meta, state, trailing, selected, onClick }: { title: string; detail: string; meta: string; state: string; trailing?: string; selected: boolean; onClick?: () => void }) {
  const content = <><span className="status-dot" data-state={state} /><span className="product-row-copy"><strong>{title}</strong><small>{detail}</small></span><span className="product-row-meta">{meta}</span>{trailing && <span className="product-row-target">{trailing}</span>}<span className="chevron">›</span></>;
  return onClick ? <button type="button" className={`product-row ${selected ? "selected" : ""}`} onClick={onClick}>{content}</button> : <div className="product-row">{content}</div>;
}

function ActivityRow({ activity }: { activity: DesktopActivity }) {
  return <div className="activity-row"><span className="activity-kind">{activity.kind}</span><span className="product-row-copy"><strong>{activity.title}</strong><small>{activity.detail ?? "No further detail reported"}</small></span><time>{formatTime(activity.updatedAt)}</time></div>;
}

function SkillCard({ skill }: { skill: DesktopSkill }) {
  return <div className="model-card"><div className="row-between"><strong>{skill.name}</strong><StatusBadge state={skill.available ? "healthy" : "unknown"} label={skill.available ? "Available" : "Unavailable"} /></div><span className="card-detail">{skill.description ?? "No description reported by OpenClaw."}</span></div>;
}

function PreferenceRow({ label, detail, value, onToggle, disabled }: { label: string; detail: string; value: boolean | null; onToggle: () => void; disabled: boolean }) {
  return <div className="preference-row"><span><strong>{label}</strong><small>{detail}</small></span><button type="button" className={`toggle ${value ? "on" : ""}`} aria-pressed={value === true} disabled={disabled} onClick={onToggle}>{value === null ? "Unavailable" : value ? "On" : "Off"}</button></div>;
}

function MetricCard({ label, value, detail, tone }: { label: string; value: string; detail: string; tone: string }) {
  return <div className="metric-card"><span className="metric-label">{label}</span><strong>{value}</strong><span className="card-detail">{detail}</span><span className="status-dot" data-state={tone} /></div>;
}

function StatusBadge({ state, label }: { state: string; label: string }) {
  return <span className="state-badge" data-state={state}><span className="status-dot" data-state={state} />{label}</span>;
}

function Capability({ label, enabled }: { label: string; enabled: boolean }) {
  return <div className="capability-row"><span>{label}</span><span className="quiet-label">{enabled ? "Available" : "Unavailable"}</span></div>;
}

function ReadinessItem({ label, ready, detail }: { label: string; ready: boolean; detail: string }) {
  return <div className="readiness-item"><span className="status-dot" data-state={ready ? "healthy" : "unknown"} /><span><strong>{label}</strong><small>{detail}</small></span></div>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="empty-state"><h3>{title}</h3><p>{detail}</p></div>;
}

function LoadingState({ title, detail }: { title: string; detail: string }) {
  return <section className="section-card loading-state"><span className="status-dot" data-state="unknown" /><div><h3>{title}</h3><p>{detail}</p></div></section>;
}

function agentStatusLabel(status: DesktopAgent["status"]) {
  return status[0].toUpperCase() + status.slice(1);
}

function missionStatusLabel(status: DesktopMission["status"]) {
  return status.replace("_", " ").replace(/^./, (value) => value.toUpperCase());
}

function formatTime(value: string | null | undefined) {
  if (!value) return "—";
  const date = /^\d+$/.test(value) ? new Date(Number(value) * 1_000) : new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}
