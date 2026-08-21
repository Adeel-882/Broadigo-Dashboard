export type ParsedRecordType = "APPOINTMENT" | "SALE" | "LEAD" | "DOCK" | "MEDIA_ACTIVITY";

export interface ParserInput {
  rawSourceId: string;
  text: string;
  postedAt: Date;
  employeeId?: string | null;
}

export interface ParseResult {
  recordType: ParsedRecordType;
  values: Record<string, string | number | string[] | Record<string, string> | null>;
  confidence: number;
  rawSourceId: string;
  warnings: string[];
}

export interface SlackMessageParser {
  readonly key: string;
  parse(input: ParserInput): ParseResult | null;
}

export function normalizeSlackText(text: string) {
  return text
    .replace(/\*+/g, "")
    .replace(/(^|[\s:|])_+(?=\S)/g, "$1")
    .replace(/(?<=\S)_+(?=$|[\s:|.,])/g, "")
    .replace(/`+/g, "")
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ");
}

export function extractFields(text: string) {
  const fields = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const cleaned = line.trim().replace(/^[>•-]\s*/, "").replace(/^\*+|\*+$/g, "").trim();
    const match = cleaned.match(/^([\w /-]+?)\s*:\s*(.+?)\s*$/);
    if (match) fields.set(match[1].replace(/\*+/g, "").trim().toLowerCase(), match[2].replace(/^\*+|\*+$/g, "").trim());
  }
  return fields;
}

export function first(fields: Map<string, string>, ...keys: string[]) {
  for (const key of keys) {
    const value = fields.get(key);
    if (value) return value;
  }
  return null;
}

export function slackLinkLabel(value: string | null) {
  if (!value) return null;
  return value.replace(/<(?:tel|mailto):[^|>]+\|([^>]+)>/gi, "$1").trim();
}

export function money(value: string | null) {
  if (!value) return null;
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}
