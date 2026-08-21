import "server-only";
import { sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { primaryMetricForTitle } from "@/lib/dashboard-metrics";
import { occurredAt, operationalDateSql, operationalShiftFilter } from "@/lib/operational-query";
import { leadExclusionLabel, type LeadExclusionReason } from "@/lib/slack/reactions";
import { resolveDateRange } from "@/lib/time-ranges";
import type { Activity, DashboardData, Employee, EmployeeDetailData, PeriodKey, Status } from "@/types/dashboard";

type Row = Record<string, unknown>;
const num = (value: unknown) => Number(value ?? 0);
const text = (value: unknown) => String(value ?? "");
const initials = (name: string) => name.split(/\s+/).map((part) => part[0]).slice(0, 2).join("").toUpperCase();
const delta = (current: number, previous: number) => previous ? Math.round(((current - previous) / previous) * 1000) / 10 : current ? 100 : null;
const money = (value: number, currency = "USD") => new Intl.NumberFormat("en-US", { style: "currency", currency, maximumFractionDigits: 0 }).format(value);
const statusFrom = (completion: number | null): Status => completion == null ? "No Target" : completion >= 105 ? "Ahead" : completion >= 90 ? "On Track" : completion >= 75 ? "At Risk" : "Behind";
const rows = (value: unknown) => value as Row[];
function targetScale(period:unknown,days:number){return text(period)==="DAILY"?days:text(period)==="WEEKLY"?days/7:days/(365.2425/12)}
const formatTimestamp = (value: unknown) => new Intl.DateTimeFormat("en-PK", { timeZone: "Asia/Karachi", dateStyle: "medium", timeStyle: "short" }).format(new Date(text(value)));
const activityFromRow = (r: Row): Activity => {
  const countsTowardKpi = r.counts_toward_kpi !== false;
  const reasons = (Array.isArray(r.exclusion_reasons) ? r.exclusion_reasons : []) as LeadExclusionReason[];
  return { id: text(r.id), employeeId: text(r.employee_id), employee: text(r.employee), type: text(r.type) as Activity["type"], summary: text(r.summary), detail: text(r.detail), channel: text(r.channel), timestamp: formatTimestamp(r.occurred_at), raw: text(r.raw), countsTowardKpi, exclusionLabel: countsTowardKpi ? "Counted" : leadExclusionLabel(reasons) };
};
const dashboardRange = (range: ReturnType<typeof resolveDateRange>) => ({
  start: range.start.toISOString(), end: range.end.toISOString(),
  previousStart: range.previousStart.toISOString(), previousEnd: range.previousEnd.toISOString(),
});
const serializedRange = (range: ReturnType<typeof resolveDateRange>) => ({ start: range.start.toISOString(), end: range.end.toISOString(), startDate: range.startDate, endDate: range.endDate, label: range.label });
/**
 * A lead contributes to Lead Management KPIs only when the ISA owned it on the
 * operational date AND management has not excluded it with an :x: / :arrow_left:
 * Slack reaction. Excluded leads stay visible as evidence; they just stop counting.
 */
const countedIsaLead = (employeeColumn: string, occurredAtColumn: string, kpiColumn = "l.counts_toward_kpi") =>
  sql`${occurredAt(kpiColumn)} and ${isaLeadMembership(employeeColumn, occurredAtColumn)}`;
const isaLeadMembership = (employeeColumn: string, occurredAtColumn: string) => sql`exists (
  select 1 from employee_team_memberships isa_membership
  join teams isa_team on isa_team.id=isa_membership.team_id
  where isa_membership.employee_id=${occurredAt(employeeColumn)}
    and isa_team.slug='isa-lead-management'
    and (isa_membership.start_date is null or isa_membership.start_date<=${operationalDateSql(occurredAt(occurredAtColumn))})
    and (isa_membership.end_date is null or isa_membership.end_date>=${operationalDateSql(occurredAt(occurredAtColumn))})
)`;

function emptyData(period: PeriodKey, range: ReturnType<typeof resolveDateRange>): DashboardData {
  return { mode: "disconnected", timezone: "Asia/Karachi", period, range: serializedRange(range), generatedAt: new Date().toISOString(), metrics: [], divisions: [], teams: [], employees: [], activities: [], docks: [], targets: [], trend: [], health: { raw: 0, parsed: 0, unparsed: 0, errors: 0, unmatchedMessages: 0, unmappedEmployees: 0, unattributedDocks: 0, lastEventAt: null, newestMessageAt: null, lastSyncAt: null, channels: [] } };
}

async function demoData(period: PeriodKey, range: ReturnType<typeof resolveDateRange>): Promise<DashboardData> {
  const demo = await import("@/lib/demo-data");
  return { mode: "demo", timezone: "Asia/Karachi", period, range: serializedRange(range), generatedAt: new Date().toISOString(),
    metrics: [{ label: "Appointments", value: "184", delta: 12.4, note: "vs previous period", kind: "appointments" }, { label: "Sales", value: "38", delta: 8.6, note: "reported sales", kind: "sales" }, { label: "Revenue", value: "$86,400", delta: 8.6, note: "reported revenue", kind: "revenue" }, { label: "Leads", value: "73", delta: 6.1, note: "qualified leads", kind: "leads" }, { label: "Docks", value: "4", delta: null, note: "disciplinary records", kind: "docks" }, { label: "Media activity", value: "12", delta: null, note: "work updates", kind: "work" }],
    divisions: demo.divisions.map((division) => ({ name: division.name, eyebrow: division.eyebrow, accent: division.accent, outputs: [{ label: division.label, value: division.value, kind: "work" as const }] })), teams: [], employees: demo.employees.map((employee) => ({ ...employee, active: true })), activities: demo.activities, docks: [], targets: [], trend: demo.trendData.map(({ day, appointments }) => ({ day, value: appointments })),
    health: { raw: 5, parsed: 5, unparsed: 0, errors: 0, unmatchedMessages: 0, unmappedEmployees: 0, unattributedDocks: 0, lastEventAt: new Date().toISOString(), newestMessageAt: new Date().toISOString(), lastSyncAt: new Date().toISOString(), channels: [] } };
}

export async function getDashboardData(period: PeriodKey = "This Week", customStart?: string, customEnd?: string): Promise<DashboardData> {
  const range = resolveDateRange(period, customStart, customEnd);
  if (process.env.DEMO_DATA_ENABLED === "true" && process.env.NODE_ENV !== "production") return demoData(period, range);
  const db = getDb(); if (!db) return emptyData(period, range);
  const {start,end,previousStart,previousEnd}=dashboardRange(range);
  const current=(column:string)=>operationalShiftFilter(occurredAt(column),start,end);
  const previous=(column:string)=>operationalShiftFilter(occurredAt(column),previousStart,previousEnd);
  const [summaryResult, peopleResult, outputResult, teamResult, targetResult, trendResult, activityResult, dockResult, healthResult, channelResult] = await Promise.all([
    db.execute(sql`select
      (select count(*) from appointments where ${current("occurred_at")})::int appointments,
      (select count(*) from appointments where ${previous("occurred_at")})::int appointments_prev,
      (select count(*) from sales where ${current("occurred_at")})::int sales,
      (select count(*) from sales where ${previous("occurred_at")})::int sales_prev,
      (select coalesce(sum(amount),0) from sales where ${current("occurred_at")}) revenue,
      (select coalesce(sum(amount),0) from sales where ${previous("occurred_at")}) revenue_prev,
      (select count(*) from leads l where ${current("l.occurred_at")} and ${countedIsaLead("l.employee_id", "l.occurred_at")})::int leads,
      (select count(*) from leads l where ${previous("l.occurred_at")} and ${countedIsaLead("l.employee_id", "l.occurred_at")})::int leads_prev,
      (select count(*) from leads l where ${current("l.occurred_at")} and ${isaLeadMembership("l.employee_id", "l.occurred_at")})::int leads_submitted,
      (select count(*) from docks where ${current("occurred_at")})::int docks,
      (select count(*) from docks where ${previous("occurred_at")})::int docks_prev,
      (select count(*) from media_activity where ${current("occurred_at")})::int media,
      (select count(*) from media_activity where ${previous("occurred_at")})::int media_prev`),
    db.execute(sql`select e.id, e.canonical_name, e.job_title, e.leadership_level, e.active,
      coalesce(array_agg(distinct t.name) filter (where t.name is not null), '{}') teams,
      coalesce(array_agg(distinct d.name) filter (where d.name is not null), '{}') divisions,
      coalesce(array_agg(distinct a.alias) filter (where a.alias is not null), '{}') aliases,
      coalesce(bool_or(m.ranking_enabled), false) ranking_enabled
      from employees e left join employee_team_memberships m on m.employee_id=e.id left join teams t on t.id=m.team_id left join divisions d on d.id=t.division_id left join employee_aliases a on a.employee_id=e.id
      group by e.id order by e.active desc, e.canonical_name`),
    db.execute(sql`select employee_id, metric, sum(current_value)::numeric current_value, sum(previous_value)::numeric previous_value from (
      select employee_id, 'appointments' metric, count(*) filter(where ${current("occurred_at")}) current_value, count(*) filter(where ${previous("occurred_at")}) previous_value from appointments group by employee_id
      union all select employee_id, 'revenue', coalesce(sum(amount) filter(where ${current("occurred_at")}),0), coalesce(sum(amount) filter(where ${previous("occurred_at")}),0) from sales group by employee_id
      union all select l.employee_id, 'leads', count(*) filter(where ${current("l.occurred_at")} and ${countedIsaLead("l.employee_id", "l.occurred_at")}), count(*) filter(where ${previous("l.occurred_at")} and ${countedIsaLead("l.employee_id", "l.occurred_at")}) from leads l group by l.employee_id
      union all select l.employee_id, 'leads_submitted', count(*) filter(where ${current("l.occurred_at")} and ${isaLeadMembership("l.employee_id", "l.occurred_at")}), 0 from leads l group by l.employee_id
      union all select employee_id, 'work', count(*) filter(where ${current("occurred_at")}), count(*) filter(where ${previous("occurred_at")}) from media_activity group by employee_id
    ) o where employee_id is not null group by employee_id, metric`),
    db.execute(sql`select t.id, t.name, t.type, d.name division, count(distinct m.employee_id)::int member_count,
      coalesce(array_agg(distinct e.canonical_name) filter(where e.canonical_name is not null), '{}') members,
      coalesce((select count(*) from appointments a where a.team_id=t.id and ${current("a.occurred_at")}),0)::numeric appointments,
      coalesce((select sum(s.amount) from sales s where s.team_id=t.id and ${current("s.occurred_at")}),0)::numeric revenue,
      coalesce((select count(*) from leads l where l.team_id=t.id and ${current("l.occurred_at")} and ${countedIsaLead("l.employee_id", "l.occurred_at")}),0)::numeric leads,
      coalesce((select count(*) from media_activity ma where ma.team_id=t.id and ${current("ma.occurred_at")}),0)::numeric work
      from teams t join divisions d on d.id=t.division_id left join employee_team_memberships m on m.team_id=t.id left join employees e on e.id=m.employee_id group by t.id,d.name order by d.name,t.name`),
    db.execute(sql`select tg.id, coalesce(t.name,'Company') team, coalesce(tg.role,'All eligible') role, tg.metric, tg.period, tg.value, tg.effective_from, tg.effective_to, e.canonical_name employee from targets tg left join teams t on t.id=tg.team_id left join employees e on e.id=tg.employee_id where tg.active=true and tg.effective_from<=${range.endDate} and (tg.effective_to is null or tg.effective_to>=${range.startDate}) order by team, metric`),
    db.execute(sql`select to_char(${operationalDateSql(occurredAt("occurred_at"))}, 'Mon DD') as "day", count(*)::int appointments from appointments where ${current("occurred_at")} group by ${operationalDateSql(occurredAt("occurred_at"))} order by ${operationalDateSql(occurredAt("occurred_at"))}`),
    db.execute(sql`select * from (
      select a.id, a.employee_id, coalesce(e.canonical_name,'Unmapped') employee, 'Appointment' type, coalesce(a.prospect_name,'Appointment reported') summary, coalesce(a.state,'') detail, c.name channel, a.occurred_at, sm.raw_text raw, true counts_toward_kpi, '[]'::jsonb exclusion_reasons from appointments a join slack_messages sm on sm.id=a.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=a.employee_id where ${current("a.occurred_at")}
      union all select s.id,s.employee_id,coalesce(e.canonical_name,'Unmapped'),'Sale',coalesce(s.customer_name,'Sale reported'),concat(coalesce(s.currency,'USD'),' ',coalesce(s.amount,0)),c.name,s.occurred_at,sm.raw_text,true,'[]'::jsonb from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=s.employee_id where ${current("s.occurred_at")}
      union all select l.id,l.employee_id,coalesce(e.canonical_name,'Unmapped'),'Lead',coalesce(l.contact_name,'Lead reported'),coalesce(l.lead_type,''),c.name,l.occurred_at,sm.raw_text,l.counts_toward_kpi,l.exclusion_reasons from leads l join slack_messages sm on sm.id=l.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=l.employee_id where ${current("l.occurred_at")}
      union all select ma.id,ma.employee_id,coalesce(e.canonical_name,'Unmapped'),'Work update',ma.summary,ma.classification,c.name,ma.occurred_at,sm.raw_text,true,'[]'::jsonb from media_activity ma join slack_messages sm on sm.id=ma.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=ma.employee_id where ${current("ma.occurred_at")}
      union all select dk.id,dk.employee_id,coalesce(e.canonical_name,'Unmapped'),'Dock',dk.reason,concat(dk.currency,' ',dk.amount),c.name,dk.occurred_at,sm.raw_text,true,'[]'::jsonb from docks dk join slack_messages sm on sm.id=dk.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=dk.employee_id where ${current("dk.occurred_at")}
    ) r order by occurred_at desc limit 100`),
    db.execute(sql`select dk.id, dk.employee_id, coalesce(e.canonical_name,'Unmapped') employee, to_char(${operationalDateSql(occurredAt("dk.occurred_at"))},'YYYY-MM-DD') date, dk.occurred_at, dk.amount, dk.currency, dk.reason, coalesce(dk.applied_by,'—') applied_by, c.name channel, sm.raw_text raw from docks dk join slack_messages sm on sm.id=dk.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=dk.employee_id where ${current("dk.occurred_at")} order by dk.occurred_at desc`),
    db.execute(sql`select
      count(*)::int raw,
      count(*) filter(where parser_status='PARSED')::int parsed, count(*) filter(where parser_status='UNPARSED')::int unparsed, count(*) filter(where parser_status='ERROR')::int errors,
      count(*) filter(where employee_id is null and slack_user_id is not null)::int unmatched_messages,
      count(distinct slack_user_id) filter(where employee_id is null and slack_user_id is not null)::int unmapped,
      max(imported_at) last_event_at, max(posted_at) newest_message_at,
      (select count(*) from docks where employee_id is null)::int unattributed_docks,
      (select max(completed_at) from sync_runs where status='COMPLETED') last_sync_at from slack_messages`),
    db.execute(sql`select c.id,c.name,c.slack_channel_id,c.workspace_id,c.active,max(sm.imported_at) last_event_at from slack_channels c left join slack_messages sm on sm.channel_id=c.id group by c.id order by c.name`),
  ]);
  const summary = rows(summaryResult)[0] ?? {}; const outputs = rows(outputResult); const outputByEmployeeMetric = new Map(outputs.map((r) => [`${text(r.employee_id)}:${text(r.metric)}`, r])); const targetRows=rows(targetResult); const days=range.dayCount;
  const people: Employee[] = rows(peopleResult).map((r) => { const metric=primaryMetricForTitle(text(r.job_title)); const output = outputByEmployeeMetric.get(`${text(r.id)}:${metric}`); const submittedOutput = metric === "leads" ? outputByEmployeeMetric.get(`${text(r.id)}:leads_submitted`) : undefined; const current = num(output?.current_value); const previous = num(output?.previous_value); const label = metric === "revenue" ? "Revenue" : metric === "appointments" ? "Appointments" : metric === "leads" ? "Leads" : "Work updates"; const teams=r.teams as string[]; const matchingTargets=targetRows.filter(t=>text(t.metric).toLowerCase()===metric); const configured=matchingTargets.find(t=>text(t.employee)===text(r.canonical_name))??matchingTargets.find(t=>!t.employee&&teams.includes(text(t.team))); const effective=configured?num(configured.value)*targetScale(configured.period,days):null; const completion=effective&&effective>0?Math.round(current/effective*100):null; return { id: text(r.id), name: text(r.canonical_name), initials: initials(text(r.canonical_name)), title: text(r.job_title), teams, divisions: r.divisions as string[], aliases: r.aliases as string[], leadership: (r.leadership_level || undefined) as Employee["leadership"], rankingEnabled: Boolean(r.ranking_enabled), active: Boolean(r.active), status: statusFrom(completion), completion:completion??undefined, metricLabel: label, metricValue: metric === "revenue" ? money(current) : String(current), metricValueNumber: current, trend: delta(current, previous) ?? undefined, submittedLeads: submittedOutput ? num(submittedOutput.current_value) : undefined, excludedLeads: submittedOutput ? num(submittedOutput.current_value) - current : undefined }; });
  const teamRows = rows(teamResult); const teamMetrics = teamRows.map((r) => { const kind = text(r.type); const metricName=kind === "CLOSER" ? "revenue" : kind === "ISA" ? "leads" : kind === "OPERATIONAL" ? "work" : "appointments"; const value = num(r[metricName]); const label = kind === "CLOSER" ? "reported revenue" : kind === "ISA" ? "leads" : kind === "OPERATIONAL" ? "work updates" : "appointments"; const target=targetRows.find(t=>!t.employee&&text(t.team)===text(r.name)&&text(t.metric).toLowerCase()===metricName); const effective=target?num(target.value)*targetScale(target.period,days):null; const progress=effective&&effective>0?Math.round(value/effective*100):null; return { id: text(r.id), division: text(r.division), name: text(r.name), role: kind, metric: kind === "CLOSER" ? money(value) : String(value), label, status: statusFrom(progress), progress, members: r.members as string[], memberCount: num(r.member_count) }; });
  const divisionNames = [...new Set(teamRows.map((r) => text(r.division)))];
  const activity: Activity[] = rows(activityResult).map(activityFromRow);
  return { mode: "live", timezone: "Asia/Karachi", period, range: serializedRange(range), generatedAt: new Date().toISOString(),
    metrics: [{ label: "Appointments", value: String(num(summary.appointments)), delta: delta(num(summary.appointments),num(summary.appointments_prev)), note: "booked appointments", kind: "appointments" }, { label: "Sales", value: String(num(summary.sales)), delta: delta(num(summary.sales),num(summary.sales_prev)), note: "reported sales", kind: "sales" }, { label: "Revenue", value: money(num(summary.revenue)), delta: delta(num(summary.revenue),num(summary.revenue_prev)), note: num(summary.sales)>0?`${money(num(summary.revenue)/num(summary.sales))} average sale value`:"No sales in this period", kind: "revenue" }, { label: "Leads", value: String(num(summary.leads)), delta: delta(num(summary.leads),num(summary.leads_prev)), note: num(summary.leads_submitted) > num(summary.leads) ? `${num(summary.leads_submitted)} submitted · ${num(summary.leads_submitted)-num(summary.leads)} excluded` : "counted leads", kind: "leads", submitted: num(summary.leads_submitted), excluded: num(summary.leads_submitted)-num(summary.leads) }, { label: "Docks", value: String(num(summary.docks)), delta: delta(num(summary.docks),num(summary.docks_prev)), note: "kept outside KPI scores", kind: "docks" }, { label: "Media activity", value: String(num(summary.media)), delta: delta(num(summary.media),num(summary.media_prev)), note: "classified work updates", kind: "work" }],
    divisions: divisionNames.map((name,index) => { const divisionRows=teamRows.filter((r)=>text(r.division)===name); const appointments=divisionRows.reduce((sum,r)=>sum+num(r.appointments),0); const revenue=divisionRows.reduce((sum,r)=>sum+num(r.revenue),0); const leads=divisionRows.reduce((sum,r)=>sum+num(r.leads),0); const work=divisionRows.reduce((sum,r)=>sum+num(r.work),0); const outputs=[appointments?{label:"Appointments",value:String(appointments),kind:"appointments" as const}:null,revenue?{label:"Revenue",value:money(revenue),kind:"revenue" as const}:null,leads?{label:"Leads",value:String(leads),kind:"leads" as const}:null,work?{label:"Media activity",value:String(work),kind:"work" as const}:null].filter((item):item is NonNullable<typeof item>=>item!==null); return { name, eyebrow: `${divisionRows.length} operating team${divisionRows.length===1?"":"s"}`, outputs, accent: ["violet","cyan","amber"][index%3] }; }),
    teams: teamMetrics, employees: people, activities: activity, docks: rows(dockResult).map((r)=>{const dockActivity:Activity={id:text(r.id),employeeId:text(r.employee_id),employee:text(r.employee),type:"Dock",summary:text(r.reason),detail:`${text(r.currency)} ${text(r.amount)}`,channel:text(r.channel),timestamp:new Intl.DateTimeFormat("en-PK",{timeZone:"Asia/Karachi",dateStyle:"medium",timeStyle:"short"}).format(new Date(text(r.occurred_at))),raw:text(r.raw)};return { id:text(r.id),employeeId:text(r.employee_id),employee:text(r.employee),date:text(r.date),amount:text(r.amount),currency:text(r.currency),reason:text(r.reason),appliedBy:text(r.applied_by),activity:dockActivity }}), targets: targetRows.map((r)=>({ id:text(r.id),team:text(r.team),role:text(r.role),metric:text(r.metric),period:text(r.period),value:text(r.value),employee:r.employee?text(r.employee):null,effectiveFrom:text(r.effective_from),effectiveTo:r.effective_to?text(r.effective_to):null })), trend: rows(trendResult).map((r)=>({day:text(r.day),value:num(r.appointments)})),
    health: { raw:num(rows(healthResult)[0]?.raw),parsed:num(rows(healthResult)[0]?.parsed),unparsed:num(rows(healthResult)[0]?.unparsed),errors:num(rows(healthResult)[0]?.errors),unmatchedMessages:num(rows(healthResult)[0]?.unmatched_messages),unmappedEmployees:num(rows(healthResult)[0]?.unmapped),unattributedDocks:num(rows(healthResult)[0]?.unattributed_docks),lastEventAt:rows(healthResult)[0]?.last_event_at?text(rows(healthResult)[0].last_event_at):null,newestMessageAt:rows(healthResult)[0]?.newest_message_at?text(rows(healthResult)[0].newest_message_at):null,lastSyncAt:rows(healthResult)[0]?.last_sync_at?text(rows(healthResult)[0].last_sync_at):null,channels:rows(channelResult).map((r)=>({id:text(r.id),name:text(r.name),slackChannelId:text(r.slack_channel_id),workspaceId:text(r.workspace_id),active:Boolean(r.active),lastEventAt:r.last_event_at?text(r.last_event_at):null})) } };
}

export async function getEmployeeDetail(employeeId: string, period: PeriodKey = "This Week", customStart?: string, customEnd?: string): Promise<EmployeeDetailData> {
  const range = resolveDateRange(period, customStart, customEnd);
  const db = getDb();
  if (!db) return { employeeId, metricLabel: "Activity", trend: [], activities: [] };
  const {start,end}=dashboardRange(range);
  const current=(column:string)=>operationalShiftFilter(occurredAt(column),start,end);
  const employeeResult = await db.execute(sql`select job_title from employees where id=${employeeId} limit 1`);
  const employeeRow = rows(employeeResult)[0];
  if (!employeeRow) throw new Error("Employee not found.");
  const metric = primaryMetricForTitle(text(employeeRow.job_title));
  const metricLabel = metric === "revenue" ? "Revenue" : metric === "appointments" ? "Appointments" : metric === "leads" ? "Leads" : "Media activity";
  const trendResult = metric === "revenue"
    ? await db.execute(sql`select ${operationalDateSql(occurredAt("occurred_at"))} as "day",coalesce(sum(amount),0)::numeric as "value" from sales where employee_id=${employeeId}::uuid and ${current("occurred_at")} group by 1 order by 1`)
    : metric === "leads"
      ? await db.execute(sql`select ${operationalDateSql(occurredAt("l.occurred_at"))} as "day",count(*)::int as "value" from leads l where l.employee_id=${employeeId}::uuid and ${current("l.occurred_at")} and ${countedIsaLead("l.employee_id", "l.occurred_at")} group by 1 order by 1`)
      : metric === "work"
        ? await db.execute(sql`select ${operationalDateSql(occurredAt("occurred_at"))} as "day",count(*)::int as "value" from media_activity where employee_id=${employeeId}::uuid and ${current("occurred_at")} group by 1 order by 1`)
        : await db.execute(sql`select ${operationalDateSql(occurredAt("occurred_at"))} as "day",count(*)::int as "value" from appointments where employee_id=${employeeId}::uuid and ${current("occurred_at")} group by 1 order by 1`);
  const activitiesResult = await db.execute(sql`select * from (
    select a.id,a.employee_id,e.canonical_name employee,'Appointment' type,coalesce(a.prospect_name,'Appointment reported') summary,coalesce(a.state,'') detail,c.name channel,a.occurred_at,sm.raw_text raw,true counts_toward_kpi,'[]'::jsonb exclusion_reasons from appointments a join employees e on e.id=a.employee_id join slack_messages sm on sm.id=a.slack_message_id join slack_channels c on c.id=sm.channel_id where a.employee_id=${employeeId} and ${current("a.occurred_at")}
    union all select s.id,s.employee_id,e.canonical_name,'Sale',coalesce(s.customer_name,'Sale reported'),concat(coalesce(s.currency,'USD'),' ',coalesce(s.amount,0)),c.name,s.occurred_at,sm.raw_text,true,'[]'::jsonb from sales s join employees e on e.id=s.employee_id join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id where s.employee_id=${employeeId} and ${current("s.occurred_at")}
    union all select l.id,l.employee_id,e.canonical_name,'Lead',coalesce(l.contact_name,'Lead reported'),coalesce(l.lead_type,''),c.name,l.occurred_at,sm.raw_text,l.counts_toward_kpi,l.exclusion_reasons from leads l join employees e on e.id=l.employee_id join slack_messages sm on sm.id=l.slack_message_id join slack_channels c on c.id=sm.channel_id where l.employee_id=${employeeId} and ${current("l.occurred_at")}
    union all select ma.id,ma.employee_id,e.canonical_name,'Work update',ma.summary,ma.classification,c.name,ma.occurred_at,sm.raw_text,true,'[]'::jsonb from media_activity ma join employees e on e.id=ma.employee_id join slack_messages sm on sm.id=ma.slack_message_id join slack_channels c on c.id=sm.channel_id where ma.employee_id=${employeeId} and ${current("ma.occurred_at")}
    union all select dk.id,dk.employee_id,e.canonical_name,'Dock',dk.reason,concat(dk.currency,' ',dk.amount),c.name,dk.occurred_at,sm.raw_text,true,'[]'::jsonb from docks dk join employees e on e.id=dk.employee_id join slack_messages sm on sm.id=dk.slack_message_id join slack_channels c on c.id=sm.channel_id where dk.employee_id=${employeeId} and ${current("dk.occurred_at")}
  ) r order by occurred_at desc`);
  return { employeeId, metricLabel, trend: rows(trendResult).map((r)=>({day:text(r.day),value:num(r.value)})), activities: rows(activitiesResult).map(activityFromRow) };
}

export async function searchDashboardActivities(query: string, period: PeriodKey = "This Week", customStart?: string, customEnd?: string): Promise<Activity[]> {
  const term=query.trim();if(term.length<2)return[];
  const db=getDb();if(!db)return[];const range=resolveDateRange(period,customStart,customEnd);const {start,end}=dashboardRange(range),pattern=`%${term}%`;const current=(column:string)=>operationalShiftFilter(occurredAt(column),start,end);
  const result=await db.execute(sql`select * from (
    select a.id,a.employee_id,coalesce(e.canonical_name,'Unmapped') employee,'Appointment' type,coalesce(a.prospect_name,'Appointment reported') summary,concat_ws(' · ',a.state,a.phone,a.assigned_person) detail,c.name channel,a.occurred_at,sm.raw_text raw,true counts_toward_kpi,'[]'::jsonb exclusion_reasons from appointments a join slack_messages sm on sm.id=a.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=a.employee_id where ${current("a.occurred_at")}
    union all select s.id,s.employee_id,coalesce(e.canonical_name,'Unmapped'),'Sale',coalesce(s.customer_name,'Sale reported'),concat_ws(' · ',s.currency||' '||s.amount,s.package_name,s.state,array_to_string(s.zip_codes,',')),c.name,s.occurred_at,sm.raw_text,true,'[]'::jsonb from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=s.employee_id where ${current("s.occurred_at")}
    union all select l.id,l.employee_id,coalesce(e.canonical_name,'Unmapped'),'Lead',coalesce(l.contact_name,'Lead reported'),concat_ws(' · ',l.lead_type,l.state,l.phone,l.email,l.property_type,l.timeline,l.details::text),c.name,l.occurred_at,sm.raw_text,l.counts_toward_kpi,l.exclusion_reasons from leads l join slack_messages sm on sm.id=l.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=l.employee_id where ${current("l.occurred_at")}
    union all select ma.id,ma.employee_id,coalesce(e.canonical_name,'Unmapped'),'Work update',ma.summary,ma.classification,c.name,ma.occurred_at,sm.raw_text,true,'[]'::jsonb from media_activity ma join slack_messages sm on sm.id=ma.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=ma.employee_id where ${current("ma.occurred_at")}
    union all select dk.id,dk.employee_id,coalesce(e.canonical_name,'Unmapped'),'Dock',dk.reason,concat(dk.currency,' ',dk.amount),c.name,dk.occurred_at,sm.raw_text,true,'[]'::jsonb from docks dk join slack_messages sm on sm.id=dk.slack_message_id join slack_channels c on c.id=sm.channel_id left join employees e on e.id=dk.employee_id where ${current("dk.occurred_at")}
  ) r where concat_ws(' ',employee,summary,detail,channel,raw) ilike ${pattern} order by occurred_at desc limit 20`);
  return rows(result).map(activityFromRow);
}
