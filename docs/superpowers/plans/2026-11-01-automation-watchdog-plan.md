# Automation Watchdog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver a locally runnable, tested first paid-pilot product for monitoring scheduled n8n outcomes, with assisted onboarding, a customer dashboard, and independently verified Google Sheets results.

**Architecture:** One Next.js TypeScript application and a separate worker use PostgreSQL for monitor state, event deduplication, incidents, and a transactional job outbox. Supabase supplies email-link authentication. Production adapters use Resend and read-only Google Sheets; local tests replace those external services without presenting fixtures as live evidence.

**Tech Stack:** TypeScript, Next.js App Router, React, PostgreSQL, Drizzle migrations, Zod, Supabase Auth, Resend, Google APIs, Vitest, Playwright, pnpm. Resolve supported package versions against official documentation during implementation and commit the lockfile. Local Supabase CLI stack requires a working Docker runtime.

Use the PostgreSQL database supplied by the same Supabase project, rather than operating a second production database. Drizzle declares the schema and generates reviewed SQL; Supabase migration tooling is the sole applier in local and production environments. Keep application tables in a private schema not exposed by the Supabase Data API, with a least-privilege server database role. Use one repository and two processes (web and worker), without Redis or a microservice fleet. The local Supabase mail viewer captures development auth and alert messages; there is no external account requirement for the test environment.

**Spec:** `docs/superpowers/specs/2026-11-01-automation-watchdog-design.md`.

**Repository:** `/Users/venusai/Desktop/work/self-projects-side/automation-watchdog`.

## Global Constraints

- $299 setup plus $79/month for three defined monitored outcomes; invoice pilots manually.
- No OpenAI or Claude key is required.
- Each monitor has its own webhook URL and secret token; show the token only on creation or rotation, then store only its hash.
- Initial presets: hourly, daily, and weekdays at a selected UTC time; display UTC explicitly.
- One owner per workspace; invite-only; enforce server-side workspace authorization on all reads and writes.
- Maximum ingestion body is 16 KB; reject unauthorized or malformed requests without making a monitor healthy.
- `event_id` is the Google Sheets correlation ID; `scheduled_for` names the UTC schedule occurrence.
- The versioned signal envelope also requires `config_version` and accepts `is_test` (boolean, default false). Stale versions are rejected without health changes. Updated setup examples must be copied after schedule/rule edits; token rotation alone does not change rule version.
- Window is [D, next occurrence); grace must be shorter than the minimum occurrence interval; initial default grace ten minutes.
- One open incident per monitor; transactional notification enqueue; at-least-once email delivery with visible failures.
- Google readback retries at approximately 15, 60, and 180 seconds; exact row count default one; maximum 5,000 rows per tab.
- Retain signal metadata and incidents for 30 days; never persist full business payloads or Sheet cell content.
- Production Google credentials are encrypted per workspace using a deployment-supplied key.
- No automatic repair, AI analysis, other destination integrations, public signup funnel, automatic billing, or public deployment in this phase.

## Review Focus

1. Concurrent receipt, deadline, retry, and recovery jobs must not create duplicate incidents or transition notifications — Task 3 database race tests.
2. Delayed jobs and edited configurations must not let old verification results make a changed monitor healthy — Tasks 2–4 versioning tests.
3. Reused event IDs with changed content must not silently overwrite evidence — Task 3 conflicting-retry tests.
4. User-controlled spreadsheet/tab/field strings must not become unsafe queries, ranges, or log content — Tasks 3–4 validation tests.
5. Expired authentication and guessed workspace/object IDs must fail closed for reads and mutations — Tasks 1 and 5 authorization tests.

## File and interface map

