import { beforeEach, describe, expect, it, vi } from "vitest";

const state: {
  channel: { id: string; parserType: string; teamId: string | null } | null;
  message: { id: string; reactions: Array<{ name: string; count?: number; users?: string[] }> } | null;
  claimEvent: boolean;
  messageUpdates: Array<Record<string, unknown>>;
  leadUpdates: Array<Record<string, unknown>>;
} = { channel: null, message: null, claimEvent: true, messageUpdates: [], leadUpdates: [] };

/** Minimal chainable stand-in for the Drizzle query builders this handler uses. */
function fakeTransaction() {
  let selectTarget: "channel" | "message" | null = null;
  let updateTarget: "messages" | "leads" | null = null;
  const thenable = <T>(value: T) => ({
    from() { return this; },
    where() { return this; },
    limit() { return Promise.resolve(value); },
    then(resolve: (v: T) => unknown) { return Promise.resolve(value).then(resolve); },
  });
  return {
    select() {
      selectTarget = selectTarget === null ? "channel" : "message";
      const target = selectTarget;
      return thenable(target === "channel"
        ? (state.channel ? [state.channel] : [])
        : (state.message ? [state.message] : []));
    },
    insert() {
      return {
        values() { return this; },
        onConflictDoNothing() { return this; },
        returning() { return Promise.resolve(state.claimEvent ? [{ id: "evt" }] : []); },
      };
    },
    update(table: unknown) {
      updateTarget = String(table).includes("lead") ? "leads" : "messages";
      const target = updateTarget;
      return {
        set(values: Record<string, unknown>) {
          (target === "leads" ? state.leadUpdates : state.messageUpdates).push(values);
          return this;
        },
        where() { return this; },
        returning() { return Promise.resolve([{ id: "lead-1" }]); },
        then(resolve: (v: unknown) => unknown) { return Promise.resolve([]).then(resolve); },
      };
    },
  };
}

vi.mock("@/lib/db/client", () => ({
  getDb: () => ({ transaction: (fn: (tx: ReturnType<typeof fakeTransaction>) => unknown) => fn(fakeTransaction()) }),
}));
vi.mock("@/lib/db/schema", () => ({
  leads: "leads_table", slackChannels: "slack_channels_table",
  slackEvents: "slack_events_table", slackMessages: "slack_messages_table",
}));

const { ingestSlackReactionEvent } = await import("@/lib/slack/reaction-events");

const event = (overrides: Record<string, unknown> = {}) => ({
  type: "event_callback" as const, event_id: "Ev1", team_id: "T1",
  event: {
    type: "reaction_added" as const, user: "UMGR", reaction: "x",
    item: { type: "message", channel: "C-LEADS", ts: "1787265902.707369" },
    ...overrides,
  },
});

beforeEach(() => {
  state.channel = { id: "chan-leads", parserType: "leads", teamId: "team-isa" };
  state.message = { id: "msg-1", reactions: [{ name: "white_check_mark", count: 2, users: ["UA", "UB"] }] };
  state.claimEvent = true;
  state.messageUpdates = [];
  state.leadUpdates = [];
});

describe("live reaction ingestion", () => {
  it("excludes the lead when :x: is added in the leads channel", async () => {
    const result = await ingestSlackReactionEvent(event());
    expect(result).toMatchObject({ status: "applied", countsTowardKpi: false, exclusionReasons: ["X_REACTION"] });
    expect(state.leadUpdates).toEqual([{ countsTowardKpi: false, exclusionReasons: ["X_REACTION"] }]);
  });

  it("restores counting when :x: is removed and nothing else excludes it", async () => {
    state.message = { id: "msg-1", reactions: [{ name: "x", count: 1, users: ["UMGR"] }] };
    const result = await ingestSlackReactionEvent(event({ type: "reaction_removed" }));
    expect(result).toMatchObject({ status: "applied", countsTowardKpi: true, exclusionReasons: [] });
  });

  it("leaves Lead Management untouched for reactions in an unrelated channel", async () => {
    state.channel = null;
    expect(await ingestSlackReactionEvent(event({ item: { type: "message", channel: "C-SALES", ts: "1.1" } })))
      .toEqual({ status: "unconfigured-channel" });
    expect(state.leadUpdates).toEqual([]);
    expect(state.messageUpdates).toEqual([]);
  });

  it("leaves a configured non-leads channel untouched", async () => {
    state.channel = { id: "chan-sales", parserType: "leadsedge-sale", teamId: "team-sales" };
    expect(await ingestSlackReactionEvent(event())).toEqual({ status: "ignored", reason: "not-a-leads-channel" });
    expect(state.leadUpdates).toEqual([]);
  });

  it("ignores reactions that are not :x: or :arrow_left:", async () => {
    expect(await ingestSlackReactionEvent(event({ reaction: "eyes" }))).toEqual({ status: "ignored", reason: "reaction-not-relevant" });
    expect(state.leadUpdates).toEqual([]);
  });

  it("ignores reactions on non-message items", async () => {
    expect(await ingestSlackReactionEvent(event({ item: { type: "file", channel: "C-LEADS", ts: "1.1" } })))
      .toEqual({ status: "ignored", reason: "item-type" });
  });

  it("drops a redelivered Slack event instead of applying it twice", async () => {
    state.claimEvent = false;
    expect(await ingestSlackReactionEvent(event())).toEqual({ status: "duplicate" });
    expect(state.leadUpdates).toEqual([]);
  });

  it("reports an unknown message without writing anything", async () => {
    state.message = null;
    expect(await ingestSlackReactionEvent(event())).toEqual({ status: "unknown-message" });
    expect(state.messageUpdates).toEqual([]);
  });
});
