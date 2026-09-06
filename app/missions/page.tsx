import { WorkforceMissionsRoute } from "@/components/workforce/workforce-pages";
import { getWorkforceMissionList } from "@/lib/agentos/application/workforce-service";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function MissionsPage() {
  const snapshot = await getInitialControlPlaneSnapshot();
  const initial = await getWorkforceMissionList({ snapshot });
  return <WorkforceMissionsRoute initialSnapshot={snapshot} initial={initial} />;
}
