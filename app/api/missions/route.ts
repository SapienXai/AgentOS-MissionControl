import { NextResponse } from "next/server";
import { z } from "zod";

import { getWorkforceMissionList } from "@/lib/agentos/application/workforce-service";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const querySchema = z.object({
  workspaceId: z.string().trim().min(1).max(128).optional(),
  search: z.string().trim().max(180).optional(),
  state: z.enum(["queued", "starting", "running", "waiting-human", "waiting-worker", "blocked", "completed", "failed", "cancelled", "reconnecting"]).optional(),
  agentId: z.string().trim().min(1).max(128).optional()
}).strict();

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "missions.use");
  if ("response" in permission) return permission.response;

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    workspaceId: url.searchParams.get("workspaceId") ?? undefined,
    search: url.searchParams.get("search") ?? undefined,
    state: url.searchParams.get("state") ?? undefined,
    agentId: url.searchParams.get("agentId") ?? undefined
  });
  if (!parsed.success) return NextResponse.json({ error: "Invalid mission filters." }, { status: 400 });

  try {
    const result = await getWorkforceMissionList(parsed.data);
    return NextResponse.json(redactSecrets(result), { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Missions are temporarily unavailable.") },
      { status: 503, headers: { "Cache-Control": "no-store" } }
    );
  }
}
