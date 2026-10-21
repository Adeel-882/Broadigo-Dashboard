"use client";
import {Fragment,useEffect,useState} from "react";
import {latestClosedBusinessDate} from "@/lib/auto-docks/policy";
import {auditRows,ruleLabel,type AuditEvaluation,type AuditDock} from "@/lib/auto-docks/audit-view";
import styles from "./AutomaticDockAudit.module.css";
interface Audit {days:string[];unevaluatedDays:string[];from:string;to:string;enabled:boolean;effectiveFrom:string|null;pending:number;runs:Array<{business_date:string;status:string}>;evaluations:AuditEvaluation[];docks:AuditDock[]}
const money=(n:number)=>`PKR ${n.toLocaleString()}`;
export function AutomaticDockAudit(){
  const [date,setDate]=useState(()=>latestClosedBusinessDate());
  const [mode,setMode]=useState<'single'|'range'>('single');
  const [from,setFrom]=useState(date),[to,setTo]=useState(date);
  const [query,setQuery]=useState('date='+date);
  const [employee,setEmployee]=useState('');
  const [expanded,setExpanded]=useState<string|null>(null);
  const [state,setState]=useState<{data?:Audit;error?:string}>({});
  useEffect(()=>{const controller=new AbortController();void fetch(`/api/auto-docks?${query}`,{signal:controller.signal,cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("Unable to load automatic dock audit");return r.json() as Promise<Audit>;}).then(data=>setState({data})).catch(error=>{if(!controller.signal.aborted)setState({error:String(error.message)});});return()=>controller.abort();},[query]);
  const data=state.data,allRows=data?auditRows(data.evaluations,data.docks):[],rows=allRows.filter(r=>!employee||r.employee_id===employee);
  const docks=data?.docks.filter(d=>!employee||d.employee_id===employee)??[];
  const choose=(value:string)=>{if(value!==query){setState({});setExpanded(null);setQuery(value);}};
  return <section className={`glass-card data-section ${styles.audit}`}>
    <div className="card-title"><div><p className="eyebrow">System · separate from manual Slack docks</p><h2>Automatic daily audit</h2></div><div className={styles.filters}><label>View <select value={mode} onChange={e=>setMode(e.target.value as 'single'|'range')}><option value="single">Single Day</option><option value="range">Custom Range</option></select></label>{mode==='single'?<label>Business day <input type="date" value={date} aria-label="Automatic dock business day" onChange={e=>{if(e.target.value){setDate(e.target.value);choose(`date=${e.target.value}`);}}}/></label>:<><label>From <input type="date" aria-label="Audit range from" value={from} onChange={e=>setFrom(e.target.value)}/></label><label>To <input type="date" aria-label="Audit range to" value={to} onChange={e=>setTo(e.target.value)}/></label><button type="button" disabled={!from||!to||from>to} onClick={()=>choose(`from=${from}&to=${to}`)}>Apply</button></>}</div></div>
    {state.error?<p role="alert">{state.error}</p>:!data?<p role="status">Loading audit…</p>:<>
      <p className={styles.meta}>{data.enabled?'Enabled':'Financial writes disabled'} · First eligible day: {data.effectiveFrom??'Not configured'} · 05:00–05:00 Asia/Karachi</p>
      <p className={styles.meta}>Pending closed days: {data.pending} · Latest run: {data.runs[0]?`${data.runs[0].business_date} — ${data.runs[0].status}`:'No financial evaluations yet'}</p>
      <p className={styles.meta}>Showing business dates: {data.from} → {data.to} (inclusive)</p>
      <label>Employee <select value={employee} onChange={e=>setEmployee(e.target.value)}><option value="">All employees</option>{[...new Map(allRows.map(r=>[r.employee_id,r.evidence.employee])).entries()].sort((a,b)=>a[1].localeCompare(b[1])).map(([id,name])=><option key={id} value={id}>{name}</option>)}</select></label>
      {!!data.unevaluatedDays.length&&<p role="status" className={styles.meta}>Not yet evaluated (no dock decisions inferred): {data.unevaluatedDays.join(', ')}</p>}
      <div className={styles.summary}>{[['Business days',data.days.length],['Evaluations',rows.length],['Active docks',docks.filter(d=>d.status==='active').length],['Voided docks',docks.filter(d=>d.status==='voided').length],['Skipped / absent',rows.filter(r=>r.decision==='Skipped').length],['Excluded / exempt',rows.filter(r=>['Excluded','Exempt'].includes(r.decision)).length],['Active automatic total',money(docks.filter(d=>d.status==='active').reduce((n,d)=>n+Number(d.amount),0))]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {rows.length?<div className={styles.scroll} tabIndex={0} role="region" aria-label="Automatic daily audit results"><table className={styles.table}><thead><tr>{['Business date','Employee','Role','Attendance','Calls posted','Rule','Decision','Amount','Details'].map(c=><th key={c} scope="col">{c}</th>)}</tr></thead><tbody>{rows.map(r=><Fragment key={r.key}>
        <tr><td>{r.business_date}</td><th scope="row">{r.evidence.employee}</th><td>{r.role}</td><td><span className={styles.badge}>{r.attendance}</span></td><td className={styles.number}>{r.decision==='Excluded'?'—':r.evidence.appointments}</td><td>{ruleLabel(r.evidence.ruleCode)}</td><td><span className={styles.badge} data-decision={r.decision}>{r.decision}</span></td><td className={styles.number}>{r.amount?money(r.amount):'—'}</td><td><button type="button" aria-expanded={expanded===r.key} aria-controls={`audit-${r.key}`} onClick={()=>setExpanded(expanded===r.key?null:r.key)}>Details</button></td></tr>
        {expanded===r.key&&<tr id={`audit-${r.key}`}><td colSpan={9}><div className={styles.details}><p>Business window (UTC): {r.evidence.windowStart??'Not recorded'} → {r.evidence.windowEnd??'Not recorded'}</p><p>Evaluated: {r.evaluated_at} · Rule code: {r.evidence.ruleCode??'Excluded'}</p><p>Current decision: {r.evidence.decision==='ACTIVITY_RECORDED'?'No dock — qualifying call posted':r.decision}</p><div>Personally posted calls: {r.evidence.calls?.length?r.evidence.calls.map(c=><a key={`${c.channel}:${c.ts}`} href={`https://slack.com/archives/${c.channel}/p${c.ts.replace('.','')}`} target="_blank" rel="noreferrer">#{c.name} · {c.ts}</a>):r.decision==='Excluded'?'Not evaluated — excluded':`${r.evidence.appointments} calls; source links unavailable in older evaluations`}</div><div>Attendance evidence: {r.evidence.checkIns?.length?r.evidence.checkIns.map((c,i)=><a key={c.ts} href={`https://slack.com/archives/${c.channel}/p${c.ts.replace('.','')}`} target="_blank" rel="noreferrer">Check-in {i+1}</a>):'No check-in recorded'}</div>{r.history.map((d,i)=><div key={i} className={styles.history}><strong>{ruleLabel(d.rule_code)} · {money(Number(d.amount))} · {d.status==='voided'?'Voided — excluded from totals':'Active'}</strong><p>Created: {d.created_at}{d.voided_at?` · Voided: ${d.voided_at}`:''}</p>{d.void_reason&&<p>{d.void_reason}</p>}</div>)}</div></td></tr>}
      </Fragment>)}</tbody></table></div>:<p>No financial evaluation for this day. Dates before activation are audit-only.</p>}
    </>}
  </section>;
}
