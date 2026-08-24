/**
 * Official performance targets and qualification rules.
 *
 * These are performance milestones only. Nothing here computes or represents
 * salary, payroll, commission, bonus or any monetary award — those rules are
 * deliberately out of scope and must not be inferred from these thresholds.
 *
 * All targets are MONTHLY and are evaluated against a calendar month, never
 * against the dashboard's ad-hoc reporting range.
 */

/** Revenue milestone ladder for Appointment Setters, ascending. */
export const APPOINTMENT_SETTER_REVENUE_MILESTONES = [1750, 2000, 2500, 3000, 4500, 6000] as const;

/** Monthly qualified-call requirement for Appointment Setters (was 15). */
export const QUALIFIED_CALLS_TARGET = 13;

/** A Closer qualifies on revenue OR closed sales — either alone is enough. */
export const CLOSER_REVENUE_QUALIFICATION = 2000;
export const CLOSER_SALES_QUALIFICATION = 2;

/** Accelerator eligibility requires revenue to EXCEED this value, not equal it. */
export const CLOSER_ACCELERATOR_THRESHOLD = 5000;

/** Monthly lead requirements for Lead Generators (ISAs). */
export const LEAD_GENERATOR_INDIVIDUAL_TARGET = 26;
export const LEAD_GENERATOR_TEAM_TARGET = 450;

export interface MilestoneProgress {
  /** Every milestone with whether the revenue has reached it. */
  milestones: Array<{ value: number; reached: boolean }>;
  /** Highest milestone reached, or null when below the first. */
  currentMilestone: number | null;
  /** Next milestone to aim for, or null once the top one is reached. */
  nextMilestone: number | null;
  /** Fraction of the way to `nextMilestone`, 0-1. Null at the top. */
  progressToNext: number | null;
  reachedCount: number;
  allReached: boolean;
}

/**
 * Where a revenue figure sits on the Appointment Setter milestone ladder.
 * A milestone is reached when revenue is greater than or equal to it.
 */
export function appointmentSetterMilestones(revenue: number): MilestoneProgress {
  const milestones = APPOINTMENT_SETTER_REVENUE_MILESTONES.map((value) => ({ value, reached: revenue >= value }));
  const reached = milestones.filter((milestone) => milestone.reached);
  const next = milestones.find((milestone) => !milestone.reached) ?? null;
  return {
    milestones,
    currentMilestone: reached.length ? reached[reached.length - 1].value : null,
    nextMilestone: next ? next.value : null,
    progressToNext: next ? Math.min(1, Math.max(0, revenue / next.value)) : null,
    reachedCount: reached.length,
    allReached: reached.length === milestones.length,
  };
}

export interface CallsProgress { actual: number; target: number; met: boolean; remaining: number }

/** Qualified calls against the monthly requirement of 13. */
export function qualifiedCallsProgress(actual: number, target = QUALIFIED_CALLS_TARGET): CallsProgress {
  return { actual, target, met: actual >= target, remaining: Math.max(0, target - actual) };
}

export interface CloserQualification {
  revenue: number;
  revenueTarget: number;
  revenueMet: boolean;
  closedSales: number;
  salesTarget: number;
  salesMet: boolean;
  /** True when EITHER condition is satisfied. */
  qualified: boolean;
  requirement: string;
}

/** Closer minimum qualification: $2,000 revenue OR 2 closed sales. */
export function closerQualification(revenue: number, closedSales: number): CloserQualification {
  const revenueMet = revenue >= CLOSER_REVENUE_QUALIFICATION;
  const salesMet = closedSales >= CLOSER_SALES_QUALIFICATION;
  return {
    revenue, revenueTarget: CLOSER_REVENUE_QUALIFICATION, revenueMet,
    closedSales, salesTarget: CLOSER_SALES_QUALIFICATION, salesMet,
    qualified: revenueMet || salesMet,
    requirement: `$${CLOSER_REVENUE_QUALIFICATION.toLocaleString("en-US")} revenue OR ${CLOSER_SALES_QUALIFICATION} closed sales`,
  };
}

export interface AcceleratorEligibility {
  revenue: number;
  threshold: number;
  /** Strictly greater than the threshold; exactly at it does not qualify. */
  eligible: boolean;
  requirement: string;
}

/** Accelerator eligibility indicator only — no accelerator value is computed. */
export function acceleratorEligibility(revenue: number): AcceleratorEligibility {
  return {
    revenue,
    threshold: CLOSER_ACCELERATOR_THRESHOLD,
    eligible: revenue > CLOSER_ACCELERATOR_THRESHOLD,
    requirement: `>$${CLOSER_ACCELERATOR_THRESHOLD.toLocaleString("en-US")} revenue`,
  };
}

export interface LeadGeneratorProgress {
  individual: { actual: number; target: number; met: boolean };
  team: { actual: number; target: number; met: boolean };
}

/** Lead Generator monthly progress: 26 individually, 450 across the team. */
export function leadGeneratorProgress(monthlyLeads: number, monthlyTeamLeads: number): LeadGeneratorProgress {
  return {
    individual: { actual: monthlyLeads, target: LEAD_GENERATOR_INDIVIDUAL_TARGET, met: monthlyLeads >= LEAD_GENERATOR_INDIVIDUAL_TARGET },
    team: { actual: monthlyTeamLeads, target: LEAD_GENERATOR_TEAM_TARGET, met: monthlyTeamLeads >= LEAD_GENERATOR_TEAM_TARGET },
  };
}

export type TargetRole = "APPOINTMENT_SETTER" | "CLOSER" | "LEAD_GENERATOR" | "OTHER";

/** Maps a job title onto the role whose targets apply to it. */
export function targetRoleForTitle(jobTitle: string): TargetRole {
  const title = jobTitle.toLowerCase();
  if (title.includes("closer")) return "CLOSER";
  if (title.includes("appointment setter")) return "APPOINTMENT_SETTER";
  if (title.includes("inside sales") || title.includes("lead gen")) return "LEAD_GENERATOR";
  return "OTHER";
}

/**
 * The calendar month a monthly target is measured over.
 *
 * Monthly targets are never scaled to the dashboard's selected range: viewing
 * "Today" must not compare against a thirtieth of the monthly requirement.
 */
export function targetMonthFor(operationalDate: string) {
  const [year, month] = operationalDate.split("-").map(Number);
  const label = new Date(Date.UTC(year, month - 1, 1)).toLocaleString("en-US", { month: "long", year: "numeric", timeZone: "UTC" });
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  return {
    year, month, label,
    startDate: `${year}-${String(month).padStart(2, "0")}-01`,
    endDate: `${year}-${String(month).padStart(2, "0")}-${String(lastDay).padStart(2, "0")}`,
  };
}
