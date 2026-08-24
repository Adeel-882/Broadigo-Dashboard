export type AppointmentQualification = "QUALIFIED" | "NOT_QUALIFIED" | "UNKNOWN";

/** Explicit disposition classifier. Negative must be checked before positive. */
export function classifyAppointmentQualification(text: string): AppointmentQualification {
  const normalized = text.trim();
  if (/\bnot\s+qualified\b/i.test(normalized)) return "NOT_QUALIFIED";
  if (/\bqualified\b/i.test(normalized)) return "QUALIFIED";
  return "UNKNOWN";
}

export interface DispositionReply { text: string; ts: string; user?: string | null }

export function latestAssignedCloserDisposition(replies: DispositionReply[], assignedCloserSlackUserId: string) {
  return replies
    .filter((reply) => reply.user === assignedCloserSlackUserId)
    .map((reply) => ({ ...reply, status: classifyAppointmentQualification(reply.text) }))
    .filter((reply) => reply.status !== "UNKNOWN")
    .sort((a, b) => Number.parseFloat(a.ts) - Number.parseFloat(b.ts))
    .at(-1) ?? null;
}
