import { MissionControlShell } from "@/components/mission-control/mission-control-shell";
import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import { createLoadingSnapshot } from "@/lib/openclaw/fallback";
import type { ControlPlaneSnapshot } from "@/lib/agentos/contracts";

const INITIAL_SNAPSHOT_TIMEOUT_MS = 2_000;

export const dynamic = "force-dynamic";

export default async function Home() {
  const snapshotPromise = getMissionControlSnapshot();
  const safeSnapshotPromise = snapshotPromise.catch(() =>
    createLoadingSnapshot("OpenClaw snapshot is loading.")
  );
  const snapshot = (await new Promise<ControlPlaneSnapshot>((resolve) => {
    const timeoutId = setTimeout(
      () => resolve(createLoadingSnapshot("OpenClaw snapshot is loading.")),
      INITIAL_SNAPSHOT_TIMEOUT_MS
    );

    safeSnapshotPromise.then(
      (value) => {
        clearTimeout(timeoutId);
        resolve(value);
      },
      () => {
        clearTimeout(timeoutId);
        resolve(createLoadingSnapshot("OpenClaw snapshot is loading."));
      }
    );
  })) as ControlPlaneSnapshot;

  void snapshotPromise.catch(() => {});

  return <MissionControlShell initialSnapshot={snapshot} />;
}
