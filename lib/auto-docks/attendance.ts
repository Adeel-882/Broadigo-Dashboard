import {autoDockBusinessDateFor} from "./time";
import { sql } from "drizzle-orm";
import { autoDockDb, readAutoDockSettings, resultRows } from "./service";
import { businessWindow, isCheckIn } from "./policy";

type Message = { ts: string; user?: string; text?: string; subtype?: string; thread_ts?: string; bot_id?: string };
export function attendanceCandidate(message: Message) {
  return Boolean(message.user && !message.bot_id && !message.subtype && (!message.thread_ts || message.thread_ts === message.ts));
}
/** Full bounded Slack snapshot. No coverage marker is written on partial reads,
 * rate limits, missing permissions, or a failed transaction. */
export async function syncAttendanceDay(date: string) {
  const settings = await readAutoDockSettings();
  const { start, end } = businessWindow(date);
  if (!process.env.SLACK_BOT_TOKEN) throw new Error("Slack token unavailable");
  const fetchedAt = new Date();
  let cursor = "";
  const messages: Message[] = [];
  const seen = new Set<string>();
  do {
    const params = new URLSearchParams({ channel: settings.generalChannelId, oldest: String(start.getTime()/1000), latest: String(end.getTime()/1000), inclusive: "true", limit: "200", cursor });
    const response = await fetch(`https://slack.com/api/conversations.history?${params}`, { headers: { authorization: `Bearer ${process.env.SLACK_BOT_TOKEN}` }, signal: AbortSignal.timeout(15000), cache: "no-store" });
    if (!response.ok) throw new Error(`Attendance history HTTP ${response.status}`);
    const body = await response.json() as { ok: boolean; error?: string; messages?: Message[]; has_more?: boolean; response_metadata?: {next_cursor?: string} };
    if (!body.ok || !body.messages) throw new Error(`Attendance history unavailable: ${body.error ?? "invalid-response"}`);
    messages.push(...body.messages.filter(m => Number(m.ts)*1000 >= start.getTime() && Number(m.ts)*1000 < end.getTime() && attendanceCandidate(m)));
    cursor = body.response_metadata?.next_cursor ?? "";
    if (body.has_more && !cursor) throw new Error("Incomplete attendance pagination");
    if (cursor && seen.has(cursor)) throw new Error("Repeated attendance cursor");
    seen.add(cursor);
  } while (cursor);
  const records = messages.map(m => ({ ts: m.ts, user: m.user, text: m.text ?? "", check_in: isCheckIn(m.text ?? "", settings.phrases) }));
  await autoDockDb().transaction(async tx => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auto-docks:'||${date}))`);
    // Only retire evidence older than this snapshot. A concurrent newer webhook wins.
    await tx.execute(sql`update attendance_messages set deleted=true,is_check_in=false where workspace_id=${settings.workspaceId} and channel_id=${settings.generalChannelId} and source_at>=${start.toISOString()}::timestamptz and source_at<${end.toISOString()}::timestamptz and received_at<=${fetchedAt.toISOString()}::timestamptz and not (slack_ts in (select x.ts from jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as x(ts text)))`);
    await tx.execute(sql`insert into attendance_messages(workspace_id,channel_id,slack_ts,slack_user_id,employee_id,source_at,raw_text,is_check_in,received_at)
      select ${settings.workspaceId},${settings.generalChannelId},x.ts,x."user",i.employee_id,to_timestamp(x.ts::numeric),x.text,x.check_in,${fetchedAt.toISOString()}::timestamptz
      from jsonb_to_recordset(${JSON.stringify(records)}::jsonb) as x(ts text,"user" text,text text,check_in boolean)
      left join employee_slack_identities i on i.workspace_id=${settings.workspaceId} and i.slack_user_id=x."user"
      on conflict(workspace_id,channel_id,slack_ts) do update set employee_id=excluded.employee_id,raw_text=excluded.raw_text,is_check_in=excluded.is_check_in,deleted=false,received_at=excluded.received_at where attendance_messages.received_at<=excluded.received_at`);
    // An in-progress day is inspectable but is NOT certified as complete.
    if (end <= fetchedAt) await tx.execute(sql`insert into attendance_coverage(business_date,workspace_id,channel_id,fetched_at,message_count) values(${date}::date,${settings.workspaceId},${settings.generalChannelId},${fetchedAt.toISOString()}::timestamptz,${records.length}) on conflict(business_date) do update set fetched_at=excluded.fetched_at,message_count=excluded.message_count`);
  });
  return { messages: records.length, checkIns: records.filter(r=>r.check_in).length, complete: end <= fetchedAt };
}

/** Webhooks only request a fresh authoritative snapshot; out-of-order edits
 * cannot overwrite attendance with stale message content. */
export async function queueGeneralEvent(workspace: string, channel: string, ts: string) {
  const settings = await readAutoDockSettings();
  if (workspace!==settings.workspaceId || channel!==settings.generalChannelId || !/^\d+\.\d+$/.test(ts)) return false;
  const date=autoDockBusinessDateFor(new Date(Number(ts)*1000));
  if(!date)return false;
  await autoDockDb().execute(sql`insert into auto_dock_pending(business_date) values(${date}::date) on conflict(business_date) do update set requested_at=now()`);
  return true;
}

export async function pendingDates(limit=5) {
  return resultRows(await autoDockDb().execute(sql`select business_date::text from auto_dock_pending order by business_date limit ${limit}`)).map(r=>String(r.business_date));
}
