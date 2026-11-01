# Automation Watchdog

First paid-pilot product for agencies maintaining n8n automations. Detect missed scheduled runs, invalid result metadata and missing Google Sheets rows. Assisted onboarding, invite-only email-link login, client workspaces, incident history, and failure/recovery email.

## Run locally

Requires Node.js 22+, pnpm, and a running Docker-compatible engine. This repository uses Node 24.17.0. Run from the repository directory.

```sh
pnpm install
pnpm stack:start
pnpm setup:local
pnpm provision-workspace you@example.com "Your agency"
pnpm dev
```

In a second terminal run `pnpm worker`. Open http://127.0.0.1:3100 and sign in using the provisioned email. Open http://127.0.0.1:54324 to read the local sign-in link. Local auth and alerts stay in Mailpit; they are not sent to external inboxes. `setup:local` writes `.env.local` with restrictive permissions, refuses to overwrite it, creates a least-privilege local login, and does not print credentials. Never reuse local Supabase demo keys in production.

The worker is mandatory. It checks deadlines every minute and processes durable jobs independently of browser visits. `/api/health` returns 503 when no worker is reporting or its heartbeat is older than two minutes.

Create a client and monitor, save the one-time token in n8n Header Auth, send a synthetic test, then activate. See [n8n setup](docs/n8n-setup.md) and [operations](docs/operations.md). Download the monitor-specific importable workflow from its detail page. Activation starts with the next schedule occurrence; a real result cannot qualify before that occurrence.

## Verification

```sh
pnpm test
pnpm test:integration
pnpm test:e2e
pnpm test:n8n
pnpm typecheck
pnpm lint
pnpm build
```

Unit tests need no accounts. Database integration tests use a disposable PostgreSQL database, never production. Start the test database:

```sh
docker run -d --name automation-watchdog-test-db \
  -p 127.0.0.1:55542:5432 \
  -e POSTGRES_PASSWORD=watchdog-local-test \
  -e POSTGRES_DB=watchdog_test postgres:18-alpine
```

Apply the migration only to this test database with `psql`, then run the integration suite:

```sh
psql postgres://postgres:watchdog-local-test@127.0.0.1:55542/watchdog_test \
  -v ON_ERROR_STOP=1 -f supabase/migrations/20261101000000_initial.sql
pnpm test:integration
```

E2E tests require the running local Supabase stack and `.env.local`. They create and remove their own invited owners and workspaces, use actual email-link authentication, and capture screenshots under ignored `test-results/`. n8n runtime tests use a pinned n8n 2.45.7 Docker image with temporary credentials/workspaces. They temporarily bind an application test server on port 3101 for Docker-to-host access; run only on a trusted development machine. Set `WATCHDOG_DOCKER_HOST=host.lima.internal` if your Docker engine does not resolve `host.docker.internal`. They verify the actual Header Auth and HTTP nodes, zero-result reporting, production recovery, duplicate replay and synthetic isolation. Real Google/Resend acceptance still requires authorized production credentials and separate launch checks.

## Architecture

Next.js / React / TypeScript; Supabase Auth and its PostgreSQL database; Drizzle schema generation; Zod input validation; separate Node worker; Google Sheets read-only API; Resend email. One repository, two processes. No AI provider keys or Redis required.

`src/domain` contains deterministic scheduling/rules. `src/server` contains workspace-authorized data operations, transactions, incidents and durable jobs. `src/adapters` holds external services. Authenticated UI lives in `src/app/(dashboard)`.

The Supabase Data API does not expose the private `watchdog` schema. Browser code has no database credentials. Jobs have leases and unique transition keys; delivery is at-least-once. Signal fields and Google cell values are never persisted. Metadata retention is 30 days; minimal unresolved incident state persists until closure.

## Current scope

Schedules are UTC hourly/daily/weekdays presets. Three monitors per pilot workspace by default. Sheets are append-only, at most 5,000 rows and columns A–Z, with a run-ID column, UTC timestamp column and exact expected row count. Google credentials are installed server-side and encrypted. Reporting is not automatic workflow discovery, arbitrary output understanding or automatic repair. Pricing is an unvalidated $299 setup + $79/month experiment; billing is manual.

No deployment, paid account provisioning, domain purchase or prospect outreach has been performed.
