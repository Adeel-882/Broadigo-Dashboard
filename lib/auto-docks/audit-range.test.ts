import {describe,it,expect} from 'vitest';
import {auditRange} from './audit-range';
import {auditRows,type AuditDock,type AuditEvaluation} from './audit-view';
describe('inclusive automatic business dates',()=>{
  it('includes 16 through 21 only',()=>{expect(auditRange(new URLSearchParams('from=2026-10-16&to=2026-10-21')).days).toEqual(['2026-10-16','2026-10-17','2026-10-18','2026-10-19','2026-10-20','2026-10-21']);});
  it('supports a single day',()=>{expect(auditRange(new URLSearchParams('from=2026-10-16&to=2026-10-16')).days).toEqual(['2026-10-16']);});
  it.each(['from=2026-10-21&to=2026-10-16','from=2026-02-30&to=2026-03-01','from=2026-10-16','from=2026-01-01&to=2026-10-21'])('rejects invalid input %s',s=>expect(()=>auditRange(new URLSearchParams(s))).toThrow());
  it('future dates are date labels, never fabricated evaluations',()=>{expect(auditRange(new URLSearchParams('from=2030-10-16&to=2030-10-21')).days).toHaveLength(6);expect(auditRows([],[])).toEqual([]);});
  it('keeps dates separate and ignores voided totals',()=>{
    const docks=[3000,3000,1500,1500,1500,3000].map((amount,i)=>({employee_id:'same',business_date:`2026-10-${16+i}`,amount:String(amount),status:i===5?'voided':'active',rule_code:'rule',created_at:'',voided_at:null,void_reason:null} satisfies AuditDock));
    const evaluations=docks.map(d=>({employee_id:d.employee_id,business_date:d.business_date,evaluated_at:'',evidence:{employee:'Same',role:'SETTER',attendanceStatus:'PRESENT',appointments:0,decision:'DOCK',amount:3000}} satisfies AuditEvaluation));
    const rows=auditRows(evaluations,docks);expect(rows).toHaveLength(6);expect(rows[0].business_date).toBe('2026-10-21');expect(rows.reduce((n,r)=>n+r.amount,0)).toBe(10500);expect(new Set(rows.map(r=>r.key)).size).toBe(6);
  });
});
