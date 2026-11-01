import Link from "next/link";
import { workspaceForPage } from "../../../server/auth";
import { listClients } from "../../../server/clients";
import { Refresh } from "../../../components/refresh";
import { ClientForm } from "../../../components/forms";
export default async function ClientsPage() {
  const { workspaceId } = await workspaceForPage();
  const clients = await listClients(workspaceId);
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">AGENCY DIRECTORY</span>
          <h1>Clients</h1>
          <p className="muted">
            Every client in your workspace, including those without monitors.
          </p>
        </div>
      </div>
      <div className="section-heading">
        <h2>Client directory</h2>
        <Refresh />
      </div>
      <section aria-label="Client directory">
        {clients.length ? (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Client</th>
                  <th>Monitors</th>
                  <th>Needs attention</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {clients.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link className="row-title" href={"/clients/" + c.id}>
                        {c.name}
                      </Link>
                    </td>
                    <td>{c.monitor_count}</td>
                    <td>{c.failing_count}</td>
                    <td>
                      <Link
                        className="small"
                        aria-label={"View " + c.name + " monitors"}
                        href={"/clients/" + c.id}
                      >
                        View monitors ↗
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <p className="empty-inline">
            No clients yet. Add your first client below.
          </p>
        )}
      </section>
      <section className="panel form-panel" style={{ marginTop: 28 }}>
        <h2>Add a client</h2>
        <p className="muted small">
          You can add clients before setting up their monitoring.
        </p>
        <ClientForm />
      </section>
    </>
  );
}
