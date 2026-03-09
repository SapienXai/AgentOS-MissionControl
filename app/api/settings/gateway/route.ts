import { NextResponse } from "next/server";
import { z } from "zod";

import { updateGatewayRemoteUrl } from "@/lib/openclaw/service";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gatewaySettingsSchema = z.object({
  gatewayUrl: z.string().max(2048).optional().nullable()
});

export async function PATCH(request: Request) {
  try {
    const input = gatewaySettingsSchema.parse(await request.json());
    const snapshot = await updateGatewayRemoteUrl({
      gatewayUrl: input.gatewayUrl ?? null
    });

    return NextResponse.json({
      snapshot
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update the OpenClaw gateway."
      },
      { status: 400 }
    );
  }
}
