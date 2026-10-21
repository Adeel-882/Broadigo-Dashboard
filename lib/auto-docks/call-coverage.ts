import {sql} from 'drizzle-orm';
import {autoDockDb,readAutoDockSettings,resultRows} from './service';
import {AUTO_DOCK_CALL_CHANNEL_IDS,businessWindow} from './policy';
import {ingestSlackHistoryBatch,type SlackHistoryMessage} from '@/lib/slack/ingest';
import {isEligibleTopLevelMessage} from '@/lib/slack/message-eligibility';

/** Fetch all pages before importing. A denied/partial read never certifies zero calls. */
export async function fetchCallDay(channel:string,date:string){
  const {start,end}=businessWindow(date),messages:SlackHistoryMessage[]=[],seen=new Set<string>();
  if(!process.env.SLACK_BOT_TOKEN)throw new Error('Slack token unavailable');
  let cursor='';
  do{
    const params=new URLSearchParams({channel,oldest:String(+start/1000),latest:String(+end/1000),inclusive:'true',limit:'100',cursor});
    const response=await fetch(`https://slack.com/api/conversations.history?${params}`,{headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`},signal:AbortSignal.timeout(15000),cache:'no-store'});
    if(!response.ok)throw new Error(`Call history HTTP ${response.status}; coverage incomplete`);
    const body=await response.json();
    if(!body.ok||!Array.isArray(body.messages))throw new Error(`Call history ${channel}: ${body.error??'invalid response'}`);
    messages.push(...(body.messages as SlackHistoryMessage[]).filter(m=>Number(m.ts)*1000>=+start&&Number(m.ts)*1000<+end));
    cursor=body.response_metadata?.next_cursor??'';
    if((body.has_more&&!cursor)||(cursor&&seen.has(cursor)))throw new Error('Incomplete call history pagination');
    seen.add(cursor);
  }while(cursor);
  return messages;
}
export async function syncCallDay(date:string,apply=false){
  const settings=await readAutoDockSettings(),db=autoDockDb(),fetchedAt=new Date();
  const pages=[];
  for(const channel of AUTO_DOCK_CALL_CHANNEL_IDS)pages.push({channel,messages:await fetchCallDay(channel,date)});
  if(apply){
    const configured=resultRows(await db.execute(sql`select slack_channel_id,parser_type from slack_channels where workspace_id=${settings.workspaceId} and active=true`));
    if(!AUTO_DOCK_CALL_CHANNEL_IDS.every(id=>configured.some(c=>c.slack_channel_id===id&&['leadsedge-appointment','broadigo-appointment'].includes(String(c.parser_type)))))throw new Error('Every call source must have an active canonical appointment parser');
  }
  const results=[];
  for(const {channel,messages} of pages){
    const existing=resultRows(await db.execute(sql`select sm.slack_ts,sm.parser_status from slack_messages sm join slack_channels c on c.id=sm.channel_id where sm.workspace_id=${settings.workspaceId} and c.slack_channel_id=${channel} and sm.posted_at>=${businessWindow(date).start.toISOString()}::timestamptz and sm.posted_at<${businessWindow(date).end.toISOString()}::timestamptz`));
    const pending=messages.filter(isEligibleTopLevelMessage).filter(m=>!existing.some(e=>e.slack_ts===m.ts&&!['PENDING','ERROR'].includes(String(e.parser_status)))).length;
    if(apply){
      // Already-settled sources need no replay; live message edits use normal ingestion.
      // Avoid needless transactions/reaction refreshes in the serverless cron budget.
      if(pending)await ingestSlackHistoryBatch(settings.workspaceId,channel,messages);
      if(businessWindow(date).end<=fetchedAt)await db.execute(sql`insert into auto_dock_call_coverage(business_date,workspace_id,channel_id,fetched_at,message_count) values(${date}::date,${settings.workspaceId},${channel},${fetchedAt.toISOString()}::timestamptz,${messages.length}) on conflict(business_date,workspace_id,channel_id) do update set fetched_at=excluded.fetched_at,message_count=excluded.message_count`);
    }
    results.push({channel,messages:messages.length,pending});
  }
  return {date,apply,complete:businessWindow(date).end<=fetchedAt,results};
}
