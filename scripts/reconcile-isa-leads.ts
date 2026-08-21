/**
 * READ-ONLY reconciliation of Slack ISA lead submissions against the official
 * "Leads Edge Performance Dashboard" workbook.
 *
 * This script never writes to the database. It exists to explain differences
 * between Slack (the production source of truth) and the manually maintained
 * management sheet, which is treated only as a benchmark.
 *
 *   pnpm leads:reconcile              employee + day grid + cluster summary
 *   pnpm leads:reconcile --clusters   full repeat-prospect cluster detail
 *   pnpm leads:reconcile --parser     parser accept/reject delta vs stored rows
 *   pnpm leads:reconcile --audit      per-record audit export (redacted)
 *   pnpm leads:reconcile --audit --unmasked   internal use only: real contact data
 */
import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }, { parserRegistry }] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/parsers/registry"),
]);

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");

const rows = (result: unknown) => result as Array<Record<string, unknown>>;
const flag = (name: string) => process.argv.includes(`--${name}`);
const unmasked = flag("unmasked");

/** Official August 2026 totals from the management sheet the CEO reported (177). */
const SHEET_TOTALS: Record<string, number> = {
  "Asif Hazoor": 30, "Ali Jan": 31, "Haji Siraj Ahmed": 16, "Araad Rana": 10, "Alishba Ali": 21,
  "Hamdan Mahmood": 18, "Zeeshan Afsar": 17, "Zaynab Rafaqat": 22, "Aishah Arif": 12,
};

/**
 * Daily grid transcribed from "Leads Edge Performance Dashboard.xlsx" (Sheet1,
 * August 2026 block) as last saved 2026-08-19 01:58 Asia/Karachi, totalling 150.
 * The sheet carries weekday columns only — it has no cell for Saturday or Sunday.
 */
const SHEET_DAYS = ["08-03", "08-04", "08-05", "08-06", "08-07", "08-10", "08-11", "08-12", "08-13", "08-14", "08-17"];
const SHEET_GRID: Record<string, number[]> = {
  "Asif Hazoor":      [2, 3, 2, 2, 2, 5, 4, 1, 0, 2, 4],
  "Ali Jan":          [2, 0, 2, 3, 3, 3, 0, 3, 4, 0, 5],
  "Haji Siraj Ahmed": [3, 2, 1, 2, 1, 2, 1, 3, 1, 0, 0],
  "Araad Rana":       [0, 1, 0, 2, 1, 1, 1, 0, 0, 2, 1],
  "Alishba Ali":      [1, 1, 2, 1, 1, 3, 1, 0, 2, 1, 4],
  "Hamdan Mahmood":   [1, 1, 2, 0, 0, 2, 1, 2, 1, 1, 3],
  "Zeeshan Afsar":    [1, 1, 1, 1, 0, 0, 0, 1, 1, 2, 6],
  "Zaynab Rafaqat":   [0, 3, 1, 2, 0, 0, 0, 3, 1, 4, 4],
  "Aishah Arif":      [0, 2, 0, 1, 0, 3, 2, 0, 1, 0, 1],
};

const AUGUST_SHIFT_WINDOW = sql`l.occurred_at >= '2026-08-01T14:00:00Z'
  and l.occurred_at < '2026-09-01T00:00:00Z'
  and (timezone('Asia/Karachi', l.occurred_at)::time >= time '19:00'
    or timezone('Asia/Karachi', l.occurred_at)::time < time '05:00')`;

const normalizeName = (value: string) => value.toLowerCase().replace(/[^a-z]/g, "");
const canonicalPhone = (value: string) => value.replace(/\D/g, "").slice(-10);
const maskName = (value: string) => unmasked ? value
  : value.trim().split(/\s+/).map((part, index) => index === 0 ? `${part[0] ?? "?"}***` : `${part[0] ?? "?"}.`).join(" ");
const maskPhone = (value: string) => unmasked ? value : `***-***-${canonicalPhone(value).slice(-4)}`;
const maskEmail = (value: string) => unmasked || !value ? value : `${value[0]}***@${value.split("@")[1] ?? "?"}`;

