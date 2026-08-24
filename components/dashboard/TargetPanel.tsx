"use client";

import { AlertTriangle, Check, Circle, Target } from "lucide-react";
import type { Employee, TargetProgress } from "@/types/dashboard";
import {
  acceleratorEligibility,
  appointmentSetterMilestones,
  closerQualification,
  APPOINTMENT_SETTER_REVENUE_MILESTONES,
  leadGeneratorProgress,
  QUALIFIED_CALLS_TARGET,
  qualifiedCallsProgress,
} from "@/lib/performance-targets";

const money = (value: number) => new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(value);

/**
 * Monthly performance targets for the employee's role.
 *
 * These are performance milestones and qualification indicators only. No salary,
 * payroll, commission or bonus figure is derived or displayed. Progress is always
 * measured over the full calendar month named in the header, never over the
 * dashboard's selected reporting range.
 */
export function TargetPanel({ employee, progress }: { employee: Employee; progress: TargetProgress }) {
  if (progress.role === "OTHER") return null;

  return <section className="target-panel">
    <div className="profile-section-title">
      <div><p className="eyebrow">{progress.monthLabel} targets</p><h3>Performance targets</h3></div>
      <Target size={17}/>
    </div>
    {progress.role === "APPOINTMENT_SETTER" && <SetterTargets progress={progress}/>}
    {progress.role === "CLOSER" && <CloserTargets progress={progress}/>}
    {progress.role === "LEAD_GENERATOR" && <LeadTargets progress={progress}/>}
    <p className="target-footnote">Monthly targets for {employee.title}. Progress covers {progress.monthStart} – {progress.monthEnd}.</p>
  </section>;
}

function SetterTargets({ progress }: { progress: TargetProgress }) {
  const ladder = appointmentSetterMilestones(progress.revenue);
  // Both official Appointment Setter targets depend on inputs the data model
  // does not record, so each is shown as unmeasured rather than as a zero the
  // setter could be judged on.
  const revenueTracked = progress.revenueAttributedToRole;
  // Qualified calls are only rendered as a meter when a real qualified-call
  // disposition exists. Booked appointments are a different quantity and are
  // never substituted for it.
  const calls = progress.qualifiedCallsTracked ? qualifiedCallsProgress(progress.appointmentsBooked) : null;
  return <>
    <p className="target-label">Revenue milestones</p>
    {!revenueTracked && <div className="target-unavailable">
      <AlertTriangle size={15}/>
      <div>
        <strong>Not measurable yet — ladder starts at {money(APPOINTMENT_SETTER_REVENUE_MILESTONES[0])}</strong>
        <p>Revenue is recorded against the closer who closed the sale, and no field links a sale back to the appointment that produced it. No revenue reaches this role, so the ladder below stays unreached for reasons outside this person&rsquo;s control.</p>
      </div>
    </div>}
    {revenueTracked && <div className="target-figure"><span>Revenue</span><strong>{money(progress.revenue)}</strong></div>}
    <ul className="milestone-list">
      {ladder.milestones.map((milestone) => <li key={milestone.value} className={milestone.reached ? "reached" : ""}>
        {milestone.reached ? <Check size={13}/> : <Circle size={13}/>}
        <span>{money(milestone.value)}</span>
      </li>)}
    </ul>
    {ladder.nextMilestone === null
      ? <p className="target-note">Highest milestone reached.</p>
      : !revenueTracked ? null : <>
        <div className="target-figure compact"><span>Next milestone</span><strong>{money(ladder.nextMilestone)}</strong></div>
        <p className="target-label">Progress to next milestone</p>
        <Meter value={progress.revenue} target={ladder.nextMilestone} display={`${money(progress.revenue)} / ${money(ladder.nextMilestone)}`}/>
      </>}
    <p className="target-label">Qualified calls</p>
    {calls
      ? <Meter value={calls.actual} target={calls.target} display={`${calls.actual} / ${calls.target}`} met={calls.met}/>
      : <div className="target-unavailable">
          <AlertTriangle size={15}/>
          <div>
            <strong>Not measurable yet — {QUALIFIED_CALLS_TARGET} required</strong>
            <p>Slack records when a call is booked, but never whether it was held or qualified. Booked appointments are shown below instead; they are not the same measure and are not counted toward this target.</p>
          </div>
        </div>}
    <div className="target-figure compact"><span>Appointments booked</span><strong>{progress.appointmentsBooked}</strong></div>
  </>;
}

function CloserTargets({ progress }: { progress: TargetProgress }) {
  const qualification = closerQualification(progress.revenue, progress.closedSales);
  const accelerator = acceleratorEligibility(progress.revenue);
  return <>
    <p className="target-label">Performance qualification</p>
    <div className="qualification-grid">
      <div className={qualification.revenueMet ? "met" : ""}>
        <span>Revenue</span>
        <strong>{money(qualification.revenue)} / {money(qualification.revenueTarget)}</strong>
        {qualification.revenueMet && <Check size={14}/>}
      </div>
      <div className="qualification-or">OR</div>
      <div className={qualification.salesMet ? "met" : ""}>
        <span>Closed sales</span>
        <strong>{qualification.closedSales} / {qualification.salesTarget}</strong>
        {qualification.salesMet && <Check size={14}/>}
      </div>
    </div>
    <div className="target-figure compact">
      <span>Status</span>
      <strong className={qualification.qualified ? "qualified" : "not-qualified"}>{qualification.qualified ? "QUALIFIED" : "NOT QUALIFIED"}</strong>
    </div>
    <p className="target-note">Requirement: {qualification.requirement}</p>
    <p className="target-label">Accelerator eligibility</p>
    <div className="target-figure compact">
      <span>{money(accelerator.revenue)} / {accelerator.requirement}</span>
      <strong className={accelerator.eligible ? "qualified" : "not-qualified"}>{accelerator.eligible ? "Qualified" : "Not qualified"}</strong>
    </div>
    <p className="target-note">Revenue must exceed {money(accelerator.threshold)}; exactly {money(accelerator.threshold)} does not qualify.</p>
  </>;
}

function LeadTargets({ progress }: { progress: TargetProgress }) {
  const leads = leadGeneratorProgress(progress.monthlyLeads, progress.monthlyTeamLeads);
  return <>
    <p className="target-label">Individual leads</p>
    <Meter value={leads.individual.actual} target={leads.individual.target} display={`${leads.individual.actual} / ${leads.individual.target}`} met={leads.individual.met}/>
    <p className="target-label">Team leads</p>
    <Meter value={leads.team.actual} target={leads.team.target} display={`${leads.team.actual} / ${leads.team.target}`} met={leads.team.met}/>
  </>;
}

function Meter({ value, target, display, met }: { value: number; target: number; display: string; met?: boolean }) {
  const percent = target > 0 ? Math.min(100, Math.round((value / target) * 100)) : 0;
  const reached = met ?? value >= target;
  return <div className="target-meter">
    <div><strong>{display}</strong><em className={reached ? "qualified" : ""}>{percent}%</em></div>
    <i><span style={{ width: `${percent}%` }} className={reached ? "reached" : ""}/></i>
  </div>;
}
