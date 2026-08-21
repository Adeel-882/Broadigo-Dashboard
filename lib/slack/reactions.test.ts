import { describe, expect, it } from "vitest";
import { applyReactionEvent, deriveLeadEligibility, isExcludingReaction, leadExclusionLabel, reactionsFingerprint } from "@/lib/slack/reactions";
import { classifySlackEnvelope } from "@/lib/slack/event-routing";
import type { SlackEnvelope } from "@/lib/slack/types";

const reaction = (name: string, count = 1) => ({ name, count, users: Array.from({ length: count }, (_, i) => `U${i}`) });

describe("lead KPI eligibility from Slack reactions", () => {
  it("counts a lead with no reactions at all", () => {
    expect(deriveLeadEligibility([])).toEqual({ countsTowardKpi: true, exclusionReasons: [] });
    expect(deriveLeadEligibility(null)).toEqual({ countsTowardKpi: true, exclusionReasons: [] });
    expect(deriveLeadEligibility(undefined)).toEqual({ countsTowardKpi: true, exclusionReasons: [] });
  });

  it.each([["eyes"], ["rocket"], ["white_check_mark"], ["raised_hands"], ["tada"], ["+1"]])(
    "counts a lead reacted with :%s:", (name) => {
      expect(deriveLeadEligibility([reaction(name)]).countsTowardKpi).toBe(true);
    });

  it("excludes a lead reacted with :x:", () => {
    expect(deriveLeadEligibility([reaction("x")])).toEqual({ countsTowardKpi: false, exclusionReasons: ["X_REACTION"] });
  });

  it("excludes a lead reacted with :arrow_left:", () => {
    expect(deriveLeadEligibility([reaction("arrow_left")])).toEqual({ countsTowardKpi: false, exclusionReasons: ["ARROW_LEFT_REACTION"] });
  });

  it("excludes a lead carrying :x: alongside unrelated reactions", () => {
    const result = deriveLeadEligibility([reaction("white_check_mark", 3), reaction("x"), reaction("eyes", 2)]);
    expect(result.countsTowardKpi).toBe(false);
    expect(result.exclusionReasons).toEqual(["X_REACTION"]);
  });

  it("excludes a lead carrying :arrow_left: alongside unrelated reactions", () => {
    expect(deriveLeadEligibility([reaction("rocket"), reaction("arrow_left", 2)]).countsTowardKpi).toBe(false);
  });

  it("records both reasons when both excluding reactions are present", () => {
    const result = deriveLeadEligibility([reaction("arrow_left"), reaction("x")]);
    expect(result.exclusionReasons).toEqual(["X_REACTION", "ARROW_LEFT_REACTION"]);
    expect(leadExclusionLabel(result.exclusionReasons)).toBe("Excluded — rejected and returned");
  });

  it("ignores a reaction whose count has fallen to zero", () => {
    expect(deriveLeadEligibility([{ name: "x", count: 0, users: [] }]).countsTowardKpi).toBe(true);
  });

  it("matches the exact Slack name, not rendered emoji or a lookalike label", () => {
    expect(isExcludingReaction("x")).toBe(true);
    expect(isExcludingReaction("arrow_left")).toBe(true);
    expect(isExcludingReaction("❌")).toBe(false);
    expect(isExcludingReaction("x_ray")).toBe(false);
    expect(isExcludingReaction("arrow_left_hook")).toBe(false);
    expect(isExcludingReaction("heavy_multiplication_x")).toBe(false);
    expect(deriveLeadEligibility([reaction("❌"), reaction("negative_squared_cross_mark")]).countsTowardKpi).toBe(true);
  });
});

