/**
 * Reconciles appointment qualification from the assigned Closer's Slack thread replies.
 *
 * Usage:
 *   pnpm appointments:backfill-qualifications --dry-run
 *   pnpm appointments:backfill-qualifications
 */
import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }, { classifyAppointmentQualification, latestAssignedCloserDisposition }] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/appointment-qualification"),
]);

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");
const token = process.env.SLACK_BOT_TOKEN;
if (!token) throw new Error("SLACK_BOT_TOKEN is required.");
const dryRun = process.argv.includes("--dry-run");

type Parent = { id: string; channel_id: string; parent_ts: string; assigned_person: string; qualification_status: string; qualification_source_ts: string | null };
type Reply = { ts: string; text?: string; user?: string; thread_ts?: string };
type RepliesPayload = { ok: boolean; error?: string; messages?: Reply[]; response_metadata?: { next_cursor?: string } };

async function slackReplies(channel: string, ts: string) {
  const replies: Reply[] = [];
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ channel, ts, limit: "100" });
    if (cursor) params.set("cursor", cursor);
    let payload: RepliesPayload | null = null;
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const response = await fetch(`https://slack.com/api/conversations.replies?${params}`, {
        headers: { authorization: `Bearer ${token}` }, cache: "no-store",
      });
      payload = await response.json() as RepliesPayload;
      if (response.status !== 429 && payload?.error !== "ratelimited") break;
      const waitSeconds = Math.max(1, Number(response.headers.get("retry-after") ?? 30));
      await new Promise((resolve) => setTimeout(resolve, (waitSeconds * 1000) + Math.floor(Math.random() * 750)));
    }
    if (!payload?.ok) throw new Error(`Slack conversations.replies failed: ${payload?.error ?? "unknown"}`);
    replies.push(...(payload.messages ?? []).filter((message) => message.ts !== ts));
    cursor = payload.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return replies;
}

