import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }, { parserRegistry }, { resolveDateRange }, { primaryMetricForTitle }, { occurredAt, operationalShiftFilter }] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/parsers/registry"),
  import("@/lib/time-ranges"),
  import("@/lib/dashboard-metrics"),
  import("@/lib/operational-query"),
]);

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");

type Row = Record<string, unknown>;
const rows = (result: unknown) => result as Row[];
const text = (value: unknown) => value == null ? "" : String(value);

function redactExcerpt(value: unknown) {
  return text(value)
    .replace(/<tel:[^>]+>/gi, "<phone>")
    .replace(/<mailto:[^>]+>/gi, "<email>")
    .replace(/\b[\w.+-]+@[\w.-]+\.[A-Za-z]{2,}\b/g, "<email>")
    .replace(/\+?\d[\d\s().-]{6,}\d/g, "<phone>")
    .replace(/\s+/g, " ")
    .slice(0, 180);
}

function isStrongCandidate(parserType: string, rawText: string) {
  if (parserType.includes("appointment")) return /(call|appointment).*(scheduled|booked|set)/i.test(rawText);
  if (parserType.includes("sale")) return /(sold|closed deal|plan|package|sale).*(USD|PKR|\$|\d{3,})/i.test(rawText);
  if (parserType === "leads") return /(lead type|buyer lead|seller lead)/i.test(rawText);
  if (parserType === "dock") return /(dock|deduction|penalty|fine).*(PKR|USD|\$|\d{2,})/i.test(rawText);
  if (parserType === "media-work") return /(completed|finished|shipped|deployed|resolved|delivered|working on|in progress|implemented|built|fixed|tested)/i.test(rawText);
  return false;
}

function isHighConfidenceKpiEvidence(parserType: string, rawText: string) {
  if (parserType.includes("appointment")) return /call\s+scheduled/i.test(rawText) && /<tel:/i.test(rawText);
  if (parserType === "dock") return /(dock|deduction|penalty|fine)/i.test(rawText)
    && /(PKR|Rs\.?|USD|\$)[*_\s]*\d/i.test(rawText) && /<@[A-Z0-9]+>/i.test(rawText);
  return false;
}