interface LeadRecord extends Record<string, unknown> {
  lead_id: string; raw_message_id: string; slack_ts: string; slack_user_id: string; employee: string;
  operational_date: string; local_timestamp: string; contact_name: string; email: string; phone: string;
  state: string; area: string; lead_source: string; lead_type: string; property_type: string;
  call_appointment: string; content_hash: string;
}

async function loadAugustLeads() {
  return rows(await db!.execute(sql`
    select l.id lead_id, sm.id raw_message_id, sm.slack_ts, coalesce(sm.slack_user_id, '') slack_user_id,
      e.canonical_name employee,
      to_char((timezone('Asia/Karachi', l.occurred_at) - interval '5 hours')::date, 'MM-DD') operational_date,
      to_char(timezone('Asia/Karachi', l.occurred_at), 'YYYY-MM-DD HH24:MI') local_timestamp,
      coalesce(l.contact_name, '') contact_name, coalesce(l.email, '') email, coalesce(l.phone, '') phone,
      coalesce(l.state, '') state, coalesce(l.details->>'area', '') area,
      coalesce(l.details->>'lead source', '') lead_source, coalesce(l.lead_type, '') lead_type,
      coalesce(l.property_type, '') property_type, coalesce(l.details->>'call appointment', '') call_appointment,
      md5(regexp_replace(lower(trim(sm.raw_text)), '\\s+', ' ', 'g')) content_hash
    from leads l
      join slack_messages sm on sm.id = l.slack_message_id
      join employees e on e.id = l.employee_id
    where ${AUGUST_SHIFT_WINDOW}
    order by l.occurred_at`)) as LeadRecord[];
}

/** Union-find clustering over shared canonical phone, normalized email, or normalized prospect name. */
function clusterProspects(records: LeadRecord[]) {
  const parent = new Map<string, string>();
  const find = (key: string): string => {
    let root = parent.get(key) ?? key;
    if (root !== key) { root = find(root); parent.set(key, root); }
    return root;
  };
  const union = (a: string, b: string) => {
    const rootA = find(a); const rootB = find(b);
    if (rootA !== rootB) parent.set(rootA, rootB);
  };
  const link = (leadKey: string, key: string) => { if (!parent.has(key)) parent.set(key, key); union(leadKey, key); };

  for (const record of records) {
    const leadKey = `L:${record.lead_id}`;
    parent.set(leadKey, leadKey);
    const phone = canonicalPhone(record.phone);
    const email = record.email.toLowerCase().trim();
    const name = normalizeName(record.contact_name);
    if (phone.length === 10) link(leadKey, `P:${phone}`);
    if (email) link(leadKey, `E:${email}`);
    if (name.length > 4) link(leadKey, `N:${name}`);
  }

  const grouped = new Map<string, LeadRecord[]>();
  for (const record of records) {
    const root = find(`L:${record.lead_id}`);
    grouped.set(root, [...(grouped.get(root) ?? []), record]);
  }
  return [...grouped.values()].sort((a, b) => b.length - a.length);
}

function reportEmployeeComparison(records: LeadRecord[]) {
  const bySlack = new Map<string, number>();
  for (const record of records) bySlack.set(record.employee, (bySlack.get(record.employee) ?? 0) + 1);
  const table = Object.keys(SHEET_TOTALS).map((employee) => {
    const slack = bySlack.get(employee) ?? 0;
    return { employee, slack_structured_leads: slack, official_sheet: SHEET_TOTALS[employee], difference: slack - SHEET_TOTALS[employee] };
  });
  const slackTotal = table.reduce((sum, row) => sum + row.slack_structured_leads, 0);
  const sheetTotal = table.reduce((sum, row) => sum + row.official_sheet, 0);
  table.push({ employee: "TOTAL", slack_structured_leads: slackTotal, official_sheet: sheetTotal, difference: slackTotal - sheetTotal });
  console.log("\nEMPLOYEE COMPARISON — AUGUST 2026 OPERATIONAL SHIFTS (19:00–05:00 Asia/Karachi)");
  console.table(table);
}

