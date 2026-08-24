import { describe,expect,it } from "vitest";
import { classifySlackEnvelope } from "./event-routing";
import type { SlackEnvelope } from "./types";

describe("Slack event routing",()=>{
  it("returns the URL verification challenge",()=>{expect(classifySlackEnvelope({type:"url_verification",challenge:"abc",token:"ignored"} as SlackEnvelope)).toEqual({action:"verify",challenge:"abc"})});
  it.each(["C012PUBLIC","G012PRIVATE"])("ingests message event from %s (message.channels/message.groups)",(channel)=>{expect(classifySlackEnvelope({type:"event_callback",event_id:"Ev1",team_id:"T1",event:{type:"message",channel,user:"U1",text:"hello",ts:"1.0"}} as SlackEnvelope)).toEqual({action:"ingest"})});
  it("routes appointment-channel thread replies to disposition handling",()=>{expect(classifySlackEnvelope({type:"event_callback",event_id:"Ev1",team_id:"T1",event:{type:"message",channel:"C098WNHNBR7",user:"U1",text:"Qualified",ts:"1",thread_ts:"0.9"}} as SlackEnvelope).action).toBe("appointment-disposition")});
  it("leaves unrelated-channel thread replies ignored",()=>{expect(classifySlackEnvelope({type:"event_callback",event_id:"Ev1",team_id:"T1",event:{type:"message",channel:"C1",user:"U1",text:"Qualified",ts:"1",thread_ts:"0.9"}} as SlackEnvelope)).toEqual({action:"ignore",reason:"thread-or-message-subtype"})});
  it("keeps a top-level message eligible after Slack adds its own timestamp as thread_ts",()=>{expect(classifySlackEnvelope({type:"event_callback",event_id:"Ev1",team_id:"T1",event:{type:"message",channel:"C1",user:"U1",text:"sale",ts:"1.0",thread_ts:"1.0"}} as SlackEnvelope).action).toBe("ingest")});
  it("ingests a top-level message_changed event using the nested message",()=>{expect(classifySlackEnvelope({type:"event_callback",event_id:"Ev2",team_id:"T1",event:{type:"message",subtype:"message_changed",channel:"C1",text:"",ts:"2.0",message:{type:"message",channel:"C1",user:"U1",text:"edited sale",ts:"1.0",thread_ts:"1.0"}}} as SlackEnvelope).action).toBe("ingest")});
});
