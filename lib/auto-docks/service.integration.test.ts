import {beforeAll,afterAll,describe,expect,it,vi} from "vitest";
import {readFileSync} from "node:fs";
import postgres from "postgres";
import {drizzle} from "drizzle-orm/postgres-js";
const holder=vi.hoisted(()=>({db:undefined as unknown}));
vi.mock("@/lib/db/client",()=>({getDb:()=>holder.db}));
import {evaluateBusinessDay} from "./service";

// Every writable relation/function is session-temporary; production is read-only.
describe.skipIf(process.env.AUTO_DOCK_DB_TEST!=="1")("posted-call evaluator in temporary PostgreSQL tables",()=>{
  let db:ReturnType<typeof postgres>,setter:string,closer:string,setterUser:string,closerUser:string,baseline:string;
  const dameon="d2bf73cc-c9f6-48a8-be72-61b827e39619",harvey="03cfda43-9721-41e0-b7fe-60f40538aa29",day="2026-10-17",now=new Date("2026-10-18T00:10:00Z");
  beforeAll(async()=>{
    process.loadEnvFile(".env.local");
    db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false,idle_timeout:0,max_lifetime:0});
    for(const name of ["auto_dock_settings","attendance_coverage","attendance_messages","automatic_docks","auto_dock_runs","auto_dock_evaluations","auto_dock_exemptions","auto_dock_pending","appointments","sales","slack_messages"]){
      await db.unsafe(`create temporary table ${name} (like public.${name} including all)`);
      expect((await db`select relpersistence from pg_class where oid=to_regclass(${name})`)[0].relpersistence).toBe("t");
    }
    baseline=JSON.stringify(await db`select (select md5(string_agg(to_jsonb(d)::text,'' order by id)) from public.docks d) manual,(select md5(string_agg(to_jsonb(d)::text,'' order by id)) from public.automatic_docks d) automatic`);
    await db`insert into auto_dock_settings select * from public.auto_dock_settings`;
    await db`insert into automatic_docks(employee_id,business_date,rule_code,amount,reason,status,evidence) values(${dameon},'2026-10-16','closer_zero_sales',1500,'Historical reason','active','{}')`;
    await db`insert into automatic_docks(employee_id,business_date,rule_code,amount,reason,status,evidence) select id,'2026-10-16','closer_zero_sales',1500,'Historical reason','active','{}' from public.employees where canonical_name in ('Phillip Stokes','Dean Scott')`;
    await db`create trigger auto_dock_sale_changed after insert or update or delete on pg_temp.sales for each row execute function public.queue_auto_dock_activity()`;
    const migration=readFileSync("drizzle/0011_auto_dock_posted_calls.sql","utf8").replace("ADD COLUMN calls_rule_effective_from","ADD COLUMN IF NOT EXISTS calls_rule_effective_from").replaceAll("FUNCTION guard_auto_dock_policy()","FUNCTION pg_temp.guard_auto_dock_policy()").replaceAll("FUNCTION queue_auto_dock_activity()","FUNCTION pg_temp.queue_auto_dock_activity()").replaceAll("FUNCTION queue_auto_dock_source_change()","FUNCTION pg_temp.queue_auto_dock_source_change()");
    await db.begin(async tx=>{await tx.unsafe(migration);});
    await db`update auto_dock_settings set calls_rule_effective_from=${day}`;
    await db`create trigger test_appointment after insert or update or delete on pg_temp.appointments for each row execute function pg_temp.queue_auto_dock_activity()`;
    await db`insert into attendance_coverage values(${day},'T098UDG2RED','C0980E2DWAK',now(),1)`;
    for(const name of ["Caleb Ford","Phillip Stokes"]){
      const [r]=await db`select e.id,i.slack_user_id from public.employees e join public.employee_slack_identities i on i.employee_id=e.id where canonical_name=${name} and i.workspace_id='T098UDG2RED'`;
      if(name==="Caleb Ford"){setter=String(r.id);setterUser=String(r.slack_user_id);}else{closer=String(r.id);closerUser=String(r.slack_user_id);}
    }
    holder.db=drizzle(db);
  },60000);
  afterAll(async()=>{if(db){try{if(baseline)expect(JSON.stringify(await db`select (select md5(string_agg(to_jsonb(d)::text,'' order by id)) from public.docks d) manual,(select md5(string_agg(to_jsonb(d)::text,'' order by id)) from public.automatic_docks d) automatic`)).toBe(baseline);}finally{await db.end({timeout:5});}}});
  async function call(user:string,owner:string,channel="C098WNHNBR7"){
    const [sm]=await db`insert into slack_messages(workspace_id,channel_id,slack_ts,slack_user_id,employee_id,raw_text,posted_at,parser_type,parser_status)
      select 'T098UDG2RED',id,${crypto.randomUUID()},${user},${owner},'canonical fixture','2026-10-17T21:00:00Z',parser_type,'PARSED' from public.slack_channels where slack_channel_id=${channel} returning id`;
    await db`insert into appointments(slack_message_id,employee_id,occurred_at,scheduled_at,confidence,assigned_person) values(${sm.id},${owner},'2026-10-17T21:00:00Z','2026-10-22T10:00:00Z',1,${closerUser})`;
    return String(sm.id);
  }
  it("preserves history, counts authors only, ignores sales and reconciles calls idempotently",async()=>{
    expect((await evaluateBusinessDay("2026-10-16",true,now)).historicalPreserved).toBe(true);
    let r=await evaluateBusinessDay(day,true,now);
    expect(r.evaluations.find(e=>e.employeeId===setter)?.decision).toBe("SKIP_ABSENT");
    expect(r.evaluations.find(e=>e.employeeId===closer)?.decision).toBe("SKIP_ABSENT");
    expect(r.evaluations.find(e=>e.employeeId===dameon)).toMatchObject({decision:"SKIP_EXCLUDED",ruleCode:null,amount:0});
    expect(r.evaluations.find(e=>e.employeeId===harvey)).toMatchObject({role:"SETTER",amount:3000,attendanceRequired:false});
    for(const id of [setter,closer])await db`insert into attendance_messages(workspace_id,channel_id,slack_ts,slack_user_id,employee_id,source_at,raw_text,is_check_in) values('T098UDG2RED','C0980E2DWAK',${id},'fixture',${id},'2026-10-17T14:00:00Z','check in',true)`;
    r=await evaluateBusinessDay(day,true,now);expect(r.evaluations.find(e=>e.employeeId===closer)).toMatchObject({ruleCode:"closer_zero_calls",amount:1500});
    expect(r.evaluations.find(e=>e.employeeId===setter)?.amount).toBe(3000);
    await evaluateBusinessDay(day,true,now);
    expect(Number((await db`select count(*) n from automatic_docks where business_date=${day} and employee_id=${closer}`)[0].n)).toBe(1);
    // Deliberately incorrect structured ownership demonstrates parent author wins.
    await call(setterUser,closer);
    r=await evaluateBusinessDay(day,true,now);
    expect(r.evaluations.find(e=>e.employeeId===setter)).toMatchObject({appointments:1,amount:0});
    expect(r.evaluations.find(e=>e.employeeId===closer)).toMatchObject({appointments:0,amount:1500});
    await db`delete from auto_dock_pending`;
    const [sm]=await db`insert into slack_messages(workspace_id,channel_id,slack_ts,slack_user_id,employee_id,raw_text,posted_at,parser_type,parser_status) select 'T098UDG2RED',id,'sale',${closerUser},${closer},'fixture','2026-10-17T15:00:00Z',parser_type,'PARSED' from public.slack_channels where name='sales-reporting' returning id`;
    await db`insert into sales(slack_message_id,employee_id,occurred_at,confidence,amount) values(${sm.id},${closer},'2026-10-17T15:00:00Z',1,10000)`;
    await db`update sales set amount=20000`;await db`delete from sales`;
    expect(Number((await db`select count(*) n from auto_dock_pending`)[0].n)).toBe(0);
    r=await evaluateBusinessDay(day,true,now);expect(r.evaluations.find(e=>e.employeeId===closer)?.amount).toBe(1500);
    const id=await call(closerUser,closer,"C0B0P6P7FPG");
    expect(Number((await db`select count(*) n from auto_dock_pending`)[0].n)).toBe(1);
    r=await evaluateBusinessDay(day,true,now);expect(r.evaluations.find(e=>e.employeeId===closer)).toMatchObject({appointments:1,amount:0});
    expect((await db`select status from automatic_docks where employee_id=${closer} and business_date=${day}`)[0].status).toBe("voided");
    await db`delete from auto_dock_pending`;
    await db`update slack_messages set parser_status='UNPARSED' where id=${id}`;
    expect(Number((await db`select count(*) n from auto_dock_pending`)[0].n)).toBe(1);
    r=await evaluateBusinessDay(day,true,now);expect(r.evaluations.find(e=>e.employeeId===closer)?.amount).toBe(1500);
    await db`update slack_messages set parser_status='PARSED' where id=${id}`;
    r=await evaluateBusinessDay(day,true,now);expect(r.evaluations.find(e=>e.employeeId===closer)?.amount).toBe(0);
    await db`update slack_messages set source_unavailable_at=now() where id=${id}`;
    r=await evaluateBusinessDay(day,true,now);expect(r.evaluations.find(e=>e.employeeId===closer)?.amount).toBe(1500);
    expect(Number((await db`select count(*) n from appointments where slack_message_id=${id}`)[0].n)).toBe(1);
    await db`delete from appointments where slack_message_id=${id}`;
    r=await evaluateBusinessDay(day,true,now);expect(r.evaluations.find(e=>e.employeeId===closer)?.amount).toBe(1500);
    expect(Number((await db`select count(*) n from automatic_docks where employee_id=${closer} and business_date=${day}`)[0].n)).toBe(1);
    expect((await db`select reason,rule_code,status from automatic_docks where employee_id=${dameon}`)[0]).toMatchObject({reason:"Historical reason",rule_code:"closer_zero_sales",status:"active"});
    await expect(db`update automatic_docks set status='voided' where employee_id=${dameon}`).rejects.toThrow(/preserved/);
    for(const rule of ["closer_zero_sales","closer_zero_calls","appointment_setter_zero_appointments"])await expect(db`insert into automatic_docks(employee_id,business_date,rule_code,amount,reason,status,evidence) values(${dameon},${day},${rule},1500,'test','active','{}')`).rejects.toThrow();
  },120000);
  it("reconciles authorized October 16 legacy rows and preserves immutable history",async()=>{
    const original=await db`select id,to_jsonb(d)-array['status','voided_at','void_reason','updated_at'] evidence from automatic_docks d where business_date='2026-10-16'`;
    const migration=readFileSync('drizzle/0012_authorized_oct16_call_policy.sql','utf8').replaceAll('FUNCTION guard_auto_dock_policy()','FUNCTION pg_temp.guard_auto_dock_policy()');
    await db.begin(async tx=>{await tx.unsafe(migration);});
    await db`insert into attendance_coverage values('2026-10-16','T098UDG2RED','C0980E2DWAK',now(),1)`;
    const [dean]=await db`select e.id,i.slack_user_id from public.employees e join public.employee_slack_identities i on i.employee_id=e.id where canonical_name='Dean Scott' and i.workspace_id='T098UDG2RED'`;
    for(const id of [closer,dean.id])await db`insert into attendance_messages(workspace_id,channel_id,slack_ts,slack_user_id,employee_id,source_at,raw_text,is_check_in) values('T098UDG2RED','C0980E2DWAK',${crypto.randomUUID()},'fixture',${id},'2026-10-16T14:00:00Z','check in',true)`;
    const source=await call(String(dean.slack_user_id),closer);
    await db`update slack_messages set posted_at='2026-10-16T21:00:00Z' where id=${source}`;
    const first=await evaluateBusinessDay('2026-10-16',true,now);
    expect(first.voided).toBe(3);
    expect(first.evaluations.find(e=>e.employeeId===String(dean.id))).toMatchObject({appointments:1,amount:0});
    expect(first.evaluations.find(e=>e.employeeId===closer)).toMatchObject({appointments:0,amount:1500,ruleCode:'closer_zero_calls'});
    expect(first.evaluations.find(e=>e.employeeId===dameon)?.decision).toBe('SKIP_EXCLUDED');
    for(const old of original){
      const [row]=await db`select status,void_reason,to_jsonb(d)-array['status','voided_at','void_reason','updated_at'] evidence from automatic_docks d where id=${old.id}`;
      expect(row.status).toBe('voided');expect(row.evidence).toEqual(old.evidence);expect(row.void_reason).toContain('Management rule change');
    }
    const fingerprint=JSON.stringify(await db`select * from automatic_docks where business_date='2026-10-16' order by id`);
    const second=await evaluateBusinessDay('2026-10-16',true,now);
    expect(second.created).toBe(0);expect(second.voided).toBe(0);
    expect(JSON.stringify(await db`select * from automatic_docks where business_date='2026-10-16' order by id`)).toBe(fingerprint);
    await expect(db`update automatic_docks set amount=3000 where employee_id=${dameon}`).rejects.toThrow();
    await expect(db`delete from automatic_docks where employee_id=${dameon}`).rejects.toThrow();
  },60000);
  it("refuses preactivation and incomplete dates",async()=>{
    await expect(evaluateBusinessDay("2026-10-15",true,now)).rejects.toThrow(/approved/);
    await expect(evaluateBusinessDay("2026-10-18",true,now)).rejects.toThrow(/incomplete/);
  });
});
