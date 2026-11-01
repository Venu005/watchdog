import { validateEnvironment } from "../server/environment";
import { randomUUID } from "node:crypto";
import { getDb, closeDb } from "../server/db";
import { sweepDeadlines } from "../server/deadlines";
import { processJobs } from "../server/process-jobs";
import { purgeData } from "../server/operations";
const id = randomUUID();
let stopping = false;
let lastSweep = 0;
let lastPurge = 0;
let lastHeartbeat = 0;
let announced = false;
process.on("SIGTERM", () => {
  stopping = true;
});
process.on("SIGINT", () => {
  stopping = true;
});
async function main() {
  validateEnvironment("worker", process.env);
  console.log("Watchdog worker starting");
  while (!stopping) {
    const at = new Date();
    try {
      if (at.getTime() - lastSweep >= 60000) {
        await sweepDeadlines(at);
        lastSweep = at.getTime();
      }
      await processJobs(id, at, undefined, () => new Date());
      if (at.getTime() - lastPurge >= 86400000) {
        await purgeData(at);
        lastPurge = at.getTime();
      }
      await getDb()`insert into watchdog.workers(id,last_seen) values(${id},${at}) on conflict(id) do update set last_seen=excluded.last_seen`;
      if (!announced) {
        console.log("Watchdog worker ready");
        announced = true;
      }
      if (
        process.env.WORKER_HEARTBEAT_URL &&
        at.getTime() - lastHeartbeat >= 60000
      ) {
        const r = await fetch(process.env.WORKER_HEARTBEAT_URL, {
          signal: AbortSignal.timeout(3000),
        });
        if (!r.ok) throw new Error("External heartbeat failed");
        lastHeartbeat = at.getTime();
      }
    } catch {
      console.error(
        "Worker cycle failed; check database connectivity and configuration",
      );
    }
    await new Promise((r) => setTimeout(r, 1000));
  }
  await closeDb();
}
main().catch(() => {
  console.error("Worker failed to start");
  process.exitCode = 1;
});
