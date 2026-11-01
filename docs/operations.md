# Operations and launch checklist

## Accounts and secrets

Production requires a Supabase project (PostgreSQL + Auth), verified application URL/redirects, a server database login, an encryption key, Resend API key and verified sender domain, and optionally per-customer Google service accounts. Supabase login emails also require a configured production SMTP sender; the local Mailpit transport is not production email delivery. No OpenAI/Claude key is required.

Use `.env.example` as the variable inventory. Store credentials in deployment secrets, never repository files or browser bundles. Only Supabase public URL/publishable key carry NEXT_PUBLIC prefixes. `SUPABASE_SERVICE_ROLE_KEY` and `ADMIN_DATABASE_URL` are operator-only; do not provide them to the web/worker deployment. Their runtime needs DATABASE_URL, the encryption key, email configuration, APP_URL and public Supabase configuration. Keep encryption keys stable and backed up separately; changing them without re-encrypting rows makes credentials unreadable. Current envelope is v1; key rotation requires an explicit migration, not overwriting the environment variable.

## Database and migrations

The private watchdog schema is outside the Supabase Data API. Drizzle schema declarations are under src/server/db/schema.ts. Generate SQL with drizzle-kit, review it, then place timestamped migrations under supabase/migrations; Supabase CLI is the sole local/production migration applier. The initial migration adds CREATE SCHEMA and security grants, which the generator omits. Do not run an independent Drizzle migrator against production.

Give a runtime login membership in watchdog_server, not postgres/service-role database privileges. It needs SELECT/INSERT/UPDATE/DELETE only on watchdog tables. Use a direct or session-capable PostgreSQL connection for the long-lived worker and transaction semantics. Local setup creates watchdog_local automatically. Migrations and provisioning run through separate operator/admin access. After a local `db:reset`, confirm the existing login still has role membership before restarting the app; do not regenerate the credential encryption key accidentally.

## Authentication

Disable public signup globally. Keep the email provider enabled: this CLI's auth.email.enable_signup flag also controls provider availability, so local config keeps it true while auth.enable_signup is false. Application login uses shouldCreateUser:false and provisioned owner mapping. Set the site URL and allowlist only the exact production `/auth/callback` URL. Verified Supabase identity and server workspace lookup are required on every data path. Never trust a browser getSession user object for authorization. The browser E2E proves invited login works and public signup fails.

Provision one owner with `pnpm provision-workspace email "Agency"`. Delete only after review using `pnpm delete-workspace WORKSPACE_ID --confirm`. Deletion removes workspace credentials and all dependent data/jobs, then deletes the auth identity. A failed auth cleanup exits nonzero and must be completed by an operator.

## Runtime

Run the built Next.js server and a continuously running worker as two supervised processes. Deploy the web/API on HTTPS, set APP_URL correctly, and configure the auth redirect allowlist. Place an appropriate reverse proxy in front; the development server is not a production host. Run `pnpm build` then `pnpm start`; run `pnpm worker` in the same configured deployment. The worker script currently reads `.env.local`; deployment can inject an equivalent secret file or invoke `pnpm exec tsx src/worker/index.ts` with environment variables instead. Use an init/supervisor that forwards SIGTERM and allows active bounded jobs to finish.

Deadline scans run every minute; alert timing is grace plus scan/queue delay, not an instant guarantee. Readback starts after 15 seconds. Email and verification calls are bounded. Jobs use PostgreSQL leases; crashes may cause retries. Stable provider idempotency keys reduce duplicates, but delivery is at-least-once. Retry acceptance is not inbox-delivery proof. Inspect failed/queued jobs in monitor details. Verification access failures must not be described as confirmed business failures.

Before pilots, independently monitor `/api/health` and the worker itself. The endpoint fails after two minutes without a worker heartbeat and exposes no tenant identifiers. Optionally set WORKER_HEARTBEAT_URL to an operator-owned external heartbeat URL; successful cycles ping it at most once a minute. An endpoint hosted beside the app is not independent failure detection. Avoid logging heartbeat URLs that contain secret tokens.

Global and per-token ingestion limits are always applied. Enable TRUSTED_PROXY=true only if a controlled proxy overwrites x-real-ip; never accept arbitrary forwarded headers from the internet. Set network/proxy request-timeout and body limits in addition to application limits. Startup should fail clearly for missing database/encryption/public auth settings; mail adapter failures remain visibly retrying/failed, never fake success.

## Retention and backups

Purge signal metadata, finished jobs and closed incident history after 30 days; retain minimal currently open incident state until closure. Remove old rate buckets and worker rows. Backups can contain deleted metadata and encrypted credentials: document provider backup retention and deletion timelines before onboarding a paying customer. Test restore and keep encryption keys separately. The first version has no business-output storage or raw cell archive.

## Paid pilot launch gates

- Full unit, PostgreSQL, browser, n8n-runtime, lint, typecheck and production-build checks pass.
- Migrations apply cleanly on a fresh Supabase database; runtime uses a least-privilege role.
- Authorized live sender test confirms failure/recovery notifications, and login email works on the deployed callback origin.
- Customer authorizes the target Sheet; test correct rows, wrong run ID, stale timestamp, missing cells and revoked access. Restore access and verify recovery.
- Publish the customer's UTC n8n schedule with production reporting, observe a real scheduled occurrence, and seed a controlled failure.
- Independently monitor the worker, review support limits and backups, and invoice manually.

Local automated checks use controlled fixtures/mocked external services. They do not establish live Google permissions, Resend deliverability or paid demand. No production deployment, domain purchase or outreach is authorized by this checklist alone.
