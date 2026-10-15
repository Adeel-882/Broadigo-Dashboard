import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const { default: postgres } = await import("postgres");
const db = postgres(process.env.DATABASE_URL!, { max: 1, prepare: false, connect_timeout: 20 });
async function slack(method: string, params: Record<string,string> = {}) {
  const response = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, { headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` } });
  const body = await response.json();
  if (!body.ok) throw new Error(`Slack ${method}: ${body.error}`);
  return body;
}
try {
  console.log("ROLES", JSON.stringify(await db`select e.id,e.canonical_name,e.job_title,e.active,jsonb_agg(jsonb_build_object('team',t.name,'role',m.role,'start',m.start_date,'end',m.end_date)) memberships from employees e left join employee_team_memberships m on m.employee_id=e.id left join teams t on t.id=m.team_id group by e.id order by e.canonical_name`));
  console.log("CHANNELS", JSON.stringify(await db`select workspace_id,slack_channel_id,name,parser_type,active from slack_channels`));
  console.log("BASELINE", JSON.stringify(await db`select (select count(*) from docks) manual_sources,(select sum(d.amount*greatest(1,(select count(*) from dock_recipients dr where dr.dock_id=d.id))) from docks d) manual_total,(select count(*) from appointments) appointments,(select count(*) from sales) sales,(select sum(amount) from sales) revenue,(select count(*) from leads) leads,(select count(*) from employees) employees,(select count(*) from employee_team_memberships) memberships`));
  const auth=await slack("auth.test");
  let cursor=""; let general;
  do {const page=await slack("conversations.list",{types:"public_channel,private_channel",limit:"200",cursor});general=page.channels.find((c:{name:string})=>c.name==="general")??general;cursor=page.response_metadata?.next_cursor??"";}while(cursor&&!general);
  if(!general)throw new Error("general not visible to bot");
  console.log("GENERAL",JSON.stringify({id:general.id,is_member:general.is_member,created:general.created,bot_user:auth.user_id}));
  cursor=""; const messages: Array<{ts:string;user?:string;text?:string;subtype?:string;thread_ts?:string}>=[];
  do {const page=await slack("conversations.history",{channel:general.id,limit:"200",cursor});messages.push(...page.messages);cursor=page.response_metadata?.next_cursor??"";}while(cursor);
  console.log("HISTORY",JSON.stringify({count:messages.length,earliest:messages.at(-1)?.ts,latest:messages[0]?.ts,botJoins:messages.filter(m=>m.subtype==="channel_join"&&m.user===auth.user_id)}));
  const recent=messages.filter(m=>!m.subtype&&(!m.thread_ts||m.thread_ts===m.ts));
  console.log("RECENT_GENERAL",JSON.stringify(recent.slice(0,100).map(m=>({ts:m.ts,user:m.user,text:m.text?.slice(0,250)}))));
} finally { await db.end({timeout:5}); }
