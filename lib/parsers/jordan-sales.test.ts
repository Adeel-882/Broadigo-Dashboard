import { describe, expect, it } from "vitest";
import { parserRegistry } from "./registry";
import { resolveStructuredAttribution } from "../slack/attribution";
import { isEligibleTopLevelMessage } from "../slack/message-eligibility";
import { resolveDateRange } from "../time-ranges";
import { displayEmployeeAliases } from "../employee-display";

const employeeId = "e18ba4b0-0b55-4615-b01d-c83379049b9f";
const user = "U098A685CR4";
const identities = new Map([[user, employeeId]]);
const cases = [
  ["1790628476.381119", "Edge Essential Plan - $720", 720],
  ["1792253419.334259", "Edge Executive - $1250", 1250],
  ["1792516609.799179", "Edge Executive - $1200", 1200],
] as const;
describe("canonical Jordan sales", () => {
  it.each(cases)("parses and attributes top-level source %s", (ts, plan, amount) => {
    const message = { user, ts, thread_ts: ts, text: `*Customer <tel:+15551234567|+15551234567> | TX | ${plan} | <mailto:test@example.com|test@example.com> | Alhamdullilah* :point_up:\n*(14th October Sale)*` };
    expect(isEligibleTopLevelMessage(message)).toBe(true);
    const result = parserRegistry.parse("leadsedge-sale", { rawSourceId: ts, text: message.text, postedAt: new Date(Number(ts) * 1000) });
    expect(result?.recordType).toBe("SALE");
    expect(result?.values.amount).toBe(amount);
    expect(resolveStructuredAttribution(result!.recordType, identities.get(message.user), result!.values, identities).employeeId).toBe(employeeId);
  });
  it("keeps the canonical timestamp range and includes $2450", () => {
    const range = resolveDateRange("Custom Range", "2026-10-11", "2026-11-02");
    expect(cases.filter(([ts]) => Number(ts) * 1000 >= +range.start && Number(ts) * 1000 < +range.end).reduce((sum, [, , amount]) => sum + amount, 0)).toBe(2450);
  });
  it("rejects onboarding replies, including property prices", () => {
    expect(isEligibleTopLevelMessage({ ts: "1792253500.000001", thread_ts: cases[1][0], text: "Onboarding Completed $120k" })).toBe(false);
    expect(parserRegistry.parse("leadsedge-sale", { rawSourceId: "reply", text: "Onboarding Completed | minimum price $120k", postedAt: new Date() })).toBeNull();
    const result = parserRegistry.parse("leadsedge-sale", { rawSourceId: "price", text: "Customer <tel:+15551234567|+15551234567> | Edge Executive - $120k", postedAt: new Date() });
    expect(result?.values.amount).toBeNull();
  });
  it("deduplicates display aliases without mutating identity/search aliases", () => {
    const employee = { name: "Jordan Reid", pseudoName: "Shaheer Ali", aliases: ["Jordan Reid", "Jordan Reid (Shaheer Ali)", "Shaheer Ali", "shaheer ali"] };
    expect(displayEmployeeAliases(employee)).toEqual(["Shaheer Ali"]);
    expect(employee.aliases).toHaveLength(4);
    expect(displayEmployeeAliases({ name: "Other", aliases: ["Useful alias"] })).toEqual(["Useful alias"]);
  });
});
