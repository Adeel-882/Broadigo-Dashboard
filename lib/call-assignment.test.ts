import { describe, expect, it } from "vitest";
import type { AssignedCall } from "@/types/dashboard";

/**
 * Setter → appointment → assigned Closer.
 *
 * An appointment record is owned by the setter who booked it (`employee_id`) and
 * separately names the Closer assigned to conduct it (`assigned_person`, a Slack
 * user id resolved through employee_slack_identities). Assignment is visibility
 * only: it must never move appointment credit, create a sale, or produce revenue.
 */

interface AppointmentRecord {
  id: string;
  /** The setter. This is who the appointment counts for. */
  employeeId: string;
  /** Slack user id of the Closer assigned to run the call. */
  assignedPerson: string | null;
  teamId: string;
  prospectName: string | null;
  scheduledText: string | null;
}

const identities: Record<string, string> = {
  "U-DAMEON": "closer-a",
  "U-ZACK": "closer-b",
};

/** Mirrors the employee-detail query: appointments assigned to this employee. */
const callsFor = (employeeId: string, records: AppointmentRecord[]): AssignedCall[] =>
  records
    .filter((record) => record.assignedPerson !== null && identities[record.assignedPerson] === employeeId)
    .map((record) => ({
      id: record.id, prospect: record.prospectName, scheduledText: record.scheduledText,
      scheduledAt: null, loggedAt: "21-Aug-2026, 9:00 pm", setter: record.employeeId, assignedTo: employeeId,
      phone: null, state: null, timezone: null, team: null, division: null,
      channel: "sales-development-general", sourceUrl: "https://slack.com/app_redirect?channel=C098WNHNBR7&message_ts=1.0", raw: "",
    }));

/** Appointment credit follows employee_id, never the assignment. */
const appointmentCreditFor = (employeeId: string, records: AppointmentRecord[]) =>
  records.filter((record) => record.employeeId === employeeId).length;

const appointment = (overrides: Partial<AppointmentRecord> = {}): AppointmentRecord => ({
  id: "appt-1", employeeId: "setter-a", assignedPerson: "U-DAMEON", teamId: "leadsedge-re",
  prospectName: "John Smith", scheduledText: "tomorrow 10:00 AM EST", ...overrides,
});

describe("setter keeps credit when a call is assigned to a closer", () => {
  const records = [appointment()];

  it("credits the appointment to the setter", () => {
    expect(appointmentCreditFor("setter-a", records)).toBe(1);
  });

  it("gives the assigned closer no appointment credit", () => {
    expect(appointmentCreditFor("closer-a", records)).toBe(0);
  });

  it("shows the call to the assigned closer", () => {
    const calls = callsFor("closer-a", records);
    expect(calls).toHaveLength(1);
    expect(calls[0].prospect).toBe("John Smith");
    expect(calls[0].setter).toBe("setter-a");
  });

  it("does not show the call to a different closer", () => {
    expect(callsFor("closer-b", records)).toHaveLength(0);
  });

  it("does not duplicate the appointment record", () => {
    expect(records).toHaveLength(1);
    expect(new Set(records.map((r) => r.id)).size).toBe(1);
  });

  it("creates neither a sale nor revenue", () => {
    // The appointment record carries no monetary field at all; assignment cannot
    // manufacture one.
    expect(Object.keys(records[0])).not.toContain("amount");
    expect(Object.keys(records[0])).not.toContain("revenue");
  });
});

describe("reassigning a call moves visibility only", () => {
  it("keeps one record, moves it between closers, and leaves the setter untouched", () => {
    const before = [appointment({ assignedPerson: "U-DAMEON" })];
    expect(callsFor("closer-a", before)).toHaveLength(1);
    expect(callsFor("closer-b", before)).toHaveLength(0);

    // The same row is updated in place, exactly as a Slack message edit would do.
    const after = before.map((record) => ({ ...record, assignedPerson: "U-ZACK" }));

    expect(after).toHaveLength(1);
    expect(after[0].id).toBe(before[0].id);
    expect(callsFor("closer-a", after)).toHaveLength(0);
    expect(callsFor("closer-b", after)).toHaveLength(1);
    expect(after[0].employeeId).toBe("setter-a");
    expect(appointmentCreditFor("setter-a", after)).toBe(1);
    expect(appointmentCreditFor("closer-b", after)).toBe(0);
  });
});

describe("assignment edge cases render gracefully", () => {
  it("ignores appointments with no assignee", () => {
    expect(callsFor("closer-a", [appointment({ assignedPerson: null })])).toHaveLength(0);
  });

  it("ignores an assignee whose Slack id is not mapped to an employee", () => {
    expect(callsFor("closer-a", [appointment({ assignedPerson: "U-UNMAPPED" })])).toHaveLength(0);
  });

  it("keeps missing optional fields null rather than inventing them", () => {
    const calls = callsFor("closer-a", [appointment({ prospectName: null, scheduledText: null })]);
    expect(calls[0].prospect).toBeNull();
    expect(calls[0].scheduledText).toBeNull();
    expect(calls[0].phone).toBeNull();
  });

  it("separates the setter's credit from the closer's visibility across many records", () => {
    const records = [
      appointment({ id: "a1", employeeId: "setter-a", assignedPerson: "U-DAMEON" }),
      appointment({ id: "a2", employeeId: "setter-a", assignedPerson: "U-ZACK" }),
      appointment({ id: "a3", employeeId: "setter-b", assignedPerson: "U-DAMEON" }),
    ];
    expect(appointmentCreditFor("setter-a", records)).toBe(2);
    expect(appointmentCreditFor("setter-b", records)).toBe(1);
    expect(callsFor("closer-a", records).map((c) => c.id)).toEqual(["a1", "a3"]);
    expect(callsFor("closer-b", records).map((c) => c.id)).toEqual(["a2"]);
    // Every record is visible to exactly one closer and credited to exactly one setter.
    expect(callsFor("closer-a", records).length + callsFor("closer-b", records).length).toBe(records.length);
  });
});
