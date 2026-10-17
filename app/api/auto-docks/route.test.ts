import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({auth:vi.fn(),transaction:vi.fn(),settings:vi.fn()}));
vi.mock('@/lib/auth/session',()=>({isAuthenticatedRequest:mocks.auth}));
vi.mock('@/lib/auto-docks/service',()=>({autoDockDb:()=>({transaction:mocks.transaction}),readAutoDockSettings:mocks.settings,resultRows:(r:unknown)=>r}));
import {GET} from './route';
describe('automatic audit endpoint',()=>{
  beforeEach(()=>{vi.clearAllMocks();mocks.auth.mockResolvedValue(true);mocks.settings.mockResolvedValue({enabled:true,effectiveFrom:'2026-10-16',reliableFrom:'2026-10-16'});});
  it('reads serially inside one transaction and returns history',async()=>{
    let inFlight=0,max=0,index=0;
    const execute=vi.fn(async()=>{inFlight++;max=Math.max(max,inFlight);await Promise.resolve();inFlight--;return [[],[{status:'COMPLETED'}],[{employee_id:'a'}],[{n:0}],[{employee_id:'a',status:'voided'}]][index++];});
    mocks.transaction.mockImplementation(async fn=>fn({execute}));
    const response=await GET(new Request('https://example.test/api/auto-docks?date=2026-10-16'));
    expect(response.status).toBe(200);expect(max).toBe(1);expect(execute).toHaveBeenCalledTimes(5);expect(mocks.transaction).toHaveBeenCalledTimes(1);
    expect((await response.json()).docks).toEqual([{employee_id:'a',status:'voided'}]);
  });
  it('retains authentication and rejects invalid dates',async()=>{
    mocks.auth.mockResolvedValue(false);expect((await GET(new Request('https://example.test/api/auto-docks'))).status).toBe(401);
    mocks.auth.mockResolvedValue(true);expect((await GET(new Request('https://example.test/api/auto-docks?date=invalid'))).status).toBe(400);
    expect(mocks.transaction).not.toHaveBeenCalled();
  });
  it('logs the underlying failure without leaking it to the browser',async()=>{
    const log=vi.spyOn(console,'error').mockImplementation(()=>{});
    mocks.transaction.mockRejectedValue(Object.assign(new Error('EMAXCONNSESSION'),{code:'XX000'}));
    try{const response=await GET(new Request('https://example.test/api/auto-docks?date=2026-10-16'));expect(response.status).toBe(503);expect(await response.json()).toEqual({error:'Unable to load automatic dock audit'});expect(log).toHaveBeenCalledWith('[auto-dock] audit read failed',expect.objectContaining({code:'XX000'}));}finally{log.mockRestore();}
  });
});
