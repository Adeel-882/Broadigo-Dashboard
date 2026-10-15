/** Read-only production acceptance: independent SQL versus dashboard and drawer. */
import {createRequire,registerHooks} from "node:module";
import assert from "node:assert/strict";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
registerHooks({resolve(specifier,context,nextResolve){return specifier==="server-only"?{url:"data:text/javascript,export{}",shortCircuit:true}:nextResolve(specifier,context);}});
const {getDashboardData,getEmployeeDetail}=await import("../lib/dashboard-data");
const {closeDb}=await import("../lib/db/client");
const {default:postgres}=await import("postgres");
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
try{
  for(const period of ["Today","Yesterday","This Week","Last Week","This Month","Last Month"] as const){
    const data=await getDashboardData(period);
    assert.equal(data.mode,"live");
    const [expected]=await db`select
      (select count(*) from appointments where occurred_at>=${data.range.startDate}::date::timestamp at time zone 'America/Chicago' and occurred_at<(${data.range.endDate}::date+1)::timestamp at time zone 'America/Chicago') appointments,
      (select count(*) from sales where occurred_at>=${data.range.startDate}::date::timestamp at time zone 'America/Chicago' and occurred_at<(${data.range.endDate}::date+1)::timestamp at time zone 'America/Chicago') sales,
      (select coalesce(sum(amount),0) from sales where occurred_at>=${data.range.startDate}::date::timestamp at time zone 'America/Chicago' and occurred_at<(${data.range.endDate}::date+1)::timestamp at time zone 'America/Chicago') revenue`;
    for(const kind of ["appointments","sales","revenue"] as const)assert.equal(Number(data.metrics.find(m=>m.kind===kind)?.value.replace(/[^\d.-]/g,"")),Number(expected[kind]),`${period}: ${kind}`);
    console.log(JSON.stringify({period,range:data.range,verified:expected}));
  }
  const day="2026-10-13";
  const data=await getDashboardData("Custom Range",day,day);
  const harvey=data.employees.find(e=>e.name==="Harvey Benjamin");assert.ok(harvey);
  const detail=await getEmployeeDetail(harvey.id,"Custom Range",day,day);
  const expected=await db`select a.id from appointments a where employee_id=${harvey.id} and occurred_at>='2026-10-13T05:00:00Z' and occurred_at<'2026-10-14T05:00:00Z'`;
  assert.equal(harvey.appointmentsBooked,expected.length);
  assert.equal(detail.targetProgress?.appointmentsBooked,expected.length);
  for(const id of ["8e8da2b2-757a-4c65-b136-fb0c92ef283d","79f818d5-4669-465b-b0e1-32f06cd44a19"])assert.ok(detail.activities.some(a=>a.id===id),"08:19 Central source must appear in evidence");
  console.log(JSON.stringify({employee:harvey.name,date:day,appointments:expected.length,outsideShiftEvidenceVerified:2,targetNumerator:detail.targetProgress?.appointmentsBooked}));
}finally{await db.end({timeout:5});await closeDb();}
