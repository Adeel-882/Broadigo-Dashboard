import { after } from "next/server";
import { ingestSlackEvent } from "@/lib/slack/ingest";
import { ingestSlackReactionEvent } from "@/lib/slack/reaction-events";
import { verifySlackSignature } from "@/lib/slack/signature";
import type { SlackEnvelope, SlackEventCallback, SlackReactionEventCallback } from "@/lib/slack/types";
import { classifySlackEnvelope } from "@/lib/slack/event-routing";

export const runtime = "nodejs";
export const maxDuration = 30;

export async function POST(request: Request) {
  const rawBody = await request.text();
  if (!verifySlackSignature(rawBody, request.headers.get("x-slack-request-timestamp"), request.headers.get("x-slack-signature"))) {
    return Response.json({ error: "Invalid Slack signature" }, { status: 401 });
  }
  let payload: SlackEnvelope;
  try { payload = JSON.parse(rawBody) as SlackEnvelope; }
  catch { return Response.json({ error: "Invalid JSON payload" }, { status: 400 }); }

  const routing=classifySlackEnvelope(payload);
  if(routing.action==="verify")return new Response(routing.challenge,{status:200,headers:{"content-type":"text/plain"}});
  if(routing.action==="ignore")return Response.json({ok:true,ignored:routing.reason});
  if(routing.action==="reaction"){after(async () => { await ingestSlackReactionEvent(payload as unknown as SlackReactionEventCallback); });return Response.json({ ok: true }, { status: 200 });}
  after(async () => { await ingestSlackEvent(payload as SlackEventCallback); });
  return Response.json({ ok: true }, { status: 200 });
}
