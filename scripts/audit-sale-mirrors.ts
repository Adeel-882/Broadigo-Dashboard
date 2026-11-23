import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const {default:postgres}=await import('postgres');
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
try {
  const sources=await db`select s.*,e.canonical_name,sm.raw_text,sm.slack_ts,sm.slack_user_id,sm.workspace_id,sm.posted_at,sm.imported_at,c.slack_channel_id,c.name channel from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=s.employee_id order by s.occurred_at,s.id`;
  const nancy=sources.filter(s=>/nancy\s+waite/i.test(s.raw_text));
  const live=[];
  for(const row of nancy){
    const params=new URLSearchParams({channel:row.slack_channel_id,oldest:row.slack_ts,latest:row.slack_ts,inclusive:'true',limit:'1'});
    const response=await fetch('https://slack.com/api/conversations.history?'+params,{headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`}});
    const body=await response.json();if(!body.ok)throw Error(body.error);
    live.push({channel:row.channel,channelId:row.slack_channel_id,messages:body.messages,limited:body.is_limited});
  }
  const norm=(s:unknown)=>String(s??'').toLowerCase().replace(/[^a-z0-9]/g,'');
  const pairs=[];
  for(let i=0;i<sources.length;i++)for(let j=i+1;j<sources.length;j++){
    const a=sources[i],b=sources[j];
    if(a.employee_id!==b.employee_id||a.slack_channel_id===b.slack_channel_id)continue;
    const identifiers={name:norm(a.customer_name)!==''&&norm(a.customer_name)===norm(b.customer_name),email:norm(a.email)!==''&&norm(a.email)===norm(b.email),phone:norm(a.phone)!==''&&norm(a.phone)===norm(b.phone)};
    if(!Object.values(identifiers).some(Boolean))continue;
    pairs.push({a:a.id,b:b.id,employee:a.canonical_name,customer:a.customer_name,customerB:b.customer_name,tsA:a.slack_ts,tsB:b.slack_ts,channelA:a.channel,channelB:b.channel,amountA:a.amount,amountB:b.amount,planA:a.package_name,planB:b.package_name,minutes:Math.abs(+new Date(b.occurred_at)-+new Date(a.occurred_at))/60000,identifiers,sameText:a.raw_text===b.raw_text});
  }
  const totals=await db`select e.canonical_name,count(*) sales,sum(s.amount) revenue from sales s join employees e on e.id=s.employee_id where s.occurred_at>='2026-11-23 00:00 America/Chicago'::timestamptz and s.occurred_at<'2026-11-24 00:00 America/Chicago'::timestamptz group by e.canonical_name`;
  await mkdir('outputs',{recursive:true});await writeFile('outputs/sale-mirror-audit.json',JSON.stringify({sources,nancy,live,pairs,totals},null,2));
  console.log(JSON.stringify({sourceCount:sources.length,nancy,live,pairs,totals},null,2));
}finally{await db.end({timeout:5});}
