-- Prospective policy cutover. Preserve completed financial history verbatim.
LOCK TABLE automatic_docks, auto_dock_runs, auto_dock_settings IN ACCESS EXCLUSIVE MODE;
ALTER TABLE auto_dock_settings ADD COLUMN calls_rule_effective_from date;
UPDATE auto_dock_settings SET calls_rule_effective_from=greatest(
  DATE '2026-10-16',
  (now() AT TIME ZONE 'Asia/Karachi' - interval '5 hours')::date,
  (SELECT max(business_date)+1 FROM auto_dock_runs WHERE status='COMPLETED'),
  (SELECT max(business_date)+1 FROM automatic_docks)
);
ALTER TABLE auto_dock_settings ALTER COLUMN calls_rule_effective_from SET NOT NULL;
ALTER TABLE automatic_docks DROP CONSTRAINT automatic_docks_rule_code_check;
ALTER TABLE automatic_docks ADD CONSTRAINT automatic_docks_rule_code_check
  CHECK(rule_code IN ('appointment_setter_zero_appointments','closer_zero_sales','closer_zero_calls'));
ALTER TABLE automatic_docks DROP CONSTRAINT automatic_docks_rule_amount_check;
ALTER TABLE automatic_docks ADD CONSTRAINT automatic_docks_rule_amount_check
  CHECK ((rule_code IN ('closer_zero_sales','closer_zero_calls') AND amount=1500)
      OR (rule_code='appointment_setter_zero_appointments' AND amount=3000));
-- Existing employee CHECK still preserves Harvey setter-only and historical
-- Dameon closer_zero_sales rows. The write guard below forbids ALL new Dameon rows.
--> statement-breakpoint
CREATE FUNCTION guard_auto_dock_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cutoff date;
BEGIN
  SELECT calls_rule_effective_from INTO cutoff FROM auto_dock_settings WHERE id=1;
  IF cutoff IS NULL THEN RAISE EXCEPTION 'Automatic dock call policy not configured'; END IF;
  IF TG_OP <> 'INSERT' AND OLD.business_date < cutoff THEN
    RAISE EXCEPTION 'Closed legacy automatic dock decision is preserved; explicit financial review required';
  END IF;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  IF NEW.business_date < cutoff OR NEW.rule_code='closer_zero_sales' THEN
    RAISE EXCEPTION 'New automatic docks require prospective call policy';
  END IF;
  IF NEW.employee_id='d2bf73cc-c9f6-48a8-be72-61b827e39619'::uuid THEN
    RAISE EXCEPTION 'Employee excluded from all automatic docks';
  END IF;
  RETURN NEW;
END $$;
--> statement-breakpoint
-- Invalidating edits do not necessarily update the structured appointment.
-- Observe source availability/parser/author changes without changing ingestion.
CREATE FUNCTION queue_auto_dock_source_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE day date; cutoff date;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM slack_channels c WHERE c.id=NEW.channel_id
    AND c.slack_channel_id IN ('C098WNHNBR7','C0B0P6P7FPG'))
    OR NOT EXISTS(SELECT 1 FROM appointments a WHERE a.slack_message_id=NEW.id) THEN RETURN NULL; END IF;
  SELECT calls_rule_effective_from INTO cutoff FROM auto_dock_settings WHERE id=1;
  FOR day IN SELECT DISTINCT (v AT TIME ZONE 'Asia/Karachi' - interval '5 hours')::date
    FROM unnest(ARRAY[OLD.posted_at,NEW.posted_at]) v LOOP
    IF day >= cutoff THEN
      INSERT INTO auto_dock_pending(business_date) VALUES(day)
      ON CONFLICT(business_date) DO UPDATE SET requested_at=clock_timestamp();
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER auto_dock_source_changed AFTER UPDATE OF parser_status,source_unavailable_at,slack_user_id,posted_at ON slack_messages
FOR EACH ROW WHEN (OLD.parser_status IS DISTINCT FROM NEW.parser_status OR OLD.source_unavailable_at IS DISTINCT FROM NEW.source_unavailable_at OR OLD.slack_user_id IS DISTINCT FROM NEW.slack_user_id OR OLD.posted_at IS DISTINCT FROM NEW.posted_at)
EXECUTE FUNCTION queue_auto_dock_source_change();
--> statement-breakpoint
CREATE TRIGGER automatic_dock_policy_guard BEFORE INSERT OR UPDATE OR DELETE ON automatic_docks
FOR EACH ROW EXECUTE FUNCTION guard_auto_dock_policy();
--> statement-breakpoint
DROP TRIGGER auto_dock_sale_changed ON sales;
CREATE OR REPLACE FUNCTION queue_auto_dock_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; day date; cutoff date;
BEGIN
  SELECT calls_rule_effective_from INTO cutoff FROM auto_dock_settings WHERE id=1;
  FOR source_id IN SELECT DISTINCT v FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.slack_message_id ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.slack_message_id ELSE NULL END
  ]) v WHERE v IS NOT NULL LOOP
    SELECT (sm.posted_at AT TIME ZONE 'Asia/Karachi' - interval '5 hours')::date INTO day
    FROM slack_messages sm JOIN slack_channels c ON c.id=sm.channel_id
    WHERE sm.id=source_id AND c.slack_channel_id IN ('C098WNHNBR7','C0B0P6P7FPG');
    IF day >= cutoff THEN
      INSERT INTO auto_dock_pending(business_date) VALUES(day)
      ON CONFLICT(business_date) DO UPDATE SET requested_at=clock_timestamp();
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
