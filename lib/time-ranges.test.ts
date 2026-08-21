import { describe, expect, it } from "vitest";
import { isWithinOperationalShift, operationalDateFor, resolveDateRange } from "./time-ranges";

const karachi = (value: string) => new Date(`${value}+05:00`);

describe("Asia/Karachi operational shift dates", () => {
  it.each([
    ["2026-08-18T18:59:00", "2026-08-18", false],
    ["2026-08-18T19:00:00", "2026-08-18", true],
    ["2026-08-18T23:59:00", "2026-08-18", true],
    ["2026-08-19T00:00:00", "2026-08-18", true],
    ["2026-08-19T03:59:59", "2026-08-18", true],
    ["2026-08-19T04:59:59", "2026-08-18", true],
    ["2026-08-19T05:00:00", "2026-08-19", false],
  ])("maps %s to %s with shift eligibility %s", (value, date, eligible) => {
    const timestamp = karachi(value);
    expect(operationalDateFor(timestamp)).toBe(date);
    expect(isWithinOperationalShift(timestamp)).toBe(eligible);
  });

  it.each([
    ["2026-09-01T04:59:59", "2026-08-31"],
    ["2026-08-17T04:59:59", "2026-08-16"],
    ["2027-01-01T04:59:59", "2026-12-31"],
    ["2026-09-01T05:00:00", "2026-09-01"],
    ["2026-08-17T05:00:00", "2026-08-17"],
    ["2027-01-01T05:00:00", "2027-01-01"],
  ])("handles month, week, and year boundary %s", (value, date) => {
    expect(operationalDateFor(karachi(value))).toBe(date);
  });

  it("keeps Today on the shift start date before 5 AM", () => {
    const range = resolveDateRange("Today", undefined, undefined, karachi("2026-08-19T04:59:59"));
    expect(range.startDate).toBe("2026-08-18");
    expect(range.start.toISOString()).toBe("2026-08-18T14:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-19T00:00:00.000Z");
  });

  it("moves Today to the current calendar date at 5 AM", () => {
    const range = resolveDateRange("Today", undefined, undefined, karachi("2026-08-19T05:00:00"));
    expect(range.startDate).toBe("2026-08-19");
    expect(range.start.toISOString()).toBe("2026-08-19T14:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-20T00:00:00.000Z");
  });

  it("groups sales on both sides of midnight under the shift start date", () => {
    const sales = [karachi("2026-08-18T23:00:00"), karachi("2026-08-19T02:00:00")];
    expect(sales.every(isWithinOperationalShift)).toBe(true);
    expect(sales.map(operationalDateFor)).toEqual(["2026-08-18", "2026-08-18"]);
  });

  it.each([
    ["Today", "2026-08-19", "2026-08-19"], ["Yesterday", "2026-08-18", "2026-08-18"],
    ["This Week", "2026-08-17", "2026-08-23"], ["Last Week", "2026-08-10", "2026-08-16"],
    ["This Month", "2026-08-01", "2026-08-31"], ["Last Month", "2026-07-01", "2026-07-31"],
  ] as const)("resolves %s by operational date", (period, startDate, endDate) => {
    const range = resolveDateRange(period, undefined, undefined, karachi("2026-08-19T16:00:00"));
    expect(range.startDate).toBe(startDate); expect(range.endDate).toBe(endDate);
  });

  it("includes every requested custom operational date", () => {
    const range = resolveDateRange("Custom Range", "2026-08-01", "2026-08-03");
    expect(range.start.toISOString()).toBe("2026-08-01T14:00:00.000Z");
    expect(range.end.toISOString()).toBe("2026-08-04T00:00:00.000Z");
    expect(range.dayCount).toBe(3);
  });

  it.each([
    ["2026-08-17T04:59:59", "This Week", "2026-08-10", "2026-08-16"],
    ["2026-09-01T04:59:59", "This Month", "2026-08-01", "2026-08-31"],
    ["2027-01-01T04:59:59", "This Month", "2026-12-01", "2026-12-31"],
  ] as const)("keeps %s inside the correct operational %s boundary", (now, period, startDate, endDate) => {
    const range = resolveDateRange(period, undefined, undefined, karachi(now));
    expect(range.startDate).toBe(startDate);
    expect(range.endDate).toBe(endDate);
  });
});
