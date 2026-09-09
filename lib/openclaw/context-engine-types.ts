import type { AgentPolicy, OpenClawAgent, WorkspaceProject } from "@/lib/openclaw/types";
import type { WorkspaceManagedFile, WorkspaceManagedFileReadResponse } from "@/lib/openclaw/workspace-file-types";

export type ContextEngineTokenSource = "reported" | "estimated" | "unknown";
export type ContextEnginePreferenceSource = "agentos-sidecar" | "default";
export type ContextEngineRuntimeInclusionSource = "openclaw-report" | "unreported";

export type ContextEngineFileStatus = "enabled" | "disabled" | "missing" | "truncated" | "error";

export type ContextEngineScope = "agent" | "workspace" | "global" | "session";

export type ContextEngineFileOwner =
  | "workspace-global"
  | "legacy-bootstrap"
  | "agent-profile"
  | "agent-policy"
  | "workspace-skill"
  | "memory"
  | "generated-runtime-output";

export type ContextEngineFile = WorkspaceManagedFile & {
  owner: ContextEngineFileOwner;
  ownerLabel: string;
  selectedAgentOwned: boolean;
  enabled: boolean;
  savedEnabled: boolean;
  canToggle: boolean;
  status: ContextEngineFileStatus;
  statusReason?: string;
  scope: ContextEngineScope;
  rawTokens: number | null;
  injectedTokens: number | null;
  tokenSource: ContextEngineTokenSource;
  lastUpdatedAt: number | null;
  runtimeIncluded?: boolean;
  runtimeTokenEstimate?: number | null;
  preferenceSource: ContextEnginePreferenceSource;
  runtimeInclusionSource: ContextEngineRuntimeInclusionSource;
};

export type ContextEngineRuntimeReportSource =
  | "openclaw-session-report"
  | "openclaw-session-describe"
  | "degraded-estimate";

export type ContextEngineRuntimeFile = {
  path: string;
  label?: string | null;
  chars?: number | null;
  tokens?: number | null;
  truncated?: boolean;
};

export type ContextEngineRuntimeReport = {
  source: ContextEngineRuntimeReportSource;
  status: "exact" | "degraded";
  sessionId?: string | null;
  sessionKey?: string | null;
  updatedAt?: number | null;
  model?: string | null;
  systemPromptChars?: number | null;
  projectContextChars?: number | null;
  toolsSchemaChars?: number | null;
  skillsPromptChars?: number | null;
  totalTokens?: number | null;
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  injectedFiles: ContextEngineRuntimeFile[];
  truncation: {
    occurred: boolean;
    notes: string[];
  };
  diagnostics: string[];
};

export type ContextEnginePolicySnapshot = {
  preset: AgentPolicy["preset"];
  missingToolBehavior: AgentPolicy["missingToolBehavior"];
  installScope: AgentPolicy["installScope"];
  fileAccess: AgentPolicy["fileAccess"];
  networkAccess: AgentPolicy["networkAccess"];
  declaredSkills: string[];
  effectiveSkills: string[];
  declaredTools: string[];
  effectiveTools: string[];
  observedTools: string[];
  heartbeatEnabled: boolean;
};

export type ContextEngineBudgetItem = {
  id: "system" | "project" | "skills" | "tools" | "history" | "attachments";
  label: string;
  tokens: number | null;
  source: ContextEngineTokenSource;
};

export type ContextEngineBudget = {
  limit: number | null;
  usedTokens: number | null;
  usedSource: ContextEngineTokenSource;
  usedPercent: number | null;
  items: ContextEngineBudgetItem[];
  diagnostics: string[];
};

export type ContextEnginePreview = {
  source: "openclaw-report" | "agentos-estimate";
  status: "exact" | "estimated" | "unavailable";
  systemPromptSummary: string;
  activeFiles: Array<{
    path: string;
    label: string;
    status: ContextEngineFileStatus;
    tokens: number | null;
    source: ContextEngineTokenSource;
  }>;
  skills: string[];
  tools: string[];
  historySummary: string;
  attachmentsSummary: string;
  totalTokens: number | null;
  diagnostics: string[];
};

export type ContextEngineEffectiveContextSection = {
  id:
    | "system"
    | "openclaw-runtime"
    | "agentos-sidecar"
    | "enabled-files"
    | "disabled-files"
    | "file-issues"
    | "skills-tools"
    | "memory"
    | "history"
    | "attachments";
  label: string;
  source: "openclaw-report" | "agentos-sidecar" | "agentos-estimate" | "unsupported";
  status: "exact" | "estimated" | "unavailable";
  detail: string;
  items: string[];
};

export type ContextEngineEffectiveContext = {
  status: "exact" | "estimated" | "unavailable";
  source: "openclaw-report" | "agentos-estimate";
  sections: ContextEngineEffectiveContextSection[];
  diagnostics: string[];
};

export type ContextEngineCapabilities = {
  compaction: {
    supported: boolean;
    method: "native-gateway" | "cli-fallback" | "unsupported";
    reason: string | null;
  };
  nativeFileToggles: {
    supported: boolean;
    reason: string | null;
  };
};

export type ContextEngineConfiguration = {
  version: 1;
  agentId: string;
  workspaceId: string;
  source: "agentos-sidecar";
  storagePath: ".openclaw/context-engine.json";
  persistenceStatus: "loaded" | "missing" | "recovered";
  persistenceWarning: string | null;
  files: Array<{
    path: string;
    enabled: boolean;
  }>;
  updatedAt: string | null;
};

export type ContextEngineSnapshot = {
  agent: OpenClawAgent;
  workspace: WorkspaceProject;
  model: {
    id: string | null;
    label: string;
    provider: string | null;
    contextWindow: number | null;
  };
  sessionCount: number;
  runtimeCount: number;
  files: ContextEngineFile[];
  budget: ContextEngineBudget;
  policy: ContextEnginePolicySnapshot;
  runtimeReport: ContextEngineRuntimeReport;
  preview: ContextEnginePreview;
  effectiveContext: ContextEngineEffectiveContext;
  configuration: ContextEngineConfiguration;
  capabilities: ContextEngineCapabilities;
  diagnostics: string[];
  maxFileBytes: number;
};

export type ContextEngineFileReadResponse = WorkspaceManagedFileReadResponse & {
  file: ContextEngineFile;
};

export type ContextEngineSaveInput = {
  files: Array<{
    path: string;
    enabled: boolean;
  }>;
};
