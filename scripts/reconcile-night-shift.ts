import {createRequire} from 'node:module';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const {sql}=await import('drizzle-orm');
const {autoDockDb,resultRows,readAutoDockSettings,evaluateBusinessDay}=await import('../lib/auto-docks/service');
const {syncCallDay}=await import('../lib/auto-docks/call-coverage');
const {syncAttendanceDay}=await import('../lib/auto-docks/attendance');
const {ingestSlackHistoryBatch}=await import('../lib/slack/ingest');
const {parserRegistry}=await import('../lib/parsers/registry');
const {closeDb}=await import('../lib/db/client');
const {readFile,writeFile}=await import('node:fs/promises');
const db=autoDockDb(),settings=await readAutoDockSettings(),mode=process.argv[2];
try{
if(mode==='backup-pause'){
 const backup:Record<string,unknown>={};
 for(const t of ['automatic_docks','auto_dock_runs','auto_dock_evaluations','auto_dock_settings','auto_dock_pending'])backup[t]=resultRows(await db.execute(sql.raw(`select * from ${t}`)));
 backup.functions=resultRows(await db.execute(sql`select proname,pg_get_functiondef(oid) definition from pg_proc where proname in ('queue_auto_dock_activity','queue_auto_dock_source_change')`));
 await writeFile('outputs/shift-financial-checkpoint.json',JSON.stringify(backup,null,2),{flag:'wx'});
 await db.execute(sql`update auto_dock_settings set enabled=false,updated_at=now() where id=1`);console.log('CHECKPOINT_SAVED_EVALUATOR_PAUSED');
}else if(mode==='apply'){
 const candidates=JSON.parse(await readFile('outputs/shift-parser-candidates.json','utf8')) as Array<{id:string;slack_channel_id:string}>;
 for(const channel of [...new Set(candidates.map(c=>c.slack_channel_id))]){
  const ids=candidates.filter(c=>c.slack_channel_id===channel).map(c=>c.id);
  const rows=resultRows(await db.execute(sql`select sm.slack_ts,sm.slack_user_id,sm.raw_text,sm.reactions from slack_messages sm where sm.id in (${sql.join(ids.map(id=>sql`${id}::uuid`),sql`,`)})`));
  console.log('BACKFILL',channel,await ingestSlackHistoryBatch(settings.workspaceId,channel,rows.map(r=>({ts:String(r.slack_ts),user:String(r.slack_user_id),text:String(r.raw_text),reactions:r.reactions as []}))));
 }
 const plan=JSON.parse(await readFile('outputs/shift-plan.json','utf8')) as Array<{date:string;employeeId:string;expectedDock:number;newCalls:number}>;
 const dates=[...new Set(plan.map(p=>p.date))];
 for(const date of dates){await syncAttendanceDay(date);await syncCallDay(date,true);}
 // Revalidate complete fresh evidence against the presented financial plan BEFORE financial writes.
 for(const date of dates){const dry=await evaluateBusinessDay(date);for(const e of dry.evaluations){const p=plan.find(p=>p.date===date&&p.employeeId===e.employeeId);if(!p||p.expectedDock!==e.amount||p.newCalls!==e.appointments)throw new Error(`Preview drift for ${date} ${e.employee}; inspect before applying`);}}
 await db.execute(sql`update auto_dock_settings set enabled=true,updated_at=now() where id=1`);
 const results=[];
 for(const date of dates){const before=new Date();const r=await evaluateBusinessDay(date,true);results.push(r);console.log('APPLIED',date,JSON.stringify({created:r.created,voided:r.voided,evaluated:r.evaluated}));await db.execute(sql`delete from auto_dock_pending where business_date=${date}::date and requested_at<=${before.toISOString()}::timestamptz`);}
 await writeFile('outputs/shift-applied.json',JSON.stringify(results,null,2));
}else if(mode==='verify'){
 const before=JSON.parse(await readFile('outputs/shift-before.json','utf8'));
 const protectedSnapshot:Record<string,unknown>={};
 for(const t of Object.keys(before.protectedSnapshot))protectedSnapshot[t]=resultRows(await db.execute(sql.raw(`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) hash from ${t} t`)));
 if(JSON.stringify(protectedSnapshot)!==JSON.stringify(before.protectedSnapshot))throw new Error('Protected data drift: inspect separately');
 const plan=JSON.parse(await readFile('outputs/shift-plan.json','utf8')) as Array<{date:string}>;
 let pending=0;
 for(const date of [...new Set(plan.map(p=>p.date))]){const r=await evaluateBusinessDay(date);const active=resultRows(await db.execute(sql`select employee_id,rule_code from automatic_docks where business_date=${date}::date and status='active'`));pending+=r.evaluations.filter(e=>(e.decision==='DOCK')!==active.some(a=>a.employee_id===e.employeeId&&a.rule_code===e.ruleCode)).length;}
 const candidates=JSON.parse(await readFile('outputs/shift-parser-candidates.json','utf8')) as Array<{id:string}>;
 const sources=resultRows(await db.execute(sql`select sm.id,sm.slack_ts,sm.parser_status,a.id appointment_id,a.employee_id,a.occurred_at from slack_messages sm join appointments a on a.slack_message_id=sm.id where sm.id in (${sql.join(candidates.map(c=>sql`${c.id}::uuid`),sql`,`)})`));
 const totals=resultRows(await db.execute(sql`select (select count(*) from effective_automatic_docks where status='active') active_count,(select coalesce(sum(amount),0) from effective_automatic_docks where status='active') active_total,(select count(*) from automatic_docks where status='voided') voided,(select count(*) from appointments) appointments,(select coalesce(sum(amount),0) from docks) manual_total,(select coalesce(sum(amount),0) from sales) revenue`));
 const result={protectedDataUnchanged:true,pendingFinancialCorrections:pending,sources,totals};await writeFile('outputs/shift-after.json',JSON.stringify(result,null,2));console.log(JSON.stringify(result));if(pending||sources.length!==candidates.length)throw new Error('Reconciliation incomplete');
}else throw new Error('Choose backup-pause, apply, or verify');
void parserRegistry;
}finally{await closeDb();}
