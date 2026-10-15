import {createRequire} from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const {sql}=await import("drizzle-orm");
const {autoDockDb,resultRows,evaluateBusinessDay}=await import("../lib/auto-docks/service");
const {closeDb}=await import("../lib/db/client");
try{
  const db=autoDockDb();
  const totals=resultRows(await db.execute(sql`select count(*) total,count(*) filter(where status='active') active,count(*) filter(where status='voided') voided from automatic_docks`));
  const automatic=resultRows(await db.execute(sql`select e.canonical_name employee,d.business_date,d.rule_code,d.amount,d.status,d.reason,d.created_at from automatic_docks d join employees e on e.id=d.employee_id order by d.business_date,e.canonical_name`));
  const constraints=resultRows(await db.execute(sql`select conname,pg_get_constraintdef(oid) definition from pg_constraint where conrelid='automatic_docks'::regclass and contype='c' order by conname`));
  const snapshots:Record<string,unknown>={};
  for(const table of ["appointments","sales","leads","docks","dock_recipients","employees","employee_team_memberships","attendance_messages","attendance_coverage","auto_dock_settings","auto_dock_evaluations","auto_dock_runs"]){
    snapshots[table]=resultRows(await db.execute(sql`select count(*) n,md5(string_agg(row::text,'' order by row::text)) fingerprint from (select to_jsonb(t) row from ${sql.raw(table)} t) s`))[0];
  }
  const amounts=resultRows(await db.execute(sql`select (select sum(amount) from sales) revenue,(select sum(d.amount*greatest(1,(select count(*) from dock_recipients dr where dr.dock_id=d.id))) from docks d) manual_total`));
  const dryRuns=[];
  for(const date of ["2026-10-12","2026-10-13","2026-10-14"]){const result=await evaluateBusinessDay(date);dryRuns.push({date,reliable:result.reliable,evaluations:result.evaluations});}
  const baselineLeadCount=Number(process.argv.find(a=>a.startsWith("--baseline-leads="))?.split("=")[1]??0);
  if(!Number.isSafeInteger(baselineLeadCount)||baselineLeadCount<0)throw new Error("Invalid baseline lead count");
  const originalLeads=baselineLeadCount?resultRows(await db.execute(sql`select count(*) n,md5(string_agg(row::text,'' order by row::text)) fingerprint from (select to_jsonb(l) row from leads l join slack_messages sm on sm.id=l.slack_message_id order by sm.imported_at,l.id limit ${baselineLeadCount}) s`))[0]:null;
  const recentLeadSources=resultRows(await db.execute(sql`select sm.slack_ts,sm.posted_at,sm.imported_at from leads l join slack_messages sm on sm.id=l.slack_message_id order by sm.imported_at desc limit 3`));
  console.log(JSON.stringify({totals,automatic,constraints,snapshots,amounts,dryRuns,originalLeads,recentLeadSources}));
}finally{await closeDb();}