try {
  const deltaResult = await db.execute(sql`
    with latest_sync as (
      select max(completed_at) completed_at from sync_runs where status='COMPLETED'
    ), recent_positive_runs as (
      select sr.* from sync_runs sr cross join latest_sync latest
      where sr.status='COMPLETED' and sr.messages_imported>0
        and sr.completed_at>=latest.completed_at-interval '10 minutes'
    )
    select distinct sm.id, c.name channel, sm.slack_ts, sm.slack_user_id, sm.employee_id author_employee_id,
      author.canonical_name author_employee, author.job_title author_job_title, sm.raw_text, sm.posted_at,
      sm.imported_at, sm.parser_status, sm.parser_type, sm.validation_warnings,
      case when a.id is not null then 'APPOINTMENT' when s.id is not null then 'SALE'
        when l.id is not null then 'LEAD' when d.id is not null then 'DOCK'
        when ma.id is not null then 'MEDIA_ACTIVITY' end structured_type,
      coalesce(a.employee_id,s.employee_id,l.employee_id,d.employee_id,ma.employee_id) structured_employee_id,
      structured.canonical_name structured_employee, structured.job_title structured_job_title
    from recent_positive_runs sr
    join slack_channels c on c.id=sr.channel_id
    join slack_messages sm on sm.channel_id=sr.channel_id
      and sm.imported_at>=sr.started_at and sm.imported_at<=sr.completed_at
    left join employees author on author.id=sm.employee_id
    left join appointments a on a.slack_message_id=sm.id
    left join sales s on s.slack_message_id=sm.id
    left join leads l on l.slack_message_id=sm.id
    left join docks d on d.slack_message_id=sm.id
    left join media_activity ma on ma.slack_message_id=sm.id
    left join employees structured on structured.id=coalesce(a.employee_id,s.employee_id,l.employee_id,d.employee_id,ma.employee_id)
    order by sm.imported_at, c.name`);
  const deltaRows = rows(deltaResult);

  const identityResult = await db.execute(sql`
    select workspace_id,slack_user_id,employee_id from employee_slack_identities`);
  const identityBySlackUser = new Map(rows(identityResult).map((row) => [`${text(row.workspace_id)}:${text(row.slack_user_id)}`, text(row.employee_id)]));
  const employeeResult = await db.execute(sql`select id,canonical_name from employees`);
  const employeeNameById = new Map(rows(employeeResult).map((row) => [text(row.id), text(row.canonical_name)]));
  const workspaceResult = await db.execute(sql`select workspace_id from slack_channels where active=true limit 1`);
  const workspaceId = text(rows(workspaceResult)[0]?.workspace_id);
  const today = resolveDateRange("Today");
  const week = resolveDateRange("This Week");
  const todayFilter = operationalShiftFilter(occurredAt("occurred_at"), today.start.toISOString(), today.end.toISOString());
  const weekFilter = operationalShiftFilter(occurredAt("occurred_at"), week.start.toISOString(), week.end.toISOString());
  const trace: Row[] = [];

  for (const row of deltaRows) {
    const parserResult = parserRegistry.parse(text(row.parser_type), {
      rawSourceId: text(row.id),
      text: text(row.raw_text),
      postedAt: new Date(text(row.posted_at)),
      employeeId: row.author_employee_id ? text(row.author_employee_id) : null,
    });
    const mentionedSlackIds = [...text(row.raw_text).matchAll(/<@([A-Z0-9]+)>/g)].map((match) => match[1]);
    const mappedMentionEmployees = [...new Set(mentionedSlackIds.map((id) => identityBySlackUser.get(`${workspaceId}:${id}`)).filter(Boolean))];
    const expectedStructuredEmployee = !parserResult ? null : parserResult.recordType === "DOCK"
      ? (mappedMentionEmployees.length === 1 ? mappedMentionEmployees[0] : null)
      : (row.author_employee_id ? text(row.author_employee_id) : null);
    const storedStructuredEmployee = row.structured_employee_id ? text(row.structured_employee_id) : null;
    const parserAndRecordAgree = parserResult
      ? text(row.parser_status) === "PARSED" && text(row.structured_type) === parserResult.recordType
      : text(row.parser_status) === "UNPARSED" && !row.structured_type;
    const attributionCorrect = !parserResult || expectedStructuredEmployee === storedStructuredEmployee;

    let allTimeKpi = 0;
    let todayKpi = 0;
    let thisWeekKpi = 0;
    if (row.structured_type && storedStructuredEmployee) {
      const employeeId = storedStructuredEmployee;
      const recordType = text(row.structured_type);
      const kpiResult = await db.execute(sql`
        select count(*)::int all_time,
          count(*) filter(where ${todayFilter})::int today,
          count(*) filter(where ${weekFilter})::int this_week
        from (
          select 'APPOINTMENT' record_type,employee_id,occurred_at from appointments
          union all select 'SALE',employee_id,occurred_at from sales
          union all select 'LEAD',employee_id,occurred_at from leads
          union all select 'DOCK',employee_id,occurred_at from docks
          union all select 'MEDIA_ACTIVITY',employee_id,occurred_at from media_activity
        ) activity where employee_id=${employeeId} and record_type=${recordType}`);
      const kpi = rows(kpiResult)[0] ?? {};
      allTimeKpi = Number(kpi.all_time ?? 0);
      todayKpi = Number(kpi.today ?? 0);
      thisWeekKpi = Number(kpi.this_week ?? 0);
    }

    trace.push({
      channel: row.channel,
      slack_timestamp: row.slack_ts,
      excerpt: redactExcerpt(row.raw_text),
      stored_status: row.parser_status,
      current_parser_result: parserResult?.recordType ?? "NO_KPI_MATCH",
      author_employee: row.author_employee ?? "UNMATCHED",
      structured_employee: row.structured_employee ?? "UNATTRIBUTED",
      expected_employee: expectedStructuredEmployee ? employeeNameById.get(expectedStructuredEmployee) ?? expectedStructuredEmployee : "NONE",
      parser_record_check: parserAndRecordAgree ? "PASS" : "FAIL",
      attribution_check: attributionCorrect ? "PASS" : "FAIL",
      employee_primary_metric: row.structured_job_title ? primaryMetricForTitle(text(row.structured_job_title)) : "NONE",
      all_time_kpi: allTimeKpi,
      today_kpi: todayKpi,
      this_week_kpi: thisWeekKpi,
    });
  }

  console.log("\nLATEST DELTA MESSAGE TRACE");
  console.table(trace);

  const healthResult = await db.execute(sql`
    select count(*)::int raw_total,
      count(*) filter(where parser_status='PARSED')::int parsed,
      count(*) filter(where parser_status='UNPARSED')::int unparsed,
      count(*) filter(where parser_status='ERROR')::int errors,
      count(*) filter(where parser_status='PENDING')::int pending,
      count(*) filter(where sm.employee_id is null)::int unmatched_raw,
      count(*) filter(where si.employee_id is not null and sm.employee_id is distinct from si.employee_id)::int stale_attribution
    from slack_messages sm left join employee_slack_identities si
      on si.workspace_id=sm.workspace_id and si.slack_user_id=sm.slack_user_id`);
  console.log("\nRAW DATA HEALTH");
  console.table(rows(healthResult));

  const structuredResult = await db.execute(sql`
    select
      (select count(*)::int from appointments) appointments,
      (select count(*)::int from sales) sales,
      (select count(*)::int from leads) leads,
      (select count(*)::int from docks) docks,
      (select count(*)::int from media_activity) media_activity,
      (select count(*)::int from appointments where employee_id is null) appointments_unattributed,
      (select count(*)::int from sales where employee_id is null) sales_unattributed,
      (select count(*)::int from leads where employee_id is null) leads_unattributed,
      (select count(*)::int from docks where employee_id is null) docks_unattributed,
      (select count(*)::int from media_activity where employee_id is null) media_unattributed`);
  console.log("\nSTRUCTURED DATA HEALTH");
  console.table(rows(structuredResult));

  const unparsedResult = await db.execute(sql`
    select c.name channel,count(*)::int unparsed,
      count(*) filter(where
        (c.parser_type like '%appointment%' and sm.raw_text~* '(call|appointment).*(scheduled|booked|set)') or
        (c.parser_type like '%sale%' and sm.raw_text~* '(sold|closed deal|plan|package|sale).*(USD|PKR|\\$|[0-9]{3,})') or
        (c.parser_type='leads' and sm.raw_text~* '(lead type|buyer lead|seller lead)') or
        (c.parser_type='dock' and sm.raw_text~* '(dock|deduction|penalty|fine).*(PKR|USD|\\$|[0-9]{2,})') or
        (c.parser_type='media-work' and sm.raw_text~* '(completed|finished|shipped|deployed|resolved|delivered|working on|in progress|implemented|built|fixed|tested)')
      )::int strong_kpi_candidates
    from slack_messages sm join slack_channels c on c.id=sm.channel_id
    where sm.parser_status='UNPARSED' group by c.id,c.name order by c.name`);
  console.log("\nUNPARSED REVIEW TRIAGE");
  console.table(rows(unparsedResult));

  const highConfidenceBacklogResult = await db.execute(sql`
    select c.name channel,
      count(*) filter(where c.parser_type like '%appointment%'
        and sm.raw_text~* 'call[[:space:]]+scheduled' and sm.raw_text~* '<tel:')::int appointment_reports,
      count(*) filter(where c.parser_type='dock'
        and sm.raw_text~* '(dock|deduction|penalty|fine)'
        and sm.raw_text~* '(PKR|Rs\\.?|USD|\\$)[*_[:space:]]*[0-9]'
        and sm.raw_text~* '<@[A-Z0-9]+>')::int dock_reports
    from slack_messages sm join slack_channels c on c.id=sm.channel_id
    where sm.parser_status='UNPARSED' group by c.id,c.name
    having count(*) filter(where
      (c.parser_type like '%appointment%' and sm.raw_text~* 'call[[:space:]]+scheduled' and sm.raw_text~* '<tel:') or
      (c.parser_type='dock' and sm.raw_text~* '(dock|deduction|penalty|fine)'
        and sm.raw_text~* '(PKR|Rs\\.?|USD|\\$)[*_[:space:]]*[0-9]' and sm.raw_text~* '<@[A-Z0-9]+>'))>0
    order by c.name`);
  console.log("\nHIGH-CONFIDENCE UNPARSED KPI BACKLOG");
  console.table(rows(highConfidenceBacklogResult));

  const unparsedMessagesResult = await db.execute(sql`
    select sm.id,c.name channel,c.parser_type,sm.raw_text,sm.posted_at
    from slack_messages sm join slack_channels c on c.id=sm.channel_id
    where sm.parser_status='UNPARSED' order by c.name,sm.posted_at`);
  const currentParserRecoveries: Row[] = [];
  const highConfidencePreview = { total: 0, recovered_by_current_parser: 0, remaining: 0 };
  const remainingStrongSamples = new Map<string, Row[]>();
  for (const row of rows(unparsedMessagesResult)) {
    const rawText = text(row.raw_text);
    const result = parserRegistry.parse(text(row.parser_type), {
      rawSourceId: text(row.id), text: rawText, postedAt: new Date(text(row.posted_at)),
    });
    if (isHighConfidenceKpiEvidence(text(row.parser_type), rawText)) {
      highConfidencePreview.total += 1;
      if (result) highConfidencePreview.recovered_by_current_parser += 1;
      else highConfidencePreview.remaining += 1;
    }
    if (result) {
      currentParserRecoveries.push({ channel: row.channel, record_type: result.recordType });
      continue;
    }
    if (isStrongCandidate(text(row.parser_type), text(row.raw_text))) {
      const samples = remainingStrongSamples.get(text(row.channel)) ?? [];
      if (samples.length < 5) samples.push({ channel: row.channel, excerpt: redactExcerpt(row.raw_text) });
      remainingStrongSamples.set(text(row.channel), samples);
    }
  }
  const recoveryCounts = new Map<string, number>();
  for (const row of currentParserRecoveries) {
    const key = `${text(row.channel)}:${text(row.record_type)}`;
    recoveryCounts.set(key, (recoveryCounts.get(key) ?? 0) + 1);
  }
  console.log("\nHIGH-CONFIDENCE CURRENT-PARSER PREVIEW");
  console.table([highConfidencePreview]);
  console.log("\nUNPARSED RECORDS RECOVERABLE BY CURRENT PARSER");
  console.table([...recoveryCounts].map(([key, count]) => {
    const separator = key.lastIndexOf(":");
    return { channel: key.slice(0, separator), record_type: key.slice(separator + 1), records: count };
  }));
  console.log("\nREMAINING STRONG-CANDIDATE SAMPLES");
  console.table([...remainingStrongSamples.values()].flat());

  const unmatchedResult = await db.execute(sql`
    select c.name channel,coalesce(sm.slack_user_id,'NO_USER_ID') slack_user_id,count(*)::int messages,
      count(*) filter(where sm.parser_status='PARSED')::int parsed_messages
    from slack_messages sm join slack_channels c on c.id=sm.channel_id
    where sm.employee_id is null group by c.name,sm.slack_user_id order by c.name,messages desc`);
  console.log("\nUNMATCHED RAW AUTHORS");
  const unmatchedRows = rows(unmatchedResult);
  console.table(unmatchedRows);

  const token = process.env.SLACK_BOT_TOKEN;
  const unmatchedProfiles: Row[] = [];
  if (token) {
    for (const row of unmatchedRows) {
      const slackUserId = text(row.slack_user_id);
      try {
        const response = await fetch(`https://slack.com/api/users.info?${new URLSearchParams({ user: slackUserId })}`, {
          headers: { authorization: `Bearer ${token}` }, cache: "no-store",
        });
        const payload = await response.json() as { ok?: boolean; error?: string; user?: { real_name?: string; deleted?: boolean; is_bot?: boolean; profile?: { display_name?: string } } };
        unmatchedProfiles.push({
          slack_user_id: slackUserId,
          profile: payload.ok ? payload.user?.profile?.display_name || payload.user?.real_name || "Unnamed" : payload.error ?? "Unavailable",
          deleted: payload.user?.deleted ?? false,
          is_bot: payload.user?.is_bot ?? false,
          messages: row.messages,
          parsed_messages: row.parsed_messages,
        });
      } catch {
        unmatchedProfiles.push({ slack_user_id: slackUserId, profile: "Unavailable during audit", messages: row.messages, parsed_messages: row.parsed_messages });
      }
    }
  }
  console.log("\nUNMATCHED SLACK PROFILE REVIEW");
  console.table(unmatchedProfiles);

  const unattributedResult = await db.execute(sql`
    select record_type,channel,count(*)::int records from (
      select 'APPOINTMENT' record_type,c.name channel from appointments a join slack_messages sm on sm.id=a.slack_message_id join slack_channels c on c.id=sm.channel_id where a.employee_id is null
      union all select 'SALE',c.name from sales s join slack_messages sm on sm.id=s.slack_message_id join slack_channels c on c.id=sm.channel_id where s.employee_id is null
      union all select 'LEAD',c.name from leads l join slack_messages sm on sm.id=l.slack_message_id join slack_channels c on c.id=sm.channel_id where l.employee_id is null
      union all select 'DOCK',c.name from docks d join slack_messages sm on sm.id=d.slack_message_id join slack_channels c on c.id=sm.channel_id where d.employee_id is null
      union all select 'MEDIA_ACTIVITY',c.name from media_activity m join slack_messages sm on sm.id=m.slack_message_id join slack_channels c on c.id=sm.channel_id where m.employee_id is null
    ) unattributed group by record_type,channel order by record_type,channel`);
  console.log("\nUNATTRIBUTED STRUCTURED RECORDS");
  console.table(rows(unattributedResult));

  const unattributedDocksResult = await db.execute(sql`
    select sm.workspace_id,sm.raw_text from docks d join slack_messages sm on sm.id=d.slack_message_id
    where d.employee_id is null`);
  const dockDiagnostics = { no_slack_mention: 0, mentions_only_unmapped_users: 0, multiple_mapped_targets: 0, one_mapped_target_unexpected: 0 };
  for (const row of rows(unattributedDocksResult)) {
    const mentionIds = [...text(row.raw_text).matchAll(/<@([A-Z0-9]+)>/g)].map((match) => match[1]);
    const mappedTargets = [...new Set(mentionIds.map((id) => identityBySlackUser.get(`${text(row.workspace_id)}:${id}`)).filter(Boolean))];
    if (!mentionIds.length) dockDiagnostics.no_slack_mention += 1;
    else if (!mappedTargets.length) dockDiagnostics.mentions_only_unmapped_users += 1;
    else if (mappedTargets.length > 1) dockDiagnostics.multiple_mapped_targets += 1;
    else dockDiagnostics.one_mapped_target_unexpected += 1;
  }
  console.log("\nUNATTRIBUTED DOCK DIAGNOSTICS");
  console.table([dockDiagnostics]);

  const integrityResult = await db.execute(sql`
    select
      (select count(*)::int from slack_messages sm
        left join appointments a on a.slack_message_id=sm.id left join sales s on s.slack_message_id=sm.id
        left join leads l on l.slack_message_id=sm.id left join docks d on d.slack_message_id=sm.id
        left join media_activity m on m.slack_message_id=sm.id
        where sm.parser_status='PARSED' and a.id is null and s.id is null and l.id is null and d.id is null and m.id is null) parsed_without_structured,
      (select count(*)::int from (
        select a.employee_id record_employee,sm.employee_id message_employee from appointments a join slack_messages sm on sm.id=a.slack_message_id
        union all select s.employee_id,sm.employee_id from sales s join slack_messages sm on sm.id=s.slack_message_id
        union all select l.employee_id,sm.employee_id from leads l join slack_messages sm on sm.id=l.slack_message_id
        union all select m.employee_id,sm.employee_id from media_activity m join slack_messages sm on sm.id=m.slack_message_id
      ) author_records where record_employee is distinct from message_employee) author_attribution_mismatches,
      (select count(*)::int from docks d join slack_messages sm on sm.id=d.slack_message_id
        where d.employee_id is not null and not exists (
          select 1 from employee_slack_identities si where si.employee_id=d.employee_id and si.workspace_id=sm.workspace_id
            and sm.raw_text like '%<@' || si.slack_user_id || '>%'
        )) dock_target_mismatches,
      (select count(*)::int from (
        select slack_message_id from appointments group by slack_message_id having count(*)>1
        union all select slack_message_id from sales group by slack_message_id having count(*)>1
        union all select slack_message_id from leads group by slack_message_id having count(*)>1
        union all select slack_message_id from docks group by slack_message_id having count(*)>1
        union all select slack_message_id from media_activity group by slack_message_id having count(*)>1
      ) duplicates) duplicate_structured_records`);
  console.log("\nATTRIBUTION INTEGRITY");
  console.table(rows(integrityResult));
} finally {
  await closeDb();
}
