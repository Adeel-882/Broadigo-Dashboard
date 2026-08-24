import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import { appointments, docks, leads, mediaActivities, sales, slackChannels, slackEvents, slackIdentities, slackMessages } from "@/lib/db/schema";
import { parserRegistry } from "@/lib/parsers/registry";
import { resolveStructuredAttribution } from "@/lib/slack/attribution";
import { isEligibleTopLevelMessage, normalizeSlackMessageEvent } from "@/lib/slack/message-eligibility";
import { deriveLeadEligibility, reactionsFingerprint, type SlackReaction } from "@/lib/slack/reactions";
import type { SlackEventCallback, SlackMessageEvent } from "@/lib/slack/types";

type Db = NonNullable<ReturnType<typeof getDb>>;
type Transaction = Parameters<Parameters<Db["transaction"]>[0]>[0];
type Database = Db | Transaction;
type Channel = typeof slackChannels.$inferSelect;
type Message = typeof slackMessages.$inferSelect;
function slackDate(ts:string){return new Date(Number.parseFloat(ts)*1000)}

async function processStoredMessage(db:Database,channel:Channel,message:Message){
  const result=parserRegistry.parse(channel.parserType,{rawSourceId:message.id,text:message.rawText,postedAt:message.postedAt,employeeId:message.employeeId});
  if(!result){if(channel.parserType==="leads")await db.delete(leads).where(eq(leads.slackMessageId,message.id));await db.update(slackMessages).set({parserStatus:"UNPARSED",validationWarnings:["No conservative parser rule matched"]}).where(eq(slackMessages.id,message.id));return {status:"unparsed" as const};}
  const identities=result.recordType==="DOCK"?await db.select().from(slackIdentities).where(eq(slackIdentities.workspaceId,message.workspaceId)):[];
  const attribution=resolveStructuredAttribution(result.recordType,message.employeeId,result.values,new Map(identities.map(identity=>[identity.slackUserId,identity.employeeId])));
  const warnings=[...result.warnings,...attribution.warnings];
  const base={slackMessageId:message.id,employeeId:attribution.employeeId,teamId:channel.teamId,occurredAt:message.postedAt,confidence:String(result.confidence)};const value=(key:string)=>result.values[key] as string|null|undefined;const dateValue=(key:string)=>{const raw=value(key);return raw?new Date(raw):null};
  if(result.recordType==="APPOINTMENT")await db.insert(appointments).values({...base,prospectName:value("prospectName"),phone:value("phone"),state:value("state"),scheduledAt:dateValue("scheduledAt"),originalTimezone:value("originalTimezone"),assignedPerson:value("assignedPerson"),scheduledText:value("scheduledText")}).onConflictDoUpdate({target:appointments.slackMessageId,set:{employeeId:base.employeeId,teamId:base.teamId,occurredAt:base.occurredAt,confidence:base.confidence,prospectName:value("prospectName"),phone:value("phone"),state:value("state"),scheduledAt:dateValue("scheduledAt"),originalTimezone:value("originalTimezone"),assignedPerson:value("assignedPerson"),scheduledText:value("scheduledText")}});
  if(result.recordType==="SALE")await db.insert(sales).values({...base,customerName:value("customerName"),phone:value("phone"),email:value("email"),packageName:value("packageName"),amount:result.values.amount==null?null:String(result.values.amount),currency:value("currency")??"USD",state:value("state"),zipCodes:result.values.zipCodes as string[]}).onConflictDoUpdate({target:sales.slackMessageId,set:{employeeId:base.employeeId,teamId:base.teamId,occurredAt:base.occurredAt,confidence:base.confidence,customerName:value("customerName"),phone:value("phone"),email:value("email"),packageName:value("packageName"),amount:result.values.amount==null?null:String(result.values.amount),currency:value("currency")??"USD",state:value("state"),zipCodes:result.values.zipCodes as string[]}});
  if(result.recordType==="LEAD"){const eligibility=deriveLeadEligibility(message.reactions);await db.insert(leads).values({...base,leadType:value("leadType"),contactName:value("contactName"),phone:value("phone"),email:value("email"),propertyType:value("propertyType"),state:value("state"),timeline:value("timeline"),details:result.values.details as unknown as Record<string,string>,countsTowardKpi:eligibility.countsTowardKpi,exclusionReasons:eligibility.exclusionReasons}).onConflictDoUpdate({target:leads.slackMessageId,set:{employeeId:base.employeeId,teamId:base.teamId,occurredAt:base.occurredAt,confidence:base.confidence,leadType:value("leadType"),contactName:value("contactName"),phone:value("phone"),email:value("email"),propertyType:value("propertyType"),state:value("state"),timeline:value("timeline"),details:result.values.details as unknown as Record<string,string>,countsTowardKpi:eligibility.countsTowardKpi,exclusionReasons:eligibility.exclusionReasons}});}
  if(result.recordType==="DOCK"&&result.values.amount!=null&&value("reason"))await db.insert(docks).values({...base,amount:String(result.values.amount),currency:value("currency")??"PKR",reason:value("reason")!,appliedBy:value("appliedBy"),notes:value("notes")}).onConflictDoUpdate({target:docks.slackMessageId,set:{employeeId:base.employeeId,teamId:base.teamId,occurredAt:base.occurredAt,confidence:base.confidence,amount:String(result.values.amount),currency:value("currency")??"PKR",reason:value("reason")!,appliedBy:value("appliedBy"),notes:value("notes")}});
  if(result.recordType==="MEDIA_ACTIVITY")await db.insert(mediaActivities).values({...base,classification:value("classification")!,summary:value("summary")!,blocker:value("blocker")}).onConflictDoUpdate({target:mediaActivities.slackMessageId,set:{employeeId:base.employeeId,teamId:base.teamId,occurredAt:base.occurredAt,confidence:base.confidence,classification:value("classification")!,summary:value("summary")!,blocker:value("blocker")}});
  await db.update(slackMessages).set({parserStatus:"PARSED",validationWarnings:warnings}).where(eq(slackMessages.id,message.id));
  return {status:"parsed" as const,recordType:result.recordType};
}

