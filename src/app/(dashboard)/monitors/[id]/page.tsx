import Link from "next/link";
import { notFound } from "next/navigation";
import { workspaceForPage as requireWorkspace } from "../../../../server/auth";
import { scopedMonitor } from "../../../../server/monitors";
import { getDb } from "../../../../server/db";
import {
  getWindow,
  latestOccurrence,
  nextOccurrence,
} from "../../../../domain/schedule";
import { Status, Time } from "../../../../components/status";
import {
  MonitorForm,
  RotateForm,
  CopyBlock,
} from "../../../../components/forms";
import { Refresh } from "../../../../components/refresh";
import { toggleAction } from "../../../../server/actions";
export default async function MonitorDetail({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { workspaceId } = await requireWorkspace();
  let m;
  try {
    m = await scopedMonitor(workspaceId, (await params).id);
  } catch {
    notFound();
  }
  const db = getDb();
  const events =
    await db`select event_id,kind,evidence,reason,record_count,is_test,received_at from watchdog.signals where monitor_id=${m.id} order by received_at desc limit 20`;
  const incidents =
    await db`select id,status,reason,opened_at,closed_at from watchdog.incidents where monitor_id=${m.id} order by opened_at desc limit 20`;
  const deliveries =
    await db`select kind,status,attempts,error,provider_id,created_at from watchdog.jobs where monitor_id=${m.id} order by created_at desc limit 20`;
  const now = new Date();
  let deadline: Date | null = null;
  if (m.active && m.active_from) {
    let occurrence = latestOccurrence(m.config.schedule, now);
    if (occurrence < m.active_from) occurrence = m.active_from;
    else if (m.qualified_for?.getTime() === occurrence.getTime())
      occurrence = nextOccurrence(m.config.schedule, now);
    deadline = getWindow(m.config.schedule, occurrence).deadline;
  }
  const sample = JSON.stringify(
    {
      event_id: "unique-run-id",
      config_version: m.config.version,
      scheduled_for: "YYYY-MM-DDTHH:mm:00.000Z",
      record_count: 1,
      fields: Object.fromEntries(m.config.requiredFields.map((k) => [k, true])),
      is_test: true,
    },
    null,
    2,
  );
  return (
    <>
      <Link href="/dashboard" className="back-link">
        ← Overview
      </Link>
      <div className="page-heading">
        <div>
          <span className="eyebrow">
            MONITORED OUTCOME · CONFIGURATION V{m.config.version}
          </span>
          <h1>{m.name}</h1>
          <Status value={m.status} />
        </div>
        <form action={toggleAction}>
          <input type="hidden" name="id" value={m.id} />
          <input
            type="hidden"
            name="intent"
            value={m.active ? "pause" : "activate"}
          />
          <button className={m.active ? "secondary" : ""}>
            {m.active ? "Pause monitor" : "Activate monitor"}
          </button>
        </form>
      </div>
      <section className="metrics detail-metrics">
        <div>
          <span className="muted small">Evidence</span>
          <strong className="metric-text">
            {m.evidence ?? "No production evidence yet"}
          </strong>
        </div>
        <div>
          <span className="muted small">Last signal</span>
          <strong className="metric-text">
            <Time value={m.last_signal_at} />
          </strong>
        </div>
        <div>
          <span className="muted small">Next deadline</span>
          <strong className="metric-text">
            <Time value={deadline} />
          </strong>
        </div>
      </section>
      <div className="section-heading">
        <h2>Recent signals</h2>
        <Refresh />
      </div>
      {events.length ? (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Run ID</th>
                <th>Result</th>
                <th>Records</th>
                <th>Evidence / reason</th>
                <th>Received (UTC)</th>
              </tr>
            </thead>
            <tbody>
              {events.map((e) => (
                <tr key={e.event_id}>
                  <td className="mono small">{e.event_id}</td>
                  <td>{e.is_test ? "Test" : e.kind}</td>
                  <td>{e.record_count}</td>
                  <td className="small">{e.reason ?? e.evidence ?? "—"}</td>
                  <td className="small">
                    <Time value={e.received_at} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <p className="empty-inline">
          No signals received yet. Connect n8n and send a synthetic test first.
        </p>
      )}
      <section className="lower-grid">
        <div className="panel">
          <h2>Incident history</h2>
          {incidents.length ? (
            incidents.map((i) => (
              <article className="history-item" key={i.id}>
                <strong>{i.reason}</strong>
                <span className="tag">{i.status}</span>
                <p className="muted small">
                  Opened <Time value={i.opened_at} />
                  {i.closed_at && (
                    <>
                      {" "}
                      · Closed <Time value={i.closed_at} />
                    </>
                  )}
                </p>
              </article>
            ))
          ) : (
            <p className="muted small">No incidents recorded.</p>
          )}
        </div>
        <div className="panel">
          <h2>Verification & notifications</h2>
          {deliveries.length ? (
            deliveries.map((j, i) => (
              <article className="history-item" key={i}>
                <strong>
                  {j.kind === "email"
                    ? "Email notification"
                    : "Sheets verification"}
                </strong>
                <span className="tag">
                  {j.kind === "email" && j.status === "completed"
                    ? "Provider accepted"
                    : j.status}
                </span>
                <p className="muted small">
                  {j.attempts} attempt{j.attempts === 1 ? "" : "s"}
                  {j.error && " · " + j.error}
                </p>
              </article>
            ))
          ) : (
            <p className="muted small">
              Delivery and verification attempts will appear here.
            </p>
          )}
          <p className="muted small">
            Provider acceptance does not confirm inbox delivery.
          </p>
        </div>
      </section>
      <section className="panel setup-panel">
        <span className="eyebrow">CONNECT N8N</span>
        <h2>Send evidence after the work happens.</h2>
        <p className="muted">
          Import the starter workflow, replace its business-action step, and
          select your Header Auth credential. The starter is disabled and
          defaults to synthetic tests.
        </p>
        <a
          className="button secondary"
          href={"/monitors/" + m.id + "/workflow"}
        >
          Download n8n workflow
        </a>
        <div className="lower-grid">
          <CopyBlock
            label="POST endpoint"
            text={process.env.APP_URL + "/api/ingest/" + m.id}
          />
          <CopyBlock label="Signal envelope" text={sample} />
        </div>
        <ol className="small muted">
          <li>
            Set Header Auth name to Authorization and value to Bearer followed
            by your token.
          </li>
          <li>
            Match the UTC schedule. Capture the intended occurrence before
            business processing.
          </li>
          <li>
            Send a synthetic test and inspect it here. Test signals never
            satisfy deadlines.
          </li>
          <li>
            After assisted setup, set is_test to false and publish the n8n
            workflow, then activate this monitor.
          </li>
        </ol>
        {m.config.sheet && (
          <p className="notice">
            Sheets checks require server-side credentials. Write the same
            event_id plus a UTC timestamp into the target rows before reporting
            completion.
          </p>
        )}
      </section>
      <section className="lower-grid">
        <div className="panel">
          <h2>Monitor rules</h2>
          <p className="muted small">
            Changing rules increments the configuration version and resets the
            deadline. Refresh the n8n setup afterward.
          </p>
          <MonitorForm
            clients={[]}
            initial={m.config}
            id={m.id}
            name={m.name}
          />
        </div>
        <div className="panel">
          <h2>Connection security</h2>
          <RotateForm id={m.id} />
        </div>
      </section>
    </>
  );
}
