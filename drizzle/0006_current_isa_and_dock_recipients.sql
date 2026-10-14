ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "pseudo_name" text;
ALTER TABLE "employees" ADD COLUMN IF NOT EXISTS "work_email" text;

CREATE TABLE IF NOT EXISTS "dock_recipients" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "dock_id" uuid NOT NULL REFERENCES "docks"("id") ON DELETE CASCADE,
  "employee_id" uuid NOT NULL REFERENCES "employees"("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "dock_recipient_unique" ON "dock_recipients" ("dock_id", "employee_id");
CREATE INDEX IF NOT EXISTS "dock_recipient_employee_idx" ON "dock_recipients" ("employee_id");
