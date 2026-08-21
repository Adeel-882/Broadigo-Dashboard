import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const [{ eq }, { closeDb, getDb }, schema] = await Promise.all([
  import("drizzle-orm"),
  import("@/lib/db/client"),
  import("@/lib/db/schema"),
]);
const { divisions, employeeAliases, employees, memberships, slackChannels, teams } = schema;

const divisionSeed = [
  { name: "Broadigo Media", slug: "broadigo-media" }, { name: "Real Estate", slug: "real-estate" }, { name: "Lead Management", slug: "lead-management" },
];
const teamSeed = [
  ["broadigo-media","Media Operations","media-operations","OPERATIONAL"], ["broadigo-media","Media Sales Development","media-sales-development","APPOINTMENT"],
  ["real-estate","Broadigo Real Estate","broadigo-real-estate","APPOINTMENT"], ["real-estate","Broadigo Sales","broadigo-sales","CLOSER"],
  ["real-estate","LeadsEdge Real Estate","leadsedge-real-estate","APPOINTMENT"], ["real-estate","LeadsEdge Sales","leadsedge-sales","CLOSER"],
  ["lead-management","ISA / Lead Management","isa-lead-management","ISA"],
];
const employeeSeed: Array<[string,string,string[],string[],boolean,string?]> = [
  ["Jordan Jones","Appointment Setter · Hybrid Media",["broadigo-real-estate","media-sales-development"],[],true], ["Alex Bosch","Appointment Setter",["broadigo-real-estate"],[],true], ["Mike Weston","Appointment Setter",["broadigo-real-estate"],[],true],
  ["Caleb Ford","Appointment Setter",["leadsedge-real-estate"],[],true], ["Ryan Voss","Appointment Setter",["leadsedge-real-estate"],[],true], ["Jason Harkins","Appointment Setter",["leadsedge-real-estate"],[],true], ["Joseph Scott","Appointment Setter",["leadsedge-real-estate"],[],true], ["Derek Reed","Appointment Setter · Hybrid Media",["leadsedge-real-estate","media-sales-development"],["Arham"],true],
  ["Zack Wilson","Closer",["broadigo-sales"],[],true], ["Dean Scott","Closer",["broadigo-sales"],[],true], ["Cade Callahan","Closer · Hybrid Media",["broadigo-sales","media-operations"],[],true],
  ["Dameon Wolfe","Closer",["leadsedge-sales"],[],true], ["Lars White","Closer",["leadsedge-sales"],[],true], ["Phillip Stokes","Closer",["leadsedge-sales"],[],true], ["Ryaan Aamir","Closer",["leadsedge-sales"],[],true], ["Lena Cross","Closer",["leadsedge-sales"],[],true],
  ["Asif Hazoor","Inside Sales Agent",["isa-lead-management"],[],true], ["Ali Jan","Inside Sales Agent",["isa-lead-management"],[],true], ["Haji Siraj Ahmed","Inside Sales Agent",["isa-lead-management"],[],true], ["Araad Rana","Inside Sales Agent",["isa-lead-management"],[],true], ["Alishba Ali","Inside Sales Agent",["isa-lead-management"],[],true], ["Hamdan Mahmood","Inside Sales Agent",["isa-lead-management"],[],true], ["Zeeshan Afsar","Inside Sales Agent",["isa-lead-management"],[],true], ["Zaynab Rafaqat","Inside Sales Agent",["isa-lead-management"],[],true], ["Aishah Arif","Inside Sales Agent",["isa-lead-management"],[],true],
  ["Adeel Ahmed","Media Operations",["media-operations"],[],false], ["Ahmad Ul Huda","Media Operations",["media-operations"],[],false], ["Harvey Benjamin","Hybrid Media",["media-operations","media-sales-development"],[],true], ["Jordan Reid","Hybrid Media",["media-operations","media-sales-development"],["Shaheer Ali"],true], ["Mark Smith","Hybrid Media",["media-operations","media-sales-development"],[],true], ["Sarah James","Hybrid Media",["media-operations","media-sales-development"],[],true],
  ["Mohib","Chief Executive Officer",["media-operations"],[],false,"CEO"], ["Adil Mehmood","Chief Operating Officer",["media-operations"],["Cody"],false,"COO"], ["Taha Mujuddadi","Chief Technology Officer",["media-operations"],[],false,"CTO"],
];
const channelSeed = [
  ["broadigo-media","media-operations","media-work"], ["broadigomedia-sales-development-general","media-sales-development","media-appointment"], ["broadigo-sale-development-general","broadigo-real-estate","broadigo-appointment"], ["broadigo-sales-reporting","broadigo-sales","broadigo-sale"], ["sales-development-general","leadsedge-real-estate","leadsedge-appointment"], ["sales-reporting","leadsedge-sales","leadsedge-sale"], ["leads-reporting","isa-lead-management","leads"], ["docks-reporting","isa-lead-management","dock"],
];

const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
console.log(`Seeding database at ${new URL(databaseUrl).hostname}.`);
const db = getDb();
if (!db) throw new Error("Unable to initialize the configured database.");
for (const division of divisionSeed) await db.insert(divisions).values(division).onConflictDoNothing();
const divisionRows = await db.select().from(divisions); const divisionBySlug = new Map(divisionRows.map((row) => [row.slug,row]));
for (const [divisionSlug,name,slug,type] of teamSeed) await db.insert(teams).values({ divisionId: divisionBySlug.get(divisionSlug)!.id, name, slug, type }).onConflictDoNothing();
const teamRows = await db.select().from(teams); const teamBySlug = new Map(teamRows.map((row) => [row.slug,row]));
for (const [canonicalName,jobTitle,teamSlugs,aliases,rankingEnabled,leadershipLevel] of employeeSeed) {
  let [employee] = await db.select().from(employees).where(eq(employees.canonicalName, canonicalName)).limit(1);
  if (!employee) [employee] = await db.insert(employees).values({ canonicalName, jobTitle, leadershipLevel }).returning();
  for (const alias of aliases) await db.insert(employeeAliases).values({ employeeId: employee.id, alias }).onConflictDoNothing();
  for (const teamSlug of teamSlugs) await db.insert(memberships).values({ employeeId: employee.id, teamId: teamBySlug.get(teamSlug)!.id, role: jobTitle, rankingEnabled }).onConflictDoNothing();
}
const workspaceId = process.env.SLACK_WORKSPACE_ID ?? "UNCONFIGURED";
for (const [name,teamSlug,parserType] of channelSeed) await db.insert(slackChannels).values({ workspaceId, slackChannelId: `UNCONFIGURED:${name}`, name, teamId: teamBySlug.get(teamSlug)!.id, parserType, active: false }).onConflictDoNothing();
console.log(`Seeded ${divisionSeed.length} divisions, ${teamSeed.length} teams, ${employeeSeed.length} employees, and ${channelSeed.length} inactive channel definitions.`);
await closeDb();
