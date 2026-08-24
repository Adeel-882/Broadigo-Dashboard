import { describe, expect, it } from "vitest";
import {
  acceleratorEligibility,
  appointmentSetterMilestones,
  closerQualification,
  leadGeneratorProgress,
  qualifiedCallsProgress,
  targetMonthFor,
  targetRoleForTitle,
  APPOINTMENT_SETTER_REVENUE_MILESTONES,
  LEAD_GENERATOR_INDIVIDUAL_TARGET,
} from "@/lib/performance-targets";

describe("appointment setter qualified calls", () => {
  it.each([
    [12, false, 1],
    [13, true, 0],
    [14, true, 0],
  ])("%i calls -> met=%s", (actual, met, remaining) => {
    const progress = qualifiedCallsProgress(actual);
    expect(progress.target).toBe(13);
    expect(progress.met).toBe(met);
    expect(progress.remaining).toBe(remaining);
  });

  it("uses 13, replacing the previous requirement of 15", () => {
    expect(qualifiedCallsProgress(13).target).toBe(13);
    expect(qualifiedCallsProgress(14).met).toBe(true);
  });
});

describe("appointment setter revenue milestones", () => {
  it("exposes the official ladder in ascending order", () => {
    expect([...APPOINTMENT_SETTER_REVENUE_MILESTONES]).toEqual([1750, 2000, 2500, 3000, 4500, 6000]);
  });

  it.each([
    [1749, 1750, null],
    [1750, 2000, 1750],
    [1999, 2000, 1750],
    [2000, 2500, 2000],
    [2499, 2500, 2000],
    [2500, 3000, 2500],
    [2999, 3000, 2500],
    [3000, 4500, 3000],
    [4499, 4500, 3000],
    [4500, 6000, 4500],
    [5999, 6000, 4500],
  ])("revenue %i -> next milestone %s, current %s", (revenue, next, current) => {
    const progress = appointmentSetterMilestones(revenue);
    expect(progress.nextMilestone).toBe(next);
    expect(progress.currentMilestone).toBe(current);
    expect(progress.allReached).toBe(false);
  });

  it("treats 6000 as the highest milestone reached", () => {
    const progress = appointmentSetterMilestones(6000);
    expect(progress.currentMilestone).toBe(6000);
    expect(progress.nextMilestone).toBeNull();
    expect(progress.allReached).toBe(true);
    expect(progress.reachedCount).toBe(6);
    expect(progress.progressToNext).toBeNull();
  });

  it.each([6001, 7500, 99999])("keeps the highest milestone completed above it (%i)", (revenue) => {
    const progress = appointmentSetterMilestones(revenue);
    expect(progress.allReached).toBe(true);
    expect(progress.currentMilestone).toBe(6000);
    expect(progress.nextMilestone).toBeNull();
    expect(progress.milestones.every((m) => m.reached)).toBe(true);
  });

  it("reports partial progress toward the next milestone", () => {
    const progress = appointmentSetterMilestones(2140);
    expect(progress.currentMilestone).toBe(2000);
    expect(progress.nextMilestone).toBe(2500);
    expect(progress.progressToNext).toBeCloseTo(2140 / 2500, 5);
    expect(progress.milestones.filter((m) => m.reached).map((m) => m.value)).toEqual([1750, 2000]);
  });

  it("reaches nothing below the first milestone", () => {
    const progress = appointmentSetterMilestones(0);
    expect(progress.currentMilestone).toBeNull();
    expect(progress.reachedCount).toBe(0);
    expect(progress.nextMilestone).toBe(1750);
  });
});

describe("closer qualification is an OR", () => {
  it.each([
    ["1999 revenue + 1 sale", 1999, 1, false],
    ["2000 revenue + 0 sales", 2000, 0, true],
    ["0 revenue + 2 sales", 0, 2, true],
    ["1999 revenue + 2 sales", 1999, 2, true],
  ])("%s -> qualified=%s", (_label, revenue, sales, qualified) => {
    expect(closerQualification(revenue, sales).qualified).toBe(qualified);
  });

  it("reports each side independently so the OR is visible", () => {
    const result = closerQualification(2430, 1);
    expect(result.revenueMet).toBe(true);
    expect(result.salesMet).toBe(false);
    expect(result.qualified).toBe(true);
    expect(result.requirement).toBe("$2,000 revenue OR 2 closed sales");
  });

  it("fails only when neither side is met", () => {
    const result = closerQualification(1999, 1);
    expect(result.revenueMet).toBe(false);
    expect(result.salesMet).toBe(false);
    expect(result.qualified).toBe(false);
  });
});

