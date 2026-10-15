import { sql } from "drizzle-orm";
import type { DockRecord } from "@/types/dashboard";
import { autoDockDb, resultRows } from "./service";

export async function automaticDockRecords(startDate:string,endDate:string,employeeId?:string):Promise<DockRecord[]> {
  const records=resultRows(await autoDockDb().execute(sql`select d.*,e.canonical_name from automatic_docks d join employees e on e.id=d.employee_id where d.status='active' and d.business_date>=${startDate}::date and d.business_date<=${endDate}::date ${employeeId?sql`and d.employee_id=${employeeId}::uuid`:sql``} order by d.business_date desc,e.canonical_name`));
  return records.map(r=>{
    const evidence=r.evidence as {attendanceStatus:string;appointments:number;sales:number;checkIns:Array<{channel:string;ts:string}>;windowStart:string;windowEnd:string};
    const date=String(r.business_date),employee=String(r.canonical_name),id=`auto:${r.id}`;
    return {id,employeeId:String(r.employee_id),employee,date,amount:String(r.amount),currency:"PKR",reason:String(r.reason),appliedBy:"System",sourceType:"automatic_inactivity",activity:{id,employeeId:String(r.employee_id),employee,type:"Dock",summary:String(r.reason),detail:`PKR ${r.amount} · AUTO`,channel:"System",timestamp:date,raw:JSON.stringify(r.evidence,null,2),autoDockAudit:{businessDate:date,attendance:evidence.attendanceStatus,appointments:evidence.appointments,sales:evidence.sales,rule:String(r.rule_code),windowStart:evidence.windowStart,windowEnd:evidence.windowEnd,checkInLinks:(evidence.checkIns??[]).map(c=>`https://slack.com/app_redirect?channel=${encodeURIComponent(c.channel)}&message_ts=${encodeURIComponent(c.ts)}`)}}};
  });
}
