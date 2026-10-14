import { describe, expect, it } from "vitest";
import { dockRecipientPlan, slackSourceDate } from "./dock-reconciliation";

describe("dock source reconciliation", () => {
  it("adds a newly mentioned recipient without duplicating the existing recipient", () => {
    expect(dockRecipientPlan(["LARS"], ["LARS", "HARVEY", "LARS"])).toEqual({
      keep: ["LARS"], insert: ["HARVEY"], remove: [], final: ["HARVEY", "LARS"],
    });
  });

  it("removes a recipient deleted by a Slack message edit", () => {
    expect(dockRecipientPlan(["LARS", "HARVEY"], ["LARS"])).toEqual({
      keep: ["LARS"], insert: [], remove: ["HARVEY"], final: ["LARS"],
    });
  });

  it("does not add the message author when the author is not a target", () => {
    expect(dockRecipientPlan([], ["JORDAN", "LENA"]).final).toEqual(["JORDAN", "LENA"]);
    expect(dockRecipientPlan([], ["JORDAN", "LENA"]).final).not.toContain("DAMEON");
  });

  it("retains the original Slack timestamp when reprocessed later", () => {
    expect(slackSourceDate("1791832412.986009").toISOString()).toBe("2026-10-12T19:13:32.986Z");
    expect(slackSourceDate("1791987294.004539").toISOString()).toBe("2026-10-14T14:14:54.004Z");
  });
});
