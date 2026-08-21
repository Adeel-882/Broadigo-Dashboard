/**
 * Corrects canonical roles and formal team memberships.
 *
 * Formal membership and job title describe the organisation. They are edited
 * here deliberately and never by activity: a record landing in a team's
 * reporting channel makes that person visible in the team's drill-down for the
 * period, but must not rewrite who they are.
 *
 * Corrections applied:
 *   Lena Cross  — Appointment Setter on Broadigo Real Estate and LeadsEdge Real
 *                 Estate. Her stale "LeadsEdge Sales / Closer" row is removed;
 *                 she has no sales records, only appointments.
 *   Ryaan Aamir — verified LeadsEdge-side only. His Broadigo appointments stay
 *                 attributed to Broadigo Real Estate via the record's own
 *                 team_id; no Broadigo membership is created.
 *
 * Idempotent, and it never touches appointment/sale/lead rows.
 *
 *   pnpm tsx scripts/fix-org-structure.ts --dry-run
 *   pnpm tsx scripts/fix-org-structure.ts
 */
import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const [{ sql }, { closeDb, getDb }] = await Promise.all([import("drizzle-orm"), import("@/lib/db/client")]);
const db = getDb(); if (!db) throw new Error("DATABASE_URL is required.");
const dryRun = process.argv.includes("--dry-run");
const rows = (r: unknown) => r as Array<Record<string, unknown>>;

interface Correction {
  employee: string;
  jobTitle?: string;
  /** Exactly the memberships this person should have. Anything else is removed. */
  memberships: Array<{ slug: string; role: string }>;
}

const CORRECTIONS: Correction[] = [
  {
    employee: "Lena Cross",
    jobTitle: "Appointment Setter",
    memberships: [
      { slug: "broadigo-real-estate", role: "Appointment Setter" },
      { slug: "leadsedge-real-estate", role: "Appointment Setter" },
    ],
  },
  {
    employee: "Ryaan Aamir",
    jobTitle: "Closer",
    memberships: [{ slug: "leadsedge-sales", role: "Closer" }],
  },
];

const snapshot = () => db.execute(sql`
  select e.canonical_name employee, e.job_title, coalesce(t.name,'(no team)') team, m.role, m.ranking_enabled
  from employees e
  left join employee_team_memberships m on m.employee_id=e.id
  left join teams t on t.id=m.team_id
  where e.canonical_name in ('Lena Cross','Ryaan Aamir')
  order by e.canonical_name, t.name`);

try {
  console.log("BEFORE");
  console.table(rows(await snapshot()));

  const changes: string[] = [];
  for (const correction of CORRECTIONS) {
    const [employee] = rows(await db.execute(sql`
      select id, job_title from employees where canonical_name=${correction.employee} limit 1`));
    if (!employee) { console.log(`  ${correction.employee}: not found, skipped`); continue; }
    const employeeId = String(employee.id);

    if (correction.jobTitle && String(employee.job_title) !== correction.jobTitle) {
      changes.push(`${correction.employee}: job_title "${String(employee.job_title)}" -> "${correction.jobTitle}"`);
      if (!dryRun) await db.execute(sql`update employees set job_title=${correction.jobTitle} where id=${employeeId}::uuid`);
    }

    const wanted = new Map(correction.memberships.map((m) => [m.slug, m.role]));
    const existing = rows(await db.execute(sql`
      select m.id, t.slug, m.role from employee_team_memberships m join teams t on t.id=m.team_id
      where m.employee_id=${employeeId}::uuid`));

    for (const row of existing) {
      const slug = String(row.slug);
      if (!wanted.has(slug)) {
        changes.push(`${correction.employee}: remove membership "${slug}" (role ${String(row.role)})`);
        if (!dryRun) await db.execute(sql`delete from employee_team_memberships where id=${String(row.id)}::uuid`);
        continue;
      }
      const role = wanted.get(slug)!;
      if (String(row.role) !== role) {
        changes.push(`${correction.employee}: ${slug} role "${String(row.role)}" -> "${role}"`);
        if (!dryRun) await db.execute(sql`update employee_team_memberships set role=${role} where id=${String(row.id)}::uuid`);
      }
    }

    const present = new Set(existing.map((row) => String(row.slug)));
    for (const [slug, role] of wanted) {
      if (present.has(slug)) continue;
      const [team] = rows(await db.execute(sql`select id from teams where slug=${slug} limit 1`));
      if (!team) { console.log(`  team ${slug} not found, skipped`); continue; }
      changes.push(`${correction.employee}: add membership "${slug}" (role ${role})`);
      if (!dryRun) await db.execute(sql`
        insert into employee_team_memberships (employee_id, team_id, role, ranking_enabled)
        values (${employeeId}::uuid, ${String(team.id)}::uuid, ${role}, true)
        on conflict (employee_id, team_id) do nothing`);
    }
  }

  console.log(`\n${dryRun ? "DRY RUN — nothing written" : "APPLIED"}: ${changes.length} change(s)`);
  changes.forEach((line) => console.log(`  - ${line}`));

  console.log("\nAFTER");
  console.table(rows(await snapshot()));
} finally { await closeDb(); }
