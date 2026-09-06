import { NextResponse } from "next/server";
import { z } from "zod";

import {
  getCrossAgentMessageSettings,
  reconcileAgentOsSessionSecurityDefaults,
  updateCrossAgentMessageSettings
} from "@/lib/agentos/control-plane";
import { redactErrorMessage } from "@/lib/security/redaction";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const crossAgentMessageSettingsSchema = z.object({
  enabled: z.boolean(),
  targetAgentId: z.string().min(1).optional(),
  knownTargetAgentIds: z.array(z.string().min(1)).optional()
});

const migrationSchema = z.object({
  action: z.literal("migrate-defaults")
}).strict();

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;
  try {
    return NextResponse.json({
      settings: await getCrossAgentMessageSettings()
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to inspect cross-agent message settings.")
      },
      { status: 500 }
    );
  }
}

export async function PATCH(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;
  try {
    const input = crossAgentMessageSettingsSchema.parse(await request.json());

    return NextResponse.json({
      settings: await updateCrossAgentMessageSettings(input)
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to update cross-agent message settings.")
      },
      { status: 400 }
    );
  }
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "gateway.manage");
  if ("response" in permission) return permission.response;
  try {
    migrationSchema.parse(await request.json());
    return NextResponse.json({
      migration: await reconcileAgentOsSessionSecurityDefaults(),
      settings: await getCrossAgentMessageSettings()
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json(
      { error: redactErrorMessage(error, "Unable to reconcile OpenClaw session-security defaults.") },
      { status: 400 }
    );
  }
}
