import "server-only";

import { resolveAgentOsVersion } from "@/lib/agentos/version";
import { readOpenClawCompatibilityManifestOverride } from "@/lib/openclaw/compatibility-lab/store";
import type { NativeDoctorSnapshot } from "@/lib/openclaw/application/native-doctor-service";
import {
  resolveNormalOpenClawUpdatePolicy,
  type NormalOpenClawUpdatePolicy
} from "@/lib/openclaw/domains/normal-update-policy";
import { LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST } from "@/lib/openclaw/update-compatibility";

export async function getNormalOpenClawUpdatePolicy(
  snapshot: NativeDoctorSnapshot
): Promise<NormalOpenClawUpdatePolicy> {
  const [agentOsVersion, manifestOverride] = await Promise.all([
    resolveAgentOsVersion(),
    readOpenClawCompatibilityManifestOverride()
  ]);

  return resolveNormalOpenClawUpdatePolicy({
    snapshot,
    agentOsVersion,
    manifest: manifestOverride ?? LOCAL_OPENCLAW_COMPATIBILITY_MANIFEST
  });
}
