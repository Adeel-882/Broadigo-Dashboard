-- Source sales remain immutable evidence. Only canonical_sales is financial output.
CREATE TABLE sale_mirror_links (
  sale_id uuid PRIMARY KEY REFERENCES sales(id),
  anchor_sale_id uuid NOT NULL UNIQUE REFERENCES sales(id),
  reason text NOT NULL DEFAULT 'CONFIRMED_MIRROR_DUPLICATE',
  evidence jsonb NOT NULL,
  linked_at timestamptz NOT NULL DEFAULT now(),
  CHECK (sale_id <> anchor_sale_id)
);
--> statement-breakpoint
CREATE TABLE sale_source_availability (
  sale_id uuid PRIMARY KEY REFERENCES sales(id),
  unavailable_at timestamptz NOT NULL,
  evidence jsonb NOT NULL
);
--> statement-breakpoint
CREATE FUNCTION sale_mirror_normalize(value text) RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(trim(coalesce(value,'')), '[[:space:]]+', ' ', 'g'))
$$;
--> statement-breakpoint
CREATE VIEW sale_mirror_candidates AS
WITH source AS (
  SELECT s.*,sm.workspace_id,sm.raw_text,sm.slack_ts,c.slack_channel_id,
    sale_mirror_normalize(s.customer_name) customer_key,
    sale_mirror_normalize(s.email) email_key,
    regexp_replace(coalesce(s.phone,''),'[^0-9]','','g') phone_key,
    sale_mirror_normalize(s.package_name) plan_key,
    sale_mirror_normalize(regexp_replace(sm.raw_text,'[*`_]','','g')) text_key
  FROM sales s JOIN slack_messages sm ON sm.id=s.slack_message_id
  JOIN slack_channels c ON c.id=sm.channel_id
  WHERE c.slack_channel_id IN ('C098D7NHQ69','C0B1UH7BV9N')
    AND s.employee_id IS NOT NULL AND s.amount IS NOT NULL
    AND sm.raw_text !~* '(2[ -]*in[ -]*1|two[ -]*in[ -]*one|multiple sales|two sales)'
)
SELECT a.id anchor_sale_id,b.id sale_id,
  jsonb_build_object('policy','exact_cross_channel_mirror_v1','windowSeconds',60,
    'deletedSourceRepost',b.occurred_at-a.occurred_at>interval '60 seconds',
    'sourceTs',jsonb_build_array(a.slack_ts,b.slack_ts),'channels',jsonb_build_array(a.slack_channel_id,b.slack_channel_id),
    'matched','employee,contact identifiers,customer,plan,amount,currency,text,Central date') evidence
FROM source a JOIN source b ON a.employee_id=b.employee_id AND a.workspace_id=b.workspace_id
  AND a.slack_channel_id<>b.slack_channel_id AND (a.occurred_at,a.slack_ts,a.id)<(b.occurred_at,b.slack_ts,b.id)
  AND (b.occurred_at-a.occurred_at<=interval '60 seconds' OR EXISTS (
    SELECT 1 FROM sale_source_availability unavailable WHERE unavailable.sale_id IN(a.id,b.id)
  ))
  AND (a.occurred_at AT TIME ZONE 'America/Chicago')::date=(b.occurred_at AT TIME ZONE 'America/Chicago')::date
  AND a.customer_key<>'' AND a.customer_key=b.customer_key
  AND a.plan_key<>'' AND a.plan_key=b.plan_key AND a.amount=b.amount AND a.currency=b.currency
  AND a.text_key=b.text_key
  AND ((a.email_key<>'' AND a.email_key=b.email_key) OR (length(a.phone_key)>=10 AND a.phone_key=b.phone_key))
  AND (a.email_key='' OR b.email_key='' OR a.email_key=b.email_key)
  AND (a.phone_key='' OR b.phone_key='' OR a.phone_key=b.phone_key);
--> statement-breakpoint
CREATE FUNCTION reconcile_sale_mirrors() RETURNS integer LANGUAGE plpgsql AS $$
DECLARE added integer;
BEGIN
  PERFORM pg_advisory_xact_lock(73171,1);
  -- Only unambiguous one-to-one pairs. Never chain or collapse same-channel purchases.
  WITH eligible AS (
    SELECT c.* FROM sale_mirror_candidates c
    WHERE NOT EXISTS (SELECT 1 FROM sale_mirror_links l WHERE l.sale_id IN (c.sale_id,c.anchor_sale_id) OR l.anchor_sale_id IN (c.sale_id,c.anchor_sale_id))
  ), safe AS (
    SELECT e.* FROM eligible e WHERE NOT EXISTS (
      SELECT 1 FROM sale_mirror_candidates other WHERE (other.sale_id,other.anchor_sale_id)<>(e.sale_id,e.anchor_sale_id)
      AND (other.sale_id IN (e.sale_id,e.anchor_sale_id) OR other.anchor_sale_id IN (e.sale_id,e.anchor_sale_id))
    )
  ) INSERT INTO sale_mirror_links(sale_id,anchor_sale_id,evidence)
    SELECT sale_id,anchor_sale_id,evidence FROM safe ON CONFLICT DO NOTHING;
  GET DIAGNOSTICS added=ROW_COUNT;
  RETURN added;
END $$;
--> statement-breakpoint
CREATE FUNCTION lock_sale_mirror_writes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock(73171,1); RETURN NULL; END $$;
--> statement-breakpoint
CREATE FUNCTION reconcile_sale_mirror_writes() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM reconcile_sale_mirrors(); RETURN NULL; END $$;
--> statement-breakpoint
CREATE TRIGGER sale_mirror_write_lock BEFORE INSERT OR UPDATE OR DELETE ON sales
  FOR EACH STATEMENT EXECUTE FUNCTION lock_sale_mirror_writes();
--> statement-breakpoint
CREATE TRIGGER sale_mirror_reconcile AFTER INSERT OR UPDATE ON sales
  FOR EACH STATEMENT EXECUTE FUNCTION reconcile_sale_mirror_writes();
--> statement-breakpoint
CREATE TRIGGER sale_availability_write_lock BEFORE INSERT OR UPDATE ON sale_source_availability
  FOR EACH STATEMENT EXECUTE FUNCTION lock_sale_mirror_writes();
--> statement-breakpoint
CREATE TRIGGER sale_availability_reconcile AFTER INSERT OR UPDATE ON sale_source_availability
  FOR EACH STATEMENT EXECUTE FUNCTION reconcile_sale_mirror_writes();
--> statement-breakpoint
-- Confirmed identity is retained through edits/replays. The earliest available
-- source supplies financial fields; edits to secondary evidence never add a sale.
CREATE VIEW canonical_sales AS
SELECT s.* FROM sales s JOIN (
  SELECT s.id,row_number() OVER (
    PARTITION BY coalesce(l.anchor_sale_id,s.id)
    ORDER BY (a.sale_id IS NOT NULL),s.occurred_at,sm.slack_ts,s.id
  ) position
  FROM sales s LEFT JOIN sale_mirror_links l ON l.sale_id=s.id
  LEFT JOIN sale_source_availability a ON a.sale_id=s.id
  JOIN slack_messages sm ON sm.id=s.slack_message_id
) ranked ON ranked.id=s.id AND ranked.position=1;
