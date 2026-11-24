import { afterEach,expect,it,vi } from "vitest";
vi.mock("./service",()=>({autoDockDb:vi.fn(),readAutoDockSettings:vi.fn(),resultRows:vi.fn()}));
import {attendanceCandidate,syncAttendanceDay} from "./attendance";
import {autoDockDb,readAutoDockSettings} from "./service";
afterEach(()=>{vi.unstubAllGlobals();vi.unstubAllEnvs();vi.clearAllMocks();});
it("only classifies human top-level messages, never threads or bot messages",()=>{
  expect(attendanceCandidate({ts:"1.1",user:"U1",text:"check in"})).toBe(true);
  expect(attendanceCandidate({ts:"1.1",user:"U1",thread_ts:"1.1"})).toBe(true);
  for(const extra of [{subtype:"bot_message"},{bot_id:"B1"},{thread_ts:"0.1"},{user:undefined}])expect(attendanceCandidate({ts:"1.1",user:"U1",...extra})).toBe(false);
});
it('does not certify limited attendance history or write an absence without a boundary witness',async()=>{
  vi.stubEnv('SLACK_BOT_TOKEN','test-only');
  vi.mocked(readAutoDockSettings).mockResolvedValue({enabled:false,workspaceId:'workspace',generalChannelId:'general',reliableFrom:'2026-10-16',effectiveFrom:'2026-10-16',callsRuleEffectiveFrom:'2026-10-16',phrases:['check in']});
  vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response(JSON.stringify({ok:true,is_limited:true,messages:[]}))));
  await expect(syncAttendanceDay('2026-10-16')).rejects.toThrow('coverage incomplete');
  expect(autoDockDb).not.toHaveBeenCalled();
});
