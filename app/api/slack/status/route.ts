import { eq } from "drizzle-orm";
import { isAuthenticatedRequest } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { slackChannels, slackMessages } from "@/lib/db/schema";
import { isEligibleTopLevelMessage } from "@/lib/slack/message-eligibility";

type SlackResponse={ok:boolean;error?:string;messages?:Array<{ts?:string;text?:string;thread_ts?:string;subtype?:string}>};

export async function GET(request:Request){
  if(!(await isAuthenticatedRequest(request)))return Response.json({error:"Unauthorized"},{status:401});
  const db=getDb(),token=process.env.SLACK_BOT_TOKEN;if(!db||!token)return Response.json({error:"Database and Slack bot token must be configured."},{status:503});
  try{
    const channels=await db.select().from(slackChannels).where(eq(slackChannels.active,true));
    const results=[];let newestSlackMs=0,newestDbMs=0,totalMissing=0;
    for(const channel of channels){
      const [response,stored]=await Promise.all([
        fetch(`https://slack.com/api/conversations.history?channel=${encodeURIComponent(channel.slackChannelId)}&limit=100`,{headers:{authorization:`Bearer ${token}`},cache:"no-store"}),
        db.select({slackTs:slackMessages.slackTs,postedAt:slackMessages.postedAt}).from(slackMessages).where(eq(slackMessages.channelId,channel.id)),
      ]);
      const payload=await response.json() as SlackResponse;if(!response.ok||!payload.ok)throw new Error(`Slack check failed for #${channel.name}: ${payload.error??response.status}`);
      const ids=new Set(stored.map(message=>message.slackTs));const eligible=(payload.messages??[]).filter(isEligibleTopLevelMessage);const missing=eligible.filter(message=>!ids.has(message.ts!)).length;totalMissing+=missing;
      const slackNewest=eligible.reduce((max,message)=>Math.max(max,Number.parseFloat(message.ts!)*1000),0);const dbNewest=stored.reduce((max,message)=>Math.max(max,message.postedAt.getTime()),0);newestSlackMs=Math.max(newestSlackMs,slackNewest);newestDbMs=Math.max(newestDbMs,dbNewest);
      results.push({channel:channel.name,missingRecent:missing,newestSlackAt:slackNewest?new Date(slackNewest).toISOString():null,newestDbAt:dbNewest?new Date(dbNewest).toISOString():null});
    }
    return Response.json({status:totalMissing===0?"COMPLETE":"INCOMPLETE",missingRecent:totalMissing,newestSlackAt:newestSlackMs?new Date(newestSlackMs).toISOString():null,newestDbAt:newestDbMs?new Date(newestDbMs).toISOString():null,checkedAt:new Date().toISOString(),channels:results});
  }catch(error){return Response.json({error:error instanceof Error?error.message:"Unable to check Slack completeness."},{status:502});}
}
