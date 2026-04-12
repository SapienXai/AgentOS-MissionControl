import { NextResponse } from "next/server";
import { z } from "zod";

import { deployWorkspacePlan } from "@/lib/agentos/planner";
import type {
  OperationProgressSnapshot,
  WorkspacePlanDeployStreamEvent
} from "@/lib/agentos/contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const deploySchema = z.object({
  plan: z.any().optional(),
  stream: z.boolean().optional()
});

export async function POST(
  request: Request,
  context: {
    params: Promise<{
      planId: string;
    }>;
  }
) {
  try {
    const { planId } = await context.params;
    const input = deploySchema.parse(await request.json());

    if (!input.stream) {
      const result = await deployWorkspacePlan(planId, input.plan);
      return NextResponse.json(result);
    }

    const responseStream = new TransformStream();
    const writer = responseStream.writable.getWriter();
    const encoder = new TextEncoder();
    let writeChain = Promise.resolve();
    let latestProgress: OperationProgressSnapshot | undefined;

    const send = (event: WorkspacePlanDeployStreamEvent) => {
      writeChain = writeChain
        .then(() => writer.write(encoder.encode(`${JSON.stringify(event)}\n`)))
        .catch(() => {});

      return writeChain;
    };

    void (async () => {
      try {
        const result = await deployWorkspacePlan(planId, input.plan, {
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
              title: "Deploying workspace",
              description: "Planner deploy finished.",
              percent: 100,
              steps: []
            } satisfies OperationProgressSnapshot),
          result
        });
      } catch (error) {
        await send({
          type: "done",
          ok: false,
          error: error instanceof Error ? error.message : "Unable to deploy planner workspace.",
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
        error: error instanceof Error ? error.message : "Unable to deploy planner workspace."
      },
      { status: 400 }
    );
  }
}
