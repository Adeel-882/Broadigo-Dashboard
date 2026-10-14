import { describe, expect, it } from "vitest";
import { resolveStructuredAttribution } from "@/lib/slack/attribution";

const identities = new Map([
  ["U_MARK", "employee-mark-smith"],
  ["U_HAMDAN", "employee-hamdan-mahmood"],
]);

describe("structured Slack attribution", () => {
  it("attributes the posted dock to its mentioned target", () => {
    expect(resolveStructuredAttribution("DOCK", "employee-mark-smith", { targetSlackUserIds: ["U_HAMDAN"] }, identities)).toEqual({
      employeeId: "employee-hamdan-mahmood", employeeIds: ["employee-hamdan-mahmood"], warnings: [],
    });
  });

  it("never falls back to the posting author for docks without one mapped target", () => {
    expect(resolveStructuredAttribution("DOCK", "employee-mark-smith", { targetSlackUserIds: [] }, identities).employeeId).toBeNull();
    expect(resolveStructuredAttribution("DOCK", "employee-mark-smith", { targetSlackUserIds: ["U_MARK", "U_HAMDAN"] }, identities).employeeId).toBeNull();
    expect(resolveStructuredAttribution("DOCK", "employee-mark-smith", { targetSlackUserIds: ["U_UNKNOWN"] }, identities).employeeId).toBeNull();
  });

  it("attributes a dock when exactly one mentioned profile is mapped", () => {
    expect(resolveStructuredAttribution("DOCK", "employee-mark-smith", { targetSlackUserIds: ["U_HAMDAN", "U_UNKNOWN"] }, identities)).toEqual({
      employeeId: "employee-hamdan-mahmood", employeeIds: ["employee-hamdan-mahmood"], warnings: [],
    });
  });

  it("keeps every distinct mapped dock recipient", () => {
    const result = resolveStructuredAttribution("DOCK", null, { targetSlackUserIds: ["U_MARK", "U_MARK", "U_HAMDAN"] }, identities);
    expect(result.employeeId).toBeNull();
    expect(result.employeeIds).toEqual(["employee-mark-smith", "employee-hamdan-mahmood"]);
  });

  it("keeps author attribution for non-dock records", () => {
    expect(resolveStructuredAttribution("APPOINTMENT", "employee-mark-smith", {}, identities)).toMatchObject({ employeeId: "employee-mark-smith", employeeIds: ["employee-mark-smith"] });
  });
});
