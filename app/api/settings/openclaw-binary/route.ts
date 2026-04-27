import { NextResponse } from "next/server";
import path from "node:path";
import { z } from "zod";

import { clearMissionControlCaches, getMissionControlSnapshot } from "@/lib/agentos/control-plane";
import {
  assertExecutableOpenClawBinary,
  createDefaultOpenClawBinarySelection,
  readOpenClawBinarySelection,
  resolveGlobalOpenClawBinaryPath,
  writeOpenClawBinarySelection
} from "@/lib/openclaw/binary-selection";
import { getOpenClawLocalPrefixBinPath } from "@/lib/openclaw/install";
import { resetOpenClawBinCache } from "@/lib/openclaw/cli";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const openClawBinarySelectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("auto")
  }),
  z.object({
    mode: z.literal("local-prefix")
  }),
  z.object({
    mode: z.literal("global-path")
  }),
  z.object({
    mode: z.literal("custom"),
    path: z.string().trim().min(1).max(2048)
  })
]);

export async function GET() {
  const selection = await readOpenClawBinarySelection();

  return NextResponse.json({
    selection
  });
}

export async function PATCH(request: Request) {
  try {
    const input = openClawBinarySelectionSchema.parse(await request.json());
    const nextSelection = await resolveSelection(input);

    await writeOpenClawBinarySelection(nextSelection);
    resetOpenClawBinCache();
    clearMissionControlCaches();

    const snapshot = await getMissionControlSnapshot({ force: true });

    return NextResponse.json({
      snapshot,
      selection: nextSelection
    });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to update the OpenClaw binary selection."
      },
      { status: 400 }
    );
  }
}

async function resolveSelection(
  input: z.infer<typeof openClawBinarySelectionSchema>
) {
  if (input.mode === "auto") {
    return createDefaultOpenClawBinarySelection();
  }

  if (input.mode === "local-prefix") {
    const binPath = getOpenClawLocalPrefixBinPath();
    await assertExecutableOpenClawBinary(binPath);

    return {
      mode: "local-prefix" as const,
      path: binPath,
      resolvedPath: binPath,
      label: "Local prefix",
      detail: binPath
    };
  }

  if (input.mode === "global-path") {
    const binPath = await resolveGlobalOpenClawBinaryPath();
    await assertExecutableOpenClawBinary(binPath);

    return {
      mode: "global-path" as const,
      path: binPath,
      resolvedPath: binPath,
      label: "Global PATH",
      detail: binPath
    };
  }

  const binPath = normalizeCustomPath(input.path);
  await assertExecutableOpenClawBinary(binPath);

  return {
    mode: "custom" as const,
    path: binPath,
    resolvedPath: binPath,
    label: "Custom path",
    detail: binPath
  };
}

function normalizeCustomPath(value: string) {
  const trimmed = value.trim();

  if (!path.isAbsolute(trimmed)) {
    throw new Error("Custom OpenClaw binary path must be absolute.");
  }

  return trimmed;
}
