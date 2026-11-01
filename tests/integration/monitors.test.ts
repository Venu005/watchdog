import { it, expect } from "vitest";
import { randomUUID } from "node:crypto";
import { fixture, config, signal } from "../helpers/fixture";
import {
  createMonitor,
  pauseMonitor,
  rotateToken,
  updateMonitor,
} from "../../src/server/monitors";
import { ingestSignal } from "../../src/server/ingest";
it("denies guessed foreign object IDs", async () => {
  const f = await fixture();
  try {
    await expect(rotateToken(randomUUID(), f.monitor)).rejects.toThrow(
      "not found",
    );
    await expect(
      createMonitor(randomUUID(), f.client, "Stolen", config),
    ).rejects.toThrow("not found");
  } finally {
    await f.cleanup();
  }
});
it("serializes quota checks for simultaneous monitor creation", async () => {
  const f = await fixture();
  try {
    const results = await Promise.allSettled(
      [1, 2, 3].map((i) =>
        createMonitor(f.ws, f.client, "Monitor " + i, config),
      ),
    );
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(2);
    expect(
      await f.db`select id from watchdog.monitors where workspace_id=${f.ws}`,
    ).toHaveLength(3);
  } finally {
    await f.cleanup();
  }
});
it("invalidates the previous bearer token when rotated", async () => {
  const f = await fixture();
  try {
    const token = await rotateToken(f.ws, f.monitor);
    await expect(
      ingestSignal(
        f.monitor,
        f.token,
        signal,
        new Date("2026-11-02T09:05:00Z"),
      ),
    ).rejects.toThrow("Unauthorized");
    expect(
      await ingestSignal(
        f.monitor,
        token,
        signal,
        new Date("2026-11-02T09:05:00Z"),
      ),
    ).toMatchObject({ kind: "pass" });
  } finally {
    await f.cleanup();
  }
});
it("pauses an incident without inventing recovery and cancels queued alerts", async () => {
  const f = await fixture();
  try {
    await ingestSignal(
      f.monitor,
      f.token,
      { ...signal, record_count: 0 },
      new Date("2026-11-02T09:05:00Z"),
    );
    await pauseMonitor(f.ws, f.monitor);
    expect(
      (
        await f.db`select status from watchdog.incidents where monitor_id=${f.monitor}`
      )[0].status,
    ).toBe("paused");
    expect(
      (
        await f.db`select status from watchdog.jobs where monitor_id=${f.monitor}`
      )[0].status,
    ).toBe("cancelled");
  } finally {
    await f.cleanup();
  }
});
it("versions edits and invalidates previous checks and evidence", async () => {
  const f = await fixture();
  try {
    await updateMonitor(
      f.ws,
      f.monitor,
      "Changed",
      config,
      new Date("2026-11-02T10:00:00Z"),
    );
    const [m] =
      await f.db`select config,active_from,status from watchdog.monitors where id=${f.monitor}`;
    expect(m.config.version).toBe(2);
    expect(m.active_from.toISOString()).toBe("2026-11-03T09:00:00.000Z");
    expect(m.status).toBe("awaiting");
    await expect(
      ingestSignal(
        f.monitor,
        f.token,
        signal,
        new Date("2026-11-02T10:00:00Z"),
      ),
    ).rejects.toThrow("stale");
  } finally {
    await f.cleanup();
  }
});
