import { getDb } from "./db";
export async function purgeData(at = new Date()) {
  const cutoff = new Date(at.getTime() - 30 * 86400000);
  await getDb().begin(async (tx) => {
    await tx`delete from watchdog.signals where received_at<${cutoff}`;
    await tx`delete from watchdog.jobs where created_at<${cutoff} and status in ('completed','failed','cancelled')`;
    await tx`delete from watchdog.incidents where closed_at<${cutoff} and status<>'open'`;
    await tx`delete from watchdog.rate_buckets where bucket<${new Date(at.getTime() - 86400000)}`;
    await tx`delete from watchdog.workers where last_seen<${cutoff}`;
  });
}
export async function deleteWorkspace(id: string) {
  const [w] =
    await getDb()`delete from watchdog.workspaces where id=${id} returning owner_id`;
  return (w?.owner_id as string | undefined) ?? null;
}
export async function readiness(at = new Date()) {
  try {
    const [row] =
      await getDb()`select max(last_seen) as latest from watchdog.workers`;
    if (!row.latest) return { ready: false, worker: "missing" };
    const fresh = at.getTime() - new Date(row.latest).getTime() <= 120000;
    return { ready: fresh, worker: fresh ? "healthy" : "stale" };
  } catch {
    return { ready: false, worker: "unavailable" };
  }
}
