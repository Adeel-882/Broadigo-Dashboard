import { createRequire } from "node:module";

createRequire(import.meta.url)("@next/env").loadEnvConfig(process.cwd());

const { auditSlackPipeline, reprocessStoredSlackMessages } = await import("@/lib/slack/reprocess");
const { closeDb } = await import("@/lib/db/client");

function printAudit(label: string, audit: Awaited<ReturnType<typeof auditSlackPipeline>>) {
  console.log(`\n${label}`);
  console.table(audit.channels);
  console.table([audit.totals]);
  console.table([audit.structured]);
  console.table([audit.attribution]);
}

try {
  printAudit("BEFORE REPROCESSING", await auditSlackPipeline());
  console.log("\nREPROCESSING BY CHANNEL");
  const progress = await reprocessStoredSlackMessages((channel) => console.table([channel]));
  const totals = progress.reduce((sum, channel) => ({
    total: sum.total + channel.total,
    parsed: sum.parsed + channel.parsed,
    unparsed: sum.unparsed + channel.unparsed,
    skipped: sum.skipped + channel.skipped,
    failed: sum.failed + channel.failed,
    attributionUpdated: sum.attributionUpdated + channel.attributionUpdated,
  }), { total: 0, parsed: 0, unparsed: 0, skipped: 0, failed: 0, attributionUpdated: 0 });
  console.log("\nREPROCESSING TOTALS");
  console.table([totals]);
  printAudit("AFTER REPROCESSING", await auditSlackPipeline());
} finally {
  await closeDb();
}
