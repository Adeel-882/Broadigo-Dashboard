import { desc, lt, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { slackIngestLog } from "@/lib/db/schema";

/**
 * Structured logging and persistence for live Slack webhook deliveries.
 *
 * Every delivery produces exactly one `[slack-event]` line in the runtime log
 * and one row in `slack_ingest_log`, including the deliveries that are ignored,
 * rejected or fail — those were previously invisible because the route answered
 * 200 and discarded the outcome.
 *
 * Nothing here logs a token, signing secret or connection string; only Slack
 * identifiers, the routing decision and the ingestion result are recorded.
 */
export interface SlackEventOutcome {
  eventId?: string | null;
  workspaceId?: string | null;
  slackChannelId?: string | null;
  slackUserId?: string | null;
  slackTs?: string | null;
  routingAction: string;
  result: string;
  reason?: string | null;
  recordType?: string | null;
  workspaceMatched?: boolean | null;
  channelMatched?: boolean | null;
  durationMs?: number | null;
  errorMessage?: string | null;
}

/** Keeps the ledger bounded without needing a scheduled job. */
const RETENTION_DAYS = 14;
const TRIM_PROBABILITY = 0.02;

function formatLine(outcome: SlackEventOutcome) {
  const parts: string[] = ["[slack-event]"];
  const push = (key: string, value: unknown) => {
    if (value === undefined || value === null || value === "") return;
    parts.push(`${key}=${typeof value === "string" && /\s/.test(value) ? JSON.stringify(value) : String(value)}`);
  };
  push("event", outcome.eventId);
  push("team", outcome.workspaceId);
  push("channel", outcome.slackChannelId);
  push("user", outcome.slackUserId);
  push("ts", outcome.slackTs);
  push("action", outcome.routingAction);
  push("result", outcome.result);
  push("reason", outcome.reason);
  push("type", outcome.recordType);
  if (outcome.workspaceMatched === false) push("workspaceMatched", false);
  if (outcome.channelMatched === false) push("channelMatched", false);
  push("ms", outcome.durationMs);
  push("error", outcome.errorMessage);
  return parts.join(" ");
}

/**
 * Emits the log line and persists the outcome. Never throws: a diagnostics
 * failure must not turn into an ingestion failure.
 */
export async function recordSlackEventOutcome(outcome: SlackEventOutcome) {
  const line = formatLine(outcome);
  if (outcome.result === "error" || outcome.errorMessage) console.error(line);
  else console.log(line);

  const db = getDb();
  if (!db) return;
  try {
    await db.insert(slackIngestLog).values({
      eventId: outcome.eventId ?? null,
      workspaceId: outcome.workspaceId ?? null,
      slackChannelId: outcome.slackChannelId ?? null,
      slackUserId: outcome.slackUserId ?? null,
      slackTs: outcome.slackTs ?? null,
      routingAction: outcome.routingAction,
      result: outcome.result,
      reason: outcome.reason ?? null,
      recordType: outcome.recordType ?? null,
      workspaceMatched: outcome.workspaceMatched ?? null,
      channelMatched: outcome.channelMatched ?? null,
      durationMs: outcome.durationMs ?? null,
      errorMessage: outcome.errorMessage ?? null,
    });
    if (Math.random() < TRIM_PROBABILITY) {
      await db.delete(slackIngestLog)
        .where(lt(slackIngestLog.receivedAt, sql`now() - interval '${sql.raw(String(RETENTION_DAYS))} days'`));
    }
  } catch (error) {
    console.error(`[slack-event] result=diagnostics-write-failed error=${error instanceof Error ? error.message : "unknown"}`);
  }
}

export interface SlackIngestDiagnostics {
  recent: Array<Record<string, unknown>>;
  summary: Record<string, unknown> | null;
}

/** Powers the Slack data health console. */
export async function readSlackIngestDiagnostics(limit = 15): Promise<SlackIngestDiagnostics> {
  const db = getDb();
  if (!db) return { recent: [], summary: null };
  const recent = await db.select().from(slackIngestLog).orderBy(desc(slackIngestLog.receivedAt)).limit(limit);
  const [summary] = (await db.execute(sql`
    select
      (select max(received_at) from slack_ingest_log) last_event_received,
      (select max(received_at) from slack_ingest_log where result in ('parsed','unparsed','duplicate')) last_event_accepted,
      (select max(received_at) from slack_ingest_log where result not in ('parsed','unparsed','duplicate')) last_event_rejected,
      (select result from slack_ingest_log order by received_at desc limit 1) last_result,
      (select reason from slack_ingest_log where reason is not null order by received_at desc limit 1) last_reason,
      (select slack_channel_id from slack_ingest_log order by received_at desc limit 1) last_channel,
      (select count(*)::int from slack_ingest_log where received_at > now() - interval '24 hours') deliveries_24h,
      (select count(*)::int from slack_ingest_log where received_at > now() - interval '24 hours' and result = 'error') errors_24h,
      (select count(*)::int from slack_ingest_log where received_at > now() - interval '24 hours' and channel_matched = false) unmatched_channel_24h,
      (select max(imported_at) from slack_messages) last_message_persisted,
      (select max(occurred_at) from (
        select occurred_at from appointments union all select occurred_at from sales
        union all select occurred_at from leads union all select occurred_at from docks
        union all select occurred_at from media_activity) r) last_structured_record
  `)) as unknown as Array<Record<string, unknown>>;
  return { recent: recent as unknown as Array<Record<string, unknown>>, summary: summary ?? null };
}