- `src/domain/types.ts`: `MonitorConfig`, `SignalInput`, `ScheduleWindow`, `Evaluation`, and evidence/incident enums shared by web and worker.
- `src/domain/schedule.ts`: `getWindow(config, scheduledFor): ScheduleWindow`, `nextOccurrence(config, after): Date`, and UTC preset validation.
- `src/domain/evaluate.ts`: `evaluateSignal(config, signal, receivedAt): Evaluation` with sanitized failure codes, never arbitrary payload text.
- `src/server/db/schema.ts`, `supabase/migrations/`: tables, unique constraints, RLS/server authorization support, migrations.
- `src/server/auth.ts`: `requireWorkspace(): Promise<{userId:string; workspaceId:string}>` from a verified Supabase session.
- `src/server/monitors.ts`: `createMonitor(workspaceId,input)`, `updateMonitor(workspaceId,id,input)`, `rotateToken(workspaceId,id)`, `pauseMonitor(workspaceId,id)`; return safe DTOs.
- `src/server/ingest.ts`: `ingestSignal(monitorId,token,input,receivedAt): Promise<IngestAck>`; atomic dedupe, evaluation, and jobs.
- `src/server/incidents.ts`: transactional `applyEvaluation(tx,monitorId,configVersion,evaluation,at)` and transition outbox insertion.
- `src/server/jobs.ts`: `claimJobs(workerId,now,limit)`, fenced leases, retry/backoff and completion; database transactions claim with `FOR UPDATE SKIP LOCKED`.
- `src/adapters/sheets.ts`: `verifySheet(config,signal,credentials,now): Promise<VerificationResult>`; injected adapter in tests.
- `src/adapters/email.ts`: `sendIncidentEmail(message): Promise<DeliveryReceipt>`; Resend in production, local mail transport in development.
- `src/server/secrets.ts`: authenticated encryption envelope and token hashing; key version supported for later migration.
- `src/worker/index.ts`: one-minute deadline sweep, durable readback/email jobs, recovery, retention, and worker heartbeat.
- `src/app/`: authenticated pages, server actions, auth callback, ingestion route, public landing/login page, sanitized readiness endpoint.
- `scripts/`: workspace provision/delete commands and environment validation.
- `tests/unit/`, `tests/integration/`, `tests/e2e/`: pure rules, real PostgreSQL behavior, and browser journeys.
- `docs/n8n-setup.md`, `docs/operations.md`, `.env.example`, `README.md`: setup, signal contract, integrations and launch checklist.

## Task 1: Establish authenticated workspace persistence

**Files:** package/config files; `src/server/db/*`; `src/server/auth.ts`; `src/server/secrets.ts`; `supabase/config.toml`; initial migration; `scripts/provision-workspace.ts`; `tests/integration/auth.test.ts`; `tests/unit/secrets.test.ts`.

**Consumes:** approved spec. **Produces:** verified `requireWorkspace()`, PostgreSQL client/schema, safe credential/token helpers, local run commands.

- [ ] Initialize the dedicated directory as a git repository, copy the approved specification, scaffold the TypeScript application and pin dependencies with a lockfile. Read the relevant implementation, worktree and testing skills first; this new empty repository is already isolated from unrelated projects.
- [ ] Write failing tests: no session rejects; expired session rejects; workspace A cannot access workspace B records; encrypted credential roundtrip succeeds while a wrong key or tampered envelope fails; hashed monitor tokens cannot be recovered.
- [ ] Run `pnpm test tests/unit/secrets.test.ts tests/integration/auth.test.ts`; confirm failures describe missing implementation, not a broken test environment.
- [ ] Implement tables for workspace owners, clients, versioned monitors, tokens, event metadata, incidents, verification attempts, delivery attempts, leased jobs, rate buckets, and worker heartbeat. Add unique workspace ownership, monitor/event IDs, notification transition keys, and partial uniqueness for one open incident per monitor.
- [ ] Implement Supabase verified-session integration, explicit workspace-scoped server repositories, AES-256-GCM credential envelopes, cryptographically random tokens and SHA-256 token digests. Validate required production configuration with actionable messages and no secret output.
- [ ] Disable public signup and request login links with `shouldCreateUser: false`. Verify identity server-side rather than trusting the session user object; enforce the provisioned owner mapping on every request. Rate-limit login requests, return a generic response for unknown emails, and allowlist same-origin auth callback redirects. Verify same-origin browser mutations and test cross-origin rejection. Do not expose private database tables through a browser Supabase client.
- [ ] Provide `pnpm stack:start`, `pnpm db:reset`, `pnpm provision-workspace`, and `.env.example`. Local Supabase handles development email-link auth; do not add a production auth bypass.
- [ ] Rerun targeted tests, apply migrations to local PostgreSQL, and commit `feat: establish authenticated workspaces and persistence`.

