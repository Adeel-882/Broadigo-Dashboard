"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowUpRight, CalendarCheck2, CircleDollarSign, Clock3, Copy, LoaderCircle, Target, TrendingUp, UserRound, X } from "lucide-react";
import type { Activity, Employee, EmployeeDetailData } from "@/types/dashboard";
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
  return <><div className="drawer-scrim" onClick={close}/><aside ref={drawerRef} role="dialog" aria-modal="true" aria-label={employee?`${employee.name} details`:`${activity?.type} evidence`} className={`detail-drawer ${employee ? "employee-drawer" : ""}`}><button className="drawer-close" onClick={close} aria-label="Close details"><X size={18}/></button>{activity ? <ActivityDetail activity={activity}/> : employee ? <EmployeeDetail employee={employee} detail={detail} loading={detailLoading} openActivity={openActivity}/> : null}</aside></>;
}

function ActivityDetail({ activity }: { activity: Activity }) {
  const [copied,setCopied]=useState(false);
  async function copyRaw(){await navigator.clipboard.writeText(activity.raw);setCopied(true);window.setTimeout(()=>setCopied(false),1600);}
  return <div className="drawer-content"><p className="eyebrow">Source evidence</p><div className={`record-icon type-${activity.type.toLowerCase().replace(" ", "-")}`}>{activity.type === "Sale" ? <CircleDollarSign/> : <CalendarCheck2/>}</div><h2>{activity.summary}</h2>{activity.type === "Lead" && activity.exclusionLabel ? <p className={`lead-status-badge ${activity.countsTowardKpi ? "is-counted" : "is-excluded"}`}>{activity.exclusionLabel}</p> : null}<p className="drawer-lede">{activity.detail}</p><dl className="record-details"><div><dt>Employee</dt><dd>{activity.employee}</dd></div><div><dt>Record type</dt><dd>{activity.type}</dd></div><div><dt>Reported</dt><dd>{activity.timestamp}</dd></div><div><dt>Slack channel</dt><dd>#{activity.channel}</dd></div>{activity.type === "Lead" ? <div><dt>Counts toward KPI</dt><dd>{activity.countsTowardKpi ? "Yes" : `No — ${activity.exclusionLabel?.replace(/^Excluded — /, "") ?? "excluded by management"}`}</dd></div> : null}</dl><div className="raw-message"><div><span>Original Slack message</span><button onClick={copyRaw} aria-label="Copy raw message"><Copy size={14}/>{copied&&<em>Copied</em>}</button></div><pre>{activity.raw}</pre></div><p className="evidence-note">Stored separately from the parsed record so parser improvements never lose the original evidence.</p></div>;
}

function EmployeeDetail({ employee, detail, loading, openActivity }: { employee: Employee; detail:EmployeeDetailData|null; loading:boolean; openActivity: (activity: Activity) => void }) {
  const activities=detail?.activities??[];
  const metricLabel=detail?.metricLabel??employee.metricLabel;
  return <div className="drawer-content employee-profile"><div className="profile-hero"><span className="profile-avatar">{employee.initials}</span><div><p className="eyebrow">Employee intelligence</p><h2>{employee.name}</h2><p>{employee.title}</p></div>{employee.leadership && <span className="leadership-badge">{employee.leadership}</span>}</div><div className="profile-chips">{employee.teams.map((team) => <span key={team}>{team}</span>)}</div>
    {employee.leadership ? <div className="no-target-panel"><UserRound size={22}/><div><strong>Leadership profile</strong><p>Visible operational activity, without automatic appointment or sales quotas.</p></div></div> : <div className="profile-kpis"><article><span>{employee.metricLabel}</span><strong>{employee.metricValue}</strong><small>{employee.submittedLeads != null && employee.submittedLeads > Number(employee.metricValue) ? `${employee.submittedLeads} submitted · ${employee.excludedLeads} excluded` : "Selected period"}</small></article><article><span>Target completion</span><strong>{employee.completion == null ? "—" : `${employee.completion}%`}</strong><small>{employee.status}</small></article><article><span>Trend</span><strong className={(employee.trend ?? 0) >= 0 ? "positive" : "negative"}>{employee.trend == null?"—":`${employee.trend >= 0 ? "+" : ""}${employee.trend}%`}</strong><small>vs prior period</small></article></div>}
    {employee.teams.length > 1 && <div className="multi-team-note"><ArrowUpRight size={17}/><div><strong>Multi-team employee</strong><p>Each role is measured independently. No combined artificial performance score.</p></div></div>}
    {!employee.leadership && <><div className="profile-section-title"><div><p className="eyebrow">Selected period</p><h3>{metricLabel} trend</h3></div><TrendingUp size={17}/></div><div className="profile-chart">{loading?<div className="drawer-loading"><LoaderCircle className="spin"/> Loading evidence…</div>:<TrendChart data={detail?.trend??[]} label={metricLabel}/>}</div>{employee.completion!=null&&<div className="goal-progress"><div><span><Target size={15}/> Effective target</span><strong>{employee.completion}%</strong></div><i><em style={{ width: `${Math.min(employee.completion, 100)}%` }}/></i></div>}</>}
    <div className="profile-section-title"><div><p className="eyebrow">Chronological evidence</p><h3>Activity in this period</h3></div><Clock3 size={17}/></div>{loading?<div className="drawer-loading"><LoaderCircle className="spin"/> Loading records…</div>:activities.length ? <div className="profile-activity">{activities.map((item) => <button key={`${item.type}-${item.id}`} onClick={() => openActivity(item)}><i/><div><strong>{item.type}{item.type === "Lead" && item.countsTowardKpi === false ? <em className="lead-row-flag">Excluded</em> : null}</strong><p>{item.summary}</p><small>{item.timestamp} · #{item.channel}</small></div><ArrowUpRight size={14}/></button>)}</div> : <div className="empty-state"><Clock3 size={22}/><strong>No Slack records in this period.</strong><p>Change the date range to inspect historical activity.</p></div>}
  </div>;
}
