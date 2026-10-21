import {sql} from 'drizzle-orm';
import {checkEditOrigin,createEditToken,editBody,editIdentity,EDIT_COOKIE,EDIT_TTL,limitEditAttempts,passwordMatches} from '@/lib/auto-docks/edit-auth';
import {dockId,DockEditError} from '@/lib/auto-docks/edit-validation';
import {autoDockDb,resultRows} from '@/lib/auto-docks/service';
export const runtime='nodejs';
export async function POST(request:Request){
  try{
    const identity=await editIdentity(request);checkEditOrigin(request);
    await limitEditAttempts(request,identity.session);
    const body=await editBody(request),id=dockId(body.id);
    if(!passwordMatches(body.password))throw new DockEditError('Invalid edit password.',403);
    const [dock]=resultRows(await autoDockDb().execute(sql`select id from effective_automatic_docks where id=${id}::uuid and status='active'`));
    if(!dock)throw new DockEditError('Active automatic dock not found.',404);
    const token=createEditToken(identity.session,id);
    return Response.json({authorized:true},{headers:{'Cache-Control':'no-store','Set-Cookie':`${EDIT_COOKIE}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${EDIT_TTL}${process.env.NODE_ENV==='production'?'; Secure':''}`}});
  }catch(e){if(e instanceof DockEditError)return Response.json({error:e.message},{status:e.status,headers:{'Cache-Control':'no-store'}});console.error('[auto-dock-edit] authorization unavailable');return Response.json({error:'Dock editing is unavailable.'},{status:503});}
}
