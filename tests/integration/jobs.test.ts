import { it, expect } from "vitest";
import { fixture, signal } from "../helpers/fixture";
import { ingestSignal } from "../../src/server/ingest";
import { claimJobs, finishJob } from "../../src/server/jobs";
it("leases each queued notification to at most one worker", async () => {
  const f = await fixture();
  try {
    await ingestSignal(
      f.monitor,
      f.token,
      { ...signal, record_count: 0 },
      new Date("2026-11-02T09:05:00Z"),
    );
    const batches = await Promise.all([
      claimJobs("a", new Date("2026-11-02T09:05:01Z"), 1),
      claimJobs("b", new Date("2026-11-02T09:05:01Z"), 1),
    ]);
    const jobs = batches.flat().filter((j) => j.id);
    expect(jobs).toHaveLength(1);
  } finally {
    await f.cleanup();
  }
});
it("reclaims expired leases and fences stale completion", async () => {
  const f = await fixture();
  try {
    await ingestSignal(
      f.monitor,
      f.token,
      { ...signal, record_count: 0 },
      new Date("2026-11-02T09:05:00Z"),
    );
    const [first] = await claimJobs("a", new Date("2026-11-02T09:05:00Z"), 1);
    const [second] = await claimJobs("b", new Date("2026-11-02T09:07:00Z"), 1);
    expect(second.id).toBe(first.id);
    expect(await finishJob(first.id, first.lease_token)).toBe(false);
    expect(await finishJob(second.id, second.lease_token)).toBe(true);
  } finally {
    await f.cleanup();
  }
});
it("marks an exhausted crashed job failed rather than leaving it running forever", async () => {
  const f = await fixture();
  try {
    await ingestSignal(
      f.monitor,
      f.token,
      { ...signal, record_count: 0 },
      new Date("2026-11-02T09:05:00Z"),
    );
    await f.db`update watchdog.jobs set status='running',attempts=5,lease_until='2026-11-02T09:05:30Z' where monitor_id=${f.monitor}`;
    await claimJobs("replacement", new Date("2026-11-02T09:06:00Z"), 1);
    expect(
      (
        await f.db`select status,error from watchdog.jobs where monitor_id=${f.monitor}`
      )[0],
    ).toMatchObject({ status: "failed", error: "lease-exhausted" });
  } finally {
    await f.cleanup();
  }
});
