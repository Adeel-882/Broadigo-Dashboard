CREATE TABLE "slack_ingest_log" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"event_id" text,
	"workspace_id" text,
	"slack_channel_id" text,
	"slack_user_id" text,
	"slack_ts" text,
	"routing_action" text NOT NULL,
	"result" text NOT NULL,
	"reason" text,
	"record_type" text,
	"workspace_matched" boolean,
	"channel_matched" boolean,
	"duration_ms" integer,
	"error_message" text
);
--> statement-breakpoint
CREATE INDEX "slack_ingest_log_received_idx" ON "slack_ingest_log" USING btree ("received_at");