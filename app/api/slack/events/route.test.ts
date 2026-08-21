import { beforeEach, describe, expect, it, vi } from "vitest";

const ingestSlackEvent = vi.fn();
const ingestSlackReactionEvent = vi.fn();
const recordSlackEventOutcome = vi.fn();
const verifySlackSignature = vi.fn(() => true);

vi.mock("@/lib/slack/ingest", () => ({ ingestSlackEvent }));
vi.mock("@/lib/slack/reaction-events", () => ({ ingestSlackReactionEvent }));
vi.mock("@/lib/slack/observability", () => ({ recordSlackEventOutcome }));
vi.mock("@/lib/slack/signature", () => ({ verifySlackSignature }));

const { POST } = await import("@/app/api/slack/events/route");

const post = (body: unknown, headers: Record<string, string> = {}) =>
  POST(new Request("https://example.com/api/slack/events", {
    method: "POST",
    headers: { "content-type": "application/json", "x-slack-request-timestamp": "1", "x-slack-signature": "v0=x", ...headers },
    body: JSON.stringify(body),
  }));

const messageEvent = (overrides: Record<string, unknown> = {}) => ({
  type: "event_callback", event_id: "Ev123", team_id: "T098UDG2RED",
  event: { type: "message", channel: "C098WNHNBR7", user: "U1", text: "Edge Essential Plan -$799", ts: "1787346500.000700", ...overrides },
});

beforeEach(() => {
  vi.clearAllMocks();
  verifySlackSignature.mockReturnValue(true);
  recordSlackEventOutcome.mockResolvedValue(undefined);
});

describe("Slack delivery endpoint", () => {
  it("rejects an invalid signature without touching ingestion", async () => {
    verifySlackSignature.mockReturnValue(false);
    const response = await post(messageEvent());
    expect(response.status).toBe(401);
    expect(ingestSlackEvent).not.toHaveBeenCalled();
  });

  it("answers the URL verification challenge as plain text", async () => {
    const response = await post({ type: "url_verification", challenge: "abc123" });
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("abc123");
  });

  it("awaits ingestion before responding, so the result is known", async () => {
    let settled = false;
    ingestSlackEvent.mockImplementation(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
      settled = true;
      return { status: "parsed", recordType: "SALE" };
    });
    const response = await post(messageEvent());
    expect(settled).toBe(true);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: "parsed" });
  });

  it("records the full identity and outcome of a parsed sale", async () => {
    ingestSlackEvent.mockResolvedValue({ status: "parsed", recordType: "SALE" });
    await post(messageEvent());
    expect(recordSlackEventOutcome).toHaveBeenCalledWith(expect.objectContaining({
      eventId: "Ev123", workspaceId: "T098UDG2RED", slackChannelId: "C098WNHNBR7",
      slackUserId: "U1", slackTs: "1787346500.000700",
      routingAction: "ingest", result: "parsed", recordType: "SALE",
      workspaceMatched: true, channelMatched: true,
    }));
  });

  it("reports an unmapped channel and which half of the mapping failed", async () => {
    ingestSlackEvent.mockResolvedValue({ status: "unconfigured-channel", workspaceMatched: true, channelMatched: false });
    const response = await post(messageEvent({ channel: "C-NOT-MAPPED" }));
    expect(await response.json()).toEqual({ ok: true, result: "unconfigured-channel" });
    expect(recordSlackEventOutcome).toHaveBeenCalledWith(expect.objectContaining({
      result: "unconfigured-channel", workspaceMatched: true, channelMatched: false, slackChannelId: "C-NOT-MAPPED",
    }));
  });

  it("stays idempotent when Slack redelivers the same event", async () => {
    ingestSlackEvent.mockResolvedValue({ status: "duplicate" });
    const response = await post(messageEvent());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ ok: true, result: "duplicate" });
  });

  it("reports a message the parser declined as unparsed, still persisted", async () => {
    ingestSlackEvent.mockResolvedValue({ status: "unparsed" });
    const response = await post(messageEvent({ text: "good morning team" }));
    expect(await response.json()).toEqual({ ok: true, result: "unparsed" });
    expect(recordSlackEventOutcome).toHaveBeenCalledWith(expect.objectContaining({ result: "unparsed" }));
  });

  it.each([
    ["thread reply", { thread_ts: "1787000000.000100" }, "thread-or-message-subtype"],
    ["bot subtype", { subtype: "bot_message" }, "thread-or-message-subtype"],
  ])("logs an ignored %s instead of discarding it", async (_label, overrides, reason) => {
    const response = await post(messageEvent(overrides));
    expect(response.status).toBe(200);
    expect(ingestSlackEvent).not.toHaveBeenCalled();
    expect(recordSlackEventOutcome).toHaveBeenCalledWith(expect.objectContaining({ result: "ignored", reason }));
  });

  it("surfaces a thrown ingestion error as 500 so Slack retries", async () => {
    const error = new Error("terminating connection due to administrator command");
    ingestSlackEvent.mockRejectedValue(error);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
    const response = await post(messageEvent());
    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false, error: "ingestion-failed" });
    expect(recordSlackEventOutcome).toHaveBeenCalledWith(expect.objectContaining({
      result: "error", errorMessage: "terminating connection due to administrator command",
    }));
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("returns 500 when the database is not configured, so the message is retried", async () => {
    ingestSlackEvent.mockResolvedValue({ status: "database-not-configured" });
    const response = await post(messageEvent());
    expect(response.status).toBe(500);
    expect(recordSlackEventOutcome).toHaveBeenCalledWith(expect.objectContaining({ result: "database-not-configured" }));
  });

  it("routes an excluding reaction to the reaction handler and awaits it", async () => {
    ingestSlackReactionEvent.mockResolvedValue({ status: "applied", countsTowardKpi: false });
    const response = await post({
      type: "event_callback", event_id: "Ev999", team_id: "T098UDG2RED",
      event: { type: "reaction_added", user: "U2", reaction: "x", item: { type: "message", channel: "C098C93DGTY", ts: "1787346500.000700" } },
    });
    expect(response.status).toBe(200);
    expect(ingestSlackReactionEvent).toHaveBeenCalledTimes(1);
    expect(recordSlackEventOutcome).toHaveBeenCalledWith(expect.objectContaining({
      routingAction: "reaction", result: "applied", slackChannelId: "C098C93DGTY",
    }));
  });

  it("measures how long ingestion took", async () => {
    ingestSlackEvent.mockResolvedValue({ status: "parsed", recordType: "LEAD" });
    await post(messageEvent());
    const call = recordSlackEventOutcome.mock.calls[0][0] as { durationMs: number };
    expect(typeof call.durationMs).toBe("number");
    expect(call.durationMs).toBeGreaterThanOrEqual(0);
  });
});
