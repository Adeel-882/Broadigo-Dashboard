// Node-only authentication module. Never import from client components.
import {createHash,createHmac,timingSafeEqual} from 'node:crypto';
import {sql} from 'drizzle-orm';
import {sessionCookie,verifySession} from '@/lib/auth/session';
import {autoDockDb,resultRows} from './service';
import {DockEditError} from './edit-validation';
export const EDIT_COOKIE='leadsedge_dock_edit';
export const EDIT_TTL=600;
function digest(value:string){return createHash('sha256').update(value).digest();}
function cookie(request:Request,name:string){try{return decodeURIComponent(request.headers.get('cookie')?.split(';').map(v=>v.trim()).find(v=>v.startsWith(name+'='))?.slice(name.length+1)??'');}catch{return '';}}
export async function editIdentity(request:Request){
  const token=cookie(request,sessionCookie.name);
  // Write access never accepts the development demo bypass.
  if(!await verifySession(token))throw new DockEditError('Unauthorized',401);
  const payload=JSON.parse(Buffer.from(token.split('.')[0],'base64url').toString()) as {email?:unknown};
  if(typeof payload.email!=='string'||!payload.email)throw new DockEditError('Unauthorized',401);
  return {actor:payload.email,session:digest(token).toString('hex')};
}
export function checkEditOrigin(request:Request){
  if(request.headers.get('origin')!==new URL(request.url).origin||request.headers.get('sec-fetch-site')==='cross-site')throw new DockEditError('Request not permitted.',403);
  if(!request.headers.get('content-type')?.startsWith('application/json'))throw new DockEditError('JSON required.',415);
}
export async function editBody(request:Request):Promise<Record<string,unknown>>{
  const reader=request.body?.getReader();if(!reader)throw new DockEditError('Invalid request.');
  let size=0;const parts:Uint8Array[]=[];
  try{while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>4096){await reader.cancel();throw new DockEditError('Request too large.',413);}parts.push(value);}const value=JSON.parse(Buffer.concat(parts).toString());if(!value||typeof value!=='object'||Array.isArray(value))throw new Error();return value;}catch(e){if(e instanceof DockEditError)throw e;throw new DockEditError('Invalid request.');}
}
export function passwordMatches(input:unknown){
  const expected=process.env.DOCK_EDIT_PASSWORD;
  if(!expected)throw new DockEditError('Dock editing is not configured.',503);
  return typeof input==='string'&&input.length<=1024&&timingSafeEqual(digest(input),digest(expected));
}
function sign(payload:string){
  const secret=process.env.SESSION_SECRET,editSecret=process.env.DOCK_EDIT_PASSWORD;
  if(!secret||secret.length<32||!editSecret)throw new DockEditError('Dock editing is not configured.',503);
  return createHmac('sha256',secret).update('automatic-dock-edit:'+editSecret+':'+payload).digest('base64url');
}
export function createEditToken(session:string,id:string,now=Date.now()){
  const payload=Buffer.from(JSON.stringify({purpose:'automatic-dock-edit',session,id,exp:Math.floor(now/1000)+EDIT_TTL})).toString('base64url');
  return `${payload}.${sign(payload)}`;
}
export function validEditToken(token:string,session:string,id:string,now=Date.now()){
  try{const parts=token.split('.');if(parts.length!==2)return false;const [payload,signature]=parts;if(!timingSafeEqual(digest(signature),digest(sign(payload))))return false;const data=JSON.parse(Buffer.from(payload,'base64url').toString());return data.purpose==='automatic-dock-edit'&&data.session===session&&data.id===id&&data.exp>Math.floor(now/1000)&&data.exp<=Math.floor(now/1000)+EDIT_TTL;}catch{return false;}
}
export function requireEditToken(request:Request,session:string,id:string){if(!validEditToken(cookie(request,EDIT_COOKIE),session,id))throw new DockEditError('Edit authorization expired. Enter the edit password again.',403);}
export async function limitEditAttempts(request:Request,session:string){
  // Durable across Vercel instances. Store keyed fingerprints, never raw IPs or credentials.
  const secret=process.env.SESSION_SECRET!;
  const ip=request.headers.get('x-vercel-forwarded-for')?.split(',')[0]?.trim();
  const keys=[{key:createHmac('sha256',secret).update('dock-session:'+session).digest('hex'),limit:5},...(ip?[{key:createHmac('sha256',secret).update('dock-ip:'+ip).digest('hex'),limit:30}]:[])];
  for(const {key,limit} of keys){
    const [row]=resultRows(await autoDockDb().execute(sql`insert into auto_dock_edit_attempts(key,window_started,attempts) values(${key},now(),1) on conflict(key) do update set attempts=case when auto_dock_edit_attempts.window_started<=now()-interval '15 minutes' then 1 else auto_dock_edit_attempts.attempts+1 end,window_started=case when auto_dock_edit_attempts.window_started<=now()-interval '15 minutes' then now() else auto_dock_edit_attempts.window_started end returning attempts`));
    if(Number(row.attempts)>limit)throw new DockEditError('Too many attempts. Try again in 15 minutes.',429);
  }
}
