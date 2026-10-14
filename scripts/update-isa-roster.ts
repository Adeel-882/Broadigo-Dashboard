import { createRequire } from "node:module";
import { sql } from "drizzle-orm";
import { CURRENT_ISA_ROSTER, CURRENT_ISA_NAMES } from "../lib/isa-roster";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const apply = process.argv.includes("--apply");
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
const [{ drizzle }, { default: postgres }] = await Promise.all([import("drizzle-orm/postgres-js"), import("postgres")]);
const client = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 20 });
const db = drizzle(client);

try {
  const result = await db.transaction(async (tx) => {
    const [team] = await tx.execute(sql`select id from teams where slug='isa-lead-management' limit 1`);
    if (!team) throw new Error("ISA / Lead Management team not found.");
    const workspaceRows = await tx.execute(sql`select distinct workspace_id from slack_channels where name='leads-reporting' and active=true`);
    if (workspaceRows.length !== 1) throw new Error("Exactly one active leads-reporting workspace is required.");
    const workspaceId = String(workspaceRows[0].workspace_id);
    const changes: string[] = [];
    const ids = new Map<string, string>();

    for (const person of CURRENT_ISA_ROSTER) {
      const legacyName = person.realName === "Syed Ali Jan" ? "Ali Jan" : person.realName === "Alishba Zareh" ? "Alishba Ali" : null;
      const existing = await tx.execute(sql`select id,canonical_name from employees where lower(canonical_name)=lower(${person.realName}) ${legacyName ? sql`or lower(canonical_name)=lower(${legacyName})` : sql``} order by (lower(canonical_name)=lower(${person.realName})) desc limit 1`);
      let employeeId = existing[0]?.id ? String(existing[0].id) : "";
      if (!employeeId) {
        const inserted = await tx.execute(sql`insert into employees(canonical_name,job_title,active,pseudo_name,work_email) values(${person.realName},'Inside Sales Agent',true,${person.pseudoName},${person.email}) returning id`);
        employeeId = String(inserted[0].id); changes.push(`create ${person.realName}`);
      } else {
        await tx.execute(sql`update employees set canonical_name=${person.realName},job_title='Inside Sales Agent',active=true,pseudo_name=${person.pseudoName},work_email=${person.email} where id=${employeeId}::uuid`);
        changes.push(`update ${person.realName}`);
      }
      ids.set(person.realName, employeeId);
      await tx.execute(sql`insert into employee_team_memberships(employee_id,team_id,role,ranking_enabled) values(${employeeId}::uuid,${String(team.id)}::uuid,'Inside Sales Agent',true) on conflict(employee_id,team_id) do update set role='Inside Sales Agent',ranking_enabled=true`);
      if (person.slackUserId) {
        await tx.execute(sql`insert into employee_slack_identities(employee_id,workspace_id,slack_user_id,display_name,aliases) values(${employeeId}::uuid,${workspaceId},${person.slackUserId},${person.pseudoName},array[${person.realName},${person.pseudoName}]::text[]) on conflict(workspace_id,slack_user_id) do update set employee_id=excluded.employee_id,display_name=excluded.display_name,aliases=excluded.aliases`);
      }
    }

    const currentNames = [...CURRENT_ISA_NAMES];
    const departed = await tx.execute(sql`select e.id,e.canonical_name from employees e join employee_team_memberships m on m.employee_id=e.id where m.team_id=${String(team.id)}::uuid and e.active=true and e.canonical_name not in (${sql.join(currentNames.map((name) => sql`${name}`), sql`,`)})`);
    for (const person of departed) {
      await tx.execute(sql`update employees set active=false where id=${String(person.id)}::uuid`);
      changes.push(`deactivate ${String(person.canonical_name)}`);
    }
    if (!apply) throw Object.assign(new Error("DRY_RUN"), { changes, ids, departed });
    return { changes, ids, departed };
  }).catch((error: unknown) => {
    if (error instanceof Error && error.message === "DRY_RUN") return error as Error & { changes: string[]; ids: Map<string,string>; departed: unknown[] };
    throw error;
  });
  console.log(apply ? "APPLIED" : "DRY RUN (rolled back)");
  console.table(result.changes.map((change) => ({ change })));
  console.table([...result.ids].map(([real_name, employee_id]) => ({ real_name, employee_id })));
} finally {
  await client.end({ timeout: 5 });
}
