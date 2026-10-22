/** Automatic docks use source timestamps in a nine-hour Karachi shift. */
export const AUTO_DOCK_TIME_ZONE = "Asia/Karachi";
export const AUTO_DOCK_SHIFT_START = "19:00";
export const AUTO_DOCK_SHIFT_END = "04:00";
const DAY = 86_400_000;
export function businessWindow(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid business date");
  const start = new Date(`${date}T14:00:00.000Z`);
  if (!Number.isFinite(+start) || start.toISOString().slice(0,10)!==date) throw new Error("Invalid business date");
  return {start, end: new Date(+start + 9*3_600_000)};
}
/** Null during the 04:00–19:00 gap: off-shift activity earns no credit. */
export function autoDockBusinessDateFor(timestamp: Date): string | null {
  const local = new Date(+timestamp + 5*3_600_000);
  const hour = local.getUTCHours();
  if (hour >= 19) return local.toISOString().slice(0,10);
  if (hour < 4) return new Date(+local-DAY).toISOString().slice(0,10);
  return null;
}
export function latestClosedBusinessDate(now = new Date()) {
  // At 23:00 UTC today's shift has closed; invocation delay cannot move its end.
  return new Date(+now - (now.getUTCHours() >= 23 ? 0 : DAY)).toISOString().slice(0,10);
}
export function formatAutoDockTime(value?: string) {
  return value ? new Intl.DateTimeFormat("en-US", {timeZone:AUTO_DOCK_TIME_ZONE,month:"short",day:"numeric",hour:"numeric",minute:"2-digit"}).format(new Date(value)) : "Not recorded";
}
