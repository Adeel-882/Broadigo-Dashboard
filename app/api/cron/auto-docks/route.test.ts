import {afterEach,expect,it,vi} from "vitest";
vi.mock("@/lib/auto-docks/scheduler",()=>({runDailyAutoDocks:vi.fn(async()=>({enabled:true,results:[]}))}));
import {GET} from "./route";
import {runDailyAutoDocks} from "@/lib/auto-docks/scheduler";
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});
it("rejects absent or incorrect secrets before evaluating",async()=>{
  vi.stubEnv("CRON_SECRET","test-only-secret");
  for(const authorization of ["","Bearer wrong"]){expect((await GET(new Request("http://localhost/api/cron/auto-docks",{headers:{authorization}}))).status).toBe(401);}
  expect(runDailyAutoDocks).not.toHaveBeenCalled();
});
it("fails closed if no secret configured",async()=>{vi.stubEnv("CRON_SECRET","");expect((await GET(new Request("http://localhost/api/cron/auto-docks"))).status).toBe(401);});
it("runs only with valid scheduler credentials",async()=>{vi.stubEnv("CRON_SECRET","test-only-secret");expect((await GET(new Request("http://localhost/api/cron/auto-docks",{headers:{authorization:"Bearer test-only-secret"}}))).status).toBe(200);expect(runDailyAutoDocks).toHaveBeenCalledOnce();});
