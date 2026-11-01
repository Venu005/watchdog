import Link from "next/link";
import { workspaceForPage as requireWorkspace } from "../../../server/auth";
import { getDb, type MonitorRow } from "../../../server/db";
import { ClientForm } from "../../../components/forms";
import { Status, Time } from "../../../components/status";
export default async function Dashboard() {
  const { workspaceId } = await requireWorkspace();
  const db = getDb();
  const [w] =
    await db`select name,monitor_limit from watchdog.workspaces where id=${workspaceId}`;
  const monitors = await db<
    (MonitorRow & { client_name: string })[]
  >`select m.id,m.name,m.status,m.evidence,m.last_signal_at,m.client_id,c.name as client_name from watchdog.monitors m join watchdog.clients c on c.id=m.client_id where m.workspace_id=${workspaceId} order by m.created_at desc`;
  const clients =
    await db`select id,name from watchdog.clients where workspace_id=${workspaceId} order by name`;
  const incidents =
    await db`select i.id,i.reason,i.opened_at,m.id as monitor_id,m.name from watchdog.incidents i join watchdog.monitors m on m.id=i.monitor_id where m.workspace_id=${workspaceId} and i.status='open' order by i.opened_at desc`;
  return (
    <>
      <div className="page-heading">
        <div>
          <span className="eyebrow">{w.name}</span>
          <h1>Your monitoring workspace</h1>
          <p className="muted">
            Keep client automations accountable for their results.
          </p>
        </div>
        <Link aria-label="New monitor" href="/monitors/new" className="button">
          New monitor <span>+</span>
        </Link>
      </div>
      <section className="metrics">
        <div>
          <span className="muted small">Monitors</span>
          <strong>
            {monitors.length}
            <small> / {w.monitor_limit}</small>
          </strong>
        </div>
        <div>
          <span className="muted small">Healthy</span>
          <strong>
            {monitors.filter((m) => m.status === "healthy").length}
          </strong>
        </div>
        <div>
          <span className="muted small">Open incidents</span>
          <strong className={incidents.length ? "attention" : ""}>
            {incidents.length}
          </strong>
        </div>
        <div>
          <span className="muted small">Clients</span>
          <strong>{clients.length}</strong>
        </div>
      </section>
      {incidents.length > 0 && (
        <section className="incident-banner">
          <div>
            <span className="eyebrow">NEEDS ATTENTION</span>
            <h2>
              {incidents.length} open incident
              {incidents.length === 1 ? "" : "s"}
            </h2>
          </div>
          {incidents.map((i) => (
            <Link
              className="incident-row"
              key={i.id}
              href={"/monitors/" + i.monitor_id}
            >
              <strong>{i.name}</strong>
              <span>{i.reason}</span>
              <Time value={i.opened_at} />
              <span>↗</span>
            </Link>
          ))}
        </section>
      )}
      <div className="section-heading">
        <h2>Monitored outcomes</h2>
        <span className="muted small">
          Reported and independently verified results are labeled separately.
        </span>
      </div>
      {monitors.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Monitor / client</th>
                <th>Status</th>
                <th>Evidence</th>
                <th>Last signal</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {monitors.map((m) => (
                <tr key={m.id}>
                  <td>
                    <Link className="row-title" href={"/monitors/" + m.id}>
                      {m.name}
                    </Link>
                    <span className="muted small block">{m.client_name}</span>
                  </td>
                  <td>
                    <Status value={m.status} />
                  </td>
                  <td>
                    <span className="small">
                      {m.evidence ?? "No evidence yet"}
                    </span>
                  </td>
                  <td className="small">
                    <Time value={m.last_signal_at} />
                  </td>
                  <td>
                    <Link
                      aria-label={"Open " + m.name}
                      href={"/monitors/" + m.id}
                    >
                      ↗
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <section className="empty-state">
          <span className="empty-number">01</span>
          <div>
            <h2>Your first reliable outcome starts here.</h2>
            <p className="muted">
              Add a client, create a monitor, and connect its reporting step in
              n8n.
            </p>
            <ol>
              <li>Add the client you want to protect.</li>
              <li>Choose an expected schedule and result.</li>
              <li>Send a test, then activate monitoring.</li>
            </ol>
          </div>
        </section>
      )}
      <section className="lower-grid">
        <div className="panel">
          <h2>Add a client</h2>
          <p className="muted small">
            Group monitors by the businesses they serve.
          </p>
          <ClientForm />
        </div>
        <div className="open-panel">
          <span className="eyebrow">KNOW WHAT YOU KNOW</span>
          <h2>
            A green run is only
            <br />
            part of the story.
          </h2>
          <p className="muted">
            Workflow-reported results check the metadata sent by n8n.
            Destination-verified results independently check the expected Google
            Sheets rows.
          </p>
          <p className="small muted">
            Start with three important outcomes. We’ll help connect them.
          </p>
        </div>
      </section>
    </>
  );
}
