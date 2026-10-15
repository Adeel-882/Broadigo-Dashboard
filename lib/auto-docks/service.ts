import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { autoRole, businessWindow, evaluateAutoDockState, FIRST_APPROVED_BUSINESS_DATE } from "./policy";

export function autoDockDb() { const db=getDb();if(!db)throw new Error("Database unavailable");return db; }
type Row=Record<string,unknown>;
export const resultRows=(result:unknown)=>Array.from(result as Iterable<Row>);
export async function readAutoDockSettings() {
  const [r]=resultRows(await autoDockDb().execute(sql`select * from auto_dock_settings where id=1`));
  if(!r)throw new Error("Automatic dock settings missing");
  return {enabled:r.enabled===true,workspaceId:String(r.workspace_id),generalChannelId:String(r.general_channel_id),reliableFrom:r.attendance_reliable_from?String(r.attendance_reliable_from):null,effectiveFrom:r.effective_from?String(r.effective_from):null,phrases:(r.approved_check_in_phrases??[]) as string[]};
}
export async function evaluateBusinessDay(date:string, apply=false, now=new Date()) {
  const {start,end}=businessWindow(date);const settings=await readAutoDockSettings();
  const db=autoDockDb();
  if(apply&&(date<FIRST_APPROVED_BUSINESS_DATE||!settings.enabled||!settings.effectiveFrom||date<settings.effectiveFrom||!settings.reliableFrom||date<settings.reliableFrom||!settings.phrases.length||end>now))throw new Error("Automatic dock writes disabled, outside approved dates, or business day incomplete");
  const [run]=apply?resultRows(await db.execute(sql`insert into auto_dock_runs(business_date,status) values(${date}::date,'RUNNING') returning id`)):[];
  try {
    return await db.transaction(async tx=>{
      // Serialize an entire day across cron retries and late webhook deliveries.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auto-docks:'||${date}))`);
      const [coverage]=resultRows(await tx.execute(sql`select * from attendance_coverage where business_date=${date}::date and workspace_id=${settings.workspaceId} and channel_id=${settings.generalChannelId}`));
      const reliable=Boolean(settings.reliableFrom&&date>=settings.reliableFrom&&settings.phrases.length&&coverage);
      if(apply&&!reliable)throw new Error("Complete, reliable attendance coverage required before financial writes");
      const people=resultRows(await tx.execute(sql`select e.id,e.canonical_name,e.job_title,e.active,
        exists(select 1 from employee_team_memberships m where m.employee_id=e.id and (m.start_date is null or m.start_date<=${date}::date) and (m.end_date is null or m.end_date>=${date}::date)) membership_eligible,
        exists(select 1 from auto_dock_exemptions x where x.employee_id=e.id and x.business_date=${date}::date) exempt,
        (select coalesce(jsonb_agg(jsonb_build_object('channel',am.channel_id,'ts',am.slack_ts)),'[]') from attendance_messages am where am.employee_id=e.id and am.workspace_id=${settings.workspaceId} and am.channel_id=${settings.generalChannelId} and am.source_at>=${start.toISOString()}::timestamptz and am.source_at<${end.toISOString()}::timestamptz and am.is_check_in and not am.deleted) check_ins,
        (select count(*) from appointments a join slack_messages sm on sm.id=a.slack_message_id join slack_channels c on c.id=sm.channel_id where a.employee_id=e.id and sm.workspace_id=${settings.workspaceId} and sm.parser_status='PARSED' and c.name in ('sales-development-general','broadigo-sale-development-general') and sm.posted_at>=${start.toISOString()}::timestamptz and sm.posted_at<${end.toISOString()}::timestamptz) appointments,
        (select count(*) from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id where s.employee_id=e.id and sm.workspace_id=${settings.workspaceId} and sm.parser_status='PARSED' and c.name in ('sales-reporting','broadigo-sales-reporting') and sm.posted_at>=${start.toISOString()}::timestamptz and sm.posted_at<${end.toISOString()}::timestamptz) sales
        , exists(select 1 from automatic_docks ad where ad.employee_id=e.id and ad.business_date=${date}::date) previously_evaluated
        from employees e order by e.canonical_name`));
      const evaluations=people.filter(p=>p.previously_evaluated||autoRole(String(p.id),String(p.job_title))!=="OTHER").map(p=>{
        const checkIns=p.check_ins as Array<{channel:string;ts:string}>;
        const input={employeeId:String(p.id),title:String(p.job_title),active:p.active===true,membershipEligible:p.membership_eligible===true,exempt:p.exempt===true,attendanceReliable:reliable,checkInFound:checkIns.length>0,appointments:Number(p.appointments),sales:Number(p.sales)};
        return {...input,...evaluateAutoDockState(input),employee:String(p.canonical_name),businessDate:date,windowStart:start.toISOString(),windowEnd:end.toISOString(),checkIns};
      });
      let created=0,existing=0,voided=0;
      if(apply){
        const previous=resultRows(await tx.execute(sql`select * from automatic_docks where business_date=${date}::date`));
        const payload=JSON.stringify(evaluations);
        const retired=resultRows(await tx.execute(sql`update automatic_docks d set status='voided',voided_at=now(),void_reason='Reconciled: activity, attendance, exemption, or role changed',updated_at=now()
          where d.business_date=${date}::date and d.status='active' and not exists(
            select 1 from jsonb_array_elements(${payload}::jsonb) e where (e->>'employeeId')::uuid=d.employee_id and e->>'decision'='DOCK' and e->>'ruleCode'=d.rule_code)
          returning d.id`));
        voided=retired.length;
        const expected=evaluations.filter(e=>e.decision==='DOCK');
        existing=expected.filter(e=>previous.some(p=>p.employee_id===e.employeeId&&p.rule_code===e.ruleCode&&p.status==='active')).length;
        created=expected.length-existing;
        await tx.execute(sql`insert into automatic_docks(employee_id,business_date,rule_code,amount,reason,status,evidence)
          select (e->>'employeeId')::uuid,${date}::date,e->>'ruleCode',(e->>'amount')::numeric,e->>'reason','active',e
          from jsonb_array_elements(${payload}::jsonb) e where e->>'decision'='DOCK'
          on conflict(employee_id,business_date,rule_code) do update set status='active',voided_at=null,void_reason=null,reason=excluded.reason,evidence=excluded.evidence,updated_at=now()`);
        await tx.execute(sql`insert into auto_dock_evaluations(run_id,employee_id,business_date,dock_id,evidence)
          select ${String(run.id)}::uuid,(e->>'employeeId')::uuid,${date}::date,d.id,e
          from jsonb_array_elements(${payload}::jsonb) e left join automatic_docks d
          on d.employee_id=(e->>'employeeId')::uuid and d.business_date=${date}::date and d.rule_code=e->>'ruleCode'`);
        await tx.execute(sql`update auto_dock_runs set status='COMPLETED',completed_at=now(),summary=${JSON.stringify({evaluated:evaluations.length,created,existing,voided})}::jsonb where id=${String(run.id)}::uuid`);
      }
      return {businessDate:date,apply,reliable,activationDate:settings.effectiveFrom,enabled:settings.enabled,evaluated:evaluations.length,created,existing,voided,evaluations};
    });
  }catch(error){if(run)await db.execute(sql`update auto_dock_runs set status='FAILED',completed_at=now(),error='Evaluation failed; inspect server logs' where id=${String(run.id)}::uuid`);throw error;}
}
