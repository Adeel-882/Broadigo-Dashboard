-- Defense in depth during deployment/cron overlap. Only Jordan's automatic
-- records are affected. Existing records, if any, retain their audit evidence.
UPDATE automatic_docks SET status='voided', voided_at=now(),
  void_reason='Employee excluded from automatic inactivity docking by management policy.', updated_at=now()
WHERE employee_id='e18ba4b0-0b55-4615-b01d-c83379049b9f' AND status='active';
--> statement-breakpoint
ALTER TABLE automatic_docks ADD CONSTRAINT jordan_no_active_automatic_dock
CHECK(employee_id <> 'e18ba4b0-0b55-4615-b01d-c83379049b9f'::uuid OR status <> 'active');
