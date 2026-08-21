import type { PeriodKey } from "@/types/dashboard";

export const DASHBOARD_TIMEZONE = "Asia/Karachi" as const;
export const SHIFT_START_HOUR = 19;
export const SHIFT_END_HOUR = 5;
export const SHIFT_START_TIME = "19:00" as const;
export const SHIFT_END_TIME = "05:00" as const;
export const OPERATIONAL_SHIFT_LABEL = `${SHIFT_START_TIME}–${SHIFT_END_TIME}`;
export const OPERATIONAL_SHIFT_HUMAN_LABEL = "7:00 PM–5:00 AM" as const;

const KARACHI_OFFSET_MS = 5 * 60 * 60 * 1000;
const DAY_MS = 86_400_000;

function karachiParts(timestamp: Date) {
  const local = new Date(timestamp.getTime() + KARACHI_OFFSET_MS);
  return { year: local.getUTCFullYear(), month: local.getUTCMonth(), day: local.getUTCDate(), hour: local.getUTCHours() };
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

function karachiLocalToUtc(date: Date, hour: number) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hour) - KARACHI_OFFSET_MS);
}

export function operationalDateFor(timestamp: Date) {
  const local = karachiParts(timestamp);
  const calendarDate = dateFromParts(local.year, local.month, local.day);
  return formatDate(local.hour < SHIFT_END_HOUR ? addDays(calendarDate, -1) : calendarDate);
}

export function isWithinOperationalShift(timestamp: Date) {
  const { hour } = karachiParts(timestamp);
  return hour >= SHIFT_START_HOUR || hour < SHIFT_END_HOUR;
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
    start: karachiLocalToUtc(firstDay, SHIFT_START_HOUR),
    end: karachiLocalToUtc(endDateExclusive, SHIFT_END_HOUR),
    previousStart: karachiLocalToUtc(previousFirstDay, SHIFT_START_HOUR),
    previousEnd: karachiLocalToUtc(previousEndDateExclusive, SHIFT_END_HOUR),
    startDate: formatDate(firstDay), endDate: formatDate(lastDay), endDateExclusive: formatDate(endDateExclusive),
    previousStartDate: formatDate(previousFirstDay), previousEndDateExclusive: formatDate(previousEndDateExclusive),
    dayCount, label: `${formatDate(firstDay)} – ${formatDate(lastDay)}`,
  };
}
