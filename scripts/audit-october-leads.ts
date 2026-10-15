/** Read-only by default. --slack --apply repairs only proven, approved October lead sources. */
import {createRequire} from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const {default:postgres}=await import("postgres");
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
import {deriveLeadEligibility} from "../lib/slack/reactions";
import {isEligibleTopLevelMessage} from "../lib/slack/message-eligibility";
import {parserRegistry} from "../lib/parsers/registry";
import type {SlackHistoryMessage} from "../lib/slack/ingest";
const dates=[1,2,5,6,7,8,9,12,13,14].map(d=>`2026-10-${String(d).padStart(2,'0')}`);
// Authorized benchmark only; never imported into production data.
const expected:Record<string,number[]>={
 'Muhammad Fasial':[0,1,0,0,0,0,0,0,0,1], 'Asif Hazoor':[4,3,5,3,6,3,0,3,3,1],
 'Syed Ali Jan':[2,2,1,1,0,3,2,1,5,1], 'Alishba Zareh':[2,1,2,1,2,2,1,1,1,2],
 'Aishah Arif':[0,1,0,0,4,2,3,1,0,1], 'Muhammad Zeeshan':[2,2,2,3,0,2,2,0,2,4],
 'Saad Ali':[1,1,2,0,2,0,3,0,1,2], 'Muhammad Eman':[3,3,0,0,0,2,2,0,1,4],
 'Dilshad Ullah Danish':[2,0,1,2,0,1,1,3,1,1], 'Abdul Wali':[0,1,0,0,0,1,0,1,0,0],
 'Nawal Tariq':[0,0,0,0,0,0,2,0,0,1],
};
try {
  const rows=await db`select l.id,sm.id raw_id,c.slack_channel_id,sm.slack_ts,sm.slack_user_id,
    l.employee_id,e.canonical_name employee,sm.employee_id raw_employee_id,
    l.contact_name,l.occurred_at,sm.posted_at,sm.imported_at,sm.reactions_synced_at,
    l.counts_toward_kpi,l.exclusion_reasons,sm.reactions,
    to_char((timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date,'YYYY-MM-DD') business_date,
    sm.raw_text
    from leads l join slack_messages sm on sm.id=l.slack_message_id
    join slack_channels c on c.id=sm.channel_id left join employees e on e.id=l.employee_id
    where c.slack_channel_id='C098C93DGTY'
    and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00' or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00') and
    (l.occurred_at >= '2026-10-01T00:00:00Z' and l.occurred_at < '2026-10-15T00:00:00Z'
      or l.contact_name ilike '%mervat%') order by sm.slack_ts`;
  const identities=await db`select si.slack_user_id,si.employee_id,e.canonical_name,e.pseudo_name from employee_slack_identities si join employees e on e.id=si.employee_id`;
  const duplicates=await db`select slack_message_id,count(*) from leads group by 1 having count(*)>1`;
  if(process.argv.includes('--diagnostics')) {
    console.log(JSON.stringify({events:await db`select * from slack_ingest_log where slack_channel_id='C098C93DGTY' and (slack_ts in ('1791843228.130579','1790958602.271949') or result='ignored' and received_at between '2026-10-12' and '2026-10-14') order by received_at`,employees:await db`select id,canonical_name,pseudo_name,active from employees`,byOwner:await db`select e.canonical_name,sm.slack_user_id,count(*) n,min(l.occurred_at),max(l.occurred_at) from leads l join slack_messages sm on sm.id=l.slack_message_id left join employees e on e.id=l.employee_id where l.occurred_at between '2026-10-01' and '2026-10-15' group by 1,2`,identityTables:await db`select table_name from information_schema.tables where table_schema='public' and table_name ilike '%identit%'`}));
  } else
  if(process.argv.includes('--slack')) {
    const live:SlackHistoryMessage[]=[];let cursor='';
    do {
      const params=new URLSearchParams({channel:'C098C93DGTY',oldest:String(Date.parse('2026-10-01T14:00:00Z')/1000),latest:String(Date.parse('2026-10-15T00:00:00Z')/1000),inclusive:'true',limit:'200',cursor});
      const response=await fetch(`https://slack.com/api/conversations.history?${params}`,{headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`}});
      if(response.status===429)throw new Error(`Rate limited; retry in ${response.headers.get('retry-after')} seconds`);
      const payload=await response.json();if(!payload.ok)throw new Error(`Slack: ${payload.error}`);
      live.push(...payload.messages);cursor=payload.response_metadata?.next_cursor??'';
    }while(cursor);
    const byTs=new Map(live.map(m=>[m.ts,m]));
    const absentChecks=[];
    for(const r of rows.filter(r=>dates.includes(r.business_date)&&!byTs.has(r.slack_ts))){
      const response=await fetch(`https://slack.com/api/reactions.get?${new URLSearchParams({channel:'C098C93DGTY',timestamp:r.slack_ts,full:'true'})}`,{headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`}});
      const payload=await response.json();absentChecks.push({ts:r.slack_ts,ok:payload.ok,error:payload.error});
    }
    const pending:Array<{r:(typeof rows)[number];employeeId:string;employee:string;unavailable:boolean;eligibility:ReturnType<typeof deriveLeadEligibility>;reactions:NonNullable<SlackHistoryMessage['reactions']>;reason:string}>=[];
    for(const r of rows.filter(r=>dates.includes(r.business_date))){
      const identity=identities.find(id=>id.slack_user_id===r.slack_user_id);
      // Management excluded Fasial; unknown/non-roster identities are never rewritten.
      if(!identity||identity.canonical_name==='Muhammad Fasial'||!(identity.canonical_name in expected))continue;
      const m=byTs.get(r.slack_ts);
      const unavailable=absentChecks.some(a=>a.ts===r.slack_ts&&a.error==='message_not_found');
      if(!m&&!unavailable)throw new Error('Source could not be verified');
      if(m&&(!isEligibleTopLevelMessage(m)||m.user!==r.slack_user_id))throw new Error('Parent identity requires review');
      if(Math.abs(new Date(r.occurred_at).getTime()-Math.floor(Number(r.slack_ts)*1000))>1)throw new Error('Source date requires review');
      const eligibility=deriveLeadEligibility(m?.reactions??r.reactions,unavailable);
      const ownerChanged=r.employee_id!==identity.employee_id||r.raw_employee_id!==identity.employee_id;
      if(ownerChanged||r.counts_toward_kpi!==eligibility.countsTowardKpi||JSON.stringify(r.exclusion_reasons)!==JSON.stringify(eligibility.exclusionReasons)){
        pending.push({r,employeeId:identity.employee_id,employee:identity.canonical_name,unavailable,eligibility,reactions:m?.reactions??r.reactions,reason:unavailable?'OTHER_PROVEN_CAUSE: source absent from complete history and message_not_found':r.employee_id?'WRONG_EMPLOYEE: approved October parent-author mapping':'IDENTITY_MAPPING_ERROR: previously unmapped author'});
      }
    }
    console.error(JSON.stringify({absentChecks,pending:pending.map(p=>({id:p.r.id,ts:p.r.slack_ts,date:p.r.business_date,before:p.r.employee,after:p.employee,reason:p.reason})),dateMismatches:0}));
    if(process.argv.includes('--apply')) {
      await db.begin(async tx=>{
        await tx`select pg_advisory_xact_lock(hashtext('october-lead-reconciliation'))`;
        for(const p of pending){
          const [old]=await tx`select to_jsonb(l) lead,to_jsonb(sm) source from leads l join slack_messages sm on sm.id=l.slack_message_id where l.id=${p.r.id} for update of l,sm`;
          if(!old||old.source.slack_ts!==p.r.slack_ts||old.lead.employee_id!==p.r.employee_id||old.lead.counts_toward_kpi!==p.r.counts_toward_kpi)throw new Error('Source changed during audit; rerun dry-run');
          await tx`update slack_messages set employee_id=${p.employeeId},reactions=${JSON.stringify(p.reactions)}::jsonb,reactions_synced_at=now(),source_unavailable_at=case when ${p.unavailable} then coalesce(source_unavailable_at,now()) else source_unavailable_at end where id=${p.r.raw_id}`;
          await tx`update leads set employee_id=${p.employeeId},counts_toward_kpi=${p.eligibility.countsTowardKpi},exclusion_reasons=${tx.json(p.eligibility.exclusionReasons)} where id=${p.r.id}`;
          const [after]=await tx`select to_jsonb(l) lead,to_jsonb(sm) source from leads l join slack_messages sm on sm.id=l.slack_message_id where l.id=${p.r.id}`;
          await tx`insert into lead_reconciliation_audit(lead_id,reason,before_state,after_state) values(${p.r.id},${p.reason},${tx.json(old)},${tx.json(after)})`;
        }
      });
      console.error(JSON.stringify({applied:pending.length}));
    }
    const table=Object.entries(expected).flatMap(([employee,counts])=>dates.map((date,i)=>{
      const records=rows.filter(r=>r.employee===employee&&r.business_date===date);
      const counted=records.filter(r=>r.counts_toward_kpi).length;
      return {date,employee,expected:counts[i],counted,submitted:records.length,excluded:records.length-counted,delta:counted-counts[i],records:records.map(r=>{
        const m=byTs.get(r.slack_ts);return {id:r.id,prospect:r.contact_name,ts:r.slack_ts,author:r.slack_user_id,eligible:r.counts_toward_kpi,liveFound:!!m,liveAuthor:m?.user,liveThread:m?.thread_ts,liveEligibility:m?deriveLeadEligibility(m.reactions):null};
      })};
    }));
    const liveLeads=live.filter(isEligibleTopLevelMessage).filter(m=>parserRegistry.parse('leads',{rawSourceId:m.ts,text:m.text!,postedAt:new Date(Number(m.ts)*1000),employeeId:null}));
    const projected=Object.entries(expected).filter(([name])=>name!=='Muhammad Fasial').flatMap(([employee,counts])=>dates.map((date,i)=>{
      const matching=rows.filter(r=>r.business_date===date&&identities.some(id=>id.slack_user_id===r.slack_user_id&&id.canonical_name===employee));
      return {date,employee,expected:counts[i],projected:matching.filter(r=>{const m=byTs.get(r.slack_ts);return m&&deriveLeadEligibility(m.reactions).countsTowardKpi;}).length};
    }));
    const report={table,duplicates,projected,missingSources:liveLeads.filter(m=>!rows.some(r=>r.slack_ts===m.ts)).map(m=>({ts:m.ts,user:m.user,eligibility:deriveLeadEligibility(m.reactions)})),absent:rows.filter(r=>dates.includes(r.business_date)&&!byTs.has(r.slack_ts)).map(r=>({id:r.id,ts:r.slack_ts,employee:r.employee,prospect:r.contact_name})),mervat:live.filter(m=>/mervat/i.test(m.text??'')).map(m=>({ts:m.ts,user:m.user,thread_ts:m.thread_ts,reactions:m.reactions})),liveMessages:live.length};
    console.log(JSON.stringify(process.argv.includes('--summary')?{...report,table:table.filter(r=>r.delta!==0).map(({records,...r})=>({...r,records:records.filter(s=>!s.liveFound||s.eligible!==s.liveEligibility?.countsTowardKpi)})),projected:projected.filter(r=>r.projected!==r.expected)}:report));
    process.exitCode=0;
  } else
  if(process.argv.includes('--source')) {
    console.log(JSON.stringify({mervat:rows.filter(r=>String(r.contact_name).toLowerCase().includes('mervat')),identities,duplicates}));
  } else console.log(JSON.stringify({rows:rows.map(r=>Object.fromEntries(Object.entries(r).filter(([key])=>key!=='raw_text'))),identities,duplicates}));
} finally {await db.end({timeout:5});}
