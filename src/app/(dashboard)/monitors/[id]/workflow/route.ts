import { requireWorkspace } from "../../../../../server/auth";
import { scopedMonitor } from "../../../../../server/monitors";
import { buildN8nWorkflow } from "../../../../../integrations/n8n";
export async function GET(
  _request: Request,
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
    return Response.json({ error: "Not found" }, { status: 404 });
  }
}
