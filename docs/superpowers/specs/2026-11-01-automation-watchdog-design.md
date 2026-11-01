# Automation Watchdog — first paid pilot scope

Status: approved scope; implementation clarifications self-reviewed. Date: 1 November 2026.

## Purpose and success

Help small agencies maintaining n8n automations detect missed runs and invalid results before clients discover them. Start with assisted onboarding and a self-service status dashboard. The commercial test is two paid agency pilots and subsequent renewal, not a target signup count.

The agreed price experiment is $299 setup plus $79/month for three defined monitored outcomes. Invoice pilots manually. Revenue and conversion are unvalidated.

## Agreed product boundaries

An agency has a workspace, client records, monitors, incidents, and email alerts. We help configure the initial three monitors. Customers can view status, signals, incidents, and alert settings themselves. Support missed scheduled runs, missing required fields, unexpectedly empty results, and independent Google Sheets destination checks.

Each monitor has its own webhook URL and secret token, with a copyable n8n setup example. The UI must distinguish workflow-reported results from destination-verified evidence. A completion signal alone never proves that a destination write succeeded.

Defer AI analysis, automatic repairs, additional destination integrations, automatic billing, a public signup funnel, team invitations/roles, and a full n8n execution-history integration. No OpenAI or Claude key is required.

## Implementation decisions proposed by the builder

These are implementation defaults, not additional user requests. Use one TypeScript web application with Next.js, PostgreSQL, and a separate continuously running background worker from the same repository. Use a PostgreSQL-backed durable job queue. Keep hosting portable rather than requiring a specific cloud provider. The worker checks deadlines and handles destination verification and notification retries independently of browser visits.

Use managed email-link authentication through Supabase Auth, with application data in PostgreSQL and server-side workspace authorization. Invite-only pilots: an operator provisions each customer workspace and allowed owner email through a local administrative command; no public administrator page. The first pilot has one owner per workspace. Supabase credentials, database connection, production app URL, and an email-delivery provider key are required for production. Use a local mail sink and separate test accounts during development; never display production status from fixtures.

Use Resend for production incident emails. An authenticated sender domain must be configured before pilot emails can be delivered. Keep an email adapter so development does not send real messages. Google integration requires a customer-created service account, with only the target Sheet shared as viewer. Operators enter its credentials server-side during assisted onboarding; customers never paste secrets into chat or a general settings form. Use encrypted per-workspace credentials with a deployment-provided encryption key; do not commit secrets or store unencrypted credential JSON in database records. OAuth onboarding is deferred.

Working name is Automation Watchdog. Branding, domain purchase, deployment provider, and final visual polish are left to the builder or a later product decision. No purchases or production deployment are included in this implementation phase.

## Customer journey

1. We identify one agency owner and configure their workspace during onboarding.
2. The owner signs in through an email link, creates a client and a monitor, and chooses its rules. Agency staff may guide this through screen sharing; the operator has no universal customer-impersonation UI.
3. The owner copies the n8n HTTP Request node example, configured to POST after the meaningful workflow action. The token is shown on creation or rotation, then stored only as a hash. It is sent in an Authorization header, never the URL query string.
4. A test signal validates connectivity and rules without opening an incident or sending a customer alert. Test activity is visibly labeled and does not satisfy a production deadline.
5. Activation starts monitoring from the next scheduled occurrence. The monitor shows the next deadline and its current evidence type.
6. The dashboard shows healthy, failing, awaiting first run, or paused status. An incident explains the failed rule, observed metadata, and timestamps.
7. The owner can edit rules, pause/resume monitoring, rotate the token, and change the verified alert recipient. Rule edits and resuming begin a fresh deadline and never invent a recovery signal.

## Monitor configuration and signal contract

Each monitor belongs to one client inside one agency workspace. It has a name, description, enabled state, a UTC cron schedule with a human-readable preview, grace period, rules, and one verified owner alert address. Initial UI presets cover hourly, daily, and weekdays at a selected UTC time; arbitrary cron editing is deferred. Display UTC explicitly throughout. One monitor represents one expected outcome and counts toward the three-monitor pilot limit; pilot limits can be operator-configured.

