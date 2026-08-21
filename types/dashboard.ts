export type MetricKind = "appointments" | "sales" | "revenue" | "leads" | "work" | "docks";
export type Status = "Ahead" | "On Track" | "At Risk" | "Behind" | "No Target";
export type ViewKey = "overview" | "divisions" | "teams" | "employees" | "docks" | "targets" | "health" | "setup";
export type PeriodKey = "Today" | "Yesterday" | "This Week" | "Last Week" | "This Month" | "Last Month" | "Custom Range";

export interface Employee {
  id: string;
  name: string;
  initials: string;
  title: string;
  teams: string[];
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
}

export interface MetricCard { label: string; value: string; delta: number | null; note: string; kind: MetricKind; submitted?: number; excluded?: number; }
export interface DivisionMetric { name: string; eyebrow: string; outputs: { label: string; value: string; kind: MetricKind }[]; accent: string; }
export interface TeamMetric { id: string; division: string; name: string; role: string; metric: string; label: string; status: Status; progress: number | null; members: string[]; memberCount: number; }
export interface DockRecord { id: string; employeeId: string; employee: string; date: string; amount: string; currency: string; reason: string; appliedBy: string; activity: Activity; }
export interface TargetRecord { id: string; team: string; role: string; metric: string; period: string; value: string; employee: string | null; effectiveFrom: string; effectiveTo: string | null; }
export interface TrendPoint { day: string; value: number; }
export interface ChannelHealth { id: string; name: string; slackChannelId: string; workspaceId: string; active: boolean; lastEventAt: string | null; }
export interface EmployeeDetailData { employeeId: string; metricLabel: string; trend: TrendPoint[]; activities: Activity[]; }

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
