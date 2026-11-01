# Automation Watchdog

A pilot SaaS for agencies maintaining scheduled n8n automations. Watchdog checks whether an automation produced the expected business outcome, even when n8n reports a successful execution.

## What it does

- Invite-only email-link login and workspace-scoped access.
- Client directory with monitor counts, attention counts and monitor drilldown.
- Hourly, daily and weekday schedules in UTC, with a grace period.
- Completion webhooks with per-monitor bearer credentials and duplicate-event protection.
- Minimum record count and required-field checks.
- Optional independent, read-only Google Sheets verification.
- Incident history, failure emails and recovery emails.
- Synthetic tests that cannot alter live health or create customer alerts.
- Separate worker for deadlines, verification retries, durable email jobs and retention.

This is an assisted-onboarding pilot. Billing is manual. Automatic workflow discovery, exception-history ingestion, automatic repair and arbitrary business-output interpretation are outside the current scope. No AI provider keys are required.

## Stack and layout

Next.js 16, React 19, TypeScript, Supabase Auth/PostgreSQL, Drizzle schema tooling, Zod, Google Sheets read-only API and Resend. See `package.json` and the committed `pnpm-lock.yaml` for dependency versions.

| Path                  | Purpose                                                   |
| --------------------- | --------------------------------------------------------- |
| `src/app`             | UI, auth callbacks and HTTP routes                        |
| `src/components`      | Forms and shared UI                                       |
| `src/domain`          | Scheduling, envelope validation and rules                 |
| `src/server`          | Authorized data operations, transactions and durable jobs |
| `src/worker`          | Background processing entry point                         |
| `src/integrations`    | Generated n8n workflow                                    |
| `src/adapters`        | Email and destination verification                        |
| `supabase/migrations` | Database schema and permissions                           |
| `scripts`             | Local setup, provisioning and runtime acceptance          |
| `tests`               | Unit, isolated database and browser tests                 |
| `docs`                | Integration, operations and implementation notes          |

## Prerequisites

- Node.js 22+; development has been verified with Node 24.17.0.
- pnpm; use the version declared in `package.json` if one is present.
- Docker-compatible engine. This Mac uses Colima; Docker Desktop also works.
- A browser. Playwright Chromium is needed for browser/runtime acceptance tests.

For Colima, start the engine with `colima start`. Confirm it works with `docker info`.

## First-time local setup

Run from the repository root:

```sh
pnpm install
pnpm stack:start
pnpm setup:local
pnpm provision-workspace you@example.com "Your agency"
```

`stack:start` starts local Supabase and applies its migrations on initial database creation. `setup:local` generates `.env.local`, a server database login and an encryption key without printing credentials. It is a first-time command: **do not rerun it when `.env.local` already exists**. Keep the generated file and encryption key private and backed up securely.

Start the website:

```sh
pnpm dev
```

In another terminal, start the worker:

```sh
pnpm worker
```

| Service             | Local address                    |
| ------------------- | -------------------------------- |
| Watchdog            | http://127.0.0.1:3100            |
| Health              | http://127.0.0.1:3100/api/health |
| Mailpit inbox       | http://127.0.0.1:54324           |
| Supabase API        | http://127.0.0.1:54321           |
| Supabase PostgreSQL | 127.0.0.1:54322                  |
| Optional n8n        | http://localhost:5678            |

Sign in with the provisioned owner email. Retrieve the sign-in link in Mailpit. In local mode, login and alert emails are captured there rather than delivered externally.

The worker is mandatory. Health should return `{"ready":true,"worker":"healthy"}`. It returns HTTP 503 when the worker is absent or its heartbeat is too old. Stopping the worker stops deadline evaluation and job processing.

## Starting again tomorrow

Keep your existing `.env.local`, database volumes and n8n volume. Do not reprovision an existing workspace or rerun first-time setup.

```sh
colima start                 # Only when using Colima and it is stopped
pnpm stack:start
```

Start the website and worker in separate terminals as above. If you previously created the optional n8n container:

```sh
docker start watchdog-n8n
```

Before activating a monitor, check that its n8n workflow is ready and its next expected occurrence is correct. An active monitor with an unpublished workflow will eventually create a missed-run incident.

## Optional persistent local n8n

The integration has been runtime-tested with n8n 2.45.7. Create this container once:

```sh
docker volume create watchdog_n8n_data

docker run -d \
  --name watchdog-n8n \
  --restart unless-stopped \
  -p 127.0.0.1:5678:5678 \
  -e TZ=UTC \
  -e GENERIC_TIMEZONE=UTC \
  -e N8N_ENFORCE_SETTINGS_FILE_PERMISSIONS=true \
  -e N8N_DIAGNOSTICS_ENABLED=false \
  -v watchdog_n8n_data:/home/node/.n8n \
  docker.n8n.io/n8nio/n8n:2.45.7
```

