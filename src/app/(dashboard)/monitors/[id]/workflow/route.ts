import { requireWorkspace } from "../../../../../server/auth";
import { scopedMonitor } from "../../../../../server/monitors";
import { buildN8nWorkflow } from "../../../../../integrations/n8n";
import { logger } from "../../../../../server/logger";
export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const { workspaceId } = await requireWorkspace();
    const m = await scopedMonitor(workspaceId, (await params).id);
    return Response.json(
      buildN8nWorkflow(m.id, m.config, process.env.APP_URL!),
      {
        headers: {
          "Content-Disposition":
            'attachment; filename="watchdog-workflow.json"',
          "Cache-Control": "no-store",
        },
      },
    );
  } catch {
    logger.warn("workflow.download_not_found", {
      requestId: request.headers.get("x-request-id") ?? crypto.randomUUID(),
    });
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