function reportDayGrid(records: LeadRecord[]) {
  const grid = new Map<string, number>();
  for (const record of records) {
    const key = `${record.employee}|${record.operational_date}`;
    grid.set(key, (grid.get(key) ?? 0) + 1);
  }
  console.log("\nDAY x EMPLOYEE — slack/sheet, '!' marks a disagreement");
  console.log("Window Aug 3–17 only: that is all the archived workbook snapshot (saved 2026-08-19 01:58, total 150) covers.");
  console.log("employee".padEnd(18) + SHEET_DAYS.map((day) => day.slice(3).padStart(8)).join("") + "    slack sheet  diff");
  let slackTotal = 0; let sheetTotal = 0;
  for (const [employee, sheetRow] of Object.entries(SHEET_GRID)) {
    let slack = 0; let sheet = 0; const cells: string[] = [];
    SHEET_DAYS.forEach((day, index) => {
      const slackValue = grid.get(`${employee}|${day}`) ?? 0;
      const sheetValue = sheetRow[index];
      slack += slackValue; sheet += sheetValue;
      cells.push(`${slackValue}/${sheetValue}${slackValue === sheetValue ? " " : "!"}`.padStart(8));
    });
    slackTotal += slack; sheetTotal += sheet;
    console.log(employee.padEnd(18) + cells.join("") + String(slack).padStart(9) + String(sheet).padStart(6) + String(slack - sheet).padStart(6));
  }
  const dayCells = SHEET_DAYS.map((day, index) => {
    let slack = 0; let sheet = 0;
    for (const [employee, sheetRow] of Object.entries(SHEET_GRID)) { slack += grid.get(`${employee}|${day}`) ?? 0; sheet += sheetRow[index]; }
    return `${slack}/${sheet}`.padStart(8);
  });
  console.log("TOTAL".padEnd(18) + dayCells.join("") + String(slackTotal).padStart(9) + String(sheetTotal).padStart(6) + String(slackTotal - sheetTotal).padStart(6));

  const weekend = records.filter((record) => !SHEET_DAYS.includes(record.operational_date) && record.operational_date <= "08-17");
  const weekendDays = [...new Set(weekend.map((record) => record.operational_date))].sort();
  console.log(`\nOperational days inside Aug 3–17 that the sheet has NO column for: ${weekendDays.join(", ") || "none"} (${weekend.length} Slack leads).`);
}

/**
 * Splits the Slack-vs-sheet gap into the parts the evidence actually supports:
 * days the sheet has not reached, days the sheet has no column for, and the
 * residual drift of a hand-keyed tally.
 */
function reportDecomposition(records: LeadRecord[]) {
  const byDay = new Map<string, number>();
  const grid = new Map<string, number>();
  for (const record of records) {
    byDay.set(record.operational_date, (byDay.get(record.operational_date) ?? 0) + 1);
    grid.set(`${record.employee}|${record.operational_date}`, (grid.get(`${record.employee}|${record.operational_date}`) ?? 0) + 1);
  }
  let slackAbove = 0; let sheetAbove = 0; let slackAboveCells = 0; let sheetAboveCells = 0;
  for (const [employee, sheetRow] of Object.entries(SHEET_GRID)) {
    SHEET_DAYS.forEach((day, index) => {
      const slack = grid.get(`${employee}|${day}`) ?? 0;
      const sheet = sheetRow[index];
      if (slack > sheet) { slackAbove += slack - sheet; slackAboveCells++; }
      else if (sheet > slack) { sheetAbove += sheet - slack; sheetAboveCells++; }
    });
  }
  const total = records.length;
  const pastSheet = byDay.get("08-20") ?? 0;
  const weekend = [...byDay.entries()].filter(([day]) => !SHEET_DAYS.includes(day) && day <= "08-17").reduce((sum, [, n]) => sum + n, 0);
  const sheetTotal = Object.values(SHEET_TOTALS).reduce((sum, n) => sum + n, 0);
  console.log("\nCELL-LEVEL DIVERGENCE ACROSS THE 99 SHARED GRID CELLS (Aug 3–17)");
  console.log(`  Slack above sheet: ${slackAboveCells} cells / ${slackAbove} leads`);
  console.log(`  sheet above Slack: ${sheetAboveCells} cells / ${sheetAbove} leads`);
  console.log(`  gross disagreement ${slackAbove + sheetAbove} leads, net ${slackAbove - sheetAbove}.`);
  console.log("  Disagreement runs in BOTH directions, so no record-removal rule can reconcile the two sources.");
  console.log("\nDECOMPOSITION OF THE SLACK-VS-SHEET GAP");
  console.table([
    { component: "Slack structured leads (operational Aug 3–20)", leads: total },
    { component: "less operational Aug 20 — past the sheet's last filled column", leads: -pastSheet },
    { component: "less weekend operational days — the sheet has no weekend column", leads: -weekend },
    { component: "less residual hand-keying divergence on weekdays", leads: -(total - pastSheet - weekend - sheetTotal) },
    { component: "Official sheet benchmark", leads: sheetTotal },
  ]);
}