describe("live reaction events", () => {
  it("reaction_added(x) turns a counted lead into an excluded one", () => {
    const before = [reaction("white_check_mark", 2)];
    expect(deriveLeadEligibility(before).countsTowardKpi).toBe(true);
    const after = applyReactionEvent(before, { type: "reaction_added", reaction: "x", user: "UMGR" });
    expect(deriveLeadEligibility(after)).toEqual({ countsTowardKpi: false, exclusionReasons: ["X_REACTION"] });
  });

  it("reaction_removed(x) restores counting when arrow_left is absent", () => {
    const before = [reaction("white_check_mark", 2), { name: "x", count: 1, users: ["UMGR"] }];
    expect(deriveLeadEligibility(before).countsTowardKpi).toBe(false);
    const after = applyReactionEvent(before, { type: "reaction_removed", reaction: "x", user: "UMGR" });
    expect(deriveLeadEligibility(after).countsTowardKpi).toBe(true);
  });

  it("removing :x: while :arrow_left: remains keeps the lead excluded", () => {
    const before = [{ name: "x", count: 1, users: ["UMGR"] }, { name: "arrow_left", count: 1, users: ["ULEAD"] }];
    const after = applyReactionEvent(before, { type: "reaction_removed", reaction: "x", user: "UMGR" });
    expect(deriveLeadEligibility(after)).toEqual({ countsTowardKpi: false, exclusionReasons: ["ARROW_LEFT_REACTION"] });
  });

  it("keeps the lead excluded while another user's :x: is still on the message", () => {
    const before = [{ name: "x", count: 2, users: ["UONE", "UTWO"] }];
    const after = applyReactionEvent(before, { type: "reaction_removed", reaction: "x", user: "UONE" });
    expect(deriveLeadEligibility(after).countsTowardKpi).toBe(false);
  });

  it("is idempotent for a repeated add from the same user", () => {
    const once = applyReactionEvent([], { type: "reaction_added", reaction: "x", user: "UMGR" });
    const twice = applyReactionEvent(once, { type: "reaction_added", reaction: "x", user: "UMGR" });
    expect(twice).toEqual(once);
    expect(deriveLeadEligibility(twice).exclusionReasons).toEqual(["X_REACTION"]);
  });

  it("re-deriving eligibility from unchanged reactions is stable", () => {
    const reactions = [reaction("arrow_left"), reaction("eyes", 4)];
    expect(deriveLeadEligibility(reactions)).toEqual(deriveLeadEligibility(reactions));
  });
});

describe("reaction fingerprints keep the backfill idempotent", () => {
  it("ignores key order, which Postgres jsonb does not preserve", () => {
    const fromSlack = [{ name: "x", count: 1, users: ["UA"] }];
    const fromJsonb = [{ count: 1, name: "x", users: ["UA"] }];
    expect(JSON.stringify(fromSlack)).not.toBe(JSON.stringify(fromJsonb));
    expect(reactionsFingerprint(fromSlack)).toBe(reactionsFingerprint(fromJsonb));
  });

  it("ignores reaction and user ordering", () => {
    expect(reactionsFingerprint([reaction("x"), reaction("eyes")]))
      .toBe(reactionsFingerprint([reaction("eyes"), reaction("x")]));
    expect(reactionsFingerprint([{ name: "x", count: 2, users: ["UB", "UA"] }]))
      .toBe(reactionsFingerprint([{ name: "x", count: 2, users: ["UA", "UB"] }]));
  });

  it("still detects a real change", () => {
    expect(reactionsFingerprint([reaction("eyes")])).not.toBe(reactionsFingerprint([reaction("eyes"), reaction("x")]));
    expect(reactionsFingerprint([{ name: "x", count: 1, users: ["UA"] }]))
      .not.toBe(reactionsFingerprint([{ name: "x", count: 2, users: ["UA", "UB"] }]));
    expect(reactionsFingerprint([])).not.toBe(reactionsFingerprint([reaction("x")]));
  });
});

describe("Slack envelope routing for reactions", () => {
  const envelope = (event: Record<string, unknown>) =>
    ({ type: "event_callback", event_id: "Ev1", team_id: "T1", event } as unknown as SlackEnvelope);

  it("routes an :x: reaction on a message to the reaction handler", () => {
    expect(classifySlackEnvelope(envelope({ type: "reaction_added", reaction: "x", item: { type: "message", channel: "C1", ts: "1.1" } })))
      .toEqual({ action: "reaction" });
    expect(classifySlackEnvelope(envelope({ type: "reaction_removed", reaction: "arrow_left", item: { type: "message", channel: "C1", ts: "1.1" } })))
      .toEqual({ action: "reaction" });
  });

  it("ignores reactions that cannot change lead eligibility", () => {
    expect(classifySlackEnvelope(envelope({ type: "reaction_added", reaction: "eyes", item: { type: "message", channel: "C1", ts: "1.1" } })))
      .toEqual({ action: "ignore", reason: "reaction-not-relevant" });
    expect(classifySlackEnvelope(envelope({ type: "reaction_added", reaction: "x", item: { type: "file", channel: "C1", ts: "1.1" } })))
      .toEqual({ action: "ignore", reason: "reaction-item-type" });
  });

  it("still routes ordinary messages to the ingest path", () => {
    expect(classifySlackEnvelope(envelope({ type: "message", channel: "C1", ts: "1.1", text: "Lead Type: Buyer" })))
      .toEqual({ action: "ingest" });
  });
});
