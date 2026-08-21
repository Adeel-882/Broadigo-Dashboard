/**
 * Backfills Slack reactions and the derived lead KPI eligibility.
 *
 * Idempotent: it reads the current reactions from Slack, writes them onto the
 * raw message rows, and recomputes `counts_toward_kpi` / `exclusion_reasons` on
 * the structured leads. Running it twice in a row changes nothing the second
 * time. It never inserts or deletes raw messages or structured leads, and never
 * touches appointments, sales, docks or media activity.
 *
 *   pnpm leads:backfill-reactions --dry-run   report what would change
 *   pnpm leads:backfill-reactions             apply the changes
 */
import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

import type { SlackReaction } from "@/lib/slack/reactions";

const [{ eq, sql }, { closeDb, getDb }, { deriveLeadEligibility, reactionsFingerprint }, schema] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/slack/reactions"),
  import("@/lib/db/schema"),
]);
const { leads, slackChannels, slackMessages } = schema;

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");
const token = process.env.SLACK_BOT_TOKEN;
if (!token) throw new Error("SLACK_BOT_TOKEN is required.");

const dryRun = process.argv.includes("--dry-run");
const rows = (result: unknown) => result as Array<Record<string, unknown>>;

async function fetchChannelReactions(slackChannelId: string) {
  const byTs = new Map<string, SlackReaction[]>();
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ channel: slackChannelId, limit: "200" });
    if (cursor) params.set("cursor", cursor);
    let response = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (response.status === 429) {
      const wait = Math.max(1, Number(response.headers.get("retry-after") ?? 1));
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      response = await fetch(`https://slack.com/api/conversations.history?${params}`, {
        headers: { authorization: `Bearer ${token}` }, cache: "no-store",
      });
    }
    const payload = await response.json() as {
      ok: boolean; error?: string;
      messages?: Array<{ ts: string; reactions?: SlackReaction[] }>;
      response_metadata?: { next_cursor?: string };
    };
    if (!payload.ok) {
      throw new Error(payload.error === "missing_scope"
        ? "Slack rejected the request for missing scope. Add the reactions:read bot scope and reinstall the app to the workspace."
        : `Slack conversations.history failed: ${payload.error ?? "unknown"}`);
    }
    for (const message of payload.messages ?? []) byTs.set(message.ts, message.reactions ?? []);
    cursor = payload.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return byTs;
}

const sameReasons = (a: string[] | null | undefined, b: string[]) => JSON.stringify(a ?? []) === JSON.stringify(b);

/** Writes in chunks: one UPDATE ... FROM (VALUES ...) beats a round trip per row. */
async function flushReactions(pending: Array<{ id: string; reactions: SlackReaction[] }>) {
  for (let index = 0; index < pending.length; index += 200) {
    const chunk = pending.slice(index, index + 200);
    const values = sql.join(chunk.map((row) => sql`(${row.id}::uuid, ${JSON.stringify(row.reactions)}::jsonb)`), sql`, `);
    await db!.execute(sql`update slack_messages sm set reactions = v.reactions, reactions_synced_at = now()
      from (values ${values}) as v(id, reactions) where sm.id = v.id`);
  }
}

async function flushEligibility(pending: Array<{ id: string; countsTowardKpi: boolean; exclusionReasons: string[] }>) {
  for (let index = 0; index < pending.length; index += 200) {
    const chunk = pending.slice(index, index + 200);
    const values = sql.join(chunk.map((row) => sql`(${row.id}::uuid, ${row.countsTowardKpi}::boolean, ${JSON.stringify(row.exclusionReasons)}::jsonb)`), sql`, `);
    await db!.execute(sql`update leads l set counts_toward_kpi = v.counts, exclusion_reasons = v.reasons
      from (values ${values}) as v(id, counts, reasons) where l.slack_message_id = v.id`);
  }
}

try {
  const channels = await db.select().from(slackChannels)
    .where(sql`${slackChannels.parserType} = 'leads' and ${slackChannels.active} = true`);
  if (!channels.length) throw new Error("No active leads channel is configured.");

  let messagesScanned = 0; let reactionsWritten = 0; let eligibilityWritten = 0;
  let nowExcluded = 0; let nowCounted = 0; let missingInSlack = 0;

  for (const channel of channels) {
    console.log(`Reading current reactions from #${channel.name} ...`);
    const byTs = await fetchChannelReactions(channel.slackChannelId);
    console.log(`  Slack returned ${byTs.size} messages.`);

    const stored = await db.select({
      id: slackMessages.id, slackTs: slackMessages.slackTs, reactions: slackMessages.reactions,
    }).from(slackMessages).where(eq(slackMessages.channelId, channel.id));

    const leadRows = await db.select({
      slackMessageId: leads.slackMessageId, countsTowardKpi: leads.countsTowardKpi, exclusionReasons: leads.exclusionReasons,
    }).from(leads);
    const leadByMessage = new Map(leadRows.map((row) => [row.slackMessageId, row]));
    const pendingReactions: Array<{ id: string; reactions: SlackReaction[] }> = [];
    const pendingEligibility: Array<{ id: string; countsTowardKpi: boolean; exclusionReasons: string[] }> = [];

    for (const message of stored) {
      messagesScanned += 1;
      const current = byTs.get(message.slackTs);
      if (current === undefined) { missingInSlack += 1; continue; }

      const reactionsChanged = reactionsFingerprint(message.reactions) !== reactionsFingerprint(current);
      const lead = leadByMessage.get(message.id);
      const eligibility = deriveLeadEligibility(current);
      const eligibilityChanged = Boolean(lead)
        && (lead!.countsTowardKpi !== eligibility.countsTowardKpi || !sameReasons(lead!.exclusionReasons, eligibility.exclusionReasons));

      if (reactionsChanged) { reactionsWritten += 1; pendingReactions.push({ id: message.id, reactions: current }); }
      if (eligibilityChanged) {
        eligibilityWritten += 1;
        if (lead!.countsTowardKpi && !eligibility.countsTowardKpi) nowExcluded += 1;
        if (!lead!.countsTowardKpi && eligibility.countsTowardKpi) nowCounted += 1;
        pendingEligibility.push({ id: message.id, ...eligibility });
      }
    }

    if (!dryRun) { await flushReactions(pendingReactions); await flushEligibility(pendingEligibility); }
  }

  console.log(`\n${dryRun ? "DRY RUN — nothing was written" : "BACKFILL APPLIED"}`);
  console.table([{
    messages_scanned: messagesScanned,
    reaction_rows_updated: reactionsWritten,
    lead_eligibility_rows_updated: eligibilityWritten,
    became_excluded: nowExcluded,
    became_counted: nowCounted,
    messages_not_returned_by_slack: missingInSlack,
  }]);

  const summary = rows(await db.execute(sql`
    select count(*)::int total_leads,
      count(*) filter (where counts_toward_kpi)::int counted,
      count(*) filter (where not counts_toward_kpi)::int excluded
    from leads`));
  console.log("Structured lead totals after this run (all history):");
  console.table(summary);
} finally {
  await closeDb();
}
