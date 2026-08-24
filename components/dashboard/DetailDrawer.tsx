"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarCheck2, CircleDollarSign, Clock3, Copy, LoaderCircle, PhoneCall, Target, TrendingUp, UserRound, X } from "lucide-react";
import type { Activity, AssignedCall, Employee, EmployeeDetailData, TargetProgress } from "@/types/dashboard";
import { appointmentSetterMilestones, closerQualification, targetRoleForTitle } from "@/lib/performance-targets";
import { TargetPanel } from "./TargetPanel";
import { TrendChart } from "./TrendChart";

export function DetailDrawer({ employee, activity, detail, detailLoading, close, openActivity }: { employee: Employee | null; activity: Activity | null; detail: EmployeeDetailData | null; detailLoading: boolean; close: () => void; openActivity: (activity: Activity) => void }) {
  const drawerRef=useRef<HTMLElement>(null);
  useEffect(()=>{
    if(!employee&&!activity)return;
    const previous=document.activeElement as HTMLElement|null;
    const priorOverflow=document.body.style.overflow;
    document.body.style.overflow="hidden";
    requestAnimationFrame(()=>drawerRef.current?.querySelector<HTMLElement>("button")?.focus());
    const onKey=(event:KeyboardEvent)=>{
      if(event.key==="Escape")close();
      if(event.key!=="Tab"||!drawerRef.current)return;
      const focusable=[...drawerRef.current.querySelectorAll<HTMLElement>('button,[href],input,select,textarea,[tabindex]:not([tabindex="-1"])')].filter(node=>!node.hasAttribute("disabled"));
      if(!focusable.length)return;
      const first=focusable[0],last=focusable[focusable.length-1];
      if(event.shiftKey&&document.activeElement===first){event.preventDefault();last.focus();}
      else if(!event.shiftKey&&document.activeElement===last){event.preventDefault();first.focus();}
    };
    document.addEventListener("keydown",onKey);
    return()=>{document.removeEventListener("keydown",onKey);document.body.style.overflow=priorOverflow;previous?.focus();};
  },[employee,activity,close]);
  if (!employee && !activity) return null;
  return <><div className="drawer-scrim" onClick={close}/><aside ref={drawerRef} role="dialog" aria-modal="true" aria-label={employee?`${employee.name} details`:`${activity?.type} evidence`} className={`detail-drawer ${employee ? "employee-drawer" : ""}`}><button className="drawer-close" onClick={close} aria-label="Close details"><X size={18}/></button>{activity ? <ActivityDetail activity={activity}/> : employee ? <EmployeeDetail key={employee.id} employee={employee} detail={detail} loading={detailLoading} openActivity={openActivity}/> : null}</aside></>;
}

function ActivityDetail({ activity }: { activity: Activity }) {
  const [copied,setCopied]=useState(false);
  async function copyRaw(){await navigator.clipboard.writeText(activity.raw);setCopied(true);window.setTimeout(()=>setCopied(false),1600);}
  return <div className="drawer-content"><p className="eyebrow">Source evidence</p><div className={`record-icon type-${activity.type.toLowerCase().replace(" ", "-")}`}>{activity.type === "Sale" ? <CircleDollarSign/> : <CalendarCheck2/>}</div><h2>{activity.summary}</h2>{activity.type === "Lead" && activity.exclusionLabel ? <p className={`lead-status-badge ${activity.countsTowardKpi ? "is-counted" : "is-excluded"}`}>{activity.exclusionLabel}</p> : null}<p className="drawer-lede">{activity.detail}</p><dl className="record-details"><div><dt>Employee</dt><dd>{activity.employee}</dd></div><div><dt>Record type</dt><dd>{activity.type}</dd></div><div><dt>Reported</dt><dd>{activity.timestamp}</dd></div><div><dt>Slack channel</dt><dd>#{activity.channel}</dd></div>{activity.type === "Lead" ? <div><dt>Counts toward KPI</dt><dd>{activity.countsTowardKpi ? "Yes" : `No — ${activity.exclusionLabel?.replace(/^Excluded — /, "") ?? "excluded by management"}`}</dd></div> : null}</dl><div className="raw-message"><div><span>Original Slack message</span><button onClick={copyRaw} aria-label="Copy raw message"><Copy size={14}/>{copied&&<em>Copied</em>}</button></div><pre>{activity.raw}</pre></div><p className="evidence-note">Stored separately from the parsed record so parser improvements never lose the original evidence.</p></div>;
}

