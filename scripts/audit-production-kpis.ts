import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }, { resolveDateRange }, { occurredAt, operationalShiftFilter }] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/time-ranges"),
  import("@/lib/operational-query"),
]);

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");

const closers = ["Zack Wilson", "Dean Scott", "Cade Callahan", "Dameon Wolfe", "Lars White", "Phillip Stokes", "Ryaan Aamir", "Lena Cross"];
const setters = ["Jordan Jones", "Alex Bosch", "Mike Weston", "Caleb Ford", "Ryan Voss", "Jason Harkins", "Joseph Scott", "Derek Reed"];
const isa = ["Asif Hazoor", "Ali Jan", "Haji Siraj Ahmed", "Araad Rana", "Alishba Ali", "Hamdan Mahmood", "Zeeshan Afsar", "Zaynab Rafaqat", "Aishah Arif"];
const week = resolveDateRange("This Week");
const start = week.start.toISOString();
const end = week.end.toISOString();
const current = (column: string) => operationalShiftFilter(occurredAt(column), start, end);

type Row = Record<string, unknown>;
const rows = (result: unknown) => result as Row[];

async function audit(names: string[], record: "sales" | "appointments" | "leads") {
  const nameList = sql.join(names.map((name) => sql`${name}`), sql`, `);
  return rows(await db!.execute(sql`
    with records as (
      select employee_id,'sales' kind,occurred_at,amount from sales
      union all select employee_id,'appointments',occurred_at,null::numeric from appointments
      union all select employee_id,'leads',occurred_at,null::numeric from leads
    ), raw_counts as (
      select employee_id,count(*)::int raw_messages from slack_messages
      where parser_type like ${record === "sales" ? "%sale%" : record === "appointments" ? "%appointment%" : "leads"}
      group by employee_id
    ), record_counts as (
      select employee_id,count(*)::int parsed_history,
        count(*) filter(where ${current("occurred_at")})::int selected_period,
        coalesce(sum(amount),0)::numeric revenue_history,
        coalesce(sum(amount) filter(where ${current("occurred_at")}),0)::numeric revenue_selected,
        max(occurred_at) latest_record
      from records where kind=${record} group by employee_id
    )
    select e.id,e.canonical_name employee,e.job_title,coalesce(raw.raw_messages,0) raw_messages,
      coalesce(rec.parsed_history,0) parsed_history,coalesce(rec.selected_period,0) selected_period,
      coalesce(rec.revenue_history,0) revenue_history,coalesce(rec.revenue_selected,0) revenue_selected,
      rec.latest_record
    from employees e
    left join raw_counts raw on raw.employee_id=e.id
    left join record_counts rec on rec.employee_id=e.id
    where e.canonical_name in (${nameList})
    order by e.canonical_name
  `));
}

try {
  console.log(`SELECTED PERIOD: ${week.label} (Asia/Karachi)`);
  console.log("CLOSERS");
  console.table(await audit(closers, "sales"));
  console.log("APPOINTMENT SETTERS");
  console.table(await audit(setters, "appointments"));
  console.log("ISA EMPLOYEES");
  console.table(await audit(isa, "leads"));

  console.log("CURRENT SALES EVIDENCE");
  console.table(rows(await db.execute(sql`
    select e.canonical_name employee,s.customer_name,s.package_name,s.amount,s.currency,
      timezone('Asia/Karachi',s.occurred_at) occurred_at_karachi,sm.slack_ts
    from sales s join employees e on e.id=s.employee_id join slack_messages sm on sm.id=s.slack_message_id
    where ${current("s.occurred_at")}
    order by s.occurred_at desc
  `)));

  console.log("UNMATCHED RAW AUTHORS");
  console.table(rows(await db.execute(sql`
    select c.name channel,sm.slack_user_id,count(*)::int raw_messages,
      count(*) filter(where sm.parser_status='PARSED')::int parsed_messages,
      min(sm.posted_at) oldest,max(sm.posted_at) newest
    from slack_messages sm join slack_channels c on c.id=sm.channel_id
    where sm.employee_id is null
    group by c.name,sm.slack_user_id order by raw_messages desc,c.name
  `)));
} finally {
  await closeDb();
}
