import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, test } from "node:test";

import { setOpenClawAdapterForTesting, type OpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import {
  buildWorkspaceAgentStatePath,
  preserveLegacyAgentContextFiles,
  upsertAgentConfigEntry,
  type MutableAgentConfigEntry
} from "@/lib/openclaw/domains/agent-config";

const tempRoots: string[] = [];

afterEach(async () => {
  setOpenClawAdapterForTesting(null);
  await Promise.all(tempRoots.splice(0).map((root) => rm(root, { recursive: true, force: true })));
});

test("agent provisioning preserves existing legacy agent context files", async () => {
  const tempRoot = await mkdtemp(path.join(os.tmpdir(), "agentos-agent-config-"));
  tempRoots.push(tempRoot);
  const workspacePath = path.join(tempRoot, "workspace");
  const agentDir = buildWorkspaceAgentStatePath(workspacePath, "agent-1");
  await mkdir(agentDir, { recursive: true });
  await writeFile(path.join(agentDir, "TOOLS.md"), "# Custom tool notes\n");
  await writeFile(path.join(agentDir, "HEARTBEAT.md"), "# Custom watch notes\n");

  const preserved = await preserveLegacyAgentContextFiles("agent-1", workspacePath, agentDir);

  assert.deepEqual(preserved.sort(), [
    path.join(agentDir, "HEARTBEAT.md"),
    path.join(agentDir, "TOOLS.md")
  ]);
  assert.equal(await readFile(path.join(agentDir, "TOOLS.md"), "utf8"), "# Custom tool notes\n");
  await access(path.join(agentDir, "HEARTBEAT.md"));
});

test("agent config upsert preserves omitted fields while updating identity and model", async () => {
  let config: Record<string, Omit<MutableAgentConfigEntry, "id">> = {
    "agent-1": {
      workspace: "/workspace",
      agentDir: "/workspace/.openclaw/agents/agent-1/agent",
      name: "Agent One",
      model: "openai/old",
      identity: {
        name: "Agent One",
        emoji: "A"
      }
    }
  };

  setOpenClawAdapterForTesting({
    async getConfig(pathName: string) {
      assert.equal(pathName, "agents.entries");
      return config;
    },
    async setConfig(pathName: string, value: unknown) {
      assert.equal(pathName, "agents.entries");
      config = value as Record<string, Omit<MutableAgentConfigEntry, "id">>;
      return { stdout: "", stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await upsertAgentConfigEntry("agent-1", "/workspace", {
    model: "openai/new"
  });

  assert.deepEqual(config["agent-1"], {
    workspace: "/workspace",
    agentDir: "/workspace/.openclaw/agents/agent-1/agent",
    name: "Agent One",
    model: "openai/new",
    identity: {
      name: "Agent One",
      emoji: "A"
    }
  });

  await upsertAgentConfigEntry("agent-1", "/workspace", {
    identity: {
      name: "Agent Prime",
      theme: "violet"
    }
  });

  assert.equal(config["agent-1"]?.name, "Agent One");
  assert.deepEqual(config["agent-1"]?.identity, {
    name: "Agent Prime",
    theme: "violet"
  });
});

test("agent config maps only supported Worker Profile runtime fields and preserves unknown tool settings", async () => {
  let config: Record<string, Omit<MutableAgentConfigEntry, "id">> = {
    "agent-1": {
      workspace: "/workspace",
      tools: {
        alsoAllow: ["web_fetch"],
        fs: {
          workspaceOnly: false
        }
      },
      sandbox: {
        backend: "docker"
      }
    }
  };

  setOpenClawAdapterForTesting({
    async getConfig<TPayload>() {
      return config as TPayload;
    },
    async setConfig(_pathName: string, value: unknown) {
      config = value as Record<string, Omit<MutableAgentConfigEntry, "id">>;
      return { stdout: "", stderr: "" };
    }
  } as unknown as OpenClawAdapter);

  await upsertAgentConfigEntry("agent-1", "/workspace", {
    description: "Deliver a concise daily brief.",
    tools: {
      profile: "coding",
      allow: ["read", "write", "read"],
      deny: ["browser"],
      fs: { workspaceOnly: true }
    },
    sandbox: {
      mode: "all",
      scope: "agent",
      workspaceAccess: "ro"
    },
    memorySearch: {
      enabled: true,
      sources: ["memory", "sessions", "memory"]
    }
  });

  assert.deepEqual(config["agent-1"]?.tools, {
    alsoAllow: ["web_fetch"],
    profile: "coding",
    allow: ["read", "write"],
    deny: ["browser"],
    fs: {
      workspaceOnly: true
    }
  });
  assert.deepEqual(config["agent-1"]?.sandbox, {
    backend: "docker",
    mode: "all",
    scope: "agent",
    workspaceAccess: "ro"
  });
  const persistedMemory = config["agent-1"]?.memory as { search?: unknown } | undefined;
  assert.deepEqual(persistedMemory?.search, {
    enabled: true,
    sources: ["memory", "sessions"]
  });
  assert.equal(config["agent-1"]?.description, "Deliver a concise daily brief.");
});
