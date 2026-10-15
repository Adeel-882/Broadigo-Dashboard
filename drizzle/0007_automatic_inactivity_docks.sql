CREATE TABLE auto_dock_settings (
  id integer PRIMARY KEY CHECK (id=1), enabled boolean NOT NULL DEFAULT false,
  workspace_id text NOT NULL, general_channel_id text NOT NULL,
  attendance_reliable_from date, effective_from date,
  approved_check_in_phrases jsonb NOT NULL DEFAULT '[]',
  approved_at timestamptz, updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (NOT enabled OR (attendance_reliable_from >= DATE '2026-10-16' AND attendance_reliable_from IS NOT NULL AND effective_from IS NOT NULL AND effective_from >= attendance_reliable_from AND approved_at IS NOT NULL AND jsonb_array_length(approved_check_in_phrases)>0))
);
INSERT INTO auto_dock_settings(id,workspace_id,general_channel_id) VALUES(1,'T098UDG2RED','C0980E2DWAK');
--> statement-breakpoint
CREATE TABLE attendance_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), workspace_id text NOT NULL, channel_id text NOT NULL,
  slack_ts text NOT NULL, slack_user_id text NOT NULL, employee_id uuid REFERENCES employees(id),
  source_at timestamptz NOT NULL, raw_text text NOT NULL, is_check_in boolean NOT NULL DEFAULT false,
  deleted boolean NOT NULL DEFAULT false, received_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(workspace_id,channel_id,slack_ts)
);
CREATE INDEX attendance_employee_time_idx ON attendance_messages(employee_id,source_at);
CREATE TABLE attendance_coverage (
  business_date date PRIMARY KEY, workspace_id text NOT NULL, channel_id text NOT NULL,
  fetched_at timestamptz NOT NULL, message_count integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE auto_dock_exemptions (
  employee_id uuid NOT NULL REFERENCES employees(id), business_date date NOT NULL,
  reason text NOT NULL CHECK(length(trim(reason))>0), created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(employee_id,business_date)
);
CREATE TABLE automatic_docks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES employees(id),
  business_date date NOT NULL CHECK(business_date>=DATE '2026-10-16'), rule_code text NOT NULL CHECK(rule_code IN ('appointment_setter_zero_appointments','closer_zero_sales')),
  source_type text NOT NULL DEFAULT 'automatic_inactivity' CHECK(source_type='automatic_inactivity'),
  amount numeric(14,2) NOT NULL, currency text NOT NULL DEFAULT 'PKR', reason text NOT NULL,
  status text NOT NULL CHECK(status IN ('active','voided')), evidence jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
  voided_at timestamptz, void_reason text,
  UNIQUE(employee_id,business_date,rule_code),
  CHECK ((rule_code='closer_zero_sales' AND amount=3000) OR (rule_code='appointment_setter_zero_appointments' AND amount=1500)),
  CHECK(employee_id NOT IN ('03cfda43-9721-41e0-b7fe-60f40538aa29'::uuid,'d2bf73cc-c9f6-48a8-be72-61b827e39619'::uuid) OR rule_code='closer_zero_sales')
);
CREATE INDEX automatic_docks_date_idx ON automatic_docks(business_date,status);
CREATE TABLE auto_dock_runs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), business_date date NOT NULL,
  started_at timestamptz NOT NULL DEFAULT now(), completed_at timestamptz,
  status text NOT NULL, summary jsonb NOT NULL DEFAULT '{}', error text
);
CREATE TABLE auto_dock_evaluations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(), run_id uuid NOT NULL REFERENCES auto_dock_runs(id),
  employee_id uuid NOT NULL REFERENCES employees(id), business_date date NOT NULL,
  evaluated_at timestamptz NOT NULL DEFAULT now(), dock_id uuid REFERENCES automatic_docks(id), evidence jsonb NOT NULL
);
CREATE INDEX auto_dock_evaluation_day_idx ON auto_dock_evaluations(business_date,employee_id);
CREATE TABLE auto_dock_pending (
  business_date date PRIMARY KEY,
  requested_at timestamptz NOT NULL DEFAULT now()
);
--> statement-breakpoint
CREATE FUNCTION queue_auto_dock_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; day date;
BEGIN
  FOR source_id IN SELECT DISTINCT v FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.slack_message_id ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.slack_message_id ELSE NULL END
  ]) v WHERE v IS NOT NULL LOOP
    SELECT (sm.posted_at AT TIME ZONE 'Asia/Karachi' - interval '5 hours')::date INTO day
    FROM slack_messages sm JOIN slack_channels c ON c.id=sm.channel_id
    WHERE sm.id=source_id AND c.name IN ('sales-development-general','broadigo-sale-development-general','sales-reporting','broadigo-sales-reporting');
    IF day >= DATE '2026-10-16' THEN
      INSERT INTO auto_dock_pending(business_date) VALUES(day)
      ON CONFLICT(business_date) DO UPDATE SET requested_at=clock_timestamp();
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE TRIGGER auto_dock_appointment_changed AFTER INSERT OR UPDATE OR DELETE ON appointments FOR EACH ROW EXECUTE FUNCTION queue_auto_dock_activity();
--> statement-breakpoint
CREATE TRIGGER auto_dock_sale_changed AFTER INSERT OR UPDATE OR DELETE ON sales FOR EACH ROW EXECUTE FUNCTION queue_auto_dock_activity();
--> statement-breakpoint
