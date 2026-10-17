import {sql} from "drizzle-orm";
import {getDb} from "@/lib/db/client";
import {AUTO_DOCK_CALL_CHANNEL_IDS} from "./policy";
import type {SlackEventCallback,SlackMessageEvent} from "@/lib/slack/types";

/** Keep source and structured evidence; only availability for auto-dock calls changes. */
export async function ingestAutoDockCallDeletion(payload:SlackEventCallback){
  const event=payload.event as SlackMessageEvent;
  if(event.subtype!=="message_deleted"||!AUTO_DOCK_CALL_CHANNEL_IDS.some(id=>id===event.channel)||!/^\d+\.\d+$/.test(event.deleted_ts??""))return {status:"ignored"};
  const db=getDb("ingestion");if(!db)return {status:"database-not-configured"};
  await db.execute(sql`update slack_messages sm set source_unavailable_at=now()
    from slack_channels c where c.id=sm.channel_id and c.workspace_id=${payload.team_id}
    and c.slack_channel_id=${event.channel} and sm.workspace_id=${payload.team_id}
    and sm.slack_ts=${event.deleted_ts} and sm.source_unavailable_at is null
    and exists(select 1 from appointments a where a.slack_message_id=sm.id)`);
  // The source-change trigger queues its original parent date atomically.
  return {status:"call-source-unavailable"};
}
