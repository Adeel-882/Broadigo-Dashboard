/** Read-only: compare the previous shift gate with full Central calendar days. */
import {createRequire} from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const {default:postgres}=await import("postgres");
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
try {
  await db.begin(async tx=>{
    await tx`set transaction read only`;
    const records=await tx`with records as (
      select 'lead' kind,l.id,l.employee_id,l.contact_name prospect,l.occurred_at,l.slack_message_id from leads l
      union all select 'appointment',id,employee_id,prospect_name,occurred_at,slack_message_id from appointments
      union all select 'sale',id,employee_id,customer_name,occurred_at,slack_message_id from sales
      union all select 'dock',id,employee_id,null,occurred_at,slack_message_id from docks
    ) select r.kind,r.id,e.canonical_name employee,r.prospect,sm.slack_ts,r.occurred_at,
      sm.posted_at,timezone('Asia/Karachi',r.occurred_at)::text karachi,
      timezone('America/Chicago',r.occurred_at)::text central,
      (timezone('Asia/Karachi',r.occurred_at)-interval '5 hours')::date::text legacy_shift_date,
      timezone('America/Chicago',r.occurred_at)::date::text current_business_date,
      (timezone('America/Chicago',r.occurred_at)::time >= time '09:00' and timezone('America/Chicago',r.occurred_at)::time < time '19:00') previous_shift_included
      from records r join slack_messages sm on sm.id=r.slack_message_id left join employees e on e.id=r.employee_id
      order by r.occurred_at`;
    const boundary=records.filter(r=>r.central>='2026-09-30'&&r.central<'2026-10-02');
    const changed=records.filter(r=>!r.previous_shift_included);
    const mismatch=records.filter(r=>Math.abs(new Date(r.occurred_at).getTime()-Number(r.slack_ts)*1000)>1||new Date(r.occurred_at).getTime()!==new Date(r.posted_at).getTime());
    const fingerprints:Record<string,unknown>={};
    for(const table of ['slack_messages','leads','appointments','sales','docks','dock_recipients','employees','employee_team_memberships','employee_slack_identities','targets','automatic_docks','auto_dock_settings','attendance_messages']){
      fingerprints[table]=(await tx.unsafe(`select count(*) n,md5(string_agg(row::text,'' order by row::text)) fingerprint from (select to_jsonb(t) row from ${table} t) s`))[0];
    }
    const counts=Object.fromEntries(['lead','appointment','sale','dock'].map(kind=>[kind,{all:records.filter(r=>r.kind===kind).length,newlyIncluded:changed.filter(r=>r.kind===kind).length,boundaryNewlyIncluded:boundary.filter(r=>r.kind===kind&&!r.previous_shift_included).length}]));
    console.log(JSON.stringify({counts,sourceMismatch:mismatch.map(r=>({kind:r.kind,id:r.id})),samples:boundary.slice(0,5),boundaryChanged:boundary.filter(r=>!r.previous_shift_included),changed,fingerprints}));
  });
}finally{await db.end({timeout:5});}
