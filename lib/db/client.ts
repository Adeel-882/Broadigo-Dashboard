import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const configuredMax = Number(process.env.DATABASE_POOL_MAX ?? 5);
  const max = Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : 5;
  const client = globalForDb.sql ?? postgres(url, { max, prepare: false });
  globalForDb.sql = client;
  return drizzle(client, { schema });
}

export async function closeDb() {
  if (!globalForDb.sql) return;
  await globalForDb.sql.end({ timeout: 5 });
  globalForDb.sql = undefined;
}
