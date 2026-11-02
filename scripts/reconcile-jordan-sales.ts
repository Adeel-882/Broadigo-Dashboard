/** Management-approved, source-scoped repair. Dry run unless --apply. */
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
process.env.DATABASE_POOL_MAX='1';
const {default:postgres}=await import('postgres');
const {reprocessStoredSlackSource}=await import('../lib/slack/reprocess');
const {closeDb}=await import('../lib/db/client');
const {parserRegistry}=await import('../lib/parsers/registry');
const {isEligibleTopLevelMessage}=await import('../lib/slack/message-eligibility');
const {isAutoDockExcluded}=await import('../lib/auto-docks/policy');
const id='e18ba4b0-0b55-4615-b01d-c83379049b9f',user='U098A685CR4',workspace='T098UDG2RED',channel='C098D7NHQ69';
const timestamps=['1790628476.381119','1792253419.334259','1792516609.799179'];
const amounts=[720,1250,1200];
const apply=process.argv.includes('--apply');
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
const readSales=()=>db`select s.id,s.employee_id,e.canonical_name,s.customer_name,s.package_name,s.amount,s.occurred_at,sm.slack_ts,sm.slack_user_id,c.name source,(s.occurred_at at time zone 'America/Chicago')::date reporting_date from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=s.employee_id where s.employee_id=${id} order by s.occurred_at`;
const memberships=()=>db`select m.id,t.name,m.role,m.ranking_enabled,m.end_date from employee_team_memberships m join teams t on t.id=m.team_id where m.employee_id=${id} order by t.name`;
try{
  const identities=await db`select si.employee_id,e.canonical_name,e.job_title,e.active from employee_slack_identities si join employees e on e.id=si.employee_id where si.slack_user_id=${user} and si.workspace_id=${workspace}`;
  if(identities.length!==1||identities[0].employee_id!==id||identities[0].canonical_name!=='Jordan Reid'||identities[0].job_title!=='Closer'||!identities[0].active||!isAutoDockExcluded(id))throw Error('Identity/role/exemption guard failed');
  const guard=await db`select 1 from pg_constraint where conname='jordan_no_active_automatic_dock' and conrelid='automatic_docks'::regclass`;
  if(!guard.length)throw Error('Automatic dock guard missing');
  const [team]=await db`select id from teams where slug='broadigo-sales'`;
  if(!team)throw Error('Existing Broadigo Sales team missing');
  const sources=await db`select sm.*,c.parser_type from slack_messages sm join slack_channels c on c.id=sm.channel_id where c.slack_channel_id=${channel} and c.active and sm.slack_ts=any(${timestamps})`;
  if(sources.length!==3)throw Error('Expected three existing sources');
  for(const source of sources){
    const params=new URLSearchParams({channel,oldest:source.slack_ts,latest:source.slack_ts,inclusive:'true',limit:'1'});
    const response=await fetch('https://slack.com/api/conversations.history?'+params,{headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`},signal:AbortSignal.timeout(30000)});
    const body=await response.json();
    const message=body.messages?.find((m:{ts:string})=>m.ts===source.slack_ts);
    if(!body.ok||!message||message.user!==user||!isEligibleTopLevelMessage(message)||message.text!==source.raw_text||source.slack_user_id!==user||source.workspace_id!==workspace||source.employee_id!==id)throw Error('Source evidence/ownership mismatch; no correction applied');
    const parsed=parserRegistry.parse(source.parser_type,{rawSourceId:source.id,text:source.raw_text,postedAt:source.posted_at});
    if(parsed?.recordType!=='SALE'||parsed.values.amount!==amounts[timestamps.indexOf(source.slack_ts)])throw Error('Parser evidence mismatch');
    const existing=await db`select employee_id from sales where slack_message_id=${source.id}`;
    if(existing.some(s=>s.employee_id!==id))throw Error('Existing sale belongs to another employee');
  }
  const sourceIds=sources.map(s=>s.id);
  const fingerprint=async()=>{
    const result:Record<string,unknown>={};
    for(const table of ['appointments','leads','docks','dock_recipients','automatic_docks','targets','employees','employee_aliases','employee_slack_identities'])result[table]=await db.unsafe(`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by id)) hash from ${table} t`);
    result.memberships=await db`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by id)) hash from employee_team_memberships t where not(employee_id=${id} and team_id=${team.id})`;
    result.sales=await db`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by id)) hash from sales t where not(slack_message_id=any(${sourceIds}::uuid[]))`;
    result.sources=await db`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by id)) hash from slack_messages t where not(id=any(${sourceIds}::uuid[]))`;
    return result;
  };
  const before={sales:await readSales(),memberships:await memberships(),protected:await fingerprint()};
  await mkdir('outputs',{recursive:true});
  const reportPath=`outputs/jordan-sales-reconciliation-${Date.now()}`;
  await writeFile(reportPath+'-before.json',JSON.stringify(before,null,2));
  const results=[];
  if(apply){
    await db`insert into employee_team_memberships(employee_id,team_id,role,ranking_enabled) values(${id},${team.id},'Closer',true) on conflict(employee_id,team_id) do update set role='Closer',ranking_enabled=true,end_date=null`;
    for(const ts of timestamps)results.push(await reprocessStoredSlackSource(channel,ts));
    const once=await readSales();
    // Prove replay uses the same records rather than creating more sales.
    for(const ts of timestamps)await reprocessStoredSlackSource(channel,ts);
    if(JSON.stringify(once)!==JSON.stringify(await readSales()))throw Error('Idempotency verification failed');
  }
  const after={sales:await readSales(),memberships:await memberships(),protected:await fingerprint()};
  const protectedUnchanged=JSON.stringify(before.protected)===JSON.stringify(after.protected);
  const totals=await db`select count(*) sales,coalesce(sum(amount),0) lifetime_revenue,coalesce(sum(amount) filter(where occurred_at>='2026-10-11 00:00 America/Chicago'::timestamptz and occurred_at<'2026-11-03 00:00 America/Chicago'::timestamptz),0) requested_range_revenue from sales where employee_id=${id}`;
  const report={apply,before,after,results,protectedUnchanged,totals};
  await writeFile(reportPath+'-after.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,before:{sales:before.sales,memberships:before.memberships},after:{sales:after.sales,memberships:after.memberships}},null,2));
  if(!protectedUnchanged)throw Error('Protected data changed during execution; inspect evidence before further writes');
}finally{await closeDb();await db.end();}
