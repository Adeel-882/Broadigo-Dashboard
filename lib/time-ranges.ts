import type { PeriodKey } from "@/types/dashboard";

export const REPORTING_TIME_ZONE = "America/Chicago" as const;
export const DASHBOARD_TIMEZONE = REPORTING_TIME_ZONE;
export const SHIFT_START_HOUR = 9;
export const SHIFT_END_HOUR = 19;
export const SHIFT_START_TIME = "09:00" as const;
export const SHIFT_END_TIME = "19:00" as const;
export const OPERATIONAL_SHIFT_LABEL = `${SHIFT_START_TIME}–${SHIFT_END_TIME}`;
export const OPERATIONAL_SHIFT_HUMAN_LABEL = "9:00 AM–7:00 PM" as const;

const DAY_MS = 86_400_000;
const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORTING_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23",
});
const evidenceClock = new Intl.DateTimeFormat("en-US", {
  timeZone: REPORTING_TIME_ZONE, year: "numeric", month: "short", day: "numeric",
  hour: "numeric", minute: "2-digit", timeZoneName: "short",
});
export const formatReportingTimestamp = (timestamp: Date) => evidenceClock.format(timestamp);

function reportingParts(timestamp: Date) {
  const parts = Object.fromEntries(clock.formatToParts(timestamp).map(p => [p.type, p.value]));
  return { year: Number(parts.year), month: Number(parts.month) - 1, day: Number(parts.day), hour: Number(parts.hour), minute: Number(parts.minute), second: Number(parts.second) };
}

function dateFromParts(year: number, month: number, day: number) { return new Date(Date.UTC(year, month, day)); }
function formatDate(date: Date) { return date.toISOString().slice(0, 10); }
function addDays(date: Date, days: number) { return new Date(date.getTime() + days * DAY_MS); }

function parseDate(value: string) {
  const [year, month, day] = value.split("-").map(Number);
  if (!year || !month || !day) throw new Error("A valid ISO date is required.");
  const parsed = dateFromParts(year, month - 1, day);
  if (formatDate(parsed) !== value) throw new Error("A valid ISO date is required.");
  return parsed;
}

/** Resolve the unambiguous daytime shift boundaries using IANA/Intl rules.
 * Calendar arithmetic above is deliberately separate from elapsed UTC hours. */
function reportingLocalToUtc(date: Date, hour: number) {
  const wall = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour);
  let instant = wall;
  for (let attempt = 0; attempt < 4; attempt++) {
    const p = reportingParts(new Date(instant));
    const correction = wall - Date.UTC(p.year, p.month, p.day, p.hour, p.minute, p.second);
    if (correction === 0) return new Date(instant);
    instant += correction;
  }
  throw new Error("Unable to resolve reporting boundary.");
}

export function operationalDateFor(timestamp: Date) {
  const local = reportingParts(timestamp);
  const calendarDate = dateFromParts(local.year, local.month, local.day);
  return formatDate(calendarDate);
}

export function isWithinOperationalShift(timestamp: Date) {
  const { hour } = reportingParts(timestamp);
  return hour >= SHIFT_START_HOUR && hour < SHIFT_END_HOUR;
}

export function resolveDateRange(period: PeriodKey, customStart?: string, customEnd?: string, now = new Date()) {
  const operationalToday = parseDate(operationalDateFor(now));
  let firstDay = operationalToday;
  let lastDay = operationalToday;

  if (period === "Yesterday") firstDay = lastDay = addDays(operationalToday, -1);
  if (period === "This Week") {
    const mondayOffset = (operationalToday.getUTCDay() + 6) % 7;
    firstDay = addDays(operationalToday, -mondayOffset); lastDay = addDays(firstDay, 6);
  }
  if (period === "Last Week") {
    const mondayOffset = (operationalToday.getUTCDay() + 6) % 7;
    lastDay = addDays(operationalToday, -mondayOffset - 1); firstDay = addDays(lastDay, -6);
  }
  if (period === "This Month") {
    firstDay = dateFromParts(operationalToday.getUTCFullYear(), operationalToday.getUTCMonth(), 1);
    lastDay = addDays(dateFromParts(operationalToday.getUTCFullYear(), operationalToday.getUTCMonth() + 1, 1), -1);
  }
  if (period === "Last Month") {
    firstDay = dateFromParts(operationalToday.getUTCFullYear(), operationalToday.getUTCMonth() - 1, 1);
    lastDay = addDays(dateFromParts(operationalToday.getUTCFullYear(), operationalToday.getUTCMonth(), 1), -1);
  }
  if (period === "Custom Range") {
    if (!customStart || !customEnd || customStart > customEnd) throw new Error("A valid custom start and end date are required.");
    firstDay = parseDate(customStart); lastDay = parseDate(customEnd);
  }

  const dayCount = Math.round((lastDay.getTime() - firstDay.getTime()) / DAY_MS) + 1;
  const endDateExclusive = addDays(lastDay, 1);
  const previousFirstDay = addDays(firstDay, -dayCount);
  const previousEndDateExclusive = firstDay;

  return {
    start: reportingLocalToUtc(firstDay, SHIFT_START_HOUR),
    end: reportingLocalToUtc(lastDay, SHIFT_END_HOUR),
    previousStart: reportingLocalToUtc(previousFirstDay, SHIFT_START_HOUR),
    previousEnd: reportingLocalToUtc(addDays(firstDay, -1), SHIFT_END_HOUR),
    startDate: formatDate(firstDay), endDate: formatDate(lastDay), endDateExclusive: formatDate(endDateExclusive),
    previousStartDate: formatDate(previousFirstDay), previousEndDateExclusive: formatDate(previousEndDateExclusive),
    dayCount, label: `${formatDate(firstDay)} – ${formatDate(lastDay)}`,
  };
}
