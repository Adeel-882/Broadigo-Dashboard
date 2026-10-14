import { createRequire } from "node:module";
import { parserRegistry } from "../lib/parsers/registry";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const { default: postgres } = await import("postgres");
const db = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 20 });

try {
  const sources = await db`
    select d.id dock_id,d.amount current_amount,sm.id message_id,sm.workspace_id,sm.raw_text,sm.posted_at
    from docks d join slack_messages sm on sm.id=d.slack_message_id
    order by sm.posted_at`;
  const identities = await db`select workspace_id,slack_user_id,employee_id from employee_slack_identities`;
  const identity = new Map(identities.map((row) => [`${row.workspace_id}:${row.slack_user_id}`, String(row.employee_id)]));
  const pending: Array<{dockId:string;messageId:string;before:string;after:string;employeeIds:string[]}> = [];
  for (const row of sources) {
    const parsed = parserRegistry.parse("dock", { rawSourceId:String(row.message_id), text:String(row.raw_text), postedAt:new Date(String(row.posted_at)) });
    if (!parsed || parsed.recordType !== "DOCK" || parsed.values.amount == null) continue;
    const existing = await db`select employee_id from dock_recipients where dock_id=${String(row.dock_id)}::uuid order by employee_id`;
    const beforeIds = existing.map((item) => String(item.employee_id)).sort();
    // Once historical recipients have been captured, current Slack-account
    // ownership must never reinterpret them after an account takeover.
    const employeeIds = beforeIds.length ? beforeIds : [...new Set(((parsed.values.targetSlackUserIds ?? []) as string[]).map((id) => identity.get(`${row.workspace_id}:${id}`)).filter((id):id is string => Boolean(id)))];
    if (String(row.current_amount) !== Number(parsed.values.amount).toFixed(2) || JSON.stringify(beforeIds) !== JSON.stringify([...employeeIds].sort())) {
      pending.push({ dockId:String(row.dock_id), messageId:String(row.message_id), before:String(row.current_amount), after:Number(parsed.values.amount).toFixed(2), employeeIds });
    }
  }
  console.log(`${apply ? "APPLY" : "DRY RUN"}: ${pending.length} dock records need changes.`);
  console.table(pending.slice(0,20).map((item) => ({ dock_id:item.dockId, amount:`${item.before} -> ${item.after}`, recipients:item.employeeIds.length })));
  if (apply) await db.begin(async (tx) => {
    for (const item of pending) {
      await tx`update docks set amount=${item.after} where id=${item.dockId}::uuid`;
      await tx`delete from dock_recipients where dock_id=${item.dockId}::uuid`;
      for (const employeeId of item.employeeIds) await tx`insert into dock_recipients(dock_id,employee_id) values(${item.dockId}::uuid,${employeeId}::uuid) on conflict do nothing`;
    }
  });
  const impact = await db`select coalesce(sum(d.amount * greatest(1,(select count(*) from dock_recipients dr where dr.dock_id=d.id))),0)::numeric total from docks d`;
  console.log(`Aggregate dock impact: PKR ${impact[0].total}`);
} finally {
  await db.end({ timeout: 5 });
}
