import { expect,it,vi } from "vitest";
vi.mock("./service",()=>({autoDockDb:vi.fn(),readAutoDockSettings:vi.fn(),resultRows:vi.fn()}));
import {attendanceCandidate} from "./attendance";
it("only classifies human top-level messages, never threads or bot messages",()=>{
  expect(attendanceCandidate({ts:"1.1",user:"U1",text:"check in"})).toBe(true);
  expect(attendanceCandidate({ts:"1.1",user:"U1",thread_ts:"1.1"})).toBe(true);
  for(const extra of [{subtype:"bot_message"},{bot_id:"B1"},{thread_ts:"0.1"},{user:undefined}])expect(attendanceCandidate({ts:"1.1",user:"U1",...extra})).toBe(false);
});
