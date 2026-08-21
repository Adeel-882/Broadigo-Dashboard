import { describe, expect, it } from "vitest";
import { operationalDateFor, resolveDateRange } from "@/lib/time-ranges";
import type { PeriodKey } from "@/types/dashboard";

/**
 * Period-filter regression coverage.
 *
 * Every dashboard period resolves to an operational window that starts at 19:00
 * Asia/Karachi on its first day and ends at 05:00 on the day after its last, and
 * the comparison window is the immediately preceding stretch of equal length.
 */
// 2026-08-21 23:30 Asia/Karachi -> operational date 2026-08-21 (Friday).
const NOW = new Date("2026-08-21T18:30:00Z");
const KARACHI = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Karachi", year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", hour12: false,
});
const local = (date: Date) => KARACHI.format(date).replace(", ", " ");

const PERIODS: Array<[PeriodKey, string, string, number]> = [
  ["Today", "2026-08-21", "2026-08-21", 1],
  ["Yesterday", "2026-08-20", "2026-08-20", 1],
  ["This Week", "2026-08-17", "2026-08-23", 7],
  ["Last Week", "2026-08-10", "2026-08-16", 7],
  ["This Month", "2026-08-01", "2026-08-31", 31],
  ["Last Month", "2026-07-01", "2026-07-31", 31],
];

describe("dashboard period filters", () => {
  it.each(PERIODS)("%s resolves to %s – %s", (period, startDate, endDate, dayCount) => {
    const range = resolveDateRange(period, undefined, undefined, NOW);
    expect(range.startDate).toBe(startDate);
    expect(range.endDate).toBe(endDate);
    expect(range.dayCount).toBe(dayCount);
    expect(range.label).toBe(`${startDate} – ${endDate}`);
  });

  it.each(PERIODS)("%s spans 19:00 to 05:00 Asia/Karachi", (period) => {
    const range = resolveDateRange(period, undefined, undefined, NOW);
    expect(local(range.start).endsWith(" 19:00")).toBe(true);
    expect(local(range.end).endsWith(" 05:00")).toBe(true);
    expect(range.start.getTime()).toBeLessThan(range.end.getTime());
  });

  it.each(PERIODS)("%s compares against the preceding window of equal length", (period, startDate, _e, dayCount) => {
    const range = resolveDateRange(period, undefined, undefined, NOW);
    // A window runs 19:00 on its first operational day to 05:00 after its last,
    // so its wall-clock span is dayCount days minus 14 hours. Comparing the
    // operational date bounds is what actually shows the windows line up.
    const spanInDays = (Date.parse(`${range.previousEndDateExclusive}T00:00:00Z`) - Date.parse(`${range.previousStartDate}T00:00:00Z`)) / 86_400_000;
    expect(spanInDays).toBe(dayCount);
    expect(range.previousEndDateExclusive).toBe(startDate);
    expect(range.previousEnd.getTime()).toBeLessThanOrEqual(range.start.getTime());
  });

  it("gives Today and Yesterday adjacent, non-overlapping windows", () => {
    const today = resolveDateRange("Today", undefined, undefined, NOW);
    const yesterday = resolveDateRange("Yesterday", undefined, undefined, NOW);
    expect(yesterday.end.getTime()).toBeLessThanOrEqual(today.start.getTime());
    expect(yesterday.endDate).toBe("2026-08-20");
    expect(today.startDate).toBe("2026-08-21");
  });

  it("keeps This Week and Last Week contiguous and Monday-based", () => {
    const thisWeek = resolveDateRange("This Week", undefined, undefined, NOW);
    const lastWeek = resolveDateRange("Last Week", undefined, undefined, NOW);
    expect(new Date(`${thisWeek.startDate}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(new Date(`${lastWeek.startDate}T00:00:00Z`).getUTCDay()).toBe(1);
    expect(lastWeek.endDate).toBe("2026-08-16");
    expect(thisWeek.startDate).toBe("2026-08-17");
  });

  it("resolves a custom range inclusively", () => {
    const range = resolveDateRange("Custom Range", "2026-08-03", "2026-08-07", NOW);
    expect(range.startDate).toBe("2026-08-03");
    expect(range.endDate).toBe("2026-08-07");
    expect(range.dayCount).toBe(5);
  });

  it.each([
    ["missing both", undefined, undefined],
    ["missing end", "2026-08-03", undefined],
    ["inverted", "2026-08-09", "2026-08-03"],
    ["malformed", "2026-13-40", "2026-13-41"],
  ])("rejects an invalid custom range (%s)", (_label, start, end) => {
    expect(() => resolveDateRange("Custom Range", start, end, NOW)).toThrow();
  });

  it("assigns post-midnight activity to the shift that started the night before", () => {
    expect(operationalDateFor(new Date("2026-08-21T19:00:00Z"))).toBe("2026-08-21"); // 00:00 PKT on the 22nd
    expect(operationalDateFor(new Date("2026-08-21T23:59:00Z"))).toBe("2026-08-21"); // 04:59 PKT
    expect(operationalDateFor(new Date("2026-08-22T00:00:00Z"))).toBe("2026-08-22"); // 05:00 PKT
  });
});
