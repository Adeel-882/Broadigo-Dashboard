import {sql} from "drizzle-orm";
import {isAuthenticatedRequest} from "@/lib/auth/session";
import {autoDockDb,readAutoDockSettings,resultRows} from "@/lib/auto-docks/service";
import {latestClosedBusinessDate,AUTO_DOCK_CALL_CHANNEL_IDS,AUTO_DOCK_EXCLUDED_EMPLOYEE_IDS} from "@/lib/auto-docks/policy";
import {auditRange} from "@/lib/auto-docks/audit-range";
import {describeDbError} from "@/lib/db/client";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  if(!await isAuthenticatedRequest(request))return Response.json({error:"Unauthorized"},{status:401});
  let range:ReturnType<typeof auditRange>;
  try{range=auditRange(new URL(request.url).searchParams);}catch{return Response.json({error:"Choose valid business dates in order, up to 90 days"},{status:400});}
  const {from,to,days}=range;
  try{
    const db=autoDockDb();const settings=await readAutoDockSettings();
    // A single read-only snapshot/connection avoids exhausting Supabase's
    // session pool while the main dashboard is also loading. No global pool change.
    const [runs,evaluations,pending,docks,coverage,history,excluded]=await db.transaction(async tx=>{
      await tx.execute(sql`set transaction isolation level repeatable read read only`);
      const runs=await tx.execute(sql`select business_date,started_at,completed_at,status,summary,error from auto_dock_runs order by started_at desc limit 5`);
      const evaluations=await tx.execute(sql`select distinct on(business_date,employee_id) business_date::text,employee_id,evidence,evaluated_at from auto_dock_evaluations where business_date>=${from}::date and business_date<=${to}::date order by business_date desc,employee_id,evaluated_at desc`);
      const pending=await tx.execute(sql`select count(*) n from auto_dock_pending where business_date>=${settings.effectiveFrom}::date and business_date<=${latestClosedBusinessDate()}::date`);
      const docks=await tx.execute(sql`select d.id,d.business_date::text,d.employee_id,d.rule_code,d.amount,d.system_amount,d.status,d.void_reason,d.created_at,d.voided_at,d.override_type,d.override_reason,d.edited_by,d.edited_at,(select coalesce(jsonb_agg(jsonb_build_object('action',h.action,'old_amount',h.old_amount::text,'new_amount',h.new_amount::text,'reason',h.reason,'actor',h.actor,'created_at',h.created_at) order by h.created_at desc),'[]') from auto_dock_edit_history h where h.dock_id=d.id) edit_history from effective_automatic_docks d where d.business_date>=${from}::date and d.business_date<=${to}::date order by d.created_at`);
      const coverage=await tx.execute(sql`select business_date::text,channel_id from attendance_coverage where workspace_id=${settings.workspaceId} and channel_id=${settings.generalChannelId} and business_date between ${from}::date and ${to}::date union all select business_date::text,channel_id from auto_dock_call_coverage where workspace_id=${settings.workspaceId} and business_date between ${from}::date and ${to}::date`);
      const history=await tx.execute(sql`select distinct on(r.business_date) r.business_date::text,r.summary,(select count(*)::int from auto_dock_evaluations e where e.run_id=r.id) recovered from auto_dock_runs r where r.status='COMPLETED' and r.business_date between ${from}::date and ${to}::date order by r.business_date,r.started_at desc`);
      const excluded=await tx.execute(sql`select id,canonical_name from employees where id in (${sql.join(AUTO_DOCK_EXCLUDED_EMPLOYEE_IDS.map(id=>sql`${id}::uuid`),sql`,`)}) order by canonical_name`);
      return [runs,evaluations,pending,docks,coverage,history,excluded];
    });
    const evaluated=new Set(resultRows(evaluations).map(r=>String(r.business_date)));
    const coverageRows=resultRows(coverage);
    const coverageIncompleteDays=days.filter(day=>![settings.generalChannelId,...AUTO_DOCK_CALL_CHANNEL_IDS].every(channel=>coverageRows.some(r=>r.business_date===day&&r.channel_id===channel)));
    const incompleteHistoryDays=resultRows(history).filter(r=>Number(r.recovered)<Number((r.summary as {evaluated?:number})?.evaluated??0)).map(r=>String(r.business_date));
    return Response.json({from,to,days,coverageIncompleteDays,incompleteHistoryDays,policyExclusions:resultRows(excluded),unevaluatedDays:days.filter(day=>!evaluated.has(day)),enabled:settings.enabled,effectiveFrom:settings.effectiveFrom,reliableFrom:settings.reliableFrom,runs:resultRows(runs),evaluations:resultRows(evaluations),docks:resultRows(docks),pending:Number(resultRows(pending)[0]?.n??0)});
  }catch(error){const {root,code}=describeDbError(error);console.error("[auto-dock] audit read failed",{from,to,root,code});return Response.json({error:"Unable to load automatic dock audit"},{status:503});}
}
