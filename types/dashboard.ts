export type MetricKind = "appointments" | "sales" | "revenue" | "leads" | "work" | "docks";
/**
 * "No Target" means no target definition applies to this person. "Not Measured"
 * means one does, but the data model captures no input for it — the two must stay
 * distinct so an unmeasurable target is never read as an unset one.
 */
export type Status = "Ahead" | "On Track" | "At Risk" | "Behind" | "No Target" | "Not Measured";
export type ViewKey = "overview" | "divisions" | "teams" | "employees" | "docks" | "targets" | "health" | "setup";
export type PeriodKey = "Today" | "Yesterday" | "This Week" | "Last Week" | "This Month" | "Last Month" | "Custom Range";

export interface Employee {
  id: string;
  name: string;
  initials: string;
  title: string;
  /** Formal org membership. Activity never adds to this. */
  teams: string[];
  /** Teams this person has record-level activity in for the period, but is not a
   *  member of. Drives drill-down visibility only. */
  activityTeams?: string[];
  divisions: string[];
  aliases?: string[];
  leadership?: "CEO" | "COO" | "CTO";
  rankingEnabled: boolean;
  status: Status;
  completion?: number;
  metricLabel: string;
  metricValue: string;
  trend?: number;
  metricValueNumber?: number;
  active?: boolean;
  /** Lead Management only: total Slack submissions behind the counted KPI value. */
  submittedLeads?: number;
  excludedLeads?: number;
  /** Appointments this person personally booked in the period, whatever their role. */
  appointmentsBooked?: number;
  /** The same count split by the team each appointment was attributed to, so a
   *  person active in two teams is never shown their combined total under one. */
  appointmentsByTeam?: Record<string, number>;
}

export interface MetricCard { label: string; value: string; delta: number | null; note: string; kind: MetricKind; submitted?: number; excluded?: number; }
export interface DivisionMetric { name: string; eyebrow: string; outputs: { label: string; value: string; kind: MetricKind }[]; accent: string; }
export interface TeamMetric { id: string; division: string; name: string; role: string; metric: string; label: string; status: Status; progress: number | null; members: string[]; memberCount: number; }
export interface DockRecord { id: string; employeeId: string; employee: string; date: string; amount: string; currency: string; reason: string; appliedBy: string; activity: Activity; }
export interface TargetRecord { id: string; team: string; role: string; metric: string; period: string; value: string; employee: string | null; effectiveFrom: string; effectiveTo: string | null; }
export interface TrendPoint { day: string; value: number; }
export interface ChannelHealth { id: string; name: string; slackChannelId: string; workspaceId: string; active: boolean; lastEventAt: string | null; }
/** One appointment a setter booked and assigned to this employee to conduct. */
export interface AssignedCall {
  id: string;
  prospect: string | null;
  /** Free text exactly as the setter wrote it, e.g. "tomorrow 10:00 AM EST". */
  scheduledText: string | null;
  /** Canonical instant resolved from the Slack scheduling phrase when possible. */
  scheduledAt: string | null;
  /** When the appointment was reported in Slack. */
  loggedAt: string;
  setter: string | null;
  assignedTo: string;
  phone: string | null;
  state: string | null;
  timezone: string | null;
  team: string | null;
  division: string | null;
  channel: string;
  sourceUrl: string;
  raw: string;
}

export interface TargetProgress {
  role: "APPOINTMENT_SETTER" | "CLOSER" | "LEAD_GENERATOR" | "OTHER";
  periodLabel: string;
  periodStart: string;
  periodEnd: string;
  revenue: number;
  closedSales: number;
  /**
   * Appointments this employee booked during the month. This is NOT a
   * qualified-call count: nothing in the data model records whether a booked
   * call was held or qualified, so the two must never be equated.
   */
  appointmentsBooked: number;
  qualifiedCalls: number;
  qualifiedCallsTracked: boolean;
  /**
   * Whether this employee's job title ever receives revenue attribution at all.
   * Sales rows carry the closer's employee_id and nothing links a sale back to
   * the appointment that produced it, so a setter's revenue is structurally zero
   * rather than merely zero this month.
   */
  revenueAttributedToRole: boolean;
  leads: number;
  teamLeads: number;
}

export interface EmployeeDetailData {
  employeeId: string;
  metricLabel: string;
  trend: TrendPoint[];
  activities: Activity[];
  assignedCalls?: AssignedCall[];
  targetProgress?: TargetProgress;
}

export interface DashboardData {
  mode: "live" | "demo" | "disconnected";
  timezone: "Asia/Karachi";
  period: PeriodKey;
  range: { start: string; end: string; startDate: string; endDate: string; label: string };
  generatedAt: string;
  metrics: MetricCard[];
  divisions: DivisionMetric[];
  teams: TeamMetric[];
  employees: Employee[];
  activities: Activity[];
  docks: DockRecord[];
  targets: TargetRecord[];
  trend: TrendPoint[];
  health: { raw: number; parsed: number; unparsed: number; errors: number; unmatchedMessages: number; unmappedEmployees: number; unattributedDocks: number; lastEventAt: string | null; newestMessageAt: string | null; lastSyncAt: string | null; channels: ChannelHealth[] };
}

export interface Activity {
  id: string;
  employeeId: string;
  employee: string;
  type: "Appointment" | "Sale" | "Lead" | "Work update" | "Dock";
  summary: string;
  detail: string;
  channel: string;
  timestamp: string;
  raw: string;
  /** Leads only: whether this record counts toward Lead Management KPIs. */
  countsTowardKpi?: boolean;
  exclusionLabel?: string;
}
