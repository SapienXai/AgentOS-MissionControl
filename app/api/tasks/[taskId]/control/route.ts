import { NextResponse } from "next/server";
import { z } from "zod";

import { controlRunningTaskSession } from "@/lib/agentos/control-plane";
import { getMissionControlSnapshot } from "@/lib/openclaw/application/mission-control-service";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const controlRequestSchema = z.object({
  action: z.enum(["steer", "inject", "continue"]),
  message: z.string().trim().min(1).max(12000),
  dispatchId: z.string().trim().min(1).optional().nullable(),
  idempotencyKey: z.string().trim().min(1).max(240).optional().nullable()
});

export async function POST(
  request: Request,
  context: { params: Promise<{ taskId: string }> }
) {
  const { taskId: rawTaskId } = await context.params;
  const taskId = decodeURIComponent(rawTaskId);

  let payload: unknown = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }

  const parseResult = controlRequestSchema.safeParse(payload);

  if (!parseResult.success) {
    return NextResponse.json(
      {
        error: redactErrorMessage(parseResult.error, "Invalid task control request.")
      },
      { status: 400 }
    );
  }

  const authorization = await requireAgentOsOpenClawPreflight(request, {
    operation: `task.${parseResult.data.action}`,
    method: parseResult.data.action === "steer"
      ? "chat.send"
      : parseResult.data.action === "inject"
        ? "chat.inject"
        : "chat.send",
    params: { taskId },
    targetKind: "task-session",
    targetId: taskId,
    securityClass: "privileged-mutation",
    executionPath: parseResult.data.action === "continue"
      ? "gateway-or-verified-cli"
      : "gateway-native",
    productPermission: "tasks.use"
  });
  if ("response" in authorization) return authorization.response;

  const visibleSnapshot = await getMissionControlSnapshot();
  if (!visibleSnapshot.tasks.some((task) => task.id === taskId)) {
    return NextResponse.json({ error: "Task was not found." }, { status: 404 });
  }

  try {
    const result = await controlRunningTaskSession(taskId, parseResult.data, {}, authorization.commandOptions);
    return NextResponse.json(redactSecrets({
      result
    }));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to control the running task.")
      },
      { status: 400 }
    );
  }
}
