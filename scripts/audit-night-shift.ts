import {createRequire} from 'node:module';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const {sql}=await import('drizzle-orm');
const {autoDockDb,resultRows,readAutoDockSettings,evaluateBusinessDay}=await import('../lib/auto-docks/service');
const {latestClosedBusinessDate,evaluateAutoDockState,AUTO_DOCK_CALL_CHANNEL_IDS}=await import('../lib/auto-docks/policy');
const {autoDockBusinessDateFor}=await import('../lib/auto-docks/time');
const {parserRegistry}=await import('../lib/parsers/registry');
const {fetchCallDay}=await import('../lib/auto-docks/call-coverage');
const {ingestSlackHistoryBatch}=await import('../lib/slack/ingest');
const {closeDb}=await import('../lib/db/client');
const {writeFile,mkdir}=await import('node:fs/promises');
const db=autoDockDb(),settings=await readAutoDockSettings();
try{
await mkdir('outputs',{recursive:true});
const latest=latestClosedBusinessDate();
const protectedTables=['docks','dock_recipients','sales','leads','employees','employee_slack_identities','employee_team_memberships','targets','auto_dock_overrides','auto_dock_edit_history'];
const protectedSnapshot:Record<string,unknown>={};
for(const t of protectedTables)protectedSnapshot[t]=resultRows(await db.execute(sql.raw(`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by to_jsonb(t)::text)) hash from ${t} t`)));
const totals=resultRows(await db.execute(sql`select (select count(*) from effective_automatic_docks where status='active') active_count,(select coalesce(sum(amount),0) from effective_automatic_docks where status='active') active_total,(select count(*) from automatic_docks where status='voided') voided,(select count(*) from appointments) appointments,(select coalesce(sum(amount),0) from docks) manual_total,(select coalesce(sum(amount),0) from sales) revenue`));
await writeFile('outputs/shift-before.json',JSON.stringify({protectedSnapshot,totals},null,2),{flag:'wx'});
// Stored sources include off-shift calls too; only proven new parse results qualify.
const sourceRows=resultRows(await db.execute(sql`select sm.id,sm.slack_ts,sm.slack_user_id,sm.raw_text,sm.posted_at,sm.parser_status,sm.source_unavailable_at,c.slack_channel_id,c.parser_type,i.employee_id,a.id appointment_id from slack_messages sm join slack_channels c on c.id=sm.channel_id left join employee_slack_identities i on i.workspace_id=sm.workspace_id and i.slack_user_id=sm.slack_user_id left join appointments a on a.slack_message_id=sm.id where sm.workspace_id=${settings.workspaceId} and c.slack_channel_id in (${sql.join(AUTO_DOCK_CALL_CHANNEL_IDS.map(c=>sql`${c}`),sql`,`)}) and sm.posted_at>='2026-10-15T19:00:00Z' and sm.posted_at<(${latest}::date+1)::timestamptz`));
const candidates=sourceRows.filter(r=>!r.appointment_id&&!r.source_unavailable_at&&r.parser_status==='UNPARSED'&&parserRegistry.parse(String(r.parser_type),{rawSourceId:String(r.id),text:String(r.raw_text),postedAt:new Date(String(r.posted_at))})?.recordType==='APPOINTMENT');
const plans=[];
for(let date='2026-10-16';date<=latest;date=new Date(Date.parse(date+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
 for(const channel of AUTO_DOCK_CALL_CHANNEL_IDS){const messages=await fetchCallDay(channel,date);console.log('COVERAGE',date,channel,messages.length);}
 const current=await evaluateBusinessDay(date);
 const previous=resultRows(await db.execute(sql`select distinct on(employee_id) employee_id,evidence from auto_dock_evaluations where business_date=${date}::date order by employee_id,evaluated_at desc`));
 const docks=resultRows(await db.execute(sql`select * from effective_automatic_docks where business_date=${date}::date`));
 for(const e of current.evaluations){const missed=candidates.filter(c=>c.employee_id===e.employeeId&&autoDockBusinessDateFor(new Date(String(c.posted_at)))===date);const expected=evaluateAutoDockState({...e,appointments:e.appointments+missed.length});const old=previous.find(p=>p.employee_id===e.employeeId)?.evidence as Record<string,unknown>|undefined;const active=docks.filter(d=>d.employee_id===e.employeeId&&d.status==='active');const action=active.length&&!expected.amount?'VOID':!active.length&&expected.amount?'CREATE':'KEEP';plans.push({date,employee:e.employee,employeeId:e.employeeId,role:e.role,oldAttendance:old?.attendanceStatus,newAttendance:expected.attendanceStatus,oldCalls:old?.appointments,newCalls:e.appointments+missed.length,currentDock:active.reduce((a,d)=>a+Number(d.amount),0),expectedDock:expected.amount,reason:missed.length?'PARSER_VARIANT':old?.attendanceStatus!==expected.attendanceStatus||old?.appointments!==e.appointments?'WRONG_SHIFT_WINDOW':'UNCHANGED',action});}
}
await writeFile('outputs/shift-plan.json',JSON.stringify(plans,null,2));
await writeFile('outputs/shift-parser-candidates.json',JSON.stringify(candidates.map(r=>({...r,raw_text:undefined})),null,2));
console.log('CANDIDATES',candidates.length,'TOTALS',JSON.stringify(totals));console.table(plans.filter(p=>p.action!=='KEEP'||p.reason!=='UNCHANGED'));
// Apply is intentionally a separate invocation after the reviewed preview.
void ingestSlackHistoryBatch;
}finally{await closeDb();}
