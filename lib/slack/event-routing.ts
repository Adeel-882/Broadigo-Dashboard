import type { SlackEnvelope, SlackMessageEvent, SlackReactionEvent } from "@/lib/slack/types";
import { normalizeSlackMessageEvent } from "@/lib/slack/message-eligibility";
import { isExcludingReaction } from "@/lib/slack/reactions";

const REACTION_EVENTS = new Set(["reaction_added", "reaction_removed"]);

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
  if(!normalizeSlackMessageEvent(payload.event as SlackMessageEvent))return {action:"ignore" as const,reason:"thread-or-message-subtype"};
  return {action:"ingest" as const};
}
