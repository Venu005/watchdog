import {it,expect,afterAll} from 'vitest';
import postgres from 'postgres';
import {randomUUID} from 'node:crypto';
import {findWorkspaceForUser} from '../../src/server/auth-store';
const url=process.env.TEST_DATABASE_URL??'postgres://postgres:watchdog-local-test@127.0.0.1:55542/watchdog_test';
process.env.DATABASE_URL=url;
const admin=postgres(url);
afterAll(async()=>{await admin`delete from watchdog.workspaces where name='auth-test'`;await admin.end();});
it('does not return another owners provisioned workspace',async()=>{const owner=randomUUID();const [w]=await admin`insert into watchdog.workspaces(owner_id,owner_email,name) values(${owner},'test@example.test','auth-test') returning id`;expect(await findWorkspaceForUser(owner)).toEqual({id:w.id});expect(await findWorkspaceForUser(randomUUID())).toBeNull();});
