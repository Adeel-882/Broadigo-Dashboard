# Calendar-filter correction

## Root cause and scope

The prior deployed revision already grouped by America/Chicago calendar date, but restricted every dashboard query to 09:00–19:00. Range endpoints were also shift endpoints. Records outside those hours disappeared. No persisted reporting business_date exists on these activity tables.

Dashboard filters now use original occurred_at source instants with inclusive local midnight and exclusive next midnight. Audit verified occurred_at equals parent Slack posted_at and slack_ts (within timestamp precision) for all inspected leads, appointments, sales and manual docks: zero mismatches. No scheduled, reaction, import or update timestamp controls filter inclusion.

resolveDateRange is the shared calendar boundary helper; calendarTimestampFilter emits only timestamp >= start AND timestamp < end. calendarDateFor/calendarDateSql group and display dates. Explicit resolveOperationalShiftRange/operationalShiftFilter remain separate for shift audits. Weeks still start Monday. Automatic dock code, settings and 05:00–05:00 Asia/Karachi business days are untouched.

Applied consistently to Overview, divisions, teams, employees, drawer evidence, assigned calls, search, trend grouping and selected-period target numerators. Thresholds, eligibility, ownership, memberships and source data are unchanged.

## Timezone evidence

| Slack source timestamp | UTC | Asia/Karachi | America/Chicago | Existing/proposed Chicago date |
|---|---|---|---|---|
| 1790781552.107709 | Sep 30 15:19 | Sep 30 20:19 | Sep 30 10:19 | Sep 30 / Sep 30 |
| 1790796944.859019 | Sep 30 19:35 | Oct 1 00:35 | Sep 30 14:35 | Sep 30 / Sep 30 |
| 1790797745.834449 | Sep 30 19:49 | Oct 1 00:49 | Sep 30 14:49 | Sep 30 / Sep 30 |

Pakistan October 1 does not imply Chicago October 1. These records correctly remain September; none were changed to force a spreadsheet match.

## Production read-only audit

Baseline: 2,175 leads; 1,697 appointments; 111 sales; 235 manual dock source records. Removing the gate newly includes 4 lead submissions, 10 appointments, 4 sales and 3 dock source records across all history. Lead eligibility and dock-recipient expansion still apply, so these are structured source-record counts, not a claim that every row advances a KPI.

**September 30 / October 1 newly included or moved records: zero.** No real boundary movement should be fabricated. Synthetic boundary tests prove October 1 00:01 Central belongs to October, not September.

The legacy-shift column below is the older Karachi 05:00 day cutover for historical comparison, not a persisted field or the immediately previous Chicago filter. Immediately before this patch all listed records were excluded by the Chicago hours gate. Their new month is the YYYY-MM prefix of Calendar date.

