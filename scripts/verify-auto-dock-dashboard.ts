import {createRequire,registerHooks} from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
// This CLI is a server context; Next normally resolves this marker at build time.
registerHooks({resolve(specifier,context,nextResolve){return specifier==="server-only"?{url:"data:text/javascript,export{}",shortCircuit:true}:nextResolve(specifier,context);}});
import assert from "node:assert/strict";
const {getDashboardData,getEmployeeDetail}=await import("../lib/dashboard-data");
const {closeDb}=await import("../lib/db/client");
const {autoDockDb,resultRows}=await import("../lib/auto-docks/service");
const {sql}=await import("drizzle-orm");
try{
  for(const period of ["Today","Yesterday","This Week","Last Week","This Month","Last Month"] as const){
    const data=await getDashboardData(period);
    assert.equal(data.mode,"live");
    assert.equal(Number(data.metrics.find(m=>m.kind==="docks")?.value),data.docks.length);
    console.log(JSON.stringify({period,range:data.range.label,metrics:data.metrics.map(m=>({kind:m.kind,value:m.value}))}));
  }
  const data=await getDashboardData("This Week");
  for(const name of ["Caleb Ford","Dameon Wolfe","Zack Wilson"]){const employee=data.employees.find(e=>e.name===name);assert.ok(employee);const detail=await getEmployeeDetail(employee.id,"This Week");console.log(JSON.stringify({employee:name,detailRecords:detail.activities.length,assignedCalls:detail.assignedCalls?.length??0}));}
  console.log("LATEST_MANUAL_SOURCE",JSON.stringify(resultRows(await autoDockDb().execute(sql`select sm.slack_ts,sm.posted_at,sm.imported_at,d.amount,(select count(*) from dock_recipients dr where dr.dock_id=d.id) recipients from docks d join slack_messages sm on sm.id=d.slack_message_id order by sm.imported_at desc limit 1`))));
}finally{await closeDb();}
