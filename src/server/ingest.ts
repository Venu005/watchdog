import {getDb,type MonitorRow} from './db';
import {hashToken} from './secrets';
import {signalSchema,evaluateSignal} from '../domain/evaluate';
import {monitorSchema} from '../domain/types';
import {applyEvaluation} from './incidents';
import {ServiceError} from './errors';
import {rateLimit} from './rate-limit';
function stable(value:unknown):string{if(value&&typeof value==='object'&&!Array.isArray(value))return '{'+Object.entries(value).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>JSON.stringify(k)+':'+stable(v)).join(',')+'}';return JSON.stringify(value);}
export async function ingestSignal(monitorId:string,token:string,raw:unknown,receivedAt=new Date()):Promise<{kind:string;eventId:string}>{
 if(!/^[a-f0-9-]{36}$/i.test(monitorId))throw new ServiceError(401,'Unauthorized');
 await rateLimit('ingest:global',2000,receivedAt);
 await rateLimit('ingest:token:'+hashToken(token),120,receivedAt);
 return await getDb().begin(async tx=>{
  const [m]=await tx<MonitorRow[]>`select * from watchdog.monitors where id=${monitorId} for update`;
  if(!m||!token||hashToken(token)!==m.token_hash)throw new ServiceError(401,'Unauthorized');
  m.config=monitorSchema.parse(m.config);
  const parsed=signalSchema.safeParse(raw);if(!parsed.success)throw new ServiceError(400,'Invalid signal envelope');const input=parsed.data;
  const fingerprint=hashToken(stable(input));
  const [old]=await tx`select kind,payload_hash from watchdog.signals where monitor_id=${m.id} and event_id=${input.event_id}`;
  if(old){if(old.payload_hash!==fingerprint)throw new ServiceError(409,'Conflicting event ID reuse');return {kind:old.kind,eventId:input.event_id};}
  if(!m.active&&!input.is_test)throw new ServiceError(409,'Monitor is paused');
  const result=evaluateSignal(m.config,input,receivedAt);
  if(result.kind==='reject')throw new ServiceError(409,result.reason??'Rejected result');
  if(!input.is_test&&m.active_from&&new Date(input.scheduled_for)<m.active_from)throw new ServiceError(409,'Monitor not active for occurrence');
  await tx`insert into watchdog.signals(monitor_id,event_id,version,payload_hash,scheduled_for,record_count,is_test,kind,evidence,reason,received_at) values(${m.id},${input.event_id},${m.config.version},${fingerprint},${new Date(input.scheduled_for)},${input.record_count},${input.is_test},${result.kind},${result.evidence??null},${result.reason??null},${receivedAt})`;
  await tx`update watchdog.monitors set last_signal_at=${receivedAt} where id=${m.id}`;
  await applyEvaluation(tx,m,result,receivedAt,new Date(input.scheduled_for));
  if(result.kind==='pending')await tx`insert into watchdog.jobs(monitor_id,version,kind,payload,dedupe_key,due_at) values(${m.id},${m.config.version},'verify',${tx.json({eventId:input.event_id,scheduledFor:input.scheduled_for})},${m.id+':verify:'+input.event_id},${new Date(receivedAt.getTime()+15000)}) on conflict(dedupe_key) do nothing`;
  return {kind:result.kind,eventId:input.event_id};
 }) as {kind:string;eventId:string};
}
