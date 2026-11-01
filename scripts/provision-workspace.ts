import {createClient} from '@supabase/supabase-js';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
const email=process.argv[2],name=process.argv[3];
if(!email||!name||!email.includes('@'))throw new Error('Usage: pnpm provision-workspace owner@email.test "Agency name"');
const auth=createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!,process.env.SUPABASE_SERVICE_ROLE_KEY!,{auth:{persistSession:false}});
const db=postgres(process.env.ADMIN_DATABASE_URL!);
try{const {data,error}=await auth.auth.admin.createUser({email,email_confirm:true});if(error)throw new Error('Auth provisioning failed; check whether owner already exists');const id=randomUUID();await db`insert into watchdog.workspaces(id,owner_id,owner_email,name) values(${id},${data.user.id},${email.toLowerCase()},${name})`;console.log('Workspace provisioned:',id);}finally{await db.end();}
