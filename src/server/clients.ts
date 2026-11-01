import { getDb } from "./db";
import { ServiceError } from "./errors";
export type ClientSummary = {
  id: string;
  name: string;
  monitor_count: number;
  failing_count: number;
};
export type ClientMonitor = {
  id: string;
  name: string;
  status: string;
  evidence: string | null;
  last_signal_at: Date | null;
};
export async function listClients(workspaceId: string) {
  return await getDb()<
    ClientSummary[]
  >`select c.id,c.name,count(m.id)::int as monitor_count,count(m.id) filter(where m.status='failing')::int as failing_count from watchdog.clients c left join watchdog.monitors m on m.client_id=c.id and m.workspace_id=c.workspace_id where c.workspace_id=${workspaceId} group by c.id,c.name order by lower(c.name),c.id`;
}
export async function scopedClient(workspaceId: string, id: string) {
  if (
    !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(id)
  )
    throw new ServiceError(404, "Client not found");
  const [c] = await getDb()<
    { id: string; name: string }[]
  >`select id,name from watchdog.clients where id=${id} and workspace_id=${workspaceId}`;
  if (!c) throw new ServiceError(404, "Client not found");
  return c;
}
export async function clientMonitors(workspaceId: string, id: string) {
  await scopedClient(workspaceId, id);
  return await getDb()<
    ClientMonitor[]
  >`select id,name,status,evidence,last_signal_at from watchdog.monitors where workspace_id=${workspaceId} and client_id=${id} order by created_at desc`;
}
