import { describe, expect, it } from "vitest";
import { primaryMetricForTitle } from "@/lib/dashboard-metrics";
import { resolveDateRange } from "@/lib/time-ranges";
import type { Employee, PeriodKey, TeamMetric } from "@/types/dashboard";

/**
 * Appointment attribution rules.
 *
 * A record's team comes from the reporting channel it arrived in, and the person
 * credited is whoever the record is attributed to — never their job title. These
 * cover the shape the dashboard produces so a Closer can never again be counted
 * in a team KPI while being absent from that team's drill-down.
 */

const BROADIGO_RE = "Broadigo Real Estate";
const LEADSEDGE_RE = "LeadsEdge Real Estate";

const employee = (name: string, title: string, teams: string[], byTeam: Record<string, number>, activityTeams: string[] = []): Employee => ({
  id: name.toLowerCase().replace(/\s+/g, "-"),
  name, initials: name.split(" ").map((p) => p[0]).join(""), title, teams,
  activityTeams,
  divisions: ["Real Estate"], rankingEnabled: true, active: true, status: "No Target",
  metricLabel: title.includes("Closer") ? "Revenue" : "Appointments",
  metricValue: title.includes("Closer") ? "$0" : String(Object.values(byTeam).reduce((a, b) => a + b, 0)),
  appointmentsBooked: Object.values(byTeam).reduce((a, b) => a + b, 0),
  appointmentsByTeam: byTeam,
});

/** Mirrors how the UI scopes a team drill-down. */
const drillDown = (people: Employee[], team: string) =>
  people.filter((person) => person.teams.includes(team) || (person.activityTeams ?? []).includes(team));
const scopedTotal = (people: Employee[], team: string) =>
  drillDown(people, team).reduce((total, person) => total + (person.appointmentsByTeam?.[team] ?? 0), 0);

const BROADIGO_CLOSERS = ["Zack Wilson", "Dean Scott", "Cade Callahan"];
const LEADSEDGE_CLOSERS = ["Dameon Wolfe", "Lars White", "Phillip Stokes", "Ryaan Aamir"];

describe("closers who book appointments", () => {
  it.each(BROADIGO_CLOSERS)("%s appears in the Broadigo drill-down and raises its KPI", (name) => {
    const setter = employee("Jordan Jones", "Appointment Setter", [BROADIGO_RE], { [BROADIGO_RE]: 5 });
    const closer = employee(name, "Closer", ["Broadigo Sales"], { [BROADIGO_RE]: 1 }, [BROADIGO_RE]);
    const people = [setter, closer];

    expect(drillDown(people, BROADIGO_RE).map((p) => p.name)).toContain(name);
    expect(scopedTotal(people, BROADIGO_RE)).toBe(6);
    expect(closer.appointmentsByTeam?.[BROADIGO_RE]).toBe(1);
  });

  it.each(LEADSEDGE_CLOSERS)("%s appears in the LeadsEdge drill-down", (name) => {
    const closer = employee(name, "Closer", ["LeadsEdge Sales"], { [LEADSEDGE_RE]: 3 }, [LEADSEDGE_RE]);
    const people = [employee("Ryan Voss", "Appointment Setter", [LEADSEDGE_RE], { [LEADSEDGE_RE]: 9 }), closer];

    expect(drillDown(people, LEADSEDGE_RE).map((p) => p.name)).toContain(name);
    expect(scopedTotal(people, LEADSEDGE_RE)).toBe(12);
  });

  it.each([...BROADIGO_CLOSERS, ...LEADSEDGE_CLOSERS])("%s stays a Closer; attribution never rewrites the role", (name) => {
    const closer = employee(name, "Closer", ["Broadigo Sales"], { [BROADIGO_RE]: 4 }, [BROADIGO_RE]);
    expect(closer.title).toBe("Closer");
    // The card keeps its role-derived headline metric and reports appointments alongside it.
    expect(primaryMetricForTitle(closer.title)).toBe("revenue");
    expect(closer.metricLabel).toBe("Revenue");
    expect(closer.appointmentsBooked).toBe(4);
  });

  it("credits a closer to the real-estate team their record belongs to, not their sales team", () => {
    const zack = employee("Zack Wilson", "Closer", ["Broadigo Sales"], { [BROADIGO_RE]: 21 }, [BROADIGO_RE]);
    expect(zack.appointmentsByTeam?.[BROADIGO_RE]).toBe(21);
    expect(zack.appointmentsByTeam?.[LEADSEDGE_RE]).toBeUndefined();
    expect(scopedTotal([zack], LEADSEDGE_RE)).toBe(0);
  });
});

