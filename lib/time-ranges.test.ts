import { describe, expect, it } from "vitest";
import { isWithinOperationalShift, operationalDateFor, resolveOperationalShiftRange as resolveDateRange, formatReportingTimestamp } from "./time-ranges";
import { autoDockBusinessDateFor } from "./auto-docks/time";
import { latestClosedBusinessDate } from "./auto-docks/policy";

describe("America/Chicago reporting", () => {
  it.each([
    ["2026-03-07","2026-03-08","2026-03-07T15:00:00.000Z","2026-03-09T00:00:00.000Z"],
    ["2026-10-31","2026-11-01","2026-10-31T14:00:00.000Z","2026-11-02T01:00:00.000Z"],
  ])("resolves each endpoint independently across DST: %s–%s",(start,end,utcStart,utcEnd)=>{
    const r=resolveDateRange("Custom Range",start,end);
    expect(r.start.toISOString()).toBe(utcStart);
    expect(r.end.toISOString()).toBe(utcEnd);
    expect(r.dayCount).toBe(2);
  });
  it.each([
    ["2026-10-12T08:59:59-05:00", false], ["2026-10-12T09:00:00-05:00", true],
    ["2026-10-12T18:59:59-05:00", true], ["2026-10-12T19:00:00-05:00", false],
    ["2026-12-12T08:59:59-06:00", false], ["2026-12-12T09:00:00-06:00", true],
    ["2026-12-12T18:59:59-06:00", true], ["2026-12-12T19:00:00-06:00", false],
  ])("uses inclusive start / exclusive end for %s", (stamp, included) => {
    expect(isWithinOperationalShift(new Date(stamp))).toBe(included);
    expect(operationalDateFor(new Date(stamp))).toBe(stamp.slice(0,10));
  });
  it.each([
    ["2026-10-12", "14:00", "00:00"], ["2026-12-12", "15:00", "01:00"],
    ["2026-03-07", "15:00", "01:00"], ["2026-03-08", "14:00", "00:00"],
    ["2026-10-31", "14:00", "00:00"], ["2026-11-01", "15:00", "01:00"],
  ])("resolves 09:00–19:00 on %s across CDT/CST transitions", (date, start, end) => {
    const r=resolveDateRange("Custom Range",date,date);
    expect(r.start.toISOString()).toBe(date+"T"+start+":00.000Z");
    expect(r.end.toISOString().slice(11,16)).toBe(end);
    expect(r.end.getTime()-r.start.getTime()).toBe(10*3600000);
    expect(isWithinOperationalShift(r.start)).toBe(true);
    expect(isWithinOperationalShift(r.end)).toBe(false);
  });
  it("uses Central calendar today, even outside operating hours",()=>{
    const now=new Date("2026-10-13T00:30:00Z"); // Oct13 PKT, Oct12 Central
    expect(resolveDateRange("Today",undefined,undefined,now).startDate).toBe("2026-10-12");
    expect(resolveDateRange("Yesterday",undefined,undefined,now).startDate).toBe("2026-10-11");
    expect(operationalDateFor(new Date("2026-10-13T05:00:00Z"))).toBe("2026-10-13");
  });
  it.each(["1791825674.548629","1791826997.534049","1791834869.713019"])("preserves Asif's Oct12 source %s",ts=>{
    const instant=new Date(Number(ts)*1000);
    const r=resolveDateRange("Custom Range","2026-10-12","2026-10-12");
    expect(operationalDateFor(instant)).toBe("2026-10-12");
    expect(isWithinOperationalShift(instant)).toBe(true);
    expect(instant>=r.start&&instant<r.end).toBe(true);
  });
  it("formats evidence with the seasonal Central abbreviation",()=>{
    expect(formatReportingTimestamp(new Date("2026-10-12T17:43:00Z"))).toContain("12:43 PM CDT");
    expect(formatReportingTimestamp(new Date("2026-12-12T18:43:00Z"))).toContain("12:43 PM CST");
  });
  it.each([
    ["2026-11-01T05:30:00Z","2026-11-01"], ["2026-03-01T05:30:00Z","2026-02-28"],
    ["2027-01-01T05:30:00Z","2026-12-31"],
  ])("uses local month/year boundaries at %s",(stamp,date)=>expect(operationalDateFor(new Date(stamp))).toBe(date));
  it.each(["2026-03-08T00:00:00Z","2026-11-01T00:00:00Z","2026-10-17T00:00:00Z"])("keeps automatic docks independent at %s",stamp=>{
    const now=new Date(stamp);
    expect(autoDockBusinessDateFor(now)).toBe(stamp.slice(0,10));
    expect(latestClosedBusinessDate(now)).toBe(new Date(now.getTime()-86400000).toISOString().slice(0,10));
    expect(operationalDateFor(now)).not.toBe(autoDockBusinessDateFor(now));
  });
});
