import { isDeepStrictEqual } from "node:util";
import { randomBytes } from "node:crypto";
import { getDb, type MonitorRow } from "./db";
import { hashToken } from "./secrets";
import { monitorSchema } from "../domain/types";
import { validateSchedule, nextOccurrence } from "../domain/schedule";
import { ServiceError } from "./errors";
const validId = (id: string) => /^[a-f0-9-]{36}$/i.test(id);
function nameValue(name: string) {
  if (!name.trim() || name.trim().length > 100)
    throw new ServiceError(400, "Name must be 1–100 characters");
  return name.trim();
}
export async function createClient(workspaceId: string, name: string) {
  const [row] =
    await getDb()`insert into watchdog.clients(workspace_id,name) values(${workspaceId},${nameValue(name)}) returning id`;
  return row.id as string;
}
export async function createMonitor(
  workspaceId: string,
  clientId: string,
  name: string,
  raw: unknown,
) {
  const config = monitorSchema.parse(raw);
  config.version = 1;
  validateSchedule(config.schedule);
  const token = randomBytes(32).toString("base64url");
  return (await getDb().begin(async (tx) => {
    const [w] =
      await tx`select monitor_limit from watchdog.workspaces where id=${workspaceId} for update`;
    if (!w) throw new ServiceError(404, "Workspace not found");
    if (!validId(clientId)) throw new ServiceError(404, "Client not found");
    const [c] =
      await tx`select id from watchdog.clients where id=${clientId} and workspace_id=${workspaceId}`;
    if (!c) throw new ServiceError(404, "Client not found");
    const [count] =
      await tx`select count(*)::int as total from watchdog.monitors where workspace_id=${workspaceId}`;
    if (count.total >= w.monitor_limit)
      throw new ServiceError(409, "Pilot monitor limit reached");
    const [m] =
      await tx`insert into watchdog.monitors(workspace_id,client_id,name,config,token_hash) values(${workspaceId},${clientId},${nameValue(name)},${tx.json(config)},${hashToken(token)}) returning id`;
    return { id: m.id as string, token };
  })) as { id: string; token: string };
}
export async function scopedMonitor(workspaceId: string, id: string) {
  if (!validId(id)) throw new ServiceError(404, "Monitor not found");
  const [m] = await getDb()<
    MonitorRow[]
  >`select * from watchdog.monitors where id=${id} and workspace_id=${workspaceId}`;
  if (!m) throw new ServiceError(404, "Monitor not found");
  return m;
}
export async function rotateToken(workspaceId: string, id: string) {
  await scopedMonitor(workspaceId, id);
  const token = randomBytes(32).toString("base64url");
  await getDb()`update watchdog.monitors set token_hash=${hashToken(token)} where id=${id} and workspace_id=${workspaceId}`;
  return token;
}
export async function pauseMonitor(workspaceId: string, id: string) {
  await scopedMonitor(workspaceId, id);
  await getDb().begin(async (tx) => {
    await tx`select id from watchdog.monitors where id=${id} and workspace_id=${workspaceId} for update`;
    await tx`update watchdog.monitors set active=false,status='paused' where id=${id} and workspace_id=${workspaceId}`;
    await tx`update watchdog.incidents set status='paused',closed_at=now() where monitor_id=${id} and status='open'`;
    await tx`update watchdog.jobs set status='cancelled',lease_until=null where monitor_id=${id} and status in ('queued','running')`;
  });
}
export async function activateMonitor(
  workspaceId: string,
  id: string,
  at = new Date(),
) {
  const m = await scopedMonitor(workspaceId, id);
  if (m.active) return;
  const start = nextOccurrence(m.config.schedule, at);
  await getDb()`update watchdog.monitors set active=true,active_from=${start},status='awaiting',qualified_for=null,evidence=null where id=${id} and workspace_id=${workspaceId}`;
}
export async function updateMonitor(
  workspaceId: string,
  id: string,
  name: string,
  raw: unknown,
  at = new Date(),
) {
  await scopedMonitor(workspaceId, id);
  const config = monitorSchema.parse(raw);
  validateSchedule(config.schedule);
  await getDb().begin(async (tx) => {
    const [m] = await tx<
      MonitorRow[]
    >`select * from watchdog.monitors where id=${id} and workspace_id=${workspaceId} for update`;
    if (!m) throw new ServiceError(404, "Monitor not found");
    const current = monitorSchema.parse(m.config);
    config.version = current.version;
    if (nameValue(name) === m.name && isDeepStrictEqual(config, current))
      return;
    config.version = current.version + 1;
    await tx`update watchdog.monitors set name=${nameValue(name)},config=${tx.json(config)},active_from=${m.active ? nextOccurrence(config.schedule, at) : null},qualified_for=null,evidence=null,status=${m.active ? "awaiting" : "paused"} where id=${id} and workspace_id=${workspaceId}`;
    await tx`update watchdog.incidents set status='configuration-changed',closed_at=${at} where monitor_id=${id} and status='open'`;
    await tx`update watchdog.jobs set status='cancelled',lease_until=null where monitor_id=${id} and status in ('queued','running')`;
  });
}
