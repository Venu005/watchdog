import { getDb, type MonitorRow } from "./db";
import { latestOccurrence, getWindow } from "../domain/schedule";
import { monitorSchema } from "../domain/types";
import { applyEvaluation } from "./incidents";
export async function sweepDeadlines(at = new Date()) {
  const list =
    await getDb()`select id from watchdog.monitors where active=true`;
  for (const item of list)
    await getDb().begin(async (tx) => {
      const [m] = await tx<
        MonitorRow[]
      >`select * from watchdog.monitors where id=${item.id} for update`;
      if (!m?.active || !m.active_from) return;
      m.config = monitorSchema.parse(m.config);
      const occurrence = latestOccurrence(m.config.schedule, at);
      const window = getWindow(m.config.schedule, occurrence);
      if (
        occurrence < m.active_from ||
        window.deadline > at ||
        m.qualified_for?.getTime() === occurrence.getTime()
      )
        return;
      // A deadline is a fallback: preserve the more specific failure of this occurrence.
      const [specific] =
        await tx`select id from watchdog.signals where monitor_id=${m.id} and version=${m.config.version} and scheduled_for=${occurrence} and is_test=false and kind='fail' limit 1`;
      if (specific) return;
      await applyEvaluation(tx, m, { kind: "fail", reason: "missed-run" }, at);
    });
}
