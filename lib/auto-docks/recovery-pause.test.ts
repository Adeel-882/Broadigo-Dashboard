import {expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({execute:vi.fn(),transaction:vi.fn()}));
vi.mock('@/lib/db/client',()=>({getDb:()=>mocks}));
import {evaluateBusinessDay} from './service';
it('paused recovery cannot turn a historical evaluation into a financial dock',async()=>{
  mocks.execute.mockResolvedValue([{enabled:false,workspace_id:'workspace',general_channel_id:'general',attendance_reliable_from:'2026-10-16',effective_from:'2026-10-16',calls_rule_effective_from:'2026-10-16',approved_check_in_phrases:['check in']}]);
  await expect(evaluateBusinessDay('2026-10-16',true,new Date('2026-11-24T12:00:00Z'))).rejects.toThrow('writes disabled');
  expect(mocks.execute).toHaveBeenCalledTimes(1); // Settings read only; no run or financial insert.
  expect(mocks.transaction).not.toHaveBeenCalled();
});
