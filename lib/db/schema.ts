import { relations, sql } from "drizzle-orm";
import { boolean, date, index, integer, jsonb, numeric, pgEnum, pgTable, text, timestamp, uniqueIndex, uuid } from "drizzle-orm/pg-core";

export const parserStatus = pgEnum("parser_status", ["PENDING", "PARSED", "UNPARSED", "ERROR"]);
export const recordType = pgEnum("record_type", ["APPOINTMENT", "SALE", "LEAD", "DOCK", "MEDIA_ACTIVITY"]);
export const targetPeriod = pgEnum("target_period", ["DAILY", "WEEKLY", "MONTHLY"]);
export const syncStatus = pgEnum("sync_status", ["RUNNING", "COMPLETED", "FAILED"]);

export const divisions = pgTable("divisions", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull().unique(),
  slug: text("slug").notNull().unique(),
});

export const teams = pgTable("teams", {
  id: uuid("id").primaryKey().defaultRandom(),
  divisionId: uuid("division_id").notNull().references(() => divisions.id),
  name: text("name").notNull(),
  slug: text("slug").notNull().unique(),
  type: text("type").notNull(),
}, (table) => [index("teams_division_idx").on(table.divisionId)]);

export const employees = pgTable("employees", {
  id: uuid("id").primaryKey().defaultRandom(),
  canonicalName: text("canonical_name").notNull(),
  jobTitle: text("job_title").notNull(),
  leadershipLevel: text("leadership_level"),
  avatarUrl: text("avatar_url"),
  active: boolean("active").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [index("employees_name_idx").on(table.canonicalName), index("employees_active_idx").on(table.active)]);

export const memberships = pgTable("employee_team_memberships", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  teamId: uuid("team_id").notNull().references(() => teams.id),
  role: text("role").notNull(),
  rankingEnabled: boolean("ranking_enabled").notNull().default(true),
  startDate: date("start_date"),
  endDate: date("end_date"),
}, (table) => [
  uniqueIndex("membership_employee_team_unique").on(table.employeeId, table.teamId),
  index("membership_employee_idx").on(table.employeeId),
  index("membership_team_idx").on(table.teamId),
]);

export const slackIdentities = pgTable("employee_slack_identities", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  workspaceId: text("workspace_id").notNull(),
  slackUserId: text("slack_user_id").notNull(),
  displayName: text("display_name"),
  aliases: text("aliases").array().notNull().default(sql`ARRAY[]::text[]`),
}, (table) => [
  uniqueIndex("slack_identity_workspace_user_unique").on(table.workspaceId, table.slackUserId),
  index("slack_identity_employee_idx").on(table.employeeId),
]);

export const employeeAliases = pgTable("employee_aliases", {
  id: uuid("id").primaryKey().defaultRandom(),
  employeeId: uuid("employee_id").notNull().references(() => employees.id),
  alias: text("alias").notNull(),
}, (table) => [uniqueIndex("employee_alias_unique").on(table.employeeId, table.alias), index("employee_alias_lookup_idx").on(table.alias)]);

export const slackChannels = pgTable("slack_channels", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  slackChannelId: text("slack_channel_id").notNull(),
  name: text("name").notNull(),
  teamId: uuid("team_id").references(() => teams.id),
  parserType: text("parser_type").notNull(),
  active: boolean("active").notNull().default(true),
}, (table) => [
  uniqueIndex("slack_channel_workspace_id_unique").on(table.workspaceId, table.slackChannelId),
  uniqueIndex("slack_channel_workspace_name_unique").on(table.workspaceId, table.name),
]);

