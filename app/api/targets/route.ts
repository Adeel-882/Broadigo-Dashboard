import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { isAuthenticatedRequest } from "@/lib/auth/session";
import { getDb } from "@/lib/db/client";
import { employees, targets, teams } from "@/lib/db/schema";

const targetInput=z.object({
  team:z.string().min(1).nullable(),employee:z.string().min(1).nullable(),role:z.string().max(120).nullable(),
  metric:z.enum(["appointments","leads","sales","revenue","work"]),period:z.enum(["DAILY","WEEKLY","MONTHLY"]),
  value:z.coerce.number().positive(),effectiveFrom:z.string().regex(/^\d{4}-\d{2}-\d{2}$/),effectiveTo:z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
}).refine(value=>value.team||value.employee,{message:"Choose a team or employee."});
const patchInput=targetInput.extend({id:z.string().uuid(),active:z.boolean().optional()});

async function resolveScope(db:NonNullable<ReturnType<typeof getDb>>,teamName:string|null,employeeName:string|null){
  const [team,employee]=await Promise.all([
    teamName?db.select({id:teams.id}).from(teams).where(eq(teams.name,teamName)).limit(1):Promise.resolve([]),
    employeeName?db.select({id:employees.id}).from(employees).where(and(eq(employees.canonicalName,employeeName),eq(employees.active,true))).limit(1):Promise.resolve([]),
  ]);
  if(teamName&&!team[0])throw new Error("Team not found.");if(employeeName&&!employee[0])throw new Error("Active employee not found.");
  return {teamId:team[0]?.id??null,employeeId:employee[0]?.id??null};
}

export async function POST(request:Request){
  if(!(await isAuthenticatedRequest(request)))return Response.json({error:"Unauthorized"},{status:401});
  const parsed=targetInput.safeParse(await request.json());if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message},{status:400});
  const db=getDb();if(!db)return Response.json({error:"DATABASE_URL is not configured."},{status:503});
  try{const scope=await resolveScope(db,parsed.data.team,parsed.data.employee);const [created]=await db.insert(targets).values({...scope,role:parsed.data.role,metric:parsed.data.metric,period:parsed.data.period,value:String(parsed.data.value),effectiveFrom:parsed.data.effectiveFrom,effectiveTo:parsed.data.effectiveTo,active:true}).returning();return Response.json(created,{status:201});}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Unable to create target."},{status:400});}
}

export async function PATCH(request:Request){
  if(!(await isAuthenticatedRequest(request)))return Response.json({error:"Unauthorized"},{status:401});
  const parsed=patchInput.safeParse(await request.json());if(!parsed.success)return Response.json({error:parsed.error.issues[0]?.message},{status:400});
  const db=getDb();if(!db)return Response.json({error:"DATABASE_URL is not configured."},{status:503});
  try{const scope=await resolveScope(db,parsed.data.team,parsed.data.employee);const [updated]=await db.update(targets).set({...scope,role:parsed.data.role,metric:parsed.data.metric,period:parsed.data.period,value:String(parsed.data.value),effectiveFrom:parsed.data.effectiveFrom,effectiveTo:parsed.data.effectiveTo,active:parsed.data.active??true}).where(eq(targets.id,parsed.data.id)).returning();if(!updated)return Response.json({error:"Target not found."},{status:404});return Response.json(updated);}
  catch(error){return Response.json({error:error instanceof Error?error.message:"Unable to update target."},{status:400});}
}
