/**
 * End-to-end probe for the live Slack ingestion path.
 *
 * Sends a correctly signed Slack `event_callback` to the events endpoint exactly
 * as Slack would, then confirms what reached PostgreSQL and removes the probe
 * rows again. Use it to prove the webhook path works in any environment without
 * waiting for a real message.
 *
 *   pnpm slack:probe                          against http://localhost:3000
 *   pnpm slack:probe -- --url https://your-app.vercel.app
 *   pnpm slack:probe -- --channel C098D7NHQ69 --text "..."   pick the channel
 *   pnpm slack:probe -- --keep                leave the probe rows in place
 *
 * Requires SLACK_SIGNING_SECRET and SLACK_WORKSPACE_ID locally to sign the
 * request; the target environment verifies the signature with its own secret,
 * so both must share the same Slack app.
 */
import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const { createHmac } = await import("node:crypto");
const [{ sql }, { closeDb, getDb }] = await Promise.all([import("drizzle-orm"), import("@/lib/db/client")]);

const arg = (name: string, fallback?: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index !== -1 && process.argv[index + 1] ? process.argv[index + 1] : fallback;
};
const flag = (name: string) => process.argv.includes(`--${name}`);

const secret = process.env.SLACK_SIGNING_SECRET;
const workspaceId = process.env.SLACK_WORKSPACE_ID;
if (!secret) throw new Error("SLACK_SIGNING_SECRET is required to sign the probe.");
if (!workspaceId) throw new Error("SLACK_WORKSPACE_ID is required.");

const baseUrl = (arg("url", "http://localhost:3000") as string).replace(/\/$/, "");
const channel = arg("channel", "C098WNHNBR7") as string;
const marker = `probe-${Date.now().toString(36)}`;
const text = arg("text", `ingestion probe ${marker}`) as string;
const slackTs = `${Math.floor(Date.now() / 1000)}.${String(Math.floor(Math.random() * 900000) + 100000)}`;
const eventId = `Ev-PROBE-${marker}`;

const body = JSON.stringify({
  type: "event_callback",
  event_id: eventId,
  team_id: workspaceId,
  event: { type: "message", channel, user: arg("user", "U-INGEST-PROBE"), text, ts: slackTs },
});
const timestamp = String(Math.floor(Date.now() / 1000));
const signature = `v0=${createHmac("sha256", secret).update(`v0:${timestamp}:${body}`, "utf8").digest("hex")}`;

const rows = (result: unknown) => result as Array<Record<string, unknown>>;

try {
  console.log(`POST ${baseUrl}/api/slack/events`);
  console.log(`  event_id=${eventId} channel=${channel} ts=${slackTs}`);
  const started = Date.now();
  const response = await fetch(`${baseUrl}/api/slack/events`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-slack-request-timestamp": timestamp, "x-slack-signature": signature },
    body,
  });
  const payload = await response.text();
  console.log(`  HTTP ${response.status} in ${Date.now() - started}ms -> ${payload}`);

  const db = getDb();
  if (!db) {
    console.log("\nDATABASE_URL is not set locally, so persistence was not verified.");
  } else {
    // Give a remote deployment a moment before reading.
    if (!baseUrl.includes("localhost")) await new Promise((resolve) => setTimeout(resolve, 2000));
    console.log("\nPERSISTENCE");
    console.table(rows(await db.execute(sql`
      select
        (select count(*)::int from slack_events where event_id = ${eventId}) event_claimed,
        (select count(*)::int from slack_messages where slack_ts = ${slackTs}) raw_message,
        (select parser_status::text from slack_messages where slack_ts = ${slackTs}) parser_status,
        (select count(*)::int from sales s join slack_messages sm on sm.id = s.slack_message_id where sm.slack_ts = ${slackTs}) sale_record,
        (select count(*)::int from appointments a join slack_messages sm on sm.id = a.slack_message_id where sm.slack_ts = ${slackTs}) appointment_record,
        (select count(*)::int from leads l join slack_messages sm on sm.id = l.slack_message_id where sm.slack_ts = ${slackTs}) lead_record`)));
    console.log("MOST RECENT INGESTION LEDGER ENTRY");
    console.table(rows(await db.execute(sql`
      select event_id, slack_channel_id, routing_action, result, reason, workspace_matched, channel_matched, duration_ms, error_message
      from slack_ingest_log order by received_at desc limit 3`)));

    if (flag("keep")) {
      console.log("\n--keep supplied: probe rows left in place. Remove them with:");
      console.log(`  delete from slack_messages where slack_ts = '${slackTs}';`);
    } else {
      for (const table of ["appointments", "sales", "leads", "docks", "media_activity"]) {
        await db.execute(sql`delete from ${sql.raw(table)} where slack_message_id in (select id from slack_messages where slack_ts = ${slackTs})`);
      }
      await db.execute(sql`delete from slack_messages where slack_ts = ${slackTs}`);
      await db.execute(sql`delete from slack_events where event_id = ${eventId}`);
      await db.execute(sql`delete from slack_ingest_log where event_id = ${eventId}`);
      console.log("\nProbe rows removed.");
    }
  }
} finally {
  await closeDb();
}
