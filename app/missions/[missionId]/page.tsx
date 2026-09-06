import { notFound } from "next/navigation";

import { WorkforceMissionDetailRoute } from "@/components/workforce/workforce-pages";
import { getWorkforceMissionDetail } from "@/lib/agentos/application/workforce-service";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function MissionDetailRoute({ params }: { params: Promise<{ missionId: string }> }) {
  const { missionId: rawMissionId } = await params;
  const missionId = decodeURIComponent(rawMissionId);
  const snapshot = await getInitialControlPlaneSnapshot();
  const mission = await getWorkforceMissionDetail(missionId, { snapshot });
  if (!mission) notFound();

  return <WorkforceMissionDetailRoute initialSnapshot={snapshot} initial={mission} />;
}
