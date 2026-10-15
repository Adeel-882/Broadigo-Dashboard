import {sql} from "drizzle-orm";
import {getDb} from "@/lib/db/client";
import type {SlackEventCallback,SlackMessageEvent} from "./types";

/** A deletion changes availability only, never ownership, source time or evidence. */
export async function ingestLeadDeletion(payload:SlackEventCallback) {
  const event=payload.event as SlackMessageEvent;
  if(event.subtype!=="message_deleted"||event.channel!=="C098C93DGTY"||!/^\d+\.\d+$/.test(event.deleted_ts??""))return {status:"ignored" as const};
  const db=getDb("ingestion");if(!db)return {status:"database-not-configured" as const};
  return db.transaction(async tx=>{
    const rows=await tx.execute(sql`select sm.id from slack_messages sm join slack_channels c on c.id=sm.channel_id
      where sm.workspace_id=${payload.team_id} and c.workspace_id=${payload.team_id} and c.slack_channel_id=${event.channel}
      and c.active=true and c.parser_type='leads' and sm.slack_ts=${event.deleted_ts!} for update of sm`);
    if(!rows.length)return {status:"unknown-message" as const};
    const id=String(rows[0].id);
    await tx.execute(sql`update slack_messages set source_unavailable_at=coalesce(source_unavailable_at,now()) where id=${id}::uuid`);
    await tx.execute(sql`with old as (select * from leads where slack_message_id=${id}::uuid and not (exclusion_reasons ? 'SOURCE_UNAVAILABLE') for update),
      changed as (update leads l set counts_toward_kpi=false,exclusion_reasons=l.exclusion_reasons||'["SOURCE_UNAVAILABLE"]'::jsonb from old where l.id=old.id returning l.*)
      insert into lead_reconciliation_audit(lead_id,reason,before_state,after_state)
      select old.id,${'Slack deletion event '+payload.event_id},to_jsonb(old),to_jsonb(changed) from old join changed using(id)`);
    return {status:"source-unavailable" as const};
  });
}
