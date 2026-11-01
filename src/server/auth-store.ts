import {getDb} from './db';
export async function findWorkspaceForUser(id:string):Promise<{id:string}|null>{const [row]=await getDb()`select id from watchdog.workspaces where owner_id=${id}`;return row?{id:row.id}:null;}
