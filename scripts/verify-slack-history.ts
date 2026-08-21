import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const token = process.env.SLACK_BOT_TOKEN;
if (!token) throw new Error("SLACK_BOT_TOKEN is required.");

const [{ and, eq }, { closeDb, getDb }, { slackChannels, slackMessages }] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/db/schema"),
]);
const { isEligibleTopLevelMessage } = await import("@/lib/slack/message-eligibility");

const REPORTING_CHANNELS = [
  "broadigo-media",
  "broadigo-sale-development-general",
  "broadigo-sales-reporting",
  "broadigomedia-sales-development-general",
  "docks-reporting",
  "leads-reporting",
  "sales-development-general",
  "sales-reporting",
] as const;

type SlackHistoryMessage = {
  ts?: string;
  text?: string;
  thread_ts?: string;
  subtype?: string;
};

type SlackHistoryResponse = {
  ok: boolean;
  error?: string;
  has_more?: boolean;
  messages?: SlackHistoryMessage[];
  response_metadata?: { next_cursor?: string };
};

type AuditRow = {
  channel: string;
  slack_api_total: number;
  database_raw_total: number;
  difference: number;
  oldest_slack_timestamp: string;
  oldest_database_timestamp: string;
  newest_slack_timestamp: string;
  newest_database_timestamp: string;
  status: "COMPLETE" | "INCOMPLETE";
};

type DiscrepancyRow = {
  channel: string;
  missing_from_database: number;
  database_only: number;
};

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");

function eligible(message: SlackHistoryMessage): message is SlackHistoryMessage & { ts: string; text: string } {
  // Thread roots can have thread_ts === ts after replies are added; only true replies stay excluded.
  return isEligibleTopLevelMessage(message);
}

function slackTimestampToIso(timestamp: string | undefined) {
  if (!timestamp) return "—";
  return new Date(Number.parseFloat(timestamp) * 1000).toISOString();
}

function databaseTimestampToIso(timestamp: Date | undefined) {
  return timestamp ? timestamp.toISOString() : "—";
}

async function fetchHistoryPage(channelId: string, cursor: string, latest: string) {
  const params = new URLSearchParams({ channel: channelId, limit: "100", latest });
  if (cursor) params.set("cursor", cursor);

  let rateLimitCount = 0;
  for (;;) {
    const response = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { authorization: `Bearer ${token}` },
      cache: "no-store",
    });
    if (response.status === 429) {
      rateLimitCount += 1;
      const fallbackSeconds = 30 * (2 ** Math.min(rateLimitCount - 1, 2));
      const retryAfter = Number(response.headers.get("retry-after"));
      const waitSeconds = Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : fallbackSeconds;
      console.log(`Slack rate limit reached; waiting ${waitSeconds}s before retrying this page.`);
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      continue;
    }
    const payload = await response.json() as SlackHistoryResponse;
    if (!response.ok || !payload.ok) {
      throw new Error(`Slack conversations.history failed: ${payload.error ?? response.status}`);
    }
    return payload;
  }
}

async function fetchCompleteEligibleHistory(channelName: string, channelId: string, latest: string) {
  const timestamps = new Set<string>();
  const seenCursors = new Set<string>();
  let cursor = "";
  let pages = 0;

  for (;;) {
    const payload = await fetchHistoryPage(channelId, cursor, latest);
    pages += 1;
    for (const message of payload.messages ?? []) if (eligible(message)) timestamps.add(message.ts);

    const nextCursor = payload.response_metadata?.next_cursor?.trim() ?? "";
    console.log(`#${channelName}: page ${pages}, ${timestamps.size} eligible message(s) so far`);
    if (payload.has_more === false || !nextCursor) break;
    if (seenCursors.has(nextCursor)) throw new Error(`Slack returned a repeated cursor for #${channelName}.`);
    seenCursors.add(nextCursor);
    cursor = nextCursor;
  }

  return [...timestamps].sort((left, right) => Number.parseFloat(left) - Number.parseFloat(right));
}

try {
  const configured = await db.select().from(slackChannels).where(eq(slackChannels.active, true));
  const configuredByName = new Map(configured.map((channel) => [channel.name, channel]));
  const unexpected = configured.filter((channel) => !REPORTING_CHANNELS.includes(channel.name as typeof REPORTING_CHANNELS[number]));
  if (configured.length !== REPORTING_CHANNELS.length || unexpected.length) {
    throw new Error(`Expected exactly the 8 reporting channels to be active; found ${configured.length}.`);
  }

  const auditStartedAt = String(Date.now() / 1000);
  const results: AuditRow[] = [];
  const discrepancies: DiscrepancyRow[] = [];

  for (const channelName of REPORTING_CHANNELS) {
    const channel = configuredByName.get(channelName);
    if (!channel) throw new Error(`Active database mapping missing for #${channelName}.`);

    const slackTimestamps = await fetchCompleteEligibleHistory(channelName, channel.slackChannelId, auditStartedAt);
    const stored = await db.select({ slackTs: slackMessages.slackTs, postedAt: slackMessages.postedAt })
      .from(slackMessages)
      .where(and(eq(slackMessages.workspaceId, channel.workspaceId), eq(slackMessages.channelId, channel.id)));
    const databaseTimestamps = new Set(stored.map((message) => message.slackTs));
    const slackTimestampSet = new Set(slackTimestamps);
    const missingFromDatabase = slackTimestamps.filter((timestamp) => !databaseTimestamps.has(timestamp));
    const extraInDatabase = stored.filter((message) => !slackTimestampSet.has(message.slackTs));
    const sortedDatabase = [...stored].sort((left, right) => left.postedAt.getTime() - right.postedAt.getTime());

    results.push({
      channel: channelName,
      slack_api_total: slackTimestamps.length,
      database_raw_total: stored.length,
      difference: slackTimestamps.length - stored.length,
      oldest_slack_timestamp: slackTimestampToIso(slackTimestamps[0]),
      oldest_database_timestamp: databaseTimestampToIso(sortedDatabase[0]?.postedAt),
      newest_slack_timestamp: slackTimestampToIso(slackTimestamps.at(-1)),
      newest_database_timestamp: databaseTimestampToIso(sortedDatabase.at(-1)?.postedAt),
      status: missingFromDatabase.length === 0 ? "COMPLETE" : "INCOMPLETE",
    });
    if (missingFromDatabase.length || extraInDatabase.length) {
      discrepancies.push({
        channel: channelName,
        missing_from_database: missingFromDatabase.length,
        database_only: extraInDatabase.length,
      });
    }
  }

  console.log("\nHISTORICAL SLACK IMPORT COMPLETENESS");
  console.log("COMPLETE means every currently available eligible Slack message is stored; database-only evidence is preserved.");
  console.table(results);
  if (discrepancies.length) {
    console.log("\nTIMESTAMP-SET DISCREPANCIES (DIAGNOSTIC)");
    console.table(discrepancies);
  }
} finally {
  await closeDb();
}
