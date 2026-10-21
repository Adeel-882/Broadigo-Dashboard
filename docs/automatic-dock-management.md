# Automatic dock management

Only automatic inactivity docks support this workflow. Manual Slack docks have no edit path here.

## Authorization

Configure `DOCK_EDIT_PASSWORD` as a sensitive server-only production environment variable. Never use a `NEXT_PUBLIC_` variable. Rotating this value invalidates outstanding edit authorizations. The value is not part of repository code or documentation.

The normal signed dashboard session is required (the development authentication bypass is not accepted). The password gate uses a timing-safe comparison and a durable 15-minute limit of five authorization attempts per session, plus thirty per Vercel-forwarded IP when available. Identifiers are fingerprinted; passwords and raw IP addresses are not stored. Cross-origin and non-JSON mutations are rejected.

A successful gate sets a ten-minute HttpOnly, SameSite=Strict cookie (Secure in production), bound to the exact dock and signed-in session. It grants no other permissions. Each editor opening shows the gate. Expired authorization requires re-entry.

The audit actor is the authenticated account email, plus a non-secret session fingerprint. A shared executive login identifies an account/session, not an individual person; the shared edit password is never treated as identity.

## Financial state and reconciliation

`automatic_docks` remains the original system result, including immutable default amounts and rule evidence. `auto_dock_overrides` holds one record-specific amount or deletion override. `effective_automatic_docks` applies these to all financial readers. An amount override cannot reactivate an automatically voided dock. A deletion override always makes the effective status `admin_deleted` and amount zero.

Cron keeps deriving system evidence and cannot erase overrides. The existing employee/day/rule uniqueness prevents a second financial source record. Both paths use the same day advisory lock; editing also rejects stale expected amounts and inactive records.

Every successful change writes `auto_dock_edit_history` in the same transaction, including prior/new effective amounts, source employee/day/rule, account, timestamp and reason. The history table rejects updates/deletes. Deletion requires a typed reason and never physically deletes financial history. No-op saves do not create audit entries.

## Deployment and verification

Apply additive migration `0014_auto_dock_management_overrides.sql` before deploying readers of the effective view. It does not modify existing dock records. Configure the environment secret, run tests/typecheck/lint/build, then deploy.

`AUTO_DOCK_DB_TEST=1` enables session-temporary PostgreSQL fixture tests for edit, delete, manual-dock rejection and repeated reconciliation. Production financial records must never be modified solely for testing without specific management approval. Use `scripts/verify-dock-edit-safety.ts` before deployment and with `--after` to compare protected table fingerprints; live ingestion can legitimately change them and must be investigated rather than reset.
