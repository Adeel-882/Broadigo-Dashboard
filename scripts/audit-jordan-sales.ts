import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const {default:postgres}=await import('postgres');
const {parserRegistry}=await import('../lib/parsers/registry');
const {isEligibleTopLevelMessage}=await import('../lib/slack/message-eligibility');
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
type Message={user?:string;text?:string;ts:string;thread_ts?:string;subtype?:string};
try{
  const channels=await db`select * from slack_channels where name in ('sales-reporting','broadigo-sales-reporting')`;
  const sources=await db`select sm.id raw_id,sm.slack_ts,sm.slack_user_id,sm.raw_text,sm.posted_at,sm.imported_at,sm.parser_status,c.name,c.slack_channel_id,c.parser_type,s.id sale_id,s.employee_id,e.canonical_name,s.customer_name,s.package_name,s.amount,s.occurred_at,(s.occurred_at at time zone 'America/Chicago')::date reporting_date from slack_messages sm join slack_channels c on c.id=sm.channel_id left join sales s on s.slack_message_id=sm.id left join employees e on e.id=s.employee_id where c.name in ('sales-reporting','broadigo-sales-reporting') and (sm.slack_user_id='U098A685CR4' or sm.slack_ts in ('1790628476.381119','1792253419.334259','1792516609.799179')) order by sm.posted_at`;
  const live:Array<Record<string,unknown>>=[];
  for(const channel of channels){
    let cursor='';let pages=0;
    do{
      const params=new URLSearchParams({channel:channel.slack_channel_id,limit:'200',...(cursor?{cursor}:{})});
      const response=await fetch('https://slack.com/api/conversations.history?'+params,{headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`},signal:AbortSignal.timeout(30000)});
      if(response.status===429)throw Error('Slack rate limit; retry audit later');
      const body=await response.json();if(!body.ok)throw Error(`Slack history unavailable: ${body.error}`);
      for(const message of body.messages as Message[]){
        if(message.user!=='U098A685CR4')continue;
        const parsed=isEligibleTopLevelMessage(message)?parserRegistry.parse(channel.parser_type,{rawSourceId:'audit-only',text:message.text!,postedAt:new Date(Number(message.ts)*1000)}):null;
        live.push({channel:channel.name,channelId:channel.slack_channel_id,ts:message.ts,user:message.user,text:message.text,thread_ts:message.thread_ts,eligible:isEligibleTopLevelMessage(message),parsed:parsed?{recordType:parsed.recordType,customer:parsed.values.customerName,plan:parsed.values.packageName,amount:parsed.values.amount}:null});
      }
      console.log('HISTORY_COVERAGE',channel.name,JSON.stringify({limited:body.is_limited??false,hasMore:body.has_more??false,messages:body.messages.length}));
      cursor=body.response_metadata?.next_cursor??'';pages++;
    }while(cursor);
    console.log('COMPLETE_CHANNEL',channel.name,'pages',pages);
  }
  await mkdir('outputs',{recursive:true});await writeFile('outputs/jordan-sales-audit.json',JSON.stringify({sources,live},null,2));
  console.log('STORED',JSON.stringify(sources.map(r=>({...r,raw_text:undefined})),null,2));
  console.log('LIVE',JSON.stringify(live.map(r=>({...r,text:undefined})),null,2));
}finally{await db.end();}