export async function ingestSlackEvent(payload:SlackEventCallback){
  const db=getDb("ingestion");if(!db)return {status:"database-not-configured" as const};const event=normalizeSlackMessageEvent(payload.event as SlackMessageEvent);
  if(!event)return {status:"ignored" as const};
  return db.transaction(async tx=>{
    const [channel]=await tx.select().from(slackChannels).where(and(eq(slackChannels.workspaceId,payload.team_id),eq(slackChannels.slackChannelId,event.channel),eq(slackChannels.active,true))).limit(1);
    if(!channel){
      // Separate "wrong workspace" from "channel not mapped/inactive" so the
      // diagnostics say which half of the mapping failed.
      const [anyInWorkspace]=await tx.select({id:slackChannels.id}).from(slackChannels).where(eq(slackChannels.workspaceId,payload.team_id)).limit(1);
      return {status:"unconfigured-channel" as const,workspaceMatched:Boolean(anyInWorkspace),channelMatched:false};
    }
    const claimed=await tx.insert(slackEvents).values({eventId:payload.event_id,workspaceId:payload.team_id}).onConflictDoNothing().returning({id:slackEvents.id});
    const [existing]=await tx.select().from(slackMessages).where(and(eq(slackMessages.workspaceId,payload.team_id),eq(slackMessages.channelId,channel.id),eq(slackMessages.slackTs,event.ts))).limit(1);
    if(existing){
      if(existing.rawText!==event.text||existing.slackUserId!==event.user){const [identity]=event.user?await tx.select().from(slackIdentities).where(and(eq(slackIdentities.workspaceId,payload.team_id),eq(slackIdentities.slackUserId,event.user))).limit(1):[];const [updated]=await tx.update(slackMessages).set({rawText:event.text!,slackUserId:event.user,employeeId:identity?.employeeId??null,parserType:channel.parserType}).where(eq(slackMessages.id,existing.id)).returning();return processStoredMessage(tx,channel,updated);}
      if(existing.parserStatus==="PENDING"||existing.parserStatus==="ERROR")return processStoredMessage(tx,channel,existing);return {status:"duplicate" as const};
    }
    if(!claimed.length){/* Recover an event claimed before an earlier non-transactional write failed. */}
    const [identity]=event.user?await tx.select().from(slackIdentities).where(and(eq(slackIdentities.workspaceId,payload.team_id),eq(slackIdentities.slackUserId,event.user))).limit(1):[];
    const [message]=await tx.insert(slackMessages).values({workspaceId:payload.team_id,channelId:channel.id,slackTs:event.ts,slackUserId:event.user,employeeId:identity?.employeeId,rawText:event.text!,postedAt:slackDate(event.ts),parserType:channel.parserType}).onConflictDoNothing().returning();
    if(!message)return {status:"duplicate" as const};return processStoredMessage(tx,channel,message);
  });
}

