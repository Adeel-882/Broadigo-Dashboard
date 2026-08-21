import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
const token = process.env.SLACK_BOT_TOKEN;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
if (!token) throw new Error("SLACK_BOT_TOKEN is required.");

const { default: postgres } = await import("postgres");

const REPORTING_CHANNELS = [
  "broadigo-media",
  "broadigo-sale-development-general",
  "broadigo-sales-reporting",
  "broadigomedia-sales-development-general",
  "docks-reporting",
  "leads-reporting",
  "sales-development-general",
  "sales-reporting",
] as const;

type SlackChannel = { id: string; name: string; is_archived?: boolean };
type SlackPage = {
  ok: boolean;
  error?: string;
  channels?: SlackChannel[];
  team_id?: string;
  response_metadata?: { next_cursor?: string };
};
type DatabaseChannel = {
  id: string;
  name: string;
  workspace_id: string;
  slack_channel_id: string;
  active: boolean;
  message_refs: number;
  sync_refs: number;
};
type MappingResult = { database_channel_name: string; slack_channel_id: string; status: string };

async function slackApi(method: string, params: Record<string, string> = {}) {
  const response = await fetch(`https://slack.com/api/${method}?${new URLSearchParams(params)}`, {
    headers: { authorization: `Bearer ${token}` },
  });
  const body = (await response.json()) as SlackPage;
  if (!body.ok) throw new Error(`Slack ${method} failed: ${body.error ?? response.status}`);
  return body;
}

async function listSlackChannels() {
  const channels: SlackChannel[] = [];
  let cursor = "";
  do {
    const page = await slackApi("conversations.list", {
      types: "public_channel,private_channel",
      exclude_archived: "true",
      limit: "200",
      ...(cursor ? { cursor } : {}),
    });
    channels.push(...(page.channels ?? []));
    cursor = page.response_metadata?.next_cursor ?? "";
  } while (cursor);
  return channels;
}

const auth = await slackApi("auth.test");
const workspace = auth.team_id ?? process.env.SLACK_WORKSPACE_ID;
if (!workspace) throw new Error("Slack did not return a workspace ID.");
if (process.env.SLACK_WORKSPACE_ID && process.env.SLACK_WORKSPACE_ID !== workspace) {
  throw new Error("SLACK_WORKSPACE_ID does not match the bot token workspace.");
}

const remoteChannels = await listSlackChannels();
const exactRemoteByName = new Map<string, SlackChannel>();
for (const name of REPORTING_CHANNELS) {
  const exactMatches = remoteChannels.filter((channel) => channel.name === name && !channel.is_archived);
  if (exactMatches.length !== 1) {
    throw new Error(`Expected one exact Slack channel named #${name}; found ${exactMatches.length}.`);
  }
  exactRemoteByName.set(name, exactMatches[0]);
}
const desiredIds = new Set([...exactRemoteByName.values()].map((channel) => channel.id));
if (desiredIds.size !== REPORTING_CHANNELS.length) {
  throw new Error("Exact Slack channel-name matching did not produce eight distinct channel IDs.");
}

