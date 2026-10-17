"use client";
import {Fragment,useEffect,useState} from "react";
import {latestClosedBusinessDate} from "@/lib/auto-docks/policy";
import {auditRows,ruleLabel,type AuditEvaluation,type AuditDock} from "@/lib/auto-docks/audit-view";
import styles from "./AutomaticDockAudit.module.css";
interface Audit {enabled:boolean;effectiveFrom:string|null;pending:number;runs:Array<{business_date:string;status:string}>;evaluations:AuditEvaluation[];docks:AuditDock[]}
const money=(n:number)=>`PKR ${n.toLocaleString()}`;
export function AutomaticDockAudit(){
  const [date,setDate]=useState(()=>latestClosedBusinessDate());
  const [expanded,setExpanded]=useState<string|null>(null);
  const [state,setState]=useState<{data?:Audit;error?:string}>({});
  useEffect(()=>{const controller=new AbortController();void fetch(`/api/auto-docks?date=${date}`,{signal:controller.signal,cache:"no-store"}).then(async r=>{if(!r.ok)throw new Error("Unable to load automatic dock audit");return r.json() as Promise<Audit>;}).then(data=>setState({data})).catch(error=>{if(!controller.signal.aborted)setState({error:String(error.message)});});return()=>controller.abort();},[date]);
  const data=state.data,rows=data?auditRows(data.evaluations,data.docks):[];
  return <section className={`glass-card data-section ${styles.audit}`}>
    <div className="card-title"><div><p className="eyebrow">System · separate from manual Slack docks</p><h2>Automatic daily audit</h2></div><label>Business day <input type="date" value={date} aria-label="Automatic dock business day" onChange={e=>{if(e.target.value){setState({});setExpanded(null);setDate(e.target.value);}}}/></label></div>
    {state.error?<p role="alert">{state.error}</p>:!data?<p role="status">Loading audit…</p>:<>
      <p className={styles.meta}>{data.enabled?'Enabled':'Financial writes disabled'} · First eligible day: {data.effectiveFrom??'Not configured'} · 05:00–05:00 Asia/Karachi</p>
      <p className={styles.meta}>Pending closed days: {data.pending} · Latest run: {data.runs[0]?`${data.runs[0].business_date} — ${data.runs[0].status}`:'No financial evaluations yet'}</p>
      <div className={styles.summary}>{[['Evaluated',rows.length],['Docked',rows.filter(r=>r.decision==='Docked').length],['Skipped / absent',rows.filter(r=>r.decision==='Skipped').length],['Excluded / exempt',rows.filter(r=>['Excluded','Exempt'].includes(r.decision)).length],['Active automatic total',money(data.docks.filter(d=>d.status==='active').reduce((n,d)=>n+Number(d.amount),0))]].map(([label,value])=><div key={label}><span>{label}</span><strong>{value}</strong></div>)}</div>
      {rows.length?<div className={styles.scroll} tabIndex={0} role="region" aria-label="Automatic daily audit results"><table className={styles.table}><thead><tr>{['Employee','Role','Attendance','Calls posted','Rule','Decision','Amount','Details'].map(c=><th key={c} scope="col">{c}</th>)}</tr></thead><tbody>{rows.map(r=><Fragment key={r.employee_id}>
        <tr><th scope="row">{r.evidence.employee}</th><td>{r.role}</td><td><span className={styles.badge}>{r.attendance}</span></td><td className={styles.number}>{r.decision==='Excluded'?'—':r.evidence.appointments}</td><td>{ruleLabel(r.evidence.ruleCode)}</td><td><span className={styles.badge} data-decision={r.decision}>{r.decision}</span></td><td className={styles.number}>{r.amount?money(r.amount):'—'}</td><td><button type="button" aria-expanded={expanded===r.employee_id} aria-controls={`audit-${r.employee_id}`} onClick={()=>setExpanded(expanded===r.employee_id?null:r.employee_id)}>Details</button></td></tr>
        {expanded===r.employee_id&&<tr id={`audit-${r.employee_id}`}><td colSpan={8}><div className={styles.details}><p>Business window (UTC): {r.evidence.windowStart??'Not recorded'} → {r.evidence.windowEnd??'Not recorded'}</p><p>Evaluated: {r.evaluated_at} · Rule code: {r.evidence.ruleCode??'Excluded'}</p><p>Current decision: {r.evidence.decision==='ACTIVITY_RECORDED'?'No dock — qualifying call posted':r.decision}</p><div>Attendance evidence: {r.evidence.checkIns?.length?r.evidence.checkIns.map((c,i)=><a key={c.ts} href={`https://slack.com/archives/${c.channel}/p${c.ts.replace('.','')}`} target="_blank" rel="noreferrer">Check-in {i+1}</a>):'No check-in recorded'}</div>{r.history.map((d,i)=><div key={i} className={styles.history}><strong>{ruleLabel(d.rule_code)} · {money(Number(d.amount))} · {d.status==='voided'?'Voided — excluded from totals':'Active'}</strong><p>Created: {d.created_at}{d.voided_at?` · Voided: ${d.voided_at}`:''}</p>{d.void_reason&&<p>{d.void_reason}</p>}</div>)}</div></td></tr>}
      </Fragment>)}</tbody></table></div>:<p>No financial evaluation for this day. Dates before activation are audit-only.</p>}
    </>}
  </section>;
}
