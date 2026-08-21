import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }, { resolveDateRange }, { occurredAt, operationalShiftFilter }] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/time-ranges"),
  import("@/lib/operational-query"),
]);

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");

const cases = [
  { period: "Today" as const },
  { period: "Yesterday" as const },
  { period: "This Week" as const },
  { period: "Last Week" as const },
  { period: "This Month" as const },
  { period: "Last Month" as const },
  { period: "Custom Range" as const, start: "2026-05-01", end: "2026-08-20" },
];

type Row = Record<string, unknown>;
const rows = (result: unknown) => result as Row[];

try {
  const output: Row[] = [];
  for (const item of cases) {
    const range = resolveDateRange(item.period, item.start, item.end);
    const start = range.start.toISOString();
    const end = range.end.toISOString();
    const current = (column: string) => operationalShiftFilter(occurredAt(column), start, end);
    const database = rows(await db.execute(sql`
      select
        (select count(*)::int from appointments where ${current("occurred_at")}) appointments,
        (select count(*)::int from sales where ${current("occurred_at")}) sales,
        (select coalesce(sum(amount),0) from sales where ${current("occurred_at")}) revenue,
        (select count(*)::int from leads where ${current("occurred_at")}) leads,
        (select count(*)::int from docks where ${current("occurred_at")}) docks,
        (select count(*)::int from media_activity where ${current("occurred_at")}) media
    `))[0] ?? {};
    output.push({
      period: item.period,
      range: range.label,
      appointments: Number(database.appointments),
      sales: Number(database.sales),
      revenue: Number(database.revenue),
      leads: Number(database.leads),
      docks: Number(database.docks),
      media: Number(database.media),
    });
  }
  console.table(output);
} finally {
  await closeDb();
}