function EmployeeDetail({ employee, detail, loading, openActivity }: { employee: Employee; detail:EmployeeDetailData|null; loading:boolean; openActivity: (activity: Activity) => void }) {
  const activities=detail?.activities??[];
  const metricLabel=detail?.metricLabel??employee.metricLabel;
  const assignedCalls=detail?.assignedCalls??[];
  // The tab is offered to Closers, and to anyone who actually has calls assigned
  // to them, without changing anybody's formal role.
  const showCalls=/closer/i.test(employee.title)||assignedCalls.length>0;
  // Keyed by employee.id at the call site, so this resets naturally per person.
  const [tab,setTab]=useState<"overview"|"calls">("overview");
  return <div className="drawer-content employee-profile"><div className="profile-hero"><span className="profile-avatar">{employee.initials}</span><div><p className="eyebrow">Employee intelligence</p><h2>{employee.name}</h2><p>{employee.title}</p></div>{employee.leadership && <span className="leadership-badge">{employee.leadership}</span>}</div><div className="profile-chips">{employee.teams.map((team) => <span key={team}>{team}</span>)}</div>
    {showCalls&&<div className="drawer-tabs" role="tablist" aria-label="Employee sections">
      <button role="tab" aria-selected={tab==="overview"} className={tab==="overview"?"active":""} onClick={()=>setTab("overview")}>Overview</button>
      <button role="tab" aria-selected={tab==="calls"} className={tab==="calls"?"active":""} onClick={()=>setTab("calls")}>Calls Scheduled{assignedCalls.length?<em>{assignedCalls.length}</em>:null}</button>
    </div>}
    {tab==="calls"?<CallsScheduled calls={assignedCalls} loading={loading}/>:<>
    {employee.leadership ? <div className="no-target-panel"><UserRound size={22}/><div><strong>Leadership profile</strong><p>Visible operational activity, without automatic appointment or sales quotas.</p></div></div> : <div className="profile-kpis"><article><span>{employee.metricLabel}</span><strong>{employee.metricValue}</strong><small>{employee.submittedLeads != null && employee.submittedLeads > Number(employee.metricValue) ? `${employee.submittedLeads} submitted · ${employee.excludedLeads} excluded` : "Selected period"}</small></article><TargetTile employee={employee} progress={detail?.targetProgress}/><article><span>Trend</span><strong className={(employee.trend ?? 0) >= 0 ? "positive" : "negative"}>{employee.trend == null?"—":`${employee.trend >= 0 ? "+" : ""}${employee.trend}%`}</strong><small>vs prior period</small></article></div>}
    {employee.teams.length > 1 && <div className="multi-team-note"><ArrowUpRight size={17}/><div><strong>Multi-team employee</strong><p>Each role is measured independently. No combined artificial performance score.</p></div></div>}
    {!employee.leadership && <><div className="profile-section-title"><div><p className="eyebrow">Selected period</p><h3>{metricLabel} trend</h3></div><TrendingUp size={17}/></div><div className="profile-chart">{loading?<div className="drawer-loading"><LoaderCircle className="spin"/> Loading evidence…</div>:<TrendChart data={detail?.trend??[]} label={metricLabel}/>}</div>{employee.completion!=null&&<div className="goal-progress"><div><span><Target size={15}/> {detail?.targetProgress ? `${detail.targetProgress.monthLabel} target` : "Effective target"}</span><strong>{employee.completion}%</strong></div><i><em style={{ width: `${Math.min(employee.completion, 100)}%` }}/></i></div>}</>}
    <div className="profile-section-title"><div><p className="eyebrow">Chronological evidence</p><h3>Activity in this period</h3></div><Clock3 size={17}/></div>{loading?<div className="drawer-loading"><LoaderCircle className="spin"/> Loading records…</div>:activities.length ? <div className="profile-activity">{activities.map((item) => <button key={`${item.type}-${item.id}`} onClick={() => openActivity(item)}><i/><div><strong>{item.type}{item.type === "Lead" && item.countsTowardKpi === false ? <em className="lead-row-flag">Excluded</em> : null}</strong><p>{item.summary}</p><small>{item.timestamp} · #{item.channel}</small></div><ArrowUpRight size={14}/></button>)}</div> : <div className="empty-state"><Clock3 size={22}/><strong>No Slack records in this period.</strong><p>Change the date range to inspect historical activity.</p></div>}
    {detail?.targetProgress&&<TargetPanel employee={employee} progress={detail.targetProgress}/>}
    </>}
  </div>;
}

/**
 * The monthly target tile.
 *
 * A percentage is only meaningful for a role whose target is a single countable
 * quantity, which is true of Lead Generators and of nobody else. A Closer
 * qualifies on revenue OR closed sales, so a revenue-only percentage would call a
 * qualified Closer "Behind"; an Appointment Setter climbs a revenue milestone
 * ladder. Each role therefore reports the figure its official target is actually
 * defined on, and the tile falls back to the resolved percentage only when no
 * role-specific rule applies.
 */
function TargetTile({ employee, progress }: { employee: Employee; progress?: TargetProgress }) {
  const role = progress?.role ?? targetRoleForTitle(employee.title);
  if (role === "CLOSER") {
    if (!progress) return <article><span>Closer qualification</span><strong>Loading…</strong><small>$2,000 revenue OR 2 closed sales</small></article>;
    const qualification = closerQualification(progress.revenue, progress.closedSales);
    return <article><span>Monthly qualification</span>
      <strong className={qualification.qualified ? "positive" : ""}>{qualification.qualified ? "Qualified" : "Not yet"}</strong>
      <small>{qualification.requirement}</small></article>;
  }
  if (role === "APPOINTMENT_SETTER") {
    if (!progress) return <article><span>Qualified call target</span><strong>Target 13</strong><small>Loading monthly progress…</small></article>;
    // Neither official setter target has a source field, so the tile says so
    // rather than reporting a zero the setter would appear to have earned.
    if (!progress.revenueAttributedToRole) {
      return <article><span>Monthly target</span>
        <strong>Not measured</strong>
        <small>See performance targets below</small></article>;
    }
    const ladder = appointmentSetterMilestones(progress.revenue);
    return <article><span>Revenue milestone</span>
      <strong>{ladder.currentMilestone == null ? "None yet" : `$${ladder.currentMilestone.toLocaleString("en-US")}`}</strong>
      <small>{ladder.nextMilestone == null ? "Highest milestone reached" : `Next $${ladder.nextMilestone.toLocaleString("en-US")}`}</small></article>;
  }
  if (role === "LEAD_GENERATOR" && !progress) {
    return <article><span>Monthly lead target</span><strong>Target 26</strong><small>Team target 450 · Loading progress…</small></article>;
  }
  return <article><span>Target completion</span>
    <strong>{employee.completion == null ? "—" : `${employee.completion}%`}</strong>
    <small>{progress?.role === "LEAD_GENERATOR" ? `${progress.monthlyLeads} counted leads in ${progress.monthLabel}` : employee.status}</small></article>;
}

/**
 * Calls a setter booked and assigned to this employee to conduct.
 *
 * Read-only. The setter keeps full credit for the appointment; nothing here
 * counts toward this employee's appointments, sales or revenue.
 *
 * Scope is deliberately independent of the dashboard's date filter so a
 * historical reporting range can never hide an operationally relevant call.
 * Only fields the appointment record actually stores are shown.
 */
function CallsScheduled({ calls, loading }: { calls: AssignedCall[]; loading: boolean }) {
  const [scope, setScope] = useState<"recent" | "all">("recent");
  // Calls arrive newest first, so "Recent" caps the list rather than filtering on
  // the wall clock. That keeps rendering pure and the panel bounded, and it never
  // hides an operationally relevant call the way a date window would.
  const RECENT_LIMIT = 25;
  const visible = scope === "all" ? calls : calls.slice(0, RECENT_LIMIT);

  if (loading) return <div className="drawer-content calls-panel"><div className="drawer-loading"><LoaderCircle className="spin"/> Loading assigned calls…</div></div>;

  return <div className="drawer-content calls-panel">
    <div className="profile-section-title"><div><p className="eyebrow">Assigned to this employee</p><h3>Calls scheduled</h3></div><PhoneCall size={17}/></div>
    <div className="calls-scope" role="group" aria-label="Call scope">
      <button className={scope === "recent" ? "active" : ""} onClick={() => setScope("recent")}>Recent</button>
      <button className={scope === "all" ? "active" : ""} onClick={() => setScope("all")}>All{calls.length ? ` (${calls.length})` : ""}</button>
    </div>
    {visible.length ? <div className="calls-list">{visible.map((call) => <article key={call.id}>
      <header>
        <strong>{call.prospect ?? "Prospect not recorded"}</strong>
        {call.scheduledText ? <span className="call-when">{call.scheduledText}</span> : null}
      </header>
      <dl>
        <div><dt>Setter</dt><dd>{call.setter ?? "Not mapped"}</dd></div>
        <div><dt>Assigned to</dt><dd>{call.assignedTo}</dd></div>
        <div><dt>Phone</dt><dd>{call.phone ?? "Not provided"}</dd></div>
        <div><dt>State</dt><dd>{call.state ?? "Not provided"}</dd></div>
        <div><dt>Team</dt><dd>{call.team ?? "—"}</dd></div>
        <div><dt>Source</dt><dd>#{call.channel}</dd></div>
      </dl>
      <a className="call-source-link" href={call.sourceUrl} target="_blank" rel="noreferrer">View Slack source <ArrowUpRight size={13}/></a>
    </article>)}</div> : <div className="empty-state"><PhoneCall size={22}/>
      <strong>No scheduled calls found.</strong>
      <p>Calls appear here when a setter assigns one to this person.</p>
    </div>}
  </div>;
}
