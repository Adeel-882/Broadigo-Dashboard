import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
]);

const db = getDb();
if (!db) throw new Error("DATABASE_URL is required.");

const rows = (result: unknown) => result as Array<Record<string, unknown>>;

try {
  const scope = [
    "Asif Hazoor",
    "Ali Jan",
    "Haji Siraj Ahmed",
    "Araad Rana",
    "Alishba Ali",
    "Hamdan Mahmood",
    "Zeeshan Afsar",
    "Zaynab Rafaqat",
    "Aishah Arif",
  ];
  const scopeSql = sql.join(scope.map((name) => sql`${name}`), sql`, `);

  const [totals, byEmployee, byDate, outsideScope, evidenceQuality, duplicateChecks, constraintChecks, distinctKeys, duplicatePhones, duplicateTexts, sourceBreakdown, workbookCutoff, afterWorkbookCutoff, first177, missingSourceEvidence, qualificationEvidence, weekdayUniqueCandidate, exclusionOverlap, byCalendarDate, invalidTypeEvidence, canonicalPhoneCandidate, canonicalPhoneDuplicateEvidence] = await Promise.all([
    db.execute(sql`
      select count(*)::int total,
        count(*) filter (where e.canonical_name in (${scopeSql}))::int isa_scope,
        count(*) filter (where e.canonical_name is null)::int unattributed,
        count(*) filter (where e.canonical_name is not null and e.canonical_name not in (${scopeSql}))::int other_employees
      from leads l
      left join employees e on e.id=l.employee_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')`),
    db.execute(sql`
      select coalesce(e.canonical_name,'Unattributed') employee, count(*)::int structured_leads,
        count(distinct nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),''))::int distinct_phones,
        count(*)::int-count(distinct nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),''))::int repeated_phone_excess
      from leads l left join employees e on e.id=l.employee_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      group by e.canonical_name order by structured_leads desc, employee`),
    db.execute(sql`
      select (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date,
        count(*)::int total,
        count(*) filter(where e.canonical_name in (${scopeSql}))::int isa_scope,
        count(*) filter(where e.canonical_name is null or e.canonical_name not in (${scopeSql}))::int outside_scope
      from leads l left join employees e on e.id=l.employee_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      group by operational_date order by operational_date`),
    db.execute(sql`
      select l.id lead_id,sm.id raw_message_id,sm.slack_ts,timezone('Asia/Karachi',sm.posted_at) local_timestamp,
        (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date,
        coalesce(si.display_name,sm.slack_user_id,'Unknown') slack_author,
        coalesce(e.canonical_name,'Unattributed') mapped_employee,c.name channel,
        l.details->>'lead source' lead_source,l.lead_type,l.contact_name,l.phone,l.email,l.property_type,l.state,l.timeline,
        sm.raw_text
      from leads l join slack_messages sm on sm.id=l.slack_message_id
      join slack_channels c on c.id=sm.channel_id
      left join employees e on e.id=l.employee_id
      left join employee_slack_identities si on si.workspace_id=sm.workspace_id and si.slack_user_id=sm.slack_user_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
        and (e.canonical_name is null or e.canonical_name not in (${scopeSql}))
      order by l.occurred_at`),
    db.execute(sql`
      select
        count(*) filter(where nullif(trim(l.details->>'lead source'),'') is null)::int missing_source,
        count(*) filter(where nullif(trim(l.lead_type),'') is null)::int missing_type,
        count(*) filter(where nullif(trim(l.contact_name),'') is null)::int missing_name,
        count(*) filter(where nullif(trim(l.phone),'') is null)::int missing_phone,
        count(*) filter(where nullif(trim(l.details->>'lead source'),'') is not null
          and nullif(trim(l.lead_type),'') is not null
          and nullif(trim(l.contact_name),'') is not null
          and nullif(trim(l.phone),'') is not null)::int complete_core_fields
      from leads l left join employees e on e.id=l.employee_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')`),
    db.execute(sql`
      select
        (select count(*)::int from (select slack_message_id from leads group by slack_message_id having count(*)>1) d) duplicate_structured_raw_ids,
        (select count(*)::int from (select sm.workspace_id,sm.channel_id,sm.slack_ts from leads l join slack_messages sm on sm.id=l.slack_message_id group by sm.workspace_id,sm.channel_id,sm.slack_ts having count(*)>1) d) duplicate_slack_reports,
        (select count(*)::int from leads l left join slack_messages sm on sm.id=l.slack_message_id where sm.id is null) orphaned_leads`),
    db.execute(sql`
      select indexname,indexdef from pg_indexes where schemaname='public' and tablename='leads' order by indexname`),
    db.execute(sql`
      select count(*)::int total,
        count(distinct nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),''))::int distinct_phones,
        count(distinct right(nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),''),10))::int distinct_last_10_phones,
        count(distinct lower(trim(coalesce(l.contact_name,''))))::int distinct_names,
        count(distinct md5(regexp_replace(lower(trim(sm.raw_text)),'\\s+',' ','g')))::int distinct_normalized_texts
      from leads l join slack_messages sm on sm.id=l.slack_message_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')`),
    db.execute(sql`
      with scoped as (
        select l.*,sm.slack_ts,sm.raw_text,sm.slack_user_id,
          nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),'') phone_key,
          (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date,
          timezone('Asia/Karachi',l.occurred_at) local_timestamp,e.canonical_name employee
        from leads l join slack_messages sm on sm.id=l.slack_message_id left join employees e on e.id=l.employee_id
        where l.occurred_at >= '2026-08-01T14:00:00Z'
          and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      ), duplicate_keys as (select phone_key from scoped where phone_key is not null group by phone_key having count(*)>1)
      select s.phone_key,count(*) over(partition by s.phone_key)::int occurrences,s.operational_date,s.local_timestamp,
        s.slack_ts,s.employee,s.contact_name,s.lead_type,s.details->>'lead source' lead_source,s.raw_text
      from scoped s join duplicate_keys d on d.phone_key=s.phone_key
      order by s.phone_key,s.local_timestamp`),
    db.execute(sql`
      with scoped as (
        select l.*,sm.slack_ts,sm.raw_text,
          md5(regexp_replace(lower(trim(sm.raw_text)),'\\s+',' ','g')) text_key,
          (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date,
          timezone('Asia/Karachi',l.occurred_at) local_timestamp,e.canonical_name employee
        from leads l join slack_messages sm on sm.id=l.slack_message_id left join employees e on e.id=l.employee_id
        where l.occurred_at >= '2026-08-01T14:00:00Z'
          and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      ), duplicate_keys as (select text_key from scoped group by text_key having count(*)>1)
      select s.text_key,count(*) over(partition by s.text_key)::int occurrences,s.operational_date,s.local_timestamp,
        s.slack_ts,s.employee,s.contact_name,s.phone,s.raw_text
      from scoped s join duplicate_keys d on d.text_key=s.text_key
      order by s.text_key,s.local_timestamp`),
    db.execute(sql`
      select coalesce(nullif(trim(l.details->>'lead source'),''),'MISSING') lead_source,count(*)::int total
      from leads l
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      group by lead_source order by total desc,lead_source`),
    db.execute(sql`
      select coalesce(e.canonical_name,'Unattributed') employee,count(*)::int structured_leads
      from leads l left join employees e on e.id=l.employee_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at <= '2026-08-18T20:58:39Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      group by e.canonical_name order by employee`),
    db.execute(sql`
      select sm.id raw_message_id,sm.slack_ts,timezone('Asia/Karachi',l.occurred_at) local_timestamp,
        (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date,
        e.canonical_name employee,l.details->>'lead source' lead_source,l.lead_type,l.contact_name,l.phone,sm.raw_text
      from leads l join slack_messages sm on sm.id=l.slack_message_id left join employees e on e.id=l.employee_id
      where l.occurred_at > '2026-08-18T20:58:39Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      order by l.occurred_at`),
    db.execute(sql`
      with ranked as (
        select l.employee_id,l.occurred_at,row_number() over(order by l.occurred_at,l.id) sequence
        from leads l
        where l.occurred_at >= '2026-08-01T14:00:00Z'
          and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      )
      select e.canonical_name employee,count(*)::int first_177_leads,
        max(timezone('Asia/Karachi',r.occurred_at)) filter(where r.sequence=177) benchmark_cutoff
      from ranked r join employees e on e.id=r.employee_id where r.sequence<=177
      group by e.canonical_name order by employee`),
    db.execute(sql`
      select sm.id raw_message_id,sm.slack_ts,timezone('Asia/Karachi',l.occurred_at) local_timestamp,
        (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date,
        e.canonical_name employee,l.lead_type,l.contact_name,l.phone,l.email,l.property_type,l.state,l.timeline,l.details,sm.raw_text
      from leads l join slack_messages sm on sm.id=l.slack_message_id left join employees e on e.id=l.employee_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
        and nullif(trim(l.details->>'lead source'),'') is null
      order by l.occurred_at`),
    db.execute(sql`
      select
        count(*) filter(where lower(trim(l.lead_type)) in ('buyer','seller'))::int valid_lead_type,
        count(*) filter(where lower(trim(l.lead_type)) not in ('buyer','seller'))::int invalid_lead_type,
        count(*) filter(where nullif(trim(l.property_type),'') is not null
          or nullif(trim(l.state),'') is not null
          or nullif(trim(l.details->>'area'),'') is not null
          or nullif(trim(l.details->>'address'),'') is not null)::int property_or_location,
        count(*) filter(where nullif(trim(l.property_type),'') is null
          and nullif(trim(l.state),'') is null
          and nullif(trim(l.details->>'area'),'') is null
          and nullif(trim(l.details->>'address'),'') is null)::int missing_property_and_location,
        count(*) filter(where length(trim(sm.raw_text)) < 100)::int short_messages
      from leads l join slack_messages sm on sm.id=l.slack_message_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')`),
    db.execute(sql`
      with scoped as (
        select l.*,e.canonical_name,
          nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),'') phone_key,
          (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date
        from leads l join employees e on e.id=l.employee_id
        where l.occurred_at >= '2026-08-01T14:00:00Z'
          and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      ), weekday_ranked as (
        select *,row_number() over(partition by phone_key order by occurred_at,id) phone_sequence
        from scoped where extract(isodow from operational_date) between 1 and 5
      )
      select canonical_name employee,count(*) filter(where phone_sequence=1)::int retained,
        count(*) filter(where phone_sequence>1)::int repeated_weekday_excluded
      from weekday_ranked group by canonical_name order by employee`),
    db.execute(sql`
      with scoped as (
        select l.*,
          nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),'') phone_key,
          (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date
        from leads l
        where l.occurred_at >= '2026-08-01T14:00:00Z'
          and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      ), ranked as (
        select *,row_number() over(partition by phone_key order by occurred_at,id) phone_sequence from scoped
      )
      select count(*) filter(where extract(isodow from operational_date) in (6,7))::int weekend_records,
        count(*) filter(where phone_sequence>1)::int repeated_phone_surplus,
        count(*) filter(where extract(isodow from operational_date) in (6,7) and phone_sequence>1)::int overlap,
        count(*) filter(where extract(isodow from operational_date) between 1 and 5 and phone_sequence=1)::int weekday_first_phone_total
      from ranked`),
    db.execute(sql`
      select timezone('Asia/Karachi',l.occurred_at)::date calendar_date,count(*)::int total
      from leads l
      where l.occurred_at >= '2026-08-01T00:00:00Z' and l.occurred_at < '2026-09-01T00:00:00Z'
      group by calendar_date order by calendar_date`),
    db.execute(sql`
      select sm.id raw_message_id,sm.slack_ts,timezone('Asia/Karachi',l.occurred_at) local_timestamp,
        (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date,
        e.canonical_name employee,l.lead_type,l.contact_name,l.phone,l.details->>'lead source' lead_source,sm.raw_text
      from leads l join slack_messages sm on sm.id=l.slack_message_id left join employees e on e.id=l.employee_id
      where l.occurred_at >= '2026-08-01T14:00:00Z' and l.occurred_at < '2026-09-01T00:00:00Z'
        and lower(trim(l.lead_type)) not in ('buyer','seller')
      order by l.occurred_at`),
    db.execute(sql`
      with scoped as (
        select l.*,e.canonical_name,
          right(nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),''),10) phone_key,
          (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date
        from leads l join employees e on e.id=l.employee_id
        where l.occurred_at >= '2026-08-01T14:00:00Z'
          and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      ), ranked as (
        select *,row_number() over(partition by phone_key order by occurred_at,id) phone_sequence from scoped
      )
      select canonical_name employee,count(*) filter(where phone_sequence=1)::int retained,
        count(*) filter(where phone_sequence>1)::int duplicate_excluded
      from ranked group by canonical_name order by employee`),
    db.execute(sql`
      with scoped as (
        select l.*,sm.slack_ts,sm.raw_text,e.canonical_name,
          right(nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),''),10) phone_key,
          (timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date operational_date,
          timezone('Asia/Karachi',l.occurred_at) local_timestamp
        from leads l join slack_messages sm on sm.id=l.slack_message_id join employees e on e.id=l.employee_id
        where l.occurred_at >= '2026-08-01T14:00:00Z'
          and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      ), ranked as (
        select *,row_number() over(partition by phone_key order by occurred_at,id) phone_sequence,
          count(*) over(partition by phone_key)::int occurrences from scoped
      )
      select id lead_id,slack_message_id raw_message_id,slack_ts,local_timestamp,operational_date,
        canonical_name employee,contact_name,phone,lead_type,details->>'lead source' lead_source,
        phone_key,phone_sequence,occurrences,raw_text
      from ranked where phone_sequence>1 order by phone_key,phone_sequence`),
  ]);

  if (process.argv.includes("--dry-parse")) {
    const [{ parserRegistry }, messageResult] = await Promise.all([
      import("@/lib/parsers/registry"),
      db.execute(sql`
        select sm.id,sm.raw_text,sm.posted_at,sm.employee_id,l.id structured_lead_id
        from slack_messages sm join slack_channels c on c.id=sm.channel_id
        left join leads l on l.slack_message_id=sm.id
        where c.parser_type='leads'
          and sm.posted_at >= '2026-08-01T14:00:00Z' and sm.posted_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',sm.posted_at)::time >= time '19:00'
            or timezone('Asia/Karachi',sm.posted_at)::time < time '05:00')`),
    ]);
    const messages = rows(messageResult);
    const rejected = messages.filter((message) => !parserRegistry.parse("leads", {
      rawSourceId: String(message.id),
      text: String(message.raw_text),
      postedAt: new Date(String(message.posted_at)),
      employeeId: message.employee_id ? String(message.employee_id) : null,
    }));
    const rejectedStructured = rejected.filter((message) => message.structured_lead_id);
    const acceptedUnstructured = messages.filter((message) => !message.structured_lead_id && parserRegistry.parse("leads", {
      rawSourceId: String(message.id), text: String(message.raw_text), postedAt: new Date(String(message.posted_at)), employeeId: message.employee_id ? String(message.employee_id) : null,
    }));
    console.table([{ messages: messages.length, accepted: messages.length - rejected.length, rejected: rejected.length, rejected_structured: rejectedStructured.length, accepted_unstructured: acceptedUnstructured.length }]);
    if (rejectedStructured.length) console.table(rejectedStructured.map((message) => ({ id: message.id, posted_at: message.posted_at, raw_text: message.raw_text })));
    if (acceptedUnstructured.length) console.table(acceptedUnstructured.map((message) => ({ id: message.id, posted_at: message.posted_at, raw_text: message.raw_text })));
  } else if (process.argv.includes("--matrix")) {
    const matrix = await db.execute(sql`
      select e.canonical_name employee,
        to_char((timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date,'YYYY-MM-DD') operational_date,
        count(*)::int leads,
        min(timezone('Asia/Karachi',l.occurred_at)) first_local,
        max(timezone('Asia/Karachi',l.occurred_at)) last_local
      from leads l join employees e on e.id=l.employee_id
      where l.occurred_at >= '2026-08-01T14:00:00Z'
        and l.occurred_at < '2026-09-01T00:00:00Z'
        and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
          or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
      group by e.canonical_name,(timezone('Asia/Karachi',l.occurred_at)-interval '5 hours')::date
      order by operational_date,employee`);
    console.table(rows(matrix));
  } else if (process.argv.includes("--identity-summary")) {
    const [keys, emails, detailKeys, contractCoverage] = await Promise.all([
      db.execute(sql`
        select count(*)::int total,
          count(distinct nullif(lower(trim(l.email)),''))::int distinct_emails,
          count(*) filter(where nullif(trim(coalesce(l.email,'')),'') is not null)::int rows_with_email,
          count(distinct nullif(lower(trim(l.contact_name)),''))::int distinct_names,
          count(distinct right(nullif(regexp_replace(coalesce(l.phone,''),'[^0-9]','','g'),''),10))::int distinct_phones
        from leads l
        where l.occurred_at >= '2026-08-01T14:00:00Z' and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')`),
      db.execute(sql`
        select lower(trim(l.email)) email,count(*)::int occurrences,
          array_agg(distinct l.contact_name) names,array_agg(distinct l.phone) phones
        from leads l
        where l.occurred_at >= '2026-08-01T14:00:00Z' and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
          and nullif(trim(coalesce(l.email,'')),'') is not null
        group by lower(trim(l.email)) having count(*)>1 order by occurrences desc,email`),
      db.execute(sql`
        select key,count(*)::int occurrences from leads l cross join lateral jsonb_object_keys(l.details) key
        where l.occurred_at >= '2026-08-01T14:00:00Z' and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
        group by key order by occurrences desc,key`),
      db.execute(sql`
        select e.canonical_name employee,count(*)::int total,
          count(*) filter(where l.details ? 'contract with a realtor')::int with_contract_field,
          count(*) filter(where not (l.details ? 'contract with a realtor'))::int without_contract_field
        from leads l join employees e on e.id=l.employee_id
        where l.occurred_at >= '2026-08-01T14:00:00Z' and l.occurred_at < '2026-09-01T00:00:00Z'
          and (timezone('Asia/Karachi',l.occurred_at)::time >= time '19:00'
            or timezone('Asia/Karachi',l.occurred_at)::time < time '05:00')
        group by e.canonical_name order by employee`),
    ]);
    console.log("IDENTITY KEYS"); console.table(rows(keys));
    console.log("DUPLICATE EMAILS"); console.table(rows(emails));
    console.log("DETAIL KEYS"); console.table(rows(detailKeys));
    console.log("CONTRACT FIELD COVERAGE"); console.table(rows(contractCoverage));
  } else if (process.argv.includes("--canonical-only")) {
    console.log("\nDISTINCT EVIDENCE KEYS");
    console.table(rows(distinctKeys));
    console.log("\nCANONICAL LAST-10 PHONE DEDUPLICATION CANDIDATE");
    console.table(rows(canonicalPhoneCandidate));
    console.log("\nCANONICAL PHONE DUPLICATE EVIDENCE");
    console.table(rows(canonicalPhoneDuplicateEvidence));
  } else {
  console.log("\nAUGUST 2026 OPERATIONAL LEAD TOTALS (BEFORE REPAIR)");
  console.table(rows(totals));
  console.log("\nBY EMPLOYEE");
  console.table(rows(byEmployee));
  console.log("\nBY OPERATIONAL DATE");
  console.table(rows(byDate));
  console.log("\nBY LOCAL CALENDAR DATE (DIAGNOSTIC ONLY)");
  console.table(rows(byCalendarDate));
  console.log("\nFIELD COMPLETENESS");
  console.table(rows(evidenceQuality));
  console.log("\nLEAD QUALIFICATION EVIDENCE");
  console.table(rows(qualificationEvidence));
  console.log("\nNON-STANDARD LEAD TYPE EVIDENCE");
  console.table(rows(invalidTypeEvidence));
  console.log("\nWEEKDAY + UNIQUE PHONE CANDIDATE");
  console.table(rows(weekdayUniqueCandidate));
  console.log("\nWEEKEND / REPEATED-PHONE OVERLAP");
  console.table(rows(exclusionOverlap));
  console.log("\nDISTINCT EVIDENCE KEYS");
  console.table(rows(distinctKeys));
  console.log("\nCANONICAL LAST-10 PHONE DEDUPLICATION CANDIDATE");
  console.table(rows(canonicalPhoneCandidate));
  console.log("\nMISSING LEAD SOURCE FIELD — RAW EVIDENCE");
  console.table(rows(missingSourceEvidence));
  console.log("\nDUPLICATE / ORPHAN CHECKS");
  console.table(rows(duplicateChecks));
  console.log("\nCANONICAL PHONE DUPLICATE EVIDENCE");
  console.table(rows(canonicalPhoneDuplicateEvidence));
  console.log("\nLEAD SOURCE BREAKDOWN");
  console.table(rows(sourceBreakdown));
  console.log("\nCOUNTS THROUGH OFFICIAL WORKBOOK LAST-SAVE TIME (2026-08-19 01:58:39 ASIA/KARACHI)");
  console.table(rows(workbookCutoff));
  console.log("\nEMPLOYEE COUNTS IN THE FIRST 177 AUGUST SLACK LEAD SUBMISSIONS");
  console.table(rows(first177));
  console.log("\nSLACK EVIDENCE AFTER OFFICIAL WORKBOOK LAST-SAVE TIME");
  console.table(rows(afterWorkbookCutoff));
  console.log("\nREPEATED PHONE EVIDENCE");
  console.table(rows(duplicatePhones));
  console.log("\nREPEATED NORMALIZED RAW TEXT EVIDENCE");
  console.table(rows(duplicateTexts));
  console.log("\nLEAD TABLE INDEXES");
  console.table(rows(constraintChecks));
  console.log("\nAUGUST LEADS OUTSIDE THE NINE-PERSON ISA SCOPE");
  console.table(rows(outsideScope));
  }
} finally {
  await closeDb();
}