Signals use POST /api/ingest/<monitor-id> with bearer token authentication and bounded JSON: event_id, scheduled_for, occurred_at, record_count, and fields. Require event_id and scheduled_for; enforce uniqueness per monitor for idempotent retries. scheduled_for is the UTC ISO timestamp of the configured schedule occurrence, not the completion time. The n8n example captures the trigger's intended occurrence before doing the business action and carries it through to ingestion. fields contains only configured non-sensitive field-presence values, not client records. Maximum payload size is 16 KB, with per-token and per-IP rate limits. Store receipt time as authoritative for deadlines; occurred_at is informational. Redact secrets and bodies from server logs. Reject malformed or unauthorized requests without marking a monitor healthy.

Signals that validate count and required-field rules are labeled workflow-reported. Required fields use top-level configured keys and fail on missing, null, or blank-string values; zero and false are valid. A minimum record_count is configurable, including zero for workflows that legitimately produce no records. Retain event IDs for the metadata retention period, with successful retries returning the original acknowledgment and no repeated side effects.

For occurrence D, its window is [D, next configured occurrence). Grace must be shorter than the smallest interval between supported occurrences. A signal must name D in scheduled_for and arrive inside that window to qualify; early and future signals are rejected, and signals naming an expired window are retained as late metadata without changing health. At D plus grace, missing qualification opens an incident. A qualifying result after the grace deadline but before the next occurrence resolves the incident while retaining its full history. At the next occurrence, a new pending window begins; a prior open incident remains open until a current-window result qualifies. For a daily 09:00 monitor with ten-minute grace, 08:59 cannot satisfy today's run, 09:05 can, and 09:15 can recover an incident opened at 09:10. Sheet verification completing after a window expires cannot recover it. Rule changes version the configuration; old-version pending checks cannot update the new version's health.

## Independent Google Sheets verification

The first supported destination is an append-only Google Sheet tab. Configure a spreadsheet ID, tab, correlation-ID column, timestamp column, required columns, and exact expected number of matching rows (default one). event_id is also the unique run correlation ID: the n8n workflow generates it before writing, includes it in every row for this run, then sends the same event_id in its completion signal. Retries reuse that ID. The worker reads back the destination using read-only credentials. Pass only when the number of matching rows equals the configured expected count, configured cells are populated, and timestamps fall inside the named schedule window. Both missing rows and extra duplicate rows fail verification. Dynamic per-run cardinality is deferred.

Readback retries at approximately 15, 60, and 180 seconds to allow for propagation. Only a completed destination check is labeled destination-verified; an accepted webhook starts pending verification. If Google credentials fail, the Sheet is inaccessible, a quota is exhausted, or readback repeatedly times out, display verification unavailable and open a verification-error incident. Never claim a business failure or successful verification based on an API access error. Bound supported Sheets to 5,000 rows per configured tab for the first pilot, validate this on setup, and fail visibly when exceeded. Broader scans and other write patterns are deferred.

This checks specified rows and freshness, not accounting correctness, semantic AI quality, the entire sheet, or downstream sales actions.

## Incident and notification behavior

The worker checks every minute. If no qualifying result has arrived by scheduled time plus grace, open an incident; initial default grace is ten minutes and can be changed per monitor. Invalid production signals open an incident immediately. Sheets signals remain pending until verification completes or exhausts retries; grace expiry can open an incident while verification is still pending.

Keep one open incident per monitor, update its evidence without sending a new alert for every failed signal, and distinguish missed-run, output-validation, destination-mismatch, and verification-error reasons. A later fully qualifying result resolves the incident and sends one recovery email. Recovery must satisfy all enabled checks; a webhook alone cannot recover a destination monitor. Incident creation and enqueueing of its notification are transactional. Make background operations idempotent and use unique transition keys to prevent duplicate notification jobs. Provider retries are bounded and delivery failures are visible; external email delivery is at-least-once and cannot be guaranteed duplicate-free.

