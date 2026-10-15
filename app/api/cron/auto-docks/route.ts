import { timingSafeEqual } from "node:crypto";
import { runDailyAutoDocks } from "@/lib/auto-docks/scheduler";

export const runtime="nodejs";
export const dynamic="force-dynamic";
export const maxDuration=60;
export async function GET(request:Request){
  const secret=process.env.CRON_SECRET;
  const supplied=Buffer.from(request.headers.get("authorization")??"");
  const expected=Buffer.from(`Bearer ${secret??""}`);
  if(!secret||supplied.length!==expected.length||!timingSafeEqual(supplied,expected))return Response.json({error:"Unauthorized"},{status:401});
  try{return Response.json(await runDailyAutoDocks());}
  catch {console.error("[auto-dock] cron failed; pending work retained");return Response.json({error:"Automatic dock evaluation failed; retry safely"},{status:500});}
}
