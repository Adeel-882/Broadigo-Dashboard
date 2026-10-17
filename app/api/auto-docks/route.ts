import {sql} from "drizzle-orm";
import {isAuthenticatedRequest} from "@/lib/auth/session";
import {autoDockDb,readAutoDockSettings,resultRows} from "@/lib/auto-docks/service";
import {businessWindow,latestClosedBusinessDate} from "@/lib/auto-docks/policy";
export const runtime="nodejs";
export const dynamic="force-dynamic";
export async function GET(request:Request){
  if(!await isAuthenticatedRequest(request))return Response.json({error:"Unauthorized"},{status:401});
  const date=new URL(request.url).searchParams.get("date")??latestClosedBusinessDate();
  try{businessWindow(date);}catch{return Response.json({error:"Invalid business date"},{status:400});}
  try{
    const db=autoDockDb();const settings=await readAutoDockSettings();
    const [runs,evaluations,pending,docks]=await Promise.all([
      db.execute(sql`select business_date,started_at,completed_at,status,summary,error from auto_dock_runs order by started_at desc limit 5`),
      db.execute(sql`select distinct on(employee_id) employee_id,evidence,evaluated_at from auto_dock_evaluations where business_date=${date}::date order by employee_id,evaluated_at desc`),
      db.execute(sql`select count(*) n from auto_dock_pending where business_date>=${settings.effectiveFrom}::date and business_date<=${latestClosedBusinessDate()}::date`),
      db.execute(sql`select employee_id,rule_code,amount,status,void_reason,created_at,voided_at from automatic_docks where business_date=${date}::date order by created_at`),
    ]);
    return Response.json({date,enabled:settings.enabled,effectiveFrom:settings.effectiveFrom,reliableFrom:settings.reliableFrom,runs:resultRows(runs),evaluations:resultRows(evaluations),docks:resultRows(docks),pending:Number(resultRows(pending)[0]?.n??0)});
  }catch{console.error("[auto-dock] audit read failed");return Response.json({error:"Unable to load automatic dock audit"},{status:503});}
}
