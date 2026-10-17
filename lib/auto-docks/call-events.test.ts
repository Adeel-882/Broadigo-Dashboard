import {describe,it,expect,vi} from "vitest";
import {PgDialect} from "drizzle-orm/pg-core";
import type {SQL} from "drizzle-orm";
const execute=vi.hoisted(()=>vi.fn<(query:SQL)=>Promise<unknown[]>>(async()=>[]));
vi.mock("@/lib/db/client",()=>({getDb:()=>({execute})}));
import {ingestAutoDockCallDeletion} from "./call-events";
import {classifySlackEnvelope} from "@/lib/slack/event-routing";
const payload={type:"event_callback" as const,team_id:"workspace",event_id:"event",event:{type:"message" as const,channel:"C098WNHNBR7",ts:"1792270000.000001",deleted_ts:"1792260000.000001",subtype:"message_deleted"}};
describe("automatic dock call deletion",()=>{
  it("routes only approved channels and preserves all records",async()=>{
    execute.mockClear();expect(classifySlackEnvelope(payload).action).toBe("auto-dock-call-deleted");
    await ingestAutoDockCallDeletion(payload);
    expect(execute).toHaveBeenCalledTimes(1);
    const query=new PgDialect().sqlToQuery(execute.mock.calls[0][0]);
    expect(query.sql).toContain("source_unavailable_at=now()");expect(query.sql).not.toMatch(/delete\s+from/i);
    expect(query.params).toContain(payload.event.deleted_ts);expect(query.params).not.toContain(payload.event.ts);
    expect(query.sql).toContain("exists(select 1 from appointments");expect(query.sql).toContain("source_unavailable_at is null");
  });
  it("does not route unrelated channel or reply deletion to dock activity",async()=>{
    execute.mockClear();const other={...payload,event:{...payload.event,channel:"unrelated"}};
    expect(classifySlackEnvelope(other).action).toBe("ignore");await ingestAutoDockCallDeletion(other);expect(execute).not.toHaveBeenCalled();
    expect(classifySlackEnvelope({...payload,event:{...payload.event,subtype:undefined,thread_ts:"1.000001",text:"Qualified"}}).action).toBe("appointment-disposition");
  });
});
