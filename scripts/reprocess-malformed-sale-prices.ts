/** Reprocesses only deterministic zero/null #sales-reporting price failures. */
import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }, { parserRegistry }, { reprocessStoredSlackSource }] = await Promise.all([
  import("drizzle-orm"), import("@/lib/db/client"), import("@/lib/parsers/registry"), import("@/lib/slack/reprocess"),
]);
const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");
const dryRun = process.argv.includes("--dry-run");

try {
  const baseline = await db.execute(sql`select (select count(*)::int from appointments) appointments,
    (select count(*)::int from sales) sales,(select coalesce(sum(amount),0) from sales) revenue,
    (select count(*)::int from leads where counts_toward_kpi) counted_leads,
    (select count(*)::int from employee_team_memberships) memberships`);
  const candidates = await db.execute(sql`select c.slack_channel_id,sm.slack_ts,sm.id,sm.raw_text,sm.posted_at
    from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id
    where c.slack_channel_id='C098D7NHQ69' and coalesce(s.amount,0)=0
      and sm.raw_text ~* '(plan|package|service).{0,80}([-$][[:space:]]*[0-9]|[0-9][[:space:]]*[$]|[0-9][[:space:]]*USD)'`) as unknown as Array<{ slack_channel_id: string; slack_ts: string; id: string; raw_text: string; posted_at: string }>;
  const correctable = candidates.filter((row) => {
    const result = parserRegistry.parse("leadsedge-sale", { rawSourceId: row.id, text: row.raw_text, postedAt: new Date(row.posted_at) });
    return result?.recordType === "SALE" && typeof result.values.amount === "number" && result.values.amount > 0;
  });
  console.log(`${dryRun ? "DRY RUN" : "APPLY"}: ${correctable.length} deterministic sale-price correction(s).`);
  if (!dryRun) for (const row of correctable) await reprocessStoredSlackSource(row.slack_channel_id, row.slack_ts);
  const after = await db.execute(sql`select (select count(*)::int from appointments) appointments,
    (select count(*)::int from sales) sales,(select coalesce(sum(amount),0) from sales) revenue,
    (select count(*)::int from leads where counts_toward_kpi) counted_leads,
    (select count(*)::int from employee_team_memberships) memberships`);
  console.table([{ phase: "before", ...baseline[0] }, { phase: dryRun ? "unchanged" : "after", ...after[0] }]);
} finally { await closeDb(); }
