import {afterEach,beforeEach,describe,it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({execute:vi.fn()}));
vi.mock('./service',()=>({autoDockDb:()=>({execute:mocks.execute}),resultRows:(r:unknown)=>r}));
import {createSession,sessionCookie} from '@/lib/auth/session';
import {checkEditOrigin,createEditToken,editBody,editIdentity,limitEditAttempts,passwordMatches,validEditToken} from './edit-auth';
import {dockId,editReason,moneyAmount} from './edit-validation';
describe('automatic dock edit authorization',()=>{
  beforeEach(()=>{vi.stubEnv('SESSION_SECRET','test-session-secret-at-least-32-characters');vi.stubEnv('DOCK_EDIT_PASSWORD','fixture-password-not-production');mocks.execute.mockReset();});
  afterEach(()=>vi.unstubAllEnvs());
  it('compares correct and incorrect passwords on the server, failing closed if unset',()=>{expect(passwordMatches('wrong')).toBe(false);expect(passwordMatches('fixture-password-not-production')).toBe(true);vi.stubEnv('DOCK_EDIT_PASSWORD','');expect(()=>passwordMatches('')).toThrow('not configured');});
  it('requires a real signed normal session, not a password or demo bypass',async()=>{
    vi.stubEnv('DEMO_AUTH_BYPASS','true');await expect(editIdentity(new Request('https://example.test'))).rejects.toThrow('Unauthorized');
    const token=await createSession('fixture@example.test');const identity=await editIdentity(new Request('https://example.test',{headers:{cookie:`${sessionCookie.name}=${token}`}}));
    expect(identity.actor).toBe('fixture@example.test');expect(identity.session).toHaveLength(64);expect(identity.session).not.toBe(token);
  });
  it('authorization is scoped, tamper-proof, expires, and is invalidated by secret rotation',()=>{
    const now=Date.now(),token=createEditToken('session','dock',now);
    expect(validEditToken(token,'session','dock',now)).toBe(true);
    expect(validEditToken(token,'other','dock',now)).toBe(false);expect(validEditToken(token,'session','other',now)).toBe(false);
    expect(validEditToken(token+'x','session','dock',now)).toBe(false);expect(validEditToken(token,'session','dock',now+600000)).toBe(false);
    vi.stubEnv('DOCK_EDIT_PASSWORD','rotated-test-only');expect(validEditToken(token,'session','dock',now)).toBe(false);
  });
  it('rejects cross-site or missing origins and non-JSON requests',()=>{
    const req=(origin?:string,type='application/json')=>new Request('https://example.test/api',{headers:{...(origin?{origin}:{}),'Content-Type':type}});
    expect(()=>checkEditOrigin(req('https://example.test'))).not.toThrow();expect(()=>checkEditOrigin(req('https://evil.test'))).toThrow();expect(()=>checkEditOrigin(req())).toThrow();expect(()=>checkEditOrigin(req('https://example.test','text/plain'))).toThrow();
  });
  it('limits attempts durably and caps request size',async()=>{
    mocks.execute.mockResolvedValue([{attempts:6}]);await expect(limitEditAttempts(new Request('https://example.test'),'session')).rejects.toThrow('Too many');
    await expect(editBody(new Request('https://example.test',{method:'POST',body:'x'.repeat(4097)}))).rejects.toThrow('too large');
  });
});
describe('money-safe override validation',()=>{
  it.each([['0','0.00'],['2500','2500.00'],['2500.1','2500.10'],['999999999999.99','999999999999.99']])('accepts %s exactly',(v,want)=>expect(moneyAmount(v)).toBe(want));
  it.each(['-1','NaN','Infinity','1e3','1.001','1000000000000','',null,2500])('rejects %s',v=>expect(()=>moneyAmount(v)).toThrow());
  it('validates target and deletion reason',()=>{expect(()=>dockId('manual:123')).toThrow();expect(()=>editReason('',true)).toThrow();expect(editReason('')).toBe('Manual dashboard adjustment');});
});
