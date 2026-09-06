import { NextResponse } from "next/server";
import { z } from "zod";

import {
  AttentionMutationUncertainError,
  getHumanControlInbox,
  parseAttentionId,
  resolveAttentionItem
} from "@/lib/openclaw/application/human-control-inbox-service";
import { getOpenClawAdapter } from "@/lib/openclaw/adapter/openclaw-adapter";
import { getMissionControlSnapshot, invalidateMissionControlSnapshotCache } from "@/lib/openclaw/application/mission-control-service";
import { requireAgentOsOpenClawPreflight } from "@/lib/security/agentos-openclaw-request";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";
import { recordAgentOsAuditEvent } from "@/lib/security/agentos-audit";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const answerSchema = z.object({
  answers: z.record(z.array(z.string().trim().min(1).max(1024)).min(1).max(8))
}).strict();

const actionSchema = z.discriminatedUnion("action", [
  z.object({ action: z.enum(["approve", "deny"]), itemId: z.string().trim().min(1).max(512) }),
  z.object({ action: z.literal("answer"), itemId: z.string().trim().min(1).max(512), answers: answerSchema }),
  z.object({ action: z.literal("accept"), itemId: z.string().trim().min(1).max(512), mode: z.enum(["worktree", "local", "cloud", "session"]).optional(), cloudProfileId: z.string().trim().min(1).max(128).optional() }),
  z.object({ action: z.literal("dismiss"), itemId: z.string().trim().min(1).max(512) })
]);

export async function POST(request: Request) {
  let input: z.infer<typeof actionSchema>;
  try {
    input = actionSchema.parse(await request.json());
  } catch (error) {
    return NextResponse.json({ error: redactErrorMessage(error, "Invalid Human Control action.") }, { status: 400 });
  }

  const parsed = parseAttentionId(input.itemId);
  if (!parsed) return NextResponse.json({ error: "Unknown Human Control item." }, { status: 404 });

  const permissionName = parsed.kind === "suggestion" ? "tasks.use" : "runtime.use";
  const permission = await requireAgentOsProductPermission(request, permissionName);
  if ("response" in permission) return permission.response;

  // Native approval/question collections are Gateway-wide. Confirm the item
  // is present in the actor-visible projection before allowing a mutation.
  try {
    const snapshot = await getMissionControlSnapshot();
    const inbox = await getHumanControlInbox({ snapshot });
    if (!inbox.items.some((item) => item.id === input.itemId && item.status === "pending")) {
      return NextResponse.json({ error: "Human Control item was not found." }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "Human Control item could not be verified." }, { status: 503 });
  }

  const method = resolveNativeMethod(parsed.kind, input.action);
  if (!method) return NextResponse.json({ error: "This action is not available for the selected item." }, { status: 400 });

  const params = resolveNativeParams(parsed.kind, input);
  const preflight = await requireAgentOsOpenClawPreflight(request, {
    operation: `human-control.${input.action}`,
    method,
    params,
    targetKind: `human-control-${parsed.kind}`,
    targetId: parsed.nativeId,
    securityClass: "privileged-mutation",
    executionPath: "gateway-native",
    productPermission: permissionName
  });
  if ("response" in preflight) return preflight.response;

  try {
    const result = await resolveAttentionItem(
      input.itemId,
      input.action,
      "answers" in input
        ? { answers: input.answers }
        : "mode" in input
          ? { mode: input.mode, cloudProfileId: input.cloudProfileId }
          : {},
      getOpenClawAdapter(),
      preflight.commandOptions
    );
    invalidateMissionControlSnapshotCache();
    await recordAgentOsAuditEvent({
      actor: preflight.actor,
      operation: `human-control.${input.action}`,
      targetKind: `human-control-${parsed.kind}`,
      targetId: parsed.nativeId,
      result: "succeeded"
    }).catch(() => {});
    return NextResponse.json(redactSecrets({ action: input.action, itemId: input.itemId, result }), {
      headers: { "Cache-Control": "no-store" }
    });
  } catch (error) {
    const uncertain = error instanceof AttentionMutationUncertainError;
    await recordAgentOsAuditEvent({
      actor: preflight.actor,
      operation: `human-control.${input.action}`,
      targetKind: `human-control-${parsed.kind}`,
      targetId: parsed.nativeId,
      result: uncertain ? "unknown" : "failed"
    }).catch(() => {});
    return NextResponse.json({
      error: redactErrorMessage(error, uncertain ? "OpenClaw did not confirm this action." : "OpenClaw rejected this action."),
      ...(uncertain ? { code: "attention-mutation-uncertain", retryable: false } : {})
    }, { status: uncertain ? 409 : 400, headers: { "Cache-Control": "no-store" } });
  }
}

function resolveNativeMethod(kind: "exec" | "plugin" | "question" | "suggestion", action: string) {
  if (kind === "exec" && (action === "approve" || action === "deny")) return "exec.approval.resolve";
  if (kind === "plugin" && (action === "approve" || action === "deny")) return "plugin.approval.resolve";
  if (kind === "question" && action === "answer") return "question.resolve";
  if (kind === "suggestion" && action === "accept") return "taskSuggestions.accept";
  if (kind === "suggestion" && action === "dismiss") return "taskSuggestions.dismiss";
  return null;
}

function resolveNativeParams(
  kind: "exec" | "plugin" | "question" | "suggestion",
  input: z.infer<typeof actionSchema>
) {
  if (kind === "exec" || kind === "plugin") {
    return { id: parseAttentionId(input.itemId)?.nativeId ?? "", decision: input.action === "deny" ? "deny" : "allow-once" };
  }
  if (kind === "question" && input.action === "answer") return { id: parseAttentionId(input.itemId)?.nativeId ?? "", answers: input.answers };
  if (kind === "suggestion" && input.action === "accept") return { taskId: parseAttentionId(input.itemId)?.nativeId ?? "", mode: input.mode, cloudProfileId: input.cloudProfileId };
  if (kind === "suggestion" && input.action === "dismiss") return { taskId: parseAttentionId(input.itemId)?.nativeId ?? "" };
  return {};
}