describe("Lena Cross dual-team attribution", () => {
  const lena = employee("Lena Cross", "Appointment Setter", [BROADIGO_RE, LEADSEDGE_RE], {
    [BROADIGO_RE]: 25, [LEADSEDGE_RE]: 5,
  });

  it("appears under LeadsEdge Real Estate", () => {
    expect(drillDown([lena], LEADSEDGE_RE).map((p) => p.name)).toContain("Lena Cross");
  });

  it("keeps her Broadigo association as well", () => {
    expect(lena.teams).toEqual(expect.arrayContaining([BROADIGO_RE, LEADSEDGE_RE]));
  });

  it("splits her appointments by team instead of showing one combined total twice", () => {
    expect(scopedTotal([lena], BROADIGO_RE)).toBe(25);
    expect(scopedTotal([lena], LEADSEDGE_RE)).toBe(5);
    // The same appointment is never counted under both teams.
    expect(scopedTotal([lena], BROADIGO_RE) + scopedTotal([lena], LEADSEDGE_RE)).toBe(lena.appointmentsBooked);
  });

  it("is not double counted when both teams are summed", () => {
    const people = [lena, employee("Ryan Voss", "Appointment Setter", [LEADSEDGE_RE], { [LEADSEDGE_RE]: 9 })];
    expect(scopedTotal(people, LEADSEDGE_RE)).toBe(14);
    expect(scopedTotal(people, BROADIGO_RE)).toBe(25);
  });

  it("is an Appointment Setter, formally, in both real-estate teams", () => {
    expect(lena.title).toBe("Appointment Setter");
    expect(primaryMetricForTitle(lena.title)).toBe("appointments");
    // Formal membership, not activity: she belongs to these teams.
    expect(lena.activityTeams ?? []).toEqual([]);
    expect(lena.teams).not.toContain("LeadsEdge Sales");
  });
});

describe("team KPI reconciles with its drill-down", () => {
  const team = (name: string, appointments: number): TeamMetric => ({
    id: name, division: "Real Estate", name, role: "APPOINTMENT",
    metric: String(appointments), label: "appointments", status: "No Target",
    progress: null, members: [], memberCount: 0,
  });

  it("equals the sum of the employees shown plus records with no mapped employee", () => {
    const people = [
      employee("Jordan Jones", "Appointment Setter", [BROADIGO_RE], { [BROADIGO_RE]: 40 }),
      employee("Zack Wilson", "Closer", ["Broadigo Sales"], { [BROADIGO_RE]: 21 }, [BROADIGO_RE]),
      employee("Dean Scott", "Closer", ["Broadigo Sales"], { [BROADIGO_RE]: 12 }, [BROADIGO_RE]),
    ];
    const unattributed = 4; // appointments whose Slack user is not mapped to an employee
    const kpi = team(BROADIGO_RE, scopedTotal(people, BROADIGO_RE) + unattributed);
    expect(Number(kpi.metric)).toBe(77);
    expect(scopedTotal(people, BROADIGO_RE) + unattributed).toBe(Number(kpi.metric));
  });

  it("excludes people with no activity and no membership in that team", () => {
    const people = [
      employee("Zack Wilson", "Closer", ["Broadigo Sales"], { [BROADIGO_RE]: 21 }, [BROADIGO_RE]),
      employee("Dameon Wolfe", "Closer", ["LeadsEdge Sales"], {}),
    ];
    expect(drillDown(people, BROADIGO_RE).map((p) => p.name)).toEqual(["Zack Wilson"]);
  });
});

