import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";
import * as schema from "@/lib/db/schema";

type Pool = ReturnType<typeof postgres>;
const globalForDb = globalThis as unknown as { sql?: Pool; sqlIngestion?: Pool };

const isServerless = Boolean(process.env.VERCEL);

/**
 * Two connection profiles, because the two workloads want opposite things.
 *
 * `default` serves dashboard reads. `getDashboardData` fans out ten queries with
 * `Promise.all`, so it needs several connections and the patience to wait for
 * one. Squeezing it onto a single fail-fast connection serialises the fan-out
 * and turns a saturated pooler into a `CONNECT_TIMEOUT`, which Drizzle rethrows
 * as `Failed query: <sql>` on whichever query happened to be in flight.
 *
 * `ingestion` serves the Slack webhook, which does one short write under a ~3s
 * Slack budget. There it is correct to hold a single connection, recycle idle
 * sockets that a frozen container may have killed, and fail fast rather than
 * hang past the delivery window.
 */
export type DbProfile = "default" | "ingestion";

const profiles = {
  default: {
    max: () => {
      const configured = Number(process.env.DATABASE_POOL_MAX ?? (isServerless ? 5 : 5));
      return Number.isInteger(configured) && configured > 0 ? configured : 5;
    },
    // Idle recycling still matters on serverless: a frozen container's socket is
    // usually dead on thaw. It is the pool size and connect budget that must stay
    // generous for the dashboard's parallel reads.
    idle_timeout: isServerless ? 20 : 0,
    max_lifetime: isServerless ? 60 * 10 : 0,
    connect_timeout: 30,
  },
  ingestion: {
    max: () => 1,
    idle_timeout: isServerless ? 20 : 0,
    max_lifetime: isServerless ? 60 * 5 : 0,
    connect_timeout: 10,
  },
} satisfies Record<DbProfile, { max: () => number; idle_timeout: number; max_lifetime: number; connect_timeout: number }>;

function createPool(profile: DbProfile, url: string) {
  const settings = profiles[profile];
  return postgres(url, {
    max: settings.max(),
    prepare: false,
    idle_timeout: settings.idle_timeout,
    max_lifetime: settings.max_lifetime,
    connect_timeout: settings.connect_timeout,
    onnotice: () => {},
  });
}

export function getDb(profile: DbProfile = "default") {
  const url = process.env.DATABASE_URL;
  if (!url) return null;
  const key = profile === "ingestion" ? "sqlIngestion" : "sql";
  const client = globalForDb[key] ?? createPool(profile, url);
  globalForDb[key] = client;
  return drizzle(client, { schema });
}

export async function closeDb() {
  await Promise.all(([["sql", globalForDb.sql], ["sqlIngestion", globalForDb.sqlIngestion]] as const)
    .map(async ([key, client]) => {
      if (!client) return;
      await client.end({ timeout: 5 });
      globalForDb[key] = undefined;
    }));
}

/**
 * Unwraps a Drizzle/postgres error into something safe to log.
 *
 * Drizzle's message embeds the whole failing SQL statement, so it must never be
 * returned to a browser; the useful part is the driver `cause` underneath.
 */
export function describeDbError(error: unknown) {
  const chain: string[] = [];
  let current: unknown = error;
  let depth = 0;
  while (current instanceof Error && depth < 5) {
    const err = current as Error & { code?: string; severity?: string; detail?: string; routine?: string };
    chain.push([
      `${err.name}: ${err.message.split("\n")[0].slice(0, 200)}`,
      err.code ? `code=${err.code}` : "",
      err.severity ? `severity=${err.severity}` : "",
      err.detail ? `detail=${String(err.detail).slice(0, 160)}` : "",
      err.routine ? `routine=${err.routine}` : "",
    ].filter(Boolean).join(" "));
    current = (current as { cause?: unknown }).cause;
    depth += 1;
  }
  const root = chain.at(-1) ?? "Unknown database error";
  const code = (() => {
    let node: unknown = error;
    for (let i = 0; i < 5 && node instanceof Error; i += 1) {
      const value = (node as { code?: string }).code;
      if (value) return value;
      node = (node as { cause?: unknown }).cause;
    }
    return undefined;
  })();
  return { chain, root, code };
}
