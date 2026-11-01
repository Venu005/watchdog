import { it, expect } from "vitest";
import { fixture, config, signal } from "../helpers/fixture";
import { ingestSignal } from "../../src/server/ingest";
import { sweepDeadlines } from "../../src/server/deadlines";
import { processJobs } from "../../src/server/process-jobs";
const sheet = {
  spreadsheetId: "abcdefghijk",
  tab: "Leads",
  idColumn: 0,
  timestampColumn: 1,
  requiredColumns: [2],
  expectedRows: 1,
};
it("requires independent verification to mark destination healthy", async () => {
  const f = await fixture();
  try {
    await f.db`update watchdog.monitors set config=${f.db.json({ ...config, sheet })} where id=${f.monitor}`;
    await ingestSignal(
      f.monitor,
      f.token,
      signal,
      new Date("2026-11-02T09:05:00Z"),
    );
    expect(
      (
        await f.db`select status from watchdog.monitors where id=${f.monitor}`
      )[0].status,
    ).toBe("awaiting");
    await processJobs("test", new Date("2026-11-02T09:05:15Z"), {
      verify: async () => ({ kind: "pass" }),
      send: async () => ({ id: "mail" }),
    });
    expect(
      (
        await f.db`select status,evidence from watchdog.monitors where id=${f.monitor}`
      )[0],
    ).toMatchObject({ status: "healthy", evidence: "destination-verified" });
  } finally {
    await f.cleanup();
  }
});
it("retries at 15,60,180 seconds then reports verification unavailable", async () => {
  const f = await fixture();
  try {
    await f.db`update watchdog.monitors set config=${f.db.json({ ...config, sheet })} where id=${f.monitor}`;
    await ingestSignal(
      f.monitor,
      f.token,
      signal,
      new Date("2026-11-02T09:05:00Z"),
    );
    const adapters = {
      verify: async () => ({
        kind: "error" as const,
        reason: "verification-unavailable",
      }),
      send: async () => ({ id: "mail" }),
    };
    await processJobs("test", new Date("2026-11-02T09:05:15Z"), adapters);
    expect(
      (
        await f.db`select due_at from watchdog.jobs where monitor_id=${f.monitor} and kind='verify'`
      )[0].due_at.toISOString(),
    ).toBe("2026-11-02T09:06:00.000Z");
    await processJobs("test", new Date("2026-11-02T09:06:00Z"), adapters);
    expect(
      (
        await f.db`select due_at from watchdog.jobs where monitor_id=${f.monitor} and kind='verify'`
      )[0].due_at.toISOString(),
    ).toBe("2026-11-02T09:08:00.000Z");
    await processJobs("test", new Date("2026-11-02T09:08:00Z"), adapters);
    expect(
      (
        await f.db`select reason from watchdog.incidents where monitor_id=${f.monitor}`
      )[0].reason,
    ).toBe("verification-error");
    await sweepDeadlines(new Date("2026-11-02T09:10:00Z"));
    expect(
      (
        await f.db`select reason,evidence from watchdog.incidents where monitor_id=${f.monitor}`
      )[0],
    ).toMatchObject({
      reason: "verification-error",
      evidence: "verification-unavailable",
    });
    await sweepDeadlines(new Date("2026-11-03T09:10:00Z"));
    expect(
      (
        await f.db`select reason from watchdog.signals where monitor_id=${f.monitor} and event_id=${signal.event_id}`
      )[0].reason,
    ).toBe("verification-error");
  } finally {
    await f.cleanup();
  }
});
it("does not apply a check that became stale during its external request", async () => {
  const f = await fixture();
  try {
    await f.db`update watchdog.monitors set config=${f.db.json({ ...config, sheet })} where id=${f.monitor}`;
    await ingestSignal(
      f.monitor,
      f.token,
      signal,
      new Date("2026-11-02T09:05:00Z"),
    );
    await processJobs("test", new Date("2026-11-02T09:05:15Z"), {
      verify: async () => {
        await f.db`update watchdog.monitors set config=${f.db.json({ ...config, version: 2, sheet })} where id=${f.monitor}`;
        return { kind: "pass" };
      },
      send: async () => ({ id: "mail" }),
    });
    expect(
      (
        await f.db`select status from watchdog.monitors where id=${f.monitor}`
      )[0].status,
    ).toBe("awaiting");
  } finally {
    await f.cleanup();
  }
});
it("records retrying email failures and later provider acceptance", async () => {
  const f = await fixture();
  try {
    await ingestSignal(
      f.monitor,
      f.token,
      { ...signal, record_count: 0 },
      new Date("2026-11-02T09:05:00Z"),
    );
    await processJobs("test", new Date("2026-11-02T09:05:01Z"), {
      verify: async () => ({ kind: "pass" }),
      send: async () => {
        throw new Error("provider failure");
      },
    });
    expect(
      (
        await f.db`select status,error from watchdog.jobs where monitor_id=${f.monitor}`
      )[0],
    ).toMatchObject({ status: "queued", error: "email-unavailable" });
    await processJobs("test", new Date("2026-11-02T09:10:00Z"), {
      verify: async () => ({ kind: "pass" }),
      send: async () => ({ id: "provider-id" }),
    });
    expect(
      (
        await f.db`select status,provider_id from watchdog.jobs where monitor_id=${f.monitor}`
      )[0],
    ).toMatchObject({ status: "completed", provider_id: "provider-id" });
  } finally {
    await f.cleanup();
  }
});

