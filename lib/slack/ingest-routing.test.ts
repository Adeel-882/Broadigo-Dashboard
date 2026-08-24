import { describe, expect, it } from "vitest";
import { classifySlackEnvelope } from "@/lib/slack/event-routing";
import { isEligibleTopLevelMessage, normalizeSlackMessageEvent } from "@/lib/slack/message-eligibility";
import type { SlackEnvelope, SlackMessageEvent } from "@/lib/slack/types";

const envelope = (event: Record<string, unknown>) =>
  ({ type: "event_callback", event_id: "Ev1", team_id: "T098UDG2RED", event } as unknown as SlackEnvelope);

const message = (overrides: Record<string, unknown> = {}) => ({
  type: "message", channel: "C098WNHNBR7", user: "U1", text: "Call scheduled", ts: "1787346500.000700", ...overrides,
});

describe("live delivery classification", () => {
  it("routes a normal top-level message to ingestion", () => {
    expect(classifySlackEnvelope(envelope(message()))).toEqual({ action: "ingest" });
  });

  it("ignores thread replies", () => {
    expect(classifySlackEnvelope(envelope(message({ thread_ts: "1787000000.000100" }))))
      .toEqual({ action: "appointment-disposition" });
  });

  it("keeps a top-level message whose thread_ts equals its own ts", () => {
    expect(classifySlackEnvelope(envelope(message({ thread_ts: "1787346500.000700" })))).toEqual({ action: "ingest" });
  });

  it.each(["channel_join", "channel_leave", "bot_message", "message_deleted", "file_share"])(
    "ignores the %s subtype", (subtype) => {
      expect(classifySlackEnvelope(envelope(message({ subtype }))))
        .toEqual({ action: "ignore", reason: "thread-or-message-subtype" });
    });

  it("ingests an edited message through message_changed", () => {
    expect(classifySlackEnvelope(envelope({
      type: "message", subtype: "message_changed", channel: "C098WNHNBR7", ts: "1787346600.000000",
      message: { type: "message", user: "U1", text: "edited sale", ts: "1787346500.000700" },
    }))).toEqual({ action: "ingest" });
  });

  it("ignores an empty-text message", () => {
    expect(classifySlackEnvelope(envelope(message({ text: "" }))))
      .toEqual({ action: "ignore", reason: "thread-or-message-subtype" });
  });

  it("ignores non-message event types", () => {
    expect(classifySlackEnvelope(envelope({ type: "app_mention", channel: "C1" })))
      .toEqual({ action: "ignore", reason: "event-type" });
  });

  it("normalizes a message_changed payload onto the outer channel", () => {
    const normalized = normalizeSlackMessageEvent({
      type: "message", subtype: "message_changed", channel: "C098WNHNBR7", ts: "2.0",
      message: { type: "message", channel: "C098WNHNBR7", user: "U1", text: "edited", ts: "1.0" },
    } as SlackMessageEvent);
    expect(normalized).toMatchObject({ channel: "C098WNHNBR7", ts: "1.0", text: "edited" });
  });

  it("treats eligibility consistently for history and live paths", () => {
    expect(isEligibleTopLevelMessage({ text: "hi", ts: "1.0" })).toBe(true);
    expect(isEligibleTopLevelMessage({ text: "hi", ts: "1.0", subtype: "bot_message" })).toBe(false);
    expect(isEligibleTopLevelMessage({ text: "hi", ts: "1.0", thread_ts: "0.9" })).toBe(false);
  });
});