export interface SlackHistoryMessage { user?:string;text?:string;ts:string;thread_ts?:string;subtype?:string;reactions?:SlackReaction[] }
export async function ingestSlackHistoryBatch(workspaceId:string,slackChannelId:string,history:SlackHistoryMessage[]){
  const db=getDb();if(!db)throw new Error("DATABASE_URL is required.");const usable=history.filter((message):message is SlackHistoryMessage&{text:string}=>isEligibleTopLevelMessage(message));if(!usable.length)return {imported:0};
  return db.transaction(async tx=>{
    const [channel]=await tx.select().from(slackChannels).where(and(eq(slackChannels.workspaceId,workspaceId),eq(slackChannels.slackChannelId,slackChannelId),eq(slackChannels.active,true))).limit(1);if(!channel)throw new Error("Channel is not in the configured reporting whitelist.");
    const identities=await tx.select().from(slackIdentities).where(eq(slackIdentities.workspaceId,workspaceId));const identityByUser=new Map(identities.map(i=>[i.slackUserId,i.employeeId]));
    const existing=await tx.select().from(slackMessages).where(and(eq(slackMessages.workspaceId,workspaceId),eq(slackMessages.channelId,channel.id),inArray(slackMessages.slackTs,usable.map(m=>m.ts))));const existingByTs=new Map(existing.map(m=>[m.slackTs,m]));
    await tx.insert(slackEvents).values(usable.map(m=>({eventId:`history:${workspaceId}:${slackChannelId}:${m.ts}`,workspaceId}))).onConflictDoNothing();
    const appointmentsRows:Array<typeof appointments.$inferInsert>=[];const salesRows:Array<typeof sales.$inferInsert>=[];const leadsRows:Array<typeof leads.$inferInsert>=[];const docksRows:Array<typeof docks.$inferInsert>=[];const mediaRows:Array<typeof mediaActivities.$inferInsert>=[];const parsedExisting:string[]=[];const unparsedExisting:string[]=[];
    const newRows:Array<typeof slackMessages.$inferInsert>=[];
    // Reactions are refreshed for every message in the page, including ones whose
    // parse output is already settled, so a history sync keeps KPI eligibility current.
    const reactionRefresh:Array<{id:string;reactions:SlackReaction[]}>=[];
    for(const item of usable){const old=existingByTs.get(item.ts);if(old&&reactionsFingerprint(old.reactions)!==reactionsFingerprint(item.reactions))reactionRefresh.push({id:old.id,reactions:item.reactions??[]});if(old&&old.parserStatus!=="PENDING"&&old.parserStatus!=="ERROR")continue;const messageId=old?.id??randomUUID();const employeeId=old?.employeeId??(item.user?identityByUser.get(item.user):undefined)??null;const postedAt=old?.postedAt??slackDate(item.ts);const result=parserRegistry.parse(channel.parserType,{rawSourceId:messageId,text:item.text!,postedAt,employeeId});
      const attribution=result?resolveStructuredAttribution(result.recordType,employeeId,result.values,identityByUser):null;const warnings=result?[...result.warnings,...(attribution?.warnings??[])]:["No conservative parser rule matched"];
      if(!old)newRows.push({id:messageId,workspaceId,channelId:channel.id,slackTs:item.ts,slackUserId:item.user,employeeId,rawText:item.text!,postedAt,parserType:channel.parserType,parserStatus:result?"PARSED":"UNPARSED",validationWarnings:warnings,reactions:item.reactions??[],reactionsSyncedAt:new Date()});else(result?parsedExisting:unparsedExisting).push(messageId);
      if(!result)continue;const base={slackMessageId:messageId,employeeId:attribution!.employeeId,teamId:channel.teamId,occurredAt:postedAt,confidence:String(result.confidence)};const value=(key:string)=>result.values[key] as string|null|undefined;
      if(result.recordType==="APPOINTMENT")appointmentsRows.push({...base,prospectName:value("prospectName"),phone:value("phone"),state:value("state"),scheduledAt:value("scheduledAt")?new Date(value("scheduledAt")!):null,originalTimezone:value("originalTimezone"),assignedPerson:value("assignedPerson"),scheduledText:value("scheduledText")});
      if(result.recordType==="SALE")salesRows.push({...base,customerName:value("customerName"),phone:value("phone"),email:value("email"),packageName:value("packageName"),amount:result.values.amount==null?null:String(result.values.amount),currency:value("currency")??"USD",state:value("state"),zipCodes:result.values.zipCodes as string[]});
      if(result.recordType==="LEAD"){const eligibility=deriveLeadEligibility(item.reactions);leadsRows.push({...base,leadType:value("leadType"),contactName:value("contactName"),phone:value("phone"),email:value("email"),propertyType:value("propertyType"),state:value("state"),timeline:value("timeline"),details:(result.values.details??{}) as Record<string,string>,countsTowardKpi:eligibility.countsTowardKpi,exclusionReasons:eligibility.exclusionReasons});}
      if(result.recordType==="DOCK"&&result.values.amount!=null&&value("reason"))docksRows.push({...base,amount:String(result.values.amount),currency:value("currency")??"PKR",reason:value("reason")!,appliedBy:value("appliedBy"),notes:value("notes")});
      if(result.recordType==="MEDIA_ACTIVITY")mediaRows.push({...base,classification:value("classification")!,summary:value("summary")!,blocker:value("blocker")});
    }
    if(newRows.length)await tx.insert(slackMessages).values(newRows).onConflictDoNothing();if(appointmentsRows.length)await tx.insert(appointments).values(appointmentsRows).onConflictDoNothing();if(salesRows.length)await tx.insert(sales).values(salesRows).onConflictDoNothing();if(leadsRows.length)await tx.insert(leads).values(leadsRows).onConflictDoNothing();if(docksRows.length)await tx.insert(docks).values(docksRows).onConflictDoUpdate({target:docks.slackMessageId,set:{employeeId:sql`excluded.employee_id`,teamId:sql`excluded.team_id`,occurredAt:sql`excluded.occurred_at`,confidence:sql`excluded.confidence`,amount:sql`excluded.amount`,currency:sql`excluded.currency`,reason:sql`excluded.reason`,appliedBy:sql`excluded.applied_by`,notes:sql`excluded.notes`}});if(mediaRows.length)await tx.insert(mediaActivities).values(mediaRows).onConflictDoNothing();
    for(const refresh of reactionRefresh){
      await tx.update(slackMessages).set({reactions:refresh.reactions,reactionsSyncedAt:new Date()}).where(eq(slackMessages.id,refresh.id));
      if(channel.parserType!=="leads")continue;
      const eligibility=deriveLeadEligibility(refresh.reactions);
      await tx.update(leads).set({countsTowardKpi:eligibility.countsTowardKpi,exclusionReasons:eligibility.exclusionReasons}).where(eq(leads.slackMessageId,refresh.id));
    }
    if(channel.parserType==="leads"&&unparsedExisting.length)await tx.delete(leads).where(inArray(leads.slackMessageId,unparsedExisting));
    if(parsedExisting.length)await tx.update(slackMessages).set({parserStatus:"PARSED",validationWarnings:[]}).where(inArray(slackMessages.id,parsedExisting));if(unparsedExisting.length)await tx.update(slackMessages).set({parserStatus:"UNPARSED",validationWarnings:["No conservative parser rule matched"]}).where(inArray(slackMessages.id,unparsedExisting));
    return {imported:newRows.length+parsedExisting.length+unparsedExisting.length};
  });
}
