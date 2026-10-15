import { autoDockBusinessDateFor } from "./time";

/** Explicit management approval. Never backdate financial creation. */
export const FIRST_APPROVED_BUSINESS_DATE = "2026-10-16";
export const GENERAL_CHANNEL_ID = "C0980E2DWAK";
export const AUTO_DOCK_AMOUNTS = {
  appointment_setter_zero_appointments: 3000,
  closer_zero_sales: 1500,
} as const;
export const OBSERVED_CHECK_IN_PHRASES = ["check in", "checkin", "cheak in", "check in at 7", "check in at 7:00", "clocked in @ 7:15 pm."];

/** Management-confirmed roles for these two attendance exceptions. Never infer
 * a role from activity or mutate the employee's organization memberships. */
export type AutoRole = "SETTER" | "CLOSER" | "OTHER";
export const AUTO_DOCK_EMPLOYEE_OVERRIDES: Readonly<Record<string, { role: AutoRole; bypassAttendance: boolean }>> = {
  "03cfda43-9721-41e0-b7fe-60f40538aa29": { role: "SETTER", bypassAttendance: true }, // Harvey Benjamin
  "d2bf73cc-c9f6-48a8-be72-61b827e39619": { role: "CLOSER", bypassAttendance: true }, // Dameon Wolfe
};
export function autoRole(employeeId: string, title: string): AutoRole {
  const override = AUTO_DOCK_EMPLOYEE_OVERRIDES[employeeId];
  if (override) return override.role;
  if (/\bcloser\b/i.test(title)) return "CLOSER";
  if (/\bappointment setter\b/i.test(title)) return "SETTER";
  return "OTHER";
}
export function businessWindow(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Invalid business date");
  // Karachi is UTC+05:00: 05:00 local is 00:00 UTC. Unlike reporting,
  // automatic inactivity uses the full day, including pre-shift check-ins.
  const start = new Date(`${date}T00:00:00.000Z`);
  if (!Number.isFinite(start.getTime()) || start.toISOString().slice(0,10)!==date) throw new Error("Invalid business date");
  return { start, end: new Date(start.getTime()+86_400_000) };
}
export function latestClosedBusinessDate(now = new Date()) {
  const today = businessWindow(autoDockBusinessDateFor(now));
  return new Date(today.start.getTime()-86_400_000).toISOString().slice(0,10);
}
/** Only exact, reviewed production phrases may be configured. Empty means
 * unconfigured, never "everyone absent". No guessed attendance vocabulary. */
export function normalizeCheckIn(text: string) {
  return text.replace(/[*_~`]/g, "").trim().replace(/\s+/g, " ").toLowerCase();
}
export function isCheckIn(text: string, approvedPhrases: string[]) {
  return approvedPhrases.some(phrase => normalizeCheckIn(phrase)===normalizeCheckIn(text));
}
export interface EvaluationInput {
  employeeId: string; title: string; active: boolean; membershipEligible: boolean;
  checkInFound: boolean; attendanceReliable: boolean; exempt: boolean;
  appointments: number; sales: number;
}
export function evaluateAutoDockState(input: EvaluationInput) {
  const role=autoRole(input.employeeId,input.title);
  const attendanceRequired=!AUTO_DOCK_EMPLOYEE_OVERRIDES[input.employeeId]?.bypassAttendance;
  const attendanceStatus=!input.attendanceReliable ? "UNKNOWN" : !attendanceRequired ? "BYPASSED" : input.checkInFound ? "PRESENT" : "ABSENT";
  const ruleCode=role==="CLOSER"?"closer_zero_sales":role==="SETTER"?"appointment_setter_zero_appointments":null;
  const decision=!input.active||!input.membershipEligible?"SKIP_INACTIVE":role==="OTHER"?"SKIP_ROLE":input.exempt?"SKIP_EXEMPT":!input.attendanceReliable?"SKIP_UNRELIABLE":attendanceRequired&&!input.checkInFound?"SKIP_ABSENT":(role==="CLOSER"?input.sales:input.appointments)>0?"ACTIVITY_RECORDED":"DOCK";
  return { role, ruleCode, attendanceRequired, attendanceStatus, decision,
    amount:decision==="DOCK"&&ruleCode?AUTO_DOCK_AMOUNTS[ruleCode]:0,
    reason:role==="CLOSER"?(attendanceRequired?"No sale reported while present":"No sale reported during business day — attendance gate bypass"):(attendanceRequired?"No appointment scheduled while present":"No appointment scheduled during business day — attendance gate bypass") };
}
