import { NextResponse } from "next/server";
import { z } from "zod";

import { submitMission } from "@/lib/agentos/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const missionSchema = z.object({
  mission: z.string().min(1),
  agentId: z.string().optional(),
  workspaceId: z.string().optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high"]).optional()
});

export async function POST(request: Request) {
  try {
    const input = missionSchema.parse(await request.json());
    const result = await submitMission(input);

    return NextResponse.json(result, {
      status: result.status === "queued" || result.status === "running" ? 202 : 200
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to submit mission."
      },
      { status: 400 }
    );
  }
}
