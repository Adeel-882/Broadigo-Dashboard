import {createRequire} from 'node:module';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const {default:postgres}=await import('postgres');
const {parserRegistry}=await import('../lib/parsers/registry');
const {isEligibleTopLevelMessage}=await import('../lib/slack/message-eligibility');
const {evaluateAutoDockState,latestClosedBusinessDate}=await import('../lib/auto-docks/policy');
const {evaluateBusinessDay}=await import('../lib/auto-docks/service');
const {closeDb}=await import('../lib/db/client');
const {mkdir,writeFile}=await import('node:fs/promises');
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
type Message={ts:string;user?:string;text?:string;thread_ts?:string;subtype?:string};
const messages:Message[]=[];
try{
  let cursor='';let pages=0;
  do{
    const params=new URLSearchParams({channel:'C0BADNJL14L',limit:'100',...(cursor?{cursor}:{})});
    const response=await fetch(`https://slack.com/api/conversations.history?${params}`,{headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`}});
    const body=await response.json();if(!body.ok)throw new Error(`Slack history incomplete: ${body.error}`);
    messages.push(...body.messages);cursor=body.response_metadata?.next_cursor??'';pages++;
    if(body.has_more&&!cursor)throw new Error('Partial history: pagination cursor missing');
  }while(cursor);
  console.log('COVERAGE',JSON.stringify({pages,messages:messages.length,earliest:new Date(Math.min(...messages.map(m=>Number(m.ts)*1000))).toISOString(),latest:new Date(Math.max(...messages.map(m=>Number(m.ts)*1000))).toISOString()}));
  console.log('CHANNELS',JSON.stringify(await db`select c.id,c.name,c.slack_channel_id,c.parser_type,c.team_id,t.name team,c.active,(select count(*) from appointments a join slack_messages sm on sm.id=a.slack_message_id where sm.channel_id=c.id) calls from slack_channels c left join teams t on t.id=c.team_id where slack_channel_id in ('C0BADNJL14L','C098WNHNBR7','C0B0P6P7FPG')`));
  const identities=await db`select i.slack_user_id,e.id,e.canonical_name,e.job_title from employee_slack_identities i join employees e on e.id=i.employee_id where i.workspace_id='T098UDG2RED'`;
  const counts=new Map<string,{date:string;employee:string;role:string;calls:number}>();
  for(const m of messages){
    if(!isEligibleTopLevelMessage(m)||Number(m.ts)<Date.parse('2026-10-16T00:00:00Z')/1000)continue;
    const postedAt=new Date(Number(m.ts)*1000);
    if(parserRegistry.parse('leadsedge-appointment',{rawSourceId:m.ts,text:m.text!,postedAt,employeeId:null})?.recordType!=='APPOINTMENT')continue;
    const who=identities.find(i=>i.slack_user_id===m.user);const date=postedAt.toISOString().slice(0,10);const key=date+':'+m.user;
    const row=counts.get(key)??{date,employee:who?.canonical_name??`Unmapped ${m.user}`,role:who?.job_title??'',calls:0};row.calls++;counts.set(key,row);
  }
  console.table([...counts.values()].sort((a,b)=>a.date.localeCompare(b.date)||a.employee.localeCompare(b.employee)));
  console.log('VALID_CALLS', [...counts.values()].reduce((n,r)=>n+r.calls,0));
  console.log('CURRENT_DOCKS',JSON.stringify(await db`select d.business_date,e.canonical_name employee,d.rule_code,d.amount,d.status,d.evidence->>'appointments' calls from automatic_docks d join employees e on e.id=d.employee_id where business_date>='2026-10-16' order by business_date,employee`));
  const full=[];const actual=await db`select employee_id,business_date::text,rule_code,amount,status from automatic_docks where business_date>='2026-10-16'`;
  for(let day='2026-10-16';day<=latestClosedBusinessDate();day=new Date(Date.parse(day+'T00:00:00Z')+86400000).toISOString().slice(0,10)){
    const audit=await evaluateBusinessDay(day);
    for(const e of audit.evaluations){const added=[...counts.values()].filter(r=>r.date===day&&r.employee===e.employee).reduce((n,r)=>n+r.calls,0);const next=evaluateAutoDockState({...e,appointments:e.appointments+added});const active=actual.filter(r=>r.employee_id===e.employeeId&&r.business_date===day&&r.status==='active');
      full.push({date:day,employee:e.employee,role:e.title,oldCalls:e.appointments,newChannelCalls:added,totalCalls:e.appointments+added,currentDecision:e.decision,expectedDecision:next.decision,currentAmount:active.reduce((n,r)=>n+Number(r.amount),0),expectedAmount:next.amount,action:active.length&&next.decision!=='DOCK'?'VOID':!active.length&&next.decision==='DOCK'?'CREATE':active.length?'KEEP':'NO ACTION'});
    }
  }
  console.table(full.filter(r=>r.currentDecision!==r.expectedDecision||['VOID','CREATE'].includes(r.action)));
  await mkdir('outputs',{recursive:true});await writeFile('outputs/lhub-before-audit.json',JSON.stringify(full,null,2));
}finally{await db.end();await closeDb();}
