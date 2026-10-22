# Automatic Dock night-shift and call-parser correction

## Proven production cause

Read-only audit on October 22, 2026 found both Zack source messages in channel C0B0P6P7FPG persisted as UNPARSED, with no appointments. Sources: 1792509402.864509 and 1792515364.998979. Both resolve to Zack employee 5ef1ee24-fc95-4dfd-9f9c-6d552a8713cb through Slack user U0B2PJ15VEV. The stored source includes phone markup. The canonical booking phrase accepts scheduled/booked/set but rejected schedule. History ingestion also skipped settled UNPARSED sources.

Source timestamps are October 20 15:16:42.864Z and 16:56:04.998Z (20:16 and 21:56 PKT). Both are inside the old and corrected windows. The old timezone window did not explain the missing calls. Assigned closers never receive posted-call credit; the evaluator joins the parent Slack author identity.

## Scoped correction

- Canonical appointment parser accepts schedule/scheduled case-insensitively, retaining phone/contact requirements. Plain-text international phones in `with <prospect> +<phone>` context also work.
- Canonical history ingestion reconsiders only previously UNPARSED appointment sources that now parse; existing source IDs and unique appointment source constraints remain intact.
- Automatic Dock window: 19:00 inclusive to next-day 04:00 exclusive Asia/Karachi; UTC 14:00 to 23:00 on the business date. Off-shift source timestamps map to null.
- Attendance, call coverage, financial evaluator, webhook late-data dispatch, and durable database queue use these boundaries. New migration 0015 replaces only queue functions and adds their pure source-time date helper.
- Cron changes from 00:00 UTC to 23:00 UTC (04:00 PKT). Latest-completed-day logic does not depend on the exact invocation minute.
- UI leads with Pakistan time and retains UTC detail; financial history remains visible.
- Dashboard America/Chicago calendar filters, sales/lead parsers, manual docks, memberships, financial amounts, Harvey bypass, Dameon exclusion, and management overrides remain unchanged.

## Preview before writes

| Date | Employee | Old calls | New calls | Attendance old/new | Financial action |
|---|---|---:|---:|---|---|
| Oct 19 | Harvey Benjamin | 2 | 0 | Bypassed/Bypassed (unchanged) | CREATE 3000 |
| Oct 20 | Lena Cross | 4 | 5 | Absent/Absent | KEEP no dock |
| Oct 20 | Ryan Voss | 4 | 3 | Absent/Absent | KEEP no dock |
| Oct 20 | Zack Wilson | 0 | 2 | Present/Absent | VOID 1500 |

Zack's old check-in is outside the corrected shift. Preserve the truthful absent status; do not fabricate attendance. His two calls are still counted and there is no automatic charge.

Read-only preview covers October 16–21 inclusive, the latest completed date during execution. Three previously rejected call sources are eligible for canonical backfill. No new channel or identity mapping is required. Full per-person/date preview is in ignored outputs/shift-plan.json.

Before: active automatic docks 6 / PKR 12000; voided 4; appointments 1809; manual dock total 556750; sales revenue 122200. Protected table checksums are captured before application. Checkpoint and execution results stay in ignored outputs, never deployment artifacts.

## Deployment and recovery

Baseline: a73c7157e15933f32c6dd48662beeb6e9cc942f5 (verified remote main).
Previous ready production deployment: dpl_3wwfMmZiTjnYL9YZ5MHMmR4vwHLg / broadigo-dashboard-kpl0onqy6-broadigo-dashboard.vercel.app. Its CLI inspect response does not expose a Git SHA; do not infer one.

Pause the financial evaluator only during migration/deployment; preserve a local financial checkpoint and original queue function definitions. Apply migration 0015 through the existing migration runner after compatibility tests. Deploy the reviewed app; backfill only previewed source IDs through canonical ingestion; refresh all three call channels and attendance; fail before financial writes if refreshed decisions differ from the preview. Resume existing evaluation and apply through evaluateBusinessDay. Verify protected checksums and a second dry run.

If deployment fails while paused, resume only after restoring a compatible application/function pair. Do not hard-delete financial history or blindly overwrite backups over new activity. Financial rollback requires a separately reviewed compensating reconciliation, not deletion. The old app artifact can be restored through Vercel; retain the checkpoint for audit.

