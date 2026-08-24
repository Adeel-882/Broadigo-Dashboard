import { describe, expect, it } from "vitest";
import { parserRegistry } from "@/lib/parsers/registry";

const input = (text: string) => ({ rawSourceId: "msg-1", text, postedAt: new Date("2026-08-19T10:00:00Z") });

describe("Slack parser registry", () => {
  it("parses appointment records without linking them to sales", () => {
    const result = parserRegistry.parse("broadigo-appointment", input("Call scheduled from FL for tomorrow at 11:00 AM EST with Pinecrest Realty <tel:+15551234567|+1 555-123-4567>"));
    expect(result?.recordType).toBe("APPOINTMENT");
    expect(result?.values.prospectName).toBe("Pinecrest Realty");
  });

  it("does not count appointment policy notices as appointments", () => {
    expect(parserRegistry.parse("broadigo-appointment", input("Appointment Setter Notice: do not post appointments until requirements are met."))).toBeNull();
    expect(parserRegistry.parse("broadigo-appointment", input("Team reminder: this appointment policy must be strictly followed. Do not book appointments in Oregon."))).toBeNull();
  });

  it.each([
    "Call scheduled from *NY* for *tomorrow* at *_11:00 AM EST_ with* Rosemarie Deane <tel:+15551234567|+1 555-123-4567> assigned to <@U1>",
    "Call scheduled from FL for now EST with Alexa Mendez <tel:+15551234567|+1 555-123-4567> assigned to <@U1>",
    "Call scheduled from MA for 7:30 EST with <tel:+15551234567|+1 555-123-4567> assigned to <@U1>",
    "Call scheduled fromNC for NOW with Alan Kaplan <tel:+15551234567|+1 555-123-4567>",
  ])("parses evidenced natural-language appointment variant: %s", (message) => {
    expect(parserRegistry.parse("broadigo-appointment", input(message))?.recordType).toBe("APPOINTMENT");
  });

  it("parses a LeadsEdge sale and revenue", () => {
    const result = parserRegistry.parse("leadsedge-sale", input("Redstone Realty <tel:+15551234567|+15551234567> | <mailto:test@example.com|test@example.com> | TX | Edge Essential Plan -$799 | ZIPs: 75001"));
    expect(result?.recordType).toBe("SALE");
    expect(result?.values.amount).toBe(799);
  });

  it.each([
    ["Curtis Blake <tel:+17066019621|+17066019621> | <mailto:curt@example.com|curt@example.com> | GA | Edge Custom Plan -$1000 | ZIPs: 30022 30329", 1000, "Edge Custom Plan"],
    ["Jonathan Aguilar <tel:+18325315382|+18325315382> | <mailto:john@example.com|john@example.com> | CO | Edge Essential Plan -$799 | ZIPs: 77388, 77386", 799, "Edge Essential Plan"],
    ["Robert Beckman <tel:+18474764126|+18474764126> | <mailto:rob@example.com|rob@example.com> | IL | Edge Essential plan -$720 | 60029, 60068", 720, "Edge Essential plan"],
  ] as const)("treats pipe-format sale separator as positive revenue", (message, amount, plan) => {
    const result = parserRegistry.parse("leadsedge-sale", input(message));
    expect(result?.values.amount).toBe(amount);
    expect(result?.values.packageName).toBe(plan);
  });

  it.each([
    ["Edge Essential Plan (Half) -$400", 400],
    ["Edge Essential Plan (Half) $400", 400],
    ["Edge Essential Plan -$800", 800],
    ["Edge Pro Plan -$990", 990],
    ["Edge Executive Plan $1,499", 1499],
    ["Essential Plan Residential | 799$", 799],
    ["Essential Plan Residential | $799", 799],
    ["Essential Plan Residential | 799 USD", 799],
  ] as const)("parses a format-tolerant plan price: %s", (planPrice, expected) => {
    const message = `Customer <tel:+15551234567|+15551234567> | <mailto:test@example.com|test@example.com> | ${planPrice} | ZIPs: 75001`;
    expect(parserRegistry.parse("leadsedge-sale", input(message))?.values.amount).toBe(expected);
  });

  it.each([
    "Min. Price Point $400K",
    "Onboarding Completed | Min. Price Point $300K",
  ])("does not treat a property price point as sale revenue: %s", (message) => {
    expect(parserRegistry.parse("leadsedge-sale", input(message))).toBeNull();
  });

  it("does not parse a K-suffixed property value even beside a recognized plan", () => {
    const message = "Customer <tel:+15551234567|+15551234567> | Edge Essential Plan | Min. Price Point $400K";
    expect(parserRegistry.parse("leadsedge-sale", input(message))?.values.amount).toBeNull();
  });

  it("keeps the top-level plan price when unrelated thread text contains a price point", () => {
    const message = "Customer <tel:+15551234567|+15551234567> | <mailto:test@example.com|test@example.com> | Edge Essential Plan (Half) -$400 | ZIPs: 75001\nthread reply: Min. Price Point $400K";
    expect(parserRegistry.parse("leadsedge-sale", input(message))?.values.amount).toBe(400);
  });

  it("flags a recognized sale with an apparent but unparsed price for review", () => {
    const message = "Customer <tel:+15551234567|+15551234567> | Edge Essential Plan promotional service configuration pending - $400";
    const result = parserRegistry.parse("leadsedge-sale", input(message));
    expect(result?.recordType).toBe("SALE");
    expect(result?.values.amount).toBeNull();
    expect(result?.warnings).toContain("price_parse_failed");
  });

  it("parses Slack-formatted lead fields", () => {
    const result = parserRegistry.parse("leads", input("*Lead Type: Buyer*\nName: Andy Teasley\nPhone: (760) 343-2404\nType of property: Single family house\nState: CA"));
    expect(result?.recordType).toBe("LEAD");
    expect(result?.values.leadType).toBe("Buyer");
  });

  it("parses the current complete ISA lead template", () => {
    const result = parserRegistry.parse("leads", input("Lead Source: Regent\nLead Type: Buyer\n\nName: Salaheddine Alim\nNumber: <tel:3176948637|317-694-8637>\nEmail: <mailto:eurl.ascond@gmail.com|eurl.ascond@gmail.com>\nType of property: Single Family House\nArea: Attica\nState: IN\nPrice Range: 250k\nCash/Finance: Cash\nTimeline: 3-6 Months\nCall Appointment: Friday at 10 AM\nNote: Qualified\nAction Plan: Follow up"));
    expect(result?.recordType).toBe("LEAD");
    expect(result?.values.contactName).toBe("Salaheddine Alim");
    expect(result?.values.phone).toBe("317-694-8637");
    expect(result?.values.email).toBe("eurl.ascond@gmail.com");
    expect(result?.values.propertyType).toBe("Single Family House");
  });

  it("supports an evidenced lead source line without a colon", () => {
    const result = parserRegistry.parse("leads", input("Lead Source Regent\nLead Type: Seller\nName: Niki Neal\nNumber: <tel:9725551212|972-555-1212>\nType of Property: Single Family House\nState: TX\nTimeline: ASAP\nCall Appointment: Tuesday afternoon"));
    expect(result?.recordType).toBe("LEAD");
    expect(result?.values.details).toMatchObject({ "lead source": "Regent" });
  });

  it("supports a combined buyer and seller submission", () => {
    const result = parserRegistry.parse("leads", input("Lead Source: Regent\nLead Type: Buyer AND SELLER\nName: Dale Letysas\nNumber: <tel:9725551313|972-555-1313>\nType of Property: Single Family House\nState: TX\nTimeline: ASAP\nCall Appointment: Thursday afternoon"));
    expect(result?.recordType).toBe("LEAD");
  });

  it.each([
    "Number <tel:9093195603|909-319-5603>",
    "Contact : <tel:6302460450|630-246-0450>",
    "Cell Number: (972) 555-1515",
  ])("supports an evidenced ISA phone label variant: %s", (phoneLine) => {
    const result = parserRegistry.parse("leads", input(`Lead Source: Regent\nLead Type: Buyer\nName: Qualified Prospect\n${phoneLine}\nType of Property: Single Family House\nState: TX\nTimeline: ASAP\nCall Appointment: Tomorrow`));
    expect(result?.recordType).toBe("LEAD");
  });

  it("infers the lead source from an evidenced bold no-colon header block", () => {
    const result = parserRegistry.parse("leads", input("*Lead Source Regent*\n*Lead Type: Buyer*\n\nName:  Niki Neal\nNumber:  <tel:3016948637|301-694-8637>\nEmail: <mailto:n@example.com|n@example.com>\nType of Property: Single Family House\nBeds/ Baths: Any\nArea: Rockville\nState: MD\nPrice Range: 500k\nCash/Finance: Finance\nTimeline: 6 months.\nNot Under a contract with any realtor.\nCall Appointment:  Tuesday anytime."));
    expect(result?.recordType).toBe("LEAD");
    expect(result?.values.details).toMatchObject({ "lead source": "Regent" });
    expect(result?.warnings).toEqual([]);
  });

  it("parses an evidenced lead whose source line precedes the type line", () => {
    const result = parserRegistry.parse("leads", input("*Lead Type: Buyer*\n*Lead Source Faisal Data*\n\nName: Gerardo Chavez\nNumber: <tel:8175551212|817-555-1212>\nType of property: Single Family House.\nArea: Fort Worth and the surrounding areas\nState: TX\nCash/Finance: Cash\nTimeline: 3-6 months\nContract with a realtor: No\nCall Appointment: Thursday at 10 AM"));
    expect(result?.values.details).toMatchObject({ "lead source": "Faisal Data" });
  });

  it("tolerates evidenced spacing around the lead type colon", () => {
    expect(parserRegistry.parse("leads", input("*LEAD SOURCE : Faisal Data*\n*Lead Type : Buyer*\n\nName: Mark Reale\nNumber : <tel:3215551212|321-555-1212>\nType of Property: Condo\nArea: Palm Bay\nState: FL\nTimeline : 3-6 months\nCall Appointment : Monday at 4PM"))?.recordType).toBe("LEAD");
  });

  it("rejects an otherwise complete lead template with an empty phone line", () => {
    expect(parserRegistry.parse("leads", input("*Lead Source: Faisal Data*\n*Lead Type: Buyer*\n\nName: Mark Watkins\nNumber:\nEmail: <mailto:m@example.com|m@example.com>\nType of Property: Apartment building with minimum 10 units\nArea: Fort Lauderdale\nState: FL\nCall Appointment: Monday at 1 PM."))).toBeNull();
  });

  it.each([
    ["Phone Number: <tel:2514632613|(251) 463-2613>", "(251) 463-2613"],
    ["Phone number: <tel:9172444047|(917) 244-4047>", "(917) 244-4047"],
    ["Number: : <tel:6035328226|603-532-8226>", "603-532-8226"],
    ["Number: Number: <tel:9048023446|904-802-3446>", "904-802-3446"],
  ] as const)("recovers an evidenced malformed phone label: %s", (phoneLine, expected) => {
    const result = parserRegistry.parse("leads", input(`Lead Source: Faisal data\nLead Type: Seller\nName: Jim Weller\n${phoneLine}\nType of Property: Land\nAddress: 5300 Todd Acres Drive\nState: AL\nTimeline: 1 month\nCall Appointment: Tuesday Afternoon`));
    expect(result?.recordType).toBe("LEAD");
    expect(result?.values.phone).toBe(expected);
  });

  it("does not mistake a contact person label for a phone number", () => {
    expect(parserRegistry.parse("leads", input("Lead Source: Regent\nLead Type: Buyer\nName: Qualified Prospect\nContact: John Smith\nType of Property: Single Family House\nState: TX\nTimeline: ASAP\nCall Appointment: Tomorrow"))).toBeNull();
  });

  it.each([
    "Reminder: every buyer and seller lead needs an appointment before posting.",
    "Lead Type: Buyer\nName: Incomplete Prospect",
    "Lead Type: Seller\nName: Missing Property\nNumber: <tel:9725551414|972-555-1414>\nCall Appointment: tomorrow",
    "General discussion about a buyer looking for a property in Texas.",
  ])("does not create a structured lead from insufficient evidence: %s", (message) => {
    expect(parserRegistry.parse("leads", input(message))).toBeNull();
  });

  it("extracts natural-language dock amount and target", () => {
    const result = parserRegistry.parse("dock", input("A dock of PKR 2,000 has been applied to <@U123> for missing a follow up."));
    expect(result?.recordType).toBe("DOCK");
    expect(result?.values.amount).toBe(2000);
    expect(result?.values.targetSlackUserIds).toEqual(["U123"]);
  });

  it.each([
    ["A *dock of PKR 2,500* has been applied for taking leave without approval. <@U123>", 2500],
    ["A deduction of Rs. 2,000 has been applied for inactivity during working hours. <@U123>", 2000],
    ["A penalty of Rs 750 has been applied due to indiscipline. <@U123>", 750],
    ["A fine of *Rs. 12,500* has been applied due to absence. <@U123>", 12500],
  ] as const)("parses evidenced dock and deduction variant", (message, amount) => {
    const result = parserRegistry.parse("dock", input(message));
    expect(result?.recordType).toBe("DOCK");
    expect(result?.values.amount).toBe(amount);
  });

  it("is conservative with casual media messages", () => {
    expect(parserRegistry.parse("media-work", input("Morning everyone, hope you're well!"))).toBeNull();
    expect(parserRegistry.parse("media-work", input("Completed the client analytics automation and shipped the handoff."))?.values.classification).toBe("WORK_COMPLETED");
  });

  it("does not create a dock record without an amount", () => {
    expect(parserRegistry.parse("dock", input("Dock reported for late attendance"))).toBeNull();
  });
});