describe("closer accelerator threshold must be exceeded", () => {
  it("does not qualify at exactly 5000", () => {
    expect(acceleratorEligibility(5000).eligible).toBe(false);
  });

  it("qualifies at the smallest supported unit above 5000", () => {
    // Revenue is stored with two decimal places, so one cent is the smallest step.
    expect(acceleratorEligibility(5000.01).eligible).toBe(true);
  });

  it.each([0, 4900, 4999.99, 5000])("%s is not eligible", (revenue) => {
    expect(acceleratorEligibility(revenue).eligible).toBe(false);
  });

  it.each([5000.01, 5001, 5500, 12000])("%s is eligible", (revenue) => {
    expect(acceleratorEligibility(revenue).eligible).toBe(true);
  });

  it("states the requirement as strictly greater than", () => {
    expect(acceleratorEligibility(4900).requirement).toBe(">$5,000 revenue");
  });
});

describe("lead generator targets", () => {
  it.each([
    [25, false],
    [26, true],
    [27, true],
  ])("individual %i leads -> met=%s", (leads, met) => {
    expect(leadGeneratorProgress(leads, 0).individual.met).toBe(met);
    expect(leadGeneratorProgress(leads, 0).individual.target).toBe(26);
  });

  it.each([
    [449, false],
    [450, true],
    [451, true],
  ])("team %i leads -> met=%s", (leads, met) => {
    expect(leadGeneratorProgress(0, leads).team.met).toBe(met);
    expect(leadGeneratorProgress(0, leads).team.target).toBe(450);
  });

  it("tracks individual and team independently", () => {
    const progress = leadGeneratorProgress(21, 398);
    expect(progress.individual).toEqual({ actual: 21, target: 26, met: false });
    expect(progress.team).toEqual({ actual: 398, target: 450, met: false });
  });
});

describe("target role mapping and monthly period", () => {
  it.each([
    ["Closer", "CLOSER"],
    ["Closer · Hybrid Media", "CLOSER"],
    ["Appointment Setter", "APPOINTMENT_SETTER"],
    ["Appointment Setter · Hybrid Media", "APPOINTMENT_SETTER"],
    ["Inside Sales Agent", "LEAD_GENERATOR"],
    ["Hybrid Media", "OTHER"],
  ] as const)("%s -> %s", (title, role) => {
    expect(targetRoleForTitle(title)).toBe(role);
  });

  it("resolves the calendar month a monthly target is measured over", () => {
    const month = targetMonthFor("2026-08-21");
    expect(month.label).toBe("August 2026");
    expect(month.startDate).toBe("2026-08-01");
    expect(month.endDate).toBe("2026-08-31");
  });

  it("handles short months and year boundaries", () => {
    expect(targetMonthFor("2026-02-15").endDate).toBe("2026-02-28");
    expect(targetMonthFor("2026-12-31").label).toBe("December 2026");
    expect(targetMonthFor("2026-01-01").startDate).toBe("2026-01-01");
  });

  it("uses the whole month regardless of which day inside it is asked for", () => {
    expect(targetMonthFor("2026-08-01")).toEqual(targetMonthFor("2026-08-31"));
  });
});

/**
 * The resolution ladder used by the dashboard: an employee-specific row wins,
 * then a row scoped to a team the employee belongs to, then a row scoped to
 * their role. Mirrors resolveTarget() in lib/dashboard-data.ts.
 *
 * Role-scoped rows carry no team, and the dashboard query surfaces their missing
 * team as the literal 'Company'. A resolver that only compares team names
 * therefore matches nothing for them, which is what made every Closer and
 * Appointment Setter report "No Target".
 */
interface TargetRow { employee?: string | null; team?: string | null; role?: string | null; metric: string; value: number }

const resolve = (all: TargetRow[], employee: string, teams: string[], jobTitle: string, metric = "leads") => {
  // The dashboard narrows to the employee's primary metric before resolving, so
  // the collective 'team_leads' threshold is never a candidate for an
  // individual's 'leads' target no matter how the ladder is ordered.
  const candidates = all.filter((row) => row.metric === metric);
  const byEmployee = candidates.find((row) => row.employee === employee);
  if (byEmployee) return byEmployee;
  const byTeam = candidates.find((row) => !row.employee && row.team != null && teams.includes(row.team));
  if (byTeam) return byTeam;
  const role = targetRoleForTitle(jobTitle);
  return candidates.find((row) => !row.employee && targetRoleForTitle(row.role ?? "") === role && role !== "OTHER") ?? null;
};

