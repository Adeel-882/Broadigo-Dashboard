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

/** Normalizes only true thread replies, including message_changed payloads. */
export function normalizeSlackThreadReplyEvent(event: SlackMessageEvent) {
  const message = event.subtype === "message_changed" ? event.message : event;
  if (!message?.text || !message.ts || !message.thread_ts || message.thread_ts === message.ts) return null;
  if (event.subtype && event.subtype !== "message_changed") return null;
  if (message.subtype) return null;
  return { ...message, channel: event.channel } satisfies SlackMessageEvent;
}
