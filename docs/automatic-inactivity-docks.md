# Automatic inactivity docks

Separate from manual Slack docks, targets, payroll, and dashboard calendar filters.

## Current prospective policy: posted_calls_v1

| Employee | Attendance requirement | Zero personally posted calls | One or more |
| --- | --- | --- | --- |
| Normal Appointment Setter | Valid #general check-in | PKR 3,000 | No dock |
| Normal Closer | Valid #general check-in | PKR 1,500 | No dock |
| Harvey Benjamin | Attendance bypass | PKR 3,000 | No dock |
| Dameon Wolfe (Head of Sales) | Not evaluated: completely excluded | No dock | No dock |

Normal absence skips inactivity evaluation. Approved leave/exemptions, active employee/membership requirements and reliable attendance coverage remain unchanged. Harvey's existing role override resolves him as Setter, independent of his stored Hybrid Media title; this does not change his formal role or memberships.

Dameon's canonical ID is centralized in AUTO_DOCK_EXCLUDED_EMPLOYEE_IDS, not name matching. Exclusion precedes attendance, role and activity evaluation. No check-in, call or sale totals are queried for him. He can still receive manual management docks.

Amounts: appointment_setter_zero_appointments = 3000; closer_zero_calls = 1500. Sales count, revenue and target qualification have **no effect** on either new rule. Historical closer_zero_sales is retained only to read old evidence correctly, never assigned by the new evaluator.

## Call evidence

Count existing canonical structured appointments, not arbitrary Slack text. The existing ingestion/parser accepts valid top-level messages, rejecting replies, comments, reactions, files and chatter. Auto-dock activity joins the original parent slack_messages.slack_user_id to employee_slack_identities in the same workspace. It does **not** use appointment ownership or assigned_person to give the assignee credit. Existing appointment ownership and all dashboard KPIs are untouched.

Approved configured Slack IDs:
- C098WNHNBR7: sales-development-general
- C0B0P6P7FPG: broadigo-sale-development-general

Use original parent posted_at within [business window start, end). Require PARSED canonical source and no source_unavailable_at. Scheduled meeting time, qualification replies, ingestion/update time, assigned closer and revenue are irrelevant. SQL EXISTS prevents identity joins from multiplying appointment counts.

## Attendance and time (unchanged)

First approved financial business date remains October 16, 2026. Business window is **05:00–05:00 Asia/Karachi**, independent of full America/Chicago dashboard calendar filters. First approved execution was October 17 at 05:00 Karachi.

The reviewed #general phrases remain: Check in, checkin, Check in at 7, Check in at 7:00, Clocked in @ 7:15 pm., and cheak in. Existing exact normalization, top-level/user checks, coverage requirements and exemption behavior are unchanged. Unreliable coverage is UNKNOWN, never proof of absence.

Vercel cron remains 0 0 * * * UTC. Hobby scheduling can occur within the hour; the business-window boundary itself remains exact. No scheduling or attendance-classifier change is part of this policy update.

## Cutover and preserved financial history

Migration 0011 records calls_rule_effective_from as the latest of:
1. the current approved automatic-dock business date at migration time;
2. the day after the last completed financial run;
3. the day after any existing automatic financial row;
4. the original October 16 minimum.

This prevents backdating or mixing the new rule into a closed old-policy day. Dry runs may preview the new policy on an old date, but are not historical financial decisions. Applying an earlier date returns historicalPreserved without inserting/voiding/rewriting financial rows or evaluations. Database guards also reject changes to legacy financial rows, new pre-cutover rows, every new closer_zero_sales row and every new Dameon row.

Production inspection before the update found one completed October 16 run and these active rows:
- Dameon Wolfe: closer_zero_sales, PKR 1,500.
- Phillip Stokes: closer_zero_sales, PKR 1,500.
- Jason Harkins: appointment_setter_zero_appointments, PKR 3,000.

These remain historically truthful, including Dameon's existing financial decision. Removing it requires separate management approval; future exclusion is not retroactive cancellation. The expected cutover on October 17 is October 17, first completed new-policy window October 18 at 05:00 Karachi. Read the persisted cutoff rather than assuming it when rerunning deployment later.

