import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }, shift] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/time-ranges"),
]);

const timezoneSql = sql.raw(`'${shift.DASHBOARD_TIMEZONE}'`);
const operationalOffsetSql = sql.raw(`interval '${shift.SHIFT_END_HOUR} hours'`);
const shiftStartSql = sql.raw(`time '${shift.SHIFT_START_TIME}'`);
const shiftEndSql = sql.raw(`time '${shift.SHIFT_END_TIME}'`);

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");
const rows = (result: unknown) => result as Array<Record<string, unknown>>;

try {
  const midnightGroups = await db.execute(sql`
    with eligible_sales as (
      select s.id, e.canonical_name employee, s.customer_name, s.amount, s.currency, s.occurred_at,
        timezone(${timezoneSql}, s.occurred_at) local_timestamp,
        (timezone(${timezoneSql}, s.occurred_at) - ${operationalOffsetSql})::date operational_date
      from sales s left join employees e on e.id=s.employee_id
      where timezone(${timezoneSql}, s.occurred_at)::time >= ${shiftStartSql}
        or timezone(${timezoneSql}, s.occurred_at)::time < ${shiftEndSql}
    )
    select employee, operational_date, count(*)::int sales, coalesce(sum(amount),0)::numeric revenue,
      min(local_timestamp) first_local_timestamp, max(local_timestamp) last_local_timestamp,
      array_agg(customer_name order by local_timestamp) customers
    from eligible_sales
    group by employee, operational_date
    having count(distinct local_timestamp::date) > 1
    order by operational_date desc, employee`);

  console.log("\nSALES GROUPS THAT SPAN CALENDAR MIDNIGHT WITHIN ONE OPERATIONAL SHIFT");
  console.table(rows(midnightGroups));

  const boundaryEvidence = await db.execute(sql`
    select e.canonical_name employee, s.customer_name, s.amount, s.currency, s.occurred_at utc_timestamp,
      timezone(${timezoneSql}, s.occurred_at) local_timestamp,
      (timezone(${timezoneSql}, s.occurred_at) - ${operationalOffsetSql})::date operational_date,
      case when timezone(${timezoneSql}, s.occurred_at)::time >= ${shiftStartSql}
        or timezone(${timezoneSql}, s.occurred_at)::time < ${shiftEndSql} then 'IN_SHIFT' else 'OUTSIDE_SHIFT' end shift_status
    from sales s left join employees e on e.id=s.employee_id
    where timezone(${timezoneSql}, s.occurred_at)::time >= ${shiftStartSql}
       or timezone(${timezoneSql}, s.occurred_at)::time < ${shiftEndSql}
    order by s.occurred_at desc`);

  console.log("\nALL SHIFT-ELIGIBLE SALES WITH PRESERVED UTC/LOCAL TIMESTAMPS");
  console.table(rows(boundaryEvidence));
} finally {
  await closeDb();
}
