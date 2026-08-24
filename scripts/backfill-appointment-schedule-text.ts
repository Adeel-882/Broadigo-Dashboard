/**
 * Backfills appointments.scheduled_text from the stored Slack message.
 *
 * Re-runs only the appointment parser over raw text that is already persisted and
 * writes back one display-only column. It never touches attribution, teams,
 * employees, sales, leads or any other record type, and never inserts or deletes
 * rows. Idempotent.
 *
 *   pnpm tsx scripts/backfill-appointment-schedule-text.ts --dry-run
 */
import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const [{ sql }, { closeDb, getDb }, { parserRegistry }] = await Promise.all([
  import("drizzle-orm"), import("@/lib/db/client"), import("@/lib/parsers/registry")]);
const db = getDb(); if (!db) throw new Error("DATABASE_URL is required.");
const dryRun = process.argv.includes("--dry-run");
const rows = (r: unknown) => r as Array<Record<string, unknown>>;
try {
  const candidates = rows(await db.execute(sql`
    select a.id, a.scheduled_text, a.scheduled_at, sm.raw_text, sm.posted_at, c.parser_type
    from appointments a
      join slack_messages sm on sm.id = a.slack_message_id
      join slack_channels c on c.id = sm.channel_id`));
  const pending: Array<{ id: string; text: string; scheduledAt: string | null }> = [];
  let unchanged = 0, noText = 0;
  for (const row of candidates) {
    const parsed = parserRegistry.parse(String(row.parser_type), {
      rawSourceId: String(row.id), text: String(row.raw_text),
      postedAt: new Date(String(row.posted_at)), employeeId: null });
    const value = (parsed?.values?.scheduledText ?? null) as string | null;
    if (!value) { noText += 1; continue; }
    const scheduledAt = (parsed?.values?.scheduledAt ?? null) as string | null;
    const existingAt = row.scheduled_at ? new Date(String(row.scheduled_at)).toISOString() : null;
    if (row.scheduled_text === value && existingAt === scheduledAt) { unchanged += 1; continue; }
    pending.push({ id: String(row.id), text: value, scheduledAt });
  }
  if (!dryRun) {
    for (let i = 0; i < pending.length; i += 200) {
      const chunk = pending.slice(i, i + 200);
      const values = sql.join(chunk.map((r) => sql`(${r.id}::uuid, ${r.text}, ${r.scheduledAt}::timestamptz)`), sql`, `);
      await db.execute(sql`update appointments a set scheduled_text = v.text, scheduled_at = v.scheduled_at
        from (values ${values}) as v(id, text, scheduled_at) where a.id = v.id`);
    }
  }
  console.log(dryRun ? "DRY RUN — nothing written" : "BACKFILL APPLIED");
  console.table([{ appointments: candidates.length, would_write: pending.length, already_correct: unchanged, no_schedule_text_in_message: noText }]);
} finally { await closeDb(); }
