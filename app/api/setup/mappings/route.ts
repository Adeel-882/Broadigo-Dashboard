import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { employees, slackChannels, slackIdentities } from "@/lib/db/schema";

const mapping = z.discriminatedUnion("type", [
  z.object({ type: z.literal("channel"), id: z.string().uuid(), workspaceId: z.string().min(1), slackChannelId: z.string().regex(/^[CG][A-Z0-9]+$/, "Use a Slack channel ID beginning with C or G."), active: z.boolean() }),
  z.object({ type: z.literal("employee"), employeeId: z.string().uuid(), workspaceId: z.string().min(1), slackUserId: z.string().regex(/^U[A-Z0-9]+$/, "Use a Slack user ID beginning with U."), displayName: z.string().optional() }),
]);

export async function GET(request: Request) {
  if (!(await isAuthenticatedRequest(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const db=getDb(); if(!db) return Response.json({ error:"DATABASE_URL is not configured." },{status:503});
  const [channels, people] = await Promise.all([db.select().from(slackChannels), db.select({ id:employees.id, name:employees.canonicalName, workspaceId:slackIdentities.workspaceId, slackUserId:slackIdentities.slackUserId, displayName:slackIdentities.displayName }).from(employees).leftJoin(slackIdentities,eq(slackIdentities.employeeId,employees.id)).where(eq(employees.active,true))]);
  return Response.json({ channels, employees: people });
}

export async function PATCH(request: Request) {
  if (!(await isAuthenticatedRequest(request))) return Response.json({ error: "Unauthorized" }, { status: 401 });
  const parsed=mapping.safeParse(await request.json()); if(!parsed.success) return Response.json({error:parsed.error.issues[0]?.message},{status:400});
  const db=getDb(); if(!db) return Response.json({error:"DATABASE_URL is not configured."},{status:503});
  if(parsed.data.type==="channel") { const [updated]=await db.update(slackChannels).set({workspaceId:parsed.data.workspaceId,slackChannelId:parsed.data.slackChannelId,active:parsed.data.active}).where(eq(slackChannels.id,parsed.data.id)).returning(); return Response.json(updated); }
  const existing=await db.select().from(slackIdentities).where(and(eq(slackIdentities.workspaceId,parsed.data.workspaceId),eq(slackIdentities.slackUserId,parsed.data.slackUserId))).limit(1);
  if(existing[0]) await db.update(slackIdentities).set({employeeId:parsed.data.employeeId,displayName:parsed.data.displayName}).where(eq(slackIdentities.id,existing[0].id));
  else await db.insert(slackIdentities).values({employeeId:parsed.data.employeeId,workspaceId:parsed.data.workspaceId,slackUserId:parsed.data.slackUserId,displayName:parsed.data.displayName});
  return Response.json({ok:true});
}
