/** Financial scheduling is intentionally independent of dashboard reporting. */
export const AUTO_DOCK_TIME_ZONE = "Asia/Karachi";
export function autoDockBusinessDateFor(timestamp: Date) {
  // Approved 05:00 Karachi boundary is precisely 00:00 UTC year-round.
  // Keep the original 05:00–05:00 rule, even when Chicago observes DST.
  return timestamp.toISOString().slice(0, 10);
}
