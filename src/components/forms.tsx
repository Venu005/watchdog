"use client";

import { useActionState, useState } from "react";
import Link from "next/link";
import {
  loginAction,
  clientAction,
  monitorAction,
  rotateAction,
  emailAction,
  type FormState,
} from "../server/actions";
import type { MonitorConfig } from "../domain/types";

function Notice({ state }: { state: FormState }) {
  return (
    <>
      {state.error && (
        <p className="notice error" role="alert">
          {state.error}
        </p>
      )}
      {state.message && (
        <p className="notice" role="status">
          {state.message}
        </p>
      )}
    </>
  );
}
export function LoginForm() {
  const [state, action, pending] = useActionState(loginAction, {});

  return (
    <form action={action} className="stack">
      <label>
        Work email
        <input
          name="email"
          type="email"
          autoComplete="email"
          required
          placeholder="you@youragency.com"
        />
      </label>
      <button disabled={pending}>
        {pending ? "Sending…" : "Send sign-in link"}
      </button>
      <Notice state={state} />
      <p className="muted small">
        Invite-only access. No password to remember.
      </p>
    </form>
  );
}

export function ClientForm() {
  const [state, action, pending] = useActionState(clientAction, {});
  return (
    <form action={action} className="stack">
      <label>
        Client name
        <input name="name" required maxLength={100} placeholder="Acme Studio" />
      </label>
      <button className="secondary" disabled={pending}>
        Add client
      </button>
      <Notice state={state} />
    </form>
  );
}

function Secret({ state }: { state: FormState }) {
  return (
    <section className="setup-success">
      <span className="eyebrow">Connection ready</span>
      <h2>Save your monitor token.</h2>
      <p>
        Shown only now. Store it as an n8n Header Auth credential with name{" "}
        <code>Authorization</code> and value <code>Bearer YOUR_TOKEN</code>.
      </p>
      <pre data-testid="setup-token">{state.token}</pre>
      <p className="muted small">Monitor ID</p>
      <code data-testid="monitor-id">{state.id}</code>
      <p>
        <Link className="button" href={"/monitors/" + state.id}>
          Open monitor
        </Link>
      </p>
    </section>
  );
}

export function RotateForm({ id }: { id: string }) {
  const [state, action, pending] = useActionState(rotateAction, {});
  return (
    <form action={action} className="stack">
      <input type="hidden" name="id" value={id} />
      <p className="muted small">
        Rotation immediately invalidates the old token. Update its n8n
        credential before the next run.
      </p>
      <button className="secondary" disabled={pending}>
        Rotate token
      </button>
      <Notice state={state} />
      {state.token && <Secret state={state} />}
    </form>
  );
}
export function EmailForm() {
  const [state, action, pending] = useActionState(emailAction, {});
  return (
    <form action={action} className="stack">
      <label>
        New owner and alert email
        <input name="email" type="email" required />
      </label>
      <button className="secondary" disabled={pending}>
        Verify new email
      </button>
      <Notice state={state} />
    </form>
  );
}
export function MonitorForm({
  clients,
  selectedClientId,
  initial,
  id,
  name,
}: {
  clients: { id: string; name: string }[];
  selectedClientId?: string;
  initial?: MonitorConfig;
  id?: string;
  name?: string;
}) {
  const [state, action, pending] = useActionState(monitorAction, {});
  const [useSheet, setUseSheet] = useState(Boolean(initial?.sheet));
  if (state.token) return <Secret state={state} />;
  return (
    <form action={action} className="stack form-grid">
      <input type="hidden" name="id" value={id ?? ""} />
      <label className="full">
        Monitor name
        <input
          name="name"
          defaultValue={name}
          required
          maxLength={100}
          placeholder="Daily lead sync"
        />
      </label>
      {!id && (
        <label className="full">
          Client
          <select
            name="clientId"
            aria-label="Client"
            required
            defaultValue={selectedClientId}
          >
            {clients.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
      )}
      <label>
        Schedule
        <select name="kind" defaultValue={initial?.schedule.kind ?? "daily"}>
          <option value="hourly">Hourly</option>
          <option value="daily">Daily</option>
          <option value="weekdays">Weekdays</option>
        </select>
      </label>
      <label>
        Hour (UTC)
        <input
          name="hour"
          type="number"
          min={0}
          max={23}
          defaultValue={initial?.schedule.hour ?? 9}
        />
      </label>
      <label>
        Minute
        <input
          name="minute"
          type="number"
          min={0}
          max={59}
          defaultValue={initial?.schedule.minute ?? 0}
        />
      </label>
      <label>
        Grace period (minutes)
        <input
          name="grace"
          type="number"
          min={1}
          max={1439}
          defaultValue={initial?.schedule.graceMinutes ?? 10}
        />
      </label>
      <p className="muted small full">
        Hourly schedules use the minute only. Grace must be shorter than the run
        interval. All schedules use UTC.
      </p>
      <label>
        Minimum records
        <input
          name="minimumCount"
          type="number"
          min={0}
          max={1000000}
          defaultValue={initial?.minimumCount ?? 1}
        />
      </label>
      <label>
        Required fields
        <input
          name="requiredFields"
          defaultValue={initial?.requiredFields.join(",") ?? ""}
          placeholder="lead_id, customer_id"
        />
      </label>
      <label className="checkbox full">
        <input
          type="checkbox"
          name="useSheet"
          checked={useSheet}
          onChange={(e) => setUseSheet(e.target.checked)}
        />{" "}
        Independently verify Google Sheets
      </label>
      {useSheet && (
        <>
          <p className="muted small full">
            Assisted setup required: share only the target Sheet as viewer with
            your service account. Column positions are zero-based: A = 0, B = 1.
          </p>
          <label>
            Spreadsheet ID
            <input
              name="spreadsheetId"
              defaultValue={initial?.sheet?.spreadsheetId}
              required
            />
          </label>
          <label>
            Tab name
            <input
              name="tab"
              defaultValue={initial?.sheet?.tab ?? "Leads"}
              required
            />
          </label>
          <label>
            Run ID column
            <input
              name="idColumn"
              type="number"
              min={0}
              max={25}
              defaultValue={initial?.sheet?.idColumn ?? 0}
            />
          </label>
          <label>
            UTC timestamp column
            <input
              name="timestampColumn"
              type="number"
              min={0}
              max={25}
              defaultValue={initial?.sheet?.timestampColumn ?? 1}
            />
          </label>
          <label>
            Required columns
            <input
              name="requiredColumns"
              defaultValue={initial?.sheet?.requiredColumns.join(",") ?? ""}
              placeholder="2,3"
            />
          </label>
          <label>
            Exact expected rows
            <input
              name="expectedRows"
              type="number"
              min={1}
              max={100}
              defaultValue={initial?.sheet?.expectedRows ?? 1}
            />
          </label>
        </>
      )}
      <div className="full">
        <button disabled={pending || (!id && !clients.length)}>
          {pending ? "Saving…" : id ? "Save rules" : "Create monitor"}
        </button>
        <Notice state={state} />
      </div>
    </form>
  );
}
export function CopyBlock({ text, label }: { text: string; label: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="copy-block">
      <div className="copy-heading">
        <span className="small muted">{label}</span>
        <button
          className="text-button"
          type="button"
          onClick={async () => {
            await navigator.clipboard.writeText(text);
            setCopied(true);
          }}
        >
          {" "}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <pre>{text}</pre>
    </div>
  );
}
