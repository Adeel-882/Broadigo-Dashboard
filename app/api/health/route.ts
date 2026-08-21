import { getDb } from "@/lib/db/client";
import { isAuthenticatedRequest } from "@/lib/auth/session";

export async function GET(request: Request) {
  if (!(await isAuthenticatedRequest(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  return Response.json({ status: "ok", databaseConfigured: Boolean(getDb()), slackConfigured: Boolean(process.env.SLACK_BOT_TOKEN && process.env.SLACK_SIGNING_SECRET), timezone: "Asia/Karachi", timestamp: new Date().toISOString() });
}
