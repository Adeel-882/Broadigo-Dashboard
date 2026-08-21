import { eq, inArray, sql } from "drizzle-orm";
import { getDb } from "@/lib/db/client";
import {
  appointments,
  docks,
  leads,
  mediaActivities,
  sales,
  slackChannels,
  slackIdentities,
  slackMessages,
} from "@/lib/db/schema";
import { parserRegistry } from "@/lib/parsers/registry";
import { resolveStructuredAttribution } from "@/lib/slack/attribution";
import { deriveLeadEligibility } from "@/lib/slack/reactions";

type Channel = typeof slackChannels.$inferSelect;
type ChannelProgress = {
  channel: string;
  total: number;
  parsed: number;
  unparsed: number;
  skipped: number;
  failed: number;
  attributionUpdated: number;
};

export type SlackPipelineAudit = {
  channels: Array<Record<string, unknown>>;
  totals: Record<string, unknown>;
  structured: Record<string, unknown>;
  attribution: Record<string, unknown>;
};

function resultRows(value: unknown) {
  return value as Array<Record<string, unknown>>;
}

export async function auditSlackPipeline(): Promise<SlackPipelineAudit> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required.");
  const [channelResult, totalResult, structuredResult, attributionResult] = await Promise.all([
    db.execute(sql`select c.name,c.parser_type,count(sm.*)::int total,count(sm.employee_id)::int matched_employee,
      count(*) filter(where sm.id is not null and sm.employee_id is null)::int unmatched_employee,
      count(*) filter(where sm.parser_status='PARSED')::int parsed,
      count(*) filter(where sm.parser_status='UNPARSED')::int unparsed,
      count(*) filter(where sm.parser_status='ERROR')::int error,
      min(sm.posted_at) oldest,max(sm.posted_at) newest
      from slack_channels c left join slack_messages sm on sm.channel_id=c.id
      where c.active=true group by c.id,c.name,c.parser_type order by c.name`),
    db.execute(sql`select count(*)::int total,count(employee_id)::int matched_employee,
      count(*) filter(where employee_id is null)::int unmatched_employee,
      count(*) filter(where parser_status='PARSED')::int parsed,
      count(*) filter(where parser_status='UNPARSED')::int unparsed,
      count(*) filter(where parser_status='ERROR')::int error,
      count(*) filter(where parser_status='PENDING')::int pending from slack_messages`),
    db.execute(sql`select
      (select count(*)::int from appointments) appointments,
      (select count(*)::int from sales) sales,
      (select count(*)::int from leads) leads,
      (select count(*)::int from docks) docks,
      (select count(*)::int from media_activity) media_activity,
      (select count(*)::int from appointments where employee_id is null) appointments_unattributed,
      (select count(*)::int from sales where employee_id is null) sales_unattributed,
      (select count(*)::int from leads where employee_id is null) leads_unattributed,
      (select count(*)::int from docks where employee_id is null) docks_unattributed,
      (select count(*)::int from media_activity where employee_id is null) media_unattributed`),
    db.execute(sql`select
      (select count(*)::int from employee_slack_identities) identity_rows,
      (select count(distinct employee_id)::int from employee_slack_identities) mapped_employees,
      count(*) filter(where si.employee_id is not null)::int currently_matchable,
      count(*) filter(where si.employee_id is null)::int currently_unmatchable,
      count(*) filter(where si.employee_id is not null and sm.employee_id is distinct from si.employee_id)::int stale_attribution
      from slack_messages sm left join employee_slack_identities si
        on si.workspace_id=sm.workspace_id and si.slack_user_id=sm.slack_user_id`),
  ]);
  return {
    channels: resultRows(channelResult),
    totals: resultRows(totalResult)[0] ?? {},
    structured: resultRows(structuredResult)[0] ?? {},
    attribution: resultRows(attributionResult)[0] ?? {},
  };
}

export async function reprocessStoredSlackMessages(
  onProgress?: (progress: ChannelProgress) => void,
): Promise<ChannelProgress[]> {
  const db = getDb();
  if (!db) throw new Error("DATABASE_URL is required.");
  const channels = await db.select().from(slackChannels).where(eq(slackChannels.active, true)).orderBy(slackChannels.name);
  const output: ChannelProgress[] = [];

  for (const channel of channels) {
    const [{ count }] = await db.select({ count: sql<number>`count(*)::int` }).from(slackMessages).where(eq(slackMessages.channelId, channel.id));
    if (!parserRegistry.has(channel.parserType)) {
      const progress = { channel: channel.name, total: Number(count), parsed: 0, unparsed: 0, skipped: Number(count), failed: 0, attributionUpdated: 0 };
      output.push(progress); onProgress?.(progress); continue;
    }

    try {
      const progress = await db.transaction(async (transaction) => reprocessChannel(transaction, channel));
      output.push(progress);
      onProgress?.(progress);
    } catch (error) {
      const progress = { channel: channel.name, total: Number(count), parsed: 0, unparsed: 0, skipped: 0, failed: Number(count), attributionUpdated: 0 };
      output.push(progress);
      onProgress?.(progress);
      console.error(`#${channel.name} rolled back:`, error instanceof Error ? error.message : error);
    }
  }
  return output;
}

