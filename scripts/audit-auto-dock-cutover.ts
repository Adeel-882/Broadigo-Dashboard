import {createRequire} from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const {sql}=await import("drizzle-orm");
const {autoDockDb,resultRows,evaluateBusinessDay}=await import("../lib/auto-docks/service");
const {closeDb}=await import("../lib/db/client");
try {
  const db=autoDockDb();
  const apiQueries=[
    "select business_date,started_at,completed_at,status,summary,error from auto_dock_runs order by started_at desc limit 5",
    "select distinct on(employee_id) employee_id,evidence,evaluated_at from auto_dock_evaluations where business_date='2026-10-16' order by employee_id,evaluated_at desc",
    "select count(*) n from auto_dock_pending where business_date>='2026-10-16' and business_date<='2026-10-16'",
    "select employee_id,rule_code,amount,status,void_reason,created_at,voided_at from automatic_docks where business_date='2026-10-16' order by created_at"
  ];
  console.log('API_READS',await db.transaction(async tx=>{
    await tx.execute(sql`set transaction isolation level repeatable read read only`);
    const counts=[];
    for(const query of apiQueries)counts.push(resultRows(await tx.execute(sql.raw(query))).length);
    return counts;
  }));
  const audit=await evaluateBusinessDay("2026-10-16");
  const records=resultRows(await db.execute(sql`select d.*,e.canonical_name from automatic_docks d join employees e on e.id=d.employee_id where business_date='2026-10-16'`));
  const people=resultRows(await db.execute(sql`select id,job_title from employees`));
  console.table(audit.evaluations.map(e=>({employee:e.employee,formalRole:people.find(p=>p.id===e.employeeId)?.job_title,attendance:e.attendanceStatus,bypass:e.attendanceStatus==='BYPASSED',excluded:e.decision==='SKIP_EXCLUDED',calls:e.decision==='SKIP_EXCLUDED'?null:e.appointments,current:records.filter(r=>r.employee_id===e.employeeId).map(r=>`${r.rule_code}: ${r.amount} ${r.status}`).join('; '),expected:e.decision==='DOCK'?`${e.ruleCode}: ${e.amount}`:'None'})));
  console.log('STORED_EVALUATIONS',JSON.stringify(resultRows(await db.execute(sql`select evidence->>'employee' employee,evidence->>'decision' decision,evidence->>'ruleCode' rule,count(*) from auto_dock_evaluations where business_date='2026-10-16' group by 1,2,3 order by 1`))));
  for(const table of ['appointments','sales','leads','docks','dock_recipients','employees','employee_team_memberships','targets','attendance_messages','attendance_coverage']) {
    console.log('FINGERPRINT',table,JSON.stringify(resultRows(await db.execute(sql.raw(`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) hash from ${table} t`)))));
  }
  console.log('AUTOMATIC',JSON.stringify(records.map(r=>({employee:r.canonical_name,rule:r.rule_code,amount:r.amount,status:r.status,voidReason:r.void_reason}))));
}finally{await closeDb();}
