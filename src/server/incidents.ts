import type {Tx,MonitorRow} from './db';
import type {Evaluation} from '../domain/types';
export async function applyEvaluation(tx:Tx,m:MonitorRow,result:Evaluation,at:Date,scheduledFor?:Date){
 if(result.kind==='fail'){
  await tx`update watchdog.monitors set status='failing',evidence=${result.evidence??null} where id=${m.id}`;
  const [existing]=await tx`select id from watchdog.incidents where monitor_id=${m.id} and status='open'`;
  if(existing){await tx`update watchdog.incidents set reason=${result.reason??'output-validation'},evidence=${result.evidence??null} where id=${existing.id}`;return;}
  await tx`update watchdog.jobs set status='cancelled' where monitor_id=${m.id} and kind='email' and payload->>'transition'='recovery' and status in ('queued','running')`;
  const [incident]=await tx`insert into watchdog.incidents(monitor_id,version,reason,evidence,opened_at) values(${m.id},${m.config.version},${result.reason??'output-validation'},${result.evidence??null},${at}) returning id`;
  await tx`insert into watchdog.jobs(monitor_id,version,kind,payload,dedupe_key,due_at) values(${m.id},${m.config.version},'email',${tx.json({incidentId:incident.id,transition:'failure',reason:result.reason??'output-validation',evidence:result.evidence??'workflow-reported'})},${incident.id+':failure'},${at}) on conflict(dedupe_key) do nothing`;
 }else if(result.kind==='pass'){
  await tx`update watchdog.monitors set status='healthy',evidence=${result.evidence??'workflow-reported'},qualified_for=${scheduledFor??null} where id=${m.id}`;
  const [incident]=await tx`update watchdog.incidents set status='resolved',closed_at=${at} where monitor_id=${m.id} and status='open' returning id,reason`;
  if(incident)await tx`insert into watchdog.jobs(monitor_id,version,kind,payload,dedupe_key,due_at) values(${m.id},${m.config.version},'email',${tx.json({incidentId:incident.id,transition:'recovery',reason:incident.reason,evidence:result.evidence??'workflow-reported'})},${incident.id+':recovery'},${at}) on conflict(dedupe_key) do nothing`;
 }else if(result.kind==='pending')await tx`update watchdog.monitors set evidence='pending-verification' where id=${m.id}`;
}
