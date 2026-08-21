export interface SlackMessageEvent {
  type: "message";
  channel: string;
  user?: string;
  text?: string;
  ts: string;
  event_ts?: string;
  thread_ts?: string;
  subtype?: string;
  message?: SlackMessageEvent;
  previous_message?: SlackMessageEvent;
}

export interface SlackReactionEvent {
  type: "reaction_added" | "reaction_removed";
  user?: string;
  reaction: string;
  item: { type: string; channel: string; ts: string };
  event_ts?: string;
}

export interface SlackEventCallback {
  type: "event_callback";
  event_id: string;
  team_id: string;
  event: SlackMessageEvent | { type: string; [key: string]: unknown };
}

export interface SlackReactionEventCallback {
  type: "event_callback";
  event_id: string;
  team_id: string;
  event: SlackReactionEvent;
}

export type SlackEnvelope = SlackEventCallback | { type: "url_verification"; challenge: string };
