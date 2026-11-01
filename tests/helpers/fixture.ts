import {randomUUID} from 'node:crypto';
import {getDb} from '../../src/server/db';
import {hashToken} from '../../src/server/secrets';
process.env.DATABASE_URL=process.env.TEST_DATABASE_URL??'postgres://postgres:watchdog-local-test@127.0.0.1:55542/watchdog_test';
export const config={version:1,schedule:{kind:'daily' as const,hour:9,minute:0,graceMinutes:10},requiredFields:['lead_id'],minimumCount:1};
export const signal={event_id:'run-one',config_version:1,scheduled_for:'2026-11-02T09:00:00Z',record_count:1,fields:{lead_id:true},is_test:false};
export async function fixture(){const db=getDb();const ws=randomUUID(),client=randomUUID(),monitor=randomUUID(),token=randomUUID();await db`insert into watchdog.workspaces(id,owner_id,owner_email,name) values(${ws},${randomUUID()},'test@example.test','integration-test')`;await db`insert into watchdog.clients(id,workspace_id,name) values(${client},${ws},'Demo client')`;await db`insert into watchdog.monitors(id,workspace_id,client_id,name,config,token_hash,active,active_from,status) values(${monitor},${ws},${client},'Daily leads',${db.json(config)},${hashToken(token)},true,'2026-11-02T09:00:00Z','awaiting')`;return {db,ws,client,monitor,token,async cleanup(){await db`delete from watchdog.workspaces where id=${ws}`;}};}
