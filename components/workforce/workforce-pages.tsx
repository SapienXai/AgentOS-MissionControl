"use client";

import { HumanControlInbox } from "@/components/operations/human-control-inbox";
import { OperationsShell } from "@/components/operations/operations-shell";
import { MissionDetailPage } from "@/components/workforce/mission-detail-page";
import { MissionListPage } from "@/components/workforce/mission-list-page";
import type { MissionControlSnapshot } from "@/lib/agentos/contracts";
import type { WorkforceMissionListResponse, WorkforceMissionProjection } from "@/lib/agentos/workforce/types";

export function WorkforceMissionsRoute({ initialSnapshot, initial }: { initialSnapshot: MissionControlSnapshot; initial: WorkforceMissionListResponse }) {
  return <OperationsShell initialSnapshot={initialSnapshot}>{(context) => <MissionListPage initial={initial} snapshot={context.snapshot} activeWorkspaceId={context.activeWorkspaceId} connectionState={context.connectionState} attentionRefreshGeneration={context.attentionRefreshGeneration} refresh={context.refresh} />}</OperationsShell>;
}

export function WorkforceMissionDetailRoute({ initialSnapshot, initial }: { initialSnapshot: MissionControlSnapshot; initial: WorkforceMissionProjection }) {
  return <OperationsShell initialSnapshot={initialSnapshot}>{(context) => <MissionDetailPage initial={initial} snapshot={context.snapshot} connectionState={context.connectionState} attentionRefreshGeneration={context.attentionRefreshGeneration} refresh={context.refresh} />}</OperationsShell>;
}

export function WorkforceHumanControlRoute({ initialSnapshot, missionId }: { initialSnapshot: MissionControlSnapshot; missionId: string | null }) {
  return <OperationsShell initialSnapshot={initialSnapshot}>{(context) => <HumanControlInbox mode="page" missionId={missionId} surfaceTheme={context.surfaceTheme} attentionRefreshGeneration={context.attentionRefreshGeneration} />}</OperationsShell>;
}
