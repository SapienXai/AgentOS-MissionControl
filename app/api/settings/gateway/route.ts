import { NextResponse } from "next/server";
import { z } from "zod";

import {
  generateGatewayNativeAuthToken,
  getGatewayNativeAuthStatus,
  repairGatewayNativeDeviceAccess,
  saveGatewayNativeAuthCredential,
  updateGatewayRemoteUrl
} from "@/lib/agentos/control-plane";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const gatewaySettingsSchema = z.object({
  gatewayUrl: z.string().max(2048).optional().nullable()
});

const gatewayAuthCredentialSchema = z.object({
  action: z.literal("saveCredential").optional(),
  kind: z.enum(["token", "password"]),
  value: z.string().min(1).max(4096)
});

const gatewayAuthGenerateSchema = z.object({
  action: z.literal("generateLocalToken")
});

const gatewayAuthRepairSchema = z.object({
  action: z.literal("repairDeviceAccess")
});

export async function GET() {
  try {
    const authStatus = await getGatewayNativeAuthStatus();

    return NextResponse.json({
      authStatus
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to inspect the OpenClaw gateway auth status."
      },
      { status: 500 }
    );
  }
}

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

export async function POST(request: Request) {
  try {
    const body = await request.json();

    if (gatewayAuthGenerateSchema.safeParse(body).success) {
      const result = await generateGatewayNativeAuthToken();
      const authStatus = await getGatewayNativeAuthStatus();

      return NextResponse.json({
        saved: true,
        generated: true,
        result,
        authStatus
      });
    }

    if (gatewayAuthRepairSchema.safeParse(body).success) {
      const result = await repairGatewayNativeDeviceAccess();
      const authStatus = await getGatewayNativeAuthStatus();

      return NextResponse.json({
        saved: true,
        repaired: true,
        result,
        authStatus
      });
    }

    const input = gatewayAuthCredentialSchema.parse(body);
    const result = await saveGatewayNativeAuthCredential(input);
    const authStatus = await getGatewayNativeAuthStatus();

    return NextResponse.json({
      saved: true,
      result,
      authStatus
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to save the OpenClaw gateway credential."
      },
      { status: 400 }
    );
  }
}
