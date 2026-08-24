/** Read-only audit for structured sales whose source appears to contain a sale price. */
import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }, { parserRegistry }, { resolveDateRange }] = await Promise.all([import("drizzle-orm"), import("@/lib/db/client"), import("@/lib/parsers/registry"), import("@/lib/time-ranges")]);
const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");

try {
  const exact = await db.execute(sql`select 'SALE' record_type,e.canonical_name employee,s.customer_name,s.package_name,
      s.amount,s.currency,sm.raw_text,sm.parser_status,sm.validation_warnings
    from slack_messages sm join slack_channels c on c.id=sm.channel_id
    left join sales s on s.slack_message_id=sm.id left join employees e on e.id=s.employee_id
    where c.slack_channel_id='C098D7NHQ69' and sm.slack_ts='1787607106.312669'`);
  console.log("EXACT SOURCE");
  console.table(exact);

  const malformed = await db.execute(sql`select s.id,sm.slack_ts,e.canonical_name employee,s.customer_name,s.package_name,s.amount,
      sm.raw_text,sm.validation_warnings
    from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id
    left join employees e on e.id=s.employee_id
    where c.slack_channel_id='C098D7NHQ69' and coalesce(s.amount,0)=0
      and sm.raw_text ~* '(plan|package|service).{0,80}([-$][[:space:]]*[0-9]|[0-9][[:space:]]*[$]|[0-9][[:space:]]*USD)'
    order by sm.posted_at`);
  console.log("DETERMINISTIC ZERO/NULL PRICE CANDIDATES");
  console.table(malformed.map((row) => {
    const parsed = parserRegistry.parse("leadsedge-sale", { rawSourceId: String(row.id), text: String(row.raw_text), postedAt: new Date() });
    return { ...row, corrected_amount: parsed?.values.amount ?? null, corrected_warnings: parsed?.warnings ?? [] };
  }));

  const today = resolveDateRange("Today");
  const start = today.start.toISOString(); const end = today.end.toISOString();
  const todayResult = await db.execute(sql`select count(*)::int sales,coalesce(sum(s.amount),0) revenue,
      coalesce(avg(s.amount),0) average_sale_value,
      coalesce(sum(s.amount) filter(where e.canonical_name='Dameon Wolfe'),0) dameon_revenue
    from sales s left join employees e on e.id=s.employee_id
    where s.occurred_at>=${start}::timestamptz and s.occurred_at<${end}::timestamptz`);
  console.log(`TODAY ${today.startDate}`);
  console.table(todayResult);
} finally { await closeDb(); }