| Kind | Employee | Slack source ts | Legacy Karachi shift date | Calendar date | Central source time |
|---|---|---|---|---|---|
| appointment | Cade Callahan | 1779495204.178479 | 2026-05-23 | 2026-05-22 | 2026-05-22 19:13:24.178 |
| appointment | Mike Weston | 1779928043.999449 | 2026-05-28 | 2026-05-27 | 2026-05-27 19:27:23.999 |
| sale | Dameon Wolfe | 1780753069.242619 | 2026-06-06 | 2026-06-06 | 2026-06-06 08:37:49.242 |
| lead | Syed Ali Jan | 1781270719.522859 | 2026-06-12 | 2026-06-12 | 2026-06-12 08:25:19.522 |
| lead | Alishba Zareh | 1782395352.310939 | 2026-06-25 | 2026-06-25 | 2026-06-25 08:49:12.31 |
| lead | Alishba Zareh | 1782395778.552429 | 2026-06-25 | 2026-06-25 | 2026-06-25 08:56:18.552 |
| lead | Alishba Zareh | 1782718292.374819 | 2026-06-29 | 2026-06-29 | 2026-06-29 02:31:32.374 |
| appointment | Cade Callahan | 1782784076.407299 | 2026-06-30 | 2026-06-29 | 2026-06-29 20:47:56.407 |
| sale | Dameon Wolfe | 1782866211.053359 | 2026-07-01 | 2026-06-30 | 2026-06-30 19:36:51.053 |
| sale | Phillip Stokes | 1782868160.033279 | 2026-07-01 | 2026-06-30 | 2026-06-30 20:09:20.033 |
| appointment | Phillip Stokes | 1783128620.869549 | 2026-07-04 | 2026-07-03 | 2026-07-03 20:30:20.869 |
| sale | Dameon Wolfe | 1783989152.010359 | 2026-07-14 | 2026-07-13 | 2026-07-13 19:32:32.01 |
| dock | Alishba Zareh | 1784164607.806459 | 2026-07-16 | 2026-07-15 | 2026-07-15 20:16:47.806 |
| appointment | Caleb Ford | 1784593930.508479 | 2026-07-21 | 2026-07-20 | 2026-07-20 19:32:10.508 |
| appointment | Caleb Ford | 1785197308.313829 | 2026-07-28 | 2026-07-27 | 2026-07-27 19:08:28.313 |
| dock | Lars White | 1785372209.572349 | 2026-07-30 | 2026-07-29 | 2026-07-29 19:43:29.572 |
| appointment | Cade Callahan | 1786152299.197509 | 2026-08-08 | 2026-08-07 | 2026-08-07 20:24:59.197 |
| appointment | Caleb Ford | 1789085131.968879 | 2026-09-11 | 2026-09-10 | 2026-09-10 19:05:31.968 |
| dock | Zaynab Rafaqat | 1789478560.731799 | 2026-09-15 | 2026-09-15 | 2026-09-15 08:22:40.731 |
| appointment | Harvey Benjamin | 1791897556.143619 | 2026-10-13 | 2026-10-13 | 2026-10-13 08:19:16.143 |
| appointment | Harvey Benjamin | 1791897573.193409 | 2026-10-13 | 2026-10-13 | 2026-10-13 08:19:33.193 |

## Boundary assertions

October 2026: [2026-10-01T05:00:00Z, 2026-11-01T05:00:00Z).
September 2026: [2026-09-01T05:00:00Z, 2026-10-01T05:00:00Z).
Custom October 1–12: [2026-10-01T05:00:00Z, 2026-10-13T05:00:00Z).
Today and Yesterday meet at Central midnight. DST days retain full calendar coverage (23 or 25 elapsed hours). November 1 midnight belongs to November only.

## Reproducible read-only checks

- scripts/audit-calendar-filters.ts: source timestamp identity, old gate impact, boundary samples and database fingerprints.
- scripts/verify-calendar-dashboard.ts: all six presets against independent PostgreSQL local-midnight queries; Harvey October 13 evidence and target numerator include both 08:19 appointments without modifying Harvey or his records.
- scripts/verify-october-lead-dashboard.ts: management's previously authorized acceptance matrix, 100 employee/date checks plus drawer target numerators and trends. Muhammad Fasial remains deferred.

No data migration or production write is needed.

## Verified results (October 16 Pakistan / October 15 Central)

TypeScript, ESLint and production build passed. Final unit suite: 427 passed, 6 pre-existing skipped. Independent PostgreSQL boundary checks matched the actual dashboard data path:

| Filter | Appointments | Sales | Revenue |
|---|---:|---:|---:|
| Today | 10 | 0 | 0 |
| Yesterday | 17 | 0 | 0 |
| This Week | 64 | 3 | 3,700 |
| Last Week | 81 | 6 | 4,373 |
| This Month (October) | 167 | 9 | 8,073 |
| Last Month (September) | 311 | 23 | 28,465 |

Harvey October 13: 3 appointments in employee count and target numerator, including both previously hidden 08:19 records in drawer evidence. No Harvey-specific rule was changed.

All 100 October employee/date lead acceptance cells passed, including selected-period individual/team target numerators and trends. The ten audited dates total 140 eligible leads (Muhammad Fasial deferred). Asif October 12 remains 3, completion 12%, with the expected three evidence records.

Database fingerprints remained identical for sales, docks, dock recipients, employees, memberships, identities, targets, automatic docks/settings and attendance. The live system received two additional raw messages/appointments during verification (1,697 → 1,699 appointments); the full lead-row fingerprint also changed while its count stayed 2,175. Therefore a blanket claim that every database byte stayed unchanged would be incorrect. This task ran only SELECT/read-only transactions and made no production data writes. Timestamp mismatch count remained zero; the 21-record historical gate-impact set remained unchanged.

The acceptance checks above exercise production data through the real backend, not an authenticated browser visual test. Deployment SHA/Ready status is reported separately after push.

