import {sql} from "drizzle-orm";
import {isAuthenticatedRequest} from "@/lib/auth/session";
import {autoDockDb,readAutoDockSettings,resultRows} from "@/lib/auto-docks/service";
import {latestClosedBusinessDate} from "@/lib/auto-docks/policy";
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
    const [runs,evaluations,pending,docks]=await db.transaction(async tx=>{
      await tx.execute(sql`set transaction isolation level repeatable read read only`);
      const runs=await tx.execute(sql`select business_date,started_at,completed_at,status,summary,error from auto_dock_runs order by started_at desc limit 5`);
      const evaluations=await tx.execute(sql`select distinct on(business_date,employee_id) business_date::text,employee_id,evidence,evaluated_at from auto_dock_evaluations where business_date>=${from}::date and business_date<=${to}::date order by business_date desc,employee_id,evaluated_at desc`);
      const pending=await tx.execute(sql`select count(*) n from auto_dock_pending where business_date>=${settings.effectiveFrom}::date and business_date<=${latestClosedBusinessDate()}::date`);
      const docks=await tx.execute(sql`select business_date::text,employee_id,rule_code,amount,status,void_reason,created_at,voided_at from automatic_docks where business_date>=${from}::date and business_date<=${to}::date order by created_at`);
      return [runs,evaluations,pending,docks];
    });
    const evaluated=new Set(resultRows(evaluations).map(r=>String(r.business_date)));
    return Response.json({from,to,days,unevaluatedDays:days.filter(day=>!evaluated.has(day)),enabled:settings.enabled,effectiveFrom:settings.effectiveFrom,reliableFrom:settings.reliableFrom,runs:resultRows(runs),evaluations:resultRows(evaluations),docks:resultRows(docks),pending:Number(resultRows(pending)[0]?.n??0)});
  }catch(error){const {root,code}=describeDbError(error);console.error("[auto-dock] audit read failed",{from,to,root,code});return Response.json({error:"Unable to load automatic dock audit"},{status:503});}
}
