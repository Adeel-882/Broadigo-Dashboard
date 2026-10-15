import {describe,it,expect} from "vitest";
import {calendarDateFor,resolveDateRange,isWithinOperationalShift} from "./time-ranges";
const october=resolveDateRange("This Month",undefined,undefined,new Date("2026-10-15T15:00:00Z"));
const september=resolveDateRange("Last Month",undefined,undefined,new Date("2026-10-15T15:00:00Z"));
const includes=(r:typeof october,stamp:string)=>new Date(stamp)>=r.start&&new Date(stamp)<r.end;
describe("full Central calendar filters",()=>{
  it("includes November midnight in November, not October",()=>{
    const november=resolveDateRange("Custom Range","2026-11-01","2026-11-30");
    expect(includes(november,"2026-11-01T00:00:00-05:00")).toBe(true);
    expect(includes(october,"2026-11-01T00:00:00-05:00")).toBe(false);
  });
  it.each([
    ["2026-09-30T23:59:59-05:00",false,true],
    ["2026-10-01T00:00:00-05:00",true,false],
    ["2026-10-01T00:01:00-05:00",true,false],
    ["2026-10-31T23:59:59-05:00",true,false],
    ["2026-11-01T00:00:00-05:00",false,false],
  ])("assigns %s to exactly its calendar month",(stamp,oct,sep)=>{
    expect(includes(october,stamp)).toBe(oct);expect(includes(september,stamp)).toBe(sep);
  });
  it("does not mistake Pakistan midnight for Central midnight",()=>{
    const stamp="2026-10-01T00:35:44.859+05:00";
    expect(calendarDateFor(new Date(stamp))).toBe("2026-09-30");
    expect(includes(september,stamp)).toBe(true);expect(includes(october,stamp)).toBe(false);
  });
  it("includes early-morning source records regardless of shift",()=>{
    const stamp="2026-10-01T00:01:00-05:00";
    expect(isWithinOperationalShift(new Date(stamp))).toBe(false);
    expect(includes(october,stamp)).toBe(true);
  });
  it("makes the custom end date inclusive via the next midnight",()=>{
    const r=resolveDateRange("Custom Range","2026-10-01","2026-10-12");
    expect(r.start.toISOString()).toBe("2026-10-01T05:00:00.000Z");
    expect(r.end.toISOString()).toBe("2026-10-13T05:00:00.000Z");
  });
  it.each([["2026-03-08",23],["2026-11-01",25],["2026-10-12",24]])("resolves %s as a complete local day (%s hours)",(date,hours)=>{
    const r=resolveDateRange("Custom Range",String(date),String(date));
    expect((r.end.getTime()-r.start.getTime())/3600000).toBe(hours);
  });
  it("Today and Yesterday meet at Central midnight",()=>{
    const now=new Date("2026-10-02T05:01:00Z");
    const t=resolveDateRange("Today",undefined,undefined,now),y=resolveDateRange("Yesterday",undefined,undefined,now);
    expect(t.start.toISOString()).toBe("2026-10-02T05:00:00.000Z");
    expect(y.end.toISOString()).toBe(t.start.toISOString());
    expect(includes(t,"2026-10-02T00:01:00-05:00")).toBe(true);
    expect(includes(y,"2026-10-02T00:01:00-05:00")).toBe(false);
  });
});