async function parentsWithReplies(channel: string) {
  const parentReplyUsers = new Map<string, Set<string>>();
  let cursor: string | undefined;
  do {
    const params = new URLSearchParams({ channel, limit: "200" });
    if (cursor) params.set("cursor", cursor);
    let response = await fetch(`https://slack.com/api/conversations.history?${params}`, {
      headers: { authorization: `Bearer ${token}` }, cache: "no-store",
    });
    if (response.status === 429) {
      const waitSeconds = Math.max(1, Number(response.headers.get("retry-after") ?? 1));
      await new Promise((resolve) => setTimeout(resolve, waitSeconds * 1000));
      response = await fetch(`https://slack.com/api/conversations.history?${params}`, {
        headers: { authorization: `Bearer ${token}` }, cache: "no-store",
      });
    }
    const payload = await response.json() as { ok: boolean; error?: string; messages?: Array<{ ts: string; reply_count?: number; reply_users?: string[] }>; response_metadata?: { next_cursor?: string } };
    if (!payload.ok) throw new Error(`Slack conversations.history failed: ${payload.error ?? "unknown"}`);
    for (const message of payload.messages ?? []) {
      if ((message.reply_count ?? 0) > 0) parentReplyUsers.set(message.ts, new Set(message.reply_users ?? []));
    }
    cursor = payload.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return parentReplyUsers;
}

try {
  const parents = await db.execute(sql`select a.id, sc.slack_channel_id channel_id, sm.slack_ts parent_ts,
      a.assigned_person, a.qualification_status, a.qualification_source_ts
    from appointments a
    join slack_messages sm on sm.id=a.slack_message_id
    join slack_channels sc on sc.id=sm.channel_id
    where sc.slack_channel_id in ('C098WNHNBR7','C0B0P6P7FPG')
      and a.assigned_person is not null
    order by sm.posted_at`) as unknown as Parent[];

  let qualified = 0; let notQualified = 0; let unknown = 0; let pending = 0; let repliesRead = 0;
  const replyParentsByChannel = new Map<string, Map<string, Set<string>>>();
  for (const channel of new Set(parents.map((parent) => parent.channel_id))) {
    const replyParents = await parentsWithReplies(channel);
    replyParentsByChannel.set(channel, replyParents);
    console.log(`Channel ${channel}: ${replyParents.size} appointment threads have replies.`);
  }
  const candidateThreads = parents.filter((parent) => replyParentsByChannel.get(parent.channel_id)?.get(parent.parent_ts)?.has(parent.assigned_person)).length;
  console.log(`${candidateThreads} threads include the assigned Closer among the reply authors.`);
  const candidates = parents.filter((parent) => replyParentsByChannel.get(parent.channel_id)?.get(parent.parent_ts)?.has(parent.assigned_person));
  const repliesByParent = new Map<string, Reply[]>();
  let nextCandidate = 0; let completedCandidates = 0;
  async function worker() {
    while (nextCandidate < candidates.length) {
      const parent = candidates[nextCandidate++];
      repliesByParent.set(parent.id, await slackReplies(parent.channel_id, parent.parent_ts));
      completedCandidates += 1;
      if (completedCandidates % 50 === 0 || completedCandidates === candidates.length) console.log(`Fetched ${completedCandidates}/${candidates.length} candidate threads.`);
    }
  }
  await Promise.all(Array.from({ length: Math.min(3, candidates.length) }, () => worker()));
  const dispositionWrites: Array<{ appointmentId: string; ts: string; user: string; status: string }> = [];
  const appointmentWrites: Array<{ id: string; status: string; qualifiedAt: string | null; sourceTs: string | null; evaluator: string | null }> = [];
  for (const parent of parents) {
    const replies = repliesByParent.get(parent.id) ?? [];
    repliesRead += replies.length;
    const assignedReplies = replies.filter((reply) => reply.user === parent.assigned_person).map((reply) => ({
      ts: reply.ts, user: reply.user, text: reply.text ?? "",
    }));
    const latest = latestAssignedCloserDisposition(assignedReplies, parent.assigned_person);
    const desired = latest?.status ?? "UNKNOWN";
    if (desired === "QUALIFIED") qualified += 1;
    else if (desired === "NOT_QUALIFIED") notQualified += 1;
    else unknown += 1;
    if (parent.qualification_status !== desired || parent.qualification_source_ts !== (latest?.ts ?? null)) pending += 1;

    if (!dryRun) {
      for (const reply of assignedReplies) {
        const status = classifyAppointmentQualification(reply.text);
        dispositionWrites.push({ appointmentId: parent.id, ts: reply.ts, user: parent.assigned_person, status });
      }
      const qualifiedAt = latest?.status === "QUALIFIED" ? new Date(Number.parseFloat(latest.ts) * 1000).toISOString() : null;
      appointmentWrites.push({ id: parent.id, status: desired, qualifiedAt, sourceTs: latest?.ts ?? null, evaluator: latest?.user ?? null });
    }
  }

  if (!dryRun) {
    for (let index = 0; index < dispositionWrites.length; index += 200) {
      const values = sql.join(dispositionWrites.slice(index, index + 200).map((row) => sql`(${row.appointmentId}::uuid,${row.ts},${row.user},${row.status})`), sql`, `);
      await db.execute(sql`insert into appointment_dispositions (appointment_id,slack_reply_ts,evaluator_slack_user_id,status)
        values ${values} on conflict (appointment_id,slack_reply_ts) do update set evaluator_slack_user_id=excluded.evaluator_slack_user_id,status=excluded.status,updated_at=now()`);
    }
    for (let index = 0; index < appointmentWrites.length; index += 200) {
      const values = sql.join(appointmentWrites.slice(index, index + 200).map((row) => sql`(${row.id}::uuid,${row.status},${row.qualifiedAt}::timestamptz,${row.sourceTs},${row.evaluator})`), sql`, `);
      await db.execute(sql`update appointments a set qualification_status=v.status,qualified_at=v.qualified_at,
        qualification_source_ts=v.source_ts,qualification_evaluator_slack_user_id=v.evaluator
        from (values ${values}) as v(id,status,qualified_at,source_ts,evaluator) where a.id=v.id`);
    }
  }

  console.log(dryRun ? "DRY RUN — nothing written" : "BACKFILL APPLIED");
  console.table([{ appointments_scanned: parents.length, replies_read: repliesRead, qualified, not_qualified: notQualified, unknown, pending_updates: pending }]);
} finally {
  await closeDb();
}
