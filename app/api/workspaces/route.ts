import { NextResponse } from "next/server";
import { z } from "zod";

import {
  createWorkspaceProject,
  deleteWorkspaceProject,
  getMissionControlSnapshot,
  updateWorkspaceProject
} from "@/lib/agentos/control-plane";
import { redactErrorMessage, redactSecrets } from "@/lib/security/redaction";
import type { OperationProgressSnapshot, WorkspaceCreateStreamEvent } from "@/lib/agentos/contracts";
import { requireAgentOsProductPermission } from "@/lib/security/agentos-product-authorization";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const agentPolicySchema = z.object({
  preset: z.enum(["worker", "setup", "browser", "monitoring", "custom"]),
  missingToolBehavior: z.enum(["fallback", "ask-setup", "route-setup", "allow-install"]),
  installScope: z.enum(["none", "workspace", "system"]),
  fileAccess: z.enum(["workspace-only", "extended"]),
  networkAccess: z.enum(["restricted", "enabled"])
});

const heartbeatSchema = z.object({
  enabled: z.boolean(),
  every: z.string().optional()
});

const docOverrideSchema = z.object({
  path: z.string().min(1),
  content: z.string()
});

const workspaceCreationSchema = z.object({
  source: z.enum(["api", "quick-create", "launchpad", "planner-deploy", "planner-runtime"]),
  planId: z.string().min(1).optional(),
  idempotencyKey: z.string().min(1).max(200).optional()
});

const workspaceMaterializationSchema = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("empty") }).strict(),
  z.object({ mode: z.literal("clone"), repoUrl: z.string().min(1) }).strict(),
  z.object({ mode: z.literal("existing"), existingPath: z.string().min(1) }).strict()
]);

const workspaceKnowledgeSourceSchema = z
  .object({
    id: z.string().min(1),
    kind: z.enum(["prompt", "website", "repository", "file", "folder", "connector"]),
    label: z.string().min(1),
    summary: z.string().min(1),
    details: z.array(z.string()).default([]),
    status: z.enum(["ready", "error"]),
    createdAt: z.string().min(1),
    provenance: z.enum(["operator", "wizard", "planner", "migration", "derived"]),
    confidence: z.number().optional(),
    error: z.string().optional(),
    locator: z.union([
      z.object({ kind: z.literal("prompt"), text: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("website"), url: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("repository"), remoteUrl: z.string().min(1).optional(), localPath: z.string().min(1).optional() }).strict().refine((value) => Boolean(value.remoteUrl || value.localPath), "Repository locator requires remoteUrl or localPath."),
      z.object({ kind: z.literal("file"), path: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("folder"), path: z.string().min(1) }).strict(),
      z.object({ kind: z.literal("connector"), provider: z.string().min(1), accountId: z.string().min(1).optional(), resourceId: z.string().min(1).optional(), resourceType: z.string().min(1).optional() }).strict()
    ])
  })
  .strict();

const workspaceSchema = z.object({
  name: z.string().min(1),
  brief: z.string().optional(),
  directory: z.string().optional(),
  modelId: z.string().optional(),
  thinking: z.enum(["off", "minimal", "low", "medium", "high", "xhigh"]).optional(),
  materialization: workspaceMaterializationSchema.optional(),
  sourceMode: z.enum(["empty", "clone", "existing"]).optional(),
  repoUrl: z.string().optional(),
  existingPath: z.string().optional(),
  knowledgeSources: z.array(workspaceKnowledgeSourceSchema).optional(),
  template: z.enum(["software", "frontend", "backend", "research", "content"]).optional(),
  teamPreset: z.enum(["solo", "core", "custom"]).optional(),
  modelProfile: z.enum(["balanced", "fast", "quality"]).optional(),
  rules: z
    .object({
      workspaceOnly: z.boolean().optional(),
      generateStarterDocs: z.boolean().optional(),
      generateMemory: z.boolean().optional(),
      kickoffMission: z.boolean().optional()
    })
    .optional(),
  docOverrides: z.array(docOverrideSchema).optional(),
  creation: workspaceCreationSchema.optional(),
  agents: z
    .array(
      z.object({
        id: z.string().min(1),
        role: z.string().min(1),
        name: z.string().min(1),
        enabled: z.boolean(),
        emoji: z.string().optional(),
        theme: z.string().optional(),
        skillId: z.string().optional(),
        skillIds: z.array(z.string()).optional(),
        modelId: z.string().optional(),
        isPrimary: z.boolean().optional(),
        policy: agentPolicySchema.optional(),
        heartbeat: heartbeatSchema.optional()
      })
    )
    .optional()
});

