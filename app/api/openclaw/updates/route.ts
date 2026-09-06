import { NextResponse } from "next/server";

import { getOpenClawStabilitySnapshot } from "@/lib/openclaw/stability";
import { redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // This route is advisory release intelligence only. Native OpenClaw
  // update.status remains the authority for installed/update/channel truth.
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;
  const stability = await getOpenClawStabilitySnapshot();

  return NextResponse.json(redactSecrets({ stability }), {
    headers: {
      "Cache-Control": "no-store"
    }
  });
}
