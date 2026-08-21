ALTER TABLE "leads" ADD COLUMN "counts_toward_kpi" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "leads" ADD COLUMN "exclusion_reasons" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_messages" ADD COLUMN "reactions" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "slack_messages" ADD COLUMN "reactions_synced_at" timestamp with time zone;--> statement-breakpoint
CREATE INDEX "leads_kpi_time_idx" ON "leads" USING btree ("counts_toward_kpi","occurred_at");