import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

const globalForDb = globalThis as unknown as { sql?: ReturnType<typeof postgres> };

/**
 * Serverless-safe connection settings.
 *
 * A Vercel function container is frozen between invocations, so a pooled socket
 * cached on `globalThis` is very often already dead when the next request thaws
 * it. Without an idle timeout those sockets are kept forever and the first query
 * after a thaw stalls until the default 30s connect timeout, which is far longer
 * than Slack's delivery window. Recycling idle connections and failing fast
 * keeps the webhook path inside its budget.
 */
const isServerless = Boolean(process.env.VERCEL);

export function getDb() {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const configuredMax = Number(process.env.DATABASE_POOL_MAX ?? (isServerless ? 1 : 5));
  const max = Number.isInteger(configuredMax) && configuredMax > 0 ? configuredMax : isServerless ? 1 : 5;
  const client = globalForDb.sql ?? postgres(url, {
    max,
    prepare: false,
    // Drop idle sockets so a frozen container never reuses a dead one.
    idle_timeout: isServerless ? 20 : 0,
    // Recycle long-lived sockets that a pooler may have closed server-side.
    max_lifetime: isServerless ? 60 * 5 : 0,
    // Fail fast instead of hanging past Slack's retry window.
    connect_timeout: 10,
    onnotice: () => {},
  });
  globalForDb.sql = client;
  return drizzle(client, { schema });
}

export async function closeDb() {
  if (!globalForDb.sql) return;
  await globalForDb.sql.end({ timeout: 5 });
  globalForDb.sql = undefined;
}