it("runs test-only destination readback while paused without qualifying or alerting", async () => {
  const f = await fixture();
  try {
    await f.db`update watchdog.monitors set active=false,status='paused',config=${f.db.json({ ...config, sheet })} where id=${f.monitor}`;
    await ingestSignal(
      f.monitor,
      f.token,
      { ...signal, is_test: true },
      new Date("2026-11-02T09:05:00Z"),
    );
    expect(
      await f.db`select id from watchdog.jobs where monitor_id=${f.monitor} and kind='verify'`,
    ).toHaveLength(1);
    await processJobs("test", new Date("2026-11-02T09:05:15Z"), {
      verify: async () => ({ kind: "pass" }),
      send: async () => ({ id: "should-not-send" }),
    });
    expect(
      (
        await f.db`select kind,reason,is_test from watchdog.signals where monitor_id=${f.monitor}`
      )[0],
    ).toMatchObject({
      kind: "test",
      is_test: true,
      reason: "synthetic-test:destination-verified",
    });
    expect(
      (
        await f.db`select status,qualified_for from watchdog.monitors where id=${f.monitor}`
      )[0],
    ).toMatchObject({ status: "paused", qualified_for: null });
    expect(
      await f.db`select id from watchdog.incidents where monitor_id=${f.monitor}`,
    ).toHaveLength(0);
    expect(
      await f.db`select id from watchdog.jobs where monitor_id=${f.monitor} and kind='email'`,
    ).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});
it("records failed synthetic readback without opening a production incident", async () => {
  const f = await fixture();
  try {
    await f.db`update watchdog.monitors set active=false,status='paused',config=${f.db.json({ ...config, sheet })} where id=${f.monitor}`;
    await ingestSignal(
      f.monitor,
      f.token,
      { ...signal, is_test: true },
      new Date("2026-11-02T09:05:00Z"),
    );
    const adapters = {
      verify: async () => ({
        kind: "error" as const,
        reason: "credentials-missing",
      }),
      send: async () => ({ id: "must-not-send" }),
    };
    for (const time of ["09:05:15", "09:06:00", "09:08:00"])
      await processJobs("test", new Date("2026-11-02T" + time + "Z"), adapters);
    expect(
      (
        await f.db`select reason from watchdog.signals where monitor_id=${f.monitor}`
      )[0].reason,
    ).toBe("synthetic-test:verification-error");
    expect(
      (
        await f.db`select status,qualified_for from watchdog.monitors where id=${f.monitor}`
      )[0],
    ).toMatchObject({ status: "paused", qualified_for: null });
    expect(
      await f.db`select id from watchdog.incidents where monitor_id=${f.monitor}`,
    ).toHaveLength(0);
    expect(
      await f.db`select id from watchdog.jobs where monitor_id=${f.monitor} and kind='email'`,
    ).toHaveLength(0);
  } finally {
    await f.cleanup();
  }
});