Open http://localhost:5678 and create your local owner account. Workflows and encrypted credentials persist in the named volume. Later, use `docker start watchdog-n8n`; do not repeat `docker run` with the same container name. Inspect problems with `docker logs --tail 50 watchdog-n8n`.

### Docker-to-Watchdog networking

The default `pnpm dev` binds to loopback. To let n8n inside Docker reach it, stop that web process and use:

```sh
pnpm exec next dev --hostname 0.0.0.0 --port 3100
```

Use `http://host.docker.internal:3100/api/ingest/MONITOR_UUID` in n8n's reporting node. Keep visiting Watchdog at `http://127.0.0.1:3100` in your browser. Some Colima configurations use `host.lima.internal` instead. Binding to `0.0.0.0` can expose the development server on your local network; use it only on a trusted development network.

## Connect and test a monitor

1. Create a client, then a monitor. Use minimum count `1` and required field `id` for the demo.
2. Choose an hourly UTC minute several minutes ahead and a one-minute grace period. Hourly schedules ignore the hour field. Minute `7` means every hour at `:07`, not every seven minutes. Check UTC with `date -u '+%H:%M UTC'`.
3. Save rules, then download the monitor-specific JSON. Copy the one-time token to a password manager or n8n credential.
4. Import the JSON into n8n. Keep the generated node names and captured metadata.
5. In Report to Watchdog, select Generic Credential Type → Header Auth. Set header name `Authorization` and value `Bearer YOUR_TOKEN`. The URL contains the monitor UUID, never the token.
6. Correct the Docker hostname as described above. Leave the generated JSON request body unchanged.
7. Set Business action to `return [{json:{records:[{id:"demo-lead"}]}}];`. Keep `is_test:true` in Capture run and execute the entire workflow. Expect a passing synthetic result in Watchdog; live health remains unchanged.
8. For a deliberate missing-field failure, return `return [{json:{records:[{}]}}];`. Change Capture run to `is_test:false`, publish the workflow, and activate the monitor before its next expected occurrence.
9. After the scheduled run, expect an output-validation incident even though n8n succeeded. Inspect the monitor, overview, client attention count and Mailpit.
10. Restore the valid record and execute the repaired workflow in the current eligible occurrence to observe recovery. When replaying a specific failed execution, preserve its original captured identity and schedule metadata.

Activation begins with the next scheduled occurrence. A production result for an earlier occurrence cannot qualify. Synthetic tests do not satisfy production deadlines. For an empty outcome, keep one `{records:[]}` envelope: a zero-item n8n branch may never execute downstream reporting.

Changing rules increments the configuration version and invalidates the old template. Download the new workflow after real edits. Unchanged rule saves now preserve the version and incident state. Do not guess a version number.

### Troubleshooting

| Symptom                                   | Check                                                                                                                    |
| ----------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| Connection refused or timeout             | App running, Docker hostname correct, server bound to `0.0.0.0`                                                          |
| HTTP 401                                  | Correct monitor URL and Header Auth credential; old rotated tokens stop working                                          |
| HTTP 409 `stale-configuration`            | Template version must match the monitor's current version; download after saving real edits and rerun the whole workflow |
| HTTP 409 paused/not active for occurrence | Keep exploratory runs synthetic; activate before the next expected occurrence                                            |
| HTTP 409 conflicting event ID             | Do not reuse an event identity with a different payload                                                                  |
| No live incident from a synthetic test    | Expected: inspect the synthetic result instead                                                                           |
| No missed-run alert immediately           | Wait until grace expires and the next worker sweep, approximately one minute                                             |
| No emails in external inbox               | Local mode sends only to Mailpit                                                                                         |
| Port already in use                       | Stop the existing process; inspect with `lsof -nP -iTCP:3100 -sTCP:LISTEN`                                               |

Hard n8n crashes, failed reporting authentication and unpublished workflows are detected as missing valid completion after grace. v1 does not retrieve n8n stack traces. See [n8n integration details](docs/n8n-setup.md).

## Environment and production configuration

`.env.example` lists configuration names without real credentials. `.env.local` is ignored. Local setup supplies Supabase keys, database URLs, application URL, credential encryption key and Mailpit configuration.