## Task 2: Define schedule and result evaluation

**Files:** `src/domain/types.ts`, `schedule.ts`, `evaluate.ts`; `tests/unit/schedule.test.ts`, `evaluate.test.ts`.

**Consumes:** monitor schema. **Produces:** shared domain types and deterministic evaluation functions used by ingestion and worker.

- [ ] Write failing schedule tests for daily 09:00 UTC: 08:59 is early, 09:05 qualifies, 09:10 is the deadline, 09:15 can recover before the next occurrence; yesterday's scheduled_for cannot qualify today. Include month/year rollover, weekdays over weekends, equality at the next boundary, and grace equal to interval rejection.
- [ ] Write failing result tests: required keys reject missing/null/blank strings but accept zero/false; minimum count zero accepts zero; non-integer/negative count rejects; a configuration version mismatch cannot qualify a result.
- [ ] Define the Zod envelope with required `config_version`, `event_id`, `scheduled_for`, `record_count`, and `fields`; optional informational `occurred_at`; and `is_test: false` default. Test stale versions and all is_test branches. Only an authenticated, well-formed, current-window production signal that violates business rules opens an immediate validation incident; malformed, early, stale, and unauthorized requests do not.
- [ ] Run `pnpm test tests/unit/schedule.test.ts tests/unit/evaluate.test.ts` and confirm expected red results.
- [ ] Implement `getWindow`, `nextOccurrence`, preset validation, and `evaluateSignal`. Treat receipt time as authoritative, use explicit occurrence identity and config version, and represent pending destination verification separately from verified results.
- [ ] Rerun tests and commit `feat: define scheduled outcome checks`.

## Task 3: Deliver ingestion, incidents, and durable deadline processing

**Files:** `src/app/api/ingest/[monitorId]/route.ts`; `src/server/ingest.ts`, `incidents.ts`, `jobs.ts`; `src/worker/index.ts`; migration updates; `tests/integration/ingest.test.ts`, `incidents.test.ts`, `worker.test.ts`.

**Consumes:** Task 2 domain functions and Task 1 persistence. **Produces:** real authenticated webhook, durable worker, monitor lifecycle and incident transition records.

- [ ] Write failing HTTP/database tests: invalid token/oversized body/malformed JSON rejected; duplicate event returns original acknowledgment; same ID with different canonical content returns conflict; count violations open one incident; parallel failure ingestion and deadline sweep still yield one open incident and one alert job.
- [ ] Write worker tests: deadlines progress without web requests; duplicate job delivery is safe; expired leases are reclaimed; stale lease holders cannot complete reclaimed jobs; late current-window success resolves without deleting history; expired-window success does not recover; pause and config edits invalidate pending work; restart opens only the latest overdue condition.
- [ ] Run `pnpm test tests/integration/ingest.test.ts tests/integration/incidents.test.ts tests/integration/worker.test.ts`; verify expected failures.
- [ ] Implement bounded streaming body parsing, schema validation, token/IP rate buckets with expiry, receipt metadata redaction, and transactional ingestion plus dedupe. Source IP must come only from a configured trusted proxy; otherwise use the socket/platform-supported source or disable IP trust and keep token/global protection.
- [ ] Implement row-lock-serialized incident transitions, unique transition jobs, one-minute deadline sweep and leased transactional jobs. Add jittered bounded retries and persistent failure state. Grace expiry must not discard a pending independent check; its later qualifying result can recover within its window.
- [ ] Rerun integration tests including parallel requests and worker restart, then commit `feat: ingest n8n signals and process incidents durably`.

## Task 4: Verify Google Sheets and deliver incident email

**Files:** `src/adapters/sheets.ts`, `email.ts`; `src/server/verification.ts`; worker handlers; `scripts/configure-google.ts`; `tests/unit/sheets.test.ts`; `tests/integration/verification.test.ts`, `notifications.test.ts`.

