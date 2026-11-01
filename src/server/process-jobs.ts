import {getDb,type MonitorRow} from './db';
import {claimJobs,finishJob,retryJob,type Job} from './jobs';
import {getWindow} from '../domain/schedule';
import {applyEvaluation} from './incidents';
import {decryptSecret} from './secrets';
import {verifySheet,type VerificationResult} from '../adapters/sheets';
import {sendIncidentEmail,type IncidentEmail} from '../adapters/email';
export type Adapters={verify:(monitor:MonitorRow,eventId:string,start:Date,end:Date)=>Promise<VerificationResult>;send:(message:IncidentEmail)=>Promise<{id:string}>};
const production:Adapters={async verify(m,eventId,start,end){const [w]=await getDb()`select credentials from watchdog.workspaces where id=${m.workspace_id}`;if(!w?.credentials||!m.config.sheet)return {kind:'error',reason:'credentials-missing'};try{return await verifySheet(m.config.sheet,eventId,start,end,JSON.parse(decryptSecret(w.credentials,process.env.CREDENTIAL_ENCRYPTION_KEY??'')));}catch{return {kind:'error',reason:'credentials-unavailable'};}},send:sendIncidentEmail};
async function cancel(job:Job){await getDb()`update watchdog.jobs set status='cancelled',lease_until=null where id=${job.id} and lease_token=${job.lease_token} and status='running'`;}
export async function processJobs(workerId:string,at=new Date(),adapters:Adapters=production,clock:()=>Date=()=>at){const jobs=await claimJobs(workerId,at,5);for(const job of jobs){try{if(job.kind==='verify'){
 const [snapshot]=await getDb()<MonitorRow[]>`select * from watchdog.monitors where id=${job.monitor_id}`;
 if(!snapshot?.active||snapshot.config.version!==job.version){await cancel(job);continue;}
 const window=getWindow(snapshot.config.schedule,new Date(job.payload.scheduledFor!));
 if(at>=window.end){await cancel(job);continue;}
 const result=await adapters.verify(snapshot,job.payload.eventId!,window.start,window.end);const completedAt=clock();
 await getDb().begin(async tx=>{const [m]=await tx<MonitorRow[]>`select * from watchdog.monitors where id=${job.monitor_id} for update`;const [current]=await tx`select status,lease_token from watchdog.jobs where id=${job.id} for update`;if(!m?.active||m.config.version!==job.version||completedAt>=window.end||current?.status!=='running'||current.lease_token!==job.lease_token){if(current?.lease_token===job.lease_token)await tx`update watchdog.jobs set status='cancelled' where id=${job.id}`;return;}
 if(result.kind==='pass'){await applyEvaluation(tx,m,{kind:'pass',evidence:'destination-verified'},completedAt,window.start);await tx`update watchdog.signals set kind='pass',evidence='destination-verified',reason=null where monitor_id=${m.id} and event_id=${job.payload.eventId!}`;await tx`update watchdog.jobs set status='completed',lease_until=null where id=${job.id}`;}
 else if(job.attempts<3){const delay=job.attempts===1?45000:120000;await tx`update watchdog.jobs set status='queued',lease_until=null,error=${result.reason??'verification-unavailable'},due_at=${new Date(at.getTime()+delay)} where id=${job.id}`;}
 else{await applyEvaluation(tx,m,{kind:'fail',reason:result.kind==='error'?'verification-error':'destination-mismatch',evidence:'pending-verification'},completedAt);await tx`update watchdog.signals set kind='fail',reason=${result.kind==='error'?'verification-error':'destination-mismatch'} where monitor_id=${m.id} and event_id=${job.payload.eventId!}`;await tx`update watchdog.jobs set status='failed',lease_until=null,error=${result.reason??'verification-unavailable'} where id=${job.id}`;}
 });
 }else{
 // Lock the monitor during the bounded send so pause/edits cannot race an unsent message.
 await getDb().begin(async tx=>{const [m]=await tx<MonitorRow[]>`select * from watchdog.monitors where id=${job.monitor_id} for update`;const [j]=await tx`select * from watchdog.jobs where id=${job.id} for update`;if(!j||j.status!=='running'||j.lease_token!==job.lease_token)return;if(!m?.active||m.config.version!==job.version){await tx`update watchdog.jobs set status='cancelled' where id=${job.id}`;return;}const [prior]=await tx`select id from watchdog.jobs where monitor_id=${m.id} and kind='email' and created_at<${j.created_at} and status in ('queued','running')`;if(prior){await tx`update watchdog.jobs set status='queued',lease_until=null,due_at=${new Date(at.getTime()+5000)},attempts=greatest(attempts-1,0) where id=${job.id}`;return;}if(job.payload.transition==='recovery'&&m.status!=='healthy'){await tx`update watchdog.jobs set status='cancelled' where id=${job.id}`;return;}const [w]=await tx`select owner_email from watchdog.workspaces where id=${m.workspace_id}`;const receipt=await adapters.send({id:job.id,recipient:w.owner_email,monitorId:m.id,name:m.name,transition:job.payload.transition!,reason:job.payload.reason!,evidence:job.payload.evidence!});await tx`update watchdog.jobs set status='completed',lease_until=null,provider_id=${receipt.id},error=null where id=${job.id}`;});
 }
 }catch{await retryJob(job,job.kind==='email'?'email-unavailable':'verification-unavailable',at,Math.min(300000,15000*2**job.attempts));}}
}
