import { MissionControlShell } from "@/components/mission-control/mission-control-shell";
import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshot = await getMissionControlSnapshot();

  return <MissionControlShell initialSnapshot={snapshot} />;
}