const sql = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 15 });
try {
  const results = await sql.begin(async (transaction) => {
    await transaction`select pg_advisory_xact_lock(hashtext(${`slack-configure:${workspace}`}))`;
    const rows = (await transaction`
      select c.id, c.name, c.workspace_id, c.slack_channel_id, c.active,
        (select count(*)::int from slack_messages m where m.channel_id = c.id) as message_refs,
        (select count(*)::int from sync_runs s where s.channel_id = c.id) as sync_refs
      from slack_channels c
      where c.workspace_id = ${workspace} or c.name in ${transaction(REPORTING_CHANNELS)}
      for update
    `) as unknown as DatabaseChannel[];

    const plans = REPORTING_CHANNELS.map((name) => {
      const desired = exactRemoteByName.get(name)!;
      const candidates = rows.filter((row) => row.name === name);
      if (!candidates.length) throw new Error(`Database channel definition #${name} is missing.`);
      const canonical =
        candidates.find((row) => row.workspace_id === workspace && row.slack_channel_id === desired.id) ??
        candidates.find((row) => row.active && !row.slack_channel_id.startsWith("UNCONFIGURED:")) ??
        candidates[0];
      const duplicates = candidates.filter((row) => row.id !== canonical.id);
      for (const duplicate of duplicates) {
        const disposablePlaceholder =
          !duplicate.active &&
          duplicate.message_refs === 0 &&
          duplicate.sync_refs === 0 &&
          (duplicate.slack_channel_id.startsWith("UNCONFIGURED:") || duplicate.slack_channel_id.startsWith("REMAP:"));
        if (!disposablePlaceholder) {
          throw new Error(
            `Refusing to delete duplicate #${name} row ${duplicate.id}: ` +
              `${duplicate.message_refs} message reference(s), ${duplicate.sync_refs} sync reference(s), active=${duplicate.active}.`,
          );
        }
      }
      return { name, desired, canonical, duplicates };
    });

    const conflicts = new Map<string, string>();
    for (const plan of plans) {
      const currentOwner = rows.find(
        (row) => row.workspace_id === workspace && row.slack_channel_id === plan.desired.id && row.name !== plan.name,
      );
      if (!currentOwner) continue;
      const ownerPlan = plans.find((candidate) => candidate.canonical.id === currentOwner.id);
      if (!ownerPlan) {
        throw new Error(
          `Slack channel ${plan.desired.id} (#${plan.name}) is owned by unrelated database definition #${currentOwner.name}.`,
        );
      }
      conflicts.set(plan.name, currentOwner.name);
      conflicts.set(currentOwner.name, plan.name);
      console.warn(
        `Correcting conflict: Slack ${plan.desired.id} is #${plan.name}, but database definition #${currentOwner.name} currently owns it.`,
      );
    }

    // Free every changing real ID first, so swaps and cross-mappings cannot violate
    // slack_channel_workspace_id_unique halfway through the transaction.
    for (const plan of plans) {
      const alreadyCorrect =
        plan.canonical.workspace_id === workspace && plan.canonical.slack_channel_id === plan.desired.id;
      if (!alreadyCorrect) {
        await transaction`
          update slack_channels
          set workspace_id = ${workspace}, slack_channel_id = ${`REMAP:${plan.canonical.id}`}, active = false
          where id = ${plan.canonical.id}
        `;
      }
    }

    const output: MappingResult[] = [];
    for (const plan of plans) {
      const alreadyCorrect =
        plan.canonical.workspace_id === workspace && plan.canonical.slack_channel_id === plan.desired.id;
      if (!alreadyCorrect) {
        await transaction`
          update slack_channels
          set workspace_id = ${workspace}, slack_channel_id = ${plan.desired.id}, active = true
          where id = ${plan.canonical.id}
        `;
      } else if (!plan.canonical.active) {
        await transaction`update slack_channels set active = true where id = ${plan.canonical.id}`;
      }

      const duplicateIds = plan.duplicates.map((row) => row.id);
      if (duplicateIds.length) {
        await transaction`delete from slack_channels where id in ${transaction(duplicateIds)}`;
      }

      const status = conflicts.has(plan.name)
        ? `corrected conflict with #${conflicts.get(plan.name)}`
        : alreadyCorrect
          ? plan.duplicates.length
            ? "already mapped; removed empty duplicate"
            : "already mapped"
          : "mapped by exact name";
      output.push({ database_channel_name: plan.name, slack_channel_id: plan.desired.id, status });
    }

    const verification = (await transaction`
      select count(*)::int as row_count, count(distinct slack_channel_id)::int as distinct_id_count
      from slack_channels
      where workspace_id = ${workspace} and active = true and name in ${transaction(REPORTING_CHANNELS)}
    `) as unknown as Array<{ row_count: number; distinct_id_count: number }>;
    if (verification[0]?.row_count !== 8 || verification[0]?.distinct_id_count !== 8) {
      throw new Error(
        `Channel verification failed: ${verification[0]?.row_count ?? 0} active rows, ` +
          `${verification[0]?.distinct_id_count ?? 0} distinct Slack IDs.`,
      );
    }
    return output;
  });

  console.table(results);
  console.log("Verified 8 reporting channel definitions with 8 distinct Slack channel IDs.");
  console.log("Employee Slack identities were not read or modified.");
} finally {
  await sql.end({ timeout: 5 });
}
