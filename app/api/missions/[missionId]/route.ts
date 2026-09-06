import { NextResponse } from "next/server";

import { getWorkforceMissionDetail } from "@/lib/agentos/application/workforce-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  context: { params: Promise<{ missionId: string }> }
) {
  const permission = await requireAgentOsProductPermission(request, "missions.use");
  if ("response" in permission) return permission.response;

  const { missionId: rawMissionId } = await context.params;
  const missionId = decodeURIComponent(rawMissionId);
  if (!missionId || missionId.length > 256) return NextResponse.json({ error: "Invalid mission id." }, { status: 400 });

  try {
    const mission = await getWorkforceMissionDetail(missionId);
    if (!mission) return NextResponse.json({ error: "Mission was not found." }, { status: 404 });
    return NextResponse.json(redactSecrets(mission), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Mission details are temporarily unavailable.") },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
