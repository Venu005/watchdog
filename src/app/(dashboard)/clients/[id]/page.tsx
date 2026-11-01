import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceForPage } from "../../../../server/auth";
import { scopedClient, clientMonitors } from "../../../../server/clients";
import { ServiceError } from "../../../../server/errors";
import { Refresh } from "../../../../components/refresh";
import { Status, Time } from "../../../../components/status";
export default async function ClientPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await workspaceForPage();
  const { id } = await params;
  let client;
  try {
    client = await scopedClient(workspaceId, id);
  } catch (e) {
    if (e instanceof ServiceError && e.status === 404) notFound();
    throw e;
  }
  const monitors = await clientMonitors(workspaceId, id);
  return (
    <>
      <Link className="back-link" href="/clients">
        ← All clients
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">CLIENT OUTCOMES</span>
          <h1>{client.name}</h1>
          <p className="muted">
            {monitors.length} monitor{monitors.length === 1 ? "" : "s"} for this
            client.
          </p>
        </div>
        <Link
          className="button"
          aria-label="Create monitor for this client"
          href={"/monitors/new?clientId=" + id}
        >
          New monitor <span aria-hidden="true">+</span>
        </Link>
      </div>
      <div className="section-heading">
        <h2>Monitors</h2>
        <Refresh />
      </div>
      {monitors.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Monitor</th>
                <th>Status</th>
                <th>Evidence</th>
                <th>Last signal</th>
              </tr>
            </thead>
            <tbody>
              {monitors.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link className="row-title" href={"/monitors/" + m.id}>
                      {m.name}
                    </Link>
                  </td>
                  <td>
                    <Status value={m.status} />
                  </td>
                  <td className="small">{m.evidence ?? "No evidence yet"}</td>
                  <td className="small">
                    <Time value={m.last_signal_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-inline">No monitors for this client yet.</p>
      )}
    </>
  );
}
