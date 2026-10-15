import { describe,expect,it } from "vitest";
import { ATTENDANCE_BYPASS_CLOSERS, businessWindow,evaluateAutoDockState,isCheckIn,latestClosedBusinessDate,OBSERVED_CHECK_IN_PHRASES,type EvaluationInput } from "./policy";
import { operationalDateFor } from "../time-ranges";

const base:EvaluationInput={employeeId:"normal",title:"Appointment Setter",active:true,membershipEligible:true,checkInFound:true,attendanceReliable:true,exempt:false,appointments:0,sales:0};
describe("attendance-gated automatic docks",()=>{
  it.each([true,false])("setter matrix present=%s",present=>{
    for(const appointments of [0,1,4]){const state=evaluateAutoDockState({...base,checkInFound:present,appointments});expect(state.amount).toBe(present&&appointments===0?1500:0);if(!present)expect(state.decision).toBe("SKIP_ABSENT");}
  });
  it.each([true,false])("closer matrix present=%s",present=>{
    for(const sales of [0,1,3]){const state=evaluateAutoDockState({...base,title:"Closer",checkInFound:present,sales});expect(state.amount).toBe(present&&sales===0?3000:0);if(!present)expect(state.decision).toBe("SKIP_ABSENT");}
  });
  it.each([...ATTENDANCE_BYPASS_CLOSERS])("exception %s is ALWAYS closer-only regardless of appointment activity",employeeId=>{
    for(const checkInFound of [false,true])for(const sales of [0,1,2])for(const appointments of [0,5]){
      const result=evaluateAutoDockState({...base,employeeId,title:"Hybrid Media",checkInFound,sales,appointments});
      expect(result.ruleCode).toBe("closer_zero_sales");expect(result.amount).toBe(sales?0:3000);expect(result.attendanceRequired).toBe(false);
    }
  });
  it("skips leave, inactive membership, inactive employee and unverified history including exceptions",()=>{
    for(const employeeId of ["normal",...ATTENDANCE_BYPASS_CLOSERS])for(const override of [{exempt:true},{active:false},{membershipEligible:false},{attendanceReliable:false}])expect(evaluateAutoDockState({...base,employeeId,...override}).amount).toBe(0);
  });
  it("late check-in creates expected state; late owned activity removes it",()=>{
    expect(evaluateAutoDockState({...base,checkInFound:false}).amount).toBe(0);
    expect(evaluateAutoDockState(base).amount).toBe(1500);
    expect(evaluateAutoDockState({...base,appointments:1}).amount).toBe(0);
    expect(evaluateAutoDockState({...base,title:"Closer"}).amount).toBe(3000);
    expect(evaluateAutoDockState({...base,title:"Closer",sales:1}).amount).toBe(0);
  });
  it("is deterministic across retries and ignores unrelated activity",()=>{
    expect(evaluateAutoDockState({...base,sales:5})).toEqual(evaluateAutoDockState({...base,sales:5}));
    expect(evaluateAutoDockState({...base,title:"Closer",appointments:5}).amount).toBe(3000);
    expect(evaluateAutoDockState({...base,sales:5}).amount).toBe(1500);
  });
});
describe("attendance evidence",()=>{
  it.each(OBSERVED_CHECK_IN_PHRASES)("recognizes observed phrase %s",phrase=>expect(isCheckIn(phrase,OBSERVED_CHECK_IN_PHRASES)).toBe(true));
  it.each(["off","break","break off","present","office","did you check in?","please check in","not checked in",""])("does not infer attendance from %s",phrase=>expect(isCheckIn(phrase,OBSERVED_CHECK_IN_PHRASES)).toBe(false));
  it("normalizes only harmless formatting",()=>expect(isCheckIn(" *CHECK  IN* ",OBSERVED_CHECK_IN_PHRASES)).toBe(true));
});
describe("full 05:00 business day",()=>{
  it("first approved window ends exactly October 17 05:00 Karachi",()=>{
    const window=businessWindow("2026-10-16");expect(window.start.toISOString()).toBe("2026-10-16T00:00:00.000Z");expect(window.end.toISOString()).toBe("2026-10-17T00:00:00.000Z");
  });
  it.each(["check-in","appointment","sale"])("uses source-time boundaries for %s",()=>{
    expect(operationalDateFor(new Date("2026-10-17T04:59:59+05:00"))).toBe("2026-10-16");
    expect(operationalDateFor(new Date("2026-10-17T05:00:00+05:00"))).toBe("2026-10-17");
  });
  it("never evaluates an incomplete day",()=>{
    expect(latestClosedBusinessDate(new Date("2026-10-17T04:59:59+05:00"))).toBe("2026-10-15");
    expect(latestClosedBusinessDate(new Date("2026-10-17T05:00:00+05:00"))).toBe("2026-10-16");
  });
  it.each(["2026-02-30","garbage"])("rejects malformed day %s",date=>expect(()=>businessWindow(date)).toThrow());
});