**Consumes:** signals, config versions, jobs, credential encryption and incident transitions. **Produces:** independent readback evidence and visible email delivery attempts.

- [ ] Write failing Sheets tests: exact event_id row match passes; zero/multiple unexpected matches fail; timestamps outside named window fail; blank required cells fail; range strings are escaped; tabs over 5,000 rows fail visibly; unauthorized/quota/timeout produce verification-error, never destination mismatch or health.
- [ ] Write failing integration tests: retries occur on the 15/60/180-second schedule; successful readback after grace but before window end recovers; completed old-version or expired-window checks cannot change health; only a fully qualifying readback recovers a destination monitor.
- [ ] Write failing delivery tests: failure then provider success records attempts; retries use stable idempotency keys; recovery email follows the same ordering as the incident transition; no configured live sender means a visible configuration failure, not a fabricated sent status.
- [ ] Test pausing or editing a monitor while an alert/recovery job is queued. Cancel unsent obsolete transitions, retain their audit status, and never send a stale recovery after a pause or a later failure. Record provider acceptance separately from actual inbox delivery; show accepted, retrying or failed rather than claiming delivered without delivery evidence.
- [ ] Run targeted tests and confirm red results.
- [ ] Implement read-only service-account Google Sheets adapter, request timeouts, limits, sanitized diagnostics and encrypted operator configuration. Use test doubles only through explicit test/development configuration.
- [ ] Implement Resend production email, local mail transport and per-monitor ordered delivery jobs with bounded retries. Show workflow-reported versus destination-verified evidence in email copy; exclude sensitive values.
- [ ] Rerun targeted tests and commit `feat: independently verify sheets and deliver alerts`.

## Task 5: Build the agency dashboard and assisted onboarding flow

**Files:** `src/app/(dashboard)/*`; `src/app/auth/*`; `src/server/monitors.ts`; `src/components/*`; `tests/integration/monitors.test.ts`; `tests/e2e/onboarding.spec.ts`.

**Consumes:** safe workspace repositories and existing monitor/incident services. **Produces:** working customer screens and server-authorized mutations; no new monitoring logic inside UI.

- [ ] Write failing API/action tests for guessed foreign client/monitor IDs, expired sessions, unverified recipients, invalid schedules, and the three-monitor pilot cap. Rotation invalidates the old token; secrets do not appear in subsequent reads.
- [ ] Write a failing browser journey: sign in through the local auth mail flow, create client, create monitor, copy initial token/setup, send a labeled test signal, activate, and see next deadline. Empty state must show onboarding steps and no fake results.
- [ ] Run targeted integration/browser tests and confirm expected failures.
- [ ] Implement a restrained responsive dashboard: incidents first, client/monitor health list, UTC deadlines, evidence labels and details. Add create/edit/pause/resume/rotate forms, immediate token disclosure, owner email verification, incident history, verification status, and delivery errors.
- [ ] Add copyable n8n HTTP Request configuration with bearer token placeholder, schedule occurrence capture, stable run ID, retry behavior and Sheets variant. Test signals never satisfy production windows or send alerts. Do not ship a hardcoded secret in downloadable examples.
- [ ] Supply importable n8n workflow JSON fixtures in `examples/n8n/` alongside the snippets. Explicitly set the sample workflow timezone to UTC and align its published Schedule Trigger with the monitor preset. Include safe handling for nodes emitting zero items so the reporting path still runs; compute the true zero count rather than treating a placeholder item as a record. Separate synthetic test runs from production schedule evidence. Verify manual retries reuse the original event_id and scheduled_for.
- [ ] Rerun tests; visually inspect desktop and narrow layouts plus keyboard navigation; commit `feat: add agency dashboard and n8n onboarding`.

## Task 6: Complete operations and pilot readiness

**Files:** `scripts/delete-workspace.ts`; retention worker handler; sanitized readiness route; `docs/n8n-setup.md`, `docs/operations.md`, `README.md`; `tests/integration/retention.test.ts`, `deletion.test.ts`, `readiness.test.ts`.

**Consumes:** all existing state and adapters. **Produces:** reproducible local startup, privacy lifecycle, operational health and truthful deployment checklist.

