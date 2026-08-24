/**
 * Registers the official performance targets in the existing `targets` table.
 *
 * Reuses the table's existing role / period / effective-date structure rather
 * than building a parallel system. Values are derived from
 * `lib/performance-targets.ts` so the database and the calculations cannot drift
 * apart. Idempotent: an existing active row for the same scope+metric+period is
 * updated in place, never duplicated.
 *
 * These are performance milestones. No salary, payroll or commission value is
 * stored or implied.
 *
 *   pnpm targets:seed --dry-run
 *   pnpm targets:seed
 */
import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const [{ sql }, { closeDb, getDb }, targets] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/performance-targets"),
]);
const maybeDb = getDb(); if (!maybeDb) throw new Error("DATABASE_URL is required.");
const db = maybeDb;
const dryRun = process.argv.includes("--dry-run");
const rows = (r: unknown) => r as Array<Record<string, unknown>>;

interface Definition {
  role?: string;
  teamSlug?: string;
  metric: string;
  value: number;
  note: string;
}

const DEFINITIONS: Definition[] = [
  { role: "Appointment Setter", metric: "qualified_calls", value: targets.QUALIFIED_CALLS_TARGET, note: "Monthly qualified-call requirement (was 15)" },
  { role: "Appointment Setter", metric: "revenue_milestone_entry", value: targets.APPOINTMENT_SETTER_REVENUE_MILESTONES[0], note: "First revenue milestone on the ladder" },
  { role: "Closer", metric: "revenue", value: targets.CLOSER_REVENUE_QUALIFICATION, note: "Qualification: revenue OR closed sales" },
  { role: "Closer", metric: "sales", value: targets.CLOSER_SALES_QUALIFICATION, note: "Qualification: revenue OR closed sales" },
  { role: "Closer", metric: "accelerator_revenue", value: targets.CLOSER_ACCELERATOR_THRESHOLD, note: "Accelerator eligibility: revenue must EXCEED this" },
  { role: "Inside Sales Agent", metric: "leads", value: targets.LEAD_GENERATOR_INDIVIDUAL_TARGET, note: "Individual monthly lead target" },
  { teamSlug: "isa-lead-management", metric: "team_leads", value: targets.LEAD_GENERATOR_TEAM_TARGET, note: "Collective monthly team lead bonus threshold" },
];

const effectiveFrom = `${new Date().getUTCFullYear()}-${String(new Date().getUTCMonth() + 1).padStart(2, "0")}-01`;

/**
 * A previous run registered the collective 450 threshold under metric 'leads'
 * scoped to the ISA team. The resolver matches team-scoped rows before
 * role-scoped ones, so that row was being used as every ISA's individual target
 * instead of the official 26. It is deactivated rather than deleted so the
 * historical definition remains auditable.
 */
async function supersedeLegacyTeamLeadTarget() {
  const stale = rows(await db.execute(sql`
    select tg.id from targets tg join teams t on t.id = tg.team_id
    where t.slug = 'isa-lead-management' and tg.metric = 'leads' and tg.active = true and tg.employee_id is null`));
  for (const row of stale) {
    if (!dryRun) await db.execute(sql`update targets set active = false, effective_to = current_date where id = ${String(row.id)}::uuid`);
  }
  return stale.length;
}

const snapshot = () => db.execute(sql`
  select coalesce(tg.role,'(team)') scope, coalesce(t.name,'—') team, tg.metric, tg.period, tg.value, tg.active, tg.effective_from
  from targets tg left join teams t on t.id=tg.team_id
  where tg.active = true order by tg.role nulls last, tg.metric`);

try {
  console.log("BEFORE (active target rows)");
  console.table(rows(await snapshot()));

  const changes: string[] = [];
  const superseded = await supersedeLegacyTeamLeadTarget();
  if (superseded) changes.push(`deactivate ${superseded} legacy ISA team row(s) using metric 'leads' (superseded by 'team_leads')`);

  for (const definition of DEFINITIONS) {
    let teamId: string | null = null;
    if (definition.teamSlug) {
      const [team] = rows(await db.execute(sql`select id from teams where slug=${definition.teamSlug} limit 1`));
      if (!team) { console.log(`  team ${definition.teamSlug} missing, skipped`); continue; }
      teamId = String(team.id);
    }

    const existing = rows(await db.execute(sql`
      select id, value::text from targets
      where metric=${definition.metric} and period='MONTHLY' and active=true
        and employee_id is null
        and role is not distinct from ${definition.role ?? null}
        and team_id is not distinct from ${teamId}::uuid
      limit 1`));

    if (existing.length) {
      if (Number(existing[0].value) === definition.value) continue;
      changes.push(`update ${definition.role ?? definition.teamSlug} / ${definition.metric}: ${String(existing[0].value)} -> ${definition.value}`);
      if (!dryRun) await db.execute(sql`update targets set value=${String(definition.value)} where id=${String(existing[0].id)}::uuid`);
      continue;
    }

    changes.push(`insert ${definition.role ?? definition.teamSlug} / ${definition.metric} = ${definition.value} (MONTHLY)`);
    if (!dryRun) await db.execute(sql`
      insert into targets (team_id, role, metric, period, value, active, effective_from)
      values (${teamId}::uuid, ${definition.role ?? null}, ${definition.metric}, 'MONTHLY', ${String(definition.value)}, true, ${effectiveFrom})`);
  }

  console.log(`\n${dryRun ? "DRY RUN — nothing written" : "APPLIED"}: ${changes.length} change(s)`);
  changes.forEach((line) => console.log(`  - ${line}`));
  console.log("\nAFTER (active target rows)");
  console.table(rows(await snapshot()));
} finally { await closeDb(); }
