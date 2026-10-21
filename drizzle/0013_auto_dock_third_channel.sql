CREATE TABLE auto_dock_call_sources (channel_id text PRIMARY KEY);
INSERT INTO auto_dock_call_sources VALUES ('C098WNHNBR7'),('C0B0P6P7FPG'),('C0BADNJL14L');
CREATE TABLE auto_dock_call_coverage (
  business_date date NOT NULL, workspace_id text NOT NULL,
  channel_id text NOT NULL REFERENCES auto_dock_call_sources(channel_id),
  fetched_at timestamptz NOT NULL, message_count integer NOT NULL,
  PRIMARY KEY(business_date,workspace_id,channel_id)
);
--> statement-breakpoint
CREATE FUNCTION guard_auto_dock_call_coverage() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS(SELECT 1 FROM auto_dock_call_sources s WHERE NOT EXISTS(
    SELECT 1 FROM auto_dock_call_coverage c JOIN auto_dock_settings settings ON settings.id=1
    WHERE c.channel_id=s.channel_id AND c.workspace_id=settings.workspace_id AND c.business_date=NEW.business_date)) THEN
    RAISE EXCEPTION 'Complete coverage of every authorized call channel required';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER automatic_dock_call_coverage_guard BEFORE INSERT OR UPDATE ON automatic_docks
FOR EACH ROW EXECUTE FUNCTION guard_auto_dock_call_coverage();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION queue_auto_dock_activity() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source_id uuid; day date; cutoff date;
BEGIN
  SELECT calls_rule_effective_from INTO cutoff FROM auto_dock_settings WHERE id=1;
  FOR source_id IN SELECT DISTINCT v FROM unnest(ARRAY[
    CASE WHEN TG_OP <> 'INSERT' THEN OLD.slack_message_id ELSE NULL END,
    CASE WHEN TG_OP <> 'DELETE' THEN NEW.slack_message_id ELSE NULL END
  ]) v WHERE v IS NOT NULL LOOP
    SELECT (sm.posted_at AT TIME ZONE 'Asia/Karachi' - interval '5 hours')::date INTO day
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
  FOR day IN SELECT DISTINCT (v AT TIME ZONE 'Asia/Karachi' - interval '5 hours')::date
    FROM unnest(ARRAY[OLD.posted_at,NEW.posted_at]) v LOOP
    IF day >= cutoff THEN
      INSERT INTO auto_dock_pending(business_date) VALUES(day)
      ON CONFLICT(business_date) DO UPDATE SET requested_at=clock_timestamp();
    END IF;
  END LOOP;
  RETURN NULL;
END $$;
