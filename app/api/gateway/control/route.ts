import { NextResponse } from "next/server";
import { z } from "zod";

import { runOpenClawJson } from "@/lib/openclaw/cli";
import { getMissionControlSnapshot } from "@/lib/agentos/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gatewayControlSchema = z.object({
  action: z.enum(["start", "stop", "restart"])
});

const actionMessageMap = {
  start: "Gateway start requested.",
  stop: "Gateway stop requested.",
  restart: "Gateway restart requested."
} satisfies Record<z.infer<typeof gatewayControlSchema>["action"], string>;

export async function POST(request: Request) {
  try {
    const input = gatewayControlSchema.parse(await request.json());
    const currentSnapshot = await getMissionControlSnapshot({ force: true });

    if (!currentSnapshot.diagnostics.installed) {
      return NextResponse.json(
        {
          error: currentSnapshot.diagnostics.issues[0] || "OpenClaw is unavailable."
        },
        { status: 400 }
      );
    }

    await runOpenClawJson<Record<string, unknown>>(["gateway", input.action, "--json"]);
    const snapshot = await getMissionControlSnapshot({ force: true });

    return NextResponse.json({
      message: actionMessageMap[input.action],
      snapshot
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to control the OpenClaw gateway."
      },
      { status: 400 }
    );
  }
}
