/**
 * READ-ONLY audit of the Slack-reaction lead eligibility rule.
 *
 * Fetches the CURRENT reactions on every #leads-reporting message from Slack
 * and reports what the management rule would do, without writing anything.
 *
 *   pnpm leads:audit-reactions             August summary + benchmark comparison
 *   pnpm leads:audit-reactions --all       every month, not just August
 *   pnpm leads:audit-reactions --excluded  list the excluded August records
 */
import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

import type { SlackReaction } from "@/lib/slack/reactions";

const [{ sql }, { closeDb, getDb }, { deriveLeadEligibility }] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/slack/reactions"),
]);

interface LeadRow {
  lead_id: string; slack_ts: string; employee: string; operational_date: string; contact_name: string;
}

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");
const token = process.env.SLACK_BOT_TOKEN;
if (!token) throw new Error("SLACK_BOT_TOKEN is required.");

const rows = (result: unknown) => result as Array<Record<string, unknown>>;
const flag = (name: string) => process.argv.includes(`--${name}`);

const SHEET_TOTALS: Record<string, number> = {
  "Asif Hazoor": 30, "Ali Jan": 31, "Haji Siraj Ahmed": 16, "Araad Rana": 10, "Alishba Ali": 21,
  "Hamdan Mahmood": 18, "Zeeshan Afsar": 17, "Zaynab Rafaqat": 22, "Aishah Arif": 12,
};

/** Pages the whole channel history and returns slack_ts -> current reactions. */
export async function fetchChannelReactions(slackChannelId: string) {
  const byTs = new Map<string, SlackReaction[]>();
  let cursor: string | undefined;
  let pages = 0;
  do {
    const params = new URLSearchParams({ channel: slackChannelId, limit: "200" });
    if (cursor) params.set("cursor", cursor);
    let response = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (response.status === 429) {
      const wait = Math.max(1, Number(response.headers.get("retry-after") ?? 1));
      await new Promise((resolve) => setTimeout(resolve, wait * 1000));
      response = await fetch(`https://slack.com/api/conversations.history?${params}`, {
        headers: { authorization: `Bearer ${token}` }, cache: "no-store",
      });
    }
    const payload = await response.json() as {
      ok: boolean; error?: string;
      messages?: Array<{ ts: string; reactions?: SlackReaction[] }>;
      response_metadata?: { next_cursor?: string };
    };
    if (!payload.ok) throw new Error(`Slack conversations.history failed: ${payload.error ?? "unknown"}`);
    for (const message of payload.messages ?? []) byTs.set(message.ts, message.reactions ?? []);
    cursor = payload.response_metadata?.next_cursor || undefined;
    pages += 1;
  } while (cursor);
  return { byTs, pages };
}

