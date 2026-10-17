-- Management explicitly authorized the call policy from October 16, 2026.
LOCK TABLE automatic_docks, auto_dock_settings IN ACCESS EXCLUSIVE MODE;
UPDATE auto_dock_settings SET calls_rule_effective_from=DATE '2026-10-16',updated_at=now() WHERE id=1;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_auto_dock_policy() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cutoff date;
BEGIN
  SELECT calls_rule_effective_from INTO cutoff FROM auto_dock_settings WHERE id=1;
  IF cutoff IS NULL THEN RAISE EXCEPTION 'Automatic dock call policy not configured'; END IF;
  IF TG_OP <> 'INSERT' AND OLD.business_date < cutoff THEN
    RAISE EXCEPTION 'Closed legacy automatic dock decision is preserved; explicit financial review required';
  END IF;
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'Automatic dock history must be voided, not deleted'; END IF;
  -- Allow only an audit-preserving retirement of an existing legacy rule.
  -- This also permits retiring the excluded employee's historical dock.
  IF TG_OP='UPDATE' AND OLD.rule_code='closer_zero_sales'
    AND OLD.status='active' AND NEW.status='voided'
    AND NEW.voided_at IS NOT NULL AND length(trim(NEW.void_reason))>0
    AND (to_jsonb(NEW)-ARRAY['status','voided_at','void_reason','updated_at'])
      = (to_jsonb(OLD)-ARRAY['status','voided_at','void_reason','updated_at']) THEN
    RETURN NEW;
  END IF;
  IF TG_OP='UPDATE' AND OLD.rule_code='closer_zero_sales' THEN
    RAISE EXCEPTION 'Legacy automatic dock evidence is immutable; only audited voiding is allowed';
  END IF;
  IF NEW.business_date < cutoff OR NEW.rule_code='closer_zero_sales' THEN
    RAISE EXCEPTION 'New automatic docks require call policy';
  END IF;
  IF NEW.employee_id='d2bf73cc-c9f6-48a8-be72-61b827e39619'::uuid THEN
    RAISE EXCEPTION 'Employee excluded from all automatic docks';
  END IF;
  RETURN NEW;
END $$;