## Idempotency and late evidence

Unique employee/business_date/rule_code remains unchanged. New Closer rows use closer_zero_calls, never rename or reuse closer_zero_sales with a different meaning.

The appointment trigger queues original source business dates on insert/update/delete, including sync/reprocess. The sales trigger is removed; normal sales ingestion remains unchanged. Late personally posted calls void new-policy automatic docks; losing the only valid call makes the same unique record active again. Void/audit history remains intact. Late check-ins/exemptions still reconcile prospective days. Old-policy financial days are frozen pending explicit review.

A narrow call-deletion webhook branch marks only existing canonical appointment sources in the two approved channels unavailable, retaining both raw and structured records. A source-change trigger queues parser-status, availability, author and source-time changes, covering invalidating edits that do not update the appointment row. Replies cannot match a canonical appointment parent. No sales or lead deletion behavior is changed.

The migration adds a settings cutoff column, expands rule/amount CHECKs, adds a financial-history/exclusion write guard and narrows only the automatic-dock activity trigger. It never updates manual or existing automatic financial records.

## Audit UI and CLI

Current rule evidence displays Attendance, Calls posted, Rule/Decision, amount and business window. Dameon displays EXCLUDED / Not evaluated. Historical closer_zero_sales evidence retains its old sales label; do not rewrite it into call evidence. The automatic evidence drawer labels current reasons “No call posted during business day”, applied by System.

GET /api/auto-docks remains authenticated/read-only. GET /api/cron/auto-docks still requires the configured scheduler bearer secret. No new public write route.

Read-only policy preview:
```powershell
npx tsx scripts/auto-docks.ts --date 2026-10-17
```

Existing --sync-attendance imports attendance evidence; --apply performs guarded financial evaluation and is not needed to verify this change. Do not use --configure/--enable to reset settings during the rule migration.

## Verification

- Unit matrices cover Setter/Closer presence, personal calls, sales irrelevance, exemptions, Harvey bypass, and all Dameon combinations.
- Opt-in service.integration.test.ts applies migration DDL and the real evaluator to session-temporary tables/functions only, preserving production financial fingerprints.
- Integration covers old-rule preservation; source author rather than structured owner/assignee; both approved call channels; source-time rather than future scheduled_at; late calls, deletion/reactivation and uniqueness; sales insert/edit/delete non-queueing; new Dameon write rejection.
- scripts/verify-auto-dock-constraints.ts verifies prospective rule/amount checks and exclusions in a temporary clone after migration.
- Normal full test run skips explicit database integration tests; run them separately with AUTO_DOCK_DB_TEST=1.

## Production verification — October 17, 2026

Migration 0011 persisted calls_rule_effective_from = 2026-10-17. No financial rows were inserted, voided or rewritten. Full before/after fingerprints matched for automatic_docks (3), evaluations (17), runs (1), manual sources (239), recipients (298), appointments (1,724), sales (112), leads (2,207), employees (40), memberships (48), targets (9), attendance messages (177) and coverage (4). Recipient-expanded manual total remained PKR 693,250; sales revenue remained USD 121,900.

October 16 new-policy preview (dry-run only, not a rewritten decision): Phillip present/0 posted calls → 1,500; Jason present/0 → 3,000; Harvey bypass/1 → 0; Caleb present/2 → 0; Dameon excluded/not evaluated → 0. Existing October 16 financial rows still retain their original rules and amounts.

October 17 prospective preview: incomplete coverage → SKIP_UNRELIABLE; Dameon → SKIP_EXCLUDED. No absence or financial conclusion was inferred from an unfinished day. First new-policy completion is October 18 at 05:00 Karachi, subject to unchanged cron timing and coverage checks.

Verification: typecheck/lint, 429 regular tests, 2 opted-in temporary-PostgreSQL integration tests, separate temporary constraint checks, and production build. The new-rule scenarios were tested without making production financial decisions.
