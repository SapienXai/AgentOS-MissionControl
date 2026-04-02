export type OpenClawToolCatalogCategory = "builtin" | "plugin" | "group";

export interface OpenClawToolCatalogEntry {
  name: string;
  description: string;
  source: string;
  category: OpenClawToolCatalogCategory;
}

export const OPENCLAW_BUILTIN_TOOL_CATALOG: OpenClawToolCatalogEntry[] = [
  {
    name: "exec",
    description: "Run shell commands and manage background processes.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "process",
    description: "Run shell commands and manage background processes.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "bash",
    description: "Run shell commands and manage background processes.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "code_execution",
    description: "Run sandboxed remote Python analysis.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "browser",
    description: "Control a Chromium browser (navigate, click, screenshot).",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "web_search",
    description: "Search the web and fetch search results.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "x_search",
    description: "Search X posts.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "web_fetch",
    description: "Fetch page content.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "read",
    description: "Read files in the workspace.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "write",
    description: "Write files in the workspace.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "edit",
    description: "Edit files in the workspace.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "apply_patch",
    description: "Apply structured multi-hunk patches.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "message",
    description: "Send messages across channels.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "canvas",
    description: "Drive node canvas workflows.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "nodes",
    description: "Discover and target paired devices.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "cron",
    description: "Manage scheduled jobs.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "gateway",
    description: "Inspect and restart gateway services.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "image",
    description: "Analyze images.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "image_generate",
    description: "Generate or edit images.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "sessions_list",
    description: "Session management and sub-agent discovery.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "sessions_history",
    description: "Session management and sub-agent discovery.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "sessions_send",
    description: "Session management and sub-agent discovery.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "sessions_spawn",
    description: "Session management and sub-agent discovery.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "sessions_yield",
    description: "Session management and sub-agent discovery.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "subagents",
    description: "Session management and sub-agent discovery.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "session_status",
    description: "Session management and sub-agent discovery.",
    source: "OpenClaw built-in",
    category: "builtin"
  },
  {
    name: "agents_list",
    description: "Session management and sub-agent discovery.",
    source: "OpenClaw built-in",
    category: "builtin"
  }
];

export const OPENCLAW_TOOL_GROUP_CATALOG: OpenClawToolCatalogEntry[] = [
  {
    name: "group:runtime",
    description: "exec, bash, process, code_execution",
    source: "OpenClaw docs",
    category: "group"
  },
  {
    name: "group:fs",
    description: "read, write, edit, apply_patch",
    source: "OpenClaw docs",
    category: "group"
  },
  {
    name: "group:sessions",
    description: "sessions_list, sessions_history, sessions_send, sessions_spawn, sessions_yield, subagents, session_status",
    source: "OpenClaw docs",
    category: "group"
  },
  {
    name: "group:memory",
    description: "memory_search, memory_get",
    source: "OpenClaw docs",
    category: "group"
  },
  {
    name: "group:web",
    description: "web_search, x_search, web_fetch",
    source: "OpenClaw docs",
    category: "group"
  },
  {
    name: "group:ui",
    description: "browser, canvas",
    source: "OpenClaw docs",
    category: "group"
  },
  {
    name: "group:automation",
    description: "cron, gateway",
    source: "OpenClaw docs",
    category: "group"
  },
  {
    name: "group:messaging",
    description: "message",
    source: "OpenClaw docs",
    category: "group"
  },
  {
    name: "group:nodes",
    description: "nodes",
    source: "OpenClaw docs",
    category: "group"
  },
  {
    name: "group:openclaw",
    description: "All built-in OpenClaw tools (excludes plugin tools).",
    source: "OpenClaw docs",
    category: "group"
  }
];
