/** Read-only reconstruction of pre-repair totals from the retained audit history. */
import {createRequire} from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const {default:postgres}=await import("postgres");
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
try {
  const result=await db`with records as (
    select l.id,l.employee_id,l.counts_toward_kpi,
      coalesce(a.before_state->'lead',to_jsonb(l)) original,
      (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date as business_date
    from leads l left join lateral (select before_state from lead_reconciliation_audit
      where lead_id=l.id and reason in ('WRONG_EMPLOYEE: approved October parent-author mapping',
        'IDENTITY_MAPPING_ERROR: previously unmapped author',
        'OTHER_PROVEN_CAUSE: source absent from complete history and message_not_found')
      order by recorded_at limit 1) a on true
    where l.occurred_at >= '2026-10-01' and l.occurred_at < '2026-10-15'
      and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00' or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
  ) select business_date::text,
    count(*) filter(where (original->>'counts_toward_kpi')::boolean and exists (
      select 1 from employee_team_memberships m join teams t on t.id=m.team_id
      where m.employee_id=(original->>'employee_id')::uuid and t.slug='isa-lead-management'
        and (m.start_date is null or m.start_date<=business_date) and (m.end_date is null or m.end_date>=business_date))) before,
    count(*) filter(where counts_toward_kpi and exists (
      select 1 from employee_team_memberships m join teams t on t.id=m.team_id
      where m.employee_id=records.employee_id and t.slug='isa-lead-management'
        and (m.start_date is null or m.start_date<=business_date) and (m.end_date is null or m.end_date>=business_date))) after
    from records group by business_date order by business_date`;
  console.log(JSON.stringify({totals:result,audit:await db`select reason,count(*) from lead_reconciliation_audit group by reason`}));
}finally{await db.end({timeout:5});}
