const ZONE_OFFSETS_MINUTES: Record<string, number> = {
  EST: -5 * 60, EDT: -4 * 60,
  CST: -6 * 60, CDT: -5 * 60,
  MST: -7 * 60, MDT: -6 * 60,
  PST: -8 * 60, PDT: -7 * 60,
};

const WEEKDAYS: Record<string, number> = {
  sunday: 0, monday: 1, tuesday: 2, wednesday: 3,
  thursday: 4, friday: 5, saturday: 6,
};

/** Resolve the scheduling phrases used in the sales-development channels. */
export function parseScheduledCallAt(dateText: string | null, timeText: string | null, timezone: string | null, postedAt: Date) {
  if (!timeText) return null;
  if (/^(?:right\s+now|now)$/i.test(timeText.trim())) return new Date(postedAt);

  const offsetMinutes = ZONE_OFFSETS_MINUTES[timezone?.toUpperCase() ?? ""];
  if (offsetMinutes == null) return null;
  const time = timeText.match(/(\d{1,2})(?::(\d{2}))?\s*(am|pm)?/i);
  if (!time) return null;
  let hour = Number(time[1]);
  const minute = Number(time[2] ?? 0);
  const meridiem = time[3]?.toLowerCase();
  if (minute > 59 || hour > (meridiem ? 12 : 23) || hour < 1) return null;
  if (meridiem === "am" && hour === 12) hour = 0;
  if (meridiem === "pm" && hour !== 12) hour += 12;

  const localPosted = new Date(postedAt.getTime() + offsetMinutes * 60_000);
  const year = localPosted.getUTCFullYear();
  const month = localPosted.getUTCMonth();
  let day = localPosted.getUTCDate();
  const normalizedDate = dateText?.trim().toLowerCase() ?? "";
  if (normalizedDate === "tomorrow") day += 1;
  else if (normalizedDate && normalizedDate !== "today") {
    const weekday = Object.entries(WEEKDAYS).find(([name]) => normalizedDate.startsWith(name))?.[1];
    if (weekday == null) return null;
    day += (weekday - localPosted.getUTCDay() + 7) % 7;
  } else if (!normalizedDate) return null;

  const result = new Date(Date.UTC(year, month, day, hour, minute) - offsetMinutes * 60_000);
  return Number.isNaN(result.getTime()) ? null : result;
}
