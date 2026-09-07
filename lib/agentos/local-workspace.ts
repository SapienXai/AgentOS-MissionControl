export type LocalWorkspace = {
  id: string;
  name: string;
  path: string;
  createdAt: string;
};

export type WorkspaceEntry = {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink" | "other";
  size: number | null;
  modifiedAt: string | null;
};

export type GitSummary = {
  available: boolean;
  repository: boolean;
  branch: string | null;
  dirty: boolean | null;
  summary: string | null;
  reason: string | null;
};

export type OllamaStatus = {
  installed: boolean;
  running: boolean;
  endpoint: string | null;
  models: string[];
  reason: string | null;
};

export type TerminalSession = {
  id: string;
  workspaceId: string;
  shell: string;
};

export type TerminalOutput = {
  sessionId: string;
  data: string;
};