const workspaceCreateRequestSchema = workspaceSchema.extend({
  stream: z.boolean().optional()
});

const workspaceUpdateSchema = z.object({
  workspaceId: z.string().min(1),
  name: z.string().optional(),
  directory: z.string().optional(),
  plan: z.any().optional(),
  baseline: z.any().optional()
});

const workspaceDeleteSchema = z.object({
  workspaceId: z.string().min(1)
});

export async function GET(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "runtime.use");
  if ("response" in permission) return permission.response;
  const snapshot = await getMissionControlSnapshot();
  return NextResponse.json(redactSecrets({
    workspaces: snapshot.workspaces
  }));
}

export async function POST(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;
  try {
    const parsed = workspaceCreateRequestSchema.parse(await request.json());
    const { stream, ...input } = parsed;

    if (!stream) {
      const created = await createWorkspaceProject(input);

      return NextResponse.json(redactSecrets(created));
    }

    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();
    const encoder = new TextEncoder();
    let writeChain = Promise.resolve();
    let latestProgress: OperationProgressSnapshot | undefined;

    const send = (event: WorkspaceCreateStreamEvent) => {
      const safeEvent = redactSecrets(event);
      writeChain = writeChain
        .then(() => writer.write(encoder.encode(`${JSON.stringify(safeEvent)}\n`)))
        .catch(() => {});

      return writeChain;
    };

    void (async () => {
      try {
        const created = await createWorkspaceProject(input, {
          onProgress: async (progress) => {
            latestProgress = progress;
            await send({
              type: "progress",
              progress
            });
          }
        });

        await send({
          type: "done",
          ok: true,
          progress:
            latestProgress ??
            ({
              title: "Provisioning workspace",
              description: "Workspace bootstrap finished.",
              percent: 100,
              steps: []
            } satisfies OperationProgressSnapshot),
          result: created
        });
      } catch (error) {
        await send({
          type: "done",
          ok: false,
          error: redactErrorMessage(error, "Unable to create workspace."),
          progress: latestProgress
        });
      } finally {
        await writeChain;
        await writer.close();
      }
    })();

    return new Response(responseStream.readable, {
      headers: {
        "Content-Type": "application/x-ndjson; charset=utf-8",
        "Cache-Control": "no-store"
      }
    });

  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to create workspace.")
      },
      { status: 400 }
    );
  }
}

export async function PATCH(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;
  try {
    const input = workspaceUpdateSchema.parse(await request.json());
    const updated = await updateWorkspaceProject(input);

    return NextResponse.json(redactSecrets(updated));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to update workspace.")
      },
      { status: 400 }
    );
  }
}

export async function DELETE(request: Request) {
  const permission = await requireAgentOsProductPermission(request, "workspace.manage");
  if ("response" in permission) return permission.response;
  try {
    const input = workspaceDeleteSchema.parse(await request.json());
    const deleted = await deleteWorkspaceProject(input);

    return NextResponse.json(redactSecrets(deleted));
  } catch (error) {
    return NextResponse.json(
      {
        error: redactErrorMessage(error, "Unable to delete workspace.")
      },
      { status: 400 }
    );
  }
}
