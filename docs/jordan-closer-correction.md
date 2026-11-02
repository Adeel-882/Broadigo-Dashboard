# Jordan Reid organization correction

Canonical employee: `e18ba4b0-0b55-4615-b01d-c83379049b9f`.
Existing Slack identity: `T098UDG2RED` / `U098A685CR4`.

Management approved an active Closer membership in the existing Broadigo Real
Estate team. The focused script preserves both existing media memberships,
sets the canonical title to Closer, and records Shaheer Ali as the alternate
identity. It never inserts an employee or rewrites appointment/sales ownership.

Apply migration 0016, then run `npx tsx scripts/formalize-jordan-closer.ts --apply`.
Without `--apply` the script is read-only. Do not run the general legacy seed.
The script verifies the canonical Slack key, rejects conflicting aliases,
compares protected table fingerprints in a repeatable-read transaction, and
retains a local before/after audit under `outputs/`.

Jordan is centrally excluded from automatic inactivity docks. The exclusion
precedes attendance/activity eligibility. A database CHECK additionally rejects
active automatic dock records for this employee. Manual docks are unaffected.
Completed audit dates receive append-only exclusion evidence; previous evidence
is never deleted, and unevaluated dates are not presented as evaluated.

Assigned calls retain setter credit. Existing assignment queries resolve the
Slack assignee to this same employee. Posted-call and sales source ownership,
calendar filters, targets and all other employee memberships remain unchanged.
