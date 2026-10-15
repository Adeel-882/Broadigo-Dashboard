# Automatic inactivity docks

This feature is separate from manual Slack docks and from targets/payroll.

## Approved activation

- First business date: **2026-10-16**.
- First window: October 16 05:00 → October 17 05:00, Asia/Karachi.
- First eligible financial execution: **October 17 at 05:00** (00:00 UTC).
- Earlier dates: audit only, never financial writes. Both service and database enforce the lower date boundary.
- Full 24-hour 05:00–05:00 evaluation; existing 19:00–05:00 reporting logic is unchanged.

## Attendance evidence and rules

The bot can read #general (`C0980E2DWAK`) after the user's October 15 invitation. Slack history did not expose a bot join event, so its exact join timestamp is unknown. History is accessible before activation, but management designated October 16 as the first reliable full day. Earlier missing check-ins are **UNKNOWN**, not established absence.

Observed messages: `Check in`, `checkin`, `Check in at 7`, `Check in at 7:00`, `Clocked in @ 7:15 pm.`, and the recurring typo `cheak in`. These reviewed phrases are matched exactly after case/whitespace/Slack emphasis normalization. `break`, `break off`, `off`, discussions, bot messages and thread replies are not attendance. No guessed `present`/`office` vocabulary.

Slack author user ID resolves through existing workspace identities. A complete, successful paginated history snapshot is required before a day receives coverage. Failed, partial, or in-progress snapshots cannot authorize financial evaluation. Current Slack snapshots handle edits/deletions; old event payloads cannot overwrite newer evidence.

Active Appointment Setter + check-in + zero owned structured appointments: PKR 1,500. Active Closer + check-in + zero structured sales: PKR 3,000. Normal absence: no inactivity dock. Approved per-day exemption: no dock.

Harvey Benjamin and Dameon Wolfe have centralized employee-ID attendance bypasses and **Closer-only** evaluation. Harvey's existing canonical title is Hybrid Media; the management-confirmed rule override does not mutate formal roles/memberships. Dameon can never receive the setter rule: policy tests and a PostgreSQL CHECK enforce this. Posting appointments has no effect on either exception's sale-count rule.

Structured activity is joined to canonical configured reporting channels and attributed by the original parent Slack message timestamp. Appointment credit stays with the setter. A valid $0 sale counts as a sale. Scheduled call time, assigned closer, ingestion time, targets and revenue thresholds are irrelevant.

## Persistence and recovery

`automatic_docks` is distinct from `docks`/`dock_recipients`. Unique employee/day/rule prevents duplicates. Late qualifying activity voids rather than deletes automatic records; append-only evaluations and run summaries preserve the decision history. Manual docks are never modified.

Database triggers enqueue original source dates atomically with appointment/sale inserts, updates and deletes, including historical sync/reprocess. Relevant #general events enqueue a fresh attendance snapshot. Closed dates reconcile inline after relevant webhooks; failures leave durable work queued for cron. Daily execution also catches missed incomplete runs, up to three days per request. Retry the authenticated cron to drain a larger backlog. No background fire-and-forget writes.

`GET /api/cron/auto-docks` requires `Authorization: Bearer <CRON_SECRET>`. The proxy bypass is exact-path only; the route verifies its own secret. Vercel schedule: `0 0 * * *` (UTC). Vercel scheduling is not an exact-second guarantee; account plan timing limits still apply. A failed request returns 500 and retains queued dates; Vercel does not guarantee automatic retries. Run the protected endpoint again or let the next daily run catch up.

`GET /api/auto-docks?date=YYYY-MM-DD` is session-authenticated and read-only. Docks shows AUTO/System records, daily audit evidence, latest run, pending dates, and per-employee decisions. Voided automatic rows are excluded from totals but retained in storage. There is no public exemption/write endpoint.

The production account was verified as **Hobby** on October 15. Its cron timing is within the scheduled hour, so the first invocation may be **05:00–05:59 on October 17**, not precisely 05:00. The business window still ends exactly at 05:00. A plan/scheduler change is required for tighter scheduling; no paid account change was made.

## Operator commands

```powershell
# No financial writes. Snapshot flag imports attendance evidence only.
npx tsx scripts/auto-docks.ts --date 2026-10-14 --sync-attendance

# Exact approved dates and reviewed phrases, initially disabled.
npx tsx scripts/auto-docks.ts --configure
# Enable only after verification. Completion and coverage guards still apply.
npx tsx scripts/auto-docks.ts --enable

# Retry one completed approved day (requires complete attendance coverage).
npx tsx scripts/auto-docks.ts --date 2026-10-16 --sync-attendance --apply

# Minimal approved-leave exception. UUID must be an existing employee.
npx tsx scripts/auto-docks.ts --date 2026-10-16 --exempt --employee EMPLOYEE_UUID --reason "Approved leave"
```

Exemptions require database/operator access, not the shared office login. Reconcile after setting an exemption on an already-evaluated day. Optional Slack summaries are intentionally not implemented, avoiding parser feedback/duplicate manual docks.

## Verification

October 12–14 production dry runs retain UNKNOWN historical reliability and create zero financial docks. Observed cases include Caleb check-in + two appointments (Oct13/14); Jordan check-in + zero appointments (Oct13/14); Zack check-in + one sale (Oct13); Phillip check-in + zero sales (Oct13); Dameon two sales (Oct12). A missing historical check-in is not proof of absence.

Baseline after migration/attendance audits: 233 manual sources, PKR672,750 recipient-expanded manual total, 1,689 appointments, 111 sales, $121,400 revenue, 2,156 leads, 40 employees, 48 memberships. No financial automatic records created during historical audits.

During verification an independent live Slack manual dock arrived at 2026-10-15 19:15:27 Asia/Karachi (source `1792073727.014489`), imported one second later: PKR2,000 for three recipients. This explains the final 234 manual sources / PKR678,750 total; it was not an automatic write. Other baseline totals remained unchanged. All six dashboard presets and Caleb/Dameon/Zack employee-detail queries loaded successfully.

`service.integration.test.ts` explicitly opted in with `AUTO_DOCK_DB_TEST=1` executes the actual evaluator against session-temporary clones. It verifies late check-ins, idempotency, assigned-closer non-credit, late appointment and $0 sale voiding, date guards, audit rows, and unchanged production counts. Normal test runs skip this network-dependent test. `scripts/verify-auto-dock-constraints.ts` separately verifies PostgreSQL uniqueness and CHECK constraints in a temporary clone.
