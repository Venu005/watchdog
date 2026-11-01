# Implementation and verification notes

Completed local pilot implementation on 1 November 2026. Code remains on feat/pilot-mvp in the user-selected directory; no remote, merge target or production deployment is configured.

## Verification

58 unit tests, 29 real PostgreSQL tests, and one complete browser journey pass. The browser journey covers invited email-link login, denied public signup, session refresh persistence, client/monitor creation, test signal isolation, activation, real worker failure/recovery and captured mail, responsive screens and mobile sign-out/session termination. The pinned n8n 2.45.7 runtime exercises real Header Auth/HTTP nodes, zero-output reporting, recovery, duplicate replay and synthetic isolation. Type checking, lint and the production build pass.

## Independent review

One fresh reviewer found four Important issues and no Critical or Minor issues. Each was reproduced by a failing regression and corrected: persisted auth refresh, sparse Sheet overflow, preservation of specific failure evidence, and actual synthetic rule/readback tests. No second review was claimed; the fix pass was verified by regressions and the full suite. The final mobile sign-out issue was separately reproduced and corrected through the browser journey. No deferred minor findings remain.

## Rulings I made

- Ruling: Fresh dedicated repository on feat/pilot-mvp supplies isolation; no nested worktree — no existing application/main branch exists — cost if wrong: later branch management only.
- Task 1: Ruling: Standalone PostgreSQL 18 container used for isolated integration tests while local Supabase images download; production still uses Supabase PostgreSQL — avoids blocking state-engine tests on auth startup — cost if wrong: version-specific behavior needs Supabase recheck.
- Task 1: Ruling: Drizzle generates SQL, but schema creation/security grants are reviewed migration additions because generator omits CREATE SCHEMA — sole production/local applier remains Supabase — cost if wrong: migration drift, covered by clean reset.
- Task 1: Ruling: Pin TypeScript 5.9 and ESLint 9 to installed plugin peer ranges rather than unsupported newest majors — compatibility — cost if wrong: future upgrade effort.
- Task 3: Ruling: Signals, verification attempts and email delivery attempts use signal/job rows rather than additional per-attempt tables; attempts/error/provider fields remain visible — smaller durable state model — cost if wrong: less granular attempt history.
- Task 3: Ruling: IP rate limits trust only explicitly configured proxy x-real-ip; token and global limits are always enforced — forged client headers cannot evade limits — cost if wrong: shared clients may hit global cap.
- Task 6: Ruling: Keep unresolved incident identity/reason beyond 30 days as active state; closed history retention is measured from closure — otherwise missed-run/recovery state would be lost — cost if wrong: minimal active metadata retention needs disclosure (documented).
- Final: Ruling: Reuse versioned, occurrence-stamped signal records to preserve specific current-window failure evidence rather than adding another state table — existing records already supply the needed provenance — cost if wrong: later per-attempt audit modeling may require a migration.
- Final: Ruling: Live Google permissions/Resend deliverability, production availability/backups/external heartbeat installation, and paid conversion remain explicit launch gates, as approved — local/mocked checks cannot establish them — cost if wrong: do not onboard paid customers until those gates are checked.
- Final: Ruling: Repository has no base branch or remote; retain feat/pilot-mvp locally rather than invent merge/PR targets — matches local-only delivery scope — cost if wrong: user chooses hosting/version-control destination later.

## Launch limits

Authorized live Google/Resend tests, production SMTP/hosting/backups, independent external worker monitoring, a real published customer n8n schedule, and paid-pilot conversion remain unverified launch gates. Local test credentials are not production credentials. Billing is manual. No AI provider keys are required.
