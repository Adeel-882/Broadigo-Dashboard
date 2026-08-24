/** Read-only production verification for monthly targets and assigned calls. */
import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
]);

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");
const rows = (value: unknown) => value as Array<Record<string, unknown>>;

try {
  const schema = rows(await db.execute(sql`
    select column_name from information_schema.columns
    where table_schema='public' and table_name='appointments'
      and column_name in ('scheduled_at','scheduled_text') order by column_name`));
  const counts = rows(await db.execute(sql`
    select
      (select count(*)::int from appointments) appointments,
      (select count(*)::int from sales) sales,
      (select coalesce(sum(amount),0)::numeric from sales) revenue,
      (select count(*)::int from leads where counts_toward_kpi=true) counted_leads,
      (select count(*)::int from leads where counts_toward_kpi=true
        and occurred_at >= '2026-08-01T14:00:00Z' and occurred_at < '2026-09-01T14:00:00Z') august_counted_leads,
      (select count(*)::int from employee_team_memberships) memberships`));
  const callSources = rows(await db.execute(sql`
    select c.name channel, c.slack_channel_id, count(*)::int appointments,
      count(a.assigned_person)::int assigned, count(a.scheduled_at)::int scheduled_at,
      count(a.scheduled_text)::int scheduled_text
    from appointments a join slack_messages sm on sm.id=a.slack_message_id
      join slack_channels c on c.id=sm.channel_id
    where c.slack_channel_id in ('C098WNHNBR7','C0B0P6P7FPG')
    group by c.name,c.slack_channel_id order by c.name`));

  const examples = rows(await db.execute(sql`
    select e.canonical_name employee, e.job_title role,
      coalesce((select sum(s.amount) from sales s where s.employee_id=e.id
        and s.occurred_at >= '2026-08-01T14:00:00Z' and s.occurred_at < '2026-09-01T14:00:00Z'),0)::numeric revenue,
      (select count(*)::int from sales s where s.employee_id=e.id
        and s.occurred_at >= '2026-08-01T14:00:00Z' and s.occurred_at < '2026-09-01T14:00:00Z') closed_sales,
      (select count(*)::int from appointments a where a.employee_id=e.id
        and a.occurred_at >= '2026-08-01T14:00:00Z' and a.occurred_at < '2026-09-01T14:00:00Z') appointments_booked,
      (select count(*)::int from leads l where l.employee_id=e.id and l.counts_toward_kpi=true
        and l.occurred_at >= '2026-08-01T14:00:00Z' and l.occurred_at < '2026-09-01T14:00:00Z') counted_leads
    from employees e where e.canonical_name in ('Dameon Wolfe','Zack Wilson','Aishah Arif','Caleb Ford')
    order by e.canonical_name`));
  const calls = rows(await db.execute(sql`
    select assignee.canonical_name assigned_to, setter.canonical_name setter,
      a.prospect_name prospect, a.scheduled_text, a.scheduled_at,
      c.name channel, c.slack_channel_id, sm.slack_ts
    from appointments a join slack_messages sm on sm.id=a.slack_message_id
      join slack_channels c on c.id=sm.channel_id
      join employee_slack_identities si on si.slack_user_id=a.assigned_person
      join employees assignee on assignee.id=si.employee_id
      left join employees setter on setter.id=a.employee_id
    where c.slack_channel_id in ('C098WNHNBR7','C0B0P6P7FPG')
      and assignee.canonical_name in ('Dameon Wolfe','Zack Wilson','Lars White')
    order by coalesce(a.scheduled_at,a.occurred_at) desc limit 20`));

  console.log("APPOINTMENT SCHEMA");
  console.table(schema);
  console.log("KPI BASELINE");
  console.table(counts);
  console.log("SCHEDULED-CALL SOURCES");
  console.table(callSources);
  console.log("EMPLOYEE EXAMPLES");
  console.table(examples);
  console.log("ASSIGNED-CALL EXAMPLES");
  console.table(calls);
  if (process.argv.includes("--raw")) {
    const rawExamples = rows(await db.execute(sql`
      select a.prospect_name prospect, c.name channel, sm.raw_text
      from appointments a join slack_messages sm on sm.id=a.slack_message_id
        join slack_channels c on c.id=sm.channel_id
      where c.slack_channel_id in ('C098WNHNBR7','C0B0P6P7FPG')
        and a.prospect_name in ('Todd Walter','Ivette Ramirez','anne leon','Judith Smith')
      order by a.occurred_at desc`));
    console.log("RAW EXAMPLES — INTERNAL ONLY");
    console.dir(rawExamples, { depth: 3 });
  }
} finally {
  await closeDb();
}
