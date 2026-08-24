ALTER TABLE "appointments" ADD COLUMN "qualification_status" text DEFAULT 'UNKNOWN' NOT NULL;
ALTER TABLE "appointments" ADD COLUMN "qualified_at" timestamp with time zone;
ALTER TABLE "appointments" ADD COLUMN "qualification_source_ts" text;
ALTER TABLE "appointments" ADD COLUMN "qualification_evaluator_slack_user_id" text;

CREATE TABLE "appointment_dispositions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"appointment_id" uuid NOT NULL,
	"slack_reply_ts" text NOT NULL,
	"evaluator_slack_user_id" text NOT NULL,
	"status" text NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
ALTER TABLE "appointment_dispositions" ADD CONSTRAINT "appointment_dispositions_appointment_id_appointments_id_fk" FOREIGN KEY ("appointment_id") REFERENCES "public"."appointments"("id") ON DELETE no action ON UPDATE no action;
CREATE UNIQUE INDEX "appointment_disposition_reply_unique" ON "appointment_dispositions" USING btree ("appointment_id","slack_reply_ts");
CREATE INDEX "appointment_disposition_latest_idx" ON "appointment_dispositions" USING btree ("appointment_id","slack_reply_ts");
