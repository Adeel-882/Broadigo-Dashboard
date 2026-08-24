import type { SlackEnvelope, SlackMessageEvent, SlackReactionEvent } from "@/lib/slack/types";
import { normalizeSlackMessageEvent, normalizeSlackThreadReplyEvent } from "@/lib/slack/message-eligibility";
import { isExcludingReaction } from "@/lib/slack/reactions";

const REACTION_EVENTS = new Set(["reaction_added", "reaction_removed"]);
const QUALIFICATION_CHANNELS = new Set(["C098WNHNBR7", "C0B0P6P7FPG"]);

export function classifySlackEnvelope(payload: SlackEnvelope) {
  if(payload.type==="url_verification") return {action:"verify" as const,challenge:payload.challenge};
  if(payload.type!=="event_callback") return {action:"ignore" as const,reason:"envelope-type"};
  if(REACTION_EVENTS.has(payload.event.type)){
    const reaction=payload.event as unknown as SlackReactionEvent;
    if(reaction.item?.type!=="message")return {action:"ignore" as const,reason:"reaction-item-type"};
    // Only :x: and :arrow_left: change lead eligibility; every other reaction is noise.
    if(!isExcludingReaction(reaction.reaction))return {action:"ignore" as const,reason:"reaction-not-relevant"};
    return {action:"reaction" as const};
  }
  if(payload.event.type!=="message") return {action:"ignore" as const,reason:"event-type"};
  const reply=normalizeSlackThreadReplyEvent(payload.event as SlackMessageEvent);
  if(reply&&QUALIFICATION_CHANNELS.has(reply.channel))return {action:"appointment-disposition" as const};
  if(!normalizeSlackMessageEvent(payload.event as SlackMessageEvent))return {action:"ignore" as const,reason:"thread-or-message-subtype"};
  return {action:"ingest" as const};
}
