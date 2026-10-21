export interface AuditEvaluation {
  employee_id:string; evaluated_at:string;business_date?:string;
  evidence:{employee:string;attendanceStatus:string;appointments:number;sales?:number;role:string;ruleCode?:string;decision:string;amount:number;windowStart?:string;windowEnd?:string;checkIns?:Array<{channel:string;ts:string}>;calls?:Array<{channel:string;name:string;ts:string}>};
}
export interface AuditDock {id?:string;employee_id:string;business_date?:string;rule_code:string;amount:string;status:string;void_reason:string|null;created_at:string;voided_at:string|null;system_amount?:string;override_type?:'amount'|'deleted'|null;override_reason?:string;edited_by?:string;edited_at?:string;edit_history?:Array<{action:string;old_amount:string;new_amount:string;reason:string;actor:string;created_at:string}>}
export const ruleLabel=(code?:string)=>code==='closer_zero_sales'?'Closer — No sales (historical)':code==='closer_zero_calls'?'Closer — No calls':code==='appointment_setter_zero_appointments'?'Setter — No calls':'—';
export function auditRows(evaluations:AuditEvaluation[],docks:AuditDock[]){
  const rank:Record<string,number>={Docked:0,Voided:1,'Admin deleted':1,'No dock':2,Skipped:3,Excluded:4,Exempt:4};
  return evaluations.map(row=>{
    const e=row.evidence,history=docks.filter(d=>d.employee_id===row.employee_id&&d.business_date===row.business_date),active=history.filter(d=>d.status==='active');
    const decision=e.decision==='SKIP_EXCLUDED'?'Excluded':e.decision==='SKIP_EXEMPT'?'Exempt':active.length?'Docked':history.some(d=>d.status==='admin_deleted')?'Admin deleted':e.decision.startsWith('SKIP')?'Skipped':history.some(d=>d.status==='voided')?'Voided':'No dock';
    return {...row,key:`${row.business_date}:${row.employee_id}`,history,decision,amount:active.reduce((sum,d)=>sum+Number(d.amount),0),role:e.decision==='SKIP_EXCLUDED'?'Head of Sales':e.role==='SETTER'?'Setter':e.role==='CLOSER'?'Closer':e.role,attendance:e.attendanceStatus==='BYPASSED'?'Bypass':e.attendanceStatus.charAt(0)+e.attendanceStatus.slice(1).toLowerCase()};
  }).sort((a,b)=>(b.business_date??'').localeCompare(a.business_date??'')||rank[a.decision]-rank[b.decision]||a.evidence.employee.localeCompare(b.evidence.employee));
}
