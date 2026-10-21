-- Additive: system-derived financial history and policy constraints are untouched.
CREATE TABLE auto_dock_overrides (
  dock_id uuid PRIMARY KEY REFERENCES automatic_docks(id),
  override_type text NOT NULL CHECK(override_type IN ('amount','deleted')),
  amount numeric(14,2), reason text NOT NULL,
  actor text NOT NULL, session_fingerprint text NOT NULL, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((override_type='amount' AND amount IS NOT NULL AND amount>=0 AND amount<=999999999999.99) OR (override_type='deleted' AND amount IS NULL))
);
CREATE TABLE auto_dock_edit_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), dock_id uuid NOT NULL REFERENCES automatic_docks(id),
  employee_id uuid NOT NULL REFERENCES employees(id), business_date date NOT NULL, rule_code text NOT NULL,
  action text NOT NULL CHECK(action IN ('AMOUNT_CHANGED','ADMIN_DELETED')),
  old_amount numeric(14,2) NOT NULL, new_amount numeric(14,2) NOT NULL,
  reason text NOT NULL, actor text NOT NULL, session_fingerprint text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX auto_dock_edit_history_dock_idx ON auto_dock_edit_history(dock_id,created_at);
CREATE TABLE auto_dock_edit_attempts (
  key text PRIMARY KEY, window_started timestamptz NOT NULL, attempts integer NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION preserve_auto_dock_edit_history() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'Automatic dock management history is append-only'; END $$;
CREATE TRIGGER auto_dock_edit_history_immutable BEFORE UPDATE OR DELETE ON auto_dock_edit_history
FOR EACH ROW EXECUTE FUNCTION preserve_auto_dock_edit_history();
--> statement-breakpoint
-- Every financial reader uses this projection. Reconciliation still writes only
-- system evidence; it can never overwrite or remove a management override.
CREATE VIEW effective_automatic_docks AS
SELECT d.id,d.employee_id,d.business_date,d.rule_code,d.source_type,
  CASE WHEN o.override_type='deleted' THEN 0::numeric WHEN o.override_type='amount' THEN o.amount ELSE d.amount END AS amount,
  d.amount AS system_amount,d.currency,d.reason,
  CASE WHEN o.override_type='deleted' THEN 'admin_deleted' ELSE d.status END AS status,
  d.status AS system_status,d.evidence,d.created_at,d.updated_at,d.voided_at,d.void_reason,
  o.override_type,o.reason AS override_reason,o.actor AS edited_by,o.updated_at AS edited_at
FROM automatic_docks d LEFT JOIN auto_dock_overrides o ON o.dock_id=d.id;
