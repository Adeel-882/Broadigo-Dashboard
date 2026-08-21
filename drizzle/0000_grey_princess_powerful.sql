CREATE TYPE "public"."parser_status" AS ENUM('PENDING', 'PARSED', 'UNPARSED', 'ERROR');--> statement-breakpoint
CREATE TYPE "public"."record_type" AS ENUM('APPOINTMENT', 'SALE', 'LEAD', 'DOCK', 'MEDIA_ACTIVITY');--> statement-breakpoint
CREATE TYPE "public"."sync_status" AS ENUM('RUNNING', 'COMPLETED', 'FAILED');--> statement-breakpoint
CREATE TYPE "public"."target_period" AS ENUM('DAILY', 'WEEKLY', 'MONTHLY');--> statement-breakpoint
CREATE TABLE "appointments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_message_id" uuid NOT NULL,
	"employee_id" uuid,
	"team_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"prospect_name" text,
	"phone" text,
	"state" text,
	"scheduled_at" timestamp with time zone,
	"original_timezone" text,
	"assigned_person" text,
	CONSTRAINT "appointments_slack_message_id_unique" UNIQUE("slack_message_id")
);
--> statement-breakpoint
CREATE TABLE "divisions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	CONSTRAINT "divisions_name_unique" UNIQUE("name"),
	CONSTRAINT "divisions_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
