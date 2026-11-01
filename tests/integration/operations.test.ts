import { it, expect } from "vitest";
import { fixture, signal } from "../helpers/fixture";
import { ingestSignal } from "../../src/server/ingest";
import {
  purgeData,
  deleteWorkspace,
  readiness,
} from "../../src/server/operations";
it("purges old signals but preserves an ongoing incident", async () => {
  const f = await fixture();
  try {
    await ingestSignal(
      f.monitor,
      f.token,
      { ...signal, record_count: 0 },
      new Date("2026-11-02T09:05:00Z"),
    );
    await purgeData(new Date("2026-12-05T00:00:00Z"));
    expect(
      await f.db`select * from watchdog.signals where monitor_id=${f.monitor}`,
    ).toHaveLength(0);
    expect(
      await f.db`select * from watchdog.incidents where monitor_id=${f.monitor} and status='open'`,
    ).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});
it("deletes workspace credentials, jobs and monitors together and is idempotent", async () => {
  const f = await fixture();
  try {
    await ingestSignal(
      f.monitor,
      f.token,
      { ...signal, record_count: 0 },
      new Date("2026-11-02T09:05:00Z"),
    );
    await f.db`update watchdog.workspaces set credentials='encrypted-fixture' where id=${f.ws}`;
    expect(await deleteWorkspace(f.ws)).toBeTruthy();
    expect(await deleteWorkspace(f.ws)).toBeNull();
    expect(
      await f.db`select * from watchdog.monitors where workspace_id=${f.ws}`,
    ).toHaveLength(0);
    expect(
      await f.db`select * from watchdog.jobs where monitor_id=${f.monitor}`,
    ).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});
it("readiness reports stale workers without disclosing identifiers", async () => {
  const f = await fixture();
  try {
    await f.db`delete from watchdog.workers`;
    await f.db`insert into watchdog.workers(id,last_seen) values('private-worker-name','2026-11-02T09:00:00Z')`;
    expect(await readiness(new Date("2026-11-02T09:01:00Z"))).toEqual({
      ready: true,
      worker: "healthy",
    });
    expect(await readiness(new Date("2026-11-02T09:03:00Z"))).toEqual({
      ready: false,
      worker: "stale",
    });
  } finally {
    await f.db`delete from watchdog.workers`;
    await f.cleanup();
  }
});
