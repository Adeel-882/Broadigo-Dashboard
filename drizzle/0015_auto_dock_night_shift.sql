-- Source-time shift mapping; NULL excludes daytime activity. No financial rows changed.
CREATE FUNCTION auto_dock_business_date(source_at timestamptz) RETURNS date
LANGUAGE sql IMMUTABLE STRICT AS $$
 SELECT CASE WHEN (source_at AT TIME ZONE 'Asia/Karachi')::time >= time '19:00'
 THEN (source_at AT TIME ZONE 'Asia/Karachi')::date
 WHEN (source_at AT TIME ZONE 'Asia/Karachi')::time < time '04:00'
 THEN (source_at AT TIME ZONE 'Asia/Karachi')::date - 1 ELSE NULL END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION queue_auto_dock_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; day date; cutoff date;
BEGIN
  SELECT calls_rule_effective_from INTO cutoff FROM auto_dock_settings WHERE id=1;
  FOR source_id IN SELECT DISTINCT v FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.slack_message_id ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.slack_message_id ELSE NULL END
  ]) v WHERE v IS NOT NULL LOOP
    SELECT auto_dock_business_date(sm.posted_at) INTO day
    FROM slack_messages sm JOIN slack_channels c ON c.id=sm.channel_id
    JOIN auto_dock_call_sources s ON s.channel_id=c.slack_channel_id WHERE sm.id=source_id;
    IF day >= cutoff THEN
      INSERT INTO auto_dock_pending(business_date) VALUES(day)
      ON CONFLICT(business_date) DO UPDATE SET requested_at=clock_timestamp();
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION queue_auto_dock_source_change() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE day date; cutoff date;
BEGIN
  IF NOT EXISTS(SELECT 1 FROM slack_channels c JOIN auto_dock_call_sources s ON s.channel_id=c.slack_channel_id WHERE c.id=NEW.channel_id)
    OR NOT EXISTS(SELECT 1 FROM appointments a WHERE a.slack_message_id=NEW.id) THEN RETURN NULL; END IF;
  SELECT calls_rule_effective_from INTO cutoff FROM auto_dock_settings WHERE id=1;
  FOR day IN SELECT DISTINCT auto_dock_business_date(v)
    FROM unnest(ARRAY[OLD.posted_at,NEW.posted_at]) v LOOP
    IF day >= cutoff THEN
      INSERT INTO auto_dock_pending(business_date) VALUES(day)
      ON CONFLICT(business_date) DO UPDATE SET requested_at=clock_timestamp();
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
