import type { ParseResult, ParserInput, SlackMessageParser } from "@/lib/parsers/types";
import { extractFields, first, money, normalizeSlackText, slackLinkLabel } from "@/lib/parsers/types";

class AppointmentParser implements SlackMessageParser {
  constructor(public readonly key: string) {}
  parse(input: ParserInput): ParseResult | null {
    const f = extractFields(input.text);
    const phone = slackLinkLabel(first(f, "phone", "phone number", "number")) ?? input.text.match(/<tel:[^|>]+\|([^>]+)>/i)?.[1] ?? null;
    const sentenceProspect = input.text.match(/\bwith\s*(.*?)\s*<tel:/i)?.[1]?.trim()
      ?? input.text.match(/\bcall\s+scheduled\s*:\s*(.+?)(?:\s+[I|]\s*)?<tel:/i)?.[1]?.trim()
      ?? null;
    const prospect = first(f, "prospect", "realtor", "business", "client", "name") ?? sentenceProspect;
    const date = first(f, "date", "scheduled date", "appointment date")
      ?? input.text.match(/\b(today|tomorrow|(?:mon|tues|wednes|thurs|fri|satur|sun)day(?:\s+\d{1,2}(?:st|nd|rd|th)?(?:\s+\w+)?)?)\b/i)?.[1]
      ?? null;
    const time = first(f, "time", "scheduled time", "appointment time")
      ?? input.text.match(/\b(?:at|for)\s+(right\s+now|now|\d{1,2}(?::\d{2})\s*(?:am|pm)?(?:\s*(?:est|edt|cst|cdt|mst|mdt|pst|pdt))?)\b/i)?.[1]
      ?? null;
    const bookingPhrase = /\b(?:call|appointment)\s+(?:has\s+been\s+)?(?:scheduled|booked|set)\b/i.test(input.text);
    if (!phone || !bookingPhrase) return null;
    const warnings = [!prospect && "Prospect name missing", !date && "Scheduled date missing", !time && "Scheduled time missing"].filter(Boolean) as string[];
    return { recordType: "APPOINTMENT", rawSourceId: input.rawSourceId, confidence: warnings.length ? 0.82 : 0.96, warnings, values: { prospectName: prospect || null, phone, state: first(f, "state") ?? input.text.match(/\bfrom\s*([A-Z]{2})\s+for\b/i)?.[1]?.toUpperCase() ?? null, scheduledText: [date, time].filter(Boolean).join(" ") || null, originalTimezone: first(f, "timezone", "time zone") ?? input.text.match(/\b(EST|EDT|CST|CDT|MST|MDT|PST|PDT)\b/i)?.[1]?.toUpperCase() ?? null, assignedPerson: first(f, "assigned", "assigned person", "assigned to") ?? input.text.match(/assigned\s+to\s+<@([A-Z0-9]+)>/i)?.[1] ?? null } };
  }
}