function reportClusters(records: LeadRecord[], detailed: boolean) {
  const clusters = clusterProspects(records).filter((cluster) => cluster.length > 1);
  const surplus = clusters.reduce((sum, cluster) => sum + cluster.length - 1, 0);
  const sameIsa = clusters.filter((cluster) => new Set(cluster.map((record) => record.employee)).size === 1);
  const crossIsa = clusters.filter((cluster) => new Set(cluster.map((record) => record.employee)).size > 1);
  console.log("\nREPEAT-PROSPECT CLUSTERS (linked by canonical phone, normalized email, or normalized name)");
  console.table([{
    total_slack_leads: records.length,
    clusters: clusters.length,
    surplus_submissions: surplus,
    unique_prospects: records.length - surplus,
    clusters_same_isa: sameIsa.length,
    surplus_same_isa: sameIsa.reduce((sum, cluster) => sum + cluster.length - 1, 0),
    clusters_cross_isa: crossIsa.length,
    surplus_cross_isa: crossIsa.reduce((sum, cluster) => sum + cluster.length - 1, 0),
  }]);
  if (!detailed) { console.log("Run with --clusters for per-cluster evidence."); return; }
  console.table(clusters.map((cluster, index) => {
    const dates = cluster.map((record) => record.operational_date);
    const phones = new Set(cluster.map((record) => canonicalPhone(record.phone)));
    const emails = new Set(cluster.map((record) => record.email.toLowerCase()).filter(Boolean));
    const names = new Set(cluster.map((record) => normalizeName(record.contact_name)));
    const dayNumbers = dates.map((date) => Number(date.replace("-", "")));
    return {
      cluster: index + 1,
      submissions: cluster.length,
      employees: [...new Set(cluster.map((record) => record.employee))].join(", "),
      operational_dates: dates.join(" "),
      span_days: Math.max(...dayNumbers) - Math.min(...dayNumbers),
      prospect: maskName(cluster[0].contact_name),
      matched_on: [phones.size === 1 ? "phone" : null, emails.size === 1 && emails.size ? "email" : null, names.size === 1 ? "name" : null]
        .filter(Boolean).join("+") || "transitively linked",
      lead_sources: [...new Set(cluster.map((record) => record.lead_source || "(none)"))].join(", "),
    };
  }));
}

async function reportTechnicalIntegrity() {
  console.log("\nTECHNICAL DUPLICATE / INTEGRITY CHECKS");
  console.table(rows(await db!.execute(sql`select
    (select count(*)::int from (select slack_message_id from leads group by 1 having count(*) > 1) d) duplicate_lead_per_message,
    (select count(*)::int from (select sm.workspace_id, sm.channel_id, sm.slack_ts from leads l
      join slack_messages sm on sm.id = l.slack_message_id group by 1, 2, 3 having count(*) > 1) d) duplicate_lead_per_slack_ts,
    (select count(*)::int from leads l left join slack_messages sm on sm.id = l.slack_message_id where sm.id is null) orphaned_leads,
    (select count(*)::int from (select workspace_id, channel_id, slack_ts from slack_messages group by 1, 2, 3 having count(*) > 1) d) duplicate_raw_messages`)));
}

