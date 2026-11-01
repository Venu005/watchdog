import {randomUUID} from 'node:crypto';
import {getDb,closeDb} from '../server/db';
import {sweepDeadlines} from '../server/deadlines';
const id=randomUUID();let stopping=false;
process.on('SIGTERM',()=>{stopping=true;});process.on('SIGINT',()=>{stopping=true;});
async function main(){console.log('Watchdog worker started');while(!stopping){const at=new Date();try{await sweepDeadlines(at);await getDb()`insert into watchdog.workers(id,last_seen) values(${id},${at}) on conflict(id) do update set last_seen=excluded.last_seen`;}catch{console.error('Worker cycle failed; check database connectivity and configuration');}await new Promise(r=>setTimeout(r,1000));}await closeDb();}
main().catch(()=>{console.error('Worker failed to start');process.exitCode=1;});
