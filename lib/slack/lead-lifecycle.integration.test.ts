import {beforeAll,afterAll,describe,it,expect,vi} from 'vitest';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
const holder=vi.hoisted(()=>({db:undefined as unknown}));
vi.mock('@/lib/db/client',()=>({getDb:()=>holder.db}));
import {ingestSlackEvent,ingestSlackHistoryBatch} from './ingest';
import {ingestSlackReactionEvent} from './reaction-events';
import {ingestLeadDeletion} from './lead-source-events';
import {reprocessStoredSlackSource} from './reprocess';

describe.skipIf(process.env.LEAD_DB_TEST!=='1')('lead lifecycle in isolated temporary PostgreSQL tables',()=>{
  let client:ReturnType<typeof postgres>;
  const workspace='T098UDG2RED',channel='C098C93DGTY',ts='1790958602.271949';
  const text='Lead Source: Regent\nLead Type: Seller\nName: Test Prospect\nNumber: 5551234567\nState: GA\nArea: Atlanta\nProperty Type: Condo\nTimeline: 3 months\nCall Appointment: Monday at 10 AM';
  const parent={type:'message' as const,channel,user:'U09SWT3TV1A',ts,text};
  beforeAll(async()=>{
    process.loadEnvFile('.env.local');client=postgres(process.env.DATABASE_URL!,{max:1,prepare:false,idle_timeout:0,max_lifetime:0});
    for(const name of ['leads','slack_messages','slack_events','lead_reconciliation_audit','appointments','sales','docks','dock_recipients','media_activity']){
      await client.unsafe(`create temporary table ${name} (like public.${name} including all)`);
      expect((await client`select relpersistence from pg_class where oid=to_regclass(${name})`)[0].relpersistence).toBe('t');
    }
    holder.db=drizzle(client);
  },30000);
  afterAll(async()=>{if(client)await client.end({timeout:5});});
  it('preserves parent source/owner across ingestion, late reaction, history, edit, reprocess and deletion',async()=>{
    expect(await ingestSlackEvent({type:'event_callback',event_id:'test-parent',team_id:workspace,event:parent})).toMatchObject({status:'parsed',recordType:'LEAD'});
    const [original]=await client`select id,employee_id,occurred_at,slack_message_id from leads`;
    const reaction={type:'event_callback' as const,event_id:'test-reaction',team_id:workspace,event:{type:'reaction_added' as const,user:'OTHER_EMPLOYEE',reaction:'x',item:{type:'message',channel,ts},event_ts:'1791843228.130579'}};
    await ingestSlackReactionEvent(reaction);
    expect((await client`select counts_toward_kpi from leads`)[0].counts_toward_kpi).toBe(false);
    expect(await ingestSlackEvent({type:'event_callback',event_id:'test-reply',team_id:workspace,event:{...parent,user:'OTHER_EMPLOYEE',ts:'1791843228.130579',thread_ts:ts,text:'Lead Assigned to Prospect <@CLOSER>'}})).toMatchObject({status:'ignored'});
    await ingestSlackHistoryBatch(workspace,channel,[{...parent,reactions:[{name:'x',count:1,users:['OTHER_EMPLOYEE']}]}]);
    await ingestSlackEvent({type:'event_callback',event_id:'test-edit',team_id:workspace,event:{type:'message',channel,ts:'1791843229.000001',subtype:'message_changed',message:{...parent,text:text+'\nNote: Updated detail'}}});
    await reprocessStoredSlackSource(channel,ts);
    expect(await client`select id,employee_id,occurred_at,slack_message_id from leads`).toEqual([original]);
    const deleted={type:'event_callback' as const,event_id:'test-delete',team_id:workspace,event:{type:'message' as const,channel,ts:'1791843230.000001',subtype:'message_deleted',deleted_ts:ts}};
    await ingestLeadDeletion(deleted);await ingestLeadDeletion(deleted);
    await ingestSlackReactionEvent({...reaction,event_id:'test-remove',event:{...reaction.event,type:'reaction_removed'}});
    await reprocessStoredSlackSource(channel,ts);
    await ingestSlackHistoryBatch(workspace,channel,[parent]);
    expect(await client`select id,employee_id,occurred_at,slack_message_id from leads`).toEqual([original]);
    expect((await client`select counts_toward_kpi,exclusion_reasons from leads`)[0]).toMatchObject({counts_toward_kpi:false,exclusion_reasons:['SOURCE_UNAVAILABLE']});
    expect(Number((await client`select count(*) n from lead_reconciliation_audit`)[0].n)).toBe(1);
    expect(Number((await client`select count(*) n from sales`)[0].n)).toBe(0);
    expect(Number((await client`select count(*) n from appointments`)[0].n)).toBe(0);
  },60000);
});
