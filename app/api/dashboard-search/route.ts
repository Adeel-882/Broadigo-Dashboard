import { isAuthenticatedRequest } from "@/lib/auth/session";
import { searchDashboardActivities } from "@/lib/dashboard-data";
import type { PeriodKey } from "@/types/dashboard";

const periods=new Set<PeriodKey>(["Today","Yesterday","This Week","Last Week","This Month","Last Month","Custom Range"]);
export async function GET(request:Request){if(!(await isAuthenticatedRequest(request)))return Response.json({error:"Unauthorized"},{status:401});const url=new URL(request.url),value=url.searchParams.get("period") as PeriodKey,period=periods.has(value)?value:"This Week";try{return Response.json(await searchDashboardActivities(url.searchParams.get("q")??"",period,url.searchParams.get("start")??undefined,url.searchParams.get("end")??undefined));}catch(error){return Response.json({error:error instanceof Error?error.message:"Search failed."},{status:400});}}
