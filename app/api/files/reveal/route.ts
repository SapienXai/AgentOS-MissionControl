import { execFile } from "node:child_process";
import { access } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import { NextResponse } from "next/server";
import { z } from "zod";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execFileAsync = promisify(execFile);

const revealSchema = z.object({
  path: z.string().min(1),
  basePath: z.string().min(1).optional().nullable()
});

export async function POST(request: Request) {
  try {
    const payload = revealSchema.parse(await request.json());
    const rawTargetPath = payload.path.trim();
    const basePath = payload.basePath?.trim();
    const targetPath =
      path.isAbsolute(rawTargetPath) || !basePath
        ? rawTargetPath
        : path.resolve(basePath, rawTargetPath);

    if (!path.isAbsolute(rawTargetPath) && !basePath) {
      throw new Error("Workspace path is required for relative file paths.");
    }

    if (!path.isAbsolute(targetPath)) {
      throw new Error("File path must be absolute.");
    }

    if (basePath && !path.isAbsolute(basePath)) {
      throw new Error("Base path must be absolute.");
    }

    const resolvedTargetPath = path.resolve(targetPath);

    if (basePath) {
      const resolvedBasePath = path.resolve(basePath);
      const relativeToBase = path.relative(resolvedBasePath, resolvedTargetPath);

      if (relativeToBase.startsWith("..") || path.isAbsolute(relativeToBase)) {
        throw new Error("File path must stay within the workspace.");
      }
    }

    await access(resolvedTargetPath);
    await revealFile(resolvedTargetPath);

    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json(
      {
        error: error instanceof Error ? error.message : "Unable to reveal file."
      },
      { status: 400 }
    );
  }
}

async function revealFile(targetPath: string) {
  if (process.platform === "darwin") {
    await execFileAsync("open", ["-R", targetPath]);
    return;
  }

  if (process.platform === "win32") {
    await execFileAsync("explorer.exe", ["/select,", targetPath]);
    return;
  }

  await execFileAsync("xdg-open", [path.dirname(targetPath)]);
}
