import {it,expect,afterAll} from 'vitest';
import postgres from 'postgres';
const db=postgres(process.env.TEST_DATABASE_URL??'postgres://postgres:watchdog-local-test@127.0.0.1:55542/watchdog_test');
afterAll(()=>db.end());
it('provides private workspace storage outside the public Data API schema',async()=>{const rows=await db`select table_schema from information_schema.tables where table_name='workspaces' and table_schema='watchdog'`;expect(rows).toHaveLength(1);});
it('enforces one open incident per monitor in PostgreSQL',async()=>{const rows=await db`select indexdef from pg_indexes where schemaname='watchdog' and indexname='one_open_incident'`;expect(rows[0]?.indexdef).toContain('UNIQUE');expect(rows[0]?.indexdef).toContain('WHERE');});
