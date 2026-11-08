import { execFileSync } from "node:child_process";
import { writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import postgres from "postgres";
import {
  environmentForContainerRuntime,
  selectContainerRuntime,
} from "./container-runtime.mjs";

const runtime = await selectContainerRuntime();
const status = JSON.parse(
  execFileSync("pnpm", ["exec", "supabase", "status", "-o", "json"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      ...environmentForContainerRuntime(runtime),
    },
  }),
);
const db = postgres(status.DB_URL);
const password = randomBytes(24).toString("hex");
try {
  await db`do $$ begin if not exists(select from pg_roles where rolname='watchdog_local') then create role watchdog_local login inherit; end if; end $$`;
  await db.unsafe("alter role watchdog_local password '" + password + "'");
  await db`grant watchdog_server to watchdog_local`;
  const url = new URL(status.DB_URL);
  url.username = "watchdog_local";
  url.password = password;
  const values = {
    NEXT_PUBLIC_SUPABASE_URL: status.API_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      status.PUBLISHABLE_KEY ?? status.ANON_KEY,
    SUPABASE_SERVICE_ROLE_KEY: status.SERVICE_ROLE_KEY,
    DATABASE_URL: url.toString(),
    ADMIN_DATABASE_URL: status.DB_URL,
    APP_URL: "http://127.0.0.1:3100",
    LOG_LEVEL: "debug,info,warn,error,fatal",
    CREDENTIAL_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    EMAIL_TRANSPORT: "local",
    LOCAL_MAIL_URL: status.MAILPIT_URL ?? status.INBUCKET_URL,
  };
  writeFileSync(
    ".env.local",
    Object.entries(values)
      .map(([k, v]) => `${k}=${v}`)
      .join("\n") + "\n",
    { mode: 0o600, flag: "wx" },
  );
  console.log("Local configuration written without printing credentials.");
} finally {
  await db.end();
}
