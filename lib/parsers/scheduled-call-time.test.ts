import { describe, expect, it } from "vitest";
import { parserRegistry } from "@/lib/parsers/registry";
import { parseScheduledCallAt } from "@/lib/parsers/scheduled-call-time";

const postedAt = new Date("2026-08-24T18:00:00.000Z"); // Monday, 1 PM EST
const input = (text: string) => ({ rawSourceId: "msg-1", text, postedAt });

describe("scheduled call time", () => {
  it("resolves Today in the written timezone", () => {
    expect(parseScheduledCallAt("Today", "1:30 PM CST", "CST", postedAt)?.toISOString()).toBe("2026-08-24T19:30:00.000Z");
  });

  it("resolves Tomorrow in the written timezone", () => {
    expect(parseScheduledCallAt("Tomorrow", "10:00 AM MST", "MST", postedAt)?.toISOString()).toBe("2026-08-25T17:00:00.000Z");
  });

  it("resolves the next named weekday", () => {
    expect(parseScheduledCallAt("Wednesday", "5 PM EST", "EST", postedAt)?.toISOString()).toBe("2026-08-26T22:00:00.000Z");
  });

  it("uses the source timestamp for NOW", () => {
    expect(parseScheduledCallAt(null, "NOW", null, postedAt)?.toISOString()).toBe(postedAt.toISOString());
  });

  it("leaves an unsupported timezone unresolved", () => {
    expect(parseScheduledCallAt("Today", "2 PM", null, postedAt)).toBeNull();
  });
});

describe("real scheduled-call message shapes", () => {
  it.each([
    ["Call scheduled from MT for Tomorrow at 10:00 AM MST with Todd Walter <tel:+14065551212|+1 406 555 1212> assigned to <@UDAMEON|Dameon Wolfe>", "UDAMEON", "2026-08-25T17:00:00.000Z"],
    ["Call scheduled from TX for Today at 1:30 PM CST with Brandi Plemons <tel:+12815551212|+1 281 555 1212> assigned to <@UDAMEON>", "UDAMEON", "2026-08-24T19:30:00.000Z"],
    ["Call scheduled from NY for NOW with Charles Hamilton <tel:+12125551212|+1 212 555 1212> Assigned to <@ULARS>", "ULARS", postedAt.toISOString()],
    ["Call scheduled from FL for Wednesday at 5 PM EST with anne leon <tel:+13055551212|+1 305 555 1212> assigned to <@UDAMEON>", "UDAMEON", "2026-08-26T22:00:00.000Z"],
    ["Call scheduled from OH for Today at 12:45 PM EST with Cynthia Johnson-Hughes <tel:+12165551212|+1 216 555 1212> assigned to <@UZACK>", "UZACK", "2026-08-24T17:45:00.000Z"],
  ])("parses %s", (message, assignee, expectedAt) => {
    const result = parserRegistry.parse("leadsedge-appointment", input(message));
    expect(result?.recordType).toBe("APPOINTMENT");
    expect(result?.values.assignedPerson).toBe(assignee);
    expect(result?.values.scheduledAt).toBe(expectedAt);
  });
});