- [ ] Write failing tests: retention purges data older than 30 days and obsolete dedupe IDs; deleting a workspace removes jobs and credentials; repeated deletion is safe; paused monitors do not generate alerts; readiness reports stale worker heartbeat without revealing identifiers or secrets. Retention of an ongoing incident must preserve enough current state to maintain uniqueness and correct recovery while purging expired historical evidence.
- [ ] Run targeted tests and verify failures.
- [ ] Implement bounded daily cleanup, deletion transaction, readiness/heartbeat and operator commands. Add documented backup retention requirements and deployment health-monitor instructions; keep provision/configure commands out of public routes.
- [ ] Document exact n8n signal examples, scheduled_for generation, UTC windows, API responses, supported append-only Sheets format, credentials, mail setup, worker operation, failure handling and service limits. Verify the copyable examples against the webhook schema and test them with a real local request.
- [ ] Run clean local startup instructions. Separate local verified behavior from production checks blocked by missing keys; commit `feat: add pilot operations and setup documentation`.

## Task 7: End-to-end verification and independent review

**Files:** `tests/e2e/incident-recovery.spec.ts`; test fixtures/helpers; fixes only where verification reveals issues.

**Consumes:** entire application. **Produces:** verified release candidate with explicit remaining live-integration requirements.

- [ ] Add a deterministic browser/service journey: provision test workspace, authenticate, create monitor, ingest valid data, induce failure, inspect incident and captured email, ingest recovery, and verify one recovery transition. Use mock external adapters, real PostgreSQL and a separately running worker. Add destination readback variant and cross-workspace denial.
- [ ] Add `pnpm test:n8n` with an isolated, version-pinned local n8n container/profile and no customer credentials. Import the delivered examples and execute an actual HTTP reporting node against the app. Verify successful output, zero output, duplicate retry and synthetic-test labeling; document the supported n8n version. This is an integration acceptance check in addition to HTTP simulation, not a replacement for the separate authorized live Google/email launch checks.
- [ ] Run `pnpm lint`, `pnpm typecheck`, `pnpm test`, `pnpm test:integration`, `pnpm test:e2e`, and `pnpm build`; capture actual results. Run PostgreSQL concurrency tests and validate migrations from an empty database.
- [ ] Have a fresh reviewer inspect the full implementation against the specification, focusing on workspace isolation, worker races, schedule attribution, secret exposure and misleading evidence labels. Resolve material findings and rerun affected checks.
- [ ] Commit the verified result; report local launch commands, passing checks, limitations and exact production credentials still required. Do not publish or contact prospects as part of this task.

## Self-review

Self-reviewed again on 1 November 2026 against the approved design. Corrected five planning gaps: actual n8n execution was missing from acceptance; zero-item and timezone behavior needed explicit examples; the wire contract lacked config version/test mode; invitation/session/private-schema boundaries were underspecified; and migration ownership/queued notification cancellation needed one unambiguous approach.

The seven tasks cover every design section: auth/access (1,5), schedules/rules (2), signals/incidents/jobs (3), Sheets/email (4), dashboard/onboarding (5), privacy/operator lifecycle (6), and acceptance/review (7). Review Focus cases have explicit owning tests. The shared domain/service names above are the interface source of truth. Deployment, purchases, live customer access, marketing outreach and paid conversion remain outside implementation acceptance. The specification's implementation clarifications reflect these refinements without expanding product features.

Reference checks: [Supabase server-side auth](https://supabase.com/docs/guides/auth/server-side/creating-a-client), [invite-only OTP behavior](https://supabase.com/docs/reference/javascript/auth-signinwithotp), [n8n schedule timezone and publishing](https://docs.n8n.io/integrations/builtin/core-nodes/n8n-nodes-base.scheduletrigger/), [n8n workflow settings](https://docs.n8n.io/workflows/settings/), and [Next.js self-hosting](https://nextjs.org/docs/app/guides/self-hosting).

## Recommended execution

Native execution in this chat, followed by one independent whole-product review. The seven tasks share transactional state and schedule semantics, so one implementer reduces interface drift. Keep the task checklist updated and make focused commits. Production accounts are not required to implement and test the local product.
