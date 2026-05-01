import "server-only";

import { constants as fsConstants } from "node:fs";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import type { MissionControlSnapshot } from "@/lib/openclaw/types";

export type OpenClawRuntimeState = Omit<MissionControlSnapshot["diagnostics"]["runtime"], "smokeTest">;

function buildOpenClawSessionStorePath(openClawStateRootPath: string, agentId: string) {
  return path.join(openClawStateRootPath, "agents", agentId, "sessions");
}

function formatRuntimeWriteabilityIssue(targetPath: string, error: unknown) {
  if (!error || typeof error !== "object") {
    return `${targetPath}: unknown filesystem error`;
  }

  const code =
    "code" in error && typeof error.code === "string"
      ? error.code
      : "unknown";
  const message =
    "message" in error && typeof error.message === "string"
      ? error.message
      : "unknown filesystem error";

  return `${targetPath}: ${code} ${message}`;
}

async function probeDirectoryWriteability(
  targetPath: string,
  options: {
    createIfMissing?: boolean;
    touch?: boolean;
  } = {}
) {
  try {
    if (options.createIfMissing !== false) {
      await mkdir(targetPath, { recursive: true });
    }

    await access(targetPath, fsConstants.R_OK | fsConstants.W_OK);

    if (options.touch) {
      const probeFilePath = path.join(
        targetPath,
        `.agentos-write-check-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2)}`
      );

      await writeFile(probeFilePath, "", "utf8");
      await rm(probeFilePath, { force: true });
    }

    return {
      writable: true,
      issue: null
    };
  } catch (error) {
    return {
      writable: false,
      issue: formatRuntimeWriteabilityIssue(targetPath, error)
    };
  }
}

export async function inspectOpenClawRuntimeState(
  openClawStateRootPath: string,
  agentIds: string[],
  options: {
    touch?: boolean;
  } = {}
): Promise<OpenClawRuntimeState> {
  const uniqueAgentIds = [...new Set(agentIds.filter(Boolean))];
  const stateRootProbe = await probeDirectoryWriteability(openClawStateRootPath, {
    createIfMissing: true,
    touch: options.touch
  });
  const sessionStores = await Promise.all(
    uniqueAgentIds.map(async (agentId) => {
      const storePath = buildOpenClawSessionStorePath(openClawStateRootPath, agentId);
      const probe = await probeDirectoryWriteability(storePath, {
        createIfMissing: true,
        touch: options.touch
      });

      return {
        id: agentId,
        path: storePath,
        writable: probe.writable,
        issue: probe.issue
      };
    })
  );
  const sessionStoreWritable = sessionStores.every((entry) => entry.writable);
  const issues = [
    stateRootProbe.writable
      ? null
      : `OpenClaw state root is not writable. ${stateRootProbe.issue ?? openClawStateRootPath}`,
    ...sessionStores
      .filter((entry) => !entry.writable)
      .map((entry) => `OpenClaw session store for ${entry.id} is not writable. ${entry.issue ?? entry.path}`)
  ].filter((value): value is string => Boolean(value));

  return {
    stateRoot: openClawStateRootPath,
    stateWritable: stateRootProbe.writable,
    sessionStoreWritable: stateRootProbe.writable && sessionStoreWritable,
    sessionStores,
    issues
  };
}
