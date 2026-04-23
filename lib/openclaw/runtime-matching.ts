import { stripMissionRouting } from "@/lib/openclaw/presenters";
import type { RuntimeRecord, TaskRecord } from "@/lib/openclaw/types";

const missionRuntimeSlackMs = 1_500;
const retryPromptPrefixPattern = /^\[Retry after[^\]]+\]\s*/i;

function normalizeMissionText(value: string) {
  return stripMissionRouting(value)
    .replace(retryPromptPrefixPattern, "")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

export function matchesMissionText(candidate: string, mission: string) {
  const normalizedMission = normalizeMissionText(mission);
  const normalizedCandidate = normalizeMissionText(candidate);

  if (!normalizedMission || !normalizedCandidate) {
    return false;
  }

  return normalizedCandidate === normalizedMission || normalizedCandidate.startsWith(`${normalizedMission} `);
}

function extractRuntimeMissionText(runtime: RuntimeRecord) {
  const mission =
    typeof runtime.metadata.mission === "string"
      ? runtime.metadata.mission
      : typeof runtime.metadata.turnPrompt === "string"
        ? runtime.metadata.turnPrompt
        : null;

  if (!mission) {
    return null;
  }

  const normalized = normalizeMissionText(mission);
  return normalized.length > 0 ? normalized : null;
}

export function matchesMissionRuntime(
  runtime: RuntimeRecord,
  mission: string,
  options: {
    agentId?: string | null;
    submittedAt?: number | null;
  } = {}
) {
  if (options.agentId && runtime.agentId !== options.agentId) {
    return false;
  }

  if (typeof options.submittedAt === "number" && (runtime.updatedAt ?? 0) < options.submittedAt - missionRuntimeSlackMs) {
    return false;
  }

  const runtimeMission = extractRuntimeMissionText(runtime);

  if (!runtimeMission) {
    return false;
  }

  return matchesMissionText(runtimeMission, mission);
}

export function matchesMissionTask(
  task: TaskRecord,
  mission: string,
  options: {
    agentId?: string | null;
    submittedAt?: number | null;
  } = {}
) {
  if (options.agentId && !task.agentIds.includes(options.agentId)) {
    return false;
  }

  if (typeof options.submittedAt === "number" && (task.updatedAt ?? 0) < options.submittedAt - missionRuntimeSlackMs) {
    return false;
  }

  const candidate = task.mission || task.title;

  if (!candidate) {
    return false;
  }

  return matchesMissionText(candidate, mission);
}