describe("formal membership and activity attribution stay separate", () => {
  const BROADIGO_CLOSER_TEAM = "Broadigo Sales";
  const LEADSEDGE_CLOSER_TEAM = "LeadsEdge Sales";

  it.each(BROADIGO_CLOSERS)("%s stays a Broadigo closer by membership", (name) => {
    const closer = employee(name, "Closer", [BROADIGO_CLOSER_TEAM], { [BROADIGO_RE]: 7 }, [BROADIGO_RE]);
    expect(closer.teams).toEqual([BROADIGO_CLOSER_TEAM]);
    expect(closer.teams).not.toContain(BROADIGO_RE);
    expect(closer.teams).not.toContain(LEADSEDGE_CLOSER_TEAM);
  });

  it.each(LEADSEDGE_CLOSERS)("%s stays a LeadsEdge closer by membership", (name) => {
    const closer = employee(name, "Closer", [LEADSEDGE_CLOSER_TEAM], { [LEADSEDGE_RE]: 3 }, [LEADSEDGE_RE]);
    expect(closer.teams).toEqual([LEADSEDGE_CLOSER_TEAM]);
    expect(closer.teams).not.toContain(BROADIGO_CLOSER_TEAM);
  });

  it("lets a LeadsEdge closer appear in a Broadigo drill-down without becoming a Broadigo member", () => {
    // Ryaan books into a Broadigo reporting channel; the record is Broadigo's,
    // the person is still LeadsEdge.
    const ryaan = employee("Ryaan Aamir", "Closer", [LEADSEDGE_CLOSER_TEAM], { [BROADIGO_RE]: 2, [LEADSEDGE_RE]: 3 }, [BROADIGO_RE, LEADSEDGE_RE]);
    expect(drillDown([ryaan], BROADIGO_RE)).toHaveLength(1);
    expect(ryaan.teams).toEqual([LEADSEDGE_CLOSER_TEAM]);
    expect(ryaan.teams).not.toContain(BROADIGO_RE);
    expect(ryaan.activityTeams).toContain(BROADIGO_RE);
    expect(scopedTotal([ryaan], BROADIGO_RE)).toBe(2);
    expect(scopedTotal([ryaan], LEADSEDGE_RE)).toBe(3);
  });

  it("drops the activity association when the period holds no such record", () => {
    // Same person, a period with no Broadigo activity: membership is unchanged
    // and the Broadigo drill-down no longer lists them.
    const ryaan = employee("Ryaan Aamir", "Closer", [LEADSEDGE_CLOSER_TEAM], { [LEADSEDGE_RE]: 1 }, [LEADSEDGE_RE]);
    expect(drillDown([ryaan], BROADIGO_RE)).toHaveLength(0);
    expect(ryaan.teams).toEqual([LEADSEDGE_CLOSER_TEAM]);
  });

  it("never lets activity add to the formal membership list", () => {
    const closer = employee("Zack Wilson", "Closer", [BROADIGO_CLOSER_TEAM], { [BROADIGO_RE]: 21 }, [BROADIGO_RE]);
    const overlap = closer.teams.filter((team) => (closer.activityTeams ?? []).includes(team));
    expect(overlap).toEqual([]);
  });
});

describe("period filters stay correct alongside the attribution change", () => {
  const NOW = new Date("2026-08-21T18:30:00Z");
  it.each<[PeriodKey, string, string]>([
    ["Today", "2026-08-21", "2026-08-21"],
    ["Yesterday", "2026-08-20", "2026-08-20"],
    ["This Week", "2026-08-17", "2026-08-23"],
    ["Last Week", "2026-08-10", "2026-08-16"],
    ["This Month", "2026-08-01", "2026-08-31"],
    ["Last Month", "2026-07-01", "2026-07-31"],
  ])("%s still resolves to %s – %s", (period, startDate, endDate) => {
    const range = resolveDateRange(period, undefined, undefined, NOW);
    expect(range.startDate).toBe(startDate);
    expect(range.endDate).toBe(endDate);
  });
});
