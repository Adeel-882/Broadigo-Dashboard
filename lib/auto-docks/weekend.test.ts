import {describe,it,expect,vi,beforeEach} from 'vitest';
const mocks=vi.hoisted(()=>({execute:vi.fn(),transaction:vi.fn()}));
vi.mock('@/lib/db/client',()=>({getDb:()=>mocks}));
import {evaluateBusinessDay} from './service';
import {evaluateAutoDockState,type EvaluationInput} from './policy';
import {autoDockBusinessDateFor,isAutoDockWeekend} from './time';
import {auditRows,type AuditEvaluation} from './audit-view';
const base:EvaluationInput={businessDate:'2026-11-23',employeeId:'setter',title:'Appointment Setter',active:true,membershipEligible:true,checkInFound:true,attendanceReliable:true,exempt:false,appointments:0,sales:0};
describe('Karachi business-date weekend exclusion',()=>{
 it.each(['2026-11-21','2026-11-22'])('excludes everyone on %s before attendance or Harvey rules',businessDate=>{
  for(const employeeId of ['setter','closer','03cfda43-9721-41e0-b7fe-60f40538aa29','d2bf73cc-c9f6-48a8-be72-61b827e39619','e18ba4b0-0b55-4615-b01d-c83379049b9f'])for(const title of ['Closer','Appointment Setter','Future role']){
   const result=evaluateAutoDockState({...base,businessDate,employeeId,title});expect(result.decision).toBe('WEEKEND_EXCLUDED');expect(result.amount).toBe(0);expect(result.ruleCode).toBeNull();
  }
 });
 it.each(['2026-11-20','2026-11-23'])('preserves weekday rules %s',businessDate=>{
  expect(evaluateAutoDockState({...base,businessDate}).amount).toBe(3000);
  expect(evaluateAutoDockState({...base,businessDate,title:'Closer'}).amount).toBe(1500);
  for(const appointments of [0,1])expect(evaluateAutoDockState({...base,businessDate,employeeId:'03cfda43-9721-41e0-b7fe-60f40538aa29',checkInFound:false,appointments}).amount).toBe(appointments?0:3000);
 });
 it.each([['2026-11-21T18:59:59+05:00',null],['2026-11-21T19:00:00+05:00','2026-11-21'],['2026-11-22T03:59:59+05:00','2026-11-21'],['2026-11-22T04:00:00+05:00',null],['2026-11-22T19:00:00+05:00','2026-11-22'],['2026-11-23T03:59:59+05:00','2026-11-22'],['2026-11-23T04:00:00+05:00',null]])('uses shift-start day for %s',(stamp,expected)=>{const day=autoDockBusinessDateFor(new Date(stamp!));expect(day).toBe(expected);if(day)expect(isAutoDockWeekend(day)).toBe(true)});
 it('projects historical weekend evaluations without altering original evidence',()=>{
  const row:AuditEvaluation={employee_id:'setter',business_date:'2026-11-21',evaluated_at:'2026-11-22',evidence:{employee:'Setter',attendanceStatus:'PRESENT',appointments:0,role:'SETTER',decision:'DOCK',amount:3000}};
  const original=JSON.stringify(row);const [view]=auditRows([row],[{employee_id:'setter',business_date:'2026-11-21',rule_code:'appointment_setter_zero_appointments',amount:'3000',status:'voided',void_reason:'Weekend',created_at:'2026-11-22',voided_at:'2026-11-24'}]);
  expect(view.decision).toBe('Excluded');expect(view.amount).toBe(0);expect(view.weekend).toBe(true);expect(JSON.stringify(row)).toBe(original);
 });
});
describe('core evaluator blocks weekend financial execution',()=>{
 beforeEach(()=>{vi.clearAllMocks();mocks.execute.mockResolvedValue([{enabled:true,workspace_id:'w',general_channel_id:'g',attendance_reliable_from:'2026-10-16',effective_from:'2026-10-16',calls_rule_effective_from:'2026-10-16',approved_check_in_phrases:['check in']}])});
 it.each(['2026-11-21','2026-11-22'])('does not enter financial transaction or query activity for %s',async date=>{const result=await evaluateBusinessDay(date,true,new Date('2026-11-24T12:00:00Z'));expect(result).toMatchObject({decision:'WEEKEND_EXCLUDED'});expect(result.created).toBe(0);expect(mocks.transaction).not.toHaveBeenCalled();expect(mocks.execute).toHaveBeenCalledTimes(2)});
});