try {
  const [channel] = rows(await db.execute(sql`
    select slack_channel_id, name from slack_channels where parser_type = 'leads' and active = true limit 1`));
  if (!channel) throw new Error("No active leads channel is configured.");

  console.log(`Fetching current reactions from #${channel.name} ...`);
  const { byTs, pages } = await fetchChannelReactions(String(channel.slack_channel_id));
  console.log(`Read ${byTs.size} messages across ${pages} page(s) of Slack history.\n`);

  const augustFilter = flag("all") ? sql`true` : sql`
    l.occurred_at >= '2026-08-01T14:00:00Z' and l.occurred_at < '2026-09-01T00:00:00Z'
    and (timezone('Asia/Karachi', l.occurred_at)::time >= time '19:00'
      or timezone('Asia/Karachi', l.occurred_at)::time < time '05:00')`;

  const leads = rows(await db.execute(sql`
    select l.id lead_id, sm.slack_ts, e.canonical_name employee,
      to_char((timezone('Asia/Karachi', l.occurred_at) - interval '5 hours')::date, 'YYYY-MM-DD') operational_date,
      coalesce(l.contact_name, '') contact_name
    from leads l
      join slack_messages sm on sm.id = l.slack_message_id
      join employees e on e.id = l.employee_id
    where ${augustFilter}
    order by l.occurred_at`)) as unknown as LeadRow[];

  let missingFromSlack = 0;
  const evaluated = leads.map((lead) => {
    const current = byTs.get(String(lead.slack_ts));
    if (current === undefined) missingFromSlack += 1;
    const eligibility = deriveLeadEligibility(current);
    return { ...lead, ...eligibility, reactionNames: (current ?? []).map((r) => r.name) };
  });

  const withX = evaluated.filter((lead) => lead.exclusionReasons.includes("X_REACTION"));
  const withArrow = evaluated.filter((lead) => lead.exclusionReasons.includes("ARROW_LEFT_REACTION"));
  const withBoth = evaluated.filter((lead) => lead.exclusionReasons.length === 2);
  const counted = evaluated.filter((lead) => lead.countsTowardKpi);

  console.log(flag("all") ? "ALL-HISTORY REACTION AUDIT" : "AUGUST 2026 REACTION AUDIT (operational shifts 19:00–05:00 Asia/Karachi)");
  console.table([{
    total_submitted_leads: evaluated.length,
    leads_with_x: withX.length,
    leads_with_arrow_left: withArrow.length,
    leads_with_both: withBoth.length,
    leads_with_neither: counted.length,
    not_found_in_slack_history: missingFromSlack,
  }]);

  const byEmployee = new Map<string, { submitted: number; counted: number; x: number; arrow: number }>();
  for (const lead of evaluated) {
    const key = String(lead.employee);
    const entry = byEmployee.get(key) ?? { submitted: 0, counted: 0, x: 0, arrow: 0 };
    entry.submitted += 1;
    if (lead.countsTowardKpi) entry.counted += 1;
    if (lead.exclusionReasons.includes("X_REACTION")) entry.x += 1;
    if (lead.exclusionReasons.includes("ARROW_LEFT_REACTION")) entry.arrow += 1;
    byEmployee.set(key, entry);
  }

  const names = flag("all") ? [...byEmployee.keys()].sort() : Object.keys(SHEET_TOTALS);
  const table = names.map((employee) => {
    const entry = byEmployee.get(employee) ?? { submitted: 0, counted: 0, x: 0, arrow: 0 };
    const benchmark = SHEET_TOTALS[employee];
    return {
      employee, submitted: entry.submitted, excluded_x: entry.x, excluded_arrow_left: entry.arrow,
      counted: entry.counted,
      official_sheet: flag("all") ? "" : benchmark ?? "",
      difference: flag("all") || benchmark === undefined ? "" : entry.counted - benchmark,
    };
  });
  const sum = (key: "submitted" | "counted" | "excluded_x" | "excluded_arrow_left") =>
    table.reduce((total, row) => total + Number(row[key] ?? 0), 0);
  table.push({
    employee: "TOTAL", submitted: sum("submitted"), excluded_x: sum("excluded_x"),
    excluded_arrow_left: sum("excluded_arrow_left"), counted: sum("counted"),
    official_sheet: flag("all") ? "" : Object.values(SHEET_TOTALS).reduce((a, b) => a + b, 0),
    difference: flag("all") ? "" : sum("counted") - Object.values(SHEET_TOTALS).reduce((a, b) => a + b, 0),
  });
  console.log("\nEMPLOYEE-BY-EMPLOYEE COUNTED TOTALS");
  console.table(table);

  if (flag("excluded")) {
    console.log("\nEXCLUDED RECORDS (preserved, never deleted)");
    console.table(evaluated.filter((lead) => !lead.countsTowardKpi).map((lead) => ({
      operational_date: lead.operational_date, employee: lead.employee, slack_ts: lead.slack_ts,
      prospect: String(lead.contact_name).trim().split(/\s+/).map((part, index) => index === 0 ? `${part[0] ?? "?"}***` : `${part[0] ?? "?"}.`).join(" "),
      exclusion_reasons: lead.exclusionReasons.join(" + "), all_reactions: lead.reactionNames.join(", "),
    })));
  } else {
    console.log("\nRun with --excluded to list the excluded records, --all for every month.");
  }
} finally {
  await closeDb();
}
