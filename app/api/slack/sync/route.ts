import { after } from "next/server";
import { z } from "zod";
import { importHistoryPage } from "@/lib/slack/history";
import { isAuthenticatedRequest } from "@/lib/auth/session";

const bodySchema = z.object({ workspaceId: z.string().min(2), channelId: z.string().min(2), cursor: z.string().optional() });

export async function POST(request: Request) {
  if (!(await isAuthenticatedRequest(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return Response.json({ error: "workspaceId and channelId are required" }, { status: 400 });
  after(async () => { await importHistoryPage(parsed.data.workspaceId, parsed.data.channelId, parsed.data.cursor); });
  return Response.json({ accepted: true, message: "One resumable history page has been queued." }, { status: 202 });
}
