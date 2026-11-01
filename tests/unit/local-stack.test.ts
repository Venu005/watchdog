import { describe, it, expect, vi } from "vitest";
import {
  ownsSupervisor,
  stopProcessGroups,
} from "../../scripts/local-stack-helpers.mjs";
describe("local stack process safety", () => {
  it("refuses a stale PID reused by an unrelated server", () => {
    expect(
      ownsSupervisor(
        "node other-project/server.js",
        "/repo/scripts/local-stack.mjs",
      ),
    ).toBe(false);
    expect(
      ownsSupervisor(
        "node /repo/scripts/local-stack.mjs start",
        "/repo/scripts/local-stack.mjs",
      ),
    ).toBe(false);
    expect(
      ownsSupervisor(
        "node /other/scripts/local-stack.mjs supervise",
        "/repo/scripts/local-stack.mjs",
      ),
    ).toBe(false);
    expect(
      ownsSupervisor(
        "node /repo/scripts/local-stack.mjs supervise",
        "/repo/scripts/local-stack.mjs",
      ),
    ).toBe(true);
  });
  it("cleans up every owned child even when an earlier child has already exited", () => {
    const kill = vi.fn((pid: number) => {
      if (pid === -10) throw new Error("gone");
    });
    stopProcessGroups([10, 20], kill);
    expect(kill).toHaveBeenCalledWith(-10, "SIGTERM");
    expect(kill).toHaveBeenCalledWith(-20, "SIGTERM");
  });
});
it("force-stops an owned process group that ignores graceful shutdown", async () => {
  const { terminateProcessGroups } =
    await import("../../scripts/local-stack-helpers.mjs");
  let alive = true;
  const kill = vi.fn((_pid: number, signal: NodeJS.Signals | 0) => {
    if (signal === 0 && !alive) throw new Error("gone");
    if (signal === "SIGKILL") alive = false;
  });
  await terminateProcessGroups([42], kill, async () => {}, 2);
  expect(kill).toHaveBeenCalledWith(-42, "SIGTERM");
  expect(kill).toHaveBeenCalledWith(-42, "SIGKILL");
  expect(alive).toBe(false);
});