class SaleParser implements SlackMessageParser {
  constructor(public readonly key: string) {}
  parse(input: ParserInput): ParseResult | null {
    const f = extractFields(input.text);
    const inlineAmount = input.text.match(/\b(?:edge\s+[a-z][a-z\s-]*?\s+plan|plan|package|revenue|sale(?:\s+amount)?|total)\s*(?:-|:)?\s*(?:USD|PKR)?\s*\$?\s*([\d][\d,' ]*(?:\.\d+)?)/i)?.[1] ?? null;
    const parsedAmount = money(first(f, "revenue", "sale amount", "amount", "total") ?? inlineAmount);
    const amount = parsedAmount == null ? null : Math.abs(parsedAmount);
    const phone = slackLinkLabel(first(f, "phone", "number", "contact", "cell number")) ?? input.text.match(/<tel:[^|>]+\|([^>]+)>/i)?.[1] ?? null;
    const email = slackLinkLabel(first(f, "email")) ?? input.text.match(/<mailto:[^|>]+\|([^>]+)>/i)?.[1] ?? input.text.match(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/)?.[0] ?? null;
    const packageName = first(f, "package", "plan") ?? input.text.match(/\b(Edge\s+[A-Za-z][A-Za-z\s-]*?\s+Plan)\b/i)?.[1]?.trim() ?? null;
    if ((!phone && !email) || (!packageName && !/\b(?:sold|closed deal)\b/i.test(input.text))) return null;
    const zipText = first(f, "zip", "zips", "zip codes") ?? input.text.match(/\bZIPs?\s*:\s*([^|\n]+)/i)?.[1] ?? "";
    const warnings = amount == null ? ["Sale amount missing in source message"] : [];
    return { recordType: "SALE", rawSourceId: input.rawSourceId, confidence: amount == null ? 0.82 : 0.96, warnings, values: { customerName: first(f, "customer", "client", "name") ?? input.text.match(/^\s*([^<|\n]+?)\s*<tel:/)?.[1]?.trim() ?? null, phone, email, packageName, amount, currency: first(f, "currency") ?? (input.text.includes("PKR") ? "PKR" : "USD"), state: first(f, "state") ?? input.text.match(/\|\s*([A-Z]{2})\s*\|/)?.[1] ?? null, zipCodes: [...zipText.matchAll(/\b\d{5}\b/g)].map((match) => match[0]) } };
  }
}

// Evidenced ISA phone labels. Longer labels lead the alternation so it cannot stop early on "phone" or "contact".
const LEAD_PHONE_LABELS = ["phone", "number", "phone number", "cell number", "contact number", "mobile", "contact"] as const;
const PHONE_LABEL_ALT = "cell\\s*number|contact\\s*number|phone\\s*number|number|phone|mobile|contact";
// Evidenced variants include "Number:", "Phone Number:", "Number: :" and a repeated "Number: Number:" label.
const LEAD_PHONE_LINE = new RegExp(`^\\s*(?:${PHONE_LABEL_ALT})\\s*:?(?:\\s*(?:${PHONE_LABEL_ALT})?\\s*:)?\\s*(?=<tel:|[+(\\d])`, "im");
const LEAD_PHONE_PREFIX = new RegExp(`^(?:\\s*(?:${PHONE_LABEL_ALT})?\\s*:)+\\s*`, "i");

class LeadParser implements SlackMessageParser {
  readonly key = "leads";
  parse(input: ParserInput): ParseResult | null {
    const f = extractFields(input.text);
    const leadType = first(f, "lead type", "buyer/seller");
    const contactName = first(f, "name", "contact");
    const labelledPhone = first(f, ...LEAD_PHONE_LABELS)?.replace(LEAD_PHONE_PREFIX, "").trim() || null;
    const phone = slackLinkLabel(labelledPhone) ?? input.text.match(/<tel:[^|>]+\|([^>]+)>/i)?.[1] ?? null;
    const phoneDigits = phone?.replace(/\D/g, "") ?? "";
    const propertyType = first(f, "property", "property type", "type of property");
    const location = first(f, "state", "area", "area/city", "city", "address", "address 1");
    const recognizedLeadType = leadType && /^(?:buyer|seller|buyer\s*(?:and|&)\s*seller)$/i.test(leadType.trim());
    const explicitTemplate = /^\s*lead\s+type\s*:/im.test(input.text)
      && /^\s*(?:name|contact)\s*:/im.test(input.text)
      && LEAD_PHONE_LINE.test(input.text)
      && /^\s*(?:type of property|property type|property)\s*:/im.test(input.text);
    if (!recognizedLeadType || !contactName || !phone || phoneDigits.length < 7 || !propertyType || !location || !explicitTemplate) return null;

    const details = Object.fromEntries(f);
    const inferredLeadSource = input.text.match(/^\s*lead\s+source\s+(?!:)(.+?)\s*$/im)?.[1]?.trim() ?? null;
    if (!details["lead source"] && inferredLeadSource) details["lead source"] = inferredLeadSource;
    const warnings = details["lead source"] ? [] : ["Lead source missing in source message"];
    return { recordType: "LEAD", rawSourceId: input.rawSourceId, confidence: warnings.length ? 0.92 : 0.98, warnings, values: { leadType, contactName, phone, email: slackLinkLabel(first(f, "email")) ?? input.text.match(/<mailto:[^|>]+\|([^>]+)>/i)?.[1] ?? null, propertyType, state: first(f, "state"), timeline: first(f, "timeline"), details } };
  }
}

class DockParser implements SlackMessageParser {
  readonly key = "dock";
  parse(input: ParserInput): ParseResult | null {
    const f = extractFields(input.text);
    const inlineAmount = input.text.match(/\b(?:dock|deduction|penalty|fine)(?:\s+amount)?(?:\s+of)?\s*(?:PKR|Rs\.?|USD|\$)?\s*([\d,]+(?:\.\d+)?)/i)?.[1]
      ?? input.text.match(/(?:PKR|Rs\.?|USD|\$)\s*([\d,]+(?:\.\d+)?)\s*(?:dock|deduction|penalty|fine)\b/i)?.[1]
      ?? null;
    const amount = money(first(f, "amount", "dock amount", "fine") ?? inlineAmount);
    if (amount === null || !/\b(?:dock|deduction|penalty|fine)\b/i.test(input.text)) return null;
    const explicitReason = first(f, "reason")
      ?? input.text.match(/\b(?:for|due\s+to|because\s+of)\s+(.+?)(?=\s*<@[A-Z0-9]+>|\s*$)/is)?.[1]?.trim()
      ?? null;
    const warnings = explicitReason ? [] : ["Dock reason not specified in source message"];
    return { recordType: "DOCK", rawSourceId: input.rawSourceId, confidence: explicitReason ? 0.96 : 0.84, warnings, values: { amount, currency: first(f, "currency") ?? (input.text.includes("$") || /\bUSD\b/i.test(input.text) ? "USD" : "PKR"), reason: explicitReason ?? "Not specified in source message", appliedBy: first(f, "applied by", "reported by"), notes: first(f, "notes"), targetSlackUserIds: [...input.text.matchAll(/<@([A-Z0-9]+)>/g)].map((match) => match[1]) } };
  }
}

class MediaWorkParser implements SlackMessageParser {
  readonly key = "media-work";
  parse(input: ParserInput): ParseResult | null {
    const text = input.text.trim();
    if (text.length < 20) return null;
    const completed = /\b(completed|finished|shipped|deployed|resolved|delivered)\b/i.test(text);
    const blocker = /\b(blocked|blocker|waiting on|cannot proceed)\b/i.test(text);
    const progress = /\b(working on|in progress|progress update|implemented|built|fixed|tested)\b/i.test(text);
    const announcement = /\b(announcement|reminder|welcome|congratulations)\b/i.test(text);
    const classification = completed ? "WORK_COMPLETED" : blocker ? "BLOCKER" : progress ? "WORK_IN_PROGRESS" : announcement ? "ANNOUNCEMENT" : "GENERAL";
    if (classification === "GENERAL") return null;
    return { recordType: "MEDIA_ACTIVITY", rawSourceId: input.rawSourceId, confidence: completed || blocker ? 0.88 : 0.76, warnings: [], values: { classification, summary: text.slice(0, 240), blocker: blocker ? text.slice(0, 500) : null } };
  }
}

const parsers: SlackMessageParser[] = [
  new AppointmentParser("broadigo-appointment"), new AppointmentParser("leadsedge-appointment"), new AppointmentParser("media-appointment"),
  new SaleParser("broadigo-sale"), new SaleParser("leadsedge-sale"), new LeadParser(), new DockParser(), new MediaWorkParser(),
];

export class ParserRegistry {
  private readonly byKey = new Map(parsers.map((parser) => [parser.key, parser]));
  parse(key: string, input: ParserInput): ParseResult | null {
    const parser = this.byKey.get(key);
    return parser?.parse({ ...input, text: normalizeSlackText(input.text) }) ?? null;
  }
  has(key: string) { return this.byKey.has(key); }
  keys() { return [...this.byKey.keys()]; }
}

export const parserRegistry = new ParserRegistry();
