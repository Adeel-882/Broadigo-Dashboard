import { createRequire } from "node:module";
import { parserRegistry } from "../lib/parsers/registry";
import { dockAuthorLabel } from "../lib/slack/dock-author";
import { dockRecipientPlan, slackSourceDate } from "../lib/slack/dock-reconciliation";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL;
const token = process.env.SLACK_BOT_TOKEN;
if (!databaseUrl || !token) throw new Error("DATABASE_URL and SLACK_BOT_TOKEN are required.");
const { default: postgres } = await import("postgres");
const db = postgres(databaseUrl,{max:1,prepare:false,connect_timeout:20});
type SlackMessage={ts:string;user?:string;text?:string;subtype?:string;thread_ts?:string};

async function currentSlackMessages(channel:string){
  const messages:SlackMessage[]=[];let cursor="";
  do { const response=await fetch(`https://slack.com/api/conversations.history?${new URLSearchParams({channel,limit:"200",...(cursor?{cursor}:{})})}`,{headers:{authorization:`Bearer ${token}`}});const body=await response.json() as {ok:boolean;error?:string;messages?:SlackMessage[];response_metadata?:{next_cursor?:string}};if(!body.ok)throw new Error(`Slack history failed: ${body.error}`);messages.push(...(body.messages??[]));cursor=body.response_metadata?.next_cursor??""; } while(cursor);
  return messages.filter(message=>message.text&&!message.thread_ts&&!message.subtype);
}

