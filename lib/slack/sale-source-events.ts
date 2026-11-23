import {sql} from 'drizzle-orm';
import {getDb} from '@/lib/db/client';
import type {SlackEventCallback,SlackMessageEvent} from './types';

export const SALE_REPORTING_CHANNEL_IDS = ['C098D7NHQ69','C0B1UH7BV9N'] as const;

/** Retain deleted source evidence. A surviving mirror becomes the primary source.
 * A standalone sale is not cancelled merely because its Slack post disappears. */
export async function ingestSaleSourceDeletion(payload:SlackEventCallback) {
  const event=payload.event as SlackMessageEvent;
  if(event.subtype!=='message_deleted'||!SALE_REPORTING_CHANNEL_IDS.some(id=>id===event.channel)||!/^\d+\.\d+$/.test(event.deleted_ts??''))return {status:'ignored' as const};
  const db=getDb('ingestion');if(!db)return {status:'database-not-configured' as const};
  await db.execute(sql`insert into sale_source_availability(sale_id,unavailable_at,evidence)
    select s.id,now(),jsonb_build_object('reason','Slack message_deleted','eventId',${payload.event_id}::text)
    from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id
    where sm.workspace_id=${payload.team_id} and c.slack_channel_id=${event.channel} and sm.slack_ts=${event.deleted_ts}
    on conflict(sale_id) do nothing`);
  return {status:'sale-source-unavailable' as const};
}
