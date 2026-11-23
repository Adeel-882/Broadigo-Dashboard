import {beforeAll,beforeEach,afterAll,describe,it,expect,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import postgres from 'postgres';
import {drizzle} from 'drizzle-orm/postgres-js';
const holder=vi.hoisted(()=>({db:undefined as unknown}));
vi.mock('@/lib/db/client',()=>({getDb:()=>holder.db}));
import {ingestSlackEvent,ingestSlackHistoryBatch} from './ingest';
import {reprocessStoredSlackSource} from './reprocess';
import {ingestSaleSourceDeletion} from './sale-source-events';

describe.skipIf(process.env.SALE_MIRROR_DB_TEST!=='1')('canonical sales in session-temporary PostgreSQL tables',{timeout:30000},()=>{
  let db:ReturnType<typeof postgres>,employee:string,channelA:string,channelB:string;
  const user='UMIRRORTEST',workspace='T098UDG2RED';
  const names=['sales','slack_messages','slack_channels','employees','employee_slack_identities','slack_events','appointments','leads','docks','dock_recipients','media_activity'];
  beforeAll(async()=>{
    process.loadEnvFile('.env.local');
    db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
    for(const name of names)await db.unsafe(`create temporary table ${name}(like public.${name} including all)`);
    for(const name of names)expect((await db`select relpersistence from pg_class where oid=to_regclass(${name})`)[0].relpersistence).toBe('t');
    let migration=readFileSync('drizzle/0017_canonical_sale_mirrors.sql','utf8').replaceAll('CREATE TABLE ','CREATE TEMPORARY TABLE ').replaceAll('CREATE VIEW ','CREATE TEMPORARY VIEW ').replaceAll('73171,1','73171,99');
    for(const name of ['sale_mirror_normalize','reconcile_sale_mirrors','lock_sale_mirror_writes','reconcile_sale_mirror_writes'])migration=migration.replaceAll(name+'(', 'pg_temp.'+name+'(');
    await db.unsafe(migration);
    employee=randomUUID();channelA=randomUUID();channelB=randomUUID();
    await db`insert into employees(id,canonical_name,job_title) values(${employee},'Mirror Test','Closer')`;
    await db`insert into slack_channels(id,workspace_id,slack_channel_id,name,parser_type) values(${channelA},${workspace},'C098D7NHQ69','sales-reporting','leadsedge-sale'),(${channelB},${workspace},'C0B1UH7BV9N','broadigo-sales-reporting','broadigo-sale')`;
    await db`insert into employee_slack_identities(employee_id,workspace_id,slack_user_id) values(${employee},${workspace},${user})`;
    holder.db=drizzle(db);
  },60000);
  beforeEach(async()=>{if(db)await db`truncate sale_mirror_links,sale_source_availability,sales,slack_messages,slack_events cascade`;});
  afterAll(async()=>{if(db)await db.end({timeout:5});});
  const text=(name='Customer',phone='+15551234567',email='same@example.com',amount=1600)=>`${name} <tel:${phone}|${phone}> | <mailto:${email}|${email}> | TX | Edge Executive Plan -$${amount}`;
  async function ingest(channel:string,ts:string,body=text()){
    return ingestSlackEvent({type:'event_callback',team_id:workspace,event_id:randomUUID(),event:{type:'message',user,channel,ts,text:body}});
  }
  async function totals(){const [r]=await db`select count(*)::int n,coalesce(sum(amount),0)::float revenue from canonical_sales`;return r;}
  it('cross-channel ingestion, retries, history and reprocess converge to one sale',async()=>{
    await ingest('C098D7NHQ69','1795445706.500000');await ingest('C0B1UH7BV9N','1795445707.500000');
    expect(await totals()).toMatchObject({n:1,revenue:1600});
    await ingest('C098D7NHQ69','1795445706.500000');
    await ingestSlackHistoryBatch(workspace,'C0B1UH7BV9N',[{user,ts:'1795445707.500000',text:text()}]);
    await reprocessStoredSlackSource('C098D7NHQ69','1795445706.500000');await reprocessStoredSlackSource('C0B1UH7BV9N','1795445707.500000');
    expect(await totals()).toMatchObject({n:1,revenue:1600});
    expect((await db`select count(*)::int n from sales`)[0].n).toBe(2);
    expect((await db`select count(*)::int n from slack_messages`)[0].n).toBe(2);
  },30000);
  it('repeat purchases outside the mirror window remain separate',async()=>{
    await ingest('C098D7NHQ69','1795445706.500000');await ingest('C0B1UH7BV9N','1795532106.500000');expect(await totals()).toMatchObject({n:2,revenue:3200});
  });
  it('a delayed same-day repost requires source deletion evidence; next-day repeats remain separate',async()=>{
    await ingest('C098D7NHQ69','1795445706.500000');await ingest('C0B1UH7BV9N','1795454706.500000');
    expect((await totals()).n).toBe(2);
    await ingestSaleSourceDeletion({type:'event_callback',team_id:workspace,event_id:randomUUID(),event:{type:'message',subtype:'message_deleted',channel:'C098D7NHQ69',ts:'1795454800.000000',deleted_ts:'1795445706.500000'}});
    expect(await totals()).toMatchObject({n:1,revenue:1600});
    await ingest('C098D7NHQ69','1795532106.500000');expect((await totals()).n).toBe(2);
  });
  it('same amount with different customers is not merged',async()=>{
    await ingest('C098D7NHQ69','1795445706.500000');await ingest('C0B1UH7BV9N','1795445707.500000',text('Other','+15559876543','other@example.com'));expect((await totals()).n).toBe(2);
  });
  it('same name with conflicting contact identifiers is not merged',async()=>{
    await ingest('C098D7NHQ69','1795445706.500000');await ingest('C0B1UH7BV9N','1795445707.500000',text('Customer','+15559876543','other@example.com'));expect((await totals()).n).toBe(2);
  });
  it('same-channel sales and 2-in-1 messages are preserved',async()=>{
    await ingest('C098D7NHQ69','1795445706.500000',text()+' | 2-in-1');await ingest('C0B1UH7BV9N','1795445707.500000',text()+' | 2-in-1');
    await ingest('C098D7NHQ69','1795445708.500000',text()+' | 2-in-1');expect((await totals()).n).toBe(3);
  });
  it('edits preserve confirmed identity, use primary financial fields, and select a surviving source',async()=>{
    await ingest('C098D7NHQ69','1795445706.500000');await ingest('C0B1UH7BV9N','1795445707.500000');
    await ingestSlackEvent({type:'event_callback',team_id:workspace,event_id:randomUUID(),event:{type:'message',subtype:'message_changed',channel:'C098D7NHQ69',ts:'1795445800.000000',message:{type:'message',channel:'C098D7NHQ69',user,ts:'1795445706.500000',text:text('Customer','+15551234567','same@example.com',1700)}}});
    expect(await totals()).toMatchObject({n:1,revenue:1700});
    await ingestSaleSourceDeletion({type:'event_callback',team_id:workspace,event_id:randomUUID(),event:{type:'message',subtype:'message_deleted',channel:'C098D7NHQ69',ts:'1795445900.000000',deleted_ts:'1795445706.500000'}});
    expect(await totals()).toMatchObject({n:1,revenue:1600});
    expect((await db`select sm.slack_ts from canonical_sales s join slack_messages sm on sm.id=s.slack_message_id`)[0].slack_ts).toBe('1795445707.500000');
    await ingest('C0B1UH7BV9N','1795445707.500000',text('Customer','+15551234567','same@example.com',1700));expect(await totals()).toMatchObject({n:1,revenue:1700});
  },30000);
});