Send no recurring reminders or escalation chains in v1. Pausing suppresses new evaluations and alerts, preserves history, and closes an active incident as paused without a recovery email. Worker downtime is visible through a separate operational health check; on restart, report the latest overdue condition rather than fabricate one incident per missed historical run. An external heartbeat monitor must watch the worker before a paid pilot launches.

## Dashboard and access boundaries

The overview prioritizes open incidents, followed by client and monitor health, evidence labels, last qualifying result, and next deadline. Monitor details show rule configuration, recent metadata signals, verification status, incident history, and notification delivery status. Empty workspaces have an onboarding checklist rather than fabricated metrics. No browser access to raw Google credentials, monitor token hashes, or other workspaces. Authorize every read and mutation on the server; exercise cross-workspace access tests.

Retain signal metadata and incidents for 30 days in v1. Store no full workflow outputs, receipts, CRM records, or Google Sheet cell content; retain only identifiers, counts, rule results, and sanitized failure reasons. Provide an operator command for workspace deletion that also removes its stored credentials and pending jobs. Backups and their retention must be documented at deployment.

## Build acceptance criteria

- A real owner can authenticate and see only their workspace; unauthorized object-ID access is denied.
- A customer can create a client and monitor, send a sample n8n-compatible signal, and see explicitly labeled evidence.
- Missing-run deadlines fire without a browser being open; pause, resume, late arrival, and duplicate signals behave as specified.
- Output rules handle allowed zero counts and missing/null/blank fields correctly.
- A controlled Sheet write is independently verified; wrong IDs, stale timestamps, empty cells, access failures, and retry exhaustion produce the correct visible state.
- A controlled failure produces one incident notification transition; a qualifying result produces one recovery transition. Delivery errors are visible and retried safely.
- Token rotation invalidates the prior token. Logs and stored metadata do not expose payloads or credentials.
- Automated integration tests use PostgreSQL and mocked external services. One end-to-end flow covers onboarding, ingestion, incident, and recovery. Authorized live email and Google checks are separate launch checks requiring configured credentials.
- The product runs locally with documented commands and a clearly labeled development mode. Production adapters are not described as verified until credentials are supplied and live checks pass.

## Delivery and launch boundaries

First deliver the repository, local working application, integration instructions, automated tests, and operational setup checklist. Purchasing a domain, provisioning production accounts, connecting real customer systems, sending prospect messages, and deploying publicly remain separate actions. Lack of production keys does not block local implementation and test adapters, but does block claims that live integrations are ready for customers.

After approval, copy this specification into the product repository at docs/superpowers/specs/2026-11-01-automation-watchdog-design.md, then create the implementation plan. No application scaffolding or dependencies are part of this scope-writing step.

## Implementation clarifications from plan self-review

Use one Supabase project's PostgreSQL database and Auth service, not two independently operated databases. Application tables belong in a private schema accessed through least-privilege server connections; browsers use Supabase for authentication only. Drizzle is the schema declaration/SQL generation tool and Supabase is the single migration applier. Disable public signup; operator provisioning and server-verified owner membership gate access.

The webhook envelope requires `config_version` and accepts `is_test` (default false), alongside the other fields above. Test mode never changes production health. Reject stale config versions without health changes and regenerate n8n setup examples after rule/schedule edits. Only well-formed, authenticated production signals for a current window can open rule-validation incidents; protocol errors never do. Capture the n8n run ID and schedule occurrence before business processing and preserve them on retries. Supply importable example workflows and verify them against an actual isolated n8n runtime, including zero-output behavior and explicit UTC timezone settings.

Cancel unsent obsolete notification transitions on pause or configuration changes, with audit visibility; enforce ordering so an old recovery cannot arrive after a newer failure. Describe email provider acceptance separately from inbox delivery. These refinements clarify the agreed first version; they add no new product integrations or paid scope.
