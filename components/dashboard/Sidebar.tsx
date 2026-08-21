"use client";

import { Activity, Building2, CircleDollarSign, Gauge, LayoutGrid, Settings2, Target, Users, X } from "lucide-react";
import type { ViewKey } from "@/types/dashboard";

const items: { key: ViewKey; label: string; icon: React.ElementType }[] = [
  { key: "overview", label: "Overview", icon: Gauge }, { key: "divisions", label: "Divisions", icon: Building2 }, { key: "teams", label: "Teams", icon: LayoutGrid }, { key: "employees", label: "Employees", icon: Users }, { key: "docks", label: "Docks", icon: CircleDollarSign }, { key: "targets", label: "Targets", icon: Target }, { key: "health", label: "Slack data", icon: Activity },
  { key: "setup", label: "Setup", icon: Settings2 },
];

export function Sidebar({ view, setView, open, close, mode, employeeCount }: { view: ViewKey; setView: (view: ViewKey) => void; open: boolean; close: () => void; mode:"live"|"demo"|"disconnected"; employeeCount:number }) {
  return <><div className={`sidebar-scrim ${open ? "visible" : ""}`} onClick={close}/><aside className={`sidebar ${open ? "open" : ""}`}>
    <div className="sidebar-brand"><div className="brand-mark" aria-label="LeadsEdge">LE</div><div><strong>LeadsEdge</strong><span>Executive Command Center</span></div><button className="mobile-close" onClick={close} aria-label="Close navigation"><X size={18}/></button></div>
    <p className="nav-label">Intelligence</p><nav>{items.slice(0,4).map(({ key, label, icon: Icon }) => <button key={key} className={view === key ? "active" : ""} onClick={() => { setView(key); close(); }}><Icon size={17}/><span>{label}</span>{key === "employees" && <em>{employeeCount}</em>}</button>)}</nav>
    <p className="nav-label">Management</p><nav>{items.slice(4).map(({ key, label, icon: Icon }) => <button key={key} className={view === key ? "active" : ""} onClick={() => { setView(key); close(); }}><Icon size={17}/><span>{label}</span>{key === "health" && <i className="nav-status"/>}</button>)}</nav>
    <div className="sidebar-bottom"><div className="workspace-pill"><span className="pulse-dot"/><div><strong>{mode==="live"?"Production workspace":mode==="demo"?"Development demo":"Setup required"}</strong><small>{mode==="live"?"PostgreSQL + Slack":mode==="demo"?"Explicit demo flag enabled":"Database not connected"}</small></div></div><button className="settings-row" onClick={()=>setView("setup")}><Settings2 size={16}/> Settings</button></div>
  </aside></>;
}
