import {randomUUID} from 'node:crypto';
import {getDb,closeDb} from '../server/db';
import {sweepDeadlines} from '../server/deadlines';
import {processJobs} from '../server/process-jobs';
const id=randomUUID();let stopping=false;let lastSweep=0;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
async function main(){console.log('Watchdog worker started');while(!stopping){const at=new Date();try{if(at.getTime()-lastSweep>=60000){await sweepDeadlines(at);lastSweep=at.getTime();}await processJobs(id,at,undefined,()=>new Date());await getDb()`insert into watchdog.workers(id,last_seen) values(${id},${at}) on conflict(id) do update set last_seen=excluded.last_seen`;}catch{console.error('Worker cycle failed; check database connectivity and configuration');}await new Promise(r=>setTimeout(r,1000));}await closeDb();}
main().catch(()=>{console.error('Worker failed to start');process.exitCode=1;});