type Database = Parameters<Parameters<NonNullable<ReturnType<typeof getDb>>["transaction"]>[0]>[0];

async function reprocessChannel(transaction: Database, channel: Channel): Promise<ChannelProgress> {
  await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${'slack-reprocess:' + channel.id}))`);
  const before = await transaction.select({ id: slackMessages.id, employeeId: slackMessages.employeeId }).from(slackMessages).where(eq(slackMessages.channelId, channel.id));

  await transaction.update(slackMessages).set({ employeeId: null, parserType: channel.parserType }).where(eq(slackMessages.channelId, channel.id));
  await transaction.execute(sql`update slack_messages sm set employee_id=si.employee_id
    from employee_slack_identities si
    where sm.channel_id=${channel.id} and si.workspace_id=sm.workspace_id and si.slack_user_id=sm.slack_user_id`);

  const messages = await transaction.select().from(slackMessages).where(eq(slackMessages.channelId, channel.id));
  const identities = await transaction.select().from(slackIdentities).where(eq(slackIdentities.workspaceId, channel.workspaceId));
  const identityBySlackUser = new Map(identities.map((identity) => [identity.slackUserId, identity.employeeId]));
  const attributionUpdated = messages.filter((message) => before.find((old) => old.id === message.id)?.employeeId !== message.employeeId).length;
  const messageIds = messages.map((message) => message.id);
  const existingStructuredIds = new Set<string>();
  if (messageIds.length) {
    const existing = await Promise.all([
      transaction.select({ slackMessageId: appointments.slackMessageId }).from(appointments).where(inArray(appointments.slackMessageId, messageIds)),
      transaction.select({ slackMessageId: sales.slackMessageId }).from(sales).where(inArray(sales.slackMessageId, messageIds)),
      transaction.select({ slackMessageId: leads.slackMessageId }).from(leads).where(inArray(leads.slackMessageId, messageIds)),
      transaction.select({ slackMessageId: docks.slackMessageId }).from(docks).where(inArray(docks.slackMessageId, messageIds)),
      transaction.select({ slackMessageId: mediaActivities.slackMessageId }).from(mediaActivities).where(inArray(mediaActivities.slackMessageId, messageIds)),
    ]);
    for (const row of existing.flat()) existingStructuredIds.add(row.slackMessageId);
  }

  const appointmentRows: Array<typeof appointments.$inferInsert> = [];
  const saleRows: Array<typeof sales.$inferInsert> = [];
  const leadRows: Array<typeof leads.$inferInsert> = [];
  const dockRows: Array<typeof docks.$inferInsert> = [];
  const mediaRows: Array<typeof mediaActivities.$inferInsert> = [];
  const parsedGroups = new Map<string, string[]>();
  const unparsedIds: string[] = [];
  const skippedIds: string[] = [];
  const failedIds: string[] = [];

  for (const message of messages) {
    try {
      const result = parserRegistry.parse(channel.parserType, {
        rawSourceId: message.id,
        text: message.rawText,
        postedAt: message.postedAt,
        employeeId: message.employeeId,
      });
      if (!result) {
        if (channel.parserType === "leads") unparsedIds.push(message.id);
        else if (existingStructuredIds.has(message.id)) skippedIds.push(message.id);
        else unparsedIds.push(message.id);
        continue;
      }

      const warnings = [...result.warnings];
      const attribution = resolveStructuredAttribution(result.recordType, message.employeeId, result.values, identityBySlackUser);
      const structuredEmployeeId = attribution.employeeId;
      warnings.push(...attribution.warnings);

      const base = { slackMessageId: message.id, employeeId: structuredEmployeeId, teamId: channel.teamId, occurredAt: message.postedAt, confidence: String(result.confidence) };
      const value = (key: string) => result.values[key] as string | null | undefined;
      if (result.recordType === "APPOINTMENT") appointmentRows.push({ ...base, prospectName: value("prospectName"), phone: value("phone"), state: value("state"), originalTimezone: value("originalTimezone"), assignedPerson: value("assignedPerson") });
      else if (result.recordType === "SALE") saleRows.push({ ...base, customerName: value("customerName"), phone: value("phone"), email: value("email"), packageName: value("packageName"), amount: result.values.amount == null ? null : String(result.values.amount), currency: value("currency") ?? "USD", state: value("state"), zipCodes: (result.values.zipCodes ?? []) as string[] });
      else if (result.recordType === "LEAD") {
        const eligibility = deriveLeadEligibility(message.reactions);
        leadRows.push({ ...base, leadType: value("leadType"), contactName: value("contactName"), phone: value("phone"), email: value("email"), propertyType: value("propertyType"), state: value("state"), timeline: value("timeline"), details: (result.values.details ?? {}) as Record<string, string>, countsTowardKpi: eligibility.countsTowardKpi, exclusionReasons: eligibility.exclusionReasons });
      }
      else if (result.recordType === "DOCK" && result.values.amount != null && value("reason")) dockRows.push({ ...base, amount: String(result.values.amount), currency: value("currency") ?? "PKR", reason: value("reason")!, appliedBy: value("appliedBy"), notes: value("notes") });
      else if (result.recordType === "MEDIA_ACTIVITY") mediaRows.push({ ...base, classification: value("classification")!, summary: value("summary")!, blocker: value("blocker") });
      else { failedIds.push(message.id); continue; }

      const warningKey = JSON.stringify(warnings);
      parsedGroups.set(warningKey, [...(parsedGroups.get(warningKey) ?? []), message.id]);
    } catch {
      failedIds.push(message.id);
    }
  }

  if (appointmentRows.length) await transaction.insert(appointments).values(appointmentRows).onConflictDoUpdate({ target: appointments.slackMessageId, set: {
    employeeId: sql`excluded.employee_id`, teamId: sql`excluded.team_id`, occurredAt: sql`excluded.occurred_at`, confidence: sql`excluded.confidence`,
    prospectName: sql`excluded.prospect_name`, phone: sql`excluded.phone`, state: sql`excluded.state`, originalTimezone: sql`excluded.original_timezone`, assignedPerson: sql`excluded.assigned_person`,
  } });
  if (saleRows.length) await transaction.insert(sales).values(saleRows).onConflictDoUpdate({ target: sales.slackMessageId, set: {
    employeeId: sql`excluded.employee_id`, teamId: sql`excluded.team_id`, occurredAt: sql`excluded.occurred_at`, confidence: sql`excluded.confidence`,
    customerName: sql`excluded.customer_name`, phone: sql`excluded.phone`, email: sql`excluded.email`, packageName: sql`excluded.package_name`, amount: sql`excluded.amount`, currency: sql`excluded.currency`, state: sql`excluded.state`, zipCodes: sql`excluded.zip_codes`,
  } });
  if (leadRows.length) await transaction.insert(leads).values(leadRows).onConflictDoUpdate({ target: leads.slackMessageId, set: {
    employeeId: sql`excluded.employee_id`, teamId: sql`excluded.team_id`, occurredAt: sql`excluded.occurred_at`, confidence: sql`excluded.confidence`,
    leadType: sql`excluded.lead_type`, contactName: sql`excluded.contact_name`, phone: sql`excluded.phone`, email: sql`excluded.email`, propertyType: sql`excluded.property_type`, state: sql`excluded.state`, timeline: sql`excluded.timeline`, details: sql`excluded.details`,
    countsTowardKpi: sql`excluded.counts_toward_kpi`, exclusionReasons: sql`excluded.exclusion_reasons`,
  } });
  if (dockRows.length) await transaction.insert(docks).values(dockRows).onConflictDoUpdate({ target: docks.slackMessageId, set: {
    employeeId: sql`excluded.employee_id`, teamId: sql`excluded.team_id`, occurredAt: sql`excluded.occurred_at`, confidence: sql`excluded.confidence`,
    amount: sql`excluded.amount`, currency: sql`excluded.currency`, reason: sql`excluded.reason`, appliedBy: sql`excluded.applied_by`, notes: sql`excluded.notes`,
  } });
  if (mediaRows.length) await transaction.insert(mediaActivities).values(mediaRows).onConflictDoUpdate({ target: mediaActivities.slackMessageId, set: {
    employeeId: sql`excluded.employee_id`, teamId: sql`excluded.team_id`, occurredAt: sql`excluded.occurred_at`, confidence: sql`excluded.confidence`,
    classification: sql`excluded.classification`, summary: sql`excluded.summary`, blocker: sql`excluded.blocker`,
  } });

  if (channel.parserType === "leads" && unparsedIds.length) {
    await transaction.delete(leads).where(inArray(leads.slackMessageId, unparsedIds));
  }

  for (const [warningKey, ids] of parsedGroups) {
    await transaction.update(slackMessages).set({ parserStatus: "PARSED", validationWarnings: JSON.parse(warningKey) as string[] }).where(inArray(slackMessages.id, ids));
  }
  if (unparsedIds.length) await transaction.update(slackMessages).set({ parserStatus: "UNPARSED", validationWarnings: ["No conservative parser rule matched"] }).where(inArray(slackMessages.id, unparsedIds));
  if (failedIds.length) await transaction.update(slackMessages).set({ parserStatus: "ERROR", validationWarnings: ["Historical reprocessing failed for this message"] }).where(inArray(slackMessages.id, failedIds));

  return {
    channel: channel.name,
    total: messages.length,
    parsed: [...parsedGroups.values()].reduce((sum, ids) => sum + ids.length, 0),
    unparsed: unparsedIds.length,
    skipped: skippedIds.length,
    failed: failedIds.length,
    attributionUpdated,
  };
}