try {
  const [channel]=await db`select id,workspace_id,slack_channel_id,team_id from slack_channels where slack_channel_id='C099K4LKD8Q' and active=true limit 1`;
  if(!channel)throw new Error("Active docks-reporting channel not found.");
  const [identityRows,employeeRows,existingRows,messages]=await Promise.all([
    db`select employee_id,workspace_id,slack_user_id,display_name from employee_slack_identities where workspace_id=${channel.workspace_id}`,
    db`select id,canonical_name,pseudo_name from employees`,
    db`select sm.slack_ts,sm.id message_id,sm.raw_text,sm.slack_user_id,d.id dock_id,d.amount,d.reason,d.applied_by,d.occurred_at,
      coalesce(array_agg(dr.employee_id::text order by dr.employee_id::text) filter(where dr.id is not null),'{}') recipient_ids
      from slack_messages sm left join docks d on d.slack_message_id=sm.id left join dock_recipients dr on dr.dock_id=d.id
      where sm.channel_id=${channel.id} group by sm.id,d.id`,
    currentSlackMessages(String(channel.slack_channel_id)),
  ]);
  const identityBySlack=new Map(identityRows.map(row=>[String(row.slack_user_id),row]));
  const employeeById=new Map(employeeRows.map(row=>[String(row.id),row]));
  const existingByTs=new Map(existingRows.map(row=>[String(row.slack_ts),row]));
  const expected=[] as Array<{source:SlackMessage;amount:string;reason:string;appliedBy:string|null;employeeIds:string[];unresolved:string[]}>;
  for(const source of messages){const parsed=parserRegistry.parse("dock",{rawSourceId:source.ts,text:source.text!,postedAt:slackSourceDate(source.ts)});if(!parsed||parsed.recordType!=="DOCK"||parsed.values.amount==null)continue;const targetIds=[...new Set(((parsed.values.targetSlackUserIds as string[] | undefined)??[]))];const employeeIds=[...new Set(targetIds.map(id=>identityBySlack.get(id)?.employee_id).filter(Boolean).map(String))].sort();const unresolved=targetIds.filter(id=>!identityBySlack.has(id));const authorIdentity=source.user?identityBySlack.get(source.user):undefined;const author=authorIdentity?employeeById.get(String(authorIdentity.employee_id)):undefined;expected.push({source,amount:Number(parsed.values.amount).toFixed(2),reason:String(parsed.values.reason),appliedBy:dockAuthorLabel(author?.canonical_name?String(author.canonical_name):null,author?.pseudo_name?String(author.pseudo_name):null,authorIdentity?.display_name?String(authorIdentity.display_name):null),employeeIds,unresolved});}
  const actions=[] as Array<Record<string,unknown>>;
  for(const item of expected){const current=existingByTs.get(item.source.ts);const currentRecipients=((current?.recipient_ids??[]) as string[]).map(String).sort();const plan=dockRecipientPlan(currentRecipients,item.employeeIds);const mismatches=[] as string[];const currentDate=current?.occurred_at?new Date(current.occurred_at as Date | string):null;const expectedDate=slackSourceDate(item.source.ts);if(!current?.dock_id)mismatches.push("missing-parent");if(String(current?.raw_text??"")!==item.source.text)mismatches.push("raw-text");if(String(current?.amount??"")!==item.amount)mismatches.push("amount");if(String(current?.reason??"")!==item.reason)mismatches.push("reason");if(String(current?.applied_by??"")!==String(item.appliedBy??""))mismatches.push("author");if(currentDate&&currentDate.getTime()!==expectedDate.getTime())mismatches.push("source-date");if(plan.insert.length)mismatches.push("missing-recipients");if(plan.remove.length)mismatches.push("stale-recipients");if(mismatches.length)actions.push({source:item.source.ts,mismatches,current_date:currentDate?.toISOString(),expected_date:expectedDate.toISOString(),current_recipients:currentRecipients,expected_recipients:item.employeeIds,insert:plan.insert,remove:plan.remove,amount:`${current?.amount??"missing"} -> ${item.amount}`,author:item.appliedBy,reason:item.reason,unresolved:item.unresolved});}
  const expectedTs=new Set(expected.map(item=>item.source.ts));const stale=existingRows.filter(row=>row.dock_id&&messages.some(message=>message.ts===String(row.slack_ts))&&!expectedTs.has(String(row.slack_ts)));
  console.log(`${apply?"APPLY":"DRY RUN"}: Slack sources=${expected.length}, expected employee rows=${expected.reduce((sum,item)=>sum+item.employeeIds.length,0)}, changed sources=${actions.length}, stale structured sources=${stale.length}`);
  const materialRecipientChanges=actions.filter(action=>(action.insert as string[]).length>0||(action.remove as string[]).length>0);
  console.log(JSON.stringify(apply?materialRecipientChanges:actions.slice(0,25),null,2));
  if(!apply&&actions.length>25)console.log(`... ${actions.length-25} additional changed sources omitted from console output.`);
  if(apply)await db.begin(async tx=>{
    const missing=expected.filter(item=>!existingByTs.get(item.source.ts)?.dock_id);
    if(missing.length)throw new Error(`${missing.length} Slack dock sources are missing structured parent rows; run history sync before reconciliation.`);
    const payload=expected.map(item=>({
      ts:item.source.ts,raw_text:item.source.text,user_id:item.source.user??null,
      posted_at:slackSourceDate(item.source.ts).toISOString(),amount:item.amount,
      reason:item.reason,applied_by:item.appliedBy,employee_ids:item.employeeIds,
      parent_employee_id:item.employeeIds.length===1?item.employeeIds[0]:null,
    }));
    await tx`with source as (select * from jsonb_to_recordset(${tx.json(payload)}) as x(ts text,raw_text text,user_id text,posted_at timestamptz,amount numeric,reason text,applied_by text,employee_ids jsonb,parent_employee_id uuid))
      update slack_messages sm set raw_text=source.raw_text,slack_user_id=source.user_id,posted_at=source.posted_at
      from source where sm.channel_id=${channel.id}::uuid and sm.slack_ts=source.ts`;
    await tx`with source as (select * from jsonb_to_recordset(${tx.json(payload)}) as x(ts text,raw_text text,user_id text,posted_at timestamptz,amount numeric,reason text,applied_by text,employee_ids jsonb,parent_employee_id uuid))
      update docks d set employee_id=source.parent_employee_id,team_id=${channel.team_id}::uuid,occurred_at=source.posted_at,amount=source.amount,currency='PKR',reason=source.reason,applied_by=source.applied_by
      from slack_messages sm,source where d.slack_message_id=sm.id and sm.channel_id=${channel.id}::uuid and sm.slack_ts=source.ts`;
    await tx`with source as (select * from jsonb_to_recordset(${tx.json(payload)}) as x(ts text,employee_ids jsonb))
      delete from dock_recipients dr using docks d,slack_messages sm,source
      where dr.dock_id=d.id and d.slack_message_id=sm.id and sm.channel_id=${channel.id}::uuid and sm.slack_ts=source.ts
        and not exists(select 1 from jsonb_array_elements_text(source.employee_ids) wanted(id) where wanted.id::uuid=dr.employee_id)`;
    await tx`with source as (select * from jsonb_to_recordset(${tx.json(payload)}) as x(ts text,employee_ids jsonb)), wanted as (
        select sm.id message_id,wanted.id::uuid employee_id from source cross join lateral jsonb_array_elements_text(source.employee_ids) wanted(id)
        join slack_messages sm on sm.channel_id=${channel.id}::uuid and sm.slack_ts=source.ts)
      insert into dock_recipients(dock_id,employee_id)
      select d.id,w.employee_id from wanted w join docks d on d.slack_message_id=w.message_id on conflict do nothing`;
    for(const row of stale)await tx`delete from docks where id=${String(row.dock_id)}::uuid`;
  });
  if(apply)console.log(`Applied ${actions.length} source updates; ${materialRecipientChanges.length} changed recipient sets.`);
}finally{await db.end({timeout:5});}
