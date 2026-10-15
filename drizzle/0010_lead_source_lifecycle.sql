ALTER TABLE slack_messages ADD COLUMN source_unavailable_at timestamptz;
CREATE TABLE lead_reconciliation_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  lead_id uuid NOT NULL REFERENCES leads(id),
  recorded_at timestamptz NOT NULL DEFAULT now(),
  reason text NOT NULL,
  before_state jsonb NOT NULL,
  after_state jsonb NOT NULL
);
