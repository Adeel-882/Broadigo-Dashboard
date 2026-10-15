# Central reporting timezone

## Scope and root cause

The dashboard previously derived presets from the Karachi shift date (rollover at 05:00 Karachi), queried 19:00–05:00 Karachi, and displayed Karachi evidence times. That rollover is not midnight in Chicago, so Today/Yesterday and week/month transitions could select a different business date from a Central-time user's expectation. No Slack source timestamps were incorrect.

Reporting now uses the IANA zone `America/Chicago` and `[09:00,19:00)` on each selected local calendar date. Intl resolves each UTC boundary independently using seasonal zone rules; PostgreSQL uses the same zone for daily filtering/grouping. There is no fixed CST offset or browser/server-local date assumption. October 12 resolves to `2026-10-12T14:00Z` through `2026-10-13T00:00Z`, exactly the previous October shift. Winter 09:00–19:00 Central resolves an hour later in UTC, as explicitly requested.

Today, Yesterday, This Week, Last Week, This Month, Last Month, custom ranges and their comparison windows share the resolver. Overview, teams, divisions, employee cards/details, assigned calls, evidence and target numerators share those query boundaries. Target amounts and eligibility/attribution are unchanged. Evidence includes CDT/CST automatically.

## Automatic docks remain separate

The two automatic-dock consumers of the former reporting helper now use `autoDockBusinessDateFor`. This preserves the original 05:00–05:00 Karachi window exactly (00:00–00:00 UTC). Scheduler, attendance SQL, first authorized date, amounts, employee exceptions, queue triggers and stored dock business dates are unchanged.

## Data impact (read-only production comparison)

Reporting dates are computed, not persisted. Only the separate automatic-dock subsystem stores business dates. No schema migration, backfill or database writes were needed or performed.

| Record type | Rows audited | Included dates changed | Entered/left shift | Outside-shift calendar labels changed |
| --- | ---: | ---: | ---: | ---: |
| Leads | 2,168 | 0 | 0 / 0 | 0 |
| Appointments | 1,695 | 0 | 0 / 0 | 8 |
| Sales | 111 | 0 | 0 / 0 | 3 |
| Manual docks | 234 | 0 | 0 / 0 | 2 |
| Media activity | 3 | 0 | 0 / 0 | 0 |

The 13 changed calendar labels concern already-outside-shift records only; they remain excluded. No eligible reporting record moved date or disappeared. Full-table fingerprints before/after matched for raw Slack messages, leads, appointments, sales, docks, dock recipients, employees, memberships, Slack identities, targets, automatic docks/settings and attendance messages.

## October acceptance benchmark

The previously supplied, management-authorized matrix is the oracle. The available local workbook contains only Sheet1, not Leads Count 2026; it was not substituted for the approved matrix. Muhammad Fasial remains deferred by explicit user instruction.

| October date | Expected excluding Fasial | Dashboard |
| --- | ---: | ---: |
| 1 | 16 | 16 |
| 2 | 14 | 14 |
| 5 | 13 | 13 |
| 6 | 10 | 10 |
| 7 | 14 | 14 |
| 8 | 16 | 16 |
| 9 | 16 | 16 |
| 12 | 10 | 10 |
| 13 | 14 | 14 |
| 14 | 17 | 17 |

The unadjusted sheet has one deferred Fasial lead on October 2 and October 14 (142 vs 140 scoped total). No identity/count change was made to eliminate that authorized exception.

| Employee (canonical name) | Authorized total over ten dates | Dashboard total | Delta |
| --- | ---: | ---: | ---: |
| Asif Hazoor | 31 | 31 | 0 |
| Syed Ali Jan | 18 | 18 | 0 |
| Alishba Zareh | 15 | 15 | 0 |
| Aishah Arif | 12 | 12 | 0 |
| Muhammad Zeeshan | 19 | 19 | 0 |
| Saad Ali | 12 | 12 | 0 |
| Muhammad Eman | 15 | 15 | 0 |
| Dilshad Ullah Danish | 12 | 12 | 0 |
| Abdul Wali | 3 | 3 | 0 |
| Nawal Tariq | 3 | 3 | 0 |

Asif October 12 remains 3/26 (12%), with Barbara Owen Snell, Gregory Jay and Ellington Henry. Mervat is not in his selected-period evidence; the recent lifecycle correction is intact.

## Verification

- Read-only audit checks real PostgreSQL against the shared JavaScript helper on 24 synthetic boundary instants across CDT, CST, spring and fall transitions; no test records are inserted.
- Regression tests cover 08:59:59, 09:00, 18:59:59, 19:00; Central midnight; month/year boundaries; multi-day ranges spanning DST; preserved Asif source instants; unchanged automatic-dock closure dates.
- All six preset dashboard queries succeeded against production data.
- TypeScript, ESLint, 414 tests and production build passed (six pre-existing/opt-in tests skipped).
- `scripts/verify-october-lead-dashboard.ts` checks all 100 employee/date cells, employee targets, team targets and employee trends, plus Asif's exact three evidence records.
- No changes to lead reconciliation, reaction/eligibility rules, employee identity, ownership, memberships, target denominators, parsing or financial dock policy.

## Files

Shared reporting: `lib/time-ranges.ts`, `lib/operational-query.ts`, `lib/dashboard-data.ts`, `types/dashboard.ts`.

UI/health labels and evidence formatting: `components/dashboard/OverviewView.tsx`, `DashboardApp.tsx`, `ManagementViews.tsx`, `app/api/health/route.ts`.

Financial-time separation only: `lib/auto-docks/time.ts`, `lib/auto-docks/policy.ts`, `app/api/slack/events/route.ts`.

Tests/audits: time-range tests, operational SQL tests, automatic-dock policy tests, `scripts/audit-reporting-timezone.ts`, and updated reporting labels/predicates in `scripts/audit-production-kpis.ts` and `scripts/verify-operational-shifts.ts`.
