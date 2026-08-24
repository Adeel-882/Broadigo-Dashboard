/** Read-only production verification for employee target numerators. */
import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }] = await Promise.all([
  import("drizzle-orm"), import("@/lib/db/client"),
]);
const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");

try {
  const ranges = [["2026-08-11", "2026-08-25"], ["2026-08-01", "2026-08-25"]] as const;
  const output: Array<Record<string, unknown>> = [];
  for (const [start, end] of ranges) {
    const startAt = `${start}T14:00:00.000Z`;
    const endAt = new Date(new Date(`${end}T00:00:00.000Z`).getTime() + 24 * 60 * 60 * 1000).toISOString();
    const rows = await db.execute(sql`select e.canonical_name employee,e.job_title role,
      (select coalesce(sum(s.amount),0) from sales s where s.employee_id=e.id and s.occurred_at>=${startAt}::timestamptz and s.occurred_at<${endAt}::timestamptz) revenue,
      (select count(*) from sales s where s.employee_id=e.id and s.occurred_at>=${startAt}::timestamptz and s.occurred_at<${endAt}::timestamptz) sales,
      (select count(*) from appointments a where a.employee_id=e.id and a.qualification_status='QUALIFIED' and a.occurred_at>=${startAt}::timestamptz and a.occurred_at<${endAt}::timestamptz) qualified_calls,
      (select count(*) from leads l where l.employee_id=e.id and l.counts_toward_kpi=true and l.occurred_at>=${startAt}::timestamptz and l.occurred_at<${endAt}::timestamptz) counted_leads,
      (select count(*) from leads l where l.counts_toward_kpi=true and l.occurred_at>=${startAt}::timestamptz and l.occurred_at<${endAt}::timestamptz
        and exists(select 1 from employee_team_memberships m join teams t on t.id=m.team_id where m.employee_id=l.employee_id and t.slug='isa-lead-management'
          and (m.start_date is null or m.start_date<=((l.occurred_at at time zone 'Asia/Karachi')::date)) and (m.end_date is null or m.end_date>=((l.occurred_at at time zone 'Asia/Karachi')::date)))) team_leads
      from employees e where e.canonical_name in ('Lars White','Phillip Stokes','Ali Jan','Caleb Ford') order by e.canonical_name`) as unknown as Array<Record<string, unknown>>;
    output.push(...rows.map((row) => ({ ...row, range: `${start}..${end}` })));
  }
  console.table(output);
} finally { await closeDb(); }
