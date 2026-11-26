-- Source-key tombstones survive deletion-before-ingestion and preserve exact evidence.
CREATE TABLE sale_source_deletions (
  workspace_id text NOT NULL,
  channel_id text NOT NULL,
  slack_ts text NOT NULL,
  deleted_at timestamptz,
  observed_at timestamptz NOT NULL DEFAULT now(),
  evidence jsonb NOT NULL,
  PRIMARY KEY(workspace_id,channel_id,slack_ts)
);
--> statement-breakpoint
-- Explicit audited business resolutions; never infer these from API absence.
CREATE TABLE sale_source_resolutions (
  sale_id uuid PRIMARY KEY REFERENCES sales(id),
  replacement_sale_id uuid NOT NULL REFERENCES sales(id),
  evidence jsonb NOT NULL,
  resolved_at timestamptz NOT NULL DEFAULT now(),
  CHECK(sale_id<>replacement_sale_id)
);
--> statement-breakpoint
ALTER TABLE sale_source_deletions ENABLE ROW LEVEL SECURITY;
ALTER TABLE sale_source_resolutions ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE OR REPLACE VIEW canonical_sales AS
SELECT s.* FROM sales s JOIN (
  SELECT s.id,row_number() OVER (
    PARTITION BY coalesce(l.anchor_sale_id,s.id)
    ORDER BY (a.sale_id IS NOT NULL),s.occurred_at,sm.slack_ts,s.id
  ) position
  FROM sales s LEFT JOIN sale_mirror_links l ON l.sale_id=s.id
  LEFT JOIN sale_source_availability a ON a.sale_id=s.id
  JOIN slack_messages sm ON sm.id=s.slack_message_id
  JOIN slack_channels c ON c.id=sm.channel_id
  WHERE sm.parser_status='PARSED'
    AND NOT EXISTS (SELECT 1 FROM sale_source_deletions d
      WHERE d.workspace_id=sm.workspace_id AND d.channel_id=c.slack_channel_id AND d.slack_ts=sm.slack_ts)
    AND NOT EXISTS (SELECT 1 FROM sale_source_resolutions r WHERE r.sale_id=s.id)
) ranked ON ranked.id=s.id AND ranked.position=1;
