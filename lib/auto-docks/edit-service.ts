import {sql} from 'drizzle-orm';
import {autoDockDb,resultRows} from './service';
import {dockId,DockEditError,editReason,moneyAmount} from './edit-validation';
export async function editAutomaticDock(id:string,action:'amount'|'deleted',input:Record<string,unknown>,identity:{actor:string;session:string}){
  dockId(id);const amount=action==='amount'?moneyAmount(input.amount):null,reason=editReason(input.reason,action==='deleted');
  return autoDockDb().transaction(async tx=>{
    const [dock]=resultRows(await tx.execute(sql`select * from automatic_docks where id=${id}::uuid`));
    if(!dock)throw new DockEditError('Automatic dock not found.',404);
    // Same day lock as cron, then re-read effective state. No manual dock table access.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext('auto-docks:'||${String(dock.business_date)}))`);
    const [current]=resultRows(await tx.execute(sql`select * from effective_automatic_docks where id=${id}::uuid`));
    if(current.status!=='active')throw new DockEditError('This automatic dock is no longer active. Refresh the audit.',409);
    if(String(input.expectedAmount)!==String(current.amount))throw new DockEditError('The amount changed. Refresh the audit before editing.',409);
    if(action==='amount'&&amount===String(current.amount))return {changed:false};
    await tx.execute(sql`insert into auto_dock_overrides(dock_id,override_type,amount,reason,actor,session_fingerprint) values(${id}::uuid,${action},${amount}::numeric,${reason},${identity.actor},${identity.session}) on conflict(dock_id) do update set override_type=excluded.override_type,amount=excluded.amount,reason=excluded.reason,actor=excluded.actor,session_fingerprint=excluded.session_fingerprint,updated_at=now()`);
    await tx.execute(sql`insert into auto_dock_edit_history(dock_id,employee_id,business_date,rule_code,action,old_amount,new_amount,reason,actor,session_fingerprint) values(${id}::uuid,${String(dock.employee_id)}::uuid,${String(dock.business_date)}::date,${String(dock.rule_code)},${action==='amount'?'AMOUNT_CHANGED':'ADMIN_DELETED'},${String(current.amount)}::numeric,${amount??'0'}::numeric,${reason},${identity.actor},${identity.session})`);
    return {changed:true};
  });
}
