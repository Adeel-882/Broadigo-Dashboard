-- Amount-only correction. Preserve 0007 as applied migration history.
-- Financial rows require explicit review, never a blind monetary rewrite.
LOCK TABLE automatic_docks IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM automatic_docks) THEN
    RAISE EXCEPTION 'Automatic dock rows exist: audit financial history before applying the amount correction';
  END IF;
END $$;
ALTER TABLE automatic_docks DROP CONSTRAINT automatic_docks_check;
ALTER TABLE automatic_docks ADD CONSTRAINT automatic_docks_rule_amount_check
  CHECK ((rule_code='closer_zero_sales' AND amount=1500)
      OR (rule_code='appointment_setter_zero_appointments' AND amount=3000));
