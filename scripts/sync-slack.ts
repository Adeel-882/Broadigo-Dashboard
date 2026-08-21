import { createRequire } from "node:module";
createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());
const { importAllConfiguredHistory } = await import("@/lib/slack/history");
const { closeDb } = await import("@/lib/db/client");
try {
  const results=await importAllConfiguredHistory();
  for(const result of results) console.log(`#${result.name}: ${result.imported} messages processed across ${result.pages} page(s)`);
  console.log(`Historical Slack sync complete for ${results.length} configured channel(s).`);
} finally { await closeDb(); }