CREATE TABLE "docks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_message_id" uuid NOT NULL,
	"employee_id" uuid,
	"team_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"amount" numeric(14, 2) NOT NULL,
	"currency" text DEFAULT 'PKR' NOT NULL,
	"reason" text NOT NULL,
	"applied_by" text,
	"notes" text,
	CONSTRAINT "docks_slack_message_id_unique" UNIQUE("slack_message_id")
);
--> statement-breakpoint
CREATE TABLE "employee_aliases" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"alias" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "employees" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"canonical_name" text NOT NULL,
	"job_title" text NOT NULL,
	"leadership_level" text,
	"avatar_url" text,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "leads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_message_id" uuid NOT NULL,
	"employee_id" uuid,
	"team_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"lead_type" text,
	"contact_name" text,
	"phone" text,
	"email" text,
	"property_type" text,
	"state" text,
	"timeline" text,
	"details" jsonb DEFAULT '{}'::jsonb NOT NULL,
	CONSTRAINT "leads_slack_message_id_unique" UNIQUE("slack_message_id")
);
--> statement-breakpoint
CREATE TABLE "media_activity" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_message_id" uuid NOT NULL,
	"employee_id" uuid,
	"team_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"classification" text NOT NULL,
	"summary" text NOT NULL,
	"blocker" text,
	CONSTRAINT "media_activity_slack_message_id_unique" UNIQUE("slack_message_id")
);
--> statement-breakpoint
CREATE TABLE "employee_team_memberships" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"team_id" uuid NOT NULL,
	"role" text NOT NULL,
	"ranking_enabled" boolean DEFAULT true NOT NULL,
	"start_date" date,
	"end_date" date
);
--> statement-breakpoint
CREATE TABLE "sales" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"slack_message_id" uuid NOT NULL,
	"employee_id" uuid,
	"team_id" uuid,
	"occurred_at" timestamp with time zone NOT NULL,
	"confidence" numeric(4, 3) NOT NULL,
	"customer_name" text,
	"phone" text,
	"email" text,
	"package_name" text,
	"amount" numeric(14, 2),
	"currency" text DEFAULT 'USD' NOT NULL,
	"state" text,
	"zip_codes" text[],
	CONSTRAINT "sales_slack_message_id_unique" UNIQUE("slack_message_id")
);
--> statement-breakpoint
CREATE TABLE "slack_channels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"slack_channel_id" text NOT NULL,
	"name" text NOT NULL,
	"team_id" uuid,
	"parser_type" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"event_id" text NOT NULL,
	"workspace_id" text NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "slack_events_event_id_unique" UNIQUE("event_id")
);
--> statement-breakpoint
CREATE TABLE "employee_slack_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"employee_id" uuid NOT NULL,
	"workspace_id" text NOT NULL,
	"slack_user_id" text NOT NULL,
	"display_name" text,
	"aliases" text[] DEFAULT ARRAY[]::text[] NOT NULL
);
--> statement-breakpoint
CREATE TABLE "slack_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" uuid NOT NULL,
	"slack_ts" text NOT NULL,
	"slack_user_id" text,
	"employee_id" uuid,
	"raw_text" text NOT NULL,
	"posted_at" timestamp with time zone NOT NULL,
	"imported_at" timestamp with time zone DEFAULT now() NOT NULL,
	"parser_status" "parser_status" DEFAULT 'PENDING' NOT NULL,
	"parser_type" text NOT NULL,
	"validation_warnings" jsonb DEFAULT '[]'::jsonb NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sync_runs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" text NOT NULL,
	"channel_id" uuid,
	"status" "sync_status" NOT NULL,
	"cursor" text,
	"messages_imported" integer DEFAULT 0 NOT NULL,
	"error" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "targets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"division_id" uuid,
	"team_id" uuid,
	"employee_id" uuid,
	"role" text,
	"metric" text NOT NULL,
	"period" "target_period" NOT NULL,
	"value" numeric(14, 2) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"effective_from" date NOT NULL,
	"effective_to" date
);
--> statement-breakpoint
CREATE TABLE "teams" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"division_id" uuid NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"type" text NOT NULL,
	CONSTRAINT "teams_slug_unique" UNIQUE("slug")
);
--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_slack_message_id_slack_messages_id_fk" FOREIGN KEY ("slack_message_id") REFERENCES "public"."slack_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "appointments" ADD CONSTRAINT "appointments_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docks" ADD CONSTRAINT "docks_slack_message_id_slack_messages_id_fk" FOREIGN KEY ("slack_message_id") REFERENCES "public"."slack_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docks" ADD CONSTRAINT "docks_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "docks" ADD CONSTRAINT "docks_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_aliases" ADD CONSTRAINT "employee_aliases_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_slack_message_id_slack_messages_id_fk" FOREIGN KEY ("slack_message_id") REFERENCES "public"."slack_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "leads" ADD CONSTRAINT "leads_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_activity" ADD CONSTRAINT "media_activity_slack_message_id_slack_messages_id_fk" FOREIGN KEY ("slack_message_id") REFERENCES "public"."slack_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_activity" ADD CONSTRAINT "media_activity_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "media_activity" ADD CONSTRAINT "media_activity_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_team_memberships" ADD CONSTRAINT "employee_team_memberships_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_team_memberships" ADD CONSTRAINT "employee_team_memberships_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_slack_message_id_slack_messages_id_fk" FOREIGN KEY ("slack_message_id") REFERENCES "public"."slack_messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sales" ADD CONSTRAINT "sales_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_channels" ADD CONSTRAINT "slack_channels_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "employee_slack_identities" ADD CONSTRAINT "employee_slack_identities_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_channel_id_slack_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."slack_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "slack_messages" ADD CONSTRAINT "slack_messages_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sync_runs" ADD CONSTRAINT "sync_runs_channel_id_slack_channels_id_fk" FOREIGN KEY ("channel_id") REFERENCES "public"."slack_channels"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_team_id_teams_id_fk" FOREIGN KEY ("team_id") REFERENCES "public"."teams"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "targets" ADD CONSTRAINT "targets_employee_id_employees_id_fk" FOREIGN KEY ("employee_id") REFERENCES "public"."employees"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "teams" ADD CONSTRAINT "teams_division_id_divisions_id_fk" FOREIGN KEY ("division_id") REFERENCES "public"."divisions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "appointments_employee_time_idx" ON "appointments" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "appointments_team_time_idx" ON "appointments" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE INDEX "docks_employee_time_idx" ON "docks" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "docks_team_time_idx" ON "docks" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "employee_alias_unique" ON "employee_aliases" USING btree ("employee_id","alias");--> statement-breakpoint
CREATE INDEX "employee_alias_lookup_idx" ON "employee_aliases" USING btree ("alias");--> statement-breakpoint
CREATE INDEX "employees_name_idx" ON "employees" USING btree ("canonical_name");--> statement-breakpoint
CREATE INDEX "employees_active_idx" ON "employees" USING btree ("active");--> statement-breakpoint
CREATE INDEX "leads_employee_time_idx" ON "leads" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "leads_team_time_idx" ON "leads" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE INDEX "media_employee_time_idx" ON "media_activity" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "media_team_time_idx" ON "media_activity" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "membership_employee_team_unique" ON "employee_team_memberships" USING btree ("employee_id","team_id");--> statement-breakpoint
CREATE INDEX "membership_employee_idx" ON "employee_team_memberships" USING btree ("employee_id");--> statement-breakpoint
CREATE INDEX "membership_team_idx" ON "employee_team_memberships" USING btree ("team_id");--> statement-breakpoint
CREATE INDEX "sales_employee_time_idx" ON "sales" USING btree ("employee_id","occurred_at");--> statement-breakpoint
CREATE INDEX "sales_team_time_idx" ON "sales" USING btree ("team_id","occurred_at");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_channel_workspace_id_unique" ON "slack_channels" USING btree ("workspace_id","slack_channel_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_identity_workspace_user_unique" ON "employee_slack_identities" USING btree ("workspace_id","slack_user_id");--> statement-breakpoint
CREATE INDEX "slack_identity_employee_idx" ON "employee_slack_identities" USING btree ("employee_id");--> statement-breakpoint
CREATE UNIQUE INDEX "slack_message_workspace_channel_ts_unique" ON "slack_messages" USING btree ("workspace_id","channel_id","slack_ts");--> statement-breakpoint
CREATE INDEX "slack_message_employee_time_idx" ON "slack_messages" USING btree ("employee_id","posted_at");--> statement-breakpoint
CREATE INDEX "slack_message_channel_time_idx" ON "slack_messages" USING btree ("channel_id","posted_at");--> statement-breakpoint
CREATE INDEX "slack_message_parser_status_idx" ON "slack_messages" USING btree ("parser_status");--> statement-breakpoint
CREATE INDEX "sync_runs_workspace_time_idx" ON "sync_runs" USING btree ("workspace_id","started_at");--> statement-breakpoint
CREATE INDEX "targets_lookup_idx" ON "targets" USING btree ("team_id","employee_id","metric","period");--> statement-breakpoint
CREATE INDEX "teams_division_idx" ON "teams" USING btree ("division_id");
