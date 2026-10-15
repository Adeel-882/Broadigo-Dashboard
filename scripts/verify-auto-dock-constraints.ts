import {createRequire} from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const {default:postgres}=await import("postgres");
const db=postgres(process.env.DATABASE_URL!,{max:1,prepare:false});
import assert from "node:assert/strict";
import {AUTO_DOCK_AMOUNTS} from "../lib/auto-docks/policy";
try{
  await db.begin(async tx=>{
    // Temporary clone only: no production financial rows are inserted/changed.
    await tx`create temporary table auto_dock_test (like automatic_docks including all) on commit drop`;
    const id="d2bf73cc-c9f6-48a8-be72-61b827e39619";
    for(let n=0;n<3;n++)await tx`insert into auto_dock_test(employee_id,business_date,rule_code,amount,reason,status,evidence) values(${id},'2026-10-16','closer_zero_sales',${AUTO_DOCK_AMOUNTS.closer_zero_sales},'test','active','{}') on conflict(employee_id,business_date,rule_code) do update set status='active'`;
    assert.equal(Number((await tx`select count(*) n from auto_dock_test`)[0].n),1);
    await tx`update auto_dock_test set status='voided',voided_at=now(),void_reason='Late sale'`;
    assert.equal(Number((await tx`select count(*) n from auto_dock_test where status='active'`)[0].n),0);
    for(const [date,rule,amount] of [["2026-10-16","appointment_setter_zero_appointments",AUTO_DOCK_AMOUNTS.appointment_setter_zero_appointments],["2026-10-15","closer_zero_sales",AUTO_DOCK_AMOUNTS.closer_zero_sales],["2026-10-17","closer_zero_sales",3000]] as const){
      let rejected=false;
      try{await tx.savepoint(async sp=>{await sp`insert into auto_dock_test(employee_id,business_date,rule_code,amount,reason,status,evidence) values(${id},${date},${rule},${amount},'test','active','{}')`;});}catch(error){rejected=(error as {code?:string}).code==="23514";}
      assert.ok(rejected,"Database must reject Dameon setter rule and preactivation dates");
    }
    const setterId="00000000-0000-4000-8000-000000000001";
    await tx`insert into auto_dock_test(employee_id,business_date,rule_code,amount,reason,status,evidence) values(${setterId},'2026-10-16','appointment_setter_zero_appointments',${AUTO_DOCK_AMOUNTS.appointment_setter_zero_appointments},'test','active','{}')`;
    let wrongSetterRejected=false;
    try{await tx.savepoint(async sp=>{await sp`update auto_dock_test set amount=1500 where employee_id=${setterId}`;});}catch(error){wrongSetterRejected=(error as {code?:string}).code==="23514";}
    assert.ok(wrongSetterRejected,"Database must reject old Setter amount");
    console.log("PASS: corrected Setter/Closer amounts, old amounts rejected, uniqueness, voiding, Dameon closer-only CHECK, preactivation CHECK. Temporary records only.");
  });
}finally{await db.end({timeout:5});}