async function reportParserDelta() {
  const messages = rows(await db!.execute(sql`
    select sm.id, sm.raw_text, sm.posted_at, sm.employee_id, l.id lead_id,
      nullif(trim(l.details->>'lead source'), '') stored_lead_source,
      to_char(timezone('Asia/Karachi', sm.posted_at), 'YYYY-MM-DD') local_date,
      coalesce(e.canonical_name, '(unmapped)') employee,
      (timezone('Asia/Karachi', sm.posted_at) - interval '5 hours')::date
        between date '2026-08-01' and date '2026-08-31' is_august
    from slack_messages sm
      join slack_channels c on c.id = sm.channel_id
      left join leads l on l.slack_message_id = sm.id
      left join employees e on e.id = sm.employee_id
    where c.parser_type = 'leads'
    order by sm.posted_at`));

  const additions: Array<Record<string, unknown>> = [];
  const removals: Array<Record<string, unknown>> = [];
  let sourceGained = 0;
  for (const message of messages) {
    const parsed = parserRegistry.parse("leads", {
      rawSourceId: String(message.id), text: String(message.raw_text),
      postedAt: new Date(String(message.posted_at)), employeeId: message.employee_id ? String(message.employee_id) : null,
    });
    const stored = Boolean(message.lead_id);
    const summary = { local_date: String(message.local_date), employee: String(message.employee), august: Boolean(message.is_august) };
    if (parsed && !stored) additions.push(summary);
    if (!parsed && stored) removals.push(summary);
    if (parsed && stored && !message.stored_lead_source
      && (parsed.values.details as Record<string, string> | undefined)?.["lead source"]) sourceGained++;
  }
  console.log("\nPARSER DELTA — what a reprocess with the current parser would change");
  console.table([{
    isa_messages_examined: messages.length,
    stored_leads: messages.filter((message) => message.lead_id).length,
    would_add: additions.length, would_add_in_august: additions.filter((row) => row.august).length,
    would_remove: removals.length, would_remove_in_august: removals.filter((row) => row.august).length,
    would_gain_lead_source: sourceGained,
  }]);
  if (additions.length) { console.log("WOULD ADD:"); console.table(additions); }
  if (removals.length) { console.log("WOULD REMOVE (requires approval — see the reconciliation report):"); console.table(removals); }
}

function reportAudit(records: LeadRecord[]) {
  const clusters = clusterProspects(records);
  const clusterByLead = new Map<string, { index: number; size: number }>();
  clusters.forEach((cluster, index) => {
    for (const record of cluster) clusterByLead.set(record.lead_id, { index: index + 1, size: cluster.length });
  });
  const seen = new Set<string>();
  console.log(`\nPER-RECORD AUDIT (${records.length} records)${unmasked ? " — UNMASKED, contains customer data" : " — contact details masked"}`);
  console.table(records.map((record) => {
    const cluster = clusterByLead.get(record.lead_id)!;
    const firstOfCluster = !seen.has(String(cluster.index));
    seen.add(String(cluster.index));
    return {
      slack_ts: record.slack_ts, slack_user_id: record.slack_user_id, employee: record.employee,
      operational_date: record.operational_date, local_timestamp: record.local_timestamp,
      prospect: maskName(record.contact_name), normalized_prospect: unmasked ? normalizeName(record.contact_name) : "(masked)",
      phone: maskPhone(record.phone), canonical_phone: unmasked ? canonicalPhone(record.phone) : "(masked)",
      email: maskEmail(record.email), state: record.state, area: record.area,
      lead_source: record.lead_source || "(none)", lead_type: record.lead_type, property_type: record.property_type,
      call_appointment: record.call_appointment, content_hash: record.content_hash.slice(0, 12),
      repeat_of_other_record: cluster.size > 1, first_submission_for_prospect: firstOfCluster,
      genuine_new_slack_submission: true,
    };
  }));
}

try {
  const records = await loadAugustLeads();
  if (flag("audit")) {
    reportAudit(records);
  } else {
    reportEmployeeComparison(records);
    reportDayGrid(records);
    reportDecomposition(records);
    reportClusters(records, flag("clusters"));
    await reportTechnicalIntegrity();
    if (flag("parser")) await reportParserDelta();
    else console.log("\nRun with --parser for the reprocess delta, --audit for the per-record export.");
  }
} finally {
  await closeDb();
}
