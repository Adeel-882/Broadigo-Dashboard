import {checkEditOrigin,editBody,editIdentity,requireEditToken} from '@/lib/auto-docks/edit-auth';
import {dockId,DockEditError} from '@/lib/auto-docks/edit-validation';
import {editAutomaticDock} from '@/lib/auto-docks/edit-service';
export const runtime='nodejs';
type Context={params:Promise<{id:string}>};
async function mutate(request:Request,context:Context,action:'amount'|'deleted'){
  try{
    const identity=await editIdentity(request);checkEditOrigin(request);const id=dockId((await context.params).id);
    requireEditToken(request,identity.session,id);
    return Response.json(await editAutomaticDock(id,action,await editBody(request),identity),{headers:{'Cache-Control':'no-store'}});
  }catch(e){if(e instanceof DockEditError)return Response.json({error:e.message},{status:e.status});console.error('[auto-dock-edit] mutation unavailable');return Response.json({error:'Unable to update automatic dock.'},{status:503});}
}
export const PATCH=(request:Request,context:Context)=>mutate(request,context,'amount');
export const DELETE=(request:Request,context:Context)=>mutate(request,context,'deleted');
