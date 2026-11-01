import {getDb} from './db';
import {ServiceError} from './errors';
export async function rateLimit(key:string,limit:number,at=new Date()){const bucket=new Date(Math.floor(at.getTime()/60000)*60000);const [row]=await getDb()`insert into watchdog.rate_buckets(key,bucket,count) values(${key},${bucket},1) on conflict(key,bucket) do update set count=watchdog.rate_buckets.count+1 returning count`;if(row.count>limit)throw new ServiceError(429,'Rate limit exceeded');}
