"use client";
import {useEffect,useRef,useState} from 'react';
import {ruleLabel,type AuditDock} from '@/lib/auto-docks/audit-view';
import styles from './AutomaticDockAudit.module.css';
export function AutomaticDockEditor({dock,employee,onClose,onChanged}:{dock:AuditDock;employee:string;onClose:()=>void;onChanged:()=>Promise<void>}){
  const dialog=useRef<HTMLDialogElement>(null);
  const [step,setStep]=useState<'password'|'edit'|'delete'>('password'),[password,setPassword]=useState(''),[amount,setAmount]=useState(dock.amount),[reason,setReason]=useState(''),[busy,setBusy]=useState(false),[error,setError]=useState('');
  useEffect(()=>{const el=dialog.current;el?.showModal();return()=>el?.close();},[]);
  async function authorize(){
    setBusy(true);setError('');
    try{const response=await fetch('/api/auto-docks/edit-authorize',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({id:dock.id,password})});const body=await response.json();if(!response.ok)throw new Error(body.error||'Unable to authorize.');setStep('edit');}
    catch(e){setError(e instanceof Error?e.message:'Unable to authorize.');}finally{setPassword('');setBusy(false);}
  }
  async function save(deleted=false){
    setBusy(true);setError('');
    try{const response=await fetch(`/api/auto-docks/${dock.id}`,{method:deleted?'DELETE':'PATCH',headers:{'Content-Type':'application/json'},body:JSON.stringify({amount,reason,expectedAmount:dock.amount})});const body=await response.json();if(!response.ok){if(response.status===403)setStep('password');throw new Error(body.error||'Unable to save.');}await onChanged();onClose();}
    catch(e){setError(e instanceof Error?e.message:'Unable to save.');}finally{setBusy(false);}
  }
  return <dialog ref={dialog} className={styles.editor} aria-labelledby="dock-edit-title" onCancel={e=>{e.preventDefault();if(!busy)onClose();}}>
    <h2 id="dock-edit-title">{step==='delete'?'Delete automatic dock?':'Edit Automatic Dock'}</h2>
    {step==='password'?<form onSubmit={e=>{e.preventDefault();void authorize();}}><label>Password<input autoFocus type="password" autoComplete="off" value={password} onChange={e=>setPassword(e.target.value)} maxLength={1024} required disabled={busy}/></label><p className={styles.meta}>Separate authorization is required for this automatic record.</p><div className={styles.actions}><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" disabled={busy||!password}>{busy?'Verifying…':'Continue'}</button></div></form>:<>
      <dl><dt>Employee</dt><dd>{employee}</dd><dt>Business date</dt><dd>{dock.business_date}</dd><dt>Rule</dt><dd>{ruleLabel(dock.rule_code)}</dd><dt>System rule amount</dt><dd>PKR {dock.system_amount??dock.amount}</dd><dt>Current amount</dt><dd>PKR {dock.amount}</dd></dl>
      {step==='delete'?<><p>This record will no longer count toward automatic dock totals. Audit history will be retained, and automation will not restore it.</p><label>Reason (required)<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} disabled={busy}/></label><div className={styles.actions}><button onClick={()=>setStep('edit')} disabled={busy}>Cancel</button><button className={styles.destructive} onClick={()=>void save(true)} disabled={busy||!reason.trim()}>Delete</button></div></>:<form onSubmit={e=>{e.preventDefault();void save();}}><label>Amount (PKR)<input autoFocus type="text" inputMode="decimal" value={amount} onChange={e=>setAmount(e.target.value)} maxLength={15} disabled={busy} required/></label><label>Reason (optional)<textarea value={reason} onChange={e=>setReason(e.target.value)} maxLength={500} disabled={busy}/></label><div className={styles.actions}><button className={styles.destructive} type="button" onClick={()=>{setError('');setStep('delete');}} disabled={busy}>Delete Record</button><button type="button" onClick={onClose} disabled={busy}>Cancel</button><button type="submit" disabled={busy}>Save Changes</button></div></form>}
    </>}{error&&<p role="alert">{error}</p>}
  </dialog>;
}
