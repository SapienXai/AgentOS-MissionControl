import path from "node:path";

import { formatAgentDisplayName } from "@/lib/openclaw/presenters";
import { presentMissionDispatchRunnerLogEntry, readMissionDispatchRunnerLogs } from "@/lib/openclaw/domains/mission-dispatch-runner-logs";
import {
  isSyntheticDispatchRuntime
} from "@/lib/openclaw/domains/mission-dispatch-runtime";
import {
  resolveMissionDispatchCompletionDetail,
  resolveMissionDispatchIntegrityWarning,
  resolveMissionDispatchOutputFile,
  resolveMissionDispatchResultText,
  resolveMissionDispatchSummary
} from "@/lib/openclaw/domains/mission-dispatch-model";
import {
  extractCreatedFilesFromRuntimeMetadata,
  extractWarningsFromRuntimeMetadata,
  hashTaskKey
} from "@/lib/openclaw/domains/task-records";
import type { MissionControlSnapshot, RuntimeCreatedFile, RuntimeOutputRecord, RuntimeRecord, TaskFeedEvent, TaskRecord } from "@/lib/openclaw/types";
import type { MissionDispatchRecord } from "@/lib/openclaw/domains/mission-dispatch-lifecycle";

export function buildTaskFeed(
  task: TaskRecord,
  runs: RuntimeRecord[],
  outputsByRuntimeId: Map<string, RuntimeOutputRecord>,
  snapshot: MissionControlSnapshot
) {
  const agentNameById = new Map(snapshot.agents.map((agent) => [agent.id, formatAgentDisplayName(agent)]));
  const events: TaskFeedEvent[] = [];
  const sortedRuns = [...runs].sort((left, right) => (left.updatedAt ?? 0) - (right.updatedAt ?? 0));

  for (const runtime of sortedRuns) {
    if (task.dispatchId && isSyntheticDispatchRuntime(runtime)) {
      continue;
    }

    const output = outputsByRuntimeId.get(runtime.id);
    const agentName = runtime.agentId ? agentNameById.get(runtime.agentId) ?? null : null;
    const runtimeTimestamp = timestampFromRuntime(runtime, output?.finalTimestamp);

    if (output?.items.length) {
      for (const item of output.items) {
        events.push(
          enrichTaskFeedEvent(
            {
              id: `${runtime.id}:${item.id}`,
              kind:
                item.role === "assistant"
                  ? "assistant"
                  : item.role === "toolResult"
                    ? "tool"
                    : "user",
              timestamp: item.timestamp,
              title:
                item.role === "assistant"
                  ? agentName || "Agent update"
                  : item.role === "toolResult"
                    ? item.toolName
                      ? `Tool · ${item.toolName}`
                      : "Tool update"
                    : "Mission",
              detail: summarizeText(item.text.trim() || output.errorMessage || runtime.subtitle, 220),
              runtimeId: runtime.id,
              agentId: runtime.agentId,
              toolName: item.toolName,
              isError: item.isError
            },
            {
              urlSources: [item.text, output?.finalText, output?.errorMessage, runtime.subtitle]
            }
          )
        );
      }
    } else {
      events.push(
        enrichTaskFeedEvent(
          {
            id: `${runtime.id}:status`,
            kind: "status",
            timestamp: runtimeTimestamp,
            title: agentName ? `${agentName} · ${runtime.status}` : `Run · ${runtime.status}`,
            detail: summarizeText(output?.errorMessage || runtime.subtitle, 220),
            runtimeId: runtime.id,
            agentId: runtime.agentId,
            isError: runtime.status === "stalled"
          },
          {
            urlSources: [output?.errorMessage, runtime.subtitle]
          }
        )
      );
    }

    const warningValues = uniqueStrings(
      (output?.warnings ?? []).concat(extractWarningsFromRuntimeMetadata(runtime))
    );
    for (const warning of warningValues) {
      events.push(
        enrichTaskFeedEvent(
          {
            id: `${runtime.id}:warning:${hashTaskKey(warning)}`,
            kind: "warning",
            timestamp: runtimeTimestamp,
            title: "Fallback",
            detail: summarizeText(warning, 220),
            runtimeId: runtime.id,
            agentId: runtime.agentId
          },
          {
            urlSources: [warning]
          }
        )
      );
    }

    const createdFiles = dedupeCreatedFiles(
      (output?.createdFiles ?? []).concat(extractCreatedFilesFromRuntimeMetadata(runtime))
    );
    for (const file of createdFiles) {
      events.push(
        enrichTaskFeedEvent(
          {
            id: `${runtime.id}:artifact:${hashTaskKey(file.path)}`,
            kind: "artifact",
            timestamp: runtimeTimestamp,
            title: "Created file",
            detail: file.displayPath,
            runtimeId: runtime.id,
            agentId: runtime.agentId
          },
          {
            file
          }
        )
      );
    }
  }

  if (events.length === 0 && task.mission && !task.dispatchId) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${task.id}:mission`,
          kind: "user",
          timestamp: timestampFromUnix(task.updatedAt),
          title: "Mission",
          detail: summarizeText(task.mission, 220),
          agentId: task.primaryAgentId
        },
        {
          urlSources: [task.mission]
        }
      )
    );
  }

  return events
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-36);
}

export async function buildMissionDispatchFeed(
  task: TaskRecord,
  record: MissionDispatchRecord | null,
  snapshot: MissionControlSnapshot
) {
  if (!record) {
    return [] as TaskFeedEvent[];
  }

  const agentName = formatAgentDisplayName(
    snapshot.agents.find((agent) => agent.id === task.primaryAgentId) ?? { name: "OpenClaw" }
  );
  const runnerLogs = await readMissionDispatchRunnerLogs(record);
  const runnerLogFile =
    record.runner.logPath && record.runner.logPath.trim()
      ? {
          path: record.runner.logPath,
          displayPath: path.basename(record.runner.logPath)
        }
      : null;
  const events: TaskFeedEvent[] = [
    enrichTaskFeedEvent(
      {
        id: `${record.id}:accepted`,
        kind: "user",
        timestamp: record.submittedAt,
        title: "Mission accepted",
        detail: summarizeText(task.mission || record.mission || "Mission queued for dispatch.", 220),
        agentId: task.primaryAgentId
      },
      {
        urlSources: [task.mission, record.mission, record.routedMission]
      }
    )
  ];

  if (record.runner.startedAt || record.runner.pid) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:runner-started`,
          kind: "status",
          timestamp: record.runner.startedAt ?? record.updatedAt,
          title: "Dispatch runner started",
          detail: record.outputDirRelative
            ? `Preparing the first OpenClaw runtime in ${record.outputDirRelative}.`
            : "Preparing the first OpenClaw runtime."
        },
        {
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  if (record.runner.lastHeartbeatAt) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:heartbeat`,
          kind: "status",
          timestamp: record.runner.lastHeartbeatAt,
          title: "Heartbeat received",
          detail: `${agentName} is online. Waiting for the first runtime session.`
        },
        {
          urlSources: [agentName, record.outputDirRelative]
        }
      )
    );
  }

  if (record.observation.observedAt) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:runtime-observed`,
          kind: "status",
          timestamp: record.observation.observedAt,
          title: "Runtime observed",
          detail: "The task is now live. Runtime updates will continue below."
        },
        {
          urlSources: [record.outputDirRelative]
        }
      )
    );
  }

  if (record.status === "completed") {
    const completionSummary = resolveMissionDispatchSummary(record) || resolveMissionDispatchResultText(record);
    const outputFile = resolveMissionDispatchOutputFile(record);
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:completed`,
          kind: "status",
          timestamp: record.runner.finishedAt ?? record.updatedAt,
          title: completionSummary ? "Mission finished" : "Dispatch runner finished",
          detail: summarizeText(completionSummary || resolveMissionDispatchCompletionDetail(record), 220)
        },
        {
          urlSources: [completionSummary, resolveMissionDispatchCompletionDetail(record), record.outputDirRelative],
          file:
            outputFile ??
            (record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null)
        }
      )
    );
  }

  if (record.status === "cancelled") {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:cancelled`,
          kind: "warning",
          timestamp: record.runner.finishedAt ?? record.updatedAt,
          title: "Mission cancelled",
          detail: summarizeText(resolveMissionDispatchCompletionDetail(record), 220),
          isError: false
        },
        {
          urlSources: [record.error, record.outputDirRelative],
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  const integrityWarning = resolveMissionDispatchIntegrityWarning(record);

  if (integrityWarning) {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:integrity-warning`,
          kind: "warning",
          timestamp: record.runner.finishedAt ?? record.updatedAt,
          title: "Result needs review",
          detail: summarizeText(integrityWarning, 220),
          isError: true
        },
        {
          urlSources: [record.outputDirRelative],
          file:
            record.outputDir && record.outputDirRelative
              ? {
                  path: record.outputDir,
                  displayPath: record.outputDirRelative
                }
              : null
        }
      )
    );
  }

  if (record.status === "stalled") {
    events.push(
      enrichTaskFeedEvent(
        {
          id: `${record.id}:stalled`,
          kind: "warning",
          timestamp: record.updatedAt,
          title: record.error ? "Dispatch error" : "Dispatch stalled",
          detail: summarizeText(
            record.error ||
              (record.runner.lastHeartbeatAt
                ? "OpenClaw stopped reporting progress while waiting for the first runtime."
                : "OpenClaw did not produce the first heartbeat in time."),
            220
          ),
          isError: true
        },
        {
          urlSources: [record.error, record.outputDirRelative]
        }
      )
    );
  }

  for (const entry of runnerLogs) {
    const presentation = presentMissionDispatchRunnerLogEntry(entry);

    if (!presentation) {
      continue;
    }

    events.push(
      enrichTaskFeedEvent(
        {
          id: entry.id,
          kind: presentation.kind,
          timestamp: entry.timestamp,
          title: presentation.title,
          detail: summarizeText(presentation.detail, 220),
          agentId: task.primaryAgentId,
          isError: presentation.isError
        },
        {
          file: runnerLogFile
        }
      )
    );
  }

  return events;
}

export function mergeTaskFeedEvents(...feeds: TaskFeedEvent[][]) {
  const deduped = new Map<string, TaskFeedEvent>();

  for (const event of feeds.flat()) {
    deduped.set(event.id, event);
  }

  return [...deduped.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-48);
}

function enrichTaskFeedEvent(
  event: TaskFeedEvent,
  options?: {
    urlSources?: Array<string | null | undefined>;
    file?: RuntimeCreatedFile | null;
  }
): TaskFeedEvent {
  const url = extractFirstUrlFromSources(options?.urlSources ?? []);

  return {
    ...event,
    ...(url ? { url } : {}),
    ...(options?.file ? { filePath: options.file.path, displayPath: options.file.displayPath } : {})
  };
}

function extractFirstUrlFromSources(sources: Array<string | null | undefined>) {
  for (const source of sources) {
    if (typeof source !== "string") {
      continue;
    }

    const match = source.match(/https?:\/\/[^\s<>"'`]+/i);

    if (!match) {
      continue;
    }

    const normalized = stripTrailingUrlPunctuation(match[0]);

    if (normalized) {
      return normalized;
    }
  }

  return null;
}

function stripTrailingUrlPunctuation(value: string) {
  return value.replace(/[)\].,;:!?]+$/g, "");
}

function timestampFromRuntime(runtime: RuntimeRecord, preferred?: string | null) {
  if (preferred) {
    return preferred;
  }

  return timestampFromUnix(runtime.updatedAt);
}

function timestampFromUnix(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? new Date(value).toISOString()
    : new Date().toISOString();
}

function dedupeCreatedFiles(files: RuntimeCreatedFile[]) {
  const seen = new Set<string>();
  const deduped: RuntimeCreatedFile[] = [];

  for (const file of files) {
    if (!file.path || seen.has(file.path)) {
      continue;
    }

    seen.add(file.path);
    deduped.push(file);
  }

  return deduped;
}

function summarizeText(value: string, maxLength: number) {
  const normalized = value.replace(/\s+/g, " ").trim();

  if (normalized.length <= maxLength) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(maxLength - 1, 1)).trimEnd()}…`;
}

function uniqueStrings(values: string[]) {
  return Array.from(new Set(values.map((value) => value.trim()).filter(Boolean)));
}
