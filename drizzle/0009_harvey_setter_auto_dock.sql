-- Role-only correction; preserve applied migrations and financial history.
LOCK TABLE automatic_docks IN ACCESS EXCLUSIVE MODE;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM automatic_docks
    WHERE employee_id='03cfda43-9721-41e0-b7fe-60f40538aa29'::uuid) THEN
    RAISE EXCEPTION 'Harvey automatic docks exist: reconcile audit history before applying the role correction';
  END IF;
END $$;
ALTER TABLE automatic_docks DROP CONSTRAINT automatic_docks_check1;
ALTER TABLE automatic_docks ADD CONSTRAINT automatic_docks_employee_rule_check
  CHECK ((employee_id <> '03cfda43-9721-41e0-b7fe-60f40538aa29'::uuid
          OR rule_code='appointment_setter_zero_appointments')
     AND (employee_id <> 'd2bf73cc-c9f6-48a8-be72-61b827e39619'::uuid
          OR rule_code='closer_zero_sales'));