Production additionally needs a real Supabase project, applied migrations/private server role, secure application hosting, a continuously running worker, production callback URLs, HTTPS, and Resend `RESEND_API_KEY`/`EMAIL_FROM`. Local email transport is disabled in production. Never reuse local demo credentials in production. Preserve the encryption key across restarts or encrypted Google credentials cannot be decrypted.

For Google Sheets, provide a customer-created service account with viewer access to only the target Sheet, then run `pnpm configure-google WORKSPACE_ID /secure/path/service-account.json`. Never commit or paste the credential file. The current supported destination is append-only Sheets with at most 5,000 allocated rows, columns A–Z, a run-ID column, UTC timestamps and configured expected row counts. Google cell values are not persisted. See [operations](docs/operations.md) for lifecycle and provider details.

## Tests and checks

```sh
pnpm test
pnpm typecheck
pnpm lint
pnpm format:check
pnpm build
```

Integration tests need an isolated test PostgreSQL database, never production:

```sh
docker run -d --name automation-watchdog-test-db \
  -p 127.0.0.1:55542:5432 \
  -e POSTGRES_PASSWORD=watchdog-local-test \
  -e POSTGRES_DB=watchdog_test postgres:18-alpine

psql postgres://postgres:watchdog-local-test@127.0.0.1:55542/watchdog_test \
  -v ON_ERROR_STOP=1 -f supabase/migrations/20261101000000_initial.sql

pnpm test:integration
```

If that container already exists, use `docker start automation-watchdog-test-db` rather than creating it again. The password above is only a disposable local test default.

Browser and runtime acceptance require local Supabase, `.env.local`, local email capture and Playwright Chromium (`pnpm exec playwright install chromium`).

```sh
pnpm test:e2e
pnpm test:n8n
pnpm test:workflows
```

- Browser tests cover invited login, session refresh, navigation, clients, monitor creation, synthetic isolation, incident/recovery and sign-out.
- `test:n8n` is a quick runtime smoke test using manual triggers.
- `test:workflows` publishes actual schedules in an isolated pinned n8n container. It covers empty output, missing fields, code exception, actual HTTP 503, bad reporting token, disabled workflow and healthy control. It waits through real grace deadlines, repairs six workflows and manually executes their recovery. Allow about 4–6 minutes.
- Runtime tests require the app/worker running and port 3101 free. They create/remove disposable workspaces, auth users, containers and fixture credentials. Their temporary server binds to `0.0.0.0`; use a trusted development machine.
- Screenshots/logs are under ignored `test-results/` and `.superpowers/`. External email delivery and real Google Sheets acceptance require separate verification.

Latest verified regression: 58 unit tests and 34 database tests, plus browser/runtime acceptance from the navigation/workflow QA pass. These are recorded results, not a production reliability guarantee.

## Stop everything safely

Stop the web and worker terminal commands with Ctrl+C first. Then:

```sh
docker stop watchdog-n8n                  # If created/running
pnpm stack:stop                          # Preserves local Supabase data by default
docker stop automation-watchdog-test-db  # If running
colima stop                              # When using Colima
```

Before a long intentional outage, pause demo monitors in Watchdog. Otherwise an active monitor can be evaluated as missed when processing resumes. Stopping Docker alone does not change monitor configuration.

Stopping containers or Colima does not remove their volumes. Avoid `docker compose down -v`, `docker volume prune`, `pnpm db:reset` or deleting `.env.local` unless you intentionally want to reset data or credentials. `db:reset` is destructive.

## Preparing your own GitHub remote

The repository is already a local Git repository. You can create/connect your GitHub repository yourself. Before the first push:

```sh
git status --short
git ls-files .env.local
git check-ignore .env.local
```

The tracked-file command should print nothing for `.env.local`; the ignore check should identify it as ignored. Keep `.env.example`, `pnpm-lock.yaml`, source code and migrations committed. Review staged changes before pushing.

`.gitignore` excludes environment files, build output, dependencies, local logs/data, test traces, OS metadata and local workflow exports under `docs/watchdog-workflow*.json`. Workflow exports may contain connection details or embedded credentials: sanitize examples deliberately before sharing. An ignore rule does not remove secrets already tracked in Git history; rotate any credential that was previously published.

## Data and scope

Workspace ownership is checked server-side. The private `watchdog` database schema is not exposed through Supabase's browser Data API. Tokens are hashed; destination credentials are encrypted server-side. Durable jobs use leases and unique transition keys, with at-least-once delivery. Metadata retention is 30 days, while minimal unresolved incident state remains until closure.

Default pilot allowance is three monitors per workspace. Pricing and acquisition are still validation work. No automatic GitHub connection, deployment, paid account creation or prospect outreach is included.
