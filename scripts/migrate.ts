import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const databaseUrl = process.env.DATABASE_URL;
if (!databaseUrl) throw new Error("DATABASE_URL is required.");
console.log(`Applying database migrations to ${new URL(databaseUrl).hostname}.`);
const [{ drizzle }, { migrate }, { default: postgres }] = await Promise.all([
  import("drizzle-orm/postgres-js"),
  import("drizzle-orm/postgres-js/migrator"),
  import("postgres"),
]);
const client = postgres(databaseUrl, { max: 1, prepare: false, connect_timeout: 15 });
try {
  await migrate(drizzle(client), { migrationsFolder: "./drizzle" });
  console.log("Database migrations applied successfully.");
} finally {
  await client.end({ timeout: 5 });
}
