import { describe, expect, it } from "vitest";
import { resolveStructuredAttribution } from "@/lib/slack/attribution";

const identities = new Map([
  ["U_MARK", "employee-mark-smith"],
  ["U_HAMDAN", "employee-hamdan-mahmood"],
]);

describe("structured Slack attribution", () => {
  it("attributes the Mark Smith posted dock to mentioned target Hamdan Mahmood", () => {
    const result = resolveStructuredAttribution("DOCK", "employee-mark-smith", {
      targetSlackUserIds: ["U_HAMDAN"],
    }, identities);
    expect(result).toEqual({ employeeId: "employee-hamdan-mahmood", warnings: [] });
  });

  it("never falls back to the posting author for docks without one mapped target", () => {
    expect(resolveStructuredAttribution("DOCK", "employee-mark-smith", { targetSlackUserIds: [] }, identities).employeeId).toBeNull();
    expect(resolveStructuredAttribution("DOCK", "employee-mark-smith", { targetSlackUserIds: ["U_MARK", "U_HAMDAN"] }, identities).employeeId).toBeNull();
    expect(resolveStructuredAttribution("DOCK", "employee-mark-smith", { targetSlackUserIds: ["U_UNKNOWN"] }, identities).employeeId).toBeNull();
  });

  it("attributes a dock when exactly one mentioned profile is mapped", () => {
    expect(resolveStructuredAttribution("DOCK", "employee-mark-smith", {
      targetSlackUserIds: ["U_HAMDAN", "U_UNKNOWN"],
    }, identities)).toEqual({ employeeId: "employee-hamdan-mahmood", warnings: [] });
  });

  it("keeps author attribution for non-dock records", () => {
    expect(resolveStructuredAttribution("APPOINTMENT", "employee-mark-smith", {}, identities).employeeId).toBe("employee-mark-smith");
  });
});