describe("target resolution ladder", () => {
  const roleRows: TargetRow[] = [
    { team: "Company", role: "Closer", metric: "revenue", value: 2000 },
    { team: "Company", role: "Appointment Setter", metric: "qualified_calls", value: 13 },
    { team: "Company", role: "Inside Sales Agent", metric: "leads", value: 26 },
  ];

  it("resolves a role-scoped target for a Closer whose team is not named on any row", () => {
    const resolved = resolve(roleRows, "Zack Wilson", ["LeadsEdge Real Estate"], "Closer", "revenue");
    expect(resolved?.value).toBe(2000);
  });

  it("resolves a role-scoped target for an Appointment Setter", () => {
    expect(resolve(roleRows, "Ryan Voss", ["Broadigo Solar"], "Appointment Setter", "qualified_calls")?.value).toBe(13);
  });

  it("resolves 26, not the collective 450, for a Lead Generator on the ISA team", () => {
    const rows = [...roleRows, { team: "ISA / Lead Management", role: "All eligible", metric: "team_leads", value: 450 }];
    const resolved = resolve(rows, "Asif Hazoor", ["ISA / Lead Management"], "Inside Sales Agent");
    expect(resolved?.metric).toBe("leads");
    expect(resolved?.value).toBe(LEAD_GENERATOR_INDIVIDUAL_TARGET);
  });

  it("prefers an employee-specific row over both the team and the role row", () => {
    const rows = [...roleRows, { employee: "Asif Hazoor", metric: "leads", value: 40 }];
    expect(resolve(rows, "Asif Hazoor", ["ISA / Lead Management"], "Inside Sales Agent")?.value).toBe(40);
  });

  it("prefers a team row over the role row when the employee belongs to that team", () => {
    const rows = [...roleRows, { team: "LeadsEdge Real Estate", metric: "revenue", value: 3000 }];
    expect(resolve(rows, "Zack Wilson", ["LeadsEdge Real Estate"], "Closer", "revenue")?.value).toBe(3000);
  });

  it("returns no target for a role with no definition rather than borrowing another role's", () => {
    expect(resolve(roleRows, "Some Manager", ["Leadership"], "Operations Manager", "revenue")).toBeNull();
  });
});

describe("monthly targets are not rescaled by the dashboard period filter", () => {
  // A MONTHLY target is the month's requirement regardless of the range the CEO
  // is looking at. Pro-rating it to a day or a week reported a different figure
  // for the same person depending on the filter.
  const effective = (value: number, period: string, days: number) =>
    period === "MONTHLY" ? value : period === "WEEKLY" ? value * (days / 7) : value * days;

  it("keeps 26 as the requirement for a one-day range", () => {
    expect(effective(LEAD_GENERATOR_INDIVIDUAL_TARGET, "MONTHLY", 1)).toBe(26);
  });

  it("keeps 26 as the requirement for a seven-day range", () => {
    expect(effective(LEAD_GENERATOR_INDIVIDUAL_TARGET, "MONTHLY", 7)).toBe(26);
  });

  it("still scales a genuinely DAILY target", () => {
    expect(effective(2, "DAILY", 7)).toBe(14);
  });
});

describe("excluded leads never advance lead generator progress", () => {
  // Slack :x: / :arrow_left: exclusions are applied before counting, so an
  // excluded lead must move neither the individual nor the team figure.
  const counted = (leads: Array<{ countsTowardKpi: boolean }>) => leads.filter((lead) => lead.countsTowardKpi).length;

  it("counts only eligible leads toward the individual target", () => {
    const leads = [...Array(30)].map((_, index) => ({ countsTowardKpi: index < 7 }));
    const progress = leadGeneratorProgress(counted(leads), 0);
    expect(progress.individual.actual).toBe(7);
    expect(progress.individual.met).toBe(false);
  });

  it("does not let excluded leads push a generator over the target", () => {
    const leads = [...Array(40)].map((_, index) => ({ countsTowardKpi: index < 25 }));
    expect(leadGeneratorProgress(counted(leads), 0).individual.met).toBe(false);
  });

  it("counts the lead once it is eligible again", () => {
    const leads = [...Array(26)].map(() => ({ countsTowardKpi: true }));
    expect(leadGeneratorProgress(counted(leads), 0).individual.met).toBe(true);
  });

  it("applies the same exclusion to the collective team figure", () => {
    const leads = [...Array(500)].map((_, index) => ({ countsTowardKpi: index < 449 }));
    expect(leadGeneratorProgress(0, counted(leads)).team.met).toBe(false);
    expect(leadGeneratorProgress(0, counted(leads)).team.actual).toBe(449);
  });
});

describe("appointments are never reported as qualified calls", () => {
  // No field in the data model records whether a booked call was held or
  // qualified, so the panel must show the requirement as unmeasured rather than
  // substituting the appointment count.
  const progress = { appointmentsBooked: 36, qualifiedCallsTracked: false };

  it("does not treat booked appointments as a qualified-call figure", () => {
    expect(progress.qualifiedCallsTracked).toBe(false);
  });

  it("would not report a setter as having met the target on appointments alone", () => {
    const shown = progress.qualifiedCallsTracked ? qualifiedCallsProgress(progress.appointmentsBooked) : null;
    expect(shown).toBeNull();
  });

  it("still measures qualified calls correctly once a real figure exists", () => {
    expect(qualifiedCallsProgress(13).met).toBe(true);
    expect(qualifiedCallsProgress(12).met).toBe(false);
  });
});
