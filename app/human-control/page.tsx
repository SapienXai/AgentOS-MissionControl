import { WorkforceHumanControlRoute } from "@/components/workforce/workforce-pages";
import { getInitialControlPlaneSnapshot } from "@/lib/agentos/initial-snapshot";

export const dynamic = "force-dynamic";

export default async function HumanControlPage({ searchParams }: { searchParams: Promise<{ missionId?: string }> }) {
  const [{ missionId }, snapshot] = await Promise.all([searchParams, getInitialControlPlaneSnapshot()]);
  return <WorkforceHumanControlRoute initialSnapshot={snapshot} missionId={missionId ?? null} />;
}
