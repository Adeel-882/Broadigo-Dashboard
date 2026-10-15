import {AUTO_DOCK_AMOUNTS} from "./policy";
import {beforeAll,afterAll,describe,expect,it,vi} from "vitest";
import postgres from "postgres";
import {drizzle} from "drizzle-orm/postgres-js";
const holder=vi.hoisted(()=>({db:undefined as unknown}));
vi.mock("@/lib/db/client",()=>({getDb:()=>holder.db}));
import {evaluateBusinessDay} from "./service";

// Opt in explicitly. All writable tables are session-temporary clones, which
// shadow public names. Production employees/channels are read-only inputs.
describe.skipIf(process.env.AUTO_DOCK_DB_TEST!=="1")("real PostgreSQL evaluator in temporary tables",()=>{
  let client:ReturnType<typeof postgres>;
  let setter:string;
  const dameon="d2bf73cc-c9f6-48a8-be72-61b827e39619";
  const harvey="03cfda43-9721-41e0-b7fe-60f40538aa29";
  const now=new Date("2026-10-17T00:01:00Z");
  let baseline:string;
  beforeAll(async()=>{
    process.loadEnvFile(".env.local");
    if(!process.env.DATABASE_URL)throw new Error("Database test requires DATABASE_URL");
    client=postgres(process.env.DATABASE_URL!,{max:1,prepare:false,idle_timeout:0,max_lifetime:0});
    // Constant identifiers, never user input. Temporary tables disappear on close.
    for(const name of ["auto_dock_settings","attendance_coverage","attendance_messages","automatic_docks","auto_dock_runs","auto_dock_evaluations","auto_dock_exemptions","auto_dock_pending","appointments","sales","slack_messages"]){
      await client.unsafe(`create temporary table ${name} (like public.${name} including all)`);
      const [relation]=await client`select c.relpersistence from pg_class c where c.oid=to_regclass(${name})`;
      expect(relation.relpersistence).toBe("t");
    }
    await client`create trigger test_auto_appointment after insert or update or delete on pg_temp.appointments for each row execute function public.queue_auto_dock_activity()`;
    await client`create trigger test_auto_sale after insert or update or delete on pg_temp.sales for each row execute function public.queue_auto_dock_activity()`;
    holder.db=drizzle(client);
    baseline=JSON.stringify(await client`select (select count(*) from public.automatic_docks) auto,(select count(*) from public.docks) manual,(select sum(amount) from public.docks) amount,(select count(*) from public.appointments) appointments,(select count(*) from public.sales) sales`);
    await client`insert into auto_dock_settings select * from public.auto_dock_settings`;
    await client`update auto_dock_settings set enabled=true,effective_from='2026-10-16',attendance_reliable_from='2026-10-16'`;
    await client`insert into attendance_coverage values('2026-10-16','T098UDG2RED','C0980E2DWAK',now(),1)`;
    setter=String((await client`select id from public.employees where canonical_name='Caleb Ford'`)[0].id);
  },30000);
  afterAll(async()=>{if(client){
    try{if(baseline)expect(JSON.stringify(await client`select (select count(*) from public.automatic_docks) auto,(select count(*) from public.docks) manual,(select sum(amount) from public.docks) amount,(select count(*) from public.appointments) appointments,(select count(*) from public.sales) sales`)).toBe(baseline);}
    finally{await client.end({timeout:5});}
  }});
  it("late check-in, repeated evaluation, late appointment and $0 sale reconcile without touching manual docks",async()=>{
    let result=await evaluateBusinessDay("2026-10-16",true,now);
    expect(result.evaluations.find(e=>e.employeeId===setter)?.decision).toBe("SKIP_ABSENT");
    expect(result.evaluations.find(e=>e.employeeId===dameon)?.amount).toBe(AUTO_DOCK_AMOUNTS.closer_zero_sales);
    expect(result.evaluations.find(e=>e.employeeId===harvey)).toMatchObject({role:"SETTER",ruleCode:"appointment_setter_zero_appointments",attendanceRequired:false,checkInFound:false,amount:3000});
    expect((await client`select rule_code,amount from automatic_docks where employee_id=${harvey}`).map(r=>({rule:r.rule_code,amount:Number(r.amount)}))).toEqual([{rule:"appointment_setter_zero_appointments",amount:3000}]);
    await client`insert into attendance_messages(workspace_id,channel_id,slack_ts,slack_user_id,employee_id,source_at,raw_text,is_check_in) values('T098UDG2RED','C0980E2DWAK','1792159200.000001','U_TEST',${setter},'2026-10-16T14:00:00Z','check in',true)`;
    result=await evaluateBusinessDay("2026-10-16",true,now);
    expect(result.evaluations.find(e=>e.employeeId===setter)?.amount).toBe(AUTO_DOCK_AMOUNTS.appointment_setter_zero_appointments);
    await evaluateBusinessDay("2026-10-16",true,now);
    expect(Number((await client`select count(*) n from automatic_docks where employee_id=${setter}`)[0].n)).toBe(1);
    for(const [channel,employee,kind] of [["sales-development-general",setter,"appointment"],["sales-reporting",dameon,"sale"]]){
      const [source]=await client`insert into slack_messages(workspace_id,channel_id,slack_ts,employee_id,raw_text,posted_at,parser_type,parser_status)
        select 'T098UDG2RED',id,${kind},${employee},'temporary test source','2026-10-16T15:00:00Z',parser_type,'PARSED' from public.slack_channels where name=${channel} returning id`;
      if(kind==="appointment")await client`insert into appointments(slack_message_id,employee_id,occurred_at,confidence,assigned_person) values(${source.id},${employee},'2026-10-16T15:00:00Z',1,'Dameon Wolfe')`;
      else await client`insert into sales(slack_message_id,employee_id,occurred_at,confidence,amount) values(${source.id},${employee},'2026-10-16T15:00:00Z',1,0)`;
    }
    result=await evaluateBusinessDay("2026-10-16",true,now);
    expect(Number((await client`select count(*) n from pg_temp.auto_dock_pending where business_date='2026-10-16'`)[0].n)).toBe(1);
    expect(result.evaluations.find(e=>e.employeeId===setter)?.appointments).toBe(1);
    expect(result.evaluations.find(e=>e.employeeId===dameon)?.appointments).toBe(0);
    expect(result.evaluations.find(e=>e.employeeId===dameon)?.sales).toBe(1);
    expect(result.voided).toBe(2);
    expect(Number((await client`select count(*) n from automatic_docks where employee_id in (${setter},${dameon}) and status='active'`)[0].n)).toBe(0);
    expect(Number((await client`select count(*) n from auto_dock_evaluations`)[0].n)).toBeGreaterThan(0);
  },60000);
  it("refuses preactivation and unfinished days even when explicitly requested",async()=>{
    await expect(evaluateBusinessDay("2026-10-15",true,now)).rejects.toThrow(/disabled|approved/);
    await expect(evaluateBusinessDay("2026-10-17",true,now)).rejects.toThrow(/incomplete/);
  });
});
