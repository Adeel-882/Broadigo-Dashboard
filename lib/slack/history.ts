import { and, eq } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { slackChannels, syncRuns } from "@/lib/db/schema";
import { ingestSlackHistoryBatch } from "@/lib/slack/ingest";

interface SlackHistoryResponse {
  ok: boolean;
  error?: string;
  messages?: Array<{ type: "message"; user?: string; text?: string; ts: string; thread_ts?: string; subtype?: string; reactions?: Array<{ name: string; count?: number; users?: string[] }> }>;
  response_metadata?: { next_cursor?: string };
}

async function withRetry<T>(operation:()=>Promise<T>){let last:unknown;for(let attempt=1;attempt<=4;attempt++){try{return await operation();}catch(error){last=error;if(attempt<4)await new Promise(resolve=>setTimeout(resolve,attempt*750));}}throw last;}

export async function importHistoryPage(workspaceId: string, slackChannelId: string, cursor?: string) {
  const db = getDb();
  const token = process.env.SLACK_BOT_TOKEN;
  if (!db || !token) throw new Error("Database and Slack bot token must be configured.");
  const [channel] = await db.select().from(slackChannels).where(and(eq(slackChannels.workspaceId, workspaceId), eq(slackChannels.slackChannelId, slackChannelId), eq(slackChannels.active, true))).limit(1);
  if (!channel) throw new Error("Channel is not in the configured reporting whitelist.");
  const [run] = await withRetry(()=>db.insert(syncRuns).values({ workspaceId, channelId: channel.id, status: "RUNNING", cursor }).returning());
  const params = new URLSearchParams({ channel: slackChannelId, limit: "100" });
  if (cursor) params.set("cursor", cursor);
  try {
    let response = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
    if(response.status===429){const wait=Math.max(1,Number(response.headers.get("retry-after")??1));await new Promise(resolve=>setTimeout(resolve,wait*1000));response=await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });}
    const payload = await response.json() as SlackHistoryResponse;
    if (!payload.ok) throw new Error(payload.error ?? "Slack history request failed.");
    const {imported}=await withRetry(()=>ingestSlackHistoryBatch(workspaceId,slackChannelId,payload.messages??[]));
    const nextCursor = payload.response_metadata?.next_cursor || null;
    await withRetry(()=>db.update(syncRuns).set({ status: "COMPLETED", cursor: nextCursor, messagesImported: imported, completedAt: new Date() }).where(eq(syncRuns.id, run.id)));
    return { imported, nextCursor, complete: !nextCursor };
  } catch (error) {
    await withRetry(()=>db.update(syncRuns).set({ status: "FAILED", error: error instanceof Error ? error.message.slice(0, 500) : "Unknown sync error", completedAt: new Date() }).where(eq(syncRuns.id, run.id))).catch(()=>undefined);
    throw error;
  }
}

export async function importAllConfiguredHistory() {
  const db=getDb(); if(!db)throw new Error("DATABASE_URL is required.");
  await db.update(syncRuns).set({status:"FAILED",error:"Interrupted before completion; safely resumable.",completedAt:new Date()}).where(eq(syncRuns.status,"RUNNING"));
  const configured=await db.select().from(slackChannels).where(eq(slackChannels.active,true));
  if(!configured.length)throw new Error("No active Slack channels are mapped. Complete the Setup screen first.");
  const results:Array<{name:string;imported:number;pages:number}> = [];
  for(const channel of configured){let cursor: string|undefined;let imported=0;let pages=0;do{const page=await importHistoryPage(channel.workspaceId,channel.slackChannelId,cursor);imported+=page.imported;pages+=1;cursor=page.nextCursor||undefined;}while(cursor);results.push({name:channel.name,imported,pages});}
  return results;
}
