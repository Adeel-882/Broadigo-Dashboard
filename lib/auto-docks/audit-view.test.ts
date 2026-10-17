import {describe,it,expect} from 'vitest';
import {auditRows,ruleLabel,type AuditEvaluation,type AuditDock} from './audit-view';
const evaluation=(id:string,decision:string):AuditEvaluation=>({employee_id:id,evaluated_at:'2026-10-17',evidence:{employee:id,attendanceStatus:'PRESENT',appointments:0,role:'CLOSER',ruleCode:'closer_zero_calls',decision,amount:1500}});
const dock=(id:string,status:string):AuditDock=>({employee_id:id,rule_code:'closer_zero_sales',amount:'1500',status,void_reason:'Management correction',created_at:'2026-10-17',voided_at:null});
describe('automatic audit table',()=>{
  it('sorts decisions and excludes voided financial history from amounts',()=>{
    const rows=auditRows([evaluation('Z','SKIP_EXCLUDED'),evaluation('B','ACTIVITY_RECORDED'),evaluation('A','DOCK'),evaluation('C','SKIP_ABSENT')],[dock('Z','voided'),dock('A','active'),dock('A','voided'),dock('B','voided')]);
    expect(rows.map(r=>r.decision)).toEqual(['Docked','Voided','Skipped','Excluded']);
    expect(rows.map(r=>r.amount)).toEqual([1500,0,0,0]);
    expect(rows[3].role).toBe('Head of Sales');expect(rows[0].history).toHaveLength(2);
  });
  it('labels current call rules separately from historical sales rules',()=>{
    expect(ruleLabel('closer_zero_calls')).toBe('Closer — No calls');
    expect(ruleLabel('closer_zero_sales')).toContain('historical');
    expect(ruleLabel('appointment_setter_zero_appointments')).toBe('Setter — No calls');
    expect(auditRows([evaluation('A','ACTIVITY_RECORDED')],[])[0].decision).toBe('No dock');
  });
});
