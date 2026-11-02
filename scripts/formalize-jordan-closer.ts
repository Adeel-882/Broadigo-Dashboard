/** Focused, idempotent management correction. Dry run unless --apply. */
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const {default:postgres}=await import('postgres');
const {businessWindow,evaluateAutoDockState,isAutoDockExcluded}=await import('../lib/auto-docks/policy');
const id='e18ba4b0-0b55-4615-b01d-c83379049b9f',user='U098A685CR4',workspace='T098UDG2RED';
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
const apply=process.argv.includes('--apply');
try {
  const report=await db.begin(async tx=>{
    await tx`set transaction isolation level repeatable read`;
    const employees=await tx`select id,canonical_name,pseudo_name,job_title,active from employees where id=${id}`;
    const identities=await tx`select employee_id,slack_user_id,workspace_id from employee_slack_identities where slack_user_id=${user} and workspace_id=${workspace}`;
    if(employees.length!==1||employees[0].canonical_name!=='Jordan Reid'||identities.length!==1||identities[0].employee_id!==id||!isAutoDockExcluded(id))throw Error('Canonical identity/exclusion verification failed');
    const aliases=['Jordan Reid','Jordan Reid (Shaheer Ali)','Shaheer Ali'];
    const conflicts=await tx`select id from employees where id<>${id} and (canonical_name=any(${aliases}) or pseudo_name=any(${aliases})) union all select employee_id from employee_aliases where employee_id<>${id} and alias=any(${aliases})`;
    if(conflicts.length)throw Error('Conflicting identity; no changes applied');
    const [team]=await tx`select id from teams where slug='broadigo-real-estate'`;
    if(!team)throw Error('Existing team not found');
    const fingerprint=async()=>{
      const result:Record<string,unknown>={};
      for(const table of ['appointments','sales','leads','docks','dock_recipients','targets','slack_messages'])result[table]=await tx.unsafe(`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by id)) hash from ${table} t`);
      for(const [table,key] of [['employees','id'],['employee_team_memberships','employee_id'],['automatic_docks','employee_id']])result[table]=await tx.unsafe(`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by id)) hash from ${table} t where ${key}<>$1::uuid`,[id]);
      return result;
    };
    const protectedBefore=await fingerprint();
    const membershipsBefore=await tx`select m.*,t.name from employee_team_memberships m join teams t on t.id=m.team_id where employee_id=${id}`;
    const automaticBefore=await tx`select id,business_date,rule_code,amount,status from automatic_docks where employee_id=${id}`;
    const counts=await tx`select (select count(*) from appointments where employee_id=${id}) posted,(select count(*) from appointments a join slack_messages sm on sm.id=a.slack_message_id where a.assigned_person=${user} and sm.workspace_id=${workspace}) assigned,(select count(*) from sales where employee_id=${id}) sales,(select coalesce(sum(amount),0) from sales where employee_id=${id}) revenue,(select count(*) from dock_recipients where employee_id=${id}) manual_docks`;
    let appended=0;
    if(apply){
      // Install the DB exclusion before making the employee eligible as a Closer.
      const guard=await tx`select 1 from pg_constraint where conname='jordan_no_active_automatic_dock' and conrelid='automatic_docks'::regclass`;
      if(!guard.length)throw Error('Apply migration 0016 before formalizing Jordan');
      if(automaticBefore.some(d=>d.status==='active'))throw Error('Active automatic dock requires exclusion migration first');
      await tx`update employees set job_title='Closer',pseudo_name='Shaheer Ali',active=true where id=${id} and (job_title is distinct from 'Closer' or pseudo_name is distinct from 'Shaheer Ali' or not active)`;
      await tx`insert into employee_team_memberships(employee_id,team_id,role,ranking_enabled) values(${id},${team.id},'Closer',true) on conflict(employee_id,team_id) do update set role='Closer',ranking_enabled=true,end_date=null`;
      for(const alias of aliases)await tx`insert into employee_aliases(employee_id,alias) values(${id},${alias}) on conflict(employee_id,alias) do nothing`;
      // Preserve earlier audit evidence. Append an explicit policy decision only
      // for dates that already had completed financial evaluations, never future days.
      const dates=await tx`select distinct on(business_date) id,business_date::text date from auto_dock_runs where status='COMPLETED' and business_date>='2026-10-16' order by business_date,started_at desc`;
      for(const date of dates){
        await tx`select pg_advisory_xact_lock(hashtext('auto-docks:'||${date.date}))`;
        const {start,end}=businessWindow(date.date);
        const evidence={...evaluateAutoDockState({employeeId:id,title:'Closer',active:true,membershipEligible:true,checkInFound:false,attendanceReliable:false,exempt:false,appointments:0,sales:0}),employeeId:id,employee:'Jordan Reid',title:'Closer',businessDate:date.date,windowStart:start.toISOString(),windowEnd:end.toISOString(),calls:[],checkIns:[],appointments:0,policyVersion:'jordan_management_exemption_v1'};
        const inserted=await tx`insert into auto_dock_evaluations(run_id,employee_id,business_date,evidence) select ${date.id},${id},${date.date}::date,${tx.json(evidence)} where not exists(select 1 from auto_dock_evaluations where employee_id=${id} and business_date=${date.date}::date and evidence->>'policyVersion'='jordan_management_exemption_v1') returning id`;
        appended+=inserted.length;
      }
    }
    const protectedAfter=await fingerprint();
    if(JSON.stringify(protectedBefore)!==JSON.stringify(protectedAfter))throw Error('Protected data changed; rolling back');
    return {apply,employeeId:id,slackUserId:user,before:employees,membershipsBefore,counts,automaticBefore,appendedExclusions:appended,after:await tx`select canonical_name,pseudo_name,job_title,active from employees where id=${id}`,membershipsAfter:await tx`select t.name,m.role,m.ranking_enabled,m.end_date from employee_team_memberships m join teams t on t.id=m.team_id where employee_id=${id}`,protectedBefore,protectedAfter,protectedUnchanged:true};
  });
  await mkdir('outputs',{recursive:true});
  await writeFile(`outputs/jordan-closer-${apply?'applied':'audit'}.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,protectedBefore:undefined,protectedAfter:undefined},null,2));
}finally{await db.end();}
