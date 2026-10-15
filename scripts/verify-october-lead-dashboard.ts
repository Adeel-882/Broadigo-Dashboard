/** Read-only acceptance checks against the real dashboard data path. */
import {createRequire,registerHooks} from "node:module";
import assert from "node:assert/strict";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
registerHooks({resolve(specifier,context,nextResolve){return specifier==="server-only"?{url:"data:text/javascript,export{}",shortCircuit:true}:nextResolve(specifier,context);}});
const {getDashboardData,getEmployeeDetail}=await import("../lib/dashboard-data");
const {closeDb}=await import("../lib/db/client");
const dates=[1,2,5,6,7,8,9,12,13,14];
// Management's acceptance matrix, not runtime configuration. Fasial is deferred.
const expected:Record<string,number[]>={
  "Asif Hazoor":[4,3,5,3,6,3,0,3,3,1],"Syed Ali Jan":[2,2,1,1,0,3,2,1,5,1],
  "Alishba Zareh":[2,1,2,1,2,2,1,1,1,2],"Aishah Arif":[0,1,0,0,4,2,3,1,0,1],
  "Muhammad Zeeshan":[2,2,2,3,0,2,2,0,2,4],"Saad Ali":[1,1,2,0,2,0,3,0,1,2],
  "Muhammad Eman":[3,3,0,0,0,2,2,0,1,4],"Dilshad Ullah Danish":[2,0,1,2,0,1,1,3,1,1],
  "Abdul Wali":[0,1,0,0,0,1,0,1,0,0],"Nawal Tariq":[0,0,0,0,0,0,2,0,0,1],
};
try {
  for(const [index,day] of dates.entries()){
    const date=`2026-10-${String(day).padStart(2,"0")}`;
    const data=await getDashboardData("Custom Range",date,date);
    assert.equal(data.mode,"live");
    const total=Object.values(expected).reduce((sum,counts)=>sum+counts[index],0);
    const actual=Number(data.metrics.find(m=>m.kind==="leads")?.value);
    for(const [name,counts] of Object.entries(expected)){
      const employee=data.employees.find(e=>e.name===name);assert.ok(employee,name);
      assert.equal(employee.metricValueNumber,counts[index],`${date}: ${name}`);
      const detail=await getEmployeeDetail(employee.id,"Custom Range",date,date);
      assert.equal(detail.targetProgress?.leads,counts[index],`${name}: /26 numerator`);
      assert.equal(detail.targetProgress?.teamLeads,actual,`${name}: /450 numerator`);
      assert.equal(detail.trend.reduce((sum,p)=>sum+p.value,0),counts[index]);
      if(name==="Asif Hazoor"&&day===12){
        const evidence=detail.activities.filter(a=>a.type==="Lead");
        assert.equal(evidence.length,3);
        assert.ok(evidence.every(a=>!/mervat/i.test(a.summary)));
        console.log(JSON.stringify({asifOct12:counts[index],completion:employee.completion,evidence:evidence.map(a=>a.summary)}));
      }
    }
    console.log(JSON.stringify({date,expectedExcludingFasial:total,dashboardTotal:actual,employeesChecked:10,team:data.teams.filter(t=>/ISA/.test(t.name)),division:data.divisions.filter(d=>/Lead Management/.test(d.name))}));
    assert.equal(actual,total,`${date}: scoped team total`);
  }
} finally {await closeDb();}
