/** Audits every stored cross-channel contact match; --apply links only evidenced mirrors. */
import {createRequire} from 'node:module';
import {mkdir,writeFile} from 'node:fs/promises';
createRequire(import.meta.url)('@next/env').loadEnvConfig(process.cwd());
const {default:postgres}=await import('postgres');
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
const apply=process.argv.includes('--apply');
const normalize=(s:unknown)=>String(s??'').trim().replace(/\s+/g,' ').toLowerCase();
const phone=(s:unknown)=>String(s??'').replace(/\D/g,'');
const date=(s:Date)=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Chicago'}).format(s);
const slack=async(method:string,params:Record<string,string>)=>{
  const response=await fetch('https://slack.com/api/'+method+'?'+new URLSearchParams(params),{headers:{Authorization:`Bearer ${process.env.SLACK_BOT_TOKEN}`},signal:AbortSignal.timeout(30000)});
  if(!response.ok)throw Error(`Slack request failed: ${response.status}`);
  return response.json();
};
try{
  const sources=await db`select s.*,e.canonical_name,sm.raw_text,sm.slack_ts,sm.slack_user_id,sm.workspace_id,c.slack_channel_id,c.name channel from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=s.employee_id order by s.occurred_at,sm.slack_ts,s.id`;
  type Observation={id:string;unavailable:boolean;live:boolean;evidence:Record<string,unknown>};
  const observations=new Map<string,Observation>();
  async function observe(s:typeof sources[number]){
    if(observations.has(s.id))return observations.get(s.id)!;
    const history=await slack('conversations.history',{channel:s.slack_channel_id,oldest:s.slack_ts,latest:s.slack_ts,inclusive:'true',limit:'1'});
    if(!history.ok)throw Error(`Slack history: ${history.error}`);
    const message=history.messages?.find((m:{ts:string})=>m.ts===s.slack_ts);
    const link=await slack('chat.getPermalink',{channel:s.slack_channel_id,message_ts:s.slack_ts});
    if(!link.ok&&link.error!=='message_not_found')throw Error(`Slack permalink: ${link.error}`);
    const tombstone=message?.user==='USLACKBOT'&&message?.text==='This message was deleted.';
    const unavailable=tombstone||(!message&&link.error==='message_not_found');
    const live=Boolean(message&&message.user===s.slack_user_id&&message.text===s.raw_text&&(!message.thread_ts||message.thread_ts===message.ts)&&!message.subtype);
    const observation={id:String(s.id),unavailable,live,evidence:{checkedAt:new Date().toISOString(),channel:s.slack_channel_id,ts:s.slack_ts,tombstone,permalink:link.permalink??null,permalinkError:link.error??null,historyLimited:history.is_limited??false,liveTextMatches:live}};
    observations.set(s.id,observation);return observation;
  }
  type Candidate={anchor:string;secondary:string;employee:string;employeeB:string;customer:string;amount:string;channels:string[];timestamps:string[];seconds:number;emailMatch:boolean;phoneMatch:boolean;nameMatch:boolean;classification:string;reason:string};
  const candidates:Candidate[]=[];
  for(let i=0;i<sources.length;i++)for(let j=i+1;j<sources.length;j++){
    const a=sources[i],b=sources[j];
    if(a.slack_channel_id===b.slack_channel_id||![a.slack_channel_id,b.slack_channel_id].every(c=>['C098D7NHQ69','C0B1UH7BV9N'].includes(c)))continue;
    const emailMatch=normalize(a.email)!==''&&normalize(a.email)===normalize(b.email);
    const phoneMatch=phone(a.phone).length>=10&&phone(a.phone)===phone(b.phone);
    const nameMatch=normalize(a.customer_name)!==''&&normalize(a.customer_name)===normalize(b.customer_name);
    if(!emailMatch&&!phoneMatch&&!nameMatch)continue;
    const oa=await observe(a),ob=await observe(b),seconds=(+b.occurred_at-+a.occurred_at)/1000;
    const strong=a.employee_id&&a.employee_id===b.employee_id&&a.workspace_id===b.workspace_id&&nameMatch&&(emailMatch||phoneMatch)
      &&(!a.email||!b.email||emailMatch)&&(!a.phone||!b.phone||phone(a.phone)===phone(b.phone))
      &&a.amount!==null&&a.amount===b.amount&&a.currency===b.currency&&normalize(a.package_name)!==''&&normalize(a.package_name)===normalize(b.package_name)
      &&normalize(a.raw_text.replace(/[*`_]/g,''))===normalize(b.raw_text.replace(/[*`_]/g,''))
      &&date(a.occurred_at)===date(b.occurred_at)&&!/(2[ -]*in[ -]*1|two[ -]*in[ -]*one|multiple sales|two sales)/i.test(a.raw_text+b.raw_text);
    const confirmed=Boolean(strong&&(seconds<=60||(oa.unavailable&&ob.live)||(ob.unavailable&&oa.live)));
    candidates.push({anchor:a.id,secondary:b.id,employee:a.canonical_name,employeeB:b.canonical_name,customer:a.customer_name,amount:a.amount,channels:[a.channel,b.channel],timestamps:[a.slack_ts,b.slack_ts],seconds,emailMatch,phoneMatch,nameMatch,classification:confirmed?'CONFIRMED_MIRROR_DUPLICATE':'UNCERTAIN',reason:confirmed?(seconds<=60?'Exact cross-channel mirror within 60 seconds':'Exact same-day repost with deleted original and verified surviving source'):'Insufficient evidence; no automatic reconciliation'});
  }
  // Ambiguous groups with >2 sources must be reviewed, even when individual pairs match.
  for(const pair of candidates)if(candidates.some(other=>other!==pair&&[other.anchor,other.secondary].some(id=>id===pair.anchor||id===pair.secondary))){pair.classification='UNCERTAIN';pair.reason='Multiple candidate sources; manual review required';}
  await mkdir('outputs',{recursive:true});
  const prefix=`outputs/sale-mirror-reconciliation-${Date.now()}`;
  await writeFile(prefix+'-audit.json',JSON.stringify({candidates,observations:[...observations.values()]},null,2));
  const report=await db.begin(async tx=>{
    await tx`select pg_advisory_xact_lock(73171,1)`;
    const fingerprint=async()=>{
      const result:Record<string,unknown>={};
      for(const table of ['sales','slack_messages','appointments','leads','docks','dock_recipients','automatic_docks','employees','employee_team_memberships','employee_slack_identities','targets'])result[table]=await tx.unsafe(`select count(*) n,md5(string_agg(to_jsonb(t)::text,'' order by id)) hash from ${table} t`);
      return result;
    };
    const totals=()=>tx`select 'source' scope,count(*)::int sales,sum(amount) revenue from sales union all select 'canonical',count(*)::int,sum(amount) from canonical_sales`;
    const before=await fingerprint(),beforeTotals=await totals();
    if(apply){
      for(const pair of candidates.filter(c=>c.classification==='CONFIRMED_MIRROR_DUPLICATE')){
        for(const id of [pair.anchor,pair.secondary]){
          const [current]=await tx`select s.*,sm.raw_text,sm.slack_user_id from sales s join slack_messages sm on sm.id=s.slack_message_id where s.id=${id} for share of s,sm`;
          const audited=sources.find(s=>s.id===id)!;
          if(!current||['employee_id','amount','customer_name','email','phone','package_name','raw_text','slack_user_id'].some(k=>current[k]!==audited[k]))throw Error('Source changed since audit; rerun without writes');
          const observation=observations.get(id)!;
          if(observation.unavailable)await tx`insert into sale_source_availability(sale_id,unavailable_at,evidence) values(${id},now(),${JSON.stringify(observation.evidence)}::jsonb) on conflict(sale_id) do nothing`;
        }
      }
      await tx`select reconcile_sale_mirrors()`;
      const replay=await tx`select reconcile_sale_mirrors() added`;
      if(replay[0].added!==0)throw Error('Reconciliation is not idempotent');
    }
    const after=await fingerprint();
    if(JSON.stringify(before)!==JSON.stringify(after))throw Error('Protected source/financial records changed; transaction rolled back');
    const links=await tx`select l.*,e.canonical_name,s.customer_name,s.amount from sale_mirror_links l join sales s on s.id=l.sale_id join employees e on e.id=s.employee_id`;
    const daily=await tx`select e.canonical_name,count(*)::int sales,sum(s.amount) revenue from canonical_sales s join employees e on e.id=s.employee_id where s.occurred_at>='2026-11-23 00:00 America/Chicago'::timestamptz and s.occurred_at<'2026-11-24 00:00 America/Chicago'::timestamptz group by e.canonical_name`;
    return {apply,candidates,observations:[...observations.values()],beforeTotals,afterTotals:await totals(),links,daily,protectedUnchanged:true,protectedBefore:before,protectedAfter:after};
  });
  await writeFile(prefix+'-result.json',JSON.stringify(report,null,2));
  console.log(JSON.stringify({...report,protectedBefore:undefined,protectedAfter:undefined},null,2));
}finally{await db.end({timeout:5});}
