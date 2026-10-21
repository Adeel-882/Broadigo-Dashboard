import {beforeEach,describe,expect,it,vi} from 'vitest';
const mocks=vi.hoisted(()=>({identity:vi.fn(),origin:vi.fn(),authorize:vi.fn(),body:vi.fn(),edit:vi.fn(),limit:vi.fn(),matches:vi.fn(),execute:vi.fn()}));
vi.mock('@/lib/auto-docks/edit-auth',()=>({editIdentity:mocks.identity,checkEditOrigin:mocks.origin,requireEditToken:mocks.authorize,editBody:mocks.body,limitEditAttempts:mocks.limit,passwordMatches:mocks.matches,createEditToken:()=> 'signed-fixture',EDIT_COOKIE:'leadsedge_dock_edit',EDIT_TTL:600}));
vi.mock('@/lib/auto-docks/edit-service',()=>({editAutomaticDock:mocks.edit}));
vi.mock('@/lib/auto-docks/service',()=>({autoDockDb:()=>({execute:mocks.execute}),resultRows:(r:unknown)=>r}));
import {DockEditError} from '@/lib/auto-docks/edit-validation';
import {PATCH,DELETE} from './[id]/route';
import {POST} from './edit-authorize/route';
const id='11111111-1111-4111-8111-111111111111';
const request=()=>new Request('https://example.test/api/auto-docks/'+id,{method:'PATCH'});
describe('protected automatic dock endpoints',()=>{
  beforeEach(()=>{vi.resetAllMocks();mocks.identity.mockResolvedValue({actor:'test@example.test',session:'fingerprint'});mocks.body.mockResolvedValue({id,password:'fixture-only',amount:'2500',reason:'test',expectedAmount:'3000.00'});mocks.edit.mockResolvedValue({changed:true});mocks.matches.mockReturnValue(true);mocks.execute.mockResolvedValue([{id}]);});
  it('rejects unauthenticated users even if password is correct',async()=>{mocks.identity.mockRejectedValue(new DockEditError('Unauthorized',401));expect((await POST(request())).status).toBe(401);expect((await PATCH(request(),{params:Promise.resolve({id})})).status).toBe(401);expect(mocks.edit).not.toHaveBeenCalled();expect(mocks.matches).not.toHaveBeenCalled();});
  it('returns generic wrong-password failure without granting a cookie',async()=>{mocks.matches.mockReturnValue(false);const r=await POST(request());expect(r.status).toBe(403);expect(await r.json()).toEqual({error:'Invalid edit password.'});expect(r.headers.has('set-cookie')).toBe(false);});
  it('grants only an HttpOnly scoped authorization',async()=>{const r=await POST(request());expect(r.status).toBe(200);expect(r.headers.get('set-cookie')).toContain('HttpOnly; SameSite=Strict');expect(await r.json()).toEqual({authorized:true});expect(mocks.limit).toHaveBeenCalled();});
  it('rejects missing/expired dock authorization before mutation',async()=>{mocks.authorize.mockImplementation(()=>{throw new DockEditError('Expired',403);});expect((await DELETE(request(),{params:Promise.resolve({id})})).status).toBe(403);expect(mocks.edit).not.toHaveBeenCalled();});
  it('runs only the automatic-dock transaction, with session identity',async()=>{expect((await PATCH(request(),{params:Promise.resolve({id})})).status).toBe(200);expect(mocks.edit).toHaveBeenCalledWith(id,'amount',expect.objectContaining({amount:'2500'}),{actor:'test@example.test',session:'fingerprint'});});
  it('does not authorize missing or manual dock IDs',async()=>{mocks.execute.mockResolvedValue([]);expect((await POST(request())).status).toBe(404);});
});
