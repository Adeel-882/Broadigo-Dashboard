import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");

const { default: postgres } = await import("postgres");
const db = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 20 });

try {
  const roster = await db`
    select e.id employee_id, e.canonical_name real_name, e.pseudo_name, e.work_email, e.job_title, e.active,
      m.role membership_role, t.name team,
      coalesce(array_agg(distinct ea.alias) filter (where ea.alias is not null), '{}') aliases,
      coalesce(jsonb_agg(distinct jsonb_build_object(
        'slack_user_id', si.slack_user_id,
        'display_name', si.display_name,
        'identity_aliases', si.aliases
      )) filter (where si.id is not null), '[]') slack_identities
    from employees e
      join employee_team_memberships m on m.employee_id=e.id
      join teams t on t.id=m.team_id and t.slug='isa-lead-management'
      left join employee_aliases ea on ea.employee_id=e.id
      left join employee_slack_identities si on si.employee_id=e.id
    group by e.id,m.role,t.name
    order by e.active desc,e.canonical_name`;

  const baseline = await db`
    select
      (select count(*)::int from employees) employees,
      (select count(*)::int from employees where active) active_employees,
      (select count(*)::int from employee_team_memberships m join teams t on t.id=m.team_id where t.slug='isa-lead-management') isa_memberships,
      (select count(*)::int from employee_team_memberships m join teams t on t.id=m.team_id join employees e on e.id=m.employee_id where t.slug='isa-lead-management' and e.active) active_isa,
      (select count(*)::int from leads) leads,
      (select count(*)::int from leads where counts_toward_kpi) eligible_leads,
      (select count(*)::int from leads where not counts_toward_kpi) excluded_leads,
      (select count(*)::int from appointments) appointments,
      (select count(*)::int from sales) sales,
      (select coalesce(sum(amount),0)::numeric from sales) revenue,
      (select count(*)::int from docks) dock_messages,
      (select coalesce(sum(amount),0)::numeric from docks) dock_base_sum`;

  const dockImpact = await db`select
    coalesce(sum(d.amount * greatest(1,(select count(*) from dock_recipients dr where dr.dock_id=d.id))),0)::numeric dock_total_impact,
    (select count(*)::int from dock_recipients) recipient_rows,
    (select count(*)::int from docks mapped where exists(select 1 from dock_recipients dr where dr.dock_id=mapped.id)) mapped_docks
    from docks d`;

  const docks = await db`
    select sm.slack_ts, sm.posted_at, left(sm.raw_text,180) source_excerpt, d.amount current_amount, d.currency,
      cardinality(array(select distinct match[1] from regexp_matches(sm.raw_text,'<@([A-Z0-9]+)>','g') match))::int distinct_mentions,
      coalesce(array(select distinct e.canonical_name
        from regexp_matches(sm.raw_text,'<@([A-Z0-9]+)>','g') match
        join employee_slack_identities si on si.workspace_id=sm.workspace_id and si.slack_user_id=match[1]
        join employees e on e.id=si.employee_id order by e.canonical_name), '{}') mapped_people
    from docks d join slack_messages sm on sm.id=d.slack_message_id
    where sm.raw_text ~* '(^|[^A-Za-z0-9])[0-9]+(?:\\.[0-9]+)?[kK]([^A-Za-z]|$)'
       or (select count(distinct match[1]) from regexp_matches(sm.raw_text,'<@([A-Z0-9]+)>','g') match) > 1
    order by sm.posted_at desc`;

  console.log("CURRENT ISA ROSTER");
  console.table(roster);
  console.log(JSON.stringify(roster, null, 2));
  console.log("BASELINE");
  console.table(baseline);
  console.log("DOCK IMPACT");
  console.table(dockImpact);
  console.log("K / MULTI-PERSON DOCK SOURCES");
  console.table(docks);

  const token = process.env.SLACK_BOT_TOKEN;
  if (token) {
    const users: Array<Record<string, unknown>> = [];
    let cursor = "";
    do {
      const response = await fetch(`https://slack.com/api/users.list?${new URLSearchParams({ limit: "200", ...(cursor ? { cursor } : {}) })}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      const body = await response.json() as {
        ok: boolean;
        error?: string;
        members?: Array<{ id: string; deleted?: boolean; profile?: { email?: string; display_name?: string; real_name?: string } }>;
        response_metadata?: { next_cursor?: string };
      };
      if (!body.ok) {
        console.log(`SLACK USERS AUDIT UNAVAILABLE: ${body.error ?? response.status}`);
        break;
      }
      users.push(...(body.members ?? []).filter((member) => !member.deleted).map((member) => ({
        slack_user_id: member.id,
        email: member.profile?.email ?? "",
        display_name: member.profile?.display_name ?? "",
        real_name: member.profile?.real_name ?? "",
      })));
      cursor = body.response_metadata?.next_cursor ?? "";
    } while (cursor);
    const desiredEmails = new Set([
      "ericwilliams@leadsedge.us", "stevecoulston@leadsedge.us", "lizbert@leadsedge.us",
      "ellajohnson@leadsedge.us", "adamgrant@leadsedge.us", "mikeweston@leadsedge.us",
      "rickjohnson@leadsedge.us", "brianadams@leadsedge.us", "oliversmith@leadsedge.us",
      "emmajames@leadsedge.us",
    ]);
    const desiredPseudos = new Set([
      "eric williams", "steve coulston", "lizbert", "ella johnson", "justin clay",
      "christian knight", "david klein", "brian adams", "oliver smith", "emma james",
    ]);
    console.log("CURRENT SLACK ACCOUNTS FOR SUPPLIED EMAILS / PSEUDOS");
    console.table(users.filter((user) => desiredEmails.has(String(user.email).toLowerCase())
      || desiredPseudos.has(String(user.display_name).toLowerCase())
      || desiredPseudos.has(String(user.real_name).toLowerCase())));
    const leadAuthors = await db`
      select sm.slack_user_id, max(sm.posted_at) latest, count(*)::int messages
      from slack_messages sm join slack_channels c on c.id=sm.channel_id
      where c.name='leads-reporting' and sm.slack_user_id is not null
      group by sm.slack_user_id order by latest desc`;
    const profileById = new Map(users.map((user) => [String(user.slack_user_id), user]));
    console.log("LEADS-REPORTING AUTHORS BY RECENCY");
    console.table(leadAuthors.map((author) => ({ ...author, ...(profileById.get(String(author.slack_user_id)) ?? {}) })));
  }
} finally {
  await db.end({ timeout: 5 });
}
