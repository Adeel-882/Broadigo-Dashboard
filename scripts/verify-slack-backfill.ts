import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const { sql } = await import("drizzle-orm");
const { getDb, closeDb } = await import("@/lib/db/client");
const { resolveDateRange } = await import("@/lib/time-ranges");
const { occurredAt, operationalShiftFilter } = await import("@/lib/operational-query");

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");

const rows = (result: unknown) => result as Array<Record<string, unknown>>;

try {
  const employeeMetrics = await db.execute(sql`
    with appointment_totals as (select employee_id, count(*)::int appointments from appointments group by employee_id),
    sale_totals as (select employee_id, count(*)::int sales, coalesce(sum(amount),0)::numeric revenue from sales group by employee_id),
    lead_totals as (select employee_id, count(*)::int leads from leads group by employee_id),
    dock_totals as (select employee_id, count(*)::int docks from docks group by employee_id),
    media_totals as (select employee_id, count(*)::int media from media_activity group by employee_id)
    select e.canonical_name employee, e.job_title,
      coalesce(a.appointments,0)::int appointments, coalesce(s.sales,0)::int sales,
      coalesce(s.revenue,0)::numeric revenue, coalesce(l.leads,0)::int leads,
      coalesce(d.docks,0)::int docks, coalesce(m.media,0)::int media
    from employees e
    left join appointment_totals a on a.employee_id=e.id
    left join sale_totals s on s.employee_id=e.id
    left join lead_totals l on l.employee_id=e.id
    left join dock_totals d on d.employee_id=e.id
    left join media_totals m on m.employee_id=e.id
    where coalesce(a.appointments,0)+coalesce(s.sales,0)+coalesce(l.leads,0)+coalesce(d.docks,0)+coalesce(m.media,0)>0
    order by e.canonical_name`);

  console.log("\nEMPLOYEES WITH HISTORICAL STRUCTURED METRICS");
  console.table(rows(employeeMetrics));

  const integrity = await db.execute(sql`
    select
      (select count(*)::int from slack_messages) raw_messages,
      (select count(*)::int from slack_messages sm
        left join appointments a on a.slack_message_id=sm.id
        left join sales s on s.slack_message_id=sm.id
        left join leads l on l.slack_message_id=sm.id
        left join docks d on d.slack_message_id=sm.id
        left join media_activity m on m.slack_message_id=sm.id
        where sm.parser_status='PARSED' and a.id is null and s.id is null and l.id is null and d.id is null and m.id is null) parsed_without_structured,
      (select count(*)::int from slack_messages sm
        left join appointments a on a.slack_message_id=sm.id
        left join sales s on s.slack_message_id=sm.id
        left join leads l on l.slack_message_id=sm.id
        left join docks d on d.slack_message_id=sm.id
        left join media_activity m on m.slack_message_id=sm.id
        where sm.parser_status<>'PARSED' and (a.id is not null or s.id is not null or l.id is not null or d.id is not null or m.id is not null)) nonparsed_with_structured,
      (select count(*)::int from (
        select slack_message_id from appointments group by slack_message_id having count(*)>1
        union all select slack_message_id from sales group by slack_message_id having count(*)>1
        union all select slack_message_id from leads group by slack_message_id having count(*)>1
        union all select slack_message_id from docks group by slack_message_id having count(*)>1
        union all select slack_message_id from media_activity group by slack_message_id having count(*)>1
      ) duplicates) duplicate_derived_keys,
      (select count(*)::int from (
        select a.employee_id record_employee, sm.employee_id message_employee from appointments a join slack_messages sm on sm.id=a.slack_message_id
        union all select s.employee_id, sm.employee_id from sales s join slack_messages sm on sm.id=s.slack_message_id
        union all select l.employee_id, sm.employee_id from leads l join slack_messages sm on sm.id=l.slack_message_id
        union all select m.employee_id, sm.employee_id from media_activity m join slack_messages sm on sm.id=m.slack_message_id
      ) author_records where record_employee is distinct from message_employee) author_attribution_mismatches,
      (select count(*)::int from docks d join slack_messages sm on sm.id=d.slack_message_id
        where d.employee_id is not null and not exists (
          select 1 from employee_slack_identities si where si.employee_id=d.employee_id
            and si.workspace_id=sm.workspace_id and sm.raw_text like '%<@' || si.slack_user_id || '>%'
        )) dock_target_mismatches`);

  console.log("\nBACKFILL INTEGRITY");
  console.table(rows(integrity));

  const periods = ["Today", "Yesterday", "This Week", "Last Week", "This Month", "Last Month"] as const;
  const periodVisibility: Array<Record<string, unknown>> = [];
  for (const period of periods) {
    const range = resolveDateRange(period);
    const start = range.start.toISOString();
    const end = range.end.toISOString();
    const current = operationalShiftFilter(occurredAt("occurred_at"), start, end);
    const result = await db.execute(sql`
      select
        count(*) filter(where kind='appointments')::int appointments,
        count(*) filter(where kind='sales')::int sales,
        count(*) filter(where kind='leads')::int leads,
        count(*) filter(where kind='docks')::int docks,
        count(*) filter(where kind='media')::int media
      from (
        select 'appointments' kind, occurred_at from appointments
        union all select 'sales', occurred_at from sales
        union all select 'leads', occurred_at from leads
        union all select 'docks', occurred_at from docks
        union all select 'media', occurred_at from media_activity
      ) activity where ${current}`);
    periodVisibility.push({ period, range: range.label, ...(rows(result)[0] ?? {}) });
  }

  const customRange = resolveDateRange("Custom Range", "2026-05-01", "2026-08-20");
  const customStart = customRange.start.toISOString();
  const customEnd = customRange.end.toISOString();
  const customFilter = operationalShiftFilter(occurredAt("occurred_at"), customStart, customEnd);
  const customResult = await db.execute(sql`
    select count(*) filter(where kind='appointments')::int appointments,
      count(*) filter(where kind='sales')::int sales, count(*) filter(where kind='leads')::int leads,
      count(*) filter(where kind='docks')::int docks, count(*) filter(where kind='media')::int media
    from (
      select 'appointments' kind, occurred_at from appointments
      union all select 'sales', occurred_at from sales
      union all select 'leads', occurred_at from leads
      union all select 'docks', occurred_at from docks
      union all select 'media', occurred_at from media_activity
    ) activity where ${customFilter}`);
  periodVisibility.push({ period: "Custom Range", range: customRange.label, ...(rows(customResult)[0] ?? {}) });

  console.log("\nASIA/KARACHI DATE-FILTER VISIBILITY");
  console.table(periodVisibility);
} finally {
  await closeDb();
}
