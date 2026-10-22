import {AUTO_DOCK_AMOUNTS} from "./policy";
import { describe,expect,it } from "vitest";
import { AUTO_DOCK_EMPLOYEE_OVERRIDES, businessWindow,evaluateAutoDockState,isCheckIn,latestClosedBusinessDate,OBSERVED_CHECK_IN_PHRASES,type EvaluationInput } from "./policy";
import { autoDockBusinessDateFor as operationalDateFor } from "./time";

const base:EvaluationInput={employeeId:"normal",title:"Appointment Setter",active:true,membershipEligible:true,checkInFound:true,attendanceReliable:true,exempt:false,appointments:0,sales:0};
describe("attendance-gated automatic docks",()=>{
  it("locks the corrected business amounts independently of shared config",()=>{
    expect(AUTO_DOCK_AMOUNTS).toEqual({appointment_setter_zero_appointments:3000,closer_zero_sales:1500,closer_zero_calls:1500});
  });
  it("keeps manual and automatic records separate when totaling",()=>{
    const manual={source:"manual",amount:2000};
    for(const [title,total] of [["Appointment Setter",5000],["Closer",3500]] as const){
      const records=[manual,{source:"automatic_inactivity",amount:evaluateAutoDockState({...base,title}).amount}];
      expect(records).toHaveLength(2);expect(records.reduce((sum,r)=>sum+r.amount,0)).toBe(total);expect(manual.amount).toBe(2000);
    }
  });
  it.each([true,false])("setter matrix present=%s",present=>{
    for(const appointments of [0,1,4]){const state=evaluateAutoDockState({...base,checkInFound:present,appointments});expect(state.amount).toBe(present&&appointments===0?AUTO_DOCK_AMOUNTS.appointment_setter_zero_appointments:0);if(!present)expect(state.decision).toBe("SKIP_ABSENT");}
  });
  it.each([true,false])("closer matrix present=%s",present=>{
    for(const appointments of [0,1])for(const sales of [0,1,10]){const state=evaluateAutoDockState({...base,title:"Closer",checkInFound:present,sales,appointments});expect(state.amount).toBe(present&&appointments===0?AUTO_DOCK_AMOUNTS.closer_zero_calls:0);if(!present)expect(state.decision).toBe("SKIP_ABSENT");}
  });
  it.each([true,false])("Harvey is setter-only, ignores sales and bypasses attendance: check-in=%s",checkInFound=>{
    for(const title of ["Hybrid Media","Closer","Appointment Setter"])for(const appointments of [0,1,5])for(const sales of [0,1,10]){
      const result=evaluateAutoDockState({...base,employeeId:"03cfda43-9721-41e0-b7fe-60f40538aa29",title,checkInFound,appointments,sales});
      expect(result.role).toBe("SETTER");expect(result.ruleCode).toBe("appointment_setter_zero_appointments");
      expect(result.amount).toBe(appointments===0?3000:0);expect(result.attendanceRequired).toBe(false);
      expect(result.attendanceStatus).toBe("BYPASSED");expect(result.decision).toBe(appointments===0?"DOCK":"ACTIVITY_RECORDED");
    }
  });
  it("Dameon never receives any rule, regardless of role, calls, sales or attendance",()=>{
    const employeeId="d2bf73cc-c9f6-48a8-be72-61b827e39619";
    for(const title of ["Closer","Appointment Setter","Hybrid Media"])for(const checkInFound of [false,true])for(const sales of [0,1,10])for(const appointments of [0,5]){
      const result=evaluateAutoDockState({...base,employeeId,title,checkInFound,sales,appointments});
      expect(result.ruleCode).toBeNull();expect(result.amount).toBe(0);expect(result.decision).toBe("SKIP_EXCLUDED");expect(result.attendanceStatus).toBe("EXCLUDED");
    }
  });
  it("skips leave, inactive membership, inactive employee and unverified history including exceptions",()=>{
    for(const employeeId of ["normal",...Object.keys(AUTO_DOCK_EMPLOYEE_OVERRIDES)])for(const override of [{exempt:true},{active:false},{membershipEligible:false},{attendanceReliable:false}])expect(evaluateAutoDockState({...base,employeeId,...override}).amount).toBe(0);
  });
  it("late check-in creates expected state; late owned activity removes it",()=>{
    expect(evaluateAutoDockState({...base,checkInFound:false}).amount).toBe(0);
    expect(evaluateAutoDockState(base).amount).toBe(AUTO_DOCK_AMOUNTS.appointment_setter_zero_appointments);
    expect(evaluateAutoDockState({...base,appointments:1}).amount).toBe(0);
    expect(evaluateAutoDockState({...base,title:"Closer"}).amount).toBe(AUTO_DOCK_AMOUNTS.closer_zero_calls);
    expect(evaluateAutoDockState({...base,title:"Closer",appointments:1}).amount).toBe(0);
  });
  it("is deterministic across retries and ignores unrelated activity",()=>{
    expect(evaluateAutoDockState({...base,sales:5})).toEqual(evaluateAutoDockState({...base,sales:5}));
    expect(evaluateAutoDockState({...base,title:"Closer",appointments:5}).amount).toBe(0);
    expect(evaluateAutoDockState({...base,sales:5}).amount).toBe(AUTO_DOCK_AMOUNTS.appointment_setter_zero_appointments);
  });
});
describe("attendance evidence",()=>{
  it.each(OBSERVED_CHECK_IN_PHRASES)("recognizes observed phrase %s",phrase=>expect(isCheckIn(phrase,OBSERVED_CHECK_IN_PHRASES)).toBe(true));
  it.each(["off","break","break off","present","office","did you check in?","please check in","not checked in",""])("does not infer attendance from %s",phrase=>expect(isCheckIn(phrase,OBSERVED_CHECK_IN_PHRASES)).toBe(false));
  it("normalizes only harmless formatting",()=>expect(isCheckIn(" *CHECK  IN* ",OBSERVED_CHECK_IN_PHRASES)).toBe(true));
});
describe("nine-hour Karachi shift",()=>{
 it("uses exact fixed boundaries",()=>{const w=businessWindow("2026-10-20");expect(w.start.toISOString()).toBe("2026-10-20T14:00:00.000Z");expect(w.end.toISOString()).toBe("2026-10-20T23:00:00.000Z");});
 it.each([["2026-10-20T18:59:59+05:00",null],["2026-10-20T19:00:00+05:00","2026-10-20"],["2026-10-20T20:16:42+05:00","2026-10-20"],["2026-10-20T21:56:04+05:00","2026-10-20"],["2026-10-21T03:59:59+05:00","2026-10-20"],["2026-10-21T04:00:00+05:00",null]])("maps source %s",(stamp,date)=>expect(operationalDateFor(new Date(stamp!))).toBe(date));
 it.each([["2026-10-21T03:59:59+05:00","2026-10-19"],["2026-10-21T04:00:00+05:00","2026-10-20"],["2026-10-21T04:37:00+05:00","2026-10-20"]])("closes at four regardless of invocation %s",(stamp,date)=>expect(latestClosedBusinessDate(new Date(stamp))).toBe(date));
 it.each(["2026-02-30","garbage"])("rejects %s",date=>expect(()=>businessWindow(date)).toThrow());
});
