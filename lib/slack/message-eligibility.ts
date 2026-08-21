import type { SlackMessageEvent } from "@/lib/slack/types";

export type SlackMessageLike = {
  text?: string;
  ts?: string;
  thread_ts?: string;
  subtype?: string;
};

export function isEligibleTopLevelMessage(message: SlackMessageLike) {
  return Boolean(
    message.text
    && message.ts
    && (!message.thread_ts || message.thread_ts === message.ts)
    && !message.subtype,
  );
}

export function normalizeSlackMessageEvent(event: SlackMessageEvent) {
  if (event.subtype === "message_changed") {
    const changed = event.message;
    if (!changed || !isEligibleTopLevelMessage(changed)) return null;
    return { ...changed, channel: event.channel } satisfies SlackMessageEvent;
  }
  return isEligibleTopLevelMessage(event) ? event : null;
}
