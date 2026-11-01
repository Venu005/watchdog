import Link from "next/link";
import { workspaceForPage as requireWorkspace } from "../../../../server/auth";
import { getDb } from "../../../../server/db";
import { MonitorForm } from "../../../../components/forms";
export default async function NewMonitor() {
  const { workspaceId } = await requireWorkspace();
  const clients = await getDb()<
    { id: string; name: string }[]
  >`select id,name from watchdog.clients where workspace_id=${workspaceId} order by name`;
  return (
    <>
      <Link className="back-link" href="/dashboard">
        ← Overview
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CONNECT AN OUTCOME</span>
          <h1>New monitor</h1>
          <p className="muted">
            Define what should happen, and when we should expect it.
          </p>
        </div>
      </div>
      <section className="panel form-panel">
        {clients.length ? (
          <MonitorForm clients={clients} />
        ) : (
          <p>
            Add a client on the <Link href="/dashboard">overview</Link> first.
          </p>
        )}
      </section>
    </>
  );
}
