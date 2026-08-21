"use client";

import { CalendarDays, Check, ChevronDown, LoaderCircle, Menu, Search } from "lucide-react";
import { type FormEvent, type KeyboardEvent as ReactKeyboardEvent, type RefObject, useEffect, useRef, useState } from "react";
import { operationalDateFor } from "@/lib/time-ranges";
import type { PeriodKey } from "@/types/dashboard";

const periods:PeriodKey[] = ["Today", "Yesterday", "This Week", "Last Week", "This Month", "Last Month", "Custom Range"];

export function Topbar({ period, setPeriod, openMenu, search, setSearch, loading, searchInputRef }: { period: PeriodKey; setPeriod: (period: PeriodKey,start?:string,end?:string) => void; openMenu: () => void; search: string; setSearch: (value: string) => void; loading:boolean; searchInputRef:RefObject<HTMLInputElement|null> }) {
  const [periodMenuOpen,setPeriodMenuOpen]=useState(false);
  const periodMenuRef=useRef<HTMLDivElement>(null);
  const periodTriggerRef=useRef<HTMLButtonElement>(null);
  const today=operationalDateFor(new Date());
  const runApply=(form:HTMLFormElement|null)=>{if(!form)return;const values=new FormData(form);const selectedStart=String(values.get("start")??"");const selectedEnd=String(values.get("end")??"");if(selectedStart&&selectedEnd&&selectedStart<=selectedEnd)setPeriod("Custom Range",selectedStart,selectedEnd)};
  const applyRange=(event:FormEvent<HTMLFormElement>)=>{event.preventDefault();runApply(event.currentTarget)};
  useEffect(()=>{
    if(!periodMenuOpen)return;
    periodMenuRef.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus();
    const closeOnOutside=(event:PointerEvent)=>{if(!periodMenuRef.current?.contains(event.target as Node)&&!periodTriggerRef.current?.contains(event.target as Node))setPeriodMenuOpen(false)};
    const closeOnEscape=(event:KeyboardEvent)=>{if(event.key==="Escape"){setPeriodMenuOpen(false);periodTriggerRef.current?.focus();}};
    document.addEventListener("pointerdown",closeOnOutside);document.addEventListener("keydown",closeOnEscape);
    return()=>{document.removeEventListener("pointerdown",closeOnOutside);document.removeEventListener("keydown",closeOnEscape)};
  },[periodMenuOpen]);
  const navigateOptions=(event:ReactKeyboardEvent<HTMLDivElement>)=>{
    if(event.key!=="ArrowDown"&&event.key!=="ArrowUp")return;
    event.preventDefault();const options=[...event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="option"]')];const current=options.indexOf(document.activeElement as HTMLButtonElement);const direction=event.key==="ArrowDown"?1:-1;options[(current+direction+options.length)%options.length]?.focus();
  };
  return <><header className="topbar"><button className="menu-button" onClick={openMenu} aria-label="Open navigation"><Menu size={20}/></button><div className="global-search"><Search size={16}/><input ref={searchInputRef} value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search employees, records, clients…" aria-label="Search employees and records"/><kbd>Ctrl K</kbd></div><div className="topbar-actions"><div className="period-menu"><button ref={periodTriggerRef} type="button" className="period-trigger" aria-label={`Dashboard date period: ${period}`} aria-haspopup="listbox" aria-expanded={periodMenuOpen} aria-controls="dashboard-period-options" onClick={()=>setPeriodMenuOpen(open=>!open)} onKeyDown={event=>{if(event.key==="ArrowDown"){event.preventDefault();setPeriodMenuOpen(true)}}}><CalendarDays size={15}/><span className="period-trigger-label">{period}</span>{loading?<LoaderCircle className="spin" size={14}/>:<ChevronDown className={periodMenuOpen?"rotated":""} size={14}/>}</button>{periodMenuOpen&&<div ref={periodMenuRef} id="dashboard-period-options" className="period-options" role="listbox" aria-label="Dashboard date period" onKeyDown={navigateOptions}>{periods.map(item=><button key={item} type="button" role="option" aria-selected={item===period} className={`period-option ${item===period?"selected":""}`} onClick={()=>{setPeriod(item);setPeriodMenuOpen(false);periodTriggerRef.current?.focus()}}><span>{item}</span>{item===period&&<Check size={14}/>}</button>)}</div>}</div><div className="avatar-button" aria-label="Signed in as CEO"><span>MO</span><div><strong>Mohib</strong><small>CEO</small></div></div></div></header>{period==="Custom Range"&&<form className="custom-range" onSubmit={applyRange}><label>From <input name="start" type="date" defaultValue={today}/></label><label>To <input name="end" type="date" defaultValue={today}/></label><button type="button" onClick={event=>runApply(event.currentTarget.form)} className="primary-button compact">Apply range</button></form>}</>;
}
