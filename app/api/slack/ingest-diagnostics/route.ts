import { isAuthenticatedRequest } from "@/lib/auth/session";
import { readSlackIngestDiagnostics } from "@/lib/slack/observability";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Live ingestion diagnostics for the Slack data health console.
 *
 * Answers the question the old pipeline could not: for the most recent webhook
 * deliveries, what did the route decide, did the workspace and channel mapping
 * match, and did anything actually persist.
 */
export async function GET(request: Request) {
  if (!(await isAuthenticatedRequest(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  try {
    const { recent, summary } = await readSlackIngestDiagnostics(20);
    return Response.json({
      summary: summary ?? {},
      recent: recent.map((row) => ({
        receivedAt: row.receivedAt,
        eventId: row.eventId,
        channel: row.slackChannelId,
        user: row.slackUserId,
        slackTs: row.slackTs,
        action: row.routingAction,
        result: row.result,
        reason: row.reason,
        recordType: row.recordType,
        workspaceMatched: row.workspaceMatched,
        channelMatched: row.channelMatched,
        durationMs: row.durationMs,
        error: row.errorMessage,
      })),
    });
  } catch (error) {
    return Response.json({ error: error instanceof Error ? error.message : "Unable to read ingestion diagnostics." }, { status: 502 });
  }
}
