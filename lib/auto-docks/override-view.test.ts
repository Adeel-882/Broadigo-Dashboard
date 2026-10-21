import {describe,it,expect} from 'vitest';
import {auditRows,type AuditDock,type AuditEvaluation} from './audit-view';
describe('effective audit presentation',()=>{
  const evaluation:AuditEvaluation={employee_id:'employee',business_date:'2026-10-16',evaluated_at:'now',evidence:{employee:'Fixture',role:'SETTER',attendanceStatus:'PRESENT',appointments:0,decision:'DOCK',amount:3000}};
  const dock:AuditDock={id:'dock',employee_id:'employee',business_date:'2026-10-16',rule_code:'appointment_setter_zero_appointments',amount:'2500.00',system_amount:'3000.00',override_type:'amount',status:'active',void_reason:null,created_at:'now',voided_at:null};
  it('uses adjusted effective amounts, including zero',()=>{expect(auditRows([evaluation],[dock])[0].amount).toBe(2500);expect(auditRows([evaluation],[{...dock,amount:'0.00'}])[0]).toMatchObject({amount:0,decision:'Docked'});});
  it('keeps admin-deleted history outside active totals',()=>{expect(auditRows([evaluation],[{...dock,amount:'0',override_type:'deleted',status:'admin_deleted'}])[0]).toMatchObject({amount:0,decision:'Admin deleted'});});
});
