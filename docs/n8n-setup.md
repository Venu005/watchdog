# Connect an n8n outcome

Customers retain their existing n8n instance. This product receives a completion webhook and, when configured, reads the intended Google Sheets rows independently. n8n API keys and execution-history access are not needed in v1.

## Assisted setup

1. Pick one business outcome: for example, a daily lead sync into an append-only Sheet.
2. Create its monitor with a matching UTC schedule and grace period. Hourly monitors use the configured minute. Weekday monitors skip Saturday and Sunday.
3. Save the one-time monitor token as an n8n Header Auth credential: name `Authorization`, value `Bearer YOUR_TOKEN`. Never put tokens in URL parameters. Rotation immediately invalidates the old token.
4. Download the monitor-specific workflow from the detail page. Import it into a test workflow first; it is disabled and its `Capture run` node sets `is_test: true`.
5. Replace the business-action stub with the real operation. The example carries one `{records: []}` envelope even when there are zero business records. The report node counts the array, not n8n placeholder items. For an existing node that emits no items, add a deliberate aggregation/continuation path; attaching an HTTP node after a zero-item branch by itself will not reliably report zero results.
6. The `Capture run` node runs before business work, uses the Schedule Trigger timestamp when available, and captures `event_id`, `scheduled_for` and `config_version`. Preserve this metadata through the workflow. Do not recompute the schedule at completion. For a manually replayed failed execution, carry the original captured metadata rather than generate a new identity. HTTP Request node retries reuse the same report body.
7. Select the Header Auth credential on `Report to Watchdog`. Execute a synthetic test. Inspect the signal in the monitor detail; it cannot satisfy deadlines or recover incidents.
8. After validating the real business operation and schedule, change `is_test` to false, publish the n8n workflow, and activate the monitor. Align the next expected occurrence shown in Watchdog. Manual exploratory runs should remain synthetic. Configuration edits require refreshing the example/configuration version.

The included runtime acceptance test imports these nodes into n8n 2.45.7. It replaces the trigger with Manual Trigger only in disposable test copies so tests do not wait for a real hour/day. Published scheduling and customer systems still require the assisted pilot acceptance check.

## Webhook contract

POST `/api/ingest/MONITOR_UUID`, `Authorization: Bearer TOKEN`, JSON body at most 16 KB:

```json
{
  "event_id": "n8n-12345",
  "config_version": 1,
  "scheduled_for": "2026-11-02T09:00:00.000Z",
  "occurred_at": "2026-11-02T09:01:00.000Z",
  "record_count": 1,
  "fields": {"lead_id": true},
  "is_test": false
}
```

Use presence flags in fields, not customer data. Required flags can be false or zero because these are present values; to report absence, omit the key or use null/blank. If the business requirement is “every record has lead_id,” the example must omit/null that field when its presence check fails, not send false (false is a present scalar). The provided generator handles this convention. `record_count` is a nonnegative integer; zero is allowed only when monitor rules permit it. `occurred_at` is optional information; server receipt time controls qualification. `event_id` must contain only letters, digits, hyphens or underscores, max 128 characters. Do not reuse a synthetic event ID for a different production payload.

200 returns `{ok:true,result:{kind,eventId}}`. Valid retries return the original acknowledgment without more side effects; reusing an ID with changed payload returns 409. Malformed input is 400, bad authentication 401, oversized body 413, rate limits 429 with Retry-After 60, stale/future/paused configuration 409, temporary infrastructure failure 503. Retry network errors, 429 after Retry-After, and 5xx with the original event body. Investigate 4xx rather than blindly retrying. The bundled HTTP node has bounded generic retries; operators must inspect exhausted failures.

For a daily 09:00 UTC schedule and ten-minute grace: 09:05 qualifies; no result by 09:10 opens an incident; 09:15 can recover it. The incident stays in history. At the next 09:00, yesterday's result can no longer recover today's state. Verification completing after the window end cannot qualify that window.

## Google Sheets verification

Share only the target Sheet with a customer-created service account as viewer. Run `pnpm configure-google WORKSPACE_ID /secure/path/service-account.json` locally on the application server; never paste the file into chat or commit it. Keep the target Sheet header in row 1. Configure column positions using A=0, B=1, through Z=25. Write the captured event_id into each result row, plus a UTC ISO timestamp ending in Z. Required cells must be nonblank; exact matching row count defaults to one. Dynamic row counts, older windows, oversized tabs, extra matching rows and missing cells cannot pass.

The current generic starter does not write to Google Sheets for you. Add the customer's real write step, preserving the captured event ID, before the report node; validate the configured column mapping during assisted setup. Reads use the Google Sheets read-only scope. Retries occur approximately 15, 60 and 180 seconds after receipt. Access/quota/network errors mean verification unavailable, not proof the customer's business action failed. No cell values are persisted.
