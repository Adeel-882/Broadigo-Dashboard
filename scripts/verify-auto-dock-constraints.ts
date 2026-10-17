import {createRequire} from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const {default:postgres}=await import("postgres");
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
import assert from "node:assert/strict";
try{
  await db.begin(async tx=>{
    await tx`create temporary table auto_dock_test (like automatic_docks including all) on commit drop`;
    const date=String((await tx`select calls_rule_effective_from::text d from auto_dock_settings where id=1`)[0].d);
    await tx`create trigger test_guard before insert or update or delete on auto_dock_test for each row execute function public.guard_auto_dock_policy()`;
    const normal="00000000-0000-4000-8000-000000000001",harvey="03cfda43-9721-41e0-b7fe-60f40538aa29",dameon="d2bf73cc-c9f6-48a8-be72-61b827e39619";
    for(let n=0;n<3;n++)await tx`insert into auto_dock_test(employee_id,business_date,rule_code,amount,reason,status,evidence) values(${normal},${date},'closer_zero_calls',1500,'test','active','{}') on conflict(employee_id,business_date,rule_code) do update set status='active'`;
    assert.equal(Number((await tx`select count(*) n from auto_dock_test`)[0].n),1);
    await tx`update auto_dock_test set status='voided',void_reason='Late call'`;
    await tx`insert into auto_dock_test(employee_id,business_date,rule_code,amount,reason,status,evidence) values(${harvey},${date},'appointment_setter_zero_appointments',3000,'test','active','{}')`;
    for(const [id,rule,amount] of [[dameon,"closer_zero_sales",1500],[dameon,"closer_zero_calls",1500],[dameon,"appointment_setter_zero_appointments",3000],[harvey,"closer_zero_calls",1500],[normal,"closer_zero_sales",1500],[normal,"closer_zero_calls",3000],[normal,"appointment_setter_zero_appointments",1500]] as const){
      let rejected=false;
      try{await tx.savepoint(async sp=>{await sp`insert into auto_dock_test(employee_id,business_date,rule_code,amount,reason,status,evidence) values(${id},${date},${rule},${amount},'test','active','{}')`;});}catch{rejected=true;}
      assert.ok(rejected,"Forbidden role/rule/amount must be rejected");
    }
    console.log("PASS: prospective call rule, uniqueness, late-call voiding, amounts, Harvey Setter-only and all Dameon rules blocked. Temporary rows only.");
  });
}finally{await db.end({timeout:5});}
