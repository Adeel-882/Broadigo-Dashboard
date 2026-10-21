import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { autoRole, businessWindow, evaluateAutoDockState, FIRST_APPROVED_BUSINESS_DATE, AUTO_DOCK_CALL_CHANNEL_IDS, AUTO_DOCK_EXCLUDED_EMPLOYEE_IDS, isAutoDockExcluded } from "./policy";

export function autoDockDb() { const db=getDb();if(!db)throw new Error("Database unavailable");return db; }
type Row=Record<string,unknown>;
export const resultRows=(result:unknown)=>Array.from(result as Iterable<Row>);
export async function readAutoDockSettings() {
  const [r]=resultRows(await autoDockDb().execute(sql`select * from auto_dock_settings where id=1`));
  if(!r)throw new Error("Automatic dock settings missing");
  return {callsRuleEffectiveFrom:r.calls_rule_effective_from?String(r.calls_rule_effective_from):null,enabled:r.enabled===true,workspaceId:String(r.workspace_id),generalChannelId:String(r.general_channel_id),reliableFrom:r.attendance_reliable_from?String(r.attendance_reliable_from):null,effectiveFrom:r.effective_from?String(r.effective_from):null,phrases:(r.approved_check_in_phrases??[]) as string[]};
}
export async function evaluateBusinessDay(date:string, apply=false, now=new Date()) {
  const {start,end}=businessWindow(date);const settings=await readAutoDockSettings();
  const db=autoDockDb();
  if(apply&&date<FIRST_APPROVED_BUSINESS_DATE)throw new Error("Outside approved financial dates");
  if(apply&&!settings.callsRuleEffectiveFrom)throw new Error("Call policy migration required before financial writes");
  if(apply&&settings.callsRuleEffectiveFrom&&date<settings.callsRuleEffectiveFrom)return {businessDate:date,apply,reliable:false,activationDate:settings.effectiveFrom,enabled:settings.enabled,evaluated:0,created:0,existing:0,voided:0,evaluations:[],historicalPreserved:true};
  if(apply&&(date<FIRST_APPROVED_BUSINESS_DATE||!settings.enabled||!settings.effectiveFrom||date<settings.effectiveFrom||!settings.reliableFrom||date<settings.reliableFrom||!settings.phrases.length||end>now))throw new Error("Automatic dock writes disabled, outside approved dates, or business day incomplete");
  const [run]=apply?resultRows(await db.execute(sql`insert into auto_dock_runs(business_date,status) values(${date}::date,'RUNNING') returning id`)):[];
  try {
    return await db.transaction(async tx=>{
      // Serialize an entire day across cron retries and late webhook deliveries.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auto-docks:'||${date}))`);
      const [coverage]=resultRows(await tx.execute(sql`select * from attendance_coverage where business_date=${date}::date and workspace_id=${settings.workspaceId} and channel_id=${settings.generalChannelId}`));
      const reliable=Boolean(settings.reliableFrom&&date>=settings.reliableFrom&&settings.phrases.length&&coverage);
      if(apply&&!reliable)throw new Error("Complete, reliable attendance coverage required before financial writes");
      if(apply){
        const covered=resultRows(await tx.execute(sql`select channel_id from auto_dock_call_coverage where business_date=${date}::date and workspace_id=${settings.workspaceId}`));
        if(!AUTO_DOCK_CALL_CHANNEL_IDS.every(id=>covered.some(c=>c.channel_id===id)))throw new Error('Complete coverage of every authorized call channel required');
      }
      const people=resultRows(await tx.execute(sql`select e.id,e.canonical_name,e.job_title,e.active,
        exists(select 1 from employee_team_memberships m where m.employee_id=e.id and (m.start_date is null or m.start_date<=${date}::date) and (m.end_date is null or m.end_date>=${date}::date)) membership_eligible,
        exists(select 1 from auto_dock_exemptions x where x.employee_id=e.id and x.business_date=${date}::date) exempt,
        (select coalesce(jsonb_agg(jsonb_build_object('channel',am.channel_id,'ts',am.slack_ts)),'[]') from attendance_messages am where am.employee_id=e.id and am.workspace_id=${settings.workspaceId} and am.channel_id=${settings.generalChannelId} and am.source_at>=${start.toISOString()}::timestamptz and am.source_at<${end.toISOString()}::timestamptz and am.is_check_in and not am.deleted) check_ins,
        (select coalesce(jsonb_agg(jsonb_build_object('channel',c.slack_channel_id,'name',c.name,'ts',sm.slack_ts) order by sm.posted_at),'[]'::jsonb) from appointments a join slack_messages sm on sm.id=a.slack_message_id join slack_channels c on c.id=sm.channel_id where exists(select 1 from employee_slack_identities identity where identity.employee_id=e.id and identity.workspace_id=sm.workspace_id and identity.slack_user_id=sm.slack_user_id) and sm.workspace_id=${settings.workspaceId} and sm.parser_status='PARSED' and sm.source_unavailable_at is null and c.slack_channel_id in (${sql.join(AUTO_DOCK_CALL_CHANNEL_IDS.map(id=>sql`${id}`),sql`,`)}) and sm.posted_at>=${start.toISOString()}::timestamptz and sm.posted_at<${end.toISOString()}::timestamptz) calls,
        0 sales -- Historical evidence may contain sales; current policy never queries sales.
        , exists(select 1 from automatic_docks ad where ad.employee_id=e.id and ad.business_date=${date}::date) previously_evaluated
        from employees e where e.id not in (${sql.join(AUTO_DOCK_EXCLUDED_EMPLOYEE_IDS.map(id=>sql`${id}::uuid`),sql`,`)}) order by e.canonical_name`));
      // Excluded employees receive an explicit SKIP record without querying their
      // attendance, calls, sales, membership or role for inactivity evaluation.
      const excluded=resultRows(await tx.execute(sql`select id,canonical_name from employees where id in (${sql.join(AUTO_DOCK_EXCLUDED_EMPLOYEE_IDS.map(id=>sql`${id}::uuid`),sql`,`)})`));
      people.push(...excluded.map(p=>({...p,job_title:"",check_ins:[],calls:[],sales:0})));
      const evaluations=people.filter(p=>isAutoDockExcluded(String(p.id))||p.previously_evaluated||autoRole(String(p.id),String(p.job_title))!=="OTHER").map(p=>{
        const checkIns=p.check_ins as Array<{channel:string;ts:string}>;
        const input={employeeId:String(p.id),title:String(p.job_title),active:p.active===true,membershipEligible:p.membership_eligible===true,exempt:p.exempt===true,attendanceReliable:reliable,checkInFound:checkIns.length>0,appointments:(p.calls as unknown[]).length,sales:Number(p.sales)};
        return {...input,...evaluateAutoDockState(input),calls:p.calls as Array<{channel:string;name:string;ts:string}>,policyVersion:"posted_calls_v2",employee:String(p.canonical_name),businessDate:date,windowStart:start.toISOString(),windowEnd:end.toISOString(),checkIns};
      });
      let created=0,existing=0,voided=0;
      if(apply){
        const previous=resultRows(await tx.execute(sql`select * from automatic_docks where business_date=${date}::date`));
        const payload=JSON.stringify(evaluations);
        const retired=resultRows(await tx.execute(sql`update automatic_docks d set status='voided',voided_at=now(),void_reason=case when d.rule_code='closer_zero_sales' then 'Management rule change effective 2026-10-16: retired sales-based rule; personally posted calls and automatic exclusions now determine eligibility. See replacement evaluation.' when exists(select 1 from jsonb_array_elements(${payload}::jsonb) e where (e->>'employeeId')::uuid=d.employee_id and e->>'decision'='ACTIVITY_RECORDED' and exists(select 1 from jsonb_array_elements(e->'calls') c where c->>'channel'='C0BADNJL14L')) then 'Voided after addition of authorized call channel #sdg-lhub-general; qualifying call existed for this business day.' else 'Reconciled: activity, attendance, exemption, or role changed' end,updated_at=now()
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
          on conflict(employee_id,business_date,rule_code) do update set status='active',voided_at=null,void_reason=null,reason=excluded.reason,evidence=excluded.evidence,updated_at=now()
          where automatic_docks.status is distinct from 'active' or automatic_docks.reason is distinct from excluded.reason or automatic_docks.evidence is distinct from excluded.evidence`);
        await tx.execute(sql`insert into auto_dock_evaluations(run_id,employee_id,business_date,dock_id,evidence)
          select ${String(run.id)}::uuid,(e->>'employeeId')::uuid,${date}::date,d.id,e
          from jsonb_array_elements(${payload}::jsonb) e left join automatic_docks d
          on d.employee_id=(e->>'employeeId')::uuid and d.business_date=${date}::date and d.rule_code=e->>'ruleCode'`);
        await tx.execute(sql`update auto_dock_runs set status='COMPLETED',completed_at=now(),summary=${JSON.stringify({evaluated:evaluations.length,created,existing,voided})}::jsonb where id=${String(run.id)}::uuid`);
      }
      return {businessDate:date,apply,reliable,activationDate:settings.effectiveFrom,enabled:settings.enabled,evaluated:evaluations.length,created,existing,voided,evaluations,historicalPreserved:false,policyEffectiveFrom:settings.callsRuleEffectiveFrom};
    });
  }catch(error){if(run)await db.execute(sql`update auto_dock_runs set status='FAILED',completed_at=now(),error='Evaluation failed; inspect server logs' where id=${String(run.id)}::uuid`);throw error;}
}
