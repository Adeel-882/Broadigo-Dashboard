/** Read-only comparison. No backfill: reporting dates are derived at query time. */
import {createRequire} from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const {default:postgres}=await import("postgres");
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
import assert from "node:assert/strict";
import {sql} from "drizzle-orm";
import {PgDialect} from "drizzle-orm/pg-core";
import {operationalDateSql,operationalShiftFilter} from "../lib/operational-query";
import {resolveDateRange,operationalDateFor,isWithinOperationalShift} from "../lib/time-ranges";
try {
  await db.begin(async tx=>{
    await tx`set transaction read only`;
    // Exercise the exact reporting SQL with synthetic instants, never inserted.
    let boundaryChecks=0;
    for(const date of ['2026-03-07','2026-03-08','2026-10-12','2026-10-31','2026-11-01','2026-12-12']){
      const r=resolveDateRange('Custom Range',date,date);
      for(const time of [r.start.getTime()-1000,r.start.getTime(),r.end.getTime()-1000,r.end.getTime()]){
        const stamp=new Date(time),column=sql`${stamp.toISOString()}::timestamptz`;
        const query=new PgDialect().sqlToQuery(sql`select ${operationalDateSql(column)}::text business_date,${operationalShiftFilter(column,r.start.toISOString(),r.end.toISOString())} eligible`);
        const [result]=await tx.unsafe(query.sql,query.params as string[]);
        assert.equal(result.business_date,operationalDateFor(stamp));
        assert.equal(result.eligible,isWithinOperationalShift(stamp));
        boundaryChecks++;
      }
    }
    const impacts=await tx`with records as (
      select 'leads' kind,occurred_at from leads union all
      select 'appointments',occurred_at from appointments union all
      select 'sales',occurred_at from sales union all
      select 'manual docks',occurred_at from docks union all
      select 'media',occurred_at from media_activity
    ), dates as (select *,timezone('Asia/Karachi',occurred_at) old_local,
      timezone('America/Chicago',occurred_at) new_local from records), rules as (
      select *, (old_local-interval '5 hours')::date old_day,new_local::date new_day,
        (old_local::time>=time '19:00' or old_local::time<time '05:00') old_in,
        (new_local::time>=time '09:00' and new_local::time<time '19:00') new_in from dates
    ) select kind,count(*) records,count(*) filter(where old_day<>new_day) calendar_labels_changed,
      count(*) filter(where old_in and new_in and old_day<>new_day) included_dates_changed,
      count(*) filter(where old_in and not new_in) leave_shift,
      count(*) filter(where not old_in and new_in) enter_shift,
      count(*) filter(where old_day between '2026-10-01' and '2026-10-14' and old_in is distinct from new_in) october_shift_changes
      from rules group by kind order by kind`;
    const fingerprints:Record<string,unknown>={};
    for(const table of ['slack_messages','leads','appointments','sales','docks','dock_recipients','employees','employee_team_memberships','employee_slack_identities','targets','automatic_docks','auto_dock_settings','attendance_messages']){
      fingerprints[table]=(await tx.unsafe(`select count(*) n,md5(string_agg(row::text,'' order by row::text)) fingerprint from (select to_jsonb(t) row from ${table} t) s`))[0];
    }
    console.log(JSON.stringify({boundaryChecks,impacts,fingerprints}));
  });
}finally{await db.end({timeout:5});}