export const slackEvents = pgTable("slack_events", {
  id: uuid("id").primaryKey().defaultRandom(),
  eventId: text("event_id").notNull().unique(),
  workspaceId: text("workspace_id").notNull(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * Append-only diagnostic ledger for live Slack webhook deliveries.
 *
 * Separate from `slack_events` (which stays a pure idempotency claim inserted
 * only after a channel matches) so that rejected, ignored and failed deliveries
 * are recorded too — those are exactly the cases that were previously invisible.
 */
export const slackIngestLog = pgTable("slack_ingest_log", {
  id: uuid("id").primaryKey().defaultRandom(),
  receivedAt: timestamp("received_at", { withTimezone: true }).notNull().defaultNow(),
  eventId: text("event_id"),
  workspaceId: text("workspace_id"),
  slackChannelId: text("slack_channel_id"),
  slackUserId: text("slack_user_id"),
  slackTs: text("slack_ts"),
  routingAction: text("routing_action").notNull(),
  result: text("result").notNull(),
  reason: text("reason"),
  recordType: text("record_type"),
  workspaceMatched: boolean("workspace_matched"),
  channelMatched: boolean("channel_matched"),
  durationMs: integer("duration_ms"),
  errorMessage: text("error_message"),
}, (table) => [index("slack_ingest_log_received_idx").on(table.receivedAt)]);

export const slackMessages = pgTable("slack_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  workspaceId: text("workspace_id").notNull(),
  channelId: uuid("channel_id").notNull().references(() => slackChannels.id),
  slackTs: text("slack_ts").notNull(),
  slackUserId: text("slack_user_id"),
  employeeId: uuid("employee_id").references(() => employees.id),
  rawText: text("raw_text").notNull(),
  postedAt: timestamp("posted_at", { withTimezone: true }).notNull(),
  importedAt: timestamp("imported_at", { withTimezone: true }).notNull().defaultNow(),
  parserStatus: parserStatus("parser_status").notNull().default("PENDING"),
  parserType: text("parser_type").notNull(),
  validationWarnings: jsonb("validation_warnings").$type<string[]>().notNull().default([]),
  // Current Slack reactions on the message, kept as raw evidence for KPI eligibility.
  reactions: jsonb("reactions").$type<Array<{ name: string; count?: number; users?: string[] }>>().notNull().default([]),
  reactionsSyncedAt: timestamp("reactions_synced_at", { withTimezone: true }),
}, (table) => [
  uniqueIndex("slack_message_workspace_channel_ts_unique").on(table.workspaceId, table.channelId, table.slackTs),
  index("slack_message_employee_time_idx").on(table.employeeId, table.postedAt),
  index("slack_message_channel_time_idx").on(table.channelId, table.postedAt),
  index("slack_message_parser_status_idx").on(table.parserStatus),
]);

const activityBase = {
  id: uuid("id").primaryKey().defaultRandom(),
  slackMessageId: uuid("slack_message_id").notNull().references(() => slackMessages.id),
  employeeId: uuid("employee_id").references(() => employees.id),
  teamId: uuid("team_id").references(() => teams.id),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  confidence: numeric("confidence", { precision: 4, scale: 3 }).notNull(),
};

export const appointments = pgTable("appointments", {
  ...activityBase,
  prospectName: text("prospect_name"), phone: text("phone"), state: text("state"),
  scheduledAt: timestamp("scheduled_at", { withTimezone: true }), originalTimezone: text("original_timezone"), assignedPerson: text("assigned_person"),
}, (table) => [uniqueIndex("appointments_slack_message_unique").on(table.slackMessageId), index("appointments_employee_time_idx").on(table.employeeId, table.occurredAt), index("appointments_team_time_idx").on(table.teamId, table.occurredAt)]);

export const sales = pgTable("sales", {
  ...activityBase,
  customerName: text("customer_name"), phone: text("phone"), email: text("email"), packageName: text("package_name"),
  amount: numeric("amount", { precision: 14, scale: 2 }), currency: text("currency").notNull().default("USD"), state: text("state"), zipCodes: text("zip_codes").array(),
}, (table) => [uniqueIndex("sales_slack_message_unique").on(table.slackMessageId), index("sales_employee_time_idx").on(table.employeeId, table.occurredAt), index("sales_team_time_idx").on(table.teamId, table.occurredAt)]);

export const leads = pgTable("leads", {
  ...activityBase,
  leadType: text("lead_type"), contactName: text("contact_name"), phone: text("phone"), email: text("email"), propertyType: text("property_type"), state: text("state"), timeline: text("timeline"), details: jsonb("details").$type<Record<string, string>>().notNull().default({}),
  // Derived from the Slack reactions on the originating message. Excluded leads are
  // retained in full; only their contribution to Lead Management KPIs is suppressed.
  countsTowardKpi: boolean("counts_toward_kpi").notNull().default(true),
  exclusionReasons: jsonb("exclusion_reasons").$type<string[]>().notNull().default([]),
}, (table) => [uniqueIndex("leads_slack_message_unique").on(table.slackMessageId), index("leads_employee_time_idx").on(table.employeeId, table.occurredAt), index("leads_team_time_idx").on(table.teamId, table.occurredAt), index("leads_kpi_time_idx").on(table.countsTowardKpi, table.occurredAt)]);

export const docks = pgTable("docks", {
  ...activityBase,
  amount: numeric("amount", { precision: 14, scale: 2 }).notNull(), currency: text("currency").notNull().default("PKR"), reason: text("reason").notNull(), appliedBy: text("applied_by"), notes: text("notes"),
}, (table) => [uniqueIndex("docks_slack_message_unique").on(table.slackMessageId), index("docks_employee_time_idx").on(table.employeeId, table.occurredAt), index("docks_team_time_idx").on(table.teamId, table.occurredAt)]);

export const mediaActivities = pgTable("media_activity", {
  ...activityBase,
  classification: text("classification").notNull(), summary: text("summary").notNull(), blocker: text("blocker"),
}, (table) => [uniqueIndex("media_slack_message_unique").on(table.slackMessageId), index("media_employee_time_idx").on(table.employeeId, table.occurredAt), index("media_team_time_idx").on(table.teamId, table.occurredAt)]);

export const targets = pgTable("targets", {
  id: uuid("id").primaryKey().defaultRandom(), divisionId: uuid("division_id").references(() => divisions.id), teamId: uuid("team_id").references(() => teams.id), employeeId: uuid("employee_id").references(() => employees.id), role: text("role"), metric: text("metric").notNull(), period: targetPeriod("period").notNull(), value: numeric("value", { precision: 14, scale: 2 }).notNull(), active: boolean("active").notNull().default(true), effectiveFrom: date("effective_from").notNull(), effectiveTo: date("effective_to"),
}, (table) => [index("targets_lookup_idx").on(table.teamId, table.employeeId, table.metric, table.period)]);

export const syncRuns = pgTable("sync_runs", {
  id: uuid("id").primaryKey().defaultRandom(), workspaceId: text("workspace_id").notNull(), channelId: uuid("channel_id").references(() => slackChannels.id), status: syncStatus("status").notNull(), cursor: text("cursor"), messagesImported: integer("messages_imported").notNull().default(0), error: text("error"), startedAt: timestamp("started_at", { withTimezone: true }).notNull().defaultNow(), completedAt: timestamp("completed_at", { withTimezone: true }),
}, (table) => [index("sync_runs_workspace_time_idx").on(table.workspaceId, table.startedAt)]);

export const employeeRelations = relations(employees, ({ many }) => ({ memberships: many(memberships), slackIdentities: many(slackIdentities) }));
export const teamRelations = relations(teams, ({ one, many }) => ({ division: one(divisions, { fields: [teams.divisionId], references: [divisions.id] }), memberships: many(memberships) }));
